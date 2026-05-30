/* One-time migration: add buyer role + phone, google_id, auth_provider */
const path = require('path');
const Database = require('better-sqlite3');

const dbPath = path.join(__dirname, '..', 'carfox.db');
const db = new Database(dbPath);

function tableSql(name) {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);
  return row && row.sql ? row.sql : '';
}

const usersSql = tableSql('users');
if (usersSql.indexOf("'buyer'") !== -1 && usersSql.indexOf('auth_provider') !== -1) {
  console.log('users table already supports buyer role and auth columns.');
  process.exit(0);
}

const cols = db.prepare('PRAGMA table_info(users)').all();
const colNames = cols.map(function (c) {
  return c.name;
});

db.pragma('foreign_keys = OFF');

db.exec(`
  CREATE TABLE users_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    full_name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'dealer' CHECK (role IN ('dealer', 'admin', 'buyer')),
    email_verified INTEGER NOT NULL DEFAULT 0,
    phone TEXT,
    google_id TEXT UNIQUE,
    auth_provider TEXT NOT NULL DEFAULT 'email',
    created_at TEXT NOT NULL
  );
`);

const selectCols = colNames
  .concat(['phone', 'google_id', 'auth_provider'])
  .filter(function (name, idx, arr) {
    return arr.indexOf(name) === idx;
  });

const insertFrom = colNames.map(function (name) {
  if (name === 'phone' || name === 'google_id') return 'NULL';
  return name;
});

const newOnly = ['phone', 'google_id', 'auth_provider'].filter(function (n) {
  return colNames.indexOf(n) === -1;
});

const allInsertCols = colNames.concat(newOnly);
const allSelectParts = colNames
  .map(function (name) {
    return name;
  })
  .concat(
    newOnly.map(function (n) {
      if (n === 'auth_provider') return "'email'";
      return 'NULL';
    })
  );

db.exec(
  'INSERT INTO users_new (' +
    allInsertCols.join(', ') +
    ') SELECT ' +
    allSelectParts.join(', ') +
    ' FROM users'
);

db.exec('DROP TABLE users');
db.exec('ALTER TABLE users_new RENAME TO users');

db.pragma('foreign_keys = ON');

console.log('Migration complete: users.role now allows buyer; phone, google_id, auth_provider added.');
