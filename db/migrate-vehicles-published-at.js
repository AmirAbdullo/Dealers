/* One-time migration: add published_at to vehicles */
const path = require('path');
const Database = require('better-sqlite3');

const dbPath = path.join(__dirname, '..', 'carfox.db');
const db = new Database(dbPath);

function hasColumn(table, column) {
  const rows = db.prepare('PRAGMA table_info(' + table + ');').all();
  return rows.some(function (r) {
    return r.name === column;
  });
}

if (hasColumn('vehicles', 'published_at')) {
  console.log('published_at already exists.');
  process.exit(0);
}

try {
  db.exec('ALTER TABLE vehicles ADD COLUMN published_at DATETIME;');
  console.log('Migration complete: added published_at to vehicles.');
} catch (e) {
  console.error('Migration failed:', e.message);
  process.exit(1);
}
