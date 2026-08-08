const express = require('express');
const jwt = require('jsonwebtoken');
const db = require('../database');

const router = express.Router();

// Получить текущего пользователя по VK ID (из заголовка)
router.get('/me', (req, res) => {
  const vk_id = req.headers['x-vk-user-id'];
  
  if (!vk_id) {
    return res.status(401).json({ error: 'VK ID не передан' });
  }

  const user = db.prepare('SELECT * FROM vk_users WHERE vk_id = ?').get(vk_id);
  
  if (!user) {
    return res.status(404).json({ error: 'Пользователь не найден' });
  }

  res.json(user);
});

// Регистрация/обновление пользователя (вызывается при первом входе)
router.post('/register', (req, res) => {
  const { vk_id, first_name, last_name, photo } = req.body;
  
  if (!vk_id || !first_name) {
    return res.status(400).json({ error: 'Не переданы данные пользователя' });
  }

  try {
    // Проверяем, есть ли уже пользователь
    const existingUser = db.prepare('SELECT * FROM vk_users WHERE vk_id = ?').get(vk_id);
    
    if (existingUser) {
      // Обновляем данные
      db.prepare(`
        UPDATE vk_users 
        SET first_name = ?, last_name = ?, photo = ?
        WHERE vk_id = ?
      `).run(first_name, last_name || '', photo || '', vk_id);
      
      const updatedUser = db.prepare('SELECT * FROM vk_users WHERE vk_id = ?').get(vk_id);
      return res.json(updatedUser);
    }

    // Создаём нового пользователя
    // Проверяем, является ли админом
    const isAdmin = parseInt(vk_id) === parseInt(process.env.ADMIN_VK_ID || 0);
    
    const result = db.prepare(`
      INSERT INTO vk_users (vk_id, first_name, last_name, photo, is_admin)
      VALUES (?, ?, ?, ?, ?)
    `).run(vk_id, first_name, last_name || '', photo || '', isAdmin ? 1 : 0);
    
    const newUser = db.prepare('SELECT * FROM vk_users WHERE id = ?').get(result.lastInsertRowid);
    res.json(newUser);
  } catch (error) {
    console.error('Ошибка регистрации:', error);
    res.status(500).json({ error: 'Ошибка при регистрации: ' + error.message });
  }
});

// Проверить, является ли пользователь админом
router.get('/check-admin', (req, res) => {
  const vk_id = req.headers['x-vk-user-id'];
  
  if (!vk_id) {
    return res.status(401).json({ error: 'VK ID не передан' });
  }

  const user = db.prepare('SELECT is_admin FROM vk_users WHERE vk_id = ?').get(vk_id);
  
  if (!user) {
    return res.json({ isAdmin: false });
  }

  res.json({ isAdmin: Boolean(user.is_admin) });
});

module.exports = router;