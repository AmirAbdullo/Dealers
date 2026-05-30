'use strict';

const path = require('path');
const Database = require('better-sqlite3');

const dbPath = path.join(__dirname, '..', 'carfox.db');
const db = new Database(dbPath);

db.exec(`
  CREATE TABLE IF NOT EXISTS saved_cars (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    buyer_id INTEGER NOT NULL,
    vehicle_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(buyer_id, vehicle_id),
    FOREIGN KEY (buyer_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (vehicle_id) REFERENCES vehicles(id) ON DELETE CASCADE
  );
`);

console.log('Migration complete: saved_cars table ready.');
