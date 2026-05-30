/* List all SQLite tables in carfox.db without modifying data */
const path = require('path');
const Database = require('better-sqlite3');

const dbPath = path.join(__dirname, '..', 'carfox.db');
const db = new Database(dbPath, { readonly: true });

// Ensure foreign keys reported as enabled (not strictly required for listing)
try { db.pragma('foreign_keys = ON'); } catch (_) {}

const rows = db
  .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name;")
  .all();

const tableNames = rows.map((r) => r.name);
console.log('Tables found:');
for (const name of tableNames) {
  console.log(name);
}

