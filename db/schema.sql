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

