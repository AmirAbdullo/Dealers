/* One-time migration: extend vehicles with additional detail columns */
const path = require('path');
const Database = require('better-sqlite3');

const dbPath = path.join(__dirname, '..', 'carfox.db');
const db = new Database(dbPath);

function hasColumn(table, column) {
  const rows = db.prepare(`PRAGMA table_info(${table});`).all();
  return rows.some((r) => r.name === column);
}

const ops = [];
if (!hasColumn('vehicles', 'trim')) ops.push("ALTER TABLE vehicles ADD COLUMN trim TEXT;");
if (!hasColumn('vehicles', 'body_type')) ops.push("ALTER TABLE vehicles ADD COLUMN body_type TEXT;");
if (!hasColumn('vehicles', 'transmission')) ops.push("ALTER TABLE vehicles ADD COLUMN transmission TEXT;");
if (!hasColumn('vehicles', 'fuel_type')) ops.push("ALTER TABLE vehicles ADD COLUMN fuel_type TEXT;");
if (!hasColumn('vehicles', 'exterior_color')) ops.push("ALTER TABLE vehicles ADD COLUMN exterior_color TEXT;");
if (!hasColumn('vehicles', 'interior_color')) ops.push("ALTER TABLE vehicles ADD COLUMN interior_color TEXT;");
if (!hasColumn('vehicles', 'description')) ops.push("ALTER TABLE vehicles ADD COLUMN description TEXT;");

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

