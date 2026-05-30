/* Migration: add governorate column to dealerships, copy city values into it */
'use strict';

const path = require('path');
const Database = require('better-sqlite3');

const dbPath = path.join(__dirname, '..', 'carfox.db');
const db = new Database(dbPath);

function hasColumn(table, column) {
  const rows = db.prepare(`PRAGMA table_info(${table});`).all();
  return rows.some(function (r) { return r.name === column; });
}

const ops = [];

if (!hasColumn('dealerships', 'governorate')) {
  ops.push('ALTER TABLE dealerships ADD COLUMN governorate TEXT;');
  ops.push("UPDATE dealerships SET governorate = city WHERE governorate IS NULL OR governorate = '';");
}

if (ops.length === 0) {
  console.log('No changes needed — governorate column already exists.');
  process.exit(0);
}

const tx = db.transaction(function () {
  for (const sql of ops) db.exec(sql);
});

try {
  tx();
  console.log('Migration complete: added governorate column and copied city values.');
} catch (e) {
  console.error('Migration failed:', e.message);
  process.exit(1);
}
