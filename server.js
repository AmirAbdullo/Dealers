'use strict';

require('dotenv').config();

const path = require('path');
const http = require('http');
const express = require('express');
const fs = require('fs');
// libsql is a drop-in replacement for better-sqlite3 that can sync with Turso.
// Locally (no TURSO_URL set) it behaves exactly like better-sqlite3 with carfox.db.
// In production (TURSO_URL set) it keeps a local replica synced with Turso cloud,
// so data survives redeploys.
const Database = require('libsql');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const multer = require('multer');
const sharp = require('sharp');
const { WebSocketServer } = require('ws');
const { PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { r2, bucket: r2Bucket, publicUrl: r2PublicUrl } = require('./lib/r2');
const { Resend } = require('resend');
const crypto = require('crypto');
const resend = new Resend(process.env.RESEND_API_KEY);

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
const TURSO_URL = process.env.TURSO_URL || '';
const TURSO_AUTH_TOKEN = process.env.TURSO_AUTH_TOKEN || '';
// When syncing with Turso we use a separate replica file so local dev
// (carfox.db) is never touched by production data.
const dbPath = TURSO_URL
  ? path.join(__dirname, 'turso-replica.db')
  : path.join(__dirname, 'carfox.db');

const app = express();
// Render sits behind a proxy: trust X-Forwarded-For so req.ip is the real client (used by the
// engagement abuse guard). Without this every visitor would share the proxy's IP.
app.set('trust proxy', true);
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '100kb' }));

function createRawDb() {
  return TURSO_URL
    ? new Database(dbPath, { syncUrl: TURSO_URL, authToken: TURSO_AUTH_TOKEN })
    : new Database(dbPath);
}

let rawDb = createRawDb();

// Turso's remote write stream can expire after idle periods ("stream not found").
// When that happens we recreate the connection and retry the operation once.
function isStreamError(err) {
  const msg = String((err && err.message) || '');
  return /stream not found|stream expired|status=404/i.test(msg);
}

function reconnectDb() {
  console.warn('Turso: connection stale, reconnecting...');
  try { rawDb.close(); } catch (_) {}
  rawDb = createRawDb();
  try {
    rawDb.sync();
    console.log('Turso: reconnected and synced');
  } catch (err) {
    console.error('Turso: sync after reconnect failed:', err);
  }
}

function withReconnect(fn) {
  try {
    return fn();
  } catch (err) {
    if (TURSO_URL && isStreamError(err)) {
      reconnectDb();
      return fn();
    }
    throw err;
  }
}

// db facade with the same API the rest of the code expects (prepare/exec/pragma).
// Statements are prepared lazily on each call so a reconnect is always picked up.
const db = {
  prepare: function (sql) {
    function call(method, args) {
      return withReconnect(function () {
        const stmt = rawDb.prepare(sql);
        return stmt[method].apply(stmt, args);
      });
    }
    return {
      run: function () { return call('run', Array.prototype.slice.call(arguments)); },
      get: function () { return call('get', Array.prototype.slice.call(arguments)); },
      all: function () { return call('all', Array.prototype.slice.call(arguments)); },
    };
  },
  exec: function (sql) {
    return withReconnect(function () { return rawDb.exec(sql); });
  },
  pragma: function (p, opts) {
    return withReconnect(function () { return rawDb.pragma(p, opts); });
  },
  sync: function () {
    return rawDb.sync();
  },
};

if (TURSO_URL) {
  try {
    db.sync();
    console.log('Turso: initial sync complete');
  } catch (err) {
    console.error('Turso: initial sync failed:', err);
  }
  // Re-sync every 60 seconds so the local replica stays fresh and the
  // connection is kept warm (helps prevent stream expiry).
  setInterval(function () {
    try {
      db.sync();
    } catch (err) {
      if (isStreamError(err)) {
        reconnectDb();
      } else {
        console.error('Turso: periodic sync failed:', err);
      }
    }
  }, 60 * 1000);
}
const requireAdmin = require('./middleware/requireAdmin')(db, JWT_SECRET);
const requireDealer = require('./middleware/requireDealer')(db, JWT_SECRET);
const requireBuyer = require('./middleware/requireBuyer')(db, JWT_SECRET);
const requireMessagingAuth = require('./middleware/requireMessagingAuth')(db, JWT_SECRET);
const createConversationsLib = require('./lib/conversations');
const conversationsLib = createConversationsLib(db);
try {
  db.pragma('journal_mode = WAL');
} catch (err) {
  // Turso replicas manage their own journal mode; safe to ignore
  console.warn('WAL pragma skipped:', err.message);
}
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
  // SQLite column names are case-insensitive and Turso can report them in a different
  // case than they were declared, so compare case-insensitively. Otherwise a column that
  // already exists is "missing", ALTER TABLE fails with "duplicate column", and boot crashes.
  const wanted = String(column).toLowerCase();
  return rows.some(function (r) {
    return String(r.name).toLowerCase() === wanted;
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
function addColumnIfMissing(table, column, definition) {
  if (hasDbColumn(table, column)) return;
  try {
    db.exec('ALTER TABLE ' + table + ' ADD COLUMN ' + column + ' ' + definition + ';');
  } catch (err) {
    if (/duplicate column/i.test(String(err && err.message))) {
      console.warn('Column ' + table + '.' + column + ' already exists; skipping migration');
      return;
    }
    throw err;
  }
}

// Dealer membership (phase 1, no payments): plan name + how many listings it allows.
// Note: Turso stores this column as "PLAN" (it treats plan as a keyword), so every SELECT
// below aliases it ("plan AS plan") to get a lowercase key back.
addColumnIfMissing('dealerships', 'plan', "TEXT NOT NULL DEFAULT 'basic'");
addColumnIfMissing('dealerships', 'listing_limit', 'INTEGER NOT NULL DEFAULT 50');

// Account suspension (admin-controlled). A suspended dealer can still log in and read, but
// their listings are hidden everywhere and they cannot list or message. A suspended buyer
// can browse but cannot message or send inquiries. Unsuspending flips the flag back; nothing
// else is modified, so everything reappears exactly as it was.
addColumnIfMissing('dealerships', 'suspended', 'INTEGER NOT NULL DEFAULT 0');
addColumnIfMissing('dealerships', 'suspension_reason', 'TEXT');
addColumnIfMissing('dealerships', 'suspended_at', 'TEXT');
// Dealer profile extras: logo (R2), website, and a map pin.
addColumnIfMissing('dealerships', 'logo_url', 'TEXT');
addColumnIfMissing('dealerships', 'website', 'TEXT');
addColumnIfMissing('dealerships', 'lat', 'REAL');
addColumnIfMissing('dealerships', 'lng', 'REAL');

function suspendedError(reason) {
  const r = reason ? String(reason).trim() : '';
  return {
    error: 'Your account has been suspended' + (r ? ': ' + r : '') + '. Contact support.',
    code: 'SUSPENDED',
    reason: r || null
  };
}
// After requireDealer: block listing writes for a suspended dealership.
function dealerSuspendedGuard(req, res, next) {
  if (req.dealership && req.dealership.suspended) {
    return res.status(403).json(suspendedError(req.dealership.suspension_reason));
  }
  return next();
}
// After requireBuyer: block inquiries for a suspended buyer.
function buyerSuspendedGuard(req, res, next) {
  if (req.user && req.user.suspended) {
    return res.status(403).json(suspendedError(req.user.suspension_reason));
  }
  return next();
}
// After requireMessagingAuth: block new messages from either side while suspended.
function messagingSuspendedGuard(req, res, next) {
  if (req.messagingRole === 'buyer' && req.user && req.user.suspended) {
    return res.status(403).json(suspendedError(req.user.suspension_reason));
  }
  if (req.messagingRole === 'dealer' && req.dealership && req.dealership.suspended) {
    return res.status(403).json(suspendedError(req.dealership.suspension_reason));
  }
  return next();
}

const DEALER_PLANS = {
  basic: { label: 'Basic', listing_limit: 50 },
  pro: { label: 'Pro', listing_limit: 100 },
  custom: { label: 'Custom', listing_limit: null }
};
const LISTING_LIMIT_MESSAGE = "You've reached your plan's listing limit. Upgrade to add more.";

function getDealerPlan(dealershipId) {
  const row = db.prepare('SELECT plan AS plan, listing_limit FROM dealerships WHERE id = ?').get(dealershipId);
  const plan = row && row.plan ? String(row.plan) : 'basic';
  const limit = row && row.listing_limit != null ? Number(row.listing_limit) : DEALER_PLANS.basic.listing_limit;
  return { plan: plan, listing_limit: limit };
}

// Listings that count against the plan: everything published (active, paused, sold).
// Drafts and archived vehicles are free, so a dealer can always prepare a listing.
function countPlanListings(dealershipId, excludeVehicleId) {
  const row = db
    .prepare(
      "SELECT COUNT(*) AS c FROM vehicles WHERE dealership_id = ? AND status IN ('active', 'paused', 'sold') AND id != ?"
    )
    .get(dealershipId, excludeVehicleId || 0);
  return row.c;
}

function listingLimitError(dealershipId, excludeVehicleId) {
  const plan = getDealerPlan(dealershipId);
  const used = countPlanListings(dealershipId, excludeVehicleId);
  if (used >= plan.listing_limit) {
    return {
      error: LISTING_LIMIT_MESSAGE,
      code: 'LISTING_LIMIT',
      plan: plan.plan,
      listing_limit: plan.listing_limit,
      listings_used: used
    };
  }
  return null;
}

db.exec(`
  CREATE TABLE IF NOT EXISTS email_verification_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    token TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    used INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    token TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    used INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  )
`);

// Buyer engagement clicks (WhatsApp / call / message / share / website), separate from views.
db.exec(`
  CREATE TABLE IF NOT EXISTS engagement_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    vehicle_id INTEGER,
    dealership_id INTEGER NOT NULL,
    event_type TEXT NOT NULL CHECK (event_type IN ('whatsapp', 'call', 'message', 'share', 'website')),
    created_at TEXT NOT NULL
  )
`);
db.exec('CREATE INDEX IF NOT EXISTS idx_engagement_dealership_created ON engagement_events(dealership_id, created_at)');
db.exec('CREATE INDEX IF NOT EXISTS idx_engagement_vehicle ON engagement_events(vehicle_id)');

// Admin email invitations (buyer / dealer). status: sending | sent | failed | registered
db.exec(`
  CREATE TABLE IF NOT EXISTS invitations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('buyer', 'dealer')),
    invited_by INTEGER,
    invited_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'sent',
    error TEXT,
    registered_at TEXT
  )
`);
db.exec('CREATE INDEX IF NOT EXISTS idx_invitations_email ON invitations(email)');
db.exec('CREATE INDEX IF NOT EXISTS idx_invitations_invited_at ON invitations(invited_at)');

const ENGAGEMENT_TYPES = { whatsapp: true, call: true, message: true, share: true, website: true };
const ENGAGEMENT_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

// Abuse guard: at most 10 events per minute per IP; extra ones are silently ignored.
const engagementHits = new Map();
function engagementAllowed(ip) {
  const now = Date.now();
  const recent = (engagementHits.get(ip) || []).filter(function (t) { return now - t < 60 * 1000; });
  if (recent.length >= 10) {
    engagementHits.set(ip, recent);
    return false;
  }
  recent.push(now);
  engagementHits.set(ip, recent);
  return true;
}
setInterval(function () {
  const now = Date.now();
  engagementHits.forEach(function (arr, ip) {
    if (!arr.length || now - arr[arr.length - 1] > 60 * 1000) engagementHits.delete(ip);
  });
}, 5 * 60 * 1000).unref();

function engagementSummary(dealershipId) {
  const since = new Date(Date.now() - ENGAGEMENT_WINDOW_MS).toISOString();
  const rows = db
    .prepare('SELECT event_type, COUNT(*) AS c FROM engagement_events WHERE dealership_id = ? AND created_at >= ? GROUP BY event_type')
    .all(dealershipId, since);
  const breakdown = { whatsapp: 0, call: 0, message: 0, share: 0, website: 0 };
  let total = 0;
  rows.forEach(function (r) {
    if (breakdown[r.event_type] != null) breakdown[r.event_type] = r.c;
    total += r.c;
  });
  return { total: total, breakdown: breakdown };
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
      avatar_url TEXT,
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

// Buyer suspension lives on users (added after the users-table rebuild above).
addColumnIfMissing('users', 'suspended', 'INTEGER NOT NULL DEFAULT 0');
addColumnIfMissing('users', 'suspension_reason', 'TEXT');
addColumnIfMissing('users', 'suspended_at', 'TEXT');

// When a listing was marked sold (for days-to-sell insights). Older sold rows get their
// last update time, which is when mark-sold happened.
addColumnIfMissing('vehicles', 'sold_at', 'TEXT');
// Admin moderation: a listing force-paused by an admin stays paused until an admin republishes it.
addColumnIfMissing('vehicles', 'admin_paused', 'INTEGER NOT NULL DEFAULT 0');
addColumnIfMissing('vehicles', 'admin_pause_reason', 'TEXT');
addColumnIfMissing('vehicles', 'admin_paused_at', 'TEXT');
db.exec("UPDATE vehicles SET sold_at = COALESCE(updated_at, created_at) WHERE status = 'sold' AND sold_at IS NULL");

// Grandfather in everyone who signed up before email verification existed.
// Runs only ONCE (guarded by app_meta) so it doesn't auto-verify future
// pending signups on later restarts. Only NEW signups need to verify.
db.exec(`
  CREATE TABLE IF NOT EXISTS app_meta (
    key TEXT PRIMARY KEY,
    value TEXT
  )
`);
(function grandfatherEmailVerification() {
  const done = db.prepare("SELECT value FROM app_meta WHERE key = 'email_verification_grandfathered'").get();
  if (done) return;
  db.exec(`UPDATE users SET email_verified = 1 WHERE email_verified IS NULL OR email_verified = 0`);
  db.prepare("INSERT INTO app_meta (key, value) VALUES ('email_verification_grandfathered', ?)").run(new Date().toISOString());
  console.log('Grandfathered existing users as email-verified');
})();

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

// When the dealer was last emailed about a conversation (anti-spam: at most one email per hour).
addColumnIfMissing('conversations', 'dealer_notified_at', 'TEXT');

// Buyer saved cars. Created here (not only in db/migrate-add-saved-cars.js) so a fresh
// or production database gets the table without a manual migration step.
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

// ─── Seed test accounts ───────────────────────────────────────────────────────
// These accounts are created automatically on every startup so you never need
// to re-register after a redeploy. Passwords are fixed and memorable.
//
//  Admin  : admin@carfox.com    / Admin1234!
//  Dealer : dealer@carfox.com   / Dealer1234!   (approved, ready to list cars)
//  Buyer  : buyer@carfox.com    / Buyer1234!
// ─────────────────────────────────────────────────────────────────────────────
(function seedTestAccounts() {
  const now = new Date().toISOString();

  // Admin
  const adminEmail = 'admin@carfox.com';
  if (!db.prepare('SELECT id FROM users WHERE email = ?').get(adminEmail)) {
    db.prepare(
      "INSERT INTO users (email, password_hash, full_name, role, email_verified, auth_provider, created_at) VALUES (?, ?, ?, 'admin', 1, 'email', ?)"
    ).run(adminEmail, bcrypt.hashSync('Admin1234!', 10), 'CarFox Admin', now);
    console.log('Seeded admin account:', adminEmail);
  }

  // Dealer
  const dealerEmail = 'dealer@carfox.com';
  if (!db.prepare('SELECT id FROM users WHERE email = ?').get(dealerEmail)) {
    db.prepare(
      "INSERT INTO users (email, password_hash, full_name, role, email_verified, auth_provider, created_at) VALUES (?, ?, ?, 'dealer', 1, 'email', ?)"
    ).run(dealerEmail, bcrypt.hashSync('Dealer1234!', 10), 'Test Dealer', now);
    const dealerUser = db.prepare('SELECT id FROM users WHERE email = ?').get(dealerEmail);
    db.prepare(
      "INSERT INTO dealerships (user_id, business_name, license_number, address, city, state, zip, phone, status, governorate, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'approved', ?, ?)"
    ).run(dealerUser.id, 'Test Dealership', 'LIC-001', '123 Test St', 'Cairo', 'Cairo', '11511', '01000000000', 'Cairo', now);
    console.log('Seeded dealer account:', dealerEmail);
  }

  // Buyer
  const buyerEmail = 'buyer@carfox.com';
  if (!db.prepare('SELECT id FROM users WHERE email = ?').get(buyerEmail)) {
    db.prepare(
      "INSERT INTO users (email, password_hash, full_name, role, email_verified, auth_provider, created_at) VALUES (?, ?, ?, 'buyer', 1, 'email', ?)"
    ).run(buyerEmail, bcrypt.hashSync('Buyer1234!', 10), 'Test Buyer', now);
    console.log('Seeded buyer account:', buyerEmail);
  }
})();
// ─────────────────────────────────────────────────────────────────────────────

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

async function sendVerificationEmail(user) {
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(); // 24 hours
  db.prepare(
    'INSERT INTO email_verification_tokens (user_id, token, expires_at, created_at) VALUES (?, ?, ?, ?)'
  ).run(user.id, code, expiresAt, new Date().toISOString());

  await resend.emails.send({
    from: 'CarFox <noreply@mawtiq.online>',
    to: user.email,
    subject: 'Verify your CarFox account',
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:auto;padding:32px">
        <h2 style="color:#f97316">Verify your CarFox account</h2>
        <p>Hi ${user.full_name || user.fullName || 'there'},</p>
        <p>Enter this code in the app to verify your email:</p>
        <div style="font-size:42px;font-weight:bold;letter-spacing:12px;color:#0f1f3d;background:#f3f4f6;padding:24px;border-radius:12px;text-align:center;margin:16px 0">
          ${code}
        </div>
        <p style="color:#999;font-size:13px">This code expires in 24 hours. If you didn't sign up for CarFox, ignore this email.</p>
      </div>
    `
  });

  return code;
}

async function sendDealerDecisionEmail(dealershipId, decision, reason) {
  const row = db
    .prepare(
      'SELECT d.business_name, u.email, u.full_name FROM dealerships d JOIN users u ON u.id = d.user_id WHERE d.id = ?'
    )
    .get(dealershipId);
  if (!row || !row.email) return;
  const appUrl = String(process.env.APP_URL || '').replace(new RegExp('/+$'), '');
  const approved = decision === 'approved';
  const subject = approved
    ? 'Your CarFox dealer account is approved'
    : 'Update on your CarFox dealer application';
  const body = approved
    ? '<p>Good news: <strong>' + escapeHtmlForEmail(row.business_name) + '</strong> has been approved. ' +
      'You can now sign in and start listing vehicles.</p>' +
      (appUrl
        ? '<p><a href="' + appUrl + '/dealer/login.html" style="display:inline-block;background:#1d4ed8;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:bold">Sign in to your dashboard</a></p>'
        : '')
    : '<p>Unfortunately we could not approve <strong>' + escapeHtmlForEmail(row.business_name) + '</strong> at this time.</p>' +
      (reason ? '<p><strong>Reason:</strong> ' + escapeHtmlForEmail(reason) + '</p>' : '') +
      '<p>If you believe this is a mistake or can provide additional documentation, reply to this email.</p>';

  await resend.emails.send({
    from: 'CarFox <noreply@mawtiq.online>',
    to: row.email,
    subject: subject,
    html:
      '<div style="font-family:sans-serif;max-width:480px;margin:auto;padding:32px">' +
      '<h2 style="color:#f97316">' + subject + '</h2>' +
      '<p>Hi ' + escapeHtmlForEmail(row.full_name || 'there') + ',</p>' +
      body +
      '<p style="color:#999;font-size:13px">CarFox &middot; Verified dealers only</p>' +
      '</div>'
  });
}

async function sendSuspensionEmail(opts) {
  if (!opts || !opts.email) return;
  const reason = opts.reason ? String(opts.reason).trim() : '';
  const subject = opts.suspended
    ? 'Your CarFox account has been suspended'
    : 'Your CarFox account has been reinstated';
  const body = opts.suspended
    ? '<p>Your ' + (opts.kind === 'dealer' ? 'dealer' : 'buyer') + ' account' +
      (opts.businessName ? ' (<strong>' + escapeHtmlForEmail(opts.businessName) + '</strong>)' : '') +
      ' has been suspended.</p>' +
      (reason ? '<p><strong>Reason:</strong> ' + escapeHtmlForEmail(reason) + '</p>' : '') +
      (opts.kind === 'dealer'
        ? '<p>While suspended, your listings are hidden from buyers and you cannot publish, edit or message. You can still sign in to see this notice.</p>'
        : '<p>While suspended, you cannot message dealers or send inquiries. You can still sign in and browse.</p>') +
      '<p>If you believe this is a mistake, reply to this email to contact support.</p>'
    : '<p>Your account has been reinstated. Everything is back to how it was' +
      (opts.kind === 'dealer' ? ', including your listings' : '') + '.</p>';
  await resend.emails.send({
    from: 'CarFox <noreply@mawtiq.online>',
    to: opts.email,
    subject: subject,
    html:
      '<div style="font-family:sans-serif;max-width:480px;margin:auto;padding:32px">' +
      '<h2 style="color:#f97316">' + subject + '</h2>' +
      '<p>Hi ' + escapeHtmlForEmail(opts.name || 'there') + ',</p>' +
      body +
      '<p style="color:#999;font-size:13px">CarFox &middot; Verified dealers only</p>' +
      '</div>'
  });
}

async function sendListingModerationEmail(opts) {
  if (!opts || !opts.email) return;
  const base = appBaseUrl();
  const link = base ? base + '/dealer/inventory.html' : '';
  const title = escapeHtmlForEmail(opts.carTitle || 'your listing');
  const subject = opts.unpublished
    ? 'Your listing was paused by CarFox: ' + (opts.carTitle || 'listing')
    : 'Your listing is live again: ' + (opts.carTitle || 'listing');
  const body = opts.unpublished
    ? '<p>Your listing <strong>' + title + '</strong> has been paused by the CarFox team and is no longer visible to buyers.</p>' +
      (opts.reason ? '<p><strong>Reason:</strong> ' + escapeHtmlForEmail(opts.reason) + '</p>' : '') +
      '<p>You can still edit the listing to fix the issue, but it can only be republished by CarFox. Reply to this email once it is ready for review, or if you believe this is a mistake.</p>'
    : '<p>Your listing <strong>' + title + '</strong> has been reviewed and is visible to buyers again.</p>';
  await resend.emails.send({
    from: 'CarFox <noreply@mawtiq.online>',
    to: opts.email,
    subject: subject,
    html: emailShell(
      escapeHtmlForEmail(subject),
      '<p>Hi ' + escapeHtmlForEmail(opts.dealerName || 'there') + ',</p>' + body +
      (link ? '<p><a href="' + link + '" style="display:inline-block;background:#1d4ed8;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:bold">Open my inventory</a></p>' : '')
    )
  });
}

function appBaseUrl() {
  return String(process.env.APP_URL || '').replace(new RegExp('/+$'), '');
}

function emailShell(title, innerHtml) {
  return (
    '<div style="font-family:sans-serif;max-width:480px;margin:auto;padding:32px">' +
    '<h2 style="color:#f97316">' + title + '</h2>' +
    innerHtml +
    '<p style="color:#999;font-size:13px">CarFox &middot; Verified dealers only</p>' +
    '</div>'
  );
}

async function sendPasswordResetEmail(user, code) {
  await resend.emails.send({
    from: 'CarFox <noreply@mawtiq.online>',
    to: user.email,
    subject: 'Your CarFox password reset code',
    html: emailShell(
      'Reset your password',
      '<p>Hi ' + escapeHtmlForEmail(user.full_name || 'there') + ',</p>' +
      '<p>Enter this code on the reset page to choose a new password:</p>' +
      '<div style="font-size:42px;font-weight:bold;letter-spacing:12px;color:#0f1f3d;background:#f3f4f6;padding:24px;border-radius:12px;text-align:center;margin:16px 0">' + code + '</div>' +
      '<p style="color:#999;font-size:13px">This code expires in 15 minutes and can be used once. If you did not ask to reset your password, you can ignore this email.</p>'
    )
  });
}

async function sendDealerMessageEmail(opts) {
  const base = appBaseUrl();
  const link = base ? base + '/dealer/chat.html?conversation=' + opts.conversationId : '';
  const subject = 'New message from ' + opts.buyerFirstName + (opts.carTitle ? ' about your ' + opts.carTitle : '');
  await resend.emails.send({
    from: 'CarFox <noreply@mawtiq.online>',
    to: opts.email,
    subject: subject,
    html: emailShell(
      escapeHtmlForEmail(subject),
      '<p>Hi ' + escapeHtmlForEmail(opts.dealerName || 'there') + ',</p>' +
      '<p><strong>' + escapeHtmlForEmail(opts.buyerFirstName) + '</strong> sent you a message' +
      (opts.carTitle ? ' about your <strong>' + escapeHtmlForEmail(opts.carTitle) + '</strong>' : '') + ':</p>' +
      (opts.preview ? '<blockquote style="margin:12px 0;padding:12px 16px;background:#f3f4f6;border-left:4px solid #1d4ed8;border-radius:8px;color:#111">' + escapeHtmlForEmail(opts.preview) + '</blockquote>' : '') +
      (link ? '<p><a href="' + link + '" style="display:inline-block;background:#1d4ed8;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:bold">Open conversation</a></p>' : '') +
      '<p style="color:#999;font-size:13px">You will get at most one email per conversation per hour.</p>'
    )
  });
}

async function sendDealerInquiryEmail(opts) {
  const base = appBaseUrl();
  const link = base ? base + '/dealer/inquiries.html' : '';
  const subject = 'New inquiry from ' + opts.buyerFirstName + (opts.carTitle ? ' about your ' + opts.carTitle : '');
  await resend.emails.send({
    from: 'CarFox <noreply@mawtiq.online>',
    to: opts.email,
    subject: subject,
    html: emailShell(
      escapeHtmlForEmail(subject),
      '<p>Hi ' + escapeHtmlForEmail(opts.dealerName || 'there') + ',</p>' +
      '<p><strong>' + escapeHtmlForEmail(opts.buyerFirstName) + '</strong> sent an inquiry' +
      (opts.carTitle ? ' about your <strong>' + escapeHtmlForEmail(opts.carTitle) + '</strong>' : '') + ':</p>' +
      '<blockquote style="margin:12px 0;padding:12px 16px;background:#f3f4f6;border-left:4px solid #1d4ed8;border-radius:8px;color:#111">' + escapeHtmlForEmail(opts.preview) + '</blockquote>' +
      (opts.buyerPhone ? '<p>Phone: ' + escapeHtmlForEmail(opts.buyerPhone) + '</p>' : '') +
      (link ? '<p><a href="' + link + '" style="display:inline-block;background:#1d4ed8;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:bold">View inquiries</a></p>' : '')
    )
  });
}

const DEALER_NOTIFY_WINDOW_MS = 60 * 60 * 1000;

function firstNameOf(user) {
  const full = user && (user.full_name || user.fullName) ? String(user.full_name || user.fullName).trim() : '';
  return full ? full.split(/\s+/)[0] : 'a buyer';
}

function carTitleFor(vehicleId) {
  if (!vehicleId) return '';
  const v = db.prepare('SELECT year, make, model FROM vehicles WHERE id = ?').get(vehicleId);
  return v ? [v.year, v.make, v.model].filter(Boolean).join(' ') : '';
}

// Email the dealer about a buyer's message, at most once per conversation per hour.
function notifyDealerOfNewMessage(conversation, message, buyer) {
  try {
    const now = Date.now();
    const row = db.prepare('SELECT dealer_notified_at FROM conversations WHERE id = ?').get(conversation.id);
    const last = row && row.dealer_notified_at ? Date.parse(row.dealer_notified_at) : 0;
    if (last && now - last < DEALER_NOTIFY_WINDOW_MS) {
      console.log('Dealer email skipped for conversation ' + conversation.id + ' (last sent ' + Math.round((now - last) / 60000) + ' min ago)');
      return;
    }
    const dealer = db
      .prepare('SELECT d.id, d.business_name, d.suspended, u.email, u.full_name FROM dealerships d JOIN users u ON u.id = d.user_id WHERE d.id = ?')
      .get(conversation.dealership_id);
    if (!dealer || !dealer.email || dealer.suspended) return;
    db.prepare('UPDATE conversations SET dealer_notified_at = ? WHERE id = ?').run(new Date(now).toISOString(), conversation.id);
    const preview = message && message.body ? String(message.body).slice(0, 300) : (message && message.has_attachments ? '[Attachment]' : '');
    sendDealerMessageEmail({
      email: dealer.email,
      dealerName: dealer.full_name,
      buyerFirstName: firstNameOf(buyer),
      carTitle: carTitleFor(conversation.vehicle_id),
      preview: preview,
      conversationId: conversation.id
    })
      .then(function () { console.log('Dealer email sent to ' + dealer.email + ' for conversation ' + conversation.id); })
      .catch(function (err) { console.error('Dealer message email failed:', err); });
  } catch (err) {
    console.error('notifyDealerOfNewMessage failed:', err);
  }
}

// Email the dealer about an inquiry, at most once per buyer per dealership per hour.
function notifyDealerOfInquiry(dealershipId, vehicleId, buyer, messageText, buyerPhone, createdAt) {
  try {
    const since = new Date(Date.now() - DEALER_NOTIFY_WINDOW_MS).toISOString();
    const prior = db
      .prepare('SELECT COUNT(*) AS c FROM inquiries WHERE dealership_id = ? AND LOWER(buyer_email) = ? AND created_at >= ? AND created_at < ?')
      .get(dealershipId, String(buyer.email || '').toLowerCase(), since, createdAt).c;
    if (prior > 0) {
      console.log('Dealer inquiry email skipped for dealership ' + dealershipId + ' (' + prior + ' inquiry from same buyer in the last hour)');
      return;
    }
    const dealer = db
      .prepare('SELECT d.id, d.business_name, d.suspended, u.email, u.full_name FROM dealerships d JOIN users u ON u.id = d.user_id WHERE d.id = ?')
      .get(dealershipId);
    if (!dealer || !dealer.email || dealer.suspended) return;
    sendDealerInquiryEmail({
      email: dealer.email,
      dealerName: dealer.full_name,
      buyerFirstName: firstNameOf(buyer),
      carTitle: carTitleFor(vehicleId),
      preview: String(messageText || '').slice(0, 500),
      buyerPhone: buyerPhone || ''
    })
      .then(function () { console.log('Dealer inquiry email sent to ' + dealer.email + ' for vehicle ' + vehicleId); })
      .catch(function (err) { console.error('Dealer inquiry email failed:', err); });
  } catch (err) {
    console.error('notifyDealerOfInquiry failed:', err);
  }
}

function escapeHtmlForEmail(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
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
    'SELECT id, email, full_name, password_hash, role, email_verified FROM users WHERE email = ?'
  ).get(email);

  if (!row || !bcrypt.compareSync(String(password), row.password_hash)) {
    return res.status(401).json({ error: 'Invalid email or password.' });
  }

  if (!row.email_verified) {
    return res.status(403).json({ error: 'Please verify your email before logging in. Enter the 6-digit code we emailed you.' });
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

  // Send verification email (non-blocking — don't fail signup if email fails)
  sendVerificationEmail(row).catch(err => console.error('Failed to send verification email:', err));

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
    "INSERT INTO dealerships (user_id, business_name, license_number, address, city, state, zip, phone, status, governorate, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)"
  );
  var selectDealership = db.prepare(
    'SELECT id, user_id, business_name, license_number, address, city, state, zip, phone, status, created_at FROM dealerships WHERE user_id = ?'
  );

  var createdAt = new Date().toISOString();
  var passwordHash = bcrypt.hashSync(password, 10);

  // Sequential creation (Turso-compatible; no explicit transaction).
  // If the dealership insert fails we clean up the user row manually.
  function createDealer() {
    insertUser.run(email, passwordHash, fullName, createdAt);
    var userRow = selectUser.get(email);
    try {
      insertDealership.run(
        userRow.id,
        businessName,
        licenseNumber,
        address,
        governorate,  // stored in city column for filter compatibility
        '',           // state not used for Egypt
        '',           // zip not used
        phone,
        governorate,
        createdAt
      );
    } catch (err) {
      // Roll back the user row so a retry with the same email works
      try { db.prepare('DELETE FROM users WHERE id = ?').run(userRow.id); } catch (_) {}
      throw err;
    }
    var dealerRow = selectDealership.get(userRow.id);
    return { userRow: userRow, dealerRow: dealerRow };
  }

  try {
    var result = createDealer();

    // Send verification email (non-blocking — don't fail signup if email fails)
    sendVerificationEmail(result.userRow).catch(err => console.error('Failed to send verification email:', err));

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

app.get('/api/auth/verify-email', function (req, res) {
  const token = String(req.query.token || '').trim();
  if (!token) return res.status(400).json({ error: 'Missing token' });

  const record = db.prepare(
    'SELECT * FROM email_verification_tokens WHERE token = ? AND used = 0'
  ).get(token);

  if (!record) return res.status(400).json({ error: 'Invalid or already used link.' });
  if (new Date(record.expires_at) < new Date()) {
    return res.status(400).json({ error: 'This link has expired. Please request a new one.' });
  }

  db.prepare('UPDATE users SET email_verified = 1 WHERE id = ?').run(record.user_id);
  db.prepare('UPDATE email_verification_tokens SET used = 1 WHERE id = ?').run(record.id);

  const user = db.prepare('SELECT id, email, full_name, role FROM users WHERE id = ?').get(record.user_id);
  const jwtToken = signToken(user);
  return res.json({ success: true, token: jwtToken, role: user.role });
});

app.post('/api/auth/resend-verification', function (req, res) {
  const email = normalizeEmail(req.body.email);
  if (!email) return res.status(400).json({ error: 'Email required' });

  const user = db.prepare('SELECT id, email, full_name, email_verified FROM users WHERE email = ?').get(email);
  if (!user) return res.status(200).json({ message: 'If that email exists, a code was sent.' }); // don't leak
  if (user.email_verified) return res.status(200).json({ message: 'Email already verified.' });

  sendVerificationEmail(user).catch(err => console.error(err));
  return res.status(200).json({ message: 'Verification email sent.' });
});

app.post('/api/auth/verify-otp', function (req, res) {
  const email = normalizeEmail(req.body.email);
  const code = String(req.body.code || '').trim();
  if (!email || !code) return res.status(400).json({ error: 'Email and code are required.' });

  const user = db.prepare('SELECT id, email, full_name, role FROM users WHERE email = ?').get(email);
  if (!user) return res.status(400).json({ error: 'Invalid code.' });

  const record = db.prepare(
    'SELECT * FROM email_verification_tokens WHERE user_id = ? AND token = ? AND used = 0 ORDER BY id DESC LIMIT 1'
  ).get(user.id, code);

  if (!record) return res.status(400).json({ error: 'Invalid or expired code.' });
  if (new Date(record.expires_at) < new Date()) return res.status(400).json({ error: 'Code has expired. Please request a new one.' });

  db.prepare('UPDATE users SET email_verified = 1 WHERE id = ?').run(user.id);
  db.prepare('UPDATE email_verification_tokens SET used = 1 WHERE id = ?').run(record.id);

  const token = signToken(user);
  return res.json({
    success: true,
    token,
    role: user.role,
    user: { id: user.id, email: user.email, full_name: user.full_name, role: user.role }
  });
});

// Forgot password: always answers the same way so email addresses cannot be enumerated.
const forgotPasswordAttempts = new Map(); // email -> [timestamps]
app.post('/api/auth/forgot-password', function (req, res) {
  const email = normalizeEmail(req.body && req.body.email);
  if (!email) return res.status(400).json({ error: 'Email is required.' });
  const generic = { message: 'If an account exists for that email, a reset code has been sent.' };

  // Light rate limit: 3 codes per email per 15 minutes (still answers generically).
  const now = Date.now();
  const recent = (forgotPasswordAttempts.get(email) || []).filter(function (t) { return now - t < 15 * 60 * 1000; });
  if (recent.length >= 3) return res.json(generic);
  recent.push(now);
  forgotPasswordAttempts.set(email, recent);

  const user = db.prepare('SELECT id, email, full_name FROM users WHERE email = ?').get(email);
  if (!user) return res.json(generic);

  const code = Math.floor(100000 + Math.random() * 900000).toString();
  const expiresAt = new Date(now + 15 * 60 * 1000).toISOString();
  db.prepare('UPDATE password_reset_tokens SET used = 1 WHERE user_id = ? AND used = 0').run(user.id);
  db.prepare('INSERT INTO password_reset_tokens (user_id, token, expires_at, created_at) VALUES (?, ?, ?, ?)')
    .run(user.id, code, expiresAt, new Date(now).toISOString());
  sendPasswordResetEmail(user, code).catch(function (err) { console.error('Failed to send password reset email:', err); });
  return res.json(generic);
});

app.post('/api/auth/reset-password', function (req, res) {
  const email = normalizeEmail(req.body && req.body.email);
  const code = String((req.body && req.body.code) || '').trim();
  const password = String((req.body && req.body.password) || '');
  if (!email || !code) return res.status(400).json({ error: 'Email and code are required.' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });

  const user = db.prepare('SELECT id, email FROM users WHERE email = ?').get(email);
  if (!user) return res.status(400).json({ error: 'Invalid or expired code.' });
  const record = db
    .prepare('SELECT id, expires_at FROM password_reset_tokens WHERE user_id = ? AND token = ? AND used = 0 ORDER BY id DESC LIMIT 1')
    .get(user.id, code);
  if (!record) return res.status(400).json({ error: 'Invalid or expired code.' });
  if (new Date(record.expires_at) < new Date()) return res.status(400).json({ error: 'Invalid or expired code.' });

  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(password, 10), user.id);
  db.prepare('UPDATE password_reset_tokens SET used = 1 WHERE user_id = ?').run(user.id);
  return res.json({ success: true });
});

// Admin: list dealer applications (pending by default)
app.get('/api/admin/applications', requireAdmin, function (req, res) {
  var status = String(req.query.status || 'pending').toLowerCase();
  var allowed = { pending: true, approved: true, rejected: true, suspended: true, all: true };
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
      d.plan AS plan,
      d.listing_limit,
      d.suspended,
      d.suspension_reason,
      d.suspended_at,
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
  } else if (status === 'suspended') {
    rows = db.prepare(baseSql + ' WHERE COALESCE(d.suspended, 0) = 1 ORDER BY d.suspended_at DESC').all();
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
      approved_at: r.approved_at,
      rejection_reason: r.rejection_reason,
      plan: r.plan || 'basic',
      listing_limit: r.listing_limit != null ? r.listing_limit : DEALER_PLANS.basic.listing_limit,
      suspended: !!r.suspended,
      suspension_reason: r.suspension_reason || null,
      suspended_at: r.suspended_at || null,
      created_at: r.created_at,
      user_created_at: r.user_created_at,
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
  sendDealerDecisionEmail(id, 'approved', null).catch(function (err) {
    console.error('Failed to send approval email:', err);
  });
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
  sendDealerDecisionEmail(id, 'rejected', reason).catch(function (err) {
    console.error('Failed to send rejection email:', err);
  });
  return res.json({ dealership: updated });
});

// Admin: suspend / unsuspend a dealership. Only the flag changes; listings keep their status
// and reappear untouched when the dealer is unsuspended.
function setDealershipSuspended(req, res, suspended) {
  var id = Number(req.params.id);
  var reason = req.body && req.body.reason ? String(req.body.reason).trim().slice(0, 500) : null;
  var row = db
    .prepare('SELECT d.id, d.business_name, d.suspended, u.email, u.full_name FROM dealerships d JOIN users u ON u.id = d.user_id WHERE d.id = ?')
    .get(id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  if (suspended) {
    db.prepare('UPDATE dealerships SET suspended = 1, suspension_reason = ?, suspended_at = ? WHERE id = ?')
      .run(reason, new Date().toISOString(), id);
  } else {
    db.prepare('UPDATE dealerships SET suspended = 0, suspension_reason = NULL, suspended_at = NULL WHERE id = ?').run(id);
  }
  sendSuspensionEmail({ kind: 'dealer', email: row.email, name: row.full_name, businessName: row.business_name, suspended: suspended, reason: reason })
    .catch(function (err) { console.error('Failed to send suspension email:', err); });
  var updated = db
    .prepare('SELECT id, business_name, status, suspended, suspension_reason, suspended_at FROM dealerships WHERE id = ?')
    .get(id);
  updated.suspended = !!updated.suspended;
  return res.json({ dealership: updated });
}
app.patch('/api/admin/dealerships/:id/suspend', requireAdmin, function (req, res) {
  return setDealershipSuspended(req, res, true);
});
app.patch('/api/admin/dealerships/:id/unsuspend', requireAdmin, function (req, res) {
  return setDealershipSuspended(req, res, false);
});

// Admin: find buyers (by email) or list suspended buyers
// Integer-safe pagination params: a REAL bound to LIMIT/OFFSET makes SQLite throw "datatype mismatch".
function pageParams(query, defaultLimit, maxLimit) {
  var limit = Math.floor(Number(query.limit));
  if (!Number.isFinite(limit) || limit < 1) limit = defaultLimit;
  if (limit > maxLimit) limit = maxLimit;
  var page = Math.floor(Number(query.page));
  if (!Number.isFinite(page) || page < 1) page = 1;
  if (page > 1000000) page = 1000000;
  return { limit: limit, page: page };
}

// Admin: paginated user directory (buyers, dealers, admins) with search and role/suspended tabs.
app.get('/api/admin/users', requireAdmin, function (req, res) {
  var role = String(req.query.role || '').toLowerCase();
  // Legacy params from the old Dealers-page buyer search.
  if (!role && String(req.query.suspended || '') === '1') role = 'suspended';
  var q = String(req.query.q || req.query.email || '').trim().toLowerCase();
  var allowed = { all: true, buyer: true, dealer: true, admin: true, suspended: true };
  if (!allowed[role]) role = 'all';
  var paging = pageParams(req.query, 25, 100);
  var limit = paging.limit;
  var page = paging.page;

  var where = ' WHERE 1 = 1';
  var params = [];
  if (role === 'suspended') where += ' AND (COALESCE(u.suspended, 0) = 1 OR COALESCE(d.suspended, 0) = 1)';
  else if (role !== 'all') { where += ' AND u.role = ?'; params.push(role); }
  if (q) {
    var like = '%' + q.replace(/[%_\\]/g, function (ch) { return '\\' + ch; }) + '%';
    where += " AND (LOWER(u.email) LIKE ? ESCAPE '\\' OR LOWER(COALESCE(u.full_name, '')) LIKE ? ESCAPE '\\' OR LOWER(COALESCE(d.business_name, '')) LIKE ? ESCAPE '\\')";
    params.push(like, like, like);
  }
  var from = ' FROM users u LEFT JOIN dealerships d ON d.user_id = u.id';
  var countStmt = db.prepare('SELECT COUNT(*) AS n' + from + where);
  var total = countStmt.get.apply(countStmt, params).n;
  var listStmt = db.prepare(
    'SELECT u.id, u.email, u.full_name, u.role, COALESCE(u.email_verified, 0) AS email_verified, u.auth_provider,' +
    ' COALESCE(u.suspended, 0) AS suspended, u.suspension_reason, u.suspended_at, u.created_at,' +
    ' d.id AS dealership_id, d.business_name, d.status AS dealership_status, COALESCE(d.suspended, 0) AS dealership_suspended,' +
    ' (SELECT COUNT(*) FROM saved_cars s WHERE s.buyer_id = u.id) AS saved_cars_count,' +
    ' (SELECT COUNT(*) FROM conversations c WHERE c.buyer_id = u.id) AS conversations_count' +
    from + where + ' ORDER BY datetime(u.created_at) DESC, u.id DESC LIMIT ? OFFSET ?'
  );
  var rows = listStmt.all.apply(listStmt, params.concat([limit, (page - 1) * limit]));

  var counts = { all: 0, buyer: 0, dealer: 0, admin: 0, suspended: 0 };
  db.prepare('SELECT role, COUNT(*) AS n FROM users GROUP BY role').all().forEach(function (r) {
    counts[r.role] = Number(r.n); counts.all += Number(r.n);
  });
  counts.suspended = db.prepare('SELECT COUNT(*) AS n FROM users u LEFT JOIN dealerships d ON d.user_id = u.id WHERE COALESCE(u.suspended, 0) = 1 OR COALESCE(d.suspended, 0) = 1').get().n;

  res.set('Cache-Control', 'no-store');
  return res.json({
    users: rows.map(function (u) {
      return {
        id: u.id,
        email: u.email,
        full_name: u.full_name,
        role: u.role,
        email_verified: !!Number(u.email_verified),
        auth_provider: u.auth_provider || 'email',
        created_at: u.created_at,
        suspended: !!Number(u.suspended) || (u.role === 'dealer' && !!Number(u.dealership_suspended)),
        suspension_reason: u.suspension_reason || null,
        suspended_at: u.suspended_at || null,
        saved_cars_count: u.role === 'buyer' ? Number(u.saved_cars_count) || 0 : null,
        conversations_count: u.role === 'buyer' ? Number(u.conversations_count) || 0 : null,
        dealership: u.dealership_id
          ? { id: u.dealership_id, business_name: u.business_name, status: u.dealership_status, suspended: !!Number(u.dealership_suspended) }
          : null
      };
    }),
    total: total, page: page, limit: limit, pages: Math.max(1, Math.ceil(total / limit)),
    counts: counts
  });
});

// Admin: manually mark an email as verified (support cases where the code never arrives).
app.post('/api/admin/users/:id/verify', requireAdmin, function (req, res) {
  var id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: 'Invalid user id' });
  var user = db.prepare('SELECT id, email, full_name, role, COALESCE(email_verified, 0) AS email_verified FROM users WHERE id = ?').get(id);
  if (!user) return res.status(404).json({ error: 'Not found' });
  var already = !!Number(user.email_verified);
  if (!already) {
    db.prepare('UPDATE users SET email_verified = 1 WHERE id = ?').run(id);
    db.prepare('UPDATE email_verification_tokens SET used = 1 WHERE user_id = ? AND used = 0').run(id);
    console.log('Admin', req.user.email, 'manually verified user', id, user.email);
  }
  return res.json({ user: { id: user.id, email: user.email, full_name: user.full_name, role: user.role, email_verified: true }, already_verified: already });
});

// ---- Invitations -------------------------------------------------------------
var INVITE_DAILY_LIMIT = 50;
var INVITE_MAX_PER_REQUEST = 50;

function inviteWindowStart() {
  return new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
}
function invitesSentInWindow() {
  return db.prepare("SELECT COUNT(*) AS n FROM invitations WHERE datetime(invited_at) >= datetime(?) AND status != 'failed'").get(inviteWindowStart()).n;
}
// Mark invitations whose email has since registered (any role) so the list reflects reality.
function refreshInvitationRegistrations() {
  db.prepare(
    "UPDATE invitations SET status = 'registered', registered_at = (SELECT u.created_at FROM users u WHERE u.email = invitations.email LIMIT 1)" +
    " WHERE status != 'registered' AND EXISTS (SELECT 1 FROM users u WHERE u.email = invitations.email)"
  ).run();
}
function parseInviteEmails(raw) {
  var list = Array.isArray(raw) ? raw : String(raw || '').split(/[\s,;]+/);
  var seen = {};
  var valid = [];
  var invalid = [];
  list.forEach(function (e) {
    var email = normalizeEmail(e);
    if (!email) return;
    if (seen[email]) return;
    seen[email] = true;
    if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) && email.length <= 254) valid.push(email);
    else invalid.push(email);
  });
  return { valid: valid, invalid: invalid };
}
async function sendInvitationEmail(opts) {
  var role = opts.role === 'dealer' ? 'dealer' : 'buyer';
  var link = opts.base + (role === 'dealer' ? '/dealer/signup.html' : '/buyer/signup.html') + '?email=' + encodeURIComponent(opts.email) + '&invite=1';
  var pitch = role === 'dealer'
    ? '<p>CarFox is a marketplace where verified dealers list their cars to buyers across Egypt. As a dealer you get a storefront, buyer messages and WhatsApp leads, and inventory insights.</p>' +
      '<p>Create your dealer account below. Applications are reviewed by our team before listings go live.</p>'
    : '<p>CarFox is where buyers in Egypt browse cars from verified dealers only: save favourites, filter by governorate, and message dealers directly.</p>' +
      '<p>Create your free buyer account below to get started.</p>';
  var result = await resend.emails.send({
    from: 'CarFox <noreply@mawtiq.online>',
    to: opts.email,
    subject: "You've been invited to join CarFox",
    html: emailShell(
      "You've been invited to join CarFox",
      '<p>Hi there,</p>' +
      '<p>' + escapeHtmlForEmail(opts.inviterName || 'The CarFox team') + ' has invited you to join CarFox as a ' + (role === 'dealer' ? '<strong>dealer</strong>' : '<strong>buyer</strong>') + '.</p>' +
      pitch +
      '<p><a href="' + escapeHtmlForEmail(link) + '" style="display:inline-block;background:#1d4ed8;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:bold">' + (role === 'dealer' ? 'Apply as a dealer' : 'Create my account') + '</a></p>' +
      '<p style="color:#999;font-size:13px">Or copy this link into your browser: ' + escapeHtmlForEmail(link) + '</p>' +
      '<p style="color:#999;font-size:13px">If you were not expecting this invitation, you can ignore this email.</p>'
    )
  });
  // The Resend SDK resolves with { data: null, error } on API failures (bad key, unverified domain,
  // rejected recipient, Resend's own rate limit) instead of throwing, so turn that into a failure.
  if (!result || result.error || !result.data) {
    var err = new Error((result && result.error && (result.error.message || result.error.name)) || 'Email send failed');
    if (result && result.error) { err.code = result.error.name; err.statusCode = result.error.statusCode; }
    throw err;
  }
  return result.data;
}

// Signup links must point at a host we control: APP_URL, or, when it is unset, the request host
// only if it is localhost or a *.onrender.com service. Never an arbitrary Host header.
function invitationBaseUrl(req) {
  var configured = appBaseUrl();
  if (configured) return configured;
  var host = String(req.get('host') || '').toLowerCase();
  if (/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host) || /^[a-z0-9-]+\.onrender\.com$/.test(host)) return req.protocol + '://' + host;
  return '';
}

// Admin: list invitations (newest first) with registration status.
app.get('/api/admin/invitations', requireAdmin, function (req, res) {
  refreshInvitationRegistrations();
  var limit = pageParams(req.query, 100, 500).limit;
  var rows = db
    .prepare(
      'SELECT i.id, i.email, i.role, i.invited_at, i.status, i.error, i.registered_at, i.invited_by, g.send_count,' +
      ' a.email AS invited_by_email, u.id AS user_id, u.role AS registered_role, COALESCE(u.email_verified, 0) AS registered_verified' +
      ' FROM invitations i' +
      ' JOIN (SELECT email, MAX(id) AS max_id, COUNT(*) AS send_count FROM invitations GROUP BY email) g ON g.max_id = i.id' +
      ' LEFT JOIN users a ON a.id = i.invited_by LEFT JOIN users u ON u.email = i.email' +
      ' ORDER BY datetime(i.invited_at) DESC, i.id DESC LIMIT ?'
    )
    .all(limit);
  var sent = invitesSentInWindow();
  res.set('Cache-Control', 'no-store');
  return res.json({
    invitations: rows.map(function (r) {
      return {
        id: r.id, email: r.email, role: r.role, invited_at: r.invited_at, status: r.status, error: r.error || null,
        send_count: Number(r.send_count) || 1,
        invited_by_email: r.invited_by_email || null,
        registered: r.status === 'registered' || !!r.user_id,
        registered_at: r.registered_at || null,
        registered_role: r.registered_role || null,
        registered_verified: !!Number(r.registered_verified),
        user_id: r.user_id || null
      };
    }),
    sent_last_24h: sent, daily_limit: INVITE_DAILY_LIMIT, remaining_today: Math.max(0, INVITE_DAILY_LIMIT - sent)
  });
});

// Admin: send invitation emails. Body: { emails: "a@x.com, b@y.com" | [...], role: "buyer" | "dealer" }.
app.post('/api/admin/invitations', requireAdmin, async function (req, res) {
  var body = req.body || {};
  var role = String(body.role || '').toLowerCase();
  if (role !== 'buyer' && role !== 'dealer') return res.status(400).json({ error: 'Role must be buyer or dealer' });
  var parsed = parseInviteEmails(body.emails);
  if (!parsed.valid.length && !parsed.invalid.length) return res.status(400).json({ error: 'Enter at least one email address' });
  if (parsed.valid.length > INVITE_MAX_PER_REQUEST) {
    return res.status(400).json({ error: 'At most ' + INVITE_MAX_PER_REQUEST + ' addresses per request' });
  }

  // Skip addresses that already have an account.
  var toSend = [];
  var alreadyRegistered = [];
  parsed.valid.forEach(function (email) {
    var existing = db.prepare('SELECT id, role FROM users WHERE email = ?').get(email);
    if (existing) alreadyRegistered.push({ email: email, role: existing.role });
    else toSend.push(email);
  });

  var sentSoFar = invitesSentInWindow();
  if (toSend.length && sentSoFar + toSend.length > INVITE_DAILY_LIMIT) {
    return res.status(429).json({
      error: 'Daily invite limit reached: ' + sentSoFar + ' of ' + INVITE_DAILY_LIMIT + ' sent in the last 24 hours, ' +
        Math.max(0, INVITE_DAILY_LIMIT - sentSoFar) + ' left. Try again later or send fewer addresses.',
      sent_last_24h: sentSoFar, daily_limit: INVITE_DAILY_LIMIT
    });
  }

  var base = invitationBaseUrl(req);
  if (!base) return res.status(503).json({ error: 'APP_URL is not configured on the server, so invitation links cannot be built.' });
  var now = new Date().toISOString();
  var inviter = req.user;
  var results = await Promise.all(toSend.map(async function (email) {
    // Re-check right before writing so two concurrent requests cannot both slip past the pre-check
    // (not atomic without transactions, but closes the double-submit case within this process).
    if (invitesSentInWindow() >= INVITE_DAILY_LIMIT) {
      return { email: email, status: 'failed', error: 'Daily invite limit reached' };
    }
    // Append-only: every send is its own row, so the 24h limit counts emails actually sent.
    // The list endpoint collapses rows to the latest per address.
    var rowId = db.prepare("INSERT INTO invitations (email, role, invited_by, invited_at, status) VALUES (?, ?, ?, ?, 'sending')").run(email, role, inviter.id, now).lastInsertRowid;
    try {
      await sendInvitationEmail({ email: email, role: role, base: base, inviterName: inviter.full_name });
      db.prepare("UPDATE invitations SET status = 'sent', error = NULL WHERE id = ?").run(rowId);
      return { email: email, status: 'sent' };
    } catch (err) {
      var msg = String(err && err.message ? err.message : err).slice(0, 300);
      db.prepare("UPDATE invitations SET status = 'failed', error = ? WHERE id = ?").run(msg, rowId);
      console.error('Invitation email failed for', email, msg);
      return { email: email, status: 'failed', error: msg };
    }
  }));

  var sent = results.filter(function (r) { return r.status === 'sent'; });
  var failed = results.filter(function (r) { return r.status === 'failed'; });
  console.log('Admin', inviter.email, 'sent', sent.length, role, 'invitation(s)', failed.length ? '(' + failed.length + ' failed)' : '');
  return res.json({
    sent: sent.map(function (r) { return r.email; }),
    failed: failed,
    already_registered: alreadyRegistered,
    invalid: parsed.invalid,
    sent_last_24h: invitesSentInWindow(), daily_limit: INVITE_DAILY_LIMIT
  });
});

// Admin: suspend / unsuspend a buyer
function setBuyerSuspended(req, res, suspended) {
  var id = Number(req.params.id);
  var reason = req.body && req.body.reason ? String(req.body.reason).trim().slice(0, 500) : null;
  var user = db.prepare('SELECT id, email, full_name, role FROM users WHERE id = ?').get(id);
  if (!user) return res.status(404).json({ error: 'Not found' });
  if (user.role !== 'buyer') return res.status(400).json({ error: 'Only buyer accounts can be suspended here' });
  if (suspended) {
    db.prepare('UPDATE users SET suspended = 1, suspension_reason = ?, suspended_at = ? WHERE id = ?')
      .run(reason, new Date().toISOString(), id);
  } else {
    db.prepare('UPDATE users SET suspended = 0, suspension_reason = NULL, suspended_at = NULL WHERE id = ?').run(id);
  }
  sendSuspensionEmail({ kind: 'buyer', email: user.email, name: user.full_name, suspended: suspended, reason: reason })
    .catch(function (err) { console.error('Failed to send suspension email:', err); });
  var updated = db.prepare('SELECT id, email, full_name, role, suspended, suspension_reason, suspended_at FROM users WHERE id = ?').get(id);
  updated.suspended = !!updated.suspended;
  return res.json({ user: updated });
}
app.patch('/api/admin/users/:id/suspend', requireAdmin, function (req, res) {
  return setBuyerSuspended(req, res, true);
});
app.patch('/api/admin/users/:id/unsuspend', requireAdmin, function (req, res) {
  return setBuyerSuspended(req, res, false);
});

// Admin: management list of approved dealerships (plan usage, views, suspension)
app.get('/api/admin/dealers', requireAdmin, function (req, res) {
  var rows = db
    .prepare(
      `SELECT
         d.id, d.business_name, d.phone, d.city, d.governorate, d.created_at,
         d.plan AS plan, d.listing_limit, d.suspended, d.suspension_reason, d.suspended_at,
         u.id AS user_id, u.email AS owner_email, u.full_name AS owner_name,
         (SELECT COUNT(*) FROM vehicles v WHERE v.dealership_id = d.id AND v.status IN ('active', 'paused', 'sold')) AS listings_used,
         (SELECT COUNT(*) FROM vehicles v WHERE v.dealership_id = d.id AND v.status = 'active') AS active_listings,
         (SELECT COALESCE(SUM(v.views), 0) FROM vehicles v WHERE v.dealership_id = d.id) AS total_views,
         (SELECT COUNT(*) FROM engagement_events e WHERE e.dealership_id = d.id AND e.created_at >= ?) AS engagements_30d
       FROM dealerships d
       JOIN users u ON u.id = d.user_id
       WHERE d.status = 'approved'
       ORDER BY d.business_name COLLATE NOCASE ASC`
    )
    .all(new Date(Date.now() - ENGAGEMENT_WINDOW_MS).toISOString());
  return res.json({
    dealers: rows.map(function (r) {
      return {
        id: r.id,
        user_id: r.user_id,
        business_name: r.business_name,
        owner_email: r.owner_email,
        owner_name: r.owner_name,
        phone: r.phone,
        governorate: r.governorate || r.city || null,
        created_at: r.created_at,
        plan: r.plan || 'basic',
        listing_limit: r.listing_limit != null ? r.listing_limit : DEALER_PLANS.basic.listing_limit,
        listings_used: r.listings_used,
        active_listings: r.active_listings,
        total_views: r.total_views,
        engagements_30d: r.engagements_30d,
        suspended: !!r.suspended,
        suspension_reason: r.suspension_reason || null,
        suspended_at: r.suspended_at || null
      };
    })
  });
});

// Admin: set a dealership's membership plan and listing limit
app.patch('/api/admin/dealerships/:id/plan', requireAdmin, function (req, res) {
  var id = Number(req.params.id);
  var body = req.body || {};
  var plan = String(body.plan || '').trim().toLowerCase();
  if (!DEALER_PLANS[plan]) {
    return res.status(400).json({ error: 'plan must be one of: ' + Object.keys(DEALER_PLANS).join(', ') });
  }
  var limit;
  if (plan === 'custom') {
    limit = Number(body.listing_limit);
    if (!Number.isInteger(limit) || limit < 0 || limit > 100000) {
      return res.status(400).json({ error: 'listing_limit must be a whole number between 0 and 100000' });
    }
  } else {
    limit = DEALER_PLANS[plan].listing_limit;
  }
  var row = db.prepare('SELECT id FROM dealerships WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  db.prepare('UPDATE dealerships SET plan = ?, listing_limit = ? WHERE id = ?').run(plan, limit, id);
  var updated = db.prepare('SELECT id, business_name, status, plan AS plan, listing_limit FROM dealerships WHERE id = ?').get(id);
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
    .prepare('SELECT id, email, full_name, role, phone, created_at, avatar_url, suspended, suspension_reason, suspended_at FROM users WHERE id = ?')
    .get(decoded.sub);
  if (!user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (user.role === 'dealer') {
    const d = db
      .prepare(
        'SELECT id, business_name, status, phone, address, city, governorate, whatsapp, plan AS plan, listing_limit, suspended, suspension_reason, suspended_at, logo_url, website, lat, lng FROM dealerships WHERE user_id = ?'
      )
      .get(user.id);
    return res.json({
      user: {
        id: user.id,
        email: user.email,
        full_name: user.full_name,
        role: user.role,
        avatar_url: user.avatar_url || null,
        created_at: user.created_at,
        suspended: !!user.suspended,
        suspension_reason: user.suspension_reason || null
      },
      dealership: d
        ? {
            id: d.id,
            business_name: d.business_name,
            status: d.status,
            phone: d.phone || null,
            address: d.address || null,
            governorate: (d.governorate || d.city) || null,
            whatsapp: d.whatsapp || null,
            plan: d.plan || 'basic',
            listing_limit: d.listing_limit != null ? d.listing_limit : DEALER_PLANS.basic.listing_limit,
            suspended: !!d.suspended,
            suspension_reason: d.suspension_reason || null,
            suspended_at: d.suspended_at || null,
            logo_url: d.logo_url || null,
            website: d.website || null,
            lat: d.lat != null ? d.lat : null,
            lng: d.lng != null ? d.lng : null
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
    created_at: user.created_at,
    suspended: !!user.suspended,
    suspension_reason: user.suspension_reason || null
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
  if (governorate !== null) {
    updates.push('city = ?');
    updates.push('governorate = ?');
    params.push(governorate || null);
    params.push(governorate || null);
  }

  if (body.website !== undefined) {
    const raw = body.website == null ? '' : String(body.website).trim();
    let website = null;
    if (raw) {
      const candidate = /^https?:\/\//i.test(raw) ? raw : 'https://' + raw;
      try {
        const u = new URL(candidate);
        if (!/^https?:$/.test(u.protocol) || u.hostname.indexOf('.') === -1) throw new Error('bad');
        website = u.toString();
      } catch (_) {
        return res.status(400).json({ error: 'Website must be a valid URL, e.g. https://example.com' });
      }
    }
    updates.push('website = ?');
    params.push(website);
  }
  if (body.lat !== undefined || body.lng !== undefined) {
    if (body.lat == null || body.lat === '' || body.lng == null || body.lng === '') {
      updates.push('lat = NULL');
      updates.push('lng = NULL');
    } else {
      const lat = Number(body.lat);
      const lng = Number(body.lng);
      if (!isFinite(lat) || !isFinite(lng) || lat < 21 || lat > 32.5 || lng < 24 || lng > 37) {
        return res.status(400).json({ error: 'Location must be inside Egypt' });
      }
      updates.push('lat = ?');
      params.push(Math.round(lat * 1e6) / 1e6);
      updates.push('lng = ?');
      params.push(Math.round(lng * 1e6) / 1e6);
    }
  }

  if (!updates.length) return res.status(400).json({ error: 'Nothing to update' });

  params.push(dealership.id);
  db.prepare('UPDATE dealerships SET ' + updates.join(', ') + ' WHERE id = ?').run(...params);
  const updated = db
    .prepare('SELECT business_name, phone, address, city, governorate, whatsapp, website, lat, lng, logo_url FROM dealerships WHERE id = ?')
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

// Upload / replace the dealership logo (stored in R2 like avatars)
app.post('/api/dealer/logo', function (req, res, next) {
  photoUpload.single('logo')(req, res, function (err) {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: 'Logo must be 10 MB or smaller' });
      return res.status(400).json({ error: err.message || 'Upload error' });
    }
    next();
  });
}, requireDealer, async function (req, res) {
  if (!req.file) return res.status(400).json({ error: 'No logo provided' });
  if (!r2Configured()) return res.status(503).json({ error: 'File storage not configured' });

  const current = db.prepare('SELECT logo_url FROM dealerships WHERE id = ?').get(req.dealership.id);
  if (current && current.logo_url) {
    const oldKey = publicUrlToKey(current.logo_url);
    if (oldKey) {
      try { await r2.send(new DeleteObjectCommand({ Bucket: r2Bucket, Key: oldKey })); } catch (_) { /* ignore */ }
    }
  }

  let pngBuffer;
  try {
    pngBuffer = await sharp(req.file.buffer)
      .resize(512, 512, { fit: 'inside', withoutEnlargement: true })
      .png({ compressionLevel: 9 })
      .toBuffer();
  } catch (e) {
    return res.status(400).json({ error: 'Could not process image' });
  }

  const key = 'dealer-logos/' + req.dealership.id + '/' + Date.now() + '.png';
  const publicBase = String(r2PublicUrl).replace(/\/$/, '');
  try {
    await r2.send(new PutObjectCommand({ Bucket: r2Bucket, Key: key, Body: pngBuffer, ContentType: 'image/png' }));
  } catch (e) {
    console.error('R2 PutObject failed for dealer logo:', e.message);
    return res.status(500).json({ error: 'Upload failed' });
  }
  const logoUrl = publicBase + '/' + key;
  db.prepare('UPDATE dealerships SET logo_url = ? WHERE id = ?').run(logoUrl, req.dealership.id);
  return res.json({ logo_url: logoUrl });
});

// Short admin URL -> admin dashboard
app.get('/admin', function (req, res) {
  return res.redirect('/admin/index.html');
});

// Admin dashboard: every number the overview page needs, in one request.
// Timestamps in the DB are a mix of ISO strings and SQLite 'YYYY-MM-DD HH:MM:SS' defaults,
// so comparisons go through datetime() which understands both.
// Admin: paginated listing management (all statuses), with search and governorate filter.
app.get('/api/admin/listings', requireAdmin, function (req, res) {
  const status = String(req.query.status || 'all').toLowerCase();
  const allowed = { all: true, active: true, paused: true, sold: true, draft: true, archived: true };
  const q = String(req.query.q || '').trim().toLowerCase();
  const governorate = String(req.query.governorate || '').trim();
  const paging = pageParams(req.query, 25, 100);
  const limit = paging.limit;
  const page = paging.page;

  let where = ' WHERE 1 = 1';
  const params = [];
  if (allowed[status] && status !== 'all') { where += ' AND v.status = ?'; params.push(status); }
  if (q) {
    const like = '%' + q.replace(/[%_\\]/g, function (ch) { return '\\' + ch; }) + '%';
    where += " AND (LOWER(COALESCE(v.year, '') || ' ' || COALESCE(v.make, '') || ' ' || COALESCE(v.model, '') || ' ' || COALESCE(v.trim, '')) LIKE ? ESCAPE '\\'" +
      " OR LOWER(d.business_name) LIKE ? ESCAPE '\\')";
    params.push(like, like);
  }
  if (governorate) { where += ' AND COALESCE(d.governorate, d.city) = ?'; params.push(governorate); }

  const from = ' FROM vehicles v JOIN dealerships d ON d.id = v.dealership_id';
  const total = db.prepare('SELECT COUNT(*) AS n' + from + where).get(...params).n;
  const since30 = new Date(Date.now() - ENGAGEMENT_WINDOW_MS).toISOString();
  const rows = db
    .prepare(
      'SELECT v.id, v.year, v.make, v.model, v.trim, v.price, v.status, COALESCE(v.views, 0) AS views,' +
      ' v.created_at, v.published_at, v.updated_at, COALESCE(v.admin_paused, 0) AS admin_paused, v.admin_pause_reason, v.admin_paused_at,' +
      ' d.id AS dealership_id, d.business_name AS dealer_name, COALESCE(d.governorate, d.city) AS governorate,' +
      ' (SELECT p.url FROM vehicle_photos p WHERE p.vehicle_id = v.id ORDER BY p.is_primary DESC, p.display_order ASC LIMIT 1) AS photo_url,' +
      ' (SELECT COUNT(*) FROM vehicle_photos p WHERE p.vehicle_id = v.id) AS photo_count,' +
      ' (SELECT COUNT(*) FROM engagement_events e WHERE e.vehicle_id = v.id AND e.created_at >= ?) AS engagements_30d' +
      from + where +
      ' ORDER BY datetime(v.created_at) DESC, v.id DESC LIMIT ? OFFSET ?'
    )
    .all(since30, ...params, limit, (page - 1) * limit);

  const counts = { all: 0 };
  db.prepare('SELECT status, COUNT(*) AS n FROM vehicles GROUP BY status').all().forEach(function (r) {
    counts[r.status] = Number(r.n); counts.all += Number(r.n);
  });
  const governorates = db
    .prepare("SELECT DISTINCT COALESCE(d.governorate, d.city) AS g FROM vehicles v JOIN dealerships d ON d.id = v.dealership_id WHERE COALESCE(d.governorate, d.city) IS NOT NULL AND COALESCE(d.governorate, d.city) != '' ORDER BY g COLLATE NOCASE")
    .all().map(function (r) { return r.g; });

  res.set('Cache-Control', 'no-store');
  return res.json({
    listings: rows.map(function (r) { return Object.assign({}, r, { admin_paused: !!Number(r.admin_paused), title: vehicleTitle(r) }); }),
    total: total, page: page, limit: limit, pages: Math.max(1, Math.ceil(total / limit)),
    counts: counts, governorates: governorates
  });
});

// Admin: force-pause a listing for a policy reason. The dealer cannot resume it.
app.post('/api/admin/listings/:id/unpublish', requireAdmin, function (req, res) {
  const id = Number(req.params.id);
  const reason = String((req.body || {}).reason || '').trim();
  if (!id) return res.status(400).json({ error: 'Invalid listing id' });
  if (!reason) return res.status(400).json({ error: 'A reason is required' });
  if (reason.length > 500) return res.status(400).json({ error: 'Reason is too long (max 500 characters)' });
  const v = db.prepare('SELECT * FROM vehicles WHERE id = ?').get(id);
  if (!v) return res.status(404).json({ error: 'Listing not found' });
  if (v.status !== 'active' && v.status !== 'paused') {
    return res.status(400).json({ error: 'Only active or paused listings can be unpublished' });
  }
  const now = new Date().toISOString();
  db.prepare("UPDATE vehicles SET status = 'paused', admin_paused = 1, admin_pause_reason = ?, admin_paused_at = ?, updated_at = ? WHERE id = ?")
    .run(reason, now, now, id);
  const owner = db.prepare('SELECT u.email, u.full_name, d.business_name FROM dealerships d JOIN users u ON u.id = d.user_id WHERE d.id = ?').get(v.dealership_id);
  if (owner) {
    sendListingModerationEmail({ email: owner.email, dealerName: owner.full_name || owner.business_name, carTitle: vehicleTitle(v), reason: reason, unpublished: true })
      .catch(function (err) { console.error('Failed to send listing unpublished email:', err); });
  }
  return res.json({ vehicle: db.prepare('SELECT * FROM vehicles WHERE id = ?').get(id) });
});

// Admin: undo an admin pause and put the listing back live.
app.post('/api/admin/listings/:id/republish', requireAdmin, function (req, res) {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: 'Invalid listing id' });
  const v = db.prepare('SELECT * FROM vehicles WHERE id = ?').get(id);
  if (!v) return res.status(404).json({ error: 'Listing not found' });
  if (!Number(v.admin_paused)) return res.status(400).json({ error: 'This listing was not paused by an admin' });
  const now = new Date().toISOString();
  db.prepare("UPDATE vehicles SET status = 'active', admin_paused = 0, admin_pause_reason = NULL, admin_paused_at = NULL, updated_at = ? WHERE id = ?")
    .run(now, id);
  const owner = db.prepare('SELECT u.email, u.full_name, d.business_name FROM dealerships d JOIN users u ON u.id = d.user_id WHERE d.id = ?').get(v.dealership_id);
  if (owner) {
    sendListingModerationEmail({ email: owner.email, dealerName: owner.full_name || owner.business_name, carTitle: vehicleTitle(v), unpublished: false })
      .catch(function (err) { console.error('Failed to send listing republished email:', err); });
  }
  return res.json({ vehicle: db.prepare('SELECT * FROM vehicles WHERE id = ?').get(id) });
});

// Admin: hard delete a listing (spam / scam), including its photos in R2.
app.delete('/api/admin/listings/:id', requireAdmin, async function (req, res) {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: 'Invalid listing id' });
  const v = db.prepare('SELECT * FROM vehicles WHERE id = ?').get(id);
  if (!v) return res.status(404).json({ error: 'Listing not found' });
  try {
    const result = await hardDeleteVehicle(id);
    console.log('Admin', req.user.email, 'deleted listing', id, vehicleTitle(v), result);
    return res.json({ deleted: true, id: id, photos: result.photos, photos_deleted_from_r2: result.photos_deleted_from_r2 });
  } catch (e) {
    console.error('Admin delete failed for listing', id, e);
    return res.status(500).json({ error: 'Delete failed' });
  }
});

app.get('/api/admin/dashboard', requireAdmin, function (req, res) {
  const DAY = 24 * 60 * 60 * 1000;
  const now = new Date();
  const nowIso = now.toISOString();
  const since30 = new Date(now.getTime() - 30 * DAY).toISOString();
  const since60 = new Date(now.getTime() - 60 * DAY).toISOString();
  const since56 = new Date(now.getTime() - 56 * DAY).toISOString();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();

  function count(sql, params) {
    const st = db.prepare(sql);
    const row = st.get.apply(st, params || []);
    return row && row.n != null ? Number(row.n) : 0;
  }
  // Count rows of a base query in the last 30 days and the 30 days before that.
  function windowed(base, col) {
    const cur = count(base + ' AND datetime(' + col + ') >= datetime(?)', [since30]);
    const prev = count(base + ' AND datetime(' + col + ') >= datetime(?) AND datetime(' + col + ') < datetime(?)', [since60, since30]);
    let pct = null;
    if (prev > 0) pct = Math.round(((cur - prev) / prev) * 100);
    return { current: cur, previous: prev, trend_pct: pct };
  }
  // Parse either timestamp flavour as UTC.
  function parseTs(t) {
    if (!t) return null;
    let s = String(t);
    if (s.indexOf('T') === -1) s = s.replace(' ', 'T');
    if (!/[zZ]|[+-]\d\d:\d\d$/.test(s)) s += 'Z';
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  }
  // Bucket timestamps into 8 weekly columns ending today (oldest first).
  function weekly(rows, pick) {
    const weeks = [];
    for (let i = 7; i >= 0; i--) {
      const end = new Date(now.getTime() - i * 7 * DAY);
      const start = new Date(end.getTime() - 7 * DAY);
      weeks.push({ start: start.toISOString(), end: end.toISOString(), label: start.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }), count: 0, extra: {} });
    }
    rows.forEach(function (r) {
      const d = parseTs(r.t);
      if (!d) return;
      const idx = 7 - Math.floor((now.getTime() - d.getTime()) / (7 * DAY));
      if (idx < 0 || idx > 7) return;
      weeks[idx].count += 1;
      if (pick) { const k = pick(r); weeks[idx].extra[k] = (weeks[idx].extra[k] || 0) + 1; }
    });
    return weeks;
  }

  // ---- totals ----
  const dealerRows = db.prepare('SELECT status, COALESCE(suspended, 0) AS suspended, COUNT(*) AS n FROM dealerships GROUP BY status, COALESCE(suspended, 0)').all();
  const dealers = { approved: 0, pending: 0, suspended: 0, rejected: 0, total: 0 };
  dealerRows.forEach(function (r) {
    const n = Number(r.n) || 0;
    if (r.status === 'pending') dealers.pending += n;
    else if (r.status === 'rejected') dealers.rejected += n;
    else if (r.status === 'approved') { if (Number(r.suspended)) dealers.suspended += n; else dealers.approved += n; }
  });
  dealers.total = dealers.approved + dealers.pending + dealers.suspended;

  const buyers = {
    total: count("SELECT COUNT(*) AS n FROM users WHERE role = 'buyer'"),
    suspended: count("SELECT COUNT(*) AS n FROM users WHERE role = 'buyer' AND COALESCE(suspended, 0) = 1")
  };
  const listings = {
    active: count("SELECT COUNT(*) AS n FROM vehicles WHERE status = 'active'"),
    total: count("SELECT COUNT(*) AS n FROM vehicles WHERE status != 'draft'"),
    paused: count("SELECT COUNT(*) AS n FROM vehicles WHERE status = 'paused'"),
    drafts: count("SELECT COUNT(*) AS n FROM vehicles WHERE status = 'draft'")
  };
  const sold = {
    all_time: count("SELECT COUNT(*) AS n FROM vehicles WHERE status = 'sold'"),
    this_month: count("SELECT COUNT(*) AS n FROM vehicles WHERE status = 'sold' AND datetime(COALESCE(sold_at, updated_at, created_at)) >= datetime(?)", [monthStart])
  };

  // ---- activity (30d vs previous 30d) ----
  const activity = {
    new_dealers: windowed('SELECT COUNT(*) AS n FROM dealerships WHERE 1 = 1', 'created_at'),
    new_buyers: windowed("SELECT COUNT(*) AS n FROM users WHERE role = 'buyer'", 'created_at'),
    new_listings: windowed("SELECT COUNT(*) AS n FROM vehicles WHERE status != 'draft'", 'COALESCE(published_at, created_at)'),
    messages: windowed('SELECT COUNT(*) AS n FROM messages WHERE 1 = 1', 'created_at'),
    engagements: windowed('SELECT COUNT(*) AS n FROM engagement_events WHERE 1 = 1', 'created_at'),
    // Views are a running counter on each vehicle with no per-view timestamps, so only an
    // all-time total is available; the client labels it accordingly.
    views: { all_time: count('SELECT COALESCE(SUM(views), 0) AS n FROM vehicles') }
  };

  // ---- weekly charts (8 weeks) ----
  const listingWeeks = weekly(
    db.prepare("SELECT COALESCE(published_at, created_at) AS t FROM vehicles WHERE status != 'draft' AND datetime(COALESCE(published_at, created_at)) >= datetime(?)").all(since56)
  );
  const userWeeks = weekly(
    db.prepare("SELECT created_at AS t, role FROM users WHERE role IN ('buyer', 'dealer') AND datetime(created_at) >= datetime(?)").all(since56),
    function (r) { return r.role; }
  );

  // ---- lists ----
  const recentListings = db
    .prepare(
      `SELECT v.id, v.year, v.make, v.model, v.trim, v.status, v.price,
              COALESCE(v.published_at, v.created_at) AS t,
              d.id AS dealership_id, d.business_name,
              (SELECT p.url FROM vehicle_photos p WHERE p.vehicle_id = v.id ORDER BY p.is_primary DESC, p.display_order ASC LIMIT 1) AS photo
       FROM vehicles v
       JOIN dealerships d ON d.id = v.dealership_id
       WHERE v.status != 'draft'
       ORDER BY datetime(COALESCE(v.published_at, v.created_at)) DESC, v.id DESC
       LIMIT 5`
    )
    .all()
    .map(function (r) {
      return {
        id: r.id, year: r.year, make: r.make, model: r.model, trim: r.trim, status: r.status, price: r.price,
        created_at: r.t, dealership_id: r.dealership_id, dealer_name: r.business_name, photo_url: r.photo || null
      };
    });

  const newestDealers = db
    .prepare(
      `SELECT d.id, d.business_name, COALESCE(d.governorate, d.city) AS governorate, d.created_at, d.approved_at,
              COALESCE(d.suspended, 0) AS suspended, d.plan AS plan, u.email,
              (SELECT COUNT(*) FROM vehicles v WHERE v.dealership_id = d.id AND v.status = 'active') AS active_listings
       FROM dealerships d
       JOIN users u ON u.id = d.user_id
       WHERE d.status = 'approved'
       ORDER BY datetime(COALESCE(d.approved_at, d.created_at)) DESC, d.id DESC
       LIMIT 5`
    )
    .all()
    .map(function (r) {
      return {
        id: r.id, business_name: r.business_name, governorate: r.governorate || null, email: r.email,
        created_at: r.created_at, approved_at: r.approved_at, suspended: !!Number(r.suspended),
        plan: r.plan || 'basic', active_listings: Number(r.active_listings) || 0
      };
    });

  const pendingApplications = db
    .prepare(
      `SELECT d.id, d.business_name, d.license_number, d.phone, COALESCE(d.governorate, d.city) AS governorate,
              d.created_at, u.email, u.full_name, u.email_verified
       FROM dealerships d
       JOIN users u ON u.id = d.user_id
       WHERE d.status = 'pending'
       ORDER BY datetime(d.created_at) ASC, d.id ASC
       LIMIT 5`
    )
    .all()
    .map(function (r) {
      return {
        id: r.id, business_name: r.business_name, license_number: r.license_number, phone: r.phone,
        governorate: r.governorate || null, created_at: r.created_at, email: r.email, full_name: r.full_name,
        email_verified: !!Number(r.email_verified)
      };
    });

  res.set('Cache-Control', 'no-store');
  return res.json({
    generated_at: nowIso,
    totals: { dealers: dealers, buyers: buyers, listings: listings, sold: sold, pending_applications: dealers.pending },
    activity: activity,
    charts: { listings_per_week: listingWeeks, users_per_week: userWeeks },
    recent_listings: recentListings,
    newest_dealers: newestDealers,
    pending_applications: pendingApplications
  });
});

const { MAKES, getModelsForMake } = require('./lib/car-data');
const { applyDraftPatchFromBody, validateForPublish, currentYear } = require('./lib/vehicle-fields');

// Record a buyer engagement click. Public, fire-and-forget from the client; always 204.
app.post('/api/engagement', function (req, res) {
  const body = req.body || {};
  const type = String(body.event_type || '').trim().toLowerCase();
  if (!ENGAGEMENT_TYPES[type]) return res.status(400).json({ error: 'Invalid event_type' });

  let vehicleId = body.vehicle_id != null && body.vehicle_id !== '' ? Number(body.vehicle_id) : null;
  let dealershipId = body.dealership_id != null && body.dealership_id !== '' ? Number(body.dealership_id) : null;
  if (vehicleId != null) {
    if (!Number.isInteger(vehicleId)) return res.status(400).json({ error: 'Invalid vehicle_id' });
    const v = db.prepare('SELECT id, dealership_id FROM vehicles WHERE id = ?').get(vehicleId);
    if (!v) return res.status(404).json({ error: 'Vehicle not found' });
    dealershipId = v.dealership_id;
  } else if (dealershipId != null) {
    if (!Number.isInteger(dealershipId)) return res.status(400).json({ error: 'Invalid dealership_id' });
    const d = db.prepare('SELECT id FROM dealerships WHERE id = ?').get(dealershipId);
    if (!d) return res.status(404).json({ error: 'Dealership not found' });
  } else {
    return res.status(400).json({ error: 'vehicle_id or dealership_id is required' });
  }

  if (!engagementAllowed(req.ip || 'unknown')) return res.status(204).end();
  db.prepare('INSERT INTO engagement_events (vehicle_id, dealership_id, event_type, created_at) VALUES (?, ?, ?, ?)')
    .run(vehicleId, dealershipId, type, new Date().toISOString());
  return res.status(204).end();
});

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
    "SELECT v.make AS make, COUNT(*) AS count FROM vehicles v INNER JOIN dealerships d ON d.id = v.dealership_id" +
    " WHERE v.status = 'active' AND d.status = 'approved' AND COALESCE(d.suspended, 0) = 0" +
    ' GROUP BY v.make ORDER BY count DESC'
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

const PUBLIC_CARS_BASE_WHERE = "v.status = 'active' AND d.status = 'approved' AND COALESCE(d.suspended, 0) = 0";

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

  // governorate is treated as an alias for city: a chosen governorate may live in
  // either d.governorate or d.city depending on how the dealer signed up.
  const governorates = parseCsvQueryParam(query.governorate);
  if (governorates.length) {
    const placeholders = governorates.map(function () { return '?'; }).join(', ');
    whereParts.push('(d.governorate IN (' + placeholders + ') OR d.city IN (' + placeholders + '))');
    params.push.apply(params, governorates);
    params.push.apply(params, governorates);
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

  let minMileage = parseOptionalNumber(query.min_mileage);
  let maxMileage = parseOptionalNumber(query.max_mileage);
  const mileageBounds = swapIfInverted(minMileage, maxMileage);
  minMileage = mileageBounds.min;
  maxMileage = mileageBounds.max;
  if (minMileage != null) {
    whereParts.push('v.mileage >= ?');
    params.push(Math.round(minMileage));
  }
  if (maxMileage != null) {
    whereParts.push('v.mileage <= ?');
    params.push(Math.round(maxMileage));
  }

  const colors = parseCsvQueryParam(query.color);
  if (colors.length) {
    whereParts.push('LOWER(TRIM(v.exterior_color)) IN (' + colors.map(function () { return '?'; }).join(', ') + ')');
    params.push.apply(params, colors.map(function (c) { return c.toLowerCase(); }));
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
      governorate: governorate,
      whatsapp: row.dealer_whatsapp || null
    },
    published_at: row.published_at,
    status: row.status || 'active'
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
    '       v.transmission, v.fuel_type, v.exterior_color, v.published_at, v.status,' +
    '       p.url AS primary_photo_url,' +
    '       d.id AS dealer_id, d.business_name AS dealer_business_name,' +
    '       d.city AS dealer_city, d.state AS dealer_state' +
    ' ' + PUBLIC_CARS_FROM_SQL +
    ' LEFT JOIN vehicle_photos p ON p.vehicle_id = v.id AND p.is_primary = 1' +
    ' INNER JOIN saved_cars sc ON sc.vehicle_id = v.id AND sc.buyer_id = ?' +
    // Sold cars stay in the list (rendered with a Sold badge) so a saved car never silently vanishes.
    " WHERE d.status = 'approved' AND COALESCE(d.suspended, 0) = 0 AND v.status IN ('active', 'sold')" +
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
      `SELECT d.id, d.business_name, d.city, d.state, d.governorate, d.phone, d.whatsapp,
              d.logo_url, d.website, d.lat, d.lng, d.created_at,
              COUNT(v.id) AS total_listings
       FROM dealerships d
       LEFT JOIN vehicles v ON v.dealership_id = d.id AND v.status = 'active'
       WHERE d.id = ? AND d.status = 'approved' AND COALESCE(d.suspended, 0) = 0
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
       WHERE v.dealership_id = ? AND v.status = 'active' AND d.status = 'approved' AND COALESCE(d.suspended, 0) = 0
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
      governorate: dealer.governorate || dealer.city || null,
      phone: dealer.phone,
      whatsapp: dealer.whatsapp || null,
      logo_url: dealer.logo_url || null,
      website: dealer.website || null,
      lat: dealer.lat != null ? dealer.lat : null,
      lng: dealer.lng != null ? dealer.lng : null,
      total_listings: dealer.total_listings,
      member_since: memberSince,
      created_at: dealer.created_at
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
  // Colors are free text from dealers ("Black" / "black"): group case-insensitively, display capitalised.
  const colors = groupedFilterOptions(
    'LOWER(TRIM(v.exterior_color))',
    "v.exterior_color IS NOT NULL AND TRIM(v.exterior_color) != ''"
  ).map(function (c) {
    const name = String(c.name || '');
    return { name: name.charAt(0).toUpperCase() + name.slice(1), count: c.count };
  });

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
    colors: colors,
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

// Live search suggestions: brands, models and top listings matching a partial word.
// Only active listings from approved, non-suspended dealers are considered.
app.get('/api/search-suggest', function (req, res) {
  const q = String(req.query.q || '').trim().toLowerCase();
  const empty = { q: q, makes: [], models: [], cars: [] };
  if (q.length < 2 || q.length > 60) return res.json(empty);
  const like = '%' + q.replace(/[%_\\]/g, function (ch) { return '\\' + ch; }) + '%';
  const where = PUBLIC_CARS_BASE_WHERE;

  const makes = db
    .prepare(
      'SELECT v.make AS name, COUNT(*) AS count ' + PUBLIC_CARS_FROM_SQL +
      " WHERE " + where + " AND v.make IS NOT NULL AND LOWER(v.make) LIKE ? ESCAPE '\\'" +
      ' GROUP BY v.make ORDER BY count DESC, name ASC LIMIT 3'
    )
    .all(like);

  const models = db
    .prepare(
      'SELECT v.make AS make, v.model AS model, COUNT(*) AS count ' + PUBLIC_CARS_FROM_SQL +
      " WHERE " + where + " AND v.model IS NOT NULL AND TRIM(v.model) != ''" +
      " AND (LOWER(v.model) LIKE ? ESCAPE '\\' OR LOWER(v.make || ' ' || v.model) LIKE ? ESCAPE '\\')" +
      ' GROUP BY v.make, v.model ORDER BY count DESC, make ASC, model ASC LIMIT 3'
    )
    .all(like, like);

  const cars = db
    .prepare(
      'SELECT v.id, v.year, v.make, v.model, v.trim, v.price, p.url AS primary_photo_url,' +
      ' COALESCE(d.governorate, d.city) AS governorate ' + PUBLIC_CARS_FROM_SQL +
      ' LEFT JOIN vehicle_photos p ON p.vehicle_id = v.id AND p.is_primary = 1' +
      " WHERE " + where +
      " AND LOWER(v.year || ' ' || v.make || ' ' || v.model || ' ' || COALESCE(v.trim, '')) LIKE ? ESCAPE '\\'" +
      ' ORDER BY COALESCE(v.published_at, v.created_at) DESC LIMIT 3'
    )
    .all(like);

  // Cap the dropdown at 8 items: keep cars, then trim models, then makes.
  let overflow = makes.length + models.length + cars.length - 8;
  while (overflow > 0 && models.length > 1) { models.pop(); overflow--; }
  while (overflow > 0 && makes.length > 1) { makes.pop(); overflow--; }

  res.set('Cache-Control', 'no-store');
  return res.json({ q: q, makes: makes, models: models, cars: cars });
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
        d.governorate AS dealer_governorate,
        d.whatsapp AS dealer_whatsapp
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
      whatsapp: row.dealer_whatsapp || null,
      governorate: row.dealer_governorate || row.dealer_city || null,
      logo_url: row.dealer_logo_url || null
    }
  };
}

app.get('/api/cars/:id', function (req, res) {
  const vehicleId = Number(req.params.id);
  if (!vehicleId || !Number.isInteger(vehicleId)) {
    return res.status(404).json({ error: 'Listing not found' });
  }

  // Admins may preview any listing (paused, draft, archived, suspended dealer) from the admin panel.
  const visibility = requestIsAdmin(req)
    ? ''
    : " AND d.status = 'approved' AND COALESCE(d.suspended, 0) = 0 AND v.status IN ('active', 'sold')";
  const row = db
    .prepare(
      `SELECT
        v.id, v.year, v.make, v.model, v.trim, v.mileage, v.price,
        v.body_type, v.transmission, v.fuel_type, v.exterior_color, v.interior_color,
        v.description, v.vin, v.status, v.published_at, COALESCE(v.views, 0) AS views,
        COALESCE(v.admin_paused, 0) AS admin_paused, v.admin_pause_reason,
        d.id AS dealer_id, d.business_name AS dealer_business_name,
        d.city AS dealer_city, d.state AS dealer_state, d.phone AS dealer_phone,
        d.whatsapp AS dealer_whatsapp, d.governorate AS dealer_governorate, d.logo_url AS dealer_logo_url
      ${PUBLIC_CARS_FROM_SQL}
      WHERE v.id = ?` + visibility
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
         SELECT id FROM dealerships WHERE status = 'approved' AND COALESCE(suspended, 0) = 0
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

app.post('/api/inquiries', requireBuyer, buyerSuspendedGuard, function (req, res) {
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

  notifyDealerOfInquiry(vehicle.dealership_id, vehicleId, req.user, message, buyerPhone, createdAt);
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
  messagingSuspendedGuard,
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

app.post('/api/conversations', requireMessagingAuth, messagingSuspendedGuard, function (req, res) {
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

app.post('/api/conversations/:id/messages', requireMessagingAuth, messagingSuspendedGuard, function (req, res) {
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
  if (req.messagingRole === 'buyer') {
    const dealerRow = db.prepare('SELECT suspended FROM dealerships WHERE id = ?').get(conversation.dealership_id);
    if (dealerRow && dealerRow.suspended) {
      return res.status(403).json({ error: 'This dealer is currently unavailable. Messages cannot be sent right now.', code: 'DEALER_SUSPENDED' });
    }
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
    if (req.messagingRole === 'buyer') notifyDealerOfNewMessage(conversation, message, req.user);
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
    .get(dealershipId).s;
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

  const plan = getDealerPlan(dealershipId);
  const engagement = engagementSummary(dealershipId);
  return res.json({
    active_listings: activeListings,
    draft_listings: draftListings,
    total_listings: totalListings,
    total_views_30d: totalViews30d,
    new_inquiries: newInquiries,
    sold_this_month: soldThisMonth,
    plan: plan.plan,
    listing_limit: plan.listing_limit,
    listings_used: countPlanListings(dealershipId, 0),
    engagements_30d: engagement.total,
    engagement_breakdown: engagement.breakdown
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
      COALESCE(v.admin_paused, 0) AS admin_paused, v.admin_pause_reason,
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
app.post('/api/vehicles/draft', requireDealer, dealerSuspendedGuard, function (req, res) {
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

app.patch('/api/vehicles/:id', requireDealer, dealerSuspendedGuard, function (req, res) {
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

app.post('/api/vehicles/:id/publish', requireDealer, dealerSuspendedGuard, function (req, res) {
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
  const pausedErr = adminPausedError(vehicle);
  if (pausedErr) return res.status(403).json(pausedErr);

  const photoCount = db
    .prepare('SELECT COUNT(*) AS c FROM vehicle_photos WHERE vehicle_id = ?')
    .get(vehicleId).c;
  const publishErr = validateForPublish(vehicle, photoCount);
  if (publishErr) return res.status(400).json(publishErr);

  // Plan limit: only vehicles that are not already counted (drafts) can push the dealer over.
  if (vehicle.status === 'draft') {
    const limitErr = listingLimitError(req.dealership.id, vehicleId);
    if (limitErr) return res.status(403).json(limitErr);
  }

  const publishedAt = new Date().toISOString();
  db.prepare("UPDATE vehicles SET status = 'active', published_at = ?, updated_at = ? WHERE id = ?").run(
    publishedAt,
    publishedAt,
    vehicleId
  );
  const row = db.prepare('SELECT * FROM vehicles WHERE id = ?').get(vehicleId);
  return res.json({ vehicle: row });
});

app.delete('/api/vehicles/:id', requireDealer, dealerSuspendedGuard, function (req, res) {
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

app.post('/api/vehicles/:id/pause', requireDealer, dealerSuspendedGuard, function (req, res) {
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

app.post('/api/vehicles/:id/resume', requireDealer, dealerSuspendedGuard, function (req, res) {
  const vehicleId = Number(req.params.id);
  if (!vehicleId) return res.status(400).json({ error: 'Invalid vehicle id' });
  const vehicle = db
    .prepare('SELECT * FROM vehicles WHERE id = ? AND dealership_id = ?')
    .get(vehicleId, req.dealership.id);
  if (!vehicle) return res.status(403).json({ error: 'Forbidden' });
  if (vehicle.status !== 'paused') {
    return res.status(400).json({ error: 'Only paused listings can be resumed' });
  }
  const pausedErr = adminPausedError(vehicle);
  if (pausedErr) return res.status(403).json(pausedErr);
  const now = new Date().toISOString();
  db.prepare("UPDATE vehicles SET status = 'active', updated_at = ? WHERE id = ?").run(now, vehicleId);
  const row = db.prepare('SELECT * FROM vehicles WHERE id = ?').get(vehicleId);
  return res.json({ vehicle: row });
});

app.post('/api/vehicles/:id/mark-sold', requireDealer, dealerSuspendedGuard, function (req, res) {
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
  const pausedErr = adminPausedError(vehicle);
  if (pausedErr) return res.status(403).json(pausedErr);
  const now = new Date().toISOString();
  db.prepare("UPDATE vehicles SET status = 'sold', updated_at = ?, sold_at = ? WHERE id = ?").run(now, now, vehicleId);
  const row = db.prepare('SELECT * FROM vehicles WHERE id = ?').get(vehicleId);
  return res.json({ vehicle: row });
});

// Dealer: inventory insights (rule-based, from the dealer's own listings, views, engagements, sales)
app.get('/api/dealer/insights', requireDealer, function (req, res) {
  const dealershipId = req.dealership.id;
  const now = Date.now();
  const DAY = 24 * 60 * 60 * 1000;
  const since30 = new Date(now - 30 * DAY).toISOString();
  const days = function (fromIso, toMs) {
    const t = Date.parse(fromIso);
    return isFinite(t) ? Math.max(0, Math.round((toMs - t) / DAY)) : null;
  };

  const engagementByVehicle = {};
  db.prepare(
    'SELECT vehicle_id, COUNT(*) AS c FROM engagement_events WHERE dealership_id = ? AND created_at >= ? AND vehicle_id IS NOT NULL GROUP BY vehicle_id'
  ).all(dealershipId, since30).forEach(function (r) { engagementByVehicle[r.vehicle_id] = r.c; });

  const vehicles = db
    .prepare(
      `SELECT v.id, v.year, v.make, v.model, v.body_type, v.price, v.status, COALESCE(v.views, 0) AS views,
              v.published_at, v.created_at, v.sold_at, p.url AS primary_photo_url
       FROM vehicles v
       LEFT JOIN vehicle_photos p ON p.vehicle_id = v.id AND p.is_primary = 1
       WHERE v.dealership_id = ? AND v.status IN ('active', 'paused', 'sold')`
    )
    .all(dealershipId)
    .map(function (v) {
      const listedSince = v.published_at || v.created_at;
      return {
        id: v.id, year: v.year, make: v.make, model: v.model, body_type: v.body_type, price: v.price,
        status: v.status, views: v.views, primary_photo_url: v.primary_photo_url || null,
        listed_since: listedSince,
        days_listed: days(listedSince, now),
        sold_at: v.sold_at || null,
        days_to_sell: v.status === 'sold' && v.sold_at ? days(listedSince, Date.parse(v.sold_at)) : null,
        engagements_30d: engagementByVehicle[v.id] || 0
      };
    });

  const active = vehicles.filter(function (v) { return v.status === 'active'; });

  // 1. Stale stock: active 30+ days, oldest first
  const stale = active
    .filter(function (v) { return v.days_listed != null && v.days_listed >= 30; })
    .sort(function (a, b) { return b.days_listed - a.days_listed; });

  // 2. Best performers: views + engagements (30d) across live listings and recent sales
  const best = vehicles
    .filter(function (v) { return v.status === 'active' || (v.status === 'sold' && v.sold_at && v.sold_at >= since30); })
    .map(function (v) { return Object.assign({}, v, { score: v.views + v.engagements_30d }); })
    .filter(function (v) { return v.score > 0; })
    .sort(function (a, b) { return b.score - a.score; })
    .slice(0, 5);

  // 3. Sales summary: last 6 months + days-to-sell
  const sold = vehicles.filter(function (v) { return v.status === 'sold' && v.sold_at; });
  const months = [];
  const base = new Date(now);
  for (let i = 5; i >= 0; i--) {
    const d = new Date(base.getFullYear(), base.getMonth() - i, 1);
    const key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
    months.push({ key: key, label: d.toLocaleString('en', { month: 'short' }), sold: 0 });
  }
  sold.forEach(function (v) {
    const key = v.sold_at.slice(0, 7);
    const m = months.find(function (x) { return x.key === key; });
    if (m) m.sold += 1;
  });
  const sold6m = months.reduce(function (s, m) { return s + m.sold; }, 0);
  const withDays = sold.filter(function (v) { return v.days_to_sell != null; });
  const avg = function (arr) { return arr.length ? Math.round(arr.reduce(function (s, x) { return s + x; }, 0) / arr.length) : null; };
  const enoughHistory = sold.length >= 3;
  const byMakeMap = {};
  withDays.forEach(function (v) {
    const k = v.make || 'Unknown';
    (byMakeMap[k] = byMakeMap[k] || []).push(v.days_to_sell);
  });
  const byMake = Object.keys(byMakeMap).map(function (make) {
    return { make: make, count: byMakeMap[make].length, avg_days: avg(byMakeMap[make]) };
  }).sort(function (a, b) { return a.avg_days - b.avg_days; });

  // 4. Restock hints: fastest make+model with repeat sales; slow movers grouped by body type
  const byModelMap = {};
  withDays.forEach(function (v) {
    const k = [v.make, v.model].filter(Boolean).join(' ') || 'Unknown';
    (byModelMap[k] = byModelMap[k] || []).push(v.days_to_sell);
  });
  const fast = Object.keys(byModelMap)
    .map(function (label) { return { label: label, count: byModelMap[label].length, avg_days: avg(byModelMap[label]) }; })
    .filter(function (x) { return x.count >= 2; })
    .sort(function (a, b) { return a.avg_days - b.avg_days || b.count - a.count; })
    .slice(0, 3);
  const slowMap = {};
  active.filter(function (v) { return v.days_listed != null && v.days_listed >= 45; }).forEach(function (v) {
    const label = v.body_type ? (v.body_type === 'Other' ? 'other cars' : v.body_type + 's') : (v.make ? v.make + ' cars' : 'cars');
    const g = (slowMap[label] = slowMap[label] || { label: label, count: 0, oldest_days: 0 });
    g.count += 1;
    g.oldest_days = Math.max(g.oldest_days, v.days_listed);
  });
  const slow = Object.keys(slowMap).map(function (k) { return slowMap[k]; })
    .sort(function (a, b) { return b.count - a.count || b.oldest_days - a.oldest_days; });

  const pick = function (v) {
    return {
      id: v.id, year: v.year, make: v.make, model: v.model, body_type: v.body_type, price: v.price, status: v.status,
      primary_photo_url: v.primary_photo_url, views: v.views, engagements_30d: v.engagements_30d,
      days_listed: v.days_listed, score: v.score
    };
  };

  return res.json({
    generated_at: new Date(now).toISOString(),
    summary: { active_listings: active.length, stale_count: stale.length, sold_6m: sold6m, sold_total: sold.length },
    stale: stale.map(pick),
    best: best.map(pick),
    sales: { enough_history: enoughHistory, months: months, avg_days_overall: enoughHistory ? avg(withDays.map(function (v) { return v.days_to_sell; })) : null, by_make: enoughHistory ? byMake : [] },
    hints: { enough_history: enoughHistory, fast: enoughHistory ? fast : [], slow: slow }
  });
});

// Dealer: create vehicle (approved dealers only) — legacy one-shot create
app.post('/api/vehicles', requireDealer, dealerSuspendedGuard, function (req, res) {
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

  if (status === 'active') {
    const limitErr = listingLimitError(req.dealership.id, 0);
    if (limitErr) return res.status(403).json(limitErr);
  }

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

// 403 payload when a dealer tries to change the status of a listing an admin paused.
function adminPausedError(vehicle) {
  if (!vehicle || !Number(vehicle.admin_paused)) return null;
  return {
    error: 'This listing was paused by CarFox' + (vehicle.admin_pause_reason ? ': ' + vehicle.admin_pause_reason : '') +
      '. Fix the issue and contact support to have it reviewed and republished.',
    code: 'ADMIN_PAUSED',
    reason: vehicle.admin_pause_reason || null
  };
}

// True when the request carries a valid admin token (used to let admins preview hidden listings).
function requestIsAdmin(req) {
  const header = req.headers.authorization || '';
  const parts = header.split(' ');
  if (parts[0] !== 'Bearer' || !parts[1]) return false;
  try {
    const decoded = jwt.verify(parts[1], JWT_SECRET);
    const user = db.prepare('SELECT role FROM users WHERE id = ?').get(decoded.sub);
    return !!user && user.role === 'admin';
  } catch (_) {
    return false;
  }
}

function vehicleTitle(v) {
  return [v.year, v.make, v.model].filter(Boolean).join(' ') + (v.trim ? ' ' + v.trim : '');
}

// Hard-delete a vehicle: photos from R2, then every child row, then the vehicle. No transaction (Turso).
async function hardDeleteVehicle(vehicleId) {
  const photos = db.prepare('SELECT id, url FROM vehicle_photos WHERE vehicle_id = ?').all(vehicleId);
  let photosDeleted = 0;
  for (const p of photos) {
    const key = publicUrlToKey(p.url);
    if (r2Configured() && key) {
      try { await r2.send(new DeleteObjectCommand({ Bucket: r2Bucket, Key: key })); photosDeleted++; }
      catch (e) { console.error('R2 delete failed for', key, e && e.message); }
    }
  }
  db.prepare('DELETE FROM vehicle_photos WHERE vehicle_id = ?').run(vehicleId);
  db.prepare('DELETE FROM saved_cars WHERE vehicle_id = ?').run(vehicleId);
  db.prepare('DELETE FROM inquiries WHERE vehicle_id = ?').run(vehicleId);
  db.prepare('UPDATE engagement_events SET vehicle_id = NULL WHERE vehicle_id = ?').run(vehicleId);
  db.prepare('UPDATE conversations SET vehicle_id = NULL WHERE vehicle_id = ?').run(vehicleId);
  db.prepare('DELETE FROM vehicles WHERE id = ?').run(vehicleId);
  return { photos: photos.length, photos_deleted_from_r2: photosDeleted };
}

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
  dealerSuspendedGuard,
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
  dealerSuspendedGuard,
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

app.patch('/api/vehicles/:vehicleId/photos/reorder', requireDealer, dealerSuspendedGuard, function (req, res) {
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
  // Sequential updates (Turso-compatible; no explicit transaction)
  db.prepare('UPDATE vehicle_photos SET is_primary = 0 WHERE vehicle_id = ?').run(vehicleId);
  ids.forEach(function (id, index) {
    updateOrder.run(index, index === 0 ? 1 : 0, id, vehicleId);
  });

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
    const dealerRow = db.prepare("SELECT d.id FROM dealerships d WHERE d.user_id = ? AND d.status = 'approved'").get(userId);
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
