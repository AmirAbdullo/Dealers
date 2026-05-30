const Database = require('better-sqlite3');

const db = new Database(require('path').join(__dirname, '..', 'carfox.db'));

function list() {
  const users = db.prepare('SELECT id,email,full_name,role FROM users ORDER BY id').all();
  const dealerships = db.prepare('SELECT id,user_id,business_name,status FROM dealerships ORDER BY id').all();
  return { users, dealerships };
}

function main() {
  const before = list();
  console.log('USERS_BEFORE=', JSON.stringify(before.users, null, 2));
  console.log('DEALERSHIPS_BEFORE=', JSON.stringify(before.dealerships, null, 2));

  const toDelete = db
    .prepare(
      "SELECT u.id,u.email FROM users u WHERE u.email NOT IN ('admin@carfox.local','dealer@example.com') AND NOT EXISTS (SELECT 1 FROM dealerships d WHERE d.user_id=u.id)"
    )
    .all();
  for (const row of toDelete) {
    db.prepare('DELETE FROM users WHERE id = ?').run(row.id);
  }

  // Clear sessions-like tables if they exist
  const sessionTables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%session%'")
    .all();
  for (const t of sessionTables) {
    try {
      db.exec('DELETE FROM ' + t.name);
    } catch (_) {}
  }

  const after = list();
  console.log('DELETED=', JSON.stringify(toDelete, null, 2));
  console.log('SESSIONS_TABLES=', JSON.stringify(sessionTables, null, 2));
  console.log('USERS_AFTER=', JSON.stringify(after.users, null, 2));
  console.log('DEALERSHIPS_AFTER=', JSON.stringify(after.dealerships, null, 2));
}

main();

