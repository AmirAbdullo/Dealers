/* One-time migration: add role and email_verified columns to users */
const path = require('path');
const Database = require('better-sqlite3');

const dbPath = path.join(__dirname, '..', 'carfox.db');
const db = new Database(dbPath);

function hasColumn(table, column) {
  const rows = db.prepare(`PRAGMA table_info(${table});`).all();
  return rows.some((r) => r.name === column);
}

const toAdd = [];
if (!hasColumn('users', 'role')) {
  toAdd.push({
    sql:
      "ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'dealer' CHECK (role IN ('dealer','admin'));",
    name: 'role',
  });
}
if (!hasColumn('users', 'email_verified')) {
  toAdd.push({
    sql:
      'ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0;',
    name: 'email_verified',
  });
}

if (toAdd.length === 0) {
  console.log('No changes needed. Columns already present.');
  process.exit(0);
}

const tx = db.transaction((ops) => {
  for (const op of ops) {
    db.exec(op.sql);
  }
});

try {
  tx(toAdd);
  console.log(
    'Migration complete. Added columns:',
    toAdd.map((c) => c.name).join(', ')
  );
} catch (err) {
  console.error('Migration failed:', err.message);
  process.exit(1);
}

