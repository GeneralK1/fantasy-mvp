const jwt = require('jsonwebtoken');

// Проверка JWT токена
function authenticateUser(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ error: 'Необходима авторизация' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Недействительный токен' });
  }
}

// Проверка администратора
function requireAdmin(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ error: 'Необходима авторизация' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Проверяем, что VK ID совпадает с админским
    if (decoded.vk_id !== parseInt(process.env.ADMIN_VK_ID)) {
      return res.status(403).json({ error: 'Доступ запрещен' });
    }
    
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Недействительный токен' });
  }
}

module.exports = { authenticateUser, requireAdmin };