'use strict';

require('dotenv').config();

const path = require('path');
const http = require('http');
const express = require('express');
const fs = require('fs');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const multer = require('multer');
const sharp = require('sharp');
const { WebSocketServer } = require('ws');
const { PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { r2, bucket: r2Bucket, publicUrl: r2PublicUrl } = require('./lib/r2');

const photoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: function (req, file, cb) {
    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    if (allowed.includes(file.mimetype)) {
      return cb(null, true);
    }
    return cb(new Error('Only JPEG, PNG, and WebP images are allowed'));
  },
});

const PORT = Number(process.env.PORT) || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'carfox-dev-secret-change-me';
const dbPath = path.join(__dirname, 'carfox.db');

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '100kb' }));

const db = new Database(dbPath);
const requireAdmin = require('./middleware/requireAdmin')(db, JWT_SECRET);
const requireDealer = require('./middleware/requireDealer')(db, JWT_SECRET);
const requireBuyer = require('./middleware/requireBuyer')(db, JWT_SECRET);
const requireMessagingAuth = require('./middleware/requireMessagingAuth')(db, JWT_SECRET);
const createConversationsLib = require('./lib/conversations');
const conversationsLib = createConversationsLib(db);
db.pragma('journal_mode = WAL');
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    full_name TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
`);

// Initialize database schema from file and enforce foreign keys
try {
  db.pragma('foreign_keys = ON');
  const schemaPath = path.join(__dirname, 'db', 'schema.sql');
  if (fs.existsSync(schemaPath)) {
    const schemaSql = fs.readFileSync(schemaPath, 'utf8');
    if (schemaSql && schemaSql.trim().length > 0) {
      db.exec(schemaSql);
    }
  }
  console.log('Database initialized');
} catch (err) {
  console.error('Database initialization failed:', err);
}

function hasDbColumn(table, column) {
  const rows = db.prepare('PRAGMA table_info(' + table + ');').all();
  return rows.some(function (r) {
    return r.name === column;
  });
}
if (!hasDbColumn('vehicles', 'published_at')) {
  db.exec('ALTER TABLE vehicles ADD COLUMN published_at DATETIME;');
}
if (!hasDbColumn('vehicles', 'views')) {
  db.exec('ALTER TABLE vehicles ADD COLUMN views INTEGER NOT NULL DEFAULT 0;');
}
if (!hasDbColumn('vehicles', 'updated_at')) {
  db.exec('ALTER TABLE vehicles ADD COLUMN updated_at TEXT;');
  db.exec('UPDATE vehicles SET updated_at = created_at WHERE updated_at IS NULL;');
}
if (!hasDbColumn('users', 'avatar_url')) {
  db.exec('ALTER TABLE users ADD COLUMN avatar_url TEXT;');
}
if (!hasDbColumn('dealerships', 'governorate')) {
  db.exec('ALTER TABLE dealerships ADD COLUMN governorate TEXT;');
  db.exec("UPDATE dealerships SET governorate = city WHERE governorate IS NULL OR governorate = '';");
}
if (!hasDbColumn('dealerships', 'whatsapp')) {
  db.exec('ALTER TABLE dealerships ADD COLUMN whatsapp TEXT;');
}

function touchVehicleUpdatedAt(vehicleId) {
  db.prepare('UPDATE vehicles SET updated_at = ? WHERE id = ?').run(new Date().toISOString(), vehicleId);
}

function vehiclesStatusAllowsArchived() {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'vehicles'").get();
  return row && row.sql && row.sql.indexOf("'archived'") !== -1;
}

function ensureVehiclesArchivedStatus() {
  if (vehiclesStatusAllowsArchived()) return;
  const cols = db.prepare('PRAGMA table_info(vehicles)').all();
  const colNames = cols.map(function (c) {
    return c.name;
  });
  const insertCols = colNames.join(', ');
  db.pragma('foreign_keys = OFF');
  db.exec('DROP TABLE IF EXISTS vehicles_new');
  db.exec(`
    CREATE TABLE IF NOT EXISTS vehicles_new (
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
  db.exec(
    'INSERT INTO vehicles_new (' + insertCols + ') SELECT ' + insertCols + ' FROM vehicles'
  );
  db.exec('DROP TABLE vehicles');
  db.exec('ALTER TABLE vehicles_new RENAME TO vehicles');
  db.pragma('foreign_keys = ON');
  console.log('Migrated vehicles.status to allow archived');
}

ensureVehiclesArchivedStatus();

function usersTableSupportsBuyer() {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'users'").get();
  return row && row.sql && row.sql.indexOf("'buyer'") !== -1 && row.sql.indexOf('auth_provider') !== -1;
}

function ensureUsersBuyerRole() {
  if (usersTableSupportsBuyer()) return;
  const cols = db.prepare('PRAGMA table_info(users)').all();
  const colNames = cols.map(function (c) {
    return c.name;
  });
  const newOnly = ['phone', 'google_id', 'auth_provider'].filter(function (n) {
    return colNames.indexOf(n) === -1;
  });
  const allInsertCols = colNames.concat(newOnly);
  const allSelectParts = colNames
    .map(function (name) {
      return name;
    })
    .concat(
      newOnly.map(function (n) {
        if (n === 'auth_provider') return "'email'";
        return 'NULL';
      })
    );

  db.pragma('foreign_keys = OFF');
  db.exec('DROP TABLE IF EXISTS users_new');
  db.exec(`
    CREATE TABLE IF NOT EXISTS users_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      full_name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'dealer' CHECK (role IN ('dealer', 'admin', 'buyer')),
      email_verified INTEGER NOT NULL DEFAULT 0,
      phone TEXT,
      google_id TEXT UNIQUE,
      auth_provider TEXT NOT NULL DEFAULT 'email',
      created_at TEXT NOT NULL
    );
  `);
  db.exec(
    'INSERT INTO users_new (' +
      allInsertCols.join(', ') +
      ') SELECT ' +
      allSelectParts.join(', ') +
      ' FROM users'
  );
  db.exec('DROP TABLE users');
  db.exec('ALTER TABLE users_new RENAME TO users');
  db.pragma('foreign_keys = ON');
  console.log('Migrated users table for buyer role and auth columns');
}

ensureUsersBuyerRole();

function ensureMessagingTables() {
  try {
    const { runMessagingMigration } = require('./db/migrate-add-messaging');
    const result = runMessagingMigration(db, { silent: true, quietIndexes: true });
    if (result.created.length) {
      console.log('Messaging tables created:', result.created.join(', '));
    }
  } catch (err) {
    console.error('Messaging schema ensure failed:', err);
  }
}

ensureMessagingTables();

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function signToken(userRow) {
  return jwt.sign(
    { sub: userRow.id, email: userRow.email },
    JWT_SECRET,
    { expiresIn: '30d' }
  );
}

function authMiddleware(req, res, next) {
  const header = req.headers.authorization || '';
  const parts = header.split(' ');
  if (parts[0] !== 'Bearer' || !parts[1]) {
    return res.status(401).json({ error: 'Missing token' });
  }
  try {
    req.auth = jwt.verify(parts[1], JWT_SECRET);
    return next();
  } catch (_) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

app.post('/api/signup', function (req, res) {
  var fullName = String(req.body.fullName || '').trim();
  var email = normalizeEmail(req.body.email);
  var password = req.body.password;
  var confirmPassword = req.body.confirmPassword;

  if (!fullName || !email || !password) {
    return res.status(400).json({ error: 'Please fill all fields.' });
  }
  if (String(password).length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters.' });
  }
  if (password !== confirmPassword) {
    return res.status(400).json({ error: 'Passwords do not match.' });
  }

  var hash = bcrypt.hashSync(String(password), 10);
  var createdAt = new Date().toISOString();

  try {
    db.prepare(
      'INSERT INTO users (email, password_hash, full_name, created_at) VALUES (?, ?, ?, ?)'
    ).run(email, hash, fullName, createdAt);
  } catch (err) {
    if (err && String(err.message).toUpperCase().indexOf('UNIQUE') !== -1) {
      return res.status(409).json({ error: 'An account with this email already exists.' });
    }
    console.error(err);
    return res.status(500).json({ error: 'Could not create account.' });
  }

  var row = db.prepare('SELECT id, email, full_name FROM users WHERE email = ?').get(email);
  var token = signToken(row);
  return res.status(201).json({
    token: token,
    user: { id: row.id, email: row.email, fullName: row.full_name }
  });
});

app.post('/api/login', function (req, res) {
  var email = normalizeEmail(req.body.email);
  var password = req.body.password;

  if (!email || password == null || password === '') {
    return res.status(400).json({ error: 'Please enter email and password.' });
  }

  var row = db.prepare(
    'SELECT id, email, full_name, password_hash, role FROM users WHERE email = ?'
  ).get(email);

  if (!row || !bcrypt.compareSync(String(password), row.password_hash)) {
    return res.status(401).json({ error: 'Invalid email or password.' });
  }

  // Dealers need approved dealership; buyers and admins do not
  if (row.role === 'dealer') {
    var d = db.prepare('SELECT status FROM dealerships WHERE user_id = ?').get(row.id);
    if (!d || d.status !== 'approved') {
      if (d && d.status === 'rejected') {
        return res.status(403).json({ error: 'Your application was rejected' });
      }
      return res.status(403).json({ error: 'Your application is still under review' });
    }
  }

  var token = signToken(row);
  return res.json({
    token: token,
    user: {
      id: row.id,
      email: row.email,
      full_name: row.full_name,
      fullName: row.full_name,
      role: row.role
    }
  });
});

app.post('/api/auth/buyer-signup', function (req, res) {
  const body = req.body || {};
  const email = normalizeEmail(body.email);
  const password = String(body.password || '');
  const fullName = String(body.full_name || body.fullName || '').trim();
  const phone = body.phone != null ? String(body.phone).trim() : '';

  const emailOk = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email);
  if (!emailOk) return res.status(400).json({ error: 'A valid email is required.' });
  if (!password || password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  }
  if (!fullName) return res.status(400).json({ error: 'Full name is required.' });

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) {
    return res.status(409).json({ error: 'An account with this email already exists.' });
  }

  const passwordHash = bcrypt.hashSync(password, 10);
  const createdAt = new Date().toISOString();

  try {
    db.prepare(
      `INSERT INTO users (
        email, password_hash, full_name, role, email_verified, phone, auth_provider, created_at
      ) VALUES (?, ?, ?, 'buyer', 0, ?, 'email', ?)`
    ).run(email, passwordHash, fullName, phone || null, createdAt);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Could not create account.' });
  }

  const row = db
    .prepare('SELECT id, email, full_name, role FROM users WHERE email = ?')
    .get(email);
  const token = signToken(row);
  return res.status(201).json({
    token: token,
    user: { id: row.id, email: row.email, full_name: row.full_name, role: row.role }
  });
});

app.get('/api/me', authMiddleware, function (req, res) {
  var row = db.prepare('SELECT id, email, full_name FROM users WHERE id = ?').get(req.auth.sub);
  if (!row) {
    return res.status(404).json({ error: 'User not found.' });
  }
  return res.json({ user: { id: row.id, email: row.email, fullName: row.full_name } });
});

app.patch('/api/me', authMiddleware, function (req, res) {
  var fullName = String(req.body.fullName || '').trim();
  if (!fullName) {
    return res.status(400).json({ error: 'Name is required.' });
  }
  db.prepare('UPDATE users SET full_name = ? WHERE id = ?').run(fullName, req.auth.sub);
  var row = db.prepare('SELECT id, email, full_name FROM users WHERE id = ?').get(req.auth.sub);
  return res.json({ user: { id: row.id, email: row.email, fullName: row.full_name } });
});

// Dealer signup: creates a user (dealer role) and associated dealership in a single transaction
app.post('/api/auth/dealer-signup', function (req, res) {
  // Extract and normalize inputs
  var email = normalizeEmail(req.body.email);
  var password = String(req.body.password || '');
  var firstName = String(req.body.first_name || '').trim();
  var lastName = String(req.body.last_name || '').trim();
  var fullName = String(req.body.full_name || '').trim();
  if (!fullName && (firstName || lastName)) {
    fullName = (firstName + ' ' + lastName).trim();
  }
  var businessName = String(req.body.business_name || '').trim();
  var licenseNumber = String(req.body.license_number || '').trim();
  var phone = String(req.body.phone || '').trim();
  var address = String(req.body.address || '').trim();
  var governorate = String(req.body.governorate || '').trim();

  // Basic validation
  var emailOk = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email);
  if (!emailOk) return res.status(400).json({ error: 'A valid email is required.' });
  if (!password || password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  }
  if (!fullName || !businessName || !licenseNumber || !phone || !address || !governorate) {
    return res.status(400).json({ error: 'Please fill all required fields.' });
  }

  // Prepare statements
  var insertUser = db.prepare(
    "INSERT INTO users (email, password_hash, full_name, role, email_verified, created_at) VALUES (?, ?, ?, 'dealer', 0, ?)"
  );
  var selectUser = db.prepare('SELECT id, email, full_name, role, email_verified FROM users WHERE email = ?');
  var insertDealership = db.prepare(
    "INSERT INTO dealerships (user_id, business_name, license_number, address, city, state, zip, phone, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)"
  );
  var selectDealership = db.prepare(
    'SELECT id, user_id, business_name, license_number, address, city, state, zip, phone, status, created_at FROM dealerships WHERE user_id = ?'
  );

  var createdAt = new Date().toISOString();
  var passwordHash = bcrypt.hashSync(password, 10);

  // Wrap creation in a transaction for atomicity
  var createDealerTx = db.transaction(function () {
    insertUser.run(email, passwordHash, fullName, createdAt);
    var userRow = selectUser.get(email);
    insertDealership.run(
      userRow.id,
      businessName,
      licenseNumber,
      address,
      governorate,  // stored in city column for filter compatibility
      '',           // state not used for Egypt
      '',           // zip not used
      phone,
      createdAt
    );
    var dealerRow = selectDealership.get(userRow.id);
    return { userRow: userRow, dealerRow: dealerRow };
  });

  try {
    var result = createDealerTx();
    return res.status(201).json({
      message: 'Application submitted. Pending approval.',
      user: { id: result.userRow.id, email: result.userRow.email, role: 'dealer' },
      dealership: { id: result.dealerRow.id, status: 'pending' }
    });
  } catch (err) {
    var msg = String(err && err.message || '').toUpperCase();
    if (msg.indexOf('UNIQUE') !== -1 && msg.indexOf('USERS') !== -1) {
      return res.status(409).json({ error: 'An account with this email already exists.' });
    }
    console.error(err);
    return res.status(500).json({ error: 'Could not create dealer account.' });
  }
});

// Admin: list dealer applications (pending by default)
app.get('/api/admin/applications', requireAdmin, function (req, res) {
  var status = String(req.query.status || 'pending').toLowerCase();
  var allowed = { pending: true, approved: true, rejected: true, all: true };
  if (!allowed[status]) status = 'pending';

  var baseSql = `
    SELECT
      d.id AS dealership_id,
      d.business_name,
      d.license_number,
      d.phone,
      d.address, d.city, d.state, d.zip,
      d.status,
      d.approved_at,
      d.approved_by,
      d.rejection_reason,
      d.created_at,
      u.id AS user_id,
      u.email,
      u.full_name,
      u.created_at AS user_created_at
    FROM dealerships d
    JOIN users u ON u.id = d.user_id
  `;
  var rows;
  if (status === 'all') {
    rows = db.prepare(baseSql + ' ORDER BY d.created_at DESC').all();
  } else {
    rows = db
      .prepare(baseSql + ' WHERE d.status = ? ORDER BY d.created_at DESC')
      .all(status);
  }

  var applications = rows.map(function (r) {
    return {
      dealership_id: r.dealership_id,
      business_name: r.business_name,
      license_number: r.license_number,
      phone: r.phone,
      address: r.address,
      city: r.city,
      state: r.state,
      zip: r.zip,
      status: r.status,
      created_at: r.created_at,
      user: {
        id: r.user_id,
        email: r.email,
        full_name: r.full_name
      }
    };
  });

  return res.json({ applications: applications });
});

// Admin: approve application
app.patch('/api/admin/applications/:id/approve', requireAdmin, function (req, res) {
  var id = Number(req.params.id);
  var row = db.prepare('SELECT id, status FROM dealerships WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  if (row.status !== 'pending') {
    return res.status(400).json({ error: 'Only pending applications can be approved' });
  }
  db.prepare("UPDATE dealerships SET status='approved', approved_at = ?, approved_by = ? , rejection_reason = NULL WHERE id = ?")
    .run(new Date().toISOString(), req.user.id, id);
  var updated = db.prepare('SELECT * FROM dealerships WHERE id = ?').get(id);
  return res.json({ dealership: updated });
});

// Admin: reject application
app.patch('/api/admin/applications/:id/reject', requireAdmin, function (req, res) {
  var id = Number(req.params.id);
  var body = req.body || {};
  var reason = body.reason ? String(body.reason).trim() : null;
  var row = db.prepare('SELECT id, status FROM dealerships WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  if (row.status !== 'pending') {
    return res.status(400).json({ error: 'Only pending applications can be rejected' });
  }
  db.prepare("UPDATE dealerships SET status='rejected', rejection_reason = ? WHERE id = ?").run(reason, id);
  var updated = db.prepare('SELECT * FROM dealerships WHERE id = ?').get(id);
  return res.json({ dealership: updated });
});

// Auth: current user (and dealership for dealers)
app.get('/api/auth/me', function (req, res) {
  const header = req.headers.authorization || '';
  const parts = header.split(' ');
  if (parts[0] !== 'Bearer' || !parts[1]) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  let decoded;
  try {
    decoded = jwt.verify(parts[1], JWT_SECRET);
  } catch (_) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const user = db
    .prepare('SELECT id, email, full_name, role, phone, created_at, avatar_url FROM users WHERE id = ?')
    .get(decoded.sub);
  if (!user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (user.role === 'dealer') {
    const d = db
      .prepare(
        'SELECT id, business_name, status, phone, address, city, governorate, whatsapp FROM dealerships WHERE user_id = ?'
      )
      .get(user.id);
    return res.json({
      user: {
        id: user.id,
        email: user.email,
        full_name: user.full_name,
        role: user.role,
        avatar_url: user.avatar_url || null,
        created_at: user.created_at
      },
      dealership: d
        ? {
            id: d.id,
            business_name: d.business_name,
            status: d.status,
            phone: d.phone || null,
            address: d.address || null,
            governorate: (d.governorate || d.city) || null,
            whatsapp: d.whatsapp || null
          }
        : null
    });
  }
  const payload = {
    id: user.id,
    email: user.email,
    full_name: user.full_name,
    role: user.role,
    avatar_url: user.avatar_url || null,
    created_at: user.created_at
  };
  if (user.role === 'buyer' && user.phone) payload.phone = user.phone;
  return res.json({ user: payload });
});

app.patch('/api/dealer/profile', function (req, res) {
  const header = req.headers.authorization || '';
  const parts = header.split(' ');
  if (parts[0] !== 'Bearer' || !parts[1]) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  let decoded;
  try {
    decoded = jwt.verify(parts[1], JWT_SECRET);
  } catch (_) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const dealership = db
    .prepare('SELECT id, phone, address, city, whatsapp FROM dealerships WHERE user_id = ?')
    .get(decoded.sub);
  if (!dealership) {
    return res.status(404).json({ error: 'Dealership not found' });
  }

  const body = req.body || {};
  const whatsapp = body.whatsapp != null ? String(body.whatsapp).trim() : null;
  const phone = body.phone != null ? String(body.phone).trim() : null;
  const address = body.address != null ? String(body.address).trim() : null;
  const governorate = body.governorate != null ? String(body.governorate).trim() : null;

  const updates = [];
  const params = [];
  if (whatsapp !== null) { updates.push('whatsapp = ?'); params.push(whatsapp || null); }
  if (phone !== null) { updates.push('phone = ?'); params.push(phone || null); }
  if (address !== null) { updates.push('address = ?'); params.push(address || null); }
  if (governorate !== null) { updates.push('city = ?'); params.push(governorate || null); }

  if (!updates.length) return res.status(400).json({ error: 'Nothing to update' });

  params.push(dealership.id);
  db.prepare('UPDATE dealerships SET ' + updates.join(', ') + ' WHERE id = ?').run(...params);
  const updated = db
    .prepare('SELECT business_name, phone, address, city, whatsapp FROM dealerships WHERE id = ?')
    .get(dealership.id);
  return res.json({ dealership: updated });
});

// Upload / replace profile picture
app.post('/api/user/avatar', function (req, res, next) {
  photoUpload.single('photo')(req, res, function (err) {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: 'Photo must be 10 MB or smaller' });
      }
      return res.status(400).json({ error: err.message || 'Upload error' });
    }
    next();
  });
}, async function (req, res) {
  // Verify JWT manually (works for buyer and dealer)
  const header = req.headers.authorization || '';
  const parts = header.split(' ');
  if (parts[0] !== 'Bearer' || !parts[1]) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  let decoded;
  try {
    decoded = jwt.verify(parts[1], JWT_SECRET);
  } catch (_) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const user = db.prepare('SELECT id, avatar_url FROM users WHERE id = ?').get(decoded.sub);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  if (!req.file) return res.status(400).json({ error: 'No photo provided' });

  if (!r2Configured()) {
    return res.status(503).json({ error: 'File storage not configured' });
  }

  // Delete old avatar from R2 if exists
  if (user.avatar_url) {
    const oldKey = publicUrlToKey(user.avatar_url);
    if (oldKey) {
      try {
        await r2.send(new DeleteObjectCommand({ Bucket: r2Bucket, Key: oldKey }));
      } catch (_) { /* ignore */ }
    }
  }

  // Process image: resize to 200x200 JPEG
  let jpegBuffer;
  try {
    jpegBuffer = await sharp(req.file.buffer)
      .resize(200, 200, { fit: 'cover', position: 'centre' })
      .jpeg({ quality: 85 })
      .toBuffer();
  } catch (e) {
    return res.status(400).json({ error: 'Could not process image' });
  }

  const key = 'avatars/' + user.id + '/' + Date.now() + '.jpg';
  const publicBase = String(r2PublicUrl).replace(/\/$/, '');

  try {
    await r2.send(new PutObjectCommand({
      Bucket: r2Bucket,
      Key: key,
      Body: jpegBuffer,
      ContentType: 'image/jpeg',
    }));
  } catch (e) {
    console.error('R2 PutObject failed for avatar:', e.message);
    return res.status(500).json({ error: 'Upload failed' });
  }

  const avatarUrl = publicBase + '/' + key;
  db.prepare('UPDATE users SET avatar_url = ? WHERE id = ?').run(avatarUrl, user.id);

  return res.json({ avatar_url: avatarUrl });
});

// Short admin URL -> admin panel
app.get('/admin', function (req, res) {
  return res.redirect('/admin/applications.html');
});

const { MAKES, getModelsForMake } = require('./lib/car-data');
const { applyDraftPatchFromBody, validateForPublish, currentYear } = require('./lib/vehicle-fields');

// Deprecated: NHTSA VIN decode removed (MENA market uses make/model/year)
app.get('/api/vin/:vin', function (req, res) {
  return res.status(410).json({
    error: 'VIN decode is no longer available. Use make/model/year instead.'
  });
});

app.get('/api/car-data/makes', function (req, res) {
  return res.json({ makes: MAKES });
});

app.get('/api/car-data/models', function (req, res) {
  const make = String(req.query.make || '').trim();
  if (!make) {
    return res.status(400).json({ error: 'make query parameter is required' });
  }
  return res.json({ models: getModelsForMake(make) });
});

app.get('/api/brands', function (req, res) {
  const rows = db.prepare(
    "SELECT make, COUNT(*) as count FROM vehicles WHERE status = 'active' GROUP BY make ORDER BY count DESC"
  ).all();
  return res.json({ brands: rows });
});

const PUBLIC_CARS_SORT = {
  newest: 'COALESCE(v.published_at, v.created_at) DESC',
  price_asc: 'v.price ASC',
  price_desc: 'v.price DESC',
  mileage_asc: 'v.mileage ASC'
};

const PUBLIC_CARS_TRANSMISSIONS = {
  Automatic: true,
  Manual: true,
  CVT: true,
  'Semi-Automatic': true
};

const PUBLIC_CARS_FROM_SQL = `
  FROM vehicles v
  INNER JOIN dealerships d ON d.id = v.dealership_id`;

const PUBLIC_CARS_BASE_WHERE = "v.status = 'active' AND d.status = 'approved'";

function parseCsvQueryParam(value) {
  if (value == null || String(value).trim() === '') return [];
  return String(value)
    .split(',')
    .map(function (s) {
      return s.trim();
    })
    .filter(Boolean);
}

function parseOptionalNumber(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return isNaN(n) ? null : n;
}

function swapIfInverted(minVal, maxVal) {
  if (minVal != null && maxVal != null && minVal > maxVal) {
    return { min: maxVal, max: minVal };
  }
  return { min: minVal, max: maxVal };
}

function buildPublicCarsFilter(query) {
  const whereParts = [PUBLIC_CARS_BASE_WHERE];
  const params = [];

  const makes = parseCsvQueryParam(query.make);
  const bodyTypes = parseCsvQueryParam(query.body_type);
  const cities = parseCsvQueryParam(query.city);
  const fuelTypes = parseCsvQueryParam(query.fuel_type);

  if (makes.length) {
    whereParts.push('v.make IN (' + makes.map(function () { return '?'; }).join(', ') + ')');
    params.push.apply(params, makes);
  }

  const model = String(query.model || '').trim();
  if (model && makes.length === 1) {
    whereParts.push('v.model = ?');
    params.push(model);
  }

  if (bodyTypes.length) {
    whereParts.push('v.body_type IN (' + bodyTypes.map(function () { return '?'; }).join(', ') + ')');
    params.push.apply(params, bodyTypes);
  }

  if (cities.length) {
    whereParts.push('d.city IN (' + cities.map(function () { return '?'; }).join(', ') + ')');
    params.push.apply(params, cities);
  }

  if (fuelTypes.length) {
    whereParts.push('v.fuel_type IN (' + fuelTypes.map(function () { return '?'; }).join(', ') + ')');
    params.push.apply(params, fuelTypes);
  }

  const transmission = String(query.transmission || '').trim();
  if (transmission && PUBLIC_CARS_TRANSMISSIONS[transmission]) {
    whereParts.push('v.transmission = ?');
    params.push(transmission);
  }

  let minPrice = parseOptionalNumber(query.min_price);
  let maxPrice = parseOptionalNumber(query.max_price);
  const priceBounds = swapIfInverted(minPrice, maxPrice);
  minPrice = priceBounds.min;
  maxPrice = priceBounds.max;
  if (minPrice != null) {
    whereParts.push('v.price >= ?');
    params.push(Math.round(minPrice * 100));
  }
  if (maxPrice != null) {
    whereParts.push('v.price <= ?');
    params.push(Math.round(maxPrice * 100));
  }

  let minYear = parseOptionalNumber(query.min_year);
  let maxYear = parseOptionalNumber(query.max_year);
  const yearBounds = swapIfInverted(minYear, maxYear);
  minYear = yearBounds.min;
  maxYear = yearBounds.max;
  if (minYear != null) {
    whereParts.push('v.year >= ?');
    params.push(Math.round(minYear));
  }
  if (maxYear != null) {
    whereParts.push('v.year <= ?');
    params.push(Math.round(maxYear));
  }

  const maxMileage = parseOptionalNumber(query.max_mileage);
  if (maxMileage != null) {
    whereParts.push('v.mileage <= ?');
    params.push(Math.round(maxMileage));
  }

  const q = String(query.q || '').trim();
  if (q) {
    const like = '%' + q.replace(/[%_]/g, function (ch) { return '\\' + ch; }) + '%';
    whereParts.push(
      "(v.make LIKE ? ESCAPE '\\' OR v.model LIKE ? ESCAPE '\\' OR v.trim LIKE ? ESCAPE '\\' OR v.description LIKE ? ESCAPE '\\')"
    );
    params.push(like, like, like, like);
  }

  return {
    whereSql: whereParts.join(' AND '),
    params: params
  };
}

function countPublicCars(query) {
  const filter = buildPublicCarsFilter(query);
  return db
    .prepare('SELECT COUNT(*) AS c ' + PUBLIC_CARS_FROM_SQL + ' WHERE ' + filter.whereSql)
    .get(...filter.params).c;
}

function mapPublicCarRow(row) {
  const governorate = row.dealer_governorate || row.dealer_city || null;
  return {
    id: row.id,
    year: row.year,
    make: row.make,
    model: row.model,
    trim: row.trim,
    mileage: row.mileage,
    price: row.price,
    body_type: row.body_type,
    transmission: row.transmission,
    fuel_type: row.fuel_type,
    exterior_color: row.exterior_color,
    primary_photo_url: row.primary_photo_url || null,
    governorate: governorate,
    dealer_name: row.dealer_business_name || null,
    dealer: {
      id: row.dealer_id,
      business_name: row.dealer_business_name,
      city: row.dealer_city,
      state: row.dealer_state,
      governorate: governorate
    },
    published_at: row.published_at
  };
}

function groupedFilterOptions(columnExpr, notNullExpr) {
  return db
    .prepare(
      `SELECT ${columnExpr} AS name, COUNT(*) AS count
       ${PUBLIC_CARS_FROM_SQL}
       WHERE ${PUBLIC_CARS_BASE_WHERE}
         AND ${notNullExpr}
       GROUP BY ${columnExpr}
       ORDER BY count DESC, name ASC`
    )
    .all();
}

// ---- Saved Cars ----

app.get('/api/saved-cars', requireBuyer, function (req, res) {
  const buyerId = req.user.id;
  const rows = db.prepare('SELECT vehicle_id FROM saved_cars WHERE buyer_id = ?').all(buyerId);
  return res.json({ saved: rows.map(function (r) { return r.vehicle_id; }) });
});

app.get('/api/saved-cars/listings', requireBuyer, function (req, res) {
  const buyerId = req.user.id;
  const rows = db.prepare(
    'SELECT v.id, v.year, v.make, v.model, v.trim, v.mileage, v.price, v.body_type,' +
    '       v.transmission, v.fuel_type, v.exterior_color, v.published_at,' +
    '       p.url AS primary_photo_url,' +
    '       d.id AS dealer_id, d.business_name AS dealer_business_name,' +
    '       d.city AS dealer_city, d.state AS dealer_state' +
    ' ' + PUBLIC_CARS_FROM_SQL +
    ' LEFT JOIN vehicle_photos p ON p.vehicle_id = v.id AND p.is_primary = 1' +
    ' INNER JOIN saved_cars sc ON sc.vehicle_id = v.id AND sc.buyer_id = ?' +
    ' WHERE ' + PUBLIC_CARS_BASE_WHERE +
    ' ORDER BY sc.created_at DESC'
  ).all(buyerId);
  return res.json({ cars: rows.map(mapPublicCarRow) });
});

app.post('/api/saved-cars/:vehicleId', requireBuyer, function (req, res) {
  const buyerId = req.user.id;
  const vehicleId = parseInt(req.params.vehicleId, 10);
  if (!vehicleId) return res.status(400).json({ error: 'Invalid vehicle id' });
  try {
    db.prepare('INSERT OR IGNORE INTO saved_cars (buyer_id, vehicle_id) VALUES (?, ?)').run(buyerId, vehicleId);
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: 'Could not save car' });
  }
});

app.delete('/api/saved-cars/:vehicleId', requireBuyer, function (req, res) {
  const buyerId = req.user.id;
  const vehicleId = parseInt(req.params.vehicleId, 10);
  if (!vehicleId) return res.status(400).json({ error: 'Invalid vehicle id' });
  db.prepare('DELETE FROM saved_cars WHERE buyer_id = ? AND vehicle_id = ?').run(buyerId, vehicleId);
  return res.json({ ok: true });
});

// ---- Dealer Public Profile ----
app.get('/api/dealers/:id/profile', function (req, res) {
  const dealerId = Number(req.params.id);
  if (!dealerId || !Number.isInteger(dealerId)) {
    return res.status(404).json({ error: 'Dealer not found' });
  }

  const dealer = db
    .prepare(
      `SELECT d.id, d.business_name, d.city, d.state, d.phone, d.created_at,
              COUNT(v.id) AS total_listings
       FROM dealerships d
       LEFT JOIN vehicles v ON v.dealership_id = d.id AND v.status = 'active'
       WHERE d.id = ? AND d.status = 'approved'
       GROUP BY d.id`
    )
    .get(dealerId);

  if (!dealer) {
    return res.status(404).json({ error: 'Dealer not found' });
  }

  const vehicleRows = db
    .prepare(
      `SELECT
        v.id, v.year, v.make, v.model, v.trim, v.mileage, v.price,
        v.body_type, v.transmission, v.fuel_type, v.exterior_color,
        v.published_at,
        p.url AS primary_photo_url,
        d.id AS dealer_id,
        d.business_name AS dealer_business_name,
        d.city AS dealer_city,
        d.state AS dealer_state
       FROM vehicles v
       INNER JOIN dealerships d ON d.id = v.dealership_id
       LEFT JOIN vehicle_photos p ON p.vehicle_id = v.id AND p.is_primary = 1
       WHERE v.dealership_id = ? AND v.status = 'active' AND d.status = 'approved'
       ORDER BY v.published_at DESC
       LIMIT 24`
    )
    .all(dealerId);

  const memberSince = dealer.created_at
    ? new Date(dealer.created_at).getFullYear()
    : null;

  return res.json({
    dealer: {
      id: dealer.id,
      business_name: dealer.business_name,
      city: dealer.city,
      state: dealer.state,
      phone: dealer.phone,
      total_listings: dealer.total_listings,
      member_since: memberSince
    },
    vehicles: vehicleRows.map(mapPublicCarRow)
  });
});

app.get('/api/cars/filter-options', function (req, res) {
  const makes = groupedFilterOptions('v.make', "v.make IS NOT NULL AND TRIM(v.make) != ''");
  const bodyTypes = groupedFilterOptions(
    'v.body_type',
    "v.body_type IS NOT NULL AND TRIM(v.body_type) != ''"
  );
  const cities = groupedFilterOptions('d.city', "d.city IS NOT NULL AND TRIM(d.city) != ''");
  const transmissions = groupedFilterOptions(
    'v.transmission',
    "v.transmission IS NOT NULL AND TRIM(v.transmission) != ''"
  );
  const fuelTypes = groupedFilterOptions(
    'v.fuel_type',
    "v.fuel_type IS NOT NULL AND TRIM(v.fuel_type) != ''"
  );

  const ranges = db
    .prepare(
      `SELECT
        MIN(v.year) AS min_year,
        MAX(v.year) AS max_year,
        MIN(v.price) AS min_price,
        MAX(v.price) AS max_price,
        MIN(v.mileage) AS min_mileage,
        MAX(v.mileage) AS max_mileage
       ${PUBLIC_CARS_FROM_SQL}
       WHERE ${PUBLIC_CARS_BASE_WHERE}`
    )
    .get();

  const payload = {
    makes: makes,
    body_types: bodyTypes,
    cities: cities,
    transmissions: transmissions,
    fuel_types: fuelTypes,
    year_range: {
      min: ranges.min_year != null ? ranges.min_year : new Date().getFullYear() - 15,
      max: ranges.max_year != null ? ranges.max_year : new Date().getFullYear()
    },
    price_range: {
      min: ranges.min_price != null ? ranges.min_price : 0,
      max: ranges.max_price != null ? ranges.max_price : 0
    },
    mileage_range: {
      min: ranges.min_mileage != null ? ranges.min_mileage : 0,
      max: ranges.max_mileage != null ? ranges.max_mileage : 0
    }
  };

  const makeParam = String(req.query.make || '').trim();
  if (makeParam) {
    payload.models = db
      .prepare(
        `SELECT v.model AS name, COUNT(*) AS count
         ${PUBLIC_CARS_FROM_SQL}
         WHERE ${PUBLIC_CARS_BASE_WHERE}
           AND v.make = ?
           AND v.model IS NOT NULL AND TRIM(v.model) != ''
         GROUP BY v.model
         ORDER BY count DESC, name ASC`
      )
      .all(makeParam);
  }

  return res.json(payload);
});

app.get('/api/cars/count', function (req, res) {
  const total = countPublicCars(req.query);
  return res.json({ total: total });
});

app.get('/api/cars', function (req, res) {
  let limit = Number(req.query.limit);
  if (!limit || isNaN(limit) || limit < 1) limit = 24;
  if (limit > 60) limit = 60;

  let offset = Number(req.query.offset);
  if (isNaN(offset) || offset < 0) offset = 0;

  let sortKey = String(req.query.sort || 'newest').trim().toLowerCase();
  if (!PUBLIC_CARS_SORT[sortKey]) sortKey = 'newest';
  const orderBy = PUBLIC_CARS_SORT[sortKey];

  const filter = buildPublicCarsFilter(req.query);
  const total = countPublicCars(req.query);

  const listParams = filter.params.concat([limit, offset]);
  const listRows = db
    .prepare(
      `SELECT
        v.id, v.year, v.make, v.model, v.trim, v.mileage, v.price,
        v.body_type, v.transmission, v.fuel_type, v.exterior_color,
        v.published_at,
        p.url AS primary_photo_url,
        d.id AS dealer_id,
        d.business_name AS dealer_business_name,
        d.city AS dealer_city,
        d.state AS dealer_state
      ${PUBLIC_CARS_FROM_SQL}
      LEFT JOIN vehicle_photos p ON p.vehicle_id = v.id AND p.is_primary = 1
      WHERE ${filter.whereSql}
      ORDER BY ${orderBy}
      LIMIT ? OFFSET ?`
    )
    .all(...listParams);

  return res.json({ total: total, cars: listRows.map(mapPublicCarRow) });
});

app.get('/api/vehicles', function (req, res) {
  const status = String(req.query.status || 'active').trim();
  if (status !== 'active') {
    return res.status(400).json({ error: 'Only status=active is supported' });
  }

  let limit = Number(req.query.limit);
  if (!limit || isNaN(limit) || limit < 1) limit = 6;
  if (limit > 60) limit = 60;

  const filter = buildPublicCarsFilter(req.query);
  const listParams = filter.params.concat([limit, 0]);
  const listRows = db
    .prepare(
      `SELECT
        v.id, v.year, v.make, v.model, v.trim, v.mileage, v.price,
        v.body_type, v.transmission, v.fuel_type, v.exterior_color,
        v.published_at,
        p.url AS primary_photo_url,
        d.id AS dealer_id,
        d.business_name AS dealer_business_name,
        d.city AS dealer_city,
        d.state AS dealer_state,
        d.governorate AS dealer_governorate
      ${PUBLIC_CARS_FROM_SQL}
      LEFT JOIN vehicle_photos p ON p.vehicle_id = v.id AND p.is_primary = 1
      WHERE ${filter.whereSql}
      ORDER BY ${PUBLIC_CARS_SORT.newest}
      LIMIT ? OFFSET ?`
    )
    .all(...listParams);

  return res.json({ vehicles: listRows.map(mapPublicCarRow) });
});

function mapPublicVehicleDetail(row, photoRows) {
  return {
    id: row.id,
    year: row.year,
    make: row.make,
    model: row.model,
    trim: row.trim,
    mileage: row.mileage,
    price: row.price,
    body_type: row.body_type,
    transmission: row.transmission,
    fuel_type: row.fuel_type,
    exterior_color: row.exterior_color,
    interior_color: row.interior_color,
    description: row.description,
    vin: row.vin,
    status: row.status,
    published_at: row.published_at,
    views: row.views != null ? row.views : 0,
    photos: (photoRows || []).map(function (p) {
      return {
        id: p.id,
        url: p.url,
        is_primary: p.is_primary,
        display_order: p.display_order
      };
    }),
    dealer: {
      id: row.dealer_id,
      business_name: row.dealer_business_name,
      city: row.dealer_city,
      state: row.dealer_state,
      phone: row.dealer_phone,
      whatsapp: row.dealer_whatsapp || null
    }
  };
}

app.get('/api/cars/:id', function (req, res) {
  const vehicleId = Number(req.params.id);
  if (!vehicleId || !Number.isInteger(vehicleId)) {
    return res.status(404).json({ error: 'Listing not found' });
  }

  const row = db
    .prepare(
      `SELECT
        v.id, v.year, v.make, v.model, v.trim, v.mileage, v.price,
        v.body_type, v.transmission, v.fuel_type, v.exterior_color, v.interior_color,
        v.description, v.vin, v.status, v.published_at, COALESCE(v.views, 0) AS views,
        d.id AS dealer_id, d.business_name AS dealer_business_name,
        d.city AS dealer_city, d.state AS dealer_state, d.phone AS dealer_phone,
        d.whatsapp AS dealer_whatsapp
      ${PUBLIC_CARS_FROM_SQL}
      WHERE v.id = ? AND ${PUBLIC_CARS_BASE_WHERE}`
    )
    .get(vehicleId);

  if (!row) {
    return res.status(404).json({ error: 'Listing not found' });
  }

  const photos = db
    .prepare(
      `SELECT id, url, is_primary, display_order
       FROM vehicle_photos
       WHERE vehicle_id = ?
       ORDER BY is_primary DESC, display_order ASC, id ASC`
    )
    .all(vehicleId);

  return res.json({ vehicle: mapPublicVehicleDetail(row, photos) });
});

app.post('/api/cars/:id/view', function (req, res) {
  const vehicleId = Number(req.params.id);
  if (!vehicleId || !Number.isInteger(vehicleId)) {
    return res.status(404).json({ error: 'Listing not found' });
  }

  const info = db
    .prepare(
      `UPDATE vehicles SET views = COALESCE(views, 0) + 1
       WHERE id = ? AND status = 'active'
       AND dealership_id IN (
         SELECT id FROM dealerships WHERE status = 'approved'
       )`
    )
    .run(vehicleId);

  if (!info.changes) {
    return res.status(404).json({ error: 'Listing not found' });
  }

  const views = db.prepare('SELECT COALESCE(views, 0) AS views FROM vehicles WHERE id = ?').get(vehicleId)
    .views;
  return res.json({ views: views });
});

app.post('/api/inquiries', requireBuyer, function (req, res) {
  const body = req.body || {};
  const vehicleId = Number(body.vehicle_id);
  const message = String(body.message || '').trim();

  if (!vehicleId || !Number.isInteger(vehicleId)) {
    return res.status(400).json({ error: 'vehicle_id is required' });
  }
  if (message.length < 10) {
    return res.status(400).json({ error: 'Message must be at least 10 characters' });
  }
  if (message.length > 1000) {
    return res.status(400).json({ error: 'Message must be 1000 characters or less' });
  }

  const vehicle = db
    .prepare(
      `SELECT v.id, v.dealership_id, v.status, d.status AS dealer_status
       FROM vehicles v
       INNER JOIN dealerships d ON d.id = v.dealership_id
       WHERE v.id = ?`
    )
    .get(vehicleId);

  if (!vehicle || vehicle.status !== 'active' || vehicle.dealer_status !== 'approved') {
    return res.status(404).json({ error: 'Listing not found' });
  }

  const buyerPhone =
    req.user.phone != null && String(req.user.phone).trim()
      ? String(req.user.phone).trim()
      : '';

  const createdAt = new Date().toISOString();
  const info = db
    .prepare(
      `INSERT INTO inquiries (
        vehicle_id, dealership_id, buyer_name, buyer_email, buyer_phone, message, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'new', ?)`
    )
    .run(
      vehicleId,
      vehicle.dealership_id,
      req.user.full_name,
      req.user.email,
      buyerPhone,
      message,
      createdAt
    );

  return res.status(201).json({ id: info.lastInsertRowid });
});

const MESSAGING_ATTACHMENT_TYPES = { image: true, video: true, file: true };

function messagingViewerContext(req) {
  if (req.messagingRole === 'buyer') {
    return { role: 'buyer', userId: req.user.id, dealershipId: null };
  }
  if (req.messagingRole === 'dealer') {
    return { role: 'dealer', userId: req.user.id, dealershipId: req.dealership.id };
  }
  return null;
}

// WS client registry: conversationId -> Set of {ws, userId, role, dealershipId}
const wsClients = new Map();

function wsRegister(conversationId, client) {
  if (!wsClients.has(conversationId)) wsClients.set(conversationId, new Set());
  wsClients.get(conversationId).add(client);
}

function wsUnregister(conversationId, client) {
  const set = wsClients.get(conversationId);
  if (set) { set.delete(client); if (!set.size) wsClients.delete(conversationId); }
}

function wsBroadcastMessage(conversationId, message, senderUserId) {
  const set = wsClients.get(conversationId);
  if (!set) return;
  const payload = JSON.stringify({ type: 'message', message: message });
  set.forEach(function (client) {
    if (client.ws.readyState === 1 && client.userId !== senderUserId) { // OPEN, skip sender
      try { client.ws.send(payload); } catch (e) {}
    }
  });
}

app.post(
  '/api/conversations/:id/attachments/upload',
  requireMessagingAuth,
  function (req, res, next) {
    const messagingUpload = multer({
      storage: multer.memoryStorage(),
      limits: { fileSize: 50 * 1024 * 1024 },
      fileFilter: function (req, file, cb) {
        const allowed = [
          'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif',
          'video/mp4', 'video/quicktime', 'video/webm', 'video/x-msvideo',
          'application/pdf', 'application/msword',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'application/vnd.ms-excel',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'text/plain'
        ];
        if (allowed.includes(file.mimetype)) return cb(null, true);
        return cb(new Error('File type not allowed'));
      }
    });
    messagingUpload.single('photo')(req, res, function (err) {
      if (err) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({ error: 'File must be 50 MB or smaller' });
        }
        return res.status(400).json({ error: err.message || 'Invalid file' });
      }
      return next();
    });
  },
  async function (req, res) {
    if (!r2Configured()) {
      return res.status(503).json({ error: 'File storage is not configured' });
    }
    const conversationId = Number(req.params.id);
    if (!conversationId) {
      return res.status(400).json({ error: 'Invalid conversation id' });
    }

    const conversation = conversationsLib.getConversationById(conversationId);
    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    const viewer = messagingViewerContext(req);
    if (!viewer || !conversationsLib.isParticipant(conversation, viewer)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ error: 'File is required' });
    }

    const mime = req.file.mimetype;
    const fileType = mime.startsWith('image/') ? 'image' : mime.startsWith('video/') ? 'video' : 'file';
    const originalName = req.file.originalname || 'file';
    let ext = originalName.includes('.') ? originalName.split('.').pop().toLowerCase() : 'bin';
    let fileBuffer = req.file.buffer;
    let contentType = mime;
    let sizeBytes = req.file.size;

    if (fileType === 'image') {
      try {
        fileBuffer = await sharp(req.file.buffer)
          .rotate()
          .resize({ width: 1600, withoutEnlargement: true })
          .jpeg({ quality: 82 })
          .toBuffer();
        contentType = 'image/jpeg';
        ext = 'jpg';
        sizeBytes = fileBuffer.length;
      } catch (e) {
        console.error(e);
        return res.status(400).json({ error: 'Could not process image' });
      }
    }

    const randomStr = Math.random().toString(36).slice(2, 10);
    const key = 'messages/' + conversationId + '/' + Date.now() + '-' + randomStr + '.' + ext;
    const publicBase = String(r2PublicUrl).replace(/\/$/, '');

    try {
      await r2.send(
        new PutObjectCommand({
          Bucket: r2Bucket,
          Key: key,
          Body: fileBuffer,
          ContentType: contentType,
        })
      );
    } catch (e) {
      console.error('R2 PutObject failed (messaging):', e && e.message);
      return res.status(502).json({ error: 'Could not upload file to storage' });
    }

    return res.json({
      url: publicBase + '/' + key,
      file_type: fileType,
      mime_type: mime,
      filename: originalName,
      size_bytes: sizeBytes
    });
  }
);

app.get('/api/conversations/unread-count', requireMessagingAuth, function (req, res) {
  if (req.messagingRole === 'admin') {
    return res.status(403).json({ error: 'Forbidden' });
  }
  if (req.messagingRole === 'buyer') {
    return res.json(conversationsLib.unreadSummaryForBuyer(req.user.id));
  }
  if (req.messagingRole === 'dealer') {
    return res.json(conversationsLib.unreadSummaryForDealer(req.dealership.id));
  }
  return res.status(401).json({ error: 'Unauthorized' });
});

app.post('/api/conversations', requireMessagingAuth, function (req, res) {
  if (req.messagingRole === 'dealer') {
    return res.status(400).json({ error: 'Dealers cannot start conversations in v1.' });
  }
  if (req.messagingRole !== 'buyer') {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const body = req.body || {};
  const dealershipId = Number(body.dealership_id);
  if (!dealershipId || !Number.isInteger(dealershipId)) {
    return res.status(400).json({ error: 'dealership_id is required' });
  }

  const dealership = conversationsLib.getApprovedDealership(dealershipId);
  if (!dealership) {
    return res.status(400).json({ error: 'Dealership not found or not approved' });
  }

  let vehicleId = null;
  if (body.vehicle_id != null && body.vehicle_id !== '') {
    vehicleId = Number(body.vehicle_id);
    if (!vehicleId || !Number.isInteger(vehicleId)) {
      return res.status(400).json({ error: 'Invalid vehicle_id' });
    }
    const vCheck = conversationsLib.validateVehicleForDealership(vehicleId, dealershipId);
    if (!vCheck.ok) {
      return res.status(400).json({ error: vCheck.error });
    }
  }

  const conversation = conversationsLib.findOrCreateConversation({
    buyerId: req.user.id,
    dealershipId: dealershipId,
    vehicleId: vehicleId
  });

  return res.status(200).json(conversation);
});

app.get('/api/conversations', requireMessagingAuth, function (req, res) {
  if (req.messagingRole === 'admin') {
    return res.status(403).json({ error: 'Forbidden' });
  }

  let limit = Number(req.query.limit);
  if (!limit || isNaN(limit) || limit < 1) limit = 20;
  if (limit > 100) limit = 100;
  let offset = Number(req.query.offset);
  if (isNaN(offset) || offset < 0) offset = 0;

  let result;
  if (req.messagingRole === 'buyer') {
    result = conversationsLib.listConversationsForBuyer(req.user.id, limit, offset);
  } else if (req.messagingRole === 'dealer') {
    result = conversationsLib.listConversationsForDealer(req.dealership.id, limit, offset);
  } else {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  return res.json({
    total: result.total,
    conversations: result.conversations
  });
});

app.get('/api/conversations/:id/messages', requireMessagingAuth, function (req, res) {
  const conversationId = Number(req.params.id);
  if (!conversationId) {
    return res.status(400).json({ error: 'Invalid conversation id' });
  }

  const conversation = conversationsLib.getConversationById(conversationId);
  if (!conversation) {
    return res.status(404).json({ error: 'Conversation not found' });
  }

  const viewer = messagingViewerContext(req);
  if (!viewer || !conversationsLib.isParticipant(conversation, viewer)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  let limit = Number(req.query.limit);
  if (!limit || isNaN(limit) || limit < 1) limit = 50;
  if (limit > 100) limit = 100;

  const beforeId = req.query.before_id ? Number(req.query.before_id) : null;
  if (req.query.before_id != null && (!beforeId || !Number.isInteger(beforeId))) {
    return res.status(400).json({ error: 'Invalid before_id' });
  }

  conversationsLib.markConversationRead(conversationId, req.messagingRole);

  const loaded = conversationsLib.loadMessages(conversationId, limit, beforeId);
  const messages = loaded.messages.map(conversationsLib.enrichMessage);

  return res.json({ messages: messages, has_more: loaded.has_more });
});

app.post('/api/conversations/:id/messages', requireMessagingAuth, function (req, res) {
  const conversationId = Number(req.params.id);
  if (!conversationId) {
    return res.status(400).json({ error: 'Invalid conversation id' });
  }

  const conversation = conversationsLib.getConversationById(conversationId);
  if (!conversation) {
    return res.status(404).json({ error: 'Conversation not found' });
  }

  const viewer = messagingViewerContext(req);
  if (!viewer || !conversationsLib.isParticipant(conversation, viewer)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const body = req.body || {};
  const textBody = body.body != null ? String(body.body).trim() : '';
  const attachments = Array.isArray(body.attachments) ? body.attachments : [];

  if (!textBody && attachments.length === 0) {
    return res.status(400).json({ error: 'Message must include text or attachments' });
  }
  if (textBody.length > 5000) {
    return res.status(400).json({ error: 'Message body must be 5000 characters or less' });
  }

  const normalizedAttachments = [];
  for (let i = 0; i < attachments.length; i++) {
    const a = attachments[i] || {};
    const url = String(a.url || '').trim();
    const fileType = String(a.file_type || '').trim();
    if (!url || !fileType) {
      return res.status(400).json({ error: 'Each attachment requires url and file_type' });
    }
    if (!MESSAGING_ATTACHMENT_TYPES[fileType]) {
      return res.status(400).json({ error: 'Invalid file_type on attachment' });
    }
    normalizedAttachments.push({
      url: url,
      file_type: fileType,
      mime_type: a.mime_type != null ? String(a.mime_type) : null,
      filename: a.filename != null ? String(a.filename) : null,
      size_bytes: a.size_bytes != null ? Number(a.size_bytes) : null,
      thumbnail_url: a.thumbnail_url != null ? String(a.thumbnail_url) : null,
      width: a.width != null ? Number(a.width) : null,
      height: a.height != null ? Number(a.height) : null,
      duration_seconds: a.duration_seconds != null ? Number(a.duration_seconds) : null
    });
  }

  try {
    const message = conversationsLib.insertMessage({
      conversationId: conversationId,
      senderId: req.user.id,
      body: textBody || null,
      attachments: normalizedAttachments
    });
    wsBroadcastMessage(conversationId, message, req.user.id);
    return res.status(201).json(message);
  } catch (err) {
    console.error(err);
    if (err && String(err.message).indexOf('CHECK') !== -1) {
      return res.status(400).json({ error: 'Invalid message content' });
    }
    return res.status(500).json({ error: 'Could not send message' });
  }
});

app.get('/api/dealer/stats', requireDealer, function (req, res) {
  const dealershipId = req.dealership.id;
  const activeListings = db
    .prepare("SELECT COUNT(*) AS c FROM vehicles WHERE dealership_id = ? AND status = 'active'")
    .get(dealershipId).c;
  const draftListings = db
    .prepare("SELECT COUNT(*) AS c FROM vehicles WHERE dealership_id = ? AND status = 'draft'")
    .get(dealershipId).c;
  const totalListings = db
    .prepare("SELECT COUNT(*) AS c FROM vehicles WHERE dealership_id = ? AND status != 'archived'")
    .get(dealershipId).c;
  const totalViews30d = db
    .prepare("SELECT COALESCE(SUM(views), 0) AS s FROM vehicles WHERE dealership_id = ? AND status != 'archived'")
    .get(dealershipId).c;
  const newInquiries = db
    .prepare("SELECT COUNT(*) AS c FROM inquiries WHERE dealership_id = ? AND status = 'new'")
    .get(dealershipId).c;
  const soldThisMonth = db
    .prepare(
      `SELECT COUNT(*) AS c FROM vehicles
       WHERE dealership_id = ? AND status = 'sold'
       AND strftime('%Y-%m', COALESCE(updated_at, created_at)) = strftime('%Y-%m', 'now')`
    )
    .get(dealershipId).c;

  return res.json({
    active_listings: activeListings,
    draft_listings: draftListings,
    total_listings: totalListings,
    total_views_30d: totalViews30d,
    new_inquiries: newInquiries,
    sold_this_month: soldThisMonth
  });
});

app.get('/api/dealer/vehicles', requireDealer, function (req, res) {
  const statusParam = req.query.status;
  let statusFilter = 'default';
  if (statusParam != null && String(statusParam).trim() !== '') {
    statusFilter = String(statusParam).trim().toLowerCase();
  }
  const allowed = { active: true, draft: true, sold: true, paused: true, archived: true, all: true };
  if (!allowed[statusFilter]) statusFilter = 'default';

  let limit = Number(req.query.limit);
  if (!limit || isNaN(limit) || limit < 1) limit = 20;
  if (limit > 100) limit = 100;

  let sql = `
    SELECT
      v.id, v.year, v.make, v.model, v.trim, v.mileage, v.price, v.status,
      COALESCE(v.views, 0) AS views,
      v.published_at,
      p.url AS primary_photo_url
    FROM vehicles v
    LEFT JOIN vehicle_photos p ON p.vehicle_id = v.id AND p.is_primary = 1
    WHERE v.dealership_id = ?
  `;
  const params = [req.dealership.id];
  if (statusFilter === 'all') {
    // include archived
  } else if (statusFilter === 'archived') {
    sql += " AND v.status = 'archived'";
  } else if (statusFilter === 'default') {
    sql += " AND v.status != 'archived'";
  } else {
    sql += ' AND v.status = ?';
    params.push(statusFilter);
  }
  sql += ' ORDER BY COALESCE(v.updated_at, v.created_at) DESC LIMIT ?';
  params.push(limit);

  const vehicles = db.prepare(sql).all(...params);
  return res.json({ vehicles: vehicles });
});

// Dealer: silent draft on add-vehicle page load
app.post('/api/vehicles/draft', requireDealer, function (req, res) {
  const createdAt = new Date().toISOString();
  const year = currentYear();
  try {
    const info = db
      .prepare(
        `INSERT INTO vehicles (
          dealership_id, vin, year, make, model, trim, mileage, price,
          body_type, transmission, fuel_type, exterior_color, interior_color, description,
          status, created_at, updated_at
        ) VALUES (?, '', ?, '', '', NULL, 0, 0, NULL, NULL, NULL, NULL, NULL, NULL, 'draft', ?, ?)`
      )
      .run(req.dealership.id, year, createdAt, createdAt);
    const row = db.prepare('SELECT * FROM vehicles WHERE id = ?').get(info.lastInsertRowid);
    return res.status(201).json({ vehicle: row });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Could not create draft' });
  }
});

app.get('/api/vehicles/:id', requireDealer, function (req, res) {
  const vehicleId = Number(req.params.id);
  if (!vehicleId) return res.status(400).json({ error: 'Invalid vehicle id' });
  const vehicle = db
    .prepare('SELECT * FROM vehicles WHERE id = ? AND dealership_id = ?')
    .get(vehicleId, req.dealership.id);
  if (!vehicle) return res.status(403).json({ error: 'Forbidden' });
  const photos = db
    .prepare(
      'SELECT id, vehicle_id, url, display_order, is_primary FROM vehicle_photos WHERE vehicle_id = ? ORDER BY display_order ASC, id ASC'
    )
    .all(vehicleId);
  const dealership = db
    .prepare('SELECT business_name, city, state FROM dealerships WHERE id = ?')
    .get(vehicle.dealership_id);
  return res.json({
    vehicle: vehicle,
    photos: photos,
    dealership: dealership
      ? {
          business_name: dealership.business_name,
          city: dealership.city,
          state: dealership.state
        }
      : null
  });
});

app.patch('/api/vehicles/:id', requireDealer, function (req, res) {
  const vehicleId = Number(req.params.id);
  if (!vehicleId) return res.status(400).json({ error: 'Invalid vehicle id' });
  const existing = db
    .prepare('SELECT * FROM vehicles WHERE id = ? AND dealership_id = ?')
    .get(vehicleId, req.dealership.id);
  if (!existing) return res.status(403).json({ error: 'Forbidden' });

  const { updates, errors } = applyDraftPatchFromBody(req.body || {});
  if (errors.length) return res.status(400).json({ error: errors[0] });
  if (Object.keys(updates).length === 0) {
    return res.json({ vehicle: existing });
  }

  const cols = Object.keys(updates);
  const sets = cols.map(function (c) {
    return c + ' = ?';
  });
  const values = cols.map(function (c) {
    return updates[c];
  });
  values.push(vehicleId, req.dealership.id);
  db.prepare(
    'UPDATE vehicles SET ' + sets.join(', ') + ' WHERE id = ? AND dealership_id = ?'
  ).run(...values);
  touchVehicleUpdatedAt(vehicleId);

  const row = db.prepare('SELECT * FROM vehicles WHERE id = ?').get(vehicleId);
  return res.json({ vehicle: row });
});

app.post('/api/vehicles/:id/publish', requireDealer, function (req, res) {
  const vehicleId = Number(req.params.id);
  if (!vehicleId) return res.status(400).json({ error: 'Invalid vehicle id' });
  const vehicle = db
    .prepare('SELECT * FROM vehicles WHERE id = ? AND dealership_id = ?')
    .get(vehicleId, req.dealership.id);
  if (!vehicle) return res.status(403).json({ error: 'Forbidden' });
  if (vehicle.status === 'archived') {
    return res.status(400).json({
      error: 'Cannot publish an archived listing. Restore it first.'
    });
  }

  const photoCount = db
    .prepare('SELECT COUNT(*) AS c FROM vehicle_photos WHERE vehicle_id = ?')
    .get(vehicleId).c;
  const publishErr = validateForPublish(vehicle, photoCount);
  if (publishErr) return res.status(400).json(publishErr);

  const publishedAt = new Date().toISOString();
  db.prepare("UPDATE vehicles SET status = 'active', published_at = ?, updated_at = ? WHERE id = ?").run(
    publishedAt,
    publishedAt,
    vehicleId
  );
  const row = db.prepare('SELECT * FROM vehicles WHERE id = ?').get(vehicleId);
  return res.json({ vehicle: row });
});

app.delete('/api/vehicles/:id', requireDealer, function (req, res) {
  const vehicleId = Number(req.params.id);
  if (!vehicleId) return res.status(400).json({ error: 'Invalid vehicle id' });
  const vehicle = db
    .prepare('SELECT * FROM vehicles WHERE id = ? AND dealership_id = ?')
    .get(vehicleId, req.dealership.id);
  if (!vehicle) return res.status(403).json({ error: 'Forbidden' });

  const now = new Date().toISOString();
  db.prepare("UPDATE vehicles SET status = 'archived', updated_at = ? WHERE id = ? AND dealership_id = ?").run(
    now,
    vehicleId,
    req.dealership.id
  );
  return res.status(200).json({ message: 'Listing archived' });
});

app.post('/api/vehicles/:id/pause', requireDealer, function (req, res) {
  const vehicleId = Number(req.params.id);
  if (!vehicleId) return res.status(400).json({ error: 'Invalid vehicle id' });
  const vehicle = db
    .prepare('SELECT * FROM vehicles WHERE id = ? AND dealership_id = ?')
    .get(vehicleId, req.dealership.id);
  if (!vehicle) return res.status(403).json({ error: 'Forbidden' });
  if (vehicle.status !== 'active') {
    return res.status(400).json({ error: 'Only active listings can be paused' });
  }
  const now = new Date().toISOString();
  db.prepare("UPDATE vehicles SET status = 'paused', updated_at = ? WHERE id = ?").run(now, vehicleId);
  const row = db.prepare('SELECT * FROM vehicles WHERE id = ?').get(vehicleId);
  return res.json({ vehicle: row });
});

app.post('/api/vehicles/:id/resume', requireDealer, function (req, res) {
  const vehicleId = Number(req.params.id);
  if (!vehicleId) return res.status(400).json({ error: 'Invalid vehicle id' });
  const vehicle = db
    .prepare('SELECT * FROM vehicles WHERE id = ? AND dealership_id = ?')
    .get(vehicleId, req.dealership.id);
  if (!vehicle) return res.status(403).json({ error: 'Forbidden' });
  if (vehicle.status !== 'paused') {
    return res.status(400).json({ error: 'Only paused listings can be resumed' });
  }
  const now = new Date().toISOString();
  db.prepare("UPDATE vehicles SET status = 'active', updated_at = ? WHERE id = ?").run(now, vehicleId);
  const row = db.prepare('SELECT * FROM vehicles WHERE id = ?').get(vehicleId);
  return res.json({ vehicle: row });
});

app.post('/api/vehicles/:id/mark-sold', requireDealer, function (req, res) {
  const vehicleId = Number(req.params.id);
  if (!vehicleId) return res.status(400).json({ error: 'Invalid vehicle id' });
  const vehicle = db
    .prepare('SELECT * FROM vehicles WHERE id = ? AND dealership_id = ?')
    .get(vehicleId, req.dealership.id);
  if (!vehicle) return res.status(403).json({ error: 'Forbidden' });
  if (vehicle.status === 'draft' || vehicle.status === 'archived') {
    return res.status(400).json({ error: 'Cannot mark this listing as sold' });
  }
  if (vehicle.status !== 'active' && vehicle.status !== 'paused') {
    return res.status(400).json({ error: 'Only active or paused listings can be marked as sold' });
  }
  const now = new Date().toISOString();
  db.prepare("UPDATE vehicles SET status = 'sold', updated_at = ? WHERE id = ?").run(now, vehicleId);
  const row = db.prepare('SELECT * FROM vehicles WHERE id = ?').get(vehicleId);
  return res.json({ vehicle: row });
});

// Dealer: create vehicle (approved dealers only) — legacy one-shot create
app.post('/api/vehicles', requireDealer, function (req, res) {
  const b = req.body || {};
  const chassisRaw = String(b.chassis_number != null ? b.chassis_number : b.vin || '').trim();
  const vin = chassisRaw ? chassisRaw.toUpperCase() : '';
  const year = Number(b.year);
  const make = String(b.make || '').trim();
  const model = String(b.model || '').trim();
  const trim = b.trim != null ? String(b.trim).trim() : null;
  const mileage = b.mileage == null || b.mileage === '' ? null : Number(b.mileage);
  const price = Number(b.price);
  const body_type = b.body_type != null ? String(b.body_type).trim() : null;
  const transmission = b.transmission != null ? String(b.transmission).trim() : null;
  const fuel_type = b.fuel_type != null ? String(b.fuel_type).trim() : null;
  const exterior_color = b.exterior_color != null ? String(b.exterior_color).trim() : null;
  const interior_color = b.interior_color != null ? String(b.interior_color).trim() : null;
  const description = b.description != null ? String(b.description).trim() : null;
  const status = (String(b.status || 'draft').trim().toLowerCase() === 'active') ? 'active' : 'draft';

  if (vin && !/^[A-Z0-9]{1,17}$/i.test(vin)) {
    return res.status(400).json({ error: 'chassis_number must be alphanumeric, up to 17 characters' });
  }
  if (!year || isNaN(year)) return res.status(400).json({ error: 'year is required' });
  const thisYear = new Date().getFullYear();
  if (year < 1900 || year > thisYear + 1) return res.status(400).json({ error: 'year is out of range' });
  if (!make) return res.status(400).json({ error: 'make is required' });
  if (!model) return res.status(400).json({ error: 'model is required' });
  if (!Number.isInteger(price) || price <= 0) return res.status(400).json({ error: 'price must be a positive integer (cents)' });
  if (mileage != null && (!Number.isInteger(mileage) || mileage < 0)) return res.status(400).json({ error: 'mileage must be a non-negative integer' });

  const createdAt = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO vehicles (
      dealership_id, vin, year, make, model, trim, mileage, price,
      body_type, transmission, fuel_type, exterior_color, interior_color, description,
      status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  try {
    const info = stmt.run(
      req.dealership.id, vin, year, make, model, trim, mileage ?? 0, price,
      body_type, transmission, fuel_type, exterior_color, interior_color, description,
      status, createdAt
    );
    const row = db.prepare('SELECT * FROM vehicles WHERE id = ?').get(info.lastInsertRowid);
    return res.status(201).json({ vehicle: row });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Could not create vehicle' });
  }
});

function getDealerVehicle(vehicleId, dealershipId) {
  return db
    .prepare('SELECT id, dealership_id FROM vehicles WHERE id = ? AND dealership_id = ?')
    .get(vehicleId, dealershipId);
}

function publicUrlToKey(url) {
  const base = String(r2PublicUrl || '').replace(/\/$/, '');
  const u = String(url || '').trim();
  if (base && u.startsWith(base + '/')) {
    return u.slice(base.length + 1);
  }
  try {
    const parsed = new URL(u);
    return parsed.pathname.replace(/^\//, '');
  } catch (_) {
    return null;
  }
}

function r2Configured() {
  return Boolean(
    process.env.R2_ENDPOINT &&
      process.env.R2_ACCESS_KEY_ID &&
      process.env.R2_SECRET_ACCESS_KEY &&
      r2Bucket &&
      r2PublicUrl
  );
}

app.post(
  '/api/vehicles/:id/photos',
  requireDealer,
  function (req, res, next) {
    photoUpload.single('photo')(req, res, function (err) {
      if (err) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({ error: 'Photo must be 10 MB or smaller' });
        }
        return res.status(400).json({ error: err.message || 'Invalid file' });
      }
      return next();
    });
  },
  async function (req, res) {
    if (!r2Configured()) {
      return res.status(503).json({ error: 'Photo storage is not configured' });
    }
    const vehicleId = Number(req.params.id);
    if (!vehicleId) return res.status(400).json({ error: 'Invalid vehicle id' });
    const vehicle = getDealerVehicle(vehicleId, req.dealership.id);
    if (!vehicle) return res.status(403).json({ error: 'Forbidden' });
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ error: 'Photo file is required' });
    }

    let jpegBuffer;
    try {
      jpegBuffer = await sharp(req.file.buffer)
        .rotate()
        .resize({ width: 1600, withoutEnlargement: true })
        .jpeg({ quality: 82 })
        .toBuffer();
    } catch (e) {
      console.error(e);
      return res.status(400).json({ error: 'Could not process image' });
    }

    const key =
      'vehicles/' +
      vehicleId +
      '/' +
      Date.now() +
      '-' +
      Math.random().toString(36).slice(2, 10) +
      '.jpg';
    const publicBase = String(r2PublicUrl).replace(/\/$/, '');

    try {
      await r2.send(
        new PutObjectCommand({
          Bucket: r2Bucket,
          Key: key,
          Body: jpegBuffer,
          ContentType: 'image/jpeg',
        })
      );
    } catch (e) {
      console.error(
        'R2 PutObject failed — vehicleId:',
        vehicleId,
        'bucket:',
        r2Bucket,
        'key:',
        key,
        'name:',
        e && e.name,
        'message:',
        e && e.message,
        'code:',
        e && e.Code,
        'statusCode:',
        e && e.$metadata && e.$metadata.httpStatusCode,
        'stack:',
        e && e.stack
      );
      const detail = e && e.message ? String(e.message) : 'Unknown R2 error';
      return res.status(502).json({
        error: 'Could not upload photo to storage',
        detail: detail
      });
    }

    const url = publicBase + '/' + key;
    const maxOrderRow = db
      .prepare('SELECT COALESCE(MAX(display_order), -1) AS max_order FROM vehicle_photos WHERE vehicle_id = ?')
      .get(vehicleId);
    const displayOrder = (maxOrderRow && maxOrderRow.max_order != null ? maxOrderRow.max_order : -1) + 1;
    const countRow = db
      .prepare('SELECT COUNT(*) AS c FROM vehicle_photos WHERE vehicle_id = ?')
      .get(vehicleId);
    const isPrimary = countRow && countRow.c === 0 ? 1 : 0;

    const info = db
      .prepare(
        'INSERT INTO vehicle_photos (vehicle_id, url, display_order, is_primary) VALUES (?, ?, ?, ?)'
      )
      .run(vehicleId, url, displayOrder, isPrimary);
    const photo = db.prepare('SELECT * FROM vehicle_photos WHERE id = ?').get(info.lastInsertRowid);
    return res.status(201).json({ photo: photo });
  }
);

app.delete(
  '/api/vehicles/:vehicleId/photos/:photoId',
  requireDealer,
  async function (req, res) {
    const vehicleId = Number(req.params.vehicleId);
    const photoId = Number(req.params.photoId);
    if (!vehicleId || !photoId) return res.status(400).json({ error: 'Invalid id' });
    const vehicle = getDealerVehicle(vehicleId, req.dealership.id);
    if (!vehicle) return res.status(403).json({ error: 'Forbidden' });

    const photo = db
      .prepare('SELECT * FROM vehicle_photos WHERE id = ? AND vehicle_id = ?')
      .get(photoId, vehicleId);
    if (!photo) return res.status(404).json({ error: 'Photo not found' });

    const key = publicUrlToKey(photo.url);
    if (r2Configured() && key) {
      try {
        await r2.send(new DeleteObjectCommand({ Bucket: r2Bucket, Key: key }));
      } catch (e) {
        console.error(e);
      }
    }

    const wasPrimary = photo.is_primary === 1;
    db.prepare('DELETE FROM vehicle_photos WHERE id = ?').run(photoId);

    if (wasPrimary) {
      const nextPhoto = db
        .prepare(
          'SELECT id FROM vehicle_photos WHERE vehicle_id = ? ORDER BY display_order ASC, id ASC LIMIT 1'
        )
        .get(vehicleId);
      if (nextPhoto) {
        db.prepare('UPDATE vehicle_photos SET is_primary = 0 WHERE vehicle_id = ?').run(vehicleId);
        db.prepare('UPDATE vehicle_photos SET is_primary = 1 WHERE id = ?').run(nextPhoto.id);
      }
    }

    return res.status(204).send();
  }
);

app.patch('/api/vehicles/:vehicleId/photos/reorder', requireDealer, function (req, res) {
  const vehicleId = Number(req.params.vehicleId);
  if (!vehicleId) return res.status(400).json({ error: 'Invalid vehicle id' });
  const vehicle = getDealerVehicle(vehicleId, req.dealership.id);
  if (!vehicle) return res.status(403).json({ error: 'Forbidden' });

  const photoIds = req.body && Array.isArray(req.body.photo_ids) ? req.body.photo_ids : null;
  if (!photoIds || photoIds.length === 0) {
    return res.status(400).json({ error: 'photo_ids array is required' });
  }

  const ids = photoIds.map(function (id) {
    return Number(id);
  });
  if (ids.some(function (id) {
    return !id;
  })) {
    return res.status(400).json({ error: 'photo_ids must be valid numbers' });
  }

  const existing = db
    .prepare('SELECT id FROM vehicle_photos WHERE vehicle_id = ?')
    .all(vehicleId)
    .map(function (row) {
      return row.id;
    });
  if (ids.length !== existing.length) {
    return res.status(400).json({ error: 'photo_ids must include every photo for this vehicle' });
  }
  const existingSet = new Set(existing);
  for (let i = 0; i < ids.length; i++) {
    if (!existingSet.has(ids[i])) {
      return res.status(400).json({ error: 'Invalid photo id in photo_ids' });
    }
  }

  const updateOrder = db.prepare(
    'UPDATE vehicle_photos SET display_order = ?, is_primary = ? WHERE id = ? AND vehicle_id = ?'
  );
  const tx = db.transaction(function () {
    db.prepare('UPDATE vehicle_photos SET is_primary = 0 WHERE vehicle_id = ?').run(vehicleId);
    ids.forEach(function (id, index) {
      updateOrder.run(index, index === 0 ? 1 : 0, id, vehicleId);
    });
  });
  tx();

  const photos = db
    .prepare(
      'SELECT * FROM vehicle_photos WHERE vehicle_id = ? ORDER BY display_order ASC, id ASC'
    )
    .all(vehicleId);
  return res.json({ photos: photos });
});

app.get('/cars/:id(\\d+)', function (req, res) {
  res.sendFile(path.join(__dirname, 'cars-detail.html'));
});

app.use(express.static(__dirname));

const server = http.createServer(app);

const wss = new WebSocketServer({ server });

wss.on('connection', function (ws, req) {
  const url = new URL(req.url, 'http://localhost');
  const token = url.searchParams.get('token');
  const conversationId = parseInt(url.searchParams.get('conversation'), 10);

  if (!token || !conversationId) { ws.close(4001, 'Missing params'); return; }

  let viewer = null;
  let userId = null;
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    userId = decoded.sub;
    const dealerRow = db.prepare('SELECT d.id FROM dealerships d WHERE d.user_id = ? AND d.status = ?').get(userId, 'active');
    if (dealerRow) {
      viewer = { role: 'dealer', userId: userId, dealershipId: dealerRow.id };
    } else {
      viewer = { role: 'buyer', userId: userId, dealershipId: null };
    }
  } catch (e) { ws.close(4001, 'Invalid token'); return; }

  const conversation = conversationsLib.getConversationById(conversationId);
  if (!conversation || !conversationsLib.isParticipant(conversation, viewer)) {
    ws.close(4003, 'Forbidden'); return;
  }

  const client = { ws, userId, role: viewer.role, dealershipId: viewer.dealershipId };
  wsRegister(conversationId, client);

  ws.on('close', function () { wsUnregister(conversationId, client); });
  ws.on('error', function () { wsUnregister(conversationId, client); });
});

server.listen(PORT, function () {
  console.log('CarFox server: http://localhost:' + PORT);
  console.log('Open the site at that address so sign-in uses the same saved database.');
});
