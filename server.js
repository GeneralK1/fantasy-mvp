require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const db = require('./database');


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
  const { user_name, vk_id } = req.body;
  
  if (!user_name || !vk_id) {
    return res.status(400).json({ error: 'Не указаны имя или VK ID' });
  }
  
  try {
    // 1. Сначала создаём пользователя в vk_users (если нет)
    const firstName = user_name.split(' ')[0] || 'User';
    const lastName = user_name.split(' ')[1] || '';
    
    db.prepare(`
      INSERT OR IGNORE INTO vk_users (vk_id, first_name, last_name, is_admin)
      VALUES (?, ?, ?, 0)
    `).run(vk_id, firstName, lastName);
    
    // 2. Проверяем, есть ли уже команда
    const existingTeam = db.prepare('SELECT * FROM teams WHERE vk_id = ?').get(vk_id);
    if (existingTeam) {
      return res.status(400).json({ error: 'У вас уже есть команда' });
    }
    
    // 3. Создаём команду
    const result = db.prepare('INSERT INTO teams (vk_id, user_name) VALUES (?, ?)').run(vk_id, user_name);
    const team = db.prepare('SELECT * FROM teams WHERE id = ?').get(result.lastInsertRowid);
    
    res.json(team);
  } catch (error) {
    console.error('Ошибка создания команды:', error);
    res.status(500).json({ error: 'Ошибка: ' + error.message });
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
// Получить активные события
app.get('/api/events/active', (req, res) => {
  try {
    const events = db.prepare(`
      SELECT * FROM events 
      WHERE status = 'active' 
      AND registration_end >= date('now')
      ORDER BY registration_start
    `).all();
    
    res.json(events);
  } catch (error) {
    console.error('Ошибка загрузки событий:', error);
    res.status(500).json({ error: 'Ошибка загрузки событий' });
  }
});

app.get('/api/events', (req, res) => {
  const events = db.prepare('SELECT * FROM events ORDER BY event_start_date DESC').all();
  res.json(events);
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
  db.prepare("UPDATE events SET status = 'upcoming' WHERE status = 'active'").run();
  db.prepare("UPDATE events SET status = 'active' WHERE id = ?").run(req.params.id);
  res.json({ success: true });
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

// Внести результаты спортсменов по событию
app.post('/api/events/:eventId/results', (req, res) => {
  const { results } = req.body;
  const eventId = req.params.eventId;
  
  if (!Array.isArray(results)) {
    return res.status(400).json({ error: 'results должен быть массивом' });
  }
  
  // INSERT OR REPLACE автоматически обновляет если есть, или создает если нет
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO event_results 
    (event_id, player_id, individual_short, individual_long, tie_short, tie_long, group_short, group_long) 
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  
  const transaction = db.transaction((results) => {
    for (const r of results) {
      // Сохраняем только если есть хоть какие-то очки
      if (r.individual_short || r.individual_long || r.tie_short || r.tie_long || r.group_short || r.group_long) {
        stmt.run(
          eventId, 
          r.player_id, 
          r.individual_short || 0, 
          r.individual_long || 0, 
          r.tie_short || 0, 
          r.tie_long || 0, 
          r.group_short || 0, 
          r.group_long || 0
        );
      }
    }
  });
  
  transaction(results);
  recalculateTeamScores(eventId);
  
  res.json({ success: true });
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

app.listen(PORT, () => {
  console.log('✅ Сервер запущен: http://localhost:' + PORT);
  console.log('⚙️ Админ-панель: http://localhost:' + PORT + '/admin.html');
  console.log('👥 Сборка команды: http://localhost:' + PORT + '/');
  console.log('🏆 Рейтинги: http://localhost:' + PORT + '/rankings.html');
});