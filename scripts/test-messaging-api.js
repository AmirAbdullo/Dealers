'use strict';

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const Database = require('better-sqlite3');

function resetMessagingForBuyer(buyerId) {
  const db = new Database('carfox.db');
  const convIds = db
    .prepare('SELECT id FROM conversations WHERE buyer_id = ?')
    .all(buyerId)
    .map((r) => r.id);
  if (convIds.length) {
    const placeholders = convIds.map(() => '?').join(',');
    db.prepare(
      `DELETE FROM message_attachments WHERE message_id IN (
        SELECT id FROM messages WHERE conversation_id IN (${placeholders})
      )`
    ).run(...convIds);
    db.prepare(
      `DELETE FROM messages WHERE conversation_id IN (${placeholders})`
    ).run(...convIds);
    db.prepare(
      `DELETE FROM conversations WHERE id IN (${placeholders})`
    ).run(...convIds);
  }
  db.close();
}

async function req(method, path, { token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body != null ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, body: json };
}

function curl(method, path, body, token) {
  let line = `curl.exe -s -X ${method} ${BASE}${path} -H "Content-Type: application/json"`;
  if (token) line += ` -H "Authorization: Bearer ${token}"`;
  if (body != null) {
    line += ` -d '${JSON.stringify(body).replace(/'/g, "'\\''")}'`;
  }
  return line;
}

function log(step, method, path, body, token, result) {
  console.log('\n' + '='.repeat(72));
  console.log(step);
  console.log('='.repeat(72));
  console.log('CURL:');
  console.log(curl(method, path, body, token));
  console.log('\nStatus:', result.status);
  console.log('Response:');
  console.log(JSON.stringify(result.body, null, 2));
}

async function main() {
  let r = await req('POST', '/api/login', {
    body: { email: 'buyer@test.com', password: 'password123' }
  });
  if (r.status !== 200) {
    await req('POST', '/api/auth/buyer-signup', {
      body: {
        email: 'buyer@test.com',
        password: 'password123',
        full_name: 'Test Buyer'
      }
    });
    r = await req('POST', '/api/login', {
      body: { email: 'buyer@test.com', password: 'password123' }
    });
  }
  const buyerId = r.body.user.id;
  resetMessagingForBuyer(buyerId);
  console.log('(Reset messaging data for buyer id ' + buyerId + ')');

  log(
    '1 — Buyer login',
    'POST',
    '/api/login',
    { email: 'buyer@test.com', password: 'password123' },
    null,
    r
  );
  const BUYER_TOKEN = r.body.token;

  r = await req('POST', '/api/login', {
    body: { email: 'dealer@example.com', password: 'supersecure' }
  });
  log(
    '2 — Dealer login',
    'POST',
    '/api/login',
    { email: 'dealer@example.com', password: 'supersecure' },
    null,
    r
  );
  const DEALER_TOKEN = r.body.token;

  const vehicleId = 2;
  console.log('\n(dealership_id=1, active vehicle_id=' + vehicleId + ' — Toyota Camry)');

  r = await req('POST', '/api/conversations', {
    token: BUYER_TOKEN,
    body: { dealership_id: 1, vehicle_id: vehicleId }
  });
  log(
    '3 — Buyer starts car conversation',
    'POST',
    '/api/conversations',
    { dealership_id: 1, vehicle_id: vehicleId },
    BUYER_TOKEN,
    r
  );
  const convCarId = r.body.id;

  r = await req('POST', '/api/conversations', {
    token: BUYER_TOKEN,
    body: { dealership_id: 1, vehicle_id: vehicleId }
  });
  log(
    '4 — Idempotent (same dealership + vehicle)',
    'POST',
    '/api/conversations',
    { dealership_id: 1, vehicle_id: vehicleId },
    BUYER_TOKEN,
    r
  );

  r = await req('POST', '/api/conversations', {
    token: BUYER_TOKEN,
    body: { dealership_id: 1, vehicle_id: null }
  });
  log(
    '5 — General conversation (vehicle_id null)',
    'POST',
    '/api/conversations',
    { dealership_id: 1, vehicle_id: null },
    BUYER_TOKEN,
    r
  );
  const convGeneralId = r.body.id;

  r = await req('POST', `/api/conversations/${convCarId}/messages`, {
    token: BUYER_TOKEN,
    body: { body: 'Hi! Is this car still available?' }
  });
  log(
    '6 — Buyer sends message',
    'POST',
    `/api/conversations/${convCarId}/messages`,
    { body: 'Hi! Is this car still available?' },
    BUYER_TOKEN,
    r
  );

  r = await req('GET', '/api/conversations?limit=20&offset=0', { token: DEALER_TOKEN });
  log('7 — Dealer lists conversations', 'GET', '/api/conversations?limit=20&offset=0', null, DEALER_TOKEN, r);

  r = await req('GET', `/api/conversations/${convCarId}/messages?limit=50`, {
    token: DEALER_TOKEN
  });
  log(
    '8 — Dealer reads messages',
    'GET',
    `/api/conversations/${convCarId}/messages?limit=50`,
    null,
    DEALER_TOKEN,
    r
  );

  r = await req('GET', '/api/conversations?limit=20&offset=0', { token: DEALER_TOKEN });
  log(
    '8b — Dealer list after read (unread should be 0 on car conv)',
    'GET',
    '/api/conversations?limit=20&offset=0',
    null,
    DEALER_TOKEN,
    r
  );

  r = await req('POST', `/api/conversations/${convCarId}/messages`, {
    token: DEALER_TOKEN,
    body: { body: 'Yes! Still available, when can you come see it?' }
  });
  log(
    '9 — Dealer replies',
    'POST',
    `/api/conversations/${convCarId}/messages`,
    { body: 'Yes! Still available, when can you come see it?' },
    DEALER_TOKEN,
    r
  );

  r = await req('GET', '/api/conversations/unread-count', { token: BUYER_TOKEN });
  log(
    '10 — Buyer unread count',
    'GET',
    '/api/conversations/unread-count',
    null,
    BUYER_TOKEN,
    r
  );

  await req('POST', '/api/auth/buyer-signup', {
    body: {
      email: 'otherbuyer@test.com',
      password: 'password123',
      full_name: 'Other Buyer'
    }
  });
  const otherLogin = await req('POST', '/api/login', {
    body: { email: 'otherbuyer@test.com', password: 'password123' }
  });
  r = await req('GET', `/api/conversations/${convCarId}/messages`, {
    token: otherLogin.body.token
  });
  log(
    '11 — Other buyer forbidden',
    'GET',
    `/api/conversations/${convCarId}/messages`,
    null,
    otherLogin.body.token,
    r
  );

  console.log('\n' + '='.repeat(72));
  console.log('CHECKS');
  console.log('='.repeat(72));
  console.log('car conversation id:', convCarId, '| general:', convGeneralId, '| different:', convCarId !== convGeneralId);
}

main().catch(function (e) {
  console.error(e);
  process.exit(1);
});
