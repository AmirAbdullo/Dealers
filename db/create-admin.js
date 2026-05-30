/* One-time script: create an admin user if not exists */
const path = require('path');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');

const dbPath = path.join(__dirname, '..', 'carfox.db');
const db = new Database(dbPath);

const email = 'admin@carfox.local';
const password = 'admin123';
const now = new Date().toISOString();

const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
if (existing) {
  console.log('Admin already exists with email:', email);
  process.exit(0);
}

const hash = bcrypt.hashSync(password, 10);

// Ensure columns exist (role/email_verified) in case db was created earlier
function hasColumn(table, column) {
  const rows = db.prepare(`PRAGMA table_info(${table});`).all();
  return rows.some((r) => r.name === column);
}
if (!hasColumn('users', 'role')) {
  db.exec("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'dealer' CHECK (role IN ('dealer','admin'));");
}
if (!hasColumn('users', 'email_verified')) {
  db.exec('ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0;');
}

db.prepare(
  "INSERT INTO users (email, password_hash, full_name, role, email_verified, created_at) VALUES (?, ?, 'Administrator', 'admin', 1, ?)"
).run(email, hash, now);

const created = db.prepare('SELECT id, email, role, created_at FROM users WHERE email = ?').get(email);
console.log('Admin created:', created);

