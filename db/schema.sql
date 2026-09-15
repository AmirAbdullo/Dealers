-- Enable foreign key enforcement when running this script
PRAGMA foreign_keys = ON;

-- Users: dealer, admin, and buyer accounts
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'dealer' CHECK (role IN ('dealer', 'admin', 'buyer')),
  email_verified INTEGER NOT NULL DEFAULT 0,
  phone TEXT,
  google_id TEXT UNIQUE,
  auth_provider TEXT NOT NULL DEFAULT 'email',
  suspended INTEGER NOT NULL DEFAULT 0,
  suspension_reason TEXT,
  suspended_at TEXT,
  created_at TEXT NOT NULL
);

-- Dealerships: one per user (dealer), pending approval
CREATE TABLE IF NOT EXISTS dealerships (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  business_name TEXT NOT NULL,
  license_number TEXT NOT NULL,
  address TEXT NOT NULL,
  city TEXT NOT NULL,
  state TEXT NOT NULL,
  zip TEXT NOT NULL,
  phone TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')),
  approved_at TEXT,
  approved_by INTEGER,
  rejection_reason TEXT,
  plan TEXT NOT NULL DEFAULT 'basic',
  listing_limit INTEGER NOT NULL DEFAULT 50,
  suspended INTEGER NOT NULL DEFAULT 0,
  suspension_reason TEXT,
  suspended_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Vehicles: inventory for a dealership
CREATE TABLE IF NOT EXISTS vehicles (
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
  sold_at TEXT,
  admin_paused INTEGER NOT NULL DEFAULT 0,
  admin_pause_reason TEXT,
  admin_paused_at TEXT,
  trust_score INTEGER NOT NULL DEFAULT 0,
  trust_updated_at TEXT,
  value_rating TEXT,
  value_pct REAL,
  value_median INTEGER,
  value_comparables INTEGER NOT NULL DEFAULT 0,
  value_updated_at TEXT,
  value_excluded INTEGER NOT NULL DEFAULT 0,
  published_at DATETIME,
  updated_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (dealership_id) REFERENCES dealerships(id) ON DELETE CASCADE
);

-- Vehicle photos: URLs to images for each vehicle
CREATE TABLE IF NOT EXISTS vehicle_photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id INTEGER NOT NULL,
  url TEXT NOT NULL,
  display_order INTEGER NOT NULL DEFAULT 0,
  is_primary INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0, 1)),
  FOREIGN KEY (vehicle_id) REFERENCES vehicles(id) ON DELETE CASCADE
);

-- Buyer inquiries sent to dealerships about vehicles
CREATE TABLE IF NOT EXISTS inquiries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id INTEGER NOT NULL,
  dealership_id INTEGER NOT NULL,
  buyer_name TEXT NOT NULL,
  buyer_email TEXT NOT NULL,
  buyer_phone TEXT NOT NULL,
  message TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('new', 'contacted', 'closed')),
  created_at TEXT NOT NULL,
  FOREIGN KEY (vehicle_id) REFERENCES vehicles(id) ON DELETE CASCADE,
  FOREIGN KEY (dealership_id) REFERENCES dealerships(id) ON DELETE CASCADE
);

-- Buyer–dealer messaging: one conversation per buyer, dealership, and vehicle (vehicle_id NULL = general)
CREATE TABLE IF NOT EXISTS conversations (
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

CREATE INDEX IF NOT EXISTS idx_conversations_buyer_last_message
  ON conversations(buyer_id, last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversations_dealership_last_message
  ON conversations(dealership_id, last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversations_vehicle_id ON conversations(vehicle_id);

CREATE TABLE IF NOT EXISTS messages (
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

CREATE INDEX IF NOT EXISTS idx_messages_conversation_created
  ON messages(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_messages_sender_id ON messages(sender_id);

CREATE TABLE IF NOT EXISTS message_attachments (
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

CREATE INDEX IF NOT EXISTS idx_message_attachments_message_id
  ON message_attachments(message_id);

-- Buyer saved (favourited) cars
CREATE TABLE IF NOT EXISTS saved_cars (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  buyer_id INTEGER NOT NULL,
  vehicle_id INTEGER NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(buyer_id, vehicle_id),
  FOREIGN KEY (buyer_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (vehicle_id) REFERENCES vehicles(id) ON DELETE CASCADE
);

-- Admin email invitations (buyer / dealer). status: sending | sent | failed | registered
CREATE TABLE IF NOT EXISTS invitations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('buyer', 'dealer')),
  invited_by INTEGER,
  invited_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'sent',
  error TEXT,
  registered_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_invitations_email ON invitations(email);
CREATE INDEX IF NOT EXISTS idx_invitations_invited_at ON invitations(invited_at);

-- Car Trust Score: admin-checked factors per vehicle (vin, documents, mileage, history, inspection, media, ownership, service).
-- cleared_* is set when a dealer edit removed the verification automatically; vehicles.trust_score caches the computed score.
CREATE TABLE IF NOT EXISTS vehicle_verifications (
  vehicle_id INTEGER NOT NULL,
  factor TEXT NOT NULL,
  verified INTEGER NOT NULL DEFAULT 0,
  verified_by INTEGER,
  verified_at TEXT,
  notes TEXT,
  cleared_reason TEXT,
  cleared_at TEXT,
  PRIMARY KEY (vehicle_id, factor)
);
CREATE INDEX IF NOT EXISTS idx_vehicle_verifications_vehicle ON vehicle_verifications(vehicle_id);

-- Car features catalogue (admin-managed) + per-vehicle join table. Deactivated features stay on existing listings.
CREATE TABLE IF NOT EXISTS features (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  category TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS vehicle_features (
  vehicle_id INTEGER NOT NULL,
  feature_id INTEGER NOT NULL,
  PRIMARY KEY (vehicle_id, feature_id)
);
CREATE INDEX IF NOT EXISTS idx_vehicle_features_feature ON vehicle_features(feature_id);
