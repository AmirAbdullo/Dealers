/* One-time migration: views and updated_at on vehicles */
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

const ops = [];
if (!hasColumn('vehicles', 'views')) {
  ops.push('ALTER TABLE vehicles ADD COLUMN views INTEGER NOT NULL DEFAULT 0;');
}
if (!hasColumn('vehicles', 'updated_at')) {
  ops.push('ALTER TABLE vehicles ADD COLUMN updated_at TEXT;');
  ops.push('UPDATE vehicles SET updated_at = created_at WHERE updated_at IS NULL;');
}

if (ops.length === 0) {
  console.log('No changes needed.');
  process.exit(0);
}

try {
  ops.forEach(function (sql) {
    db.exec(sql);
  });
  console.log('Migration complete:', ops.length, 'statement(s).');
} catch (e) {
  console.error('Migration failed:', e.message);
  process.exit(1);
}
