'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const Database = require('better-sqlite3');

const BASE = process.env.TEST_BASE || 'http://localhost:3000';

async function login() {
  const r = await fetch(BASE + '/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'dealer@example.com', password: 'supersecure' }),
  });
  const body = await r.json();
  if (!r.ok) throw new Error('Login failed: ' + JSON.stringify(body));
  return body.token;
}

async function main() {
  const r2Ok = Boolean(
    process.env.R2_ENDPOINT &&
      process.env.R2_ACCESS_KEY_ID &&
      process.env.R2_SECRET_ACCESS_KEY
  );
  console.log('R2 credentials configured:', r2Ok);
  if (!r2Ok) {
    console.log('SKIP upload test — fill in .env R2_* values first.');
    process.exit(0);
  }

  const token = await login();
  console.log('Logged in as dealer@example.com');

  const vehicleRes = await fetch(BASE + '/api/vehicles', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + token,
    },
    body: JSON.stringify({
      vin: '',
      year: 2022,
      make: 'Toyota',
      model: 'Camry',
      mileage: 50000,
      price: 1500000,
      status: 'active',
    }),
  });
  const vehicleBody = await vehicleRes.json();
  if (vehicleRes.status !== 201) {
    throw new Error('Create vehicle failed: ' + JSON.stringify(vehicleBody));
  }
  const vehicleId = vehicleBody.vehicle.id;
  console.log('Created vehicle id:', vehicleId);

  const jpeg = await sharp({
    create: { width: 400, height: 300, channels: 3, background: { r: 30, g: 120, b: 200 } },
  })
    .jpeg({ quality: 82 })
    .toBuffer();

  const photoIds = [];
  for (let i = 0; i < 3; i++) {
    const form = new FormData();
    form.append('photo', new Blob([jpeg], { type: 'image/jpeg' }), 'test-' + i + '.jpg');
    const up = await fetch(BASE + '/api/vehicles/' + vehicleId + '/photos', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token },
      body: form,
    });
    const upBody = await up.json();
    if (up.status !== 201) {
      throw new Error('Upload ' + i + ' failed: ' + up.status + ' ' + JSON.stringify(upBody));
    }
    photoIds.push(upBody.photo.id);
    console.log('Uploaded photo', upBody.photo.id, upBody.photo.url);
  }

  const delId = photoIds[1];
  const del = await fetch(BASE + '/api/vehicles/' + vehicleId + '/photos/' + delId, {
    method: 'DELETE',
    headers: { Authorization: 'Bearer ' + token },
  });
  console.log('Delete photo', delId, 'status:', del.status);

  const db = new Database(path.join(__dirname, '..', 'carfox.db'));
  const rows = db
    .prepare('SELECT * FROM vehicle_photos WHERE vehicle_id = ? ORDER BY display_order')
    .all(vehicleId);
  console.log('DB vehicle_photos:', JSON.stringify(rows, null, 2));
  db.close();

  if (rows.length !== 2) {
    throw new Error('Expected 2 photos in DB after delete');
  }
  console.log('All photo API tests passed.');
}

main().catch(function (e) {
  console.error(e);
  process.exit(1);
});
