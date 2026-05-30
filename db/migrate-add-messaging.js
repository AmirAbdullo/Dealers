/**
 * Idempotent migration: conversations, messages, message_attachments
 * Run: node db/migrate-add-messaging.js
 */
'use strict';

const path = require('path');
const Database = require('better-sqlite3');

const dbPath = path.join(__dirname, '..', 'carfox.db');

function hasTable(db, name) {
  const row = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);
  return Boolean(row);
}

function hasIndex(db, name) {
  const row = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = ?").get(name);
  return Boolean(row);
}

function runMessagingMigration(db, options) {
  options = options || {};
  const created = [];
  const skipped = [];

  db.pragma('foreign_keys = ON');

  if (!hasTable(db, 'conversations')) {
    db.exec(`
      CREATE TABLE conversations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        buyer_id INTEGER NOT NULL,
        dealership_id INTEGER NOT NULL,
        vehicle_id INTEGER,
        last_message_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_message_preview TEXT,
        buyer_unread_count INTEGER NOT NULL DEFAULT 0,
        dealer_unread_count INTEGER NOT NULL DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(buyer_id, dealership_id, vehicle_id),
        FOREIGN KEY (buyer_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (dealership_id) REFERENCES dealerships(id) ON DELETE CASCADE,
        FOREIGN KEY (vehicle_id) REFERENCES vehicles(id) ON DELETE SET NULL
      );
    `);
    created.push('conversations');
  } else {
    skipped.push('conversations');
  }

  if (!hasTable(db, 'messages')) {
    db.exec(`
      CREATE TABLE messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        conversation_id INTEGER NOT NULL,
        sender_id INTEGER NOT NULL,
        body TEXT,
        has_attachments INTEGER NOT NULL DEFAULT 0,
        read_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        CHECK (body IS NOT NULL OR has_attachments = 1),
        FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
        FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE
      );
    `);
    created.push('messages');
  } else {
    skipped.push('messages');
  }

  if (!hasTable(db, 'message_attachments')) {
    db.exec(`
      CREATE TABLE message_attachments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        message_id INTEGER NOT NULL,
        url TEXT NOT NULL,
        file_type TEXT NOT NULL CHECK(file_type IN ('image', 'video', 'file')),
        mime_type TEXT,
        filename TEXT,
        size_bytes INTEGER,
        thumbnail_url TEXT,
        width INTEGER,
        height INTEGER,
        duration_seconds INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
      );
    `);
    created.push('message_attachments');
  } else {
    skipped.push('message_attachments');
  }

  const indexes = [
    {
      name: 'idx_conversations_buyer_last_message',
      sql:
        'CREATE INDEX idx_conversations_buyer_last_message ON conversations(buyer_id, last_message_at DESC);'
    },
    {
      name: 'idx_conversations_dealership_last_message',
      sql:
        'CREATE INDEX idx_conversations_dealership_last_message ON conversations(dealership_id, last_message_at DESC);'
    },
    {
      name: 'idx_conversations_vehicle_id',
      sql: 'CREATE INDEX idx_conversations_vehicle_id ON conversations(vehicle_id);'
    },
    {
      name: 'idx_messages_conversation_created',
      sql: 'CREATE INDEX idx_messages_conversation_created ON messages(conversation_id, created_at);'
    },
    {
      name: 'idx_messages_sender_id',
      sql: 'CREATE INDEX idx_messages_sender_id ON messages(sender_id);'
    },
    {
      name: 'idx_message_attachments_message_id',
      sql: 'CREATE INDEX idx_message_attachments_message_id ON message_attachments(message_id);'
    }
  ];

  const indexesCreated = [];
  const indexesSkipped = [];

  indexes.forEach(function (idx) {
    if (!hasIndex(db, idx.name)) {
      db.exec(idx.sql);
      indexesCreated.push(idx.name);
    } else {
      indexesSkipped.push(idx.name);
    }
  });

  if (!options.silent) {
    if (created.length) {
      console.log('Created tables:', created.join(', '));
    } else {
      console.log('All messaging tables already exist.');
    }
    if (skipped.length) {
      console.log('Skipped tables (already existed):', skipped.join(', '));
    }
    if (indexesCreated.length) {
      console.log('Created indexes:', indexesCreated.join(', '));
    }
    if (indexesSkipped.length && !options.quietIndexes) {
      console.log('Skipped indexes (already existed):', indexesSkipped.join(', '));
    }

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map(function (r) {
        return r.name;
      });
    console.log('\nTables in database:');
    tables.forEach(function (t) {
      console.log('  -', t);
    });
  }

  return { created: created, skipped: skipped, indexesCreated: indexesCreated };
}

if (require.main === module) {
  const db = new Database(dbPath);
  try {
    runMessagingMigration(db);
    console.log('\nTable definitions:');
    ['conversations', 'messages', 'message_attachments'].forEach(function (name) {
      const row = db
        .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?")
        .get(name);
      console.log('\n-- ' + name);
      console.log(row ? row.sql : '(missing)');
    });
  } catch (err) {
    console.error('Migration failed:', err.message);
    process.exit(1);
  } finally {
    db.close();
  }
}

module.exports = { runMessagingMigration, hasTable };
