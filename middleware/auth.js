const db = require('../database');

// Middleware для проверки авторизации через VK Mini Apps
function authenticateUser(req, res, next) {
  const vk_id = req.headers['x-vk-user-id'];
  
  if (!vk_id) {
    return res.status(401).json({ error: 'Не авторизован' });
  }

  const user = db.prepare('SELECT * FROM vk_users WHERE vk_id = ?').get(vk_id);
  
  if (!user) {
    return res.status(401).json({ error: 'Пользователь не найден' });
  }

  req.user = user;
  next();
}

// Middleware для проверки админа
function requireAdmin(req, res, next) {
  const vk_id = req.headers['x-vk-user-id'];
  
  if (!vk_id) {
    return res.status(401).json({ error: 'Не авторизован' });
  }

  const user = db.prepare('SELECT * FROM vk_users WHERE vk_id = ?').get(vk_id);
  
  if (!user) {
    return res.status(401).json({ error: 'Пользователь не найден' });
  }

  if (!user.is_admin) {
    return res.status(403).json({ error: 'Доступ запрещён' });
  }

  req.user = user;
  next();
}

module.exports = { authenticateUser, requireAdmin };