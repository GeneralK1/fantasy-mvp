require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const db = require('./database');
const fs = require('fs');        // ← ДОБАВИТЬ
const multer = require('multer'); // ← УБЕДИТЬСЯ, ЧТО ЕСТЬ


const app = express();
const PORT = 3000;

// ✅ ВАЖНО: Доверие прокси (добавьте эту строку)
app.set('trust proxy', 1);

// Middleware
app.use(cors());
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  next();
});
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));


app.use(cors({
  origin: process.env.NODE_ENV === 'production' 
    ? 'https://master-maze-app.online' 
    : 'http://localhost:3000',
  credentials: true
}));

require('dotenv').config();
const rateLimit = require('express-rate-limit');

const limiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 15 минут
  max: 1000 // максимум 100 запросов
});
// Доверие прокси (Nginx)

//app.use(limiter);


// ============ API ДЛЯ СПОРТСМЕНОВ ============
// Тестовый endpoint для проверки токена
app.get('/auth/me', (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ error: 'Не авторизован' });
  }

  try {
    // Декодируем base64 токен (для мока)
    const decoded = JSON.parse(atob(token));
    res.json(decoded);
  } catch (error) {
    res.status(401).json({ error: 'Недействительный токен' });
  }
});
// Получить команду текущего пользователя (по vk_id)
app.get('/api/teams/me', (req, res) => {
  // В Mini Apps vk_id передаётся через заголовок или query
  const vk_id = req.headers['x-vk-user-id'] || req.query.vk_id;
  
  if (!vk_id) {
    return res.status(400).json({ error: 'VK ID не получен' });
  }
  
  const team = db.prepare('SELECT * FROM teams WHERE vk_id = ?').get(vk_id);
  
  if (!team) {
    return res.status(404).json({ error: 'Команда не найдена' });
  }
  
  const players = db.prepare(`
    SELECT p.* FROM players p
    JOIN team_players tp ON p.id = tp.player_id
    WHERE tp.team_id = ?
  `).all(team.id);
  
  res.json({ ...team, players });
});

app.get('/api/players', (req, res) => {
  const players = db.prepare('SELECT * FROM players ORDER BY gender, full_name').all();
  res.json(players);
});

app.post('/api/players', (req, res) => {
  const { full_name, birth_year, team, rank, gender } = req.body;
  
  // Валидация
  if (!full_name || full_name.length > 100) {
    return res.status(400).json({ error: 'Некорректное имя' });
  }
  
  if (!birth_year || birth_year < 1950 || birth_year > 2015) {
    return res.status(400).json({ error: 'Некорректный год рождения' });
  }
  
  const result = db.prepare(
    'INSERT INTO players (full_name, birth_year, team, rank, gender) VALUES (?, ?, ?, ?, ?)'
  ).run(full_name, birth_year, team, rank, gender);
  
  const newPlayer = db.prepare('SELECT * FROM players WHERE id = ?').get(result.lastInsertRowid);
  res.json(newPlayer);
});

app.delete('/api/players/:id', (req, res) => {
  db.prepare('DELETE FROM players WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});


// Импорт спортсменов из CSV
// Импорт спортсменов из CSV
app.post('/api/players/import', (req, res) => {
  try {
    const { csv } = req.body;
    
    if (!csv) {
      return res.status(400).json({ error: 'CSV не передан' });
    }

    console.log('Получен CSV для импорта, длина:', csv.length);
    
    const lines = csv.split('\n');
    let imported = 0;
    let errors = 0;

    // Определяем, есть ли заголовок
    const firstLine = lines[0].toLowerCase();
    const startIndex = firstLine.includes('full_name') || firstLine.includes('фамилия') ? 1 : 0;

    console.log(`Начинаем импорт со строки ${startIndex}, всего строк: ${lines.length}`);

    for (let i = startIndex; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      // Пробуем разделить по точке с запятой ИЛИ по запятой
      const parts = line.split(/;|,/).map(p => p.trim().replace(/^"|"$/g, ''));
      
      console.log(`Строка ${i}:`, parts);
      
      if (parts.length < 4) {
        console.log(`Пропущена строка ${i}: недостаточно колонок (${parts.length})`);
        errors++;
        continue;
      }

      const full_name = parts[0];
      const birth_year = parseInt(parts[1]);
      const team = parts[2] || '';
      const rank = parts[3] || '';
      const gender = parts[4] ? parts[4].toLowerCase() : 'male';

      if (!full_name || !birth_year || isNaN(birth_year)) {
        console.log(`Пропущена строка ${i}: неверные данные`);
        errors++;
        continue;
      }

      try {
        db.prepare(`
          INSERT OR REPLACE INTO players (full_name, birth_year, team, rank, gender)
          VALUES (?, ?, ?, ?, ?)
        `).run(full_name, birth_year, team, rank, gender);
        imported++;
        console.log(`✅ Импортирован: ${full_name} (${birth_year})`);
      } catch (error) {
        console.error(` Ошибка импорта строки ${i}:`, error.message);
        errors++;
      }
    }

    console.log(`\n Импорт завершён: ${imported} успешно, ${errors} ошибок`);
    res.json({ imported, errors });
  } catch (error) {
    console.error('Ошибка импорта:', error);
    res.status(500).json({ error: 'Ошибка импорта: ' + error.message });
  }
});

// ============ API ДЛЯ КОМАНД ============

// Создание команды
app.post('/api/teams', (req, res) => {
  const { user_name, vk_id, event_id } = req.body;
  
  if (!user_name || !vk_id) {
    return res.status(400).json({ error: 'Не указаны имя или VK ID' });
  }
  
  try {
    // Создаём пользователя если нет
    db.prepare(`
      INSERT OR IGNORE INTO vk_users (vk_id, first_name, last_name, is_admin)
      VALUES (?, ?, ?, 0)
    `).run(vk_id, user_name.split(' ')[0], user_name.split(' ')[1] || '');
    
    // Проверяем, есть ли уже команда для этого события
    if (event_id) {
      const existingTeam = db.prepare(
        'SELECT * FROM teams WHERE vk_id = ? AND event_id = ?'
      ).get(vk_id, event_id);
      
      if (existingTeam) {
        return res.status(400).json({ error: 'У вас уже есть команда для этого события' });
      }
    }
    
    // Создаём команду
    const result = db.prepare(
      'INSERT INTO teams (vk_id, event_id, user_name) VALUES (?, ?, ?)'
    ).run(vk_id, event_id || null, user_name);
    
    const team = db.prepare('SELECT * FROM teams WHERE id = ?').get(result.lastInsertRowid);
    res.json(team);
  } catch (error) {
    console.error('Ошибка создания команды:', error);
    res.status(500).json({ error: 'Ошибка: ' + error.message });
  }
});

// Получить команду по vk_id и event_id
// Получить команду по vk_id и event_id
app.get('/api/teams/by-vk-id', (req, res) => {
  const vk_id = req.query.vk_id;
  const event_id = req.query.event_id;
  
  if (!vk_id) {
    return res.status(400).json({ error: 'VK ID не указан' });
  }
  
  try {
    let team;
    if (event_id) {
      // Ищем команду для КОНКРЕТНОГО события
      team = db.prepare(
        'SELECT * FROM teams WHERE vk_id = ? AND event_id = ?'
      ).get(vk_id, event_id);
    } else {
      // Если event_id не передан - возвращаем ошибку
      return res.status(400).json({ error: 'event_id не указан' });
    }
    
    if (!team) {
      return res.status(404).json({ error: 'Команда не найдена' });
    }
    
    const players = db.prepare(`
      SELECT p.* FROM players p
      JOIN team_players tp ON p.id = tp.player_id
      WHERE tp.team_id = ?
    `).all(team.id);
    
    res.json({ ...team, players });
  } catch (error) {
    console.error('Ошибка:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

app.post('/api/teams/:teamId/players', (req, res) => {
  const teamId = req.params.teamId;
  const { player_id } = req.body;
  
  const team = db.prepare('SELECT * FROM teams WHERE id = ?').get(teamId);
  if (!team) return res.status(404).json({ error: 'Команда не найдена' });
  
  const player = db.prepare('SELECT * FROM players WHERE id = ?').get(player_id);
  if (!player) return res.status(404).json({ error: 'Игрок не найден' });
  
  const males = db.prepare(`
    SELECT COUNT(*) as count FROM team_players tp
    JOIN players p ON tp.player_id = p.id
    WHERE tp.team_id = ? AND p.gender = 'male'
  `).get(teamId).count;
  
  const females = db.prepare(`
    SELECT COUNT(*) as count FROM team_players tp
    JOIN players p ON tp.player_id = p.id
    WHERE tp.team_id = ? AND p.gender = 'female'
  `).get(teamId).count;
  
  const total = males + females;
  
  if (total >= 8) {
    return res.status(400).json({ error: 'В команде уже 8 человек — максимум' });
  }
  
  if (player.gender === 'male' && males >= 4) {
    return res.status(400).json({ error: 'Мужчин уже 4 — максимум' });
  }
  
  if (player.gender === 'female' && females >= 4) {
    return res.status(400).json({ error: 'Женщин уже 4 — максимум' });
  }
  
  const existing = db.prepare(
    'SELECT * FROM team_players WHERE team_id = ? AND player_id = ?'
  ).get(teamId, player_id);
  
  if (existing) {
    return res.status(400).json({ error: 'Игрок уже в команде' });
  }
  
  db.prepare('INSERT INTO team_players (team_id, player_id) VALUES (?, ?)').run(teamId, player_id);
  
  res.json({ success: true });
});

app.delete('/api/teams/:teamId/players/:playerId', (req, res) => {
  db.prepare('DELETE FROM team_players WHERE team_id = ? AND player_id = ?')
    .run(req.params.teamId, req.params.playerId);
  res.json({ success: true });
});

app.get('/api/teams/:teamId', (req, res) => {
  const team = db.prepare('SELECT * FROM teams WHERE id = ?').get(req.params.teamId);
  if (!team) return res.status(404).json({ error: 'Команда не найдена' });
  
  const players = db.prepare(`
    SELECT p.* FROM players p
    JOIN team_players tp ON tp.player_id = p.id
    WHERE tp.team_id = ?
    ORDER BY p.gender, p.full_name
  `).all(req.params.teamId);
  
  res.json({ ...team, players });
});

app.get('/api/teams', (req, res) => {
  const teams = db.prepare('SELECT * FROM teams ORDER BY created_at DESC').all();
  res.json(teams);
});

// Получить команду по vk_id
app.get('/api/teams/by-vk-id', (req, res) => {
  const vk_id = req.query.vk_id;
  
  if (!vk_id) {
    return res.status(400).json({ error: 'VK ID не указан' });
  }
  
  const team = db.prepare('SELECT * FROM teams WHERE vk_id = ?').get(vk_id);
  
  if (!team) {
    return res.status(404).json({ error: 'Команда не найдена' });
  }
  
  const players = db.prepare(`
    SELECT p.* FROM players p
    JOIN team_players tp ON p.id = tp.player_id
    WHERE tp.team_id = ?
  `).all(team.id);
  
  res.json({ ...team, players });
});

// Подтверждение команды
app.post('/api/teams/:id/confirm', (req, res) => {
  const teamId = req.params.id;
  
  try {
    const team = db.prepare('SELECT * FROM teams WHERE id = ?').get(teamId);
    
    if (!team) {
      return res.status(404).json({ error: 'Команда не найдена' });
    }

    // Проверяем количество игроков
    const players = db.prepare(`
      SELECT COUNT(*) as count FROM team_players WHERE team_id = ?
    `).get(teamId);

    if (players.count !== 8) {
      return res.status(400).json({ error: 'В команде должно быть ровно 8 спортсменов' });
    }

    // Подтверждаем команду
    db.prepare('UPDATE teams SET is_confirmed = 1 WHERE id = ?').run(teamId);
    
    console.log(`✅ Команда ${teamId} подтверждена`);
    res.json({ success: true });
  } catch (error) {
    console.error('Ошибка подтверждения команды:', error);
    res.status(500).json({ error: 'Ошибка: ' + error.message });
  }
});

// ============ API ДЛЯ СОБЫТИЙ ============
// Импорт событий из CSV
app.post('/api/events/import', (req, res) => {
  const { csv } = req.body;
  
  if (!csv) {
    return res.status(400).json({ error: 'CSV не передан' });
  }

  const lines = csv.split('\n');
  let imported = 0;
  let errors = 0;

  // Пропускаем заголовок
  const startIndex = lines[0].toLowerCase().includes('name') ? 1 : 0;

  for (let i = startIndex; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const parts = line.split(',');
    if (parts.length < 6) {
      errors++;
      continue;
    }

    const [name, description, event_start_date, event_end_date, registration_start, registration_end] = parts;
    
    try {
      db.prepare(`
        INSERT INTO events (name, description, event_start_date, event_end_date, registration_start, registration_end, status)
        VALUES (?, ?, ?, ?, ?, ?, 'active')
      `).run(
        name.trim(),
        description.trim(),
        event_start_date.trim(),
        event_end_date.trim(),
        registration_start.trim(),
        registration_end.trim()
      );
      imported++;
    } catch (error) {
      console.error('Ошибка импорта события:', error);
      errors++;
    }
  }

  res.json({ imported, errors });
});

// Получить все команды для события
// Получить все команды для события (с сортировкой: новые сверху)
app.get('/api/events/:eventId/teams', (req, res) => {
  const eventId = req.params.eventId;
  
  try {
    const teams = db.prepare(`
      SELECT t.*, COUNT(tp.player_id) as player_count
      FROM teams t
      LEFT JOIN team_players tp ON t.id = tp.team_id
      WHERE t.event_id = ?
      GROUP BY t.id
      ORDER BY t.created_at DESC
    `).all(eventId);
    
    const teamsWithStats = teams.map(team => {
      const players = db.prepare(`
        SELECT p.* FROM players p
        JOIN team_players tp ON p.id = tp.player_id
        WHERE tp.team_id = ?
      `).all(team.id);
      
      let totalPoints = 0;
      players.forEach(player => {
        const result = db.prepare(`
          SELECT points FROM event_results 
          WHERE event_id = ? AND player_id = ?
        `).get(eventId, player.id);
        
        if (result) {
          totalPoints += result.points || 0;
        }
      });
      
      return { ...team, players, total_points: totalPoints };
    });
    
    teamsWithStats.sort((a, b) => {
      if (b.total_points !== a.total_points) {
        return b.total_points - a.total_points;
      }
      return new Date(b.created_at) - new Date(a.created_at);
    });
    
    res.json(teamsWithStats);
  } catch (error) {
    console.error('Ошибка:', error);
    res.status(500).json({ error: 'Ошибка: ' + error.message });
  }
});
// Получить все события
app.get('/api/events', (req, res) => {
  try {
    const events = db.prepare('SELECT * FROM events ORDER BY event_start_date ASC').all();
    res.json(events);
  } catch (error) {
    console.error('Ошибка загрузки всех событий:', error);
    res.status(500).json({ error: 'Ошибка: ' + error.message });
  }
});

// Получить активные события
app.get('/api/events/active', (req, res) => {
  try {
    const events = db.prepare(`
      SELECT * FROM events 
      WHERE status = 'active' 
      ORDER BY event_start_date ASC
    `).all();
    
    console.log(' Найдено активных событий:', events.length);
    res.json(events);
  } catch (error) {
    console.error('❌ Ошибка загрузки активных событий:', error);
    res.status(500).json({ error: 'Ошибка: ' + error.message });
  }
});

app.get('/api/events/current', (req, res) => {
  const event = db.prepare("SELECT * FROM events WHERE status = 'active' LIMIT 1").get();
  res.json(event || null);
});

app.post('/api/events', (req, res) => {
  const { name, description, event_start_date, event_end_date, registration_start, registration_end } = req.body;
  
  if (!name || !event_start_date || !event_end_date || !registration_start || !registration_end) {
    return res.status(400).json({ error: 'Заполните все обязательные поля' });
  }
  
  const result = db.prepare(
    'INSERT INTO events (name, description, event_start_date, event_end_date, registration_start, registration_end) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(name, description || '', event_start_date, event_end_date, registration_start, registration_end);
  
  const event = db.prepare('SELECT * FROM events WHERE id = ?').get(result.lastInsertRowid);
  res.json(event);
});

app.put('/api/events/:id', (req, res) => {
  const { name, description, event_start_date, event_end_date, registration_start, registration_end } = req.body;
  
  db.prepare(`
    UPDATE events 
    SET name = ?, description = ?, event_start_date = ?, event_end_date = ?, registration_start = ?, registration_end = ?
    WHERE id = ?
  `).run(name, description || '', event_start_date, event_end_date, registration_start, registration_end, req.params.id);
  
  const event = db.prepare('SELECT * FROM events WHERE id = ?').get(req.params.id);
  res.json(event);
});

app.delete('/api/events/:id', (req, res) => {
  db.prepare('DELETE FROM event_results WHERE event_id = ?').run(req.params.id);
  db.prepare('DELETE FROM event_teams WHERE event_id = ?').run(req.params.id);
  db.prepare('DELETE FROM events WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

app.post('/api/events/:id/activate', (req, res) => {
  const eventId = req.params.id;
  
  try {
    // Активируем ТОЛЬКО конкретное событие, не трогая остальные
    db.prepare("UPDATE events SET status = 'active' WHERE id = ?").run(eventId);
    
    console.log(`✅ Событие ${eventId} активировано`);
    res.json({ success: true });
  } catch (error) {
    console.error('Ошибка активации:', error);
    res.status(500).json({ error: 'Ошибка: ' + error.message });
  }
});

app.post('/api/events/:id/complete', (req, res) => {
  db.prepare("UPDATE events SET status = 'completed' WHERE id = ?").run(req.params.id);
  res.json({ success: true });
});

app.get('/api/events/:id/details', (req, res) => {
  const event = db.prepare('SELECT * FROM events WHERE id = ?').get(req.params.id);
  if (!event) return res.status(404).json({ error: 'Событие не найдено' });
  
  const teams = db.prepare(`
    SELECT et.*, t.user_name, et.total_points
    FROM event_teams et
    JOIN teams t ON et.team_id = t.id
    WHERE et.event_id = ?
    ORDER BY et.total_points DESC
  `).all(req.params.id);
  
  const results = db.prepare(`
    SELECT 
      er.*, 
      p.full_name, 
      p.team, 
      p.gender,
      (COALESCE(er.individual_short, 0) + COALESCE(er.individual_long, 0) + 
       COALESCE(er.tie_short, 0) + COALESCE(er.tie_long, 0) + 
       COALESCE(er.group_short, 0) + COALESCE(er.group_long, 0)) as total_points
    FROM event_results er
    JOIN players p ON er.player_id = p.id
    WHERE er.event_id = ?
    ORDER BY total_points DESC
  `).all(req.params.id);
  
  res.json({ event, teams, results });
});

app.post('/api/teams/:teamId/register', (req, res) => {
  const teamId = req.params.teamId;
  
  const event = db.prepare("SELECT * FROM events WHERE status = 'active' LIMIT 1").get();
  
  if (!event) {
    return res.status(400).json({ error: 'Нет активного события' });
  }
  
  const now = new Date().toISOString().split('T')[0];
  if (now < event.registration_start || now > event.registration_end) {
    return res.status(400).json({ 
      error: `Регистрация закрыта. Регистрация с ${formatDate(event.registration_start)} по ${formatDate(event.registration_end)}` 
    });
  }
  
  const team = db.prepare('SELECT * FROM teams WHERE id = ?').get(teamId);
  if (!team) return res.status(404).json({ error: 'Команда не найдена' });
  
  const playerCount = db.prepare('SELECT COUNT(*) as count FROM team_players WHERE team_id = ?').get(teamId).count;
  if (playerCount !== 8) {
    return res.status(400).json({ error: 'В команде должно быть 8 человек (4 мужчины + 4 женщины)' });
  }
  
  const existing = db.prepare('SELECT * FROM event_teams WHERE event_id = ? AND team_id = ?').get(event.id, teamId);
  if (existing) {
    return res.status(400).json({ error: 'Команда уже зарегистрирована на это событие' });
  }
  
  db.prepare('INSERT INTO event_teams (event_id, team_id) VALUES (?, ?)').run(event.id, teamId);
  
  res.json({ success: true, event: event });
});


// Начислить очки спортсмену (ОДНО число на событие)
app.post('/api/events/:eventId/results', (req, res) => {
  const eventId = req.params.eventId;
  const { player_id, points } = req.body;
  
  if (!player_id || points === undefined) {
    return res.status(400).json({ error: 'Не указан player_id или points' });
  }
  
  try {
    db.prepare(`
      INSERT OR REPLACE INTO event_results (event_id, player_id, points)
      VALUES (?, ?, ?)
    `).run(eventId, player_id, points);
    
    // Пересчитываем очки команды спортсмена
    const team = db.prepare(`
      SELECT tp.team_id FROM team_players tp WHERE tp.player_id = ?
    `).get(player_id);
    
    if (team) {
      const teamPlayers = db.prepare(`
        SELECT tp.player_id FROM team_players tp WHERE tp.team_id = ?
      `).all(team.team_id);
      
      let teamTotal = 0;
      teamPlayers.forEach(tp => {
        const result = db.prepare(
          'SELECT points FROM event_results WHERE event_id = ? AND player_id = ?'
        ).get(eventId, tp.player_id);
        if (result) teamTotal += result.points || 0;
      });
      
      db.prepare(`
        UPDATE event_teams SET total_points = ? 
        WHERE event_id = ? AND team_id = ?
      `).run(teamTotal, eventId, team.team_id);
    }
    
    console.log(`✅ Начислено ${points} очков спортсмену ${player_id} на событие ${eventId}`);
    res.json({ success: true });
  } catch (error) {
    console.error('Ошибка:', error);
    res.status(500).json({ error: 'Ошибка: ' + error.message });
  }
});

// Получить результаты события
app.get('/api/events/:eventId/results', (req, res) => {
  const eventId = req.params.eventId;
  
  try {
    const results = db.prepare(`
      SELECT er.*, p.full_name, p.team, p.rank, p.gender
      FROM event_results er
      JOIN players p ON er.player_id = p.id
      WHERE er.event_id = ?
      ORDER BY er.points DESC
    `).all(eventId);
    
    res.json(results);
  } catch (error) {
    console.error('Ошибка:', error);
    res.status(500).json({ error: 'Ошибка: ' + error.message });
  }
});

// Общий рейтинг спортсменов (сумма очков по всем событиям)
app.get('/api/players/overall-rating', (req, res) => {
  try {
    const rating = db.prepare(`
      SELECT 
        p.id,
        p.full_name,
        p.team,
        p.rank,
        p.gender,
        p.birth_year,
        COALESCE(SUM(er.points), 0) as total_points,
        COUNT(er.event_id) as events_count
      FROM players p
      LEFT JOIN event_results er ON p.id = er.player_id
      GROUP BY p.id
      HAVING total_points > 0
      ORDER BY total_points DESC, p.full_name ASC
    `).all();
    
    res.json(rating);
  } catch (error) {
    console.error('Ошибка:', error);
    res.status(500).json({ error: 'Ошибка: ' + error.message });
  }
});

// Сброс всех данных (кнопка на админке)
app.post('/api/admin/reset-all', (req, res) => {
  try {
    db.exec('DELETE FROM event_results');
    db.exec('DELETE FROM event_teams');
    db.exec('DELETE FROM team_players');
    db.exec('DELETE FROM teams');
    db.exec('DELETE FROM players');
    db.exec('DELETE FROM events');
    
    console.log('🗑️ Все данные сброшены');
    res.json({ success: true, message: 'Все данные успешно удалены' });
  } catch (error) {
    console.error('Ошибка сброса:', error);
    res.status(500).json({ error: 'Ошибка: ' + error.message });
  }
});
  

// Получить результаты события
app.get('/api/events/:eventId/results', (req, res) => {
  const results = db.prepare(`
    SELECT 
      er.*, 
      p.full_name, 
      p.team, 
      p.gender,
      (COALESCE(er.individual_short, 0) + COALESCE(er.individual_long, 0) + 
       COALESCE(er.tie_short, 0) + COALESCE(er.tie_long, 0) + 
       COALESCE(er.group_short, 0) + COALESCE(er.group_long, 0)) as total_points
    FROM event_results er
    JOIN players p ON er.player_id = p.id
    WHERE er.event_id = ?
    ORDER BY total_points DESC
  `).all(req.params.eventId);
  
  res.json(results);
});

// Функция пересчёта очков команд
function recalculateTeamScores(eventId) {
  const teams = db.prepare('SELECT team_id FROM event_teams WHERE event_id = ?').all(eventId);
  const updateStmt = db.prepare('UPDATE event_teams SET total_points = ? WHERE event_id = ? AND team_id = ?');
  
  for (const team of teams) {
    const totalPoints = db.prepare(`
      SELECT COALESCE(SUM(
        COALESCE(er.individual_short, 0) + 
        COALESCE(er.individual_long, 0) + 
        COALESCE(er.tie_short, 0) + 
        COALESCE(er.tie_long, 0) + 
        COALESCE(er.group_short, 0) + 
        COALESCE(er.group_long, 0)
      ), 0) as total
      FROM event_results er
      JOIN team_players tp ON er.player_id = tp.player_id
      WHERE er.event_id = ? AND tp.team_id = ?
    `).get(eventId, team.team_id).total;
    
    updateStmt.run(totalPoints, eventId, team.team_id);
  }
}

function formatDate(dateStr) {
  const date = new Date(dateStr);
  return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
}

// ============ API ДЛЯ РЕЙТИНГОВ ============

app.get('/api/rankings/current', (req, res) => {
  const currentEvent = db.prepare(
    "SELECT * FROM events WHERE status = 'active' ORDER BY event_start_date DESC LIMIT 1"
  ).get();
  
  if (!currentEvent) {
    return res.json({ event: null, rankings: [] });
  }
  
  const rankings = db.prepare(`
    SELECT et.team_id, t.user_name, et.total_points
    FROM event_teams et
    JOIN teams t ON et.team_id = t.id
    WHERE et.event_id = ?
    ORDER BY et.total_points DESC
  `).all(currentEvent.id);
  
  res.json({ event: currentEvent, rankings });
});

app.get('/api/rankings/all-time', (req, res) => {
  const rankings = db.prepare(`
    SELECT t.id as team_id, t.user_name, t.vk_id, u.first_name, u.last_name, u.photo,
           SUM(et.total_points) as total_points, COUNT(et.id) as events_count
    FROM teams t
    JOIN vk_users u ON t.vk_id = u.vk_id
    JOIN event_teams et ON t.id = et.team_id
    GROUP BY t.id
    ORDER BY total_points DESC
  `).all();
  
  res.json(rankings);
});

app.get('/api/rankings/players', (req, res) => {
  const rankings = db.prepare(`
    SELECT p.id, p.full_name, p.team, p.gender, p.rank,
           SUM(COALESCE(er.individual_short, 0) + COALESCE(er.individual_long, 0) + 
               COALESCE(er.tie_short, 0) + COALESCE(er.tie_long, 0) + 
               COALESCE(er.group_short, 0) + COALESCE(er.group_long, 0)) as total_points,
           COUNT(er.id) as events_count,
           AVG(COALESCE(er.individual_short, 0) + COALESCE(er.individual_long, 0) + 
               COALESCE(er.tie_short, 0) + COALESCE(er.tie_long, 0) + 
               COALESCE(er.group_short, 0) + COALESCE(er.group_long, 0)) as avg_points
    FROM players p
    JOIN event_results er ON p.id = er.player_id
    GROUP BY p.id
    ORDER BY total_points DESC
  `).all();
  
  res.json(rankings);
});
// ============ API ДЛЯ ИМПОРТА ============

// Импорт спортсменов из CSV
app.post('/api/import/players', (req, res) => {
  const { csvData } = req.body;
  
  if (!csvData) {
    return res.status(400).json({ error: 'Нет данных для импорта' });
  }

  const results = [];
  const errors = [];
  
  const stream = new Readable();
  stream.push(csvData);
  stream.push(null);

  stream
    .pipe(csvParser({ 
      headers: ['full_name', 'birth_year', 'team', 'rank', 'gender'],
      skipLines: 1 // Пропускаем заголовок
    }))
    .on('data', (row) => {
      // Валидация
      if (!row.full_name || !row.birth_year || !row.team || !row.rank || !row.gender) {
        errors.push(`Пропущена строка: недостаточно данных - ${JSON.stringify(row)}`);
        return;
      }

      const gender = row.gender.toLowerCase().trim();
      if (gender !== 'male' && gender !== 'female' && gender !== 'м' && gender !== 'ж') {
        errors.push(`Пропущена строка: неверный пол "${row.gender}" для ${row.full_name}`);
        return;
      }

      const normalizedGender = (gender === 'м' || gender === 'male') ? 'male' : 'female';
      
      results.push({
        full_name: row.full_name.trim(),
        birth_year: parseInt(row.birth_year),
        team: row.team.trim(),
        rank: row.rank.trim().toUpperCase(),
        gender: normalizedGender
      });
    })
    .on('end', () => {
      const insertStmt = db.prepare(
        'INSERT INTO players (full_name, birth_year, team, rank, gender) VALUES (?, ?, ?, ?, ?)'
      );
      
      const transaction = db.transaction((players) => {
        let inserted = 0;
        for (const p of players) {
          try {
            insertStmt.run(p.full_name, p.birth_year, p.team, p.rank, p.gender);
            inserted++;
          } catch (err) {
            errors.push(`Ошибка вставки: ${p.full_name} - ${err.message}`);
          }
        }
        return inserted;
      });

      const inserted = transaction(results);
      
      res.json({ 
        success: true, 
        inserted, 
        total: results.length,
        errors 
      });
    })
    .on('error', (err) => {
      res.status(500).json({ error: `Ошибка парсинга CSV: ${err.message}` });
    });
});

// Импорт событий из CSV
app.post('/api/import/events', (req, res) => {
  const { csvData } = req.body;
  
  if (!csvData) {
    return res.status(400).json({ error: 'Нет данных для импорта' });
  }

  const results = [];
  const errors = [];
  
  const stream = new Readable();
  stream.push(csvData);
  stream.push(null);

  stream
    .pipe(csvParser({ 
      headers: ['name', 'description', 'event_start_date', 'event_end_date', 'registration_start', 'registration_end'],
      skipLines: 1
    }))
    .on('data', (row) => {
      if (!row.name || !row.event_start_date || !row.event_end_date || !row.registration_start || !row.registration_end) {
        errors.push(`Пропущена строка: недостаточно данных - ${JSON.stringify(row)}`);
        return;
      }

      results.push({
        name: row.name.trim(),
        description: row.description ? row.description.trim() : '',
        event_start_date: row.event_start_date.trim(),
        event_end_date: row.event_end_date.trim(),
        registration_start: row.registration_start.trim(),
        registration_end: row.registration_end.trim()
      });
    })
    .on('end', () => {
      const insertStmt = db.prepare(
        'INSERT INTO events (name, description, event_start_date, event_end_date, registration_start, registration_end) VALUES (?, ?, ?, ?, ?, ?)'
      );
      
      const transaction = db.transaction((events) => {
        let inserted = 0;
        for (const e of events) {
          try {
            insertStmt.run(e.name, e.description, e.event_start_date, e.event_end_date, e.registration_start, e.registration_end);
            inserted++;
          } catch (err) {
            errors.push(`Ошибка вставки: ${e.name} - ${err.message}`);
          }
        }
        return inserted;
      });

      const inserted = transaction(results);
      
      res.json({ 
        success: true, 
        inserted, 
        total: results.length,
        errors 
      });
    })
    .on('error', (err) => {
      res.status(500).json({ error: `Ошибка парсинга CSV: ${err.message}` });
    });
});
// ============ API ДЛЯ ИМПОРТА РЕЗУЛЬТАТОВ ============

// Импорт результатов из CSV
app.post('/api/import/results', (req, res) => {
  const { eventId, csvData } = req.body;
  
  if (!eventId || !csvData) {
    return res.status(400).json({ error: 'Выберите событие и вставьте данные' });
  }

  const results = [];
  const errors = [];
  const warnings = [];
  const stats = {
    total: 0,
    imported: 0,
    updated: 0,
    skipped: 0,
    notFound: 0
  };
  
  const stream = new Readable();
  stream.push(csvData);
  stream.push(null);

  stream
    .pipe(csvParser({ 
      headers: ['full_name', 'individual_short', 'individual_long', 'tie_short', 'tie_long', 'group_short', 'group_long', 'place'],
      skipLines: 1
    }))
    .on('data', (row) => {
      stats.total++;
      
      // Проверка данных
      if (!row.full_name || !row.full_name.trim()) {
        errors.push(`Строка ${stats.total}: не указано ФИО`);
        stats.skipped++;
        return;
      }

      const fullName = row.full_name.trim();
      
      // Ищем спортсмена по ФИО
      const player = db.prepare('SELECT * FROM players WHERE LOWER(full_name) = LOWER(?)').get(fullName);
      
      if (!player) {
        warnings.push(`Строка ${stats.total}: спортсмен "${fullName}" не найден в базе`);
        stats.notFound++;
        return;
      }

      // Проверяем, есть ли уже результаты
      const existing = db.prepare(
        'SELECT * FROM event_results WHERE event_id = ? AND player_id = ?'
      ).get(eventId, player.id);

      const data = {
        player_id: player.id,
        individual_short: parseInt(row.individual_short) || 0,
        individual_long: parseInt(row.individual_long) || 0,
        tie_short: parseInt(row.tie_short) || 0,
        tie_long: parseInt(row.tie_long) || 0,
        group_short: parseInt(row.group_short) || 0,
        group_long: parseInt(row.group_long) || 0,
        place: parseInt(row.place) || null
      };

      // Проверка на дублирование
      if (existing) {
        // Обновляем существующие
        db.prepare(`
          UPDATE event_results 
          SET individual_short = ?, individual_long = ?, tie_short = ?, tie_long = ?, 
              group_short = ?, group_long = ?, place = ?
          WHERE event_id = ? AND player_id = ?
        `).run(
          data.individual_short, data.individual_long, data.tie_short, data.tie_long,
          data.group_short, data.group_long, data.place, eventId, player.id
        );
        stats.updated++;
        warnings.push(`Строка ${stats.total}: обновлены результаты для ${fullName}`);
      } else {
        // Вставляем новые
        db.prepare(`
          INSERT INTO event_results 
          (event_id, player_id, individual_short, individual_long, tie_short, tie_long, group_short, group_long, place)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          eventId, player.id, data.individual_short, data.individual_long,
          data.tie_short, data.tie_long, data.group_short, data.group_long, data.place
        );
        stats.imported++;
      }

      results.push({ ...data, full_name: fullName });
    })
    .on('end', () => {
      // Пересчитываем очки команд
      recalculateTeamScores(eventId);
      
      res.json({ 
        success: true, 
        stats,
        errors,
        warnings,
        results: results.length
      });
    })
    .on('error', (err) => {
      res.status(500).json({ error: `Ошибка парсинга CSV: ${err.message}` });
    });
});

// Получить список событий для импорта
app.get('/api/events/active-completed', (req, res) => {
  const events = db.prepare(
    "SELECT id, name, status FROM events WHERE status IN ('active', 'completed') ORDER BY event_start_date DESC"
  ).all();
  res.json(events);
});
// Получить активные события
app.get('/api/events/active', (req, res) => {
  try {
    const events = db.prepare(`
      SELECT * FROM events 
      WHERE status = 'active' 
      ORDER BY event_start_date ASC
    `).all();
    
    console.log('📦 Найдено активных событий:', events.length);
    res.json(events);
  } catch (error) {
    console.error('❌ Ошибка загрузки активных событий:', error);
    res.status(500).json({ error: 'Ошибка: ' + error.message });
  }
});
// ========== НАЧИСЛЕНИЕ ОЧКОВ ==========

// Получить спортсменов события (из команд + все с результатами)
app.get('/api/events/:eventId/players', (req, res) => {
  const eventId = req.params.eventId;
  
  try {
    // Все спортсмены из команд этого события
    const players = db.prepare(`
      SELECT DISTINCT p.id, p.full_name, p.team, p.rank, p.gender, p.birth_year
      FROM players p
      JOIN team_players tp ON p.id = tp.player_id
      JOIN teams t ON tp.team_id = t.id
      WHERE t.event_id = ?
      ORDER BY p.full_name ASC
    `).all(eventId);
    
    // Добавляем текущие очки
    const playersWithPoints = players.map(player => {
      const result = db.prepare(`
        SELECT points FROM event_results 
        WHERE event_id = ? AND player_id = ?
      `).get(eventId, player.id);
      
      return {
        ...player,
        points: result ? result.points : 0
      };
    });
    
    res.json(playersWithPoints);
  } catch (error) {
    console.error('Ошибка:', error);
    res.status(500).json({ error: 'Ошибка: ' + error.message });
  }
});

// Начислить очки спортсмену (ОДНО число)
app.post('/api/events/:eventId/results', (req, res) => {
  const eventId = req.params.eventId;
  const { player_id, points } = req.body;
  
  if (!player_id || points === undefined) {
    return res.status(400).json({ error: 'Не указан player_id или points' });
  }
  
  try {
    db.prepare(`
      INSERT OR REPLACE INTO event_results (event_id, player_id, points)
      VALUES (?, ?, ?)
    `).run(eventId, player_id, points);
    
    // Пересчитываем очки команды
    const team = db.prepare(`
      SELECT tp.team_id FROM team_players tp WHERE tp.player_id = ?
    `).get(player_id);
    
    if (team) {
      const teamPlayers = db.prepare(`
        SELECT tp.player_id FROM team_players tp WHERE tp.team_id = ?
      `).all(team.team_id);
      
      let teamTotal = 0;
      teamPlayers.forEach(tp => {
        const result = db.prepare(
          'SELECT points FROM event_results WHERE event_id = ? AND player_id = ?'
        ).get(eventId, tp.player_id);
        if (result) teamTotal += result.points || 0;
      });
      
      // Обновляем или создаём запись в event_teams
      const existing = db.prepare(
        'SELECT id FROM event_teams WHERE event_id = ? AND team_id = ?'
      ).get(eventId, team.team_id);
      
      if (existing) {
        db.prepare(
          'UPDATE event_teams SET total_points = ? WHERE event_id = ? AND team_id = ?'
        ).run(teamTotal, eventId, team.team_id);
      } else {
        db.prepare(
          'INSERT INTO event_teams (event_id, team_id, total_points) VALUES (?, ?, ?)'
        ).run(eventId, team.team_id, teamTotal);
      }
    }
    
    console.log(`✅ Начислено ${points} очков спортсмену ${player_id} на событие ${eventId}`);
    res.json({ success: true });
  } catch (error) {
    console.error('Ошибка:', error);
    res.status(500).json({ error: 'Ошибка: ' + error.message });
  }
});

// Массовое начисление очков (несколько спортсменов сразу)
app.post('/api/events/:eventId/results/batch', (req, res) => {
  const eventId = req.params.eventId;
  const { results } = req.body; // [{player_id, points}, ...]
  
  if (!results || !Array.isArray(results)) {
    return res.status(400).json({ error: 'Неверный формат данных' });
  }
  
  try {
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO event_results (event_id, player_id, points)
      VALUES (?, ?, ?)
    `);
    
    const insertMany = db.transaction((results) => {
      for (const r of results) {
        stmt.run(eventId, r.player_id, r.points || 0);
      }
    });
    
    insertMany(results);
    
    // Пересчитываем очки всех команд события
    const teams = db.prepare(
      'SELECT DISTINCT t.id FROM teams t JOIN team_players tp ON t.id = tp.team_id WHERE t.event_id = ?'
    ).all(eventId);
    
    teams.forEach(team => {
      const teamPlayers = db.prepare(
        'SELECT player_id FROM team_players WHERE team_id = ?'
      ).all(team.id);
      
      let teamTotal = 0;
      teamPlayers.forEach(tp => {
        const result = db.prepare(
          'SELECT points FROM event_results WHERE event_id = ? AND player_id = ?'
        ).get(eventId, tp.player_id);
        if (result) teamTotal += result.points || 0;
      });
      
      const existing = db.prepare(
        'SELECT id FROM event_teams WHERE event_id = ? AND team_id = ?'
      ).get(eventId, team.id);
      
      if (existing) {
        db.prepare(
          'UPDATE event_teams SET total_points = ? WHERE event_id = ? AND team_id = ?'
        ).run(teamTotal, eventId, team.id);
      } else {
        db.prepare(
          'INSERT INTO event_teams (event_id, team_id, total_points) VALUES (?, ?, ?)'
        ).run(eventId, team.id, teamTotal);
      }
    });
    
    console.log(`✅ Массово начислены очки для ${results.length} спортсменов на событие ${eventId}`);
    res.json({ success: true, count: results.length });
  } catch (error) {
    console.error('Ошибка:', error);
    res.status(500).json({ error: 'Ошибка: ' + error.message });
  }
});

// Общий рейтинг спортсменов (сумма очков по всем событиям)
app.get('/api/players/overall-rating', (req, res) => {
  try {
    const rating = db.prepare(`
      SELECT 
        p.id,
        p.full_name,
        p.team,
        p.rank,
        p.gender,
        p.birth_year,
        COALESCE(SUM(er.points), 0) as total_points,
        COUNT(er.event_id) as events_count
      FROM players p
      LEFT JOIN event_results er ON p.id = er.player_id
      GROUP BY p.id
      HAVING total_points > 0
      ORDER BY total_points DESC, p.full_name ASC
    `).all();
    
    res.json(rating);
  } catch (error) {
    console.error('Ошибка:', error);
    res.status(500).json({ error: 'Ошибка: ' + error.message });
  }
});

// Сброс всех данных
app.post('/api/admin/reset-all', (req, res) => {
  try {
    db.exec('DELETE FROM event_results');
    db.exec('DELETE FROM event_teams');
    db.exec('DELETE FROM team_players');
    db.exec('DELETE FROM teams');
    db.exec('DELETE FROM players');
    db.exec('DELETE FROM events');
    
    console.log('🗑️ Все данные сброшены');
    res.json({ success: true, message: 'Все данные успешно удалены' });
  } catch (error) {
    console.error('Ошибка сброса:', error);
    res.status(500).json({ error: 'Ошибка: ' + error.message });
  }
});
// Импорт очков из CSV файла
const upload = multer({ storage: multer.memoryStorage() });

app.post('/api/events/:eventId/import-scores', upload.single('file'), (req, res) => {
  const eventId = req.params.eventId;
  
  if (!req.file) {
    return res.status(400).json({ error: 'Файл не загружен' });
  }

  try {
    const content = req.file.buffer.toString('utf-8');
    const lines = content.split('\n').filter(line => line.trim());
    
    let imported = 0;
    let errors = 0;
    
    // Определяем формат (с заголовком или без)
    const firstLine = lines[0].toLowerCase();
    const hasHeader = firstLine.includes('full_name') || firstLine.includes('points');
    const startIndex = hasHeader ? 1 : 0;

    for (let i = startIndex; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      // Разделяем по запятой или точке с запятой
      const parts = line.split(/;|,/).map(p => p.trim());
      
      if (parts.length < 2) {
        errors++;
        continue;
      }

      let fullName, points;
      
      if (parts.length === 2) {
        // Формат: full_name,points
        fullName = parts[0];
        points = parseInt(parts[1]);
      } else {
        // Формат: team,full_name,points
        fullName = parts[1];
        points = parseInt(parts[2]);
      }

      if (isNaN(points)) {
        errors++;
        continue;
      }

      // Ищем спортсмена по имени
      const player = db.prepare(`
        SELECT p.id FROM players p
        JOIN team_players tp ON p.id = tp.player_id
        JOIN teams t ON tp.team_id = t.id
        WHERE t.event_id = ? AND p.full_name = ?
      `).get(eventId, fullName);

      if (player) {
        db.prepare(`
          INSERT OR REPLACE INTO event_results (event_id, player_id, points)
          VALUES (?, ?, ?)
        `).run(eventId, player.id, points);
        imported++;
      } else {
        errors++;
      }
    }

    // Пересчитываем очки всех команд
    const teams = db.prepare(
      'SELECT DISTINCT t.id FROM teams t JOIN team_players tp ON t.id = tp.team_id WHERE t.event_id = ?'
    ).all(eventId);

    teams.forEach(team => {
      const teamPlayers = db.prepare(
        'SELECT player_id FROM team_players WHERE team_id = ?'
      ).all(team.id);

      let teamTotal = 0;
      teamPlayers.forEach(tp => {
        const result = db.prepare(
          'SELECT points FROM event_results WHERE event_id = ? AND player_id = ?'
        ).get(eventId, tp.player_id);
        if (result) teamTotal += result.points || 0;
      });

      const existing = db.prepare(
        'SELECT id FROM event_teams WHERE event_id = ? AND team_id = ?'
      ).get(eventId, team.id);

      if (existing) {
        db.prepare(
          'UPDATE event_teams SET total_points = ? WHERE event_id = ? AND team_id = ?'
        ).run(teamTotal, eventId, team.id);
      } else {
        db.prepare(
          'INSERT INTO event_teams (event_id, team_id, total_points) VALUES (?, ?, ?)'
        ).run(eventId, team.id, teamTotal);
      }
    });

    console.log(`✅ Импортировано ${imported} очков, ${errors} ошибок`);
    res.json({ imported, errors });
  } catch (error) {
    console.error('Ошибка импорта:', error);
    res.status(500).json({ error: 'Ошибка: ' + error.message });
  }
});

const { execSync } = require('child_process');

// Создание бэкапа
app.post('/api/admin/backup', (req, res) => {
  try {
    const backupDir = './backups';
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }
    
    const date = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const backupFile = `${backupDir}/fantasy_${date}.db`;
    
    // Используем sqlite3 .backup для консистентного снимка
    db.prepare(`VACUUM INTO '${backupFile}'`).run();
    
    console.log(`✅ Бэкап создан: ${backupFile}`);
    res.json({ success: true, file: backupFile });
  } catch (error) {
    console.error('Ошибка бэкапа:', error);
    res.status(500).json({ error: 'Ошибка: ' + error.message });
  }
});

// Скачать последний бэкап
app.get('/api/admin/backup/latest', (req, res) => {
  try {
    const backupDir = './backups';
    if (!fs.existsSync(backupDir)) {
      return res.status(404).json({ error: 'Нет бэкапов' });
    }
    
    const files = fs.readdirSync(backupDir)
      .filter(f => f.endsWith('.db'))
      .sort()
      .reverse();
    
    if (files.length === 0) {
      return res.status(404).json({ error: 'Нет бэкапов' });
    }
    
    const latestFile = `${backupDir}/${files[0]}`;
    res.download(latestFile, 'fantasy_backup.db');
  } catch (error) {
    console.error('Ошибка:', error);
    res.status(500).json({ error: 'Ошибка: ' + error.message });
  }
});

// Скачать конкретный бэкап
app.get('/api/admin/backup/:filename', (req, res) => {
  try {
    const filename = req.params.filename;
    const filePath = `./backups/${filename}`;
    
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Файл не найден' });
    }
    
    res.download(filePath, filename);
  } catch (error) {
    console.error('Ошибка:', error);
    res.status(500).json({ error: 'Ошибка: ' + error.message });
  }
});

// Список бэкапов
app.get('/api/admin/backups', (req, res) => {
  try {
    const backupDir = './backups';
    if (!fs.existsSync(backupDir)) {
      return res.json([]);
    }
    
    const files = fs.readdirSync(backupDir)
      .filter(f => f.endsWith('.db'))
      .sort()
      .reverse()
      .map(f => {
        const stats = fs.statSync(`${backupDir}/${f}`);
        return {
          name: f,
          size: (stats.size / 1024).toFixed(1) + ' KB',
          date: new Date(stats.mtime).toLocaleString('ru-RU')
        };
      });
    
    res.json(files);
  } catch (error) {
    console.error('Ошибка:', error);
    res.status(500).json({ error: 'Ошибка: ' + error.message });
  }
});

// Восстановление из бэкапа
const uploadDb = multer({ storage: multer.memoryStorage() });

// Восстановление из бэкапа
// Восстановление из бэкапа (без перезагрузки сервера)
app.post('/api/admin/restore', uploadDb.single('file'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Файл не загружен' });
    }
    
    // Записываем бэкап поверх текущей БД
    fs.writeFileSync('./data/fantasy.db', req.file.buffer);
    
    console.log('✅ База данных восстановлена из бэкапа');
    
    // Отправляем ответ клиенту
    res.json({ 
      success: true, 
      message: 'База данных восстановлена! Пожалуйста, перезапустите сервер вручную через SSH: pkill -9 -f node && cd /root/fantasy-mvp && node server.js > server.log 2>&1 &'
    });
    
  } catch (error) {
    console.error('Ошибка восстановления:', error);
    res.status(500).json({ error: 'Ошибка: ' + error.message });
  }
});
app.listen(PORT, () => {
  console.log('✅ Сервер запущен: http://localhost:' + PORT);
  console.log('⚙️ Админ-панель: http://localhost:' + PORT + '/admin.html');
  console.log('👥 Сборка команды: http://localhost:' + PORT + '/');
  console.log('🏆 Рейтинги: http://localhost:' + PORT + '/rankings.html');
});