const express = require('express');
const axios = require('axios');
const jwt = require('jsonwebtoken');
const db = require('../database');

const router = express.Router();

// Шаг 1: Перенаправление на авторизацию ВК
router.get('/vk', (req, res) => {
  const vkAuthUrl = `https://oauth.vk.com/authorize?client_id=${process.env.VK_APP_ID}&redirect_uri=${encodeURIComponent(process.env.VK_REDIRECT_URI)}&response_type=code&scope=email`;
  res.redirect(vkAuthUrl);
});

// Шаг 2: Callback после авторизации
router.get('/callback', async (req, res) => {
  const { code } = req.query;
  
  if (!code) {
    return res.status(400).json({ error: 'Код авторизации не получен' });
  }

  try {
    // Получаем access_token
    const tokenResponse = await axios.get('https://oauth.vk.com/access_token', {
      params: {
        client_id: process.env.VK_APP_ID,
        client_secret: process.env.VK_SECRET_KEY,
        redirect_uri: process.env.VK_REDIRECT_URI,
        code
      }
    });

    const { access_token, user_id } = tokenResponse.data;

    // Получаем данные пользователя
    const userResponse = await axios.get('https://api.vk.com/method/users.get', {
      params: {
        user_ids: user_id,
        fields: 'photo_100',
        access_token,
        v: '5.131'
      }
    });

    const vkUser = userResponse.data.response[0];

    // Сохраняем или обновляем пользователя в БД
    const existingUser = db.prepare('SELECT * FROM vk_users WHERE vk_id = ?').get(user_id);
    
    if (!existingUser) {
      db.prepare('INSERT INTO vk_users (vk_id, first_name, last_name, photo) VALUES (?, ?, ?, ?)').run(
        user_id,
        vkUser.first_name,
        vkUser.last_name,
        vkUser.photo_100
      );
    } else {
      db.prepare('UPDATE vk_users SET first_name = ?, last_name = ?, photo = ? WHERE vk_id = ?').run(
        vkUser.first_name,
        vkUser.last_name,
        vkUser.photo_100,
        user_id
      );
    }

    // Создаем JWT токен
    const token = jwt.sign(
      { 
        vk_id: user_id, 
        first_name: vkUser.first_name, 
        last_name: vkUser.last_name,
        photo: vkUser.photo_100,
        isAdmin: isAdmin
  },
  process.env.JWT_SECRET,
  { expiresIn: '30d' }
);

res.send(`
    <!DOCTYPE html>
  <html>
  <head><title>Авторизация...</title></head>
  <body>
    <script>
      localStorage.setItem('vk_token', '${token}');
      window.location.href = '/';
    </script>
    <p>Авторизация успешна. Перенаправление...</p>
  </body>
  </html>
`);

    // Отправляем токен клиенту
    res.redirect(`/?token=${token}`);
  } catch (error) {
    console.error('Ошибка авторизации:', error);
    res.status(500).json({ error: 'Ошибка авторизации' });
  }
});

// Проверка токена
router.get('/me', (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ error: 'Не авторизован' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    res.json(decoded);
  } catch (error) {
    res.status(401).json({ error: 'Недействительный токен' });
  }
});

module.exports = router;