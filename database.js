const Database = require('better-sqlite3');
const fs = require('fs');

if (!fs.existsSync('./data')) {
  fs.mkdirSync('./data', { recursive: true });
}

const db = new Database('./data/fantasy.db');

db.exec(`CREATE TABLE IF NOT EXISTS vk_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vk_id INTEGER UNIQUE NOT NULL,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  photo TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  is_admin INTEGER DEFAULT 0
)`);

db.exec(`CREATE TABLE IF NOT EXISTS teams (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vk_id INTEGER NOT NULL,
  event_id INTEGER,
  user_name TEXT NOT NULL,
  is_confirmed INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (vk_id) REFERENCES vk_users(vk_id),
  FOREIGN KEY (event_id) REFERENCES events(id)
)`);

db.exec(`CREATE TABLE IF NOT EXISTS players (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  full_name TEXT NOT NULL,
  birth_year INTEGER NOT NULL,
  team TEXT NOT NULL,
  rank TEXT,
  gender TEXT NOT NULL
)`);

db.exec(`CREATE TABLE IF NOT EXISTS team_players (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  team_id INTEGER NOT NULL,
  player_id INTEGER NOT NULL
)`);

db.exec(`CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  event_start_date TEXT NOT NULL,
  event_end_date TEXT NOT NULL,
  registration_start TEXT NOT NULL,
  registration_end TEXT NOT NULL,
  status TEXT DEFAULT 'upcoming',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)`);

db.exec(`CREATE TABLE IF NOT EXISTS event_teams (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL,
  team_id INTEGER NOT NULL,
  total_points INTEGER DEFAULT 0,
  UNIQUE(event_id, team_id)
)`);

db.exec(`CREATE TABLE IF NOT EXISTS event_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL,
  player_id INTEGER NOT NULL,
  individual_short INTEGER DEFAULT 0,
  individual_long INTEGER DEFAULT 0,
  tie_short INTEGER DEFAULT 0,
  tie_long INTEGER DEFAULT 0,
  group_short INTEGER DEFAULT 0,
  group_long INTEGER DEFAULT 0,
  UNIQUE(event_id, player_id)
)`);

module.exports = db;