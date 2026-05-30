/* One-time migration: add 'archived' (and 'paused') to vehicles.status CHECK */
const path = require('path');
const Database = require('better-sqlite3');

const dbPath = path.join(__dirname, '..', 'carfox.db');
const db = new Database(dbPath);

function tableSql(name) {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);
  return row && row.sql ? row.sql : '';
}

const vehiclesSql = tableSql('vehicles');
if (vehiclesSql.indexOf("'archived'") !== -1) {
  console.log('vehicles.status already includes archived.');
  process.exit(0);
}

const cols = db.prepare('PRAGMA table_info(vehicles)').all();
const colNames = cols.map(function (c) {
  return c.name;
});

db.pragma('foreign_keys = OFF');

db.exec(`
  CREATE TABLE vehicles_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    dealership_id INTEGER NOT NULL,
    vin TEXT NOT NULL,
    year INTEGER NOT NULL,
    make TEXT NOT NULL,
    model TEXT NOT NULL,
    trim TEXT,
    mileage INTEGER NOT NULL,
    price REAL NOT NULL,
    body_type TEXT,
    transmission TEXT,
    fuel_type TEXT,
    exterior_color TEXT,
    interior_color TEXT,
    description TEXT,
    status TEXT NOT NULL CHECK (status IN ('draft', 'active', 'sold', 'paused', 'archived')),
    views INTEGER NOT NULL DEFAULT 0,
    published_at DATETIME,
    updated_at TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (dealership_id) REFERENCES dealerships(id) ON DELETE CASCADE
  );
`);

const insertCols = colNames.join(', ');
db.exec('INSERT INTO vehicles_new (' + insertCols + ') SELECT ' + insertCols + ' FROM vehicles');

db.exec('DROP TABLE vehicles');
db.exec('ALTER TABLE vehicles_new RENAME TO vehicles');

db.pragma('foreign_keys = ON');

console.log('Migration complete: vehicles.status now allows archived.');
