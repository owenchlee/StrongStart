import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';

mkdirSync('data/uploads', { recursive: true });

export const db = new DatabaseSync(process.env.DB_PATH || 'data/strongstart.db');
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS facilitators (
  id INTEGER PRIMARY KEY, name TEXT, email TEXT UNIQUE NOT NULL, organization TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS inbound_emails (
  id INTEGER PRIMARY KEY, facilitator_id INTEGER REFERENCES facilitators(id),
  from_email TEXT, subject TEXT, body TEXT, order_id INTEGER,
  received_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS programs (
  id INTEGER PRIMARY KEY, facilitator_id INTEGER REFERENCES facilitators(id),
  name TEXT, location TEXT, start_date TEXT, end_date TEXT, projected_participants INTEGER,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
-- status: form_sent -> ordered -> shipped -> received
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY, token TEXT UNIQUE NOT NULL,
  facilitator_id INTEGER REFERENCES facilitators(id), program_id INTEGER REFERENCES programs(id),
  status TEXT DEFAULT 'form_sent', shipping_address TEXT, requested_date TEXT, notes TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP, ordered_at TEXT, shipped_at TEXT, received_at TEXT
);
CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY, order_id INTEGER REFERENCES orders(id), item TEXT, qty INTEGER
);
-- source: qr | photo
CREATE TABLE IF NOT EXISTS feedback (
  id INTEGER PRIMARY KEY, program_id INTEGER REFERENCES programs(id), source TEXT,
  rating INTEGER, would_recommend INTEGER, most_valued TEXT, suggestions TEXT,
  raw_text TEXT, image_path TEXT, needs_review INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
-- Every email we send is stored here (also the dev "outbox" when SMTP isn't configured).
CREATE TABLE IF NOT EXISTS outbox (
  id INTEGER PRIMARY KEY, to_email TEXT, subject TEXT, body TEXT, delivered INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
-- Staff allow-list: signing in (Google or dev login) only works for an active email listed here.
CREATE TABLE IF NOT EXISTS staff (
  id INTEGER PRIMARY KEY, email TEXT UNIQUE NOT NULL COLLATE NOCASE, name TEXT,
  role TEXT DEFAULT 'staff', active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP, last_login_at TEXT
);
-- Server-side sessions; id is the SHA-256 of the cookie value, so a leaked DB can't be replayed.
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY, staff_id INTEGER NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
`);

export const KIT_ITEMS = ['Participant Kits', 'Facilitator Kits', 'Facilitator Manuals', 'Replacement Materials'];
