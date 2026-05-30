/* One-time migration: add approval/rejection columns to dealerships */
const path = require('path');
const Database = require('better-sqlite3');

const dbPath = path.join(__dirname, '..', 'carfox.db');
const db = new Database(dbPath);

function hasColumn(table, column) {
  const rows = db.prepare(`PRAGMA table_info(${table});`).all();
  return rows.some((r) => r.name === column);
}

const ops = [];
if (!hasColumn('dealerships', 'approved_at')) {
  ops.push("ALTER TABLE dealerships ADD COLUMN approved_at TEXT;");
}
if (!hasColumn('dealerships', 'approved_by')) {
  ops.push("ALTER TABLE dealerships ADD COLUMN approved_by INTEGER;");
}
if (!hasColumn('dealerships', 'rejection_reason')) {
  ops.push("ALTER TABLE dealerships ADD COLUMN rejection_reason TEXT;");
}

if (ops.length === 0) {
  console.log('No changes needed.');
  process.exit(0);
}

const tx = db.transaction(() => {
  for (const sql of ops) db.exec(sql);
});

try {
  tx();
  console.log('Migration complete. Added columns:', ops.length);
} catch (e) {
  console.error('Migration failed:', e.message);
  process.exit(1);
}

