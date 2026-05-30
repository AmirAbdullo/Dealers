require('dotenv').config();
const jwt = require('jsonwebtoken');
const Database = require('better-sqlite3');

const db = new Database('carfox.db');
const user = db
  .prepare("SELECT id, email, role FROM users WHERE role = 'dealer' LIMIT 1")
  .get();
if (!user) {
  console.error('No dealer user in database');
  process.exit(1);
}

const secret = process.env.JWT_SECRET || 'carfox-dev-secret-change-me';
const token = jwt.sign({ sub: user.id }, secret, { expiresIn: '1h' });

async function main() {
  const res = await fetch('http://localhost:3000/api/dealer/profile', {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + token
    },
    body: JSON.stringify({
      phone: '+201000000001',
      whatsapp: '+201000000002',
      address: 'Test address',
      governorate: 'Cairo'
    })
  });
  const text = await res.text();
  console.log('status', res.status);
  console.log('body', text);
}

main().catch(function (err) {
  console.error(err);
  process.exit(1);
});
