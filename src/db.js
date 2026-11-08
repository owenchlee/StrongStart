// Async PostgreSQL. Real Postgres (Tiger Data / TimescaleDB) via `pg` when TIGER_DATABASE_URL is set,
// otherwise in-process PGlite (in-memory unless PGLITE_DIR is set). Same SQL for both.
// Importing this module applies the schema (idempotent) via top-level await.
import { mkdirSync } from 'node:fs';

mkdirSync('data/uploads', { recursive: true });
mkdirSync('data/partner_docs', { recursive: true });

const url = process.env.TIGER_DATABASE_URL;
export const dbBackend = url ? 'tiger' : 'pglite';

let exec;      // (sql) -> Promise  (multi-statement, no params)
let q;         // (sql, params) -> Promise<{rows, rowCount}>
let txRunner;  // (fn(q)) -> Promise
let closer;

if (url) {
  const pg = (await import('pg')).default;
  pg.types.setTypeParser(20, (v) => Number(v)); // int8 -> number (counts, epoch ms)
  const host = new URL(url).hostname;
  const local = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(host);
  const pool = new pg.Pool({ connectionString: url, ssl: local ? false : { rejectUnauthorized: false }, max: 10 });
  pool.on('error', (e) => console.error('[db] pool error:', e.message));
  const wrap = (c) => async (sql, params = []) => {
    const r = await c.query(sql, params);
    return { rows: r.rows, rowCount: r.rowCount ?? r.rows.length };
  };
  q = wrap(pool);
  exec = (sql) => pool.query(sql);
  txRunner = async (fn) => {
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      const out = await fn(wrap(c));
      await c.query('COMMIT');
      return out;
    } catch (e) {
      await c.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      c.release();
    }
  };
  closer = () => pool.end();
} else {
  const { PGlite } = await import('@electric-sql/pglite');
  const pgl = new PGlite(process.env.PGLITE_DIR || undefined);
  await pgl.waitReady;
  const wrap = (c) => async (sql, params = []) => {
    const r = await c.query(sql, params);
    return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length };
  };
  q = wrap(pgl);
  exec = (sql) => pgl.exec(sql);
  txRunner = (fn) => pgl.transaction((t) => fn(wrap(t)));
  closer = () => pgl.close();
}

const helpers = (qq) => ({
  query: async (sql, params) => (await qq(sql, params)).rows,
  one: async (sql, params) => (await qq(sql, params)).rows[0],
  run: (sql, params) => qq(sql, params),
});
const base = helpers(q);
export const query = base.query;
export const one = base.one;
export const run = base.run;
export const tx = (fn) => txRunner((qq) => fn(helpers(qq)));
export const close = () => closer();

// ---- schema -----------------------------------------------------------------------------------
// Is TimescaleDB available? Only ever true on real Postgres that ships the extension.
let timescaleAvailable = false;
if (url) {
  try {
    timescaleAvailable = (await q("SELECT 1 FROM pg_available_extensions WHERE name='timescaledb'")).rows.length > 0;
  } catch { /* ignore */ }
}

await exec(`
CREATE TABLE IF NOT EXISTS facilitators (
  id SERIAL PRIMARY KEY, name TEXT, email TEXT UNIQUE NOT NULL, organization TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS inbound_emails (
  id SERIAL PRIMARY KEY, facilitator_id INTEGER REFERENCES facilitators(id),
  from_email TEXT, subject TEXT, body TEXT, order_id INTEGER,
  received_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS programs (
  id SERIAL PRIMARY KEY, facilitator_id INTEGER REFERENCES facilitators(id),
  name TEXT, location TEXT, start_date TEXT, end_date TEXT, projected_participants INTEGER,
  created_at TIMESTAMPTZ DEFAULT now()
);
-- status: form_sent -> ordered -> shipped -> received (or cancelled)
CREATE TABLE IF NOT EXISTS orders (
  id SERIAL PRIMARY KEY, token TEXT UNIQUE NOT NULL,
  facilitator_id INTEGER REFERENCES facilitators(id), program_id INTEGER REFERENCES programs(id),
  status TEXT DEFAULT 'form_sent', shipping_address TEXT, requested_date TEXT, notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(), ordered_at TIMESTAMPTZ, shipped_at TIMESTAMPTZ, received_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS order_items (
  id SERIAL PRIMARY KEY, order_id INTEGER REFERENCES orders(id), item TEXT, qty INTEGER
);
CREATE TABLE IF NOT EXISTS outbox (
  id SERIAL PRIMARY KEY, to_email TEXT, subject TEXT, body TEXT, delivered BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);
-- Staff allow-list: signing in (Google or dev login) only works for an active email listed here.
CREATE TABLE IF NOT EXISTS staff (
  id SERIAL PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT,
  role TEXT DEFAULT 'staff', active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(), last_login_at TIMESTAMPTZ
);
-- Server-side sessions; id is the SHA-256 of the cookie value, so a leaked DB can't be replayed.
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY, staff_id INTEGER NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  expires_at BIGINT NOT NULL, created_at TIMESTAMPTZ DEFAULT now()
);

-- Partners lifecycle management (EOI -> Discovery -> PDSA -> Active -> Inactive)
CREATE TABLE IF NOT EXISTS partners (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  contact_name TEXT,
  contact_email TEXT,
  contact_phone TEXT,
  communities_served TEXT,
  stage TEXT DEFAULT 'expression_of_interest',
  notes TEXT,
  pdsa_status TEXT DEFAULT 'pending',
  pdsa_issued_date DATE,
  pdsa_executed_date DATE,
  pdsa_expiry_date DATE,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS partners_stage_idx ON partners(stage);
-- 'initial_contact' was merged into 'discovery'.
UPDATE partners SET stage='discovery' WHERE stage='initial_contact';

-- Facilitators and programs linked to partners
ALTER TABLE facilitators ADD COLUMN IF NOT EXISTS partner_id INTEGER REFERENCES partners(id) ON DELETE SET NULL;
ALTER TABLE facilitators ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE facilitators ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active';
ALTER TABLE facilitators ADD COLUMN IF NOT EXISTS certified BOOLEAN DEFAULT false;
ALTER TABLE facilitators ADD COLUMN IF NOT EXISTS certification_date DATE;
ALTER TABLE facilitators ADD COLUMN IF NOT EXISTS certificate_code TEXT;

ALTER TABLE staff ADD COLUMN IF NOT EXISTS partner_id INTEGER REFERENCES partners(id) ON DELETE SET NULL;

ALTER TABLE programs ADD COLUMN IF NOT EXISTS partner_id INTEGER REFERENCES partners(id) ON DELETE SET NULL;
ALTER TABLE programs ADD COLUMN IF NOT EXISTS delivery_format TEXT DEFAULT 'in_person';
ALTER TABLE programs ADD COLUMN IF NOT EXISTS session_schedule TEXT;
ALTER TABLE programs ADD COLUMN IF NOT EXISTS external_registration_url TEXT;
ALTER TABLE programs ADD COLUMN IF NOT EXISTS community_served TEXT;
ALTER TABLE programs ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'scheduled';

-- Facilitator program completion reporting (reflections, challenges, actual counts)
CREATE TABLE IF NOT EXISTS program_completions (
  id SERIAL PRIMARY KEY,
  program_id INTEGER UNIQUE NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  facilitator_id INTEGER REFERENCES facilitators(id) ON DELETE SET NULL,
  families_served INTEGER,
  kits_distributed INTEGER,
  completion_confirmed BOOLEAN DEFAULT true,
  reflections TEXT,
  success_stories TEXT,
  challenges TEXT,
  submitted_at TIMESTAMPTZ DEFAULT now()
);

-- Training Sessions and Registrations (Requirements §4)
CREATE TABLE IF NOT EXISTS training_sessions (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  trainer_name TEXT,
  session_date DATE NOT NULL,
  session_time TEXT,
  delivery_type TEXT DEFAULT 'online', -- online / in_person
  location_details TEXT,
  capacity INTEGER DEFAULT 25,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS training_registrations (
  id SERIAL PRIMARY KEY,
  training_session_id INTEGER REFERENCES training_sessions(id) ON DELETE CASCADE,
  facilitator_id INTEGER REFERENCES facilitators(id) ON DELETE CASCADE,
  status TEXT DEFAULT 'registered', -- registered, attended, completed, cancelled
  certificate_code TEXT UNIQUE,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(training_session_id, facilitator_id)
);

-- Partner Documents (PDSA agreements, onboarding packets, templates)
CREATE TABLE IF NOT EXISTS partner_documents (
  id SERIAL PRIMARY KEY,
  partner_id INTEGER NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  original_name TEXT NOT NULL,
  mime_type TEXT,
  file_size INTEGER,
  file_path TEXT NOT NULL,
  uploaded_by TEXT DEFAULT 'staff',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Partner Conversation Messages (Two-way CRM messaging)
CREATE TABLE IF NOT EXISTS partner_messages (
  id SERIAL PRIMARY KEY,
  partner_id INTEGER NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  direction TEXT NOT NULL, -- 'outbound' (staff sent) or 'inbound' (partner replied)
  from_email TEXT NOT NULL,
  to_email TEXT NOT NULL,
  subject TEXT,
  body TEXT NOT NULL,
  attachments JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- New columns (also applied to databases created before this version)
ALTER TABLE inbound_emails ADD COLUMN IF NOT EXISTS partner_id INTEGER REFERENCES partners(id) ON DELETE SET NULL;
ALTER TABLE programs ADD COLUMN IF NOT EXISTS token TEXT;
UPDATE programs SET token = replace(gen_random_uuid()::text,'-','') WHERE token IS NULL;
ALTER TABLE programs ALTER COLUMN token SET DEFAULT replace(gen_random_uuid()::text,'-','');
ALTER TABLE programs ALTER COLUMN token SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS programs_token_key ON programs(token);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipping_cost NUMERIC(10,2);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS reminder_sent_at TIMESTAMPTZ;
ALTER TABLE inbound_emails ADD COLUMN IF NOT EXISTS hints JSONB;
-- Random per-document token for emailed download links (ids are guessable).
ALTER TABLE partner_documents ADD COLUMN IF NOT EXISTS token TEXT;
UPDATE partner_documents SET token = replace(gen_random_uuid()::text,'-','') WHERE token IS NULL;
ALTER TABLE partner_documents ALTER COLUMN token SET DEFAULT replace(gen_random_uuid()::text,'-','');
CREATE UNIQUE INDEX IF NOT EXISTS partner_documents_token_key ON partner_documents(token);

DROP TABLE IF EXISTS training_meeting_slots;

-- Training scheduling ("let us meet" links): staff weekly availability, their Google Calendar connection,
-- and the invites sent to partners. Keyed by staff email so it also works while staff login is off.
CREATE TABLE IF NOT EXISTS staff_availability (
  staff_email TEXT NOT NULL, weekday SMALLINT NOT NULL, start_min INTEGER NOT NULL, end_min INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS staff_availability_email_idx ON staff_availability (staff_email);
-- Custom days: replaces the standard week for one calendar date (windows is a JSON array; [] = day off).
-- A "different week" is just up to seven of these.
CREATE TABLE IF NOT EXISTS staff_day_overrides (
  staff_email TEXT NOT NULL, day DATE NOT NULL, windows TEXT NOT NULL DEFAULT '[]',
  PRIMARY KEY (staff_email, day)
);
CREATE TABLE IF NOT EXISTS staff_calendar (
  staff_email TEXT PRIMARY KEY, timezone TEXT NOT NULL DEFAULT 'America/Toronto',
  google_refresh_token TEXT, google_account TEXT, updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS training_invites (
  id SERIAL PRIMARY KEY, token TEXT UNIQUE NOT NULL,
  partner_id INTEGER REFERENCES partners(id) ON DELETE CASCADE,
  host_email TEXT NOT NULL, host_name TEXT, invitee_email TEXT NOT NULL, invitee_name TEXT,
  status TEXT NOT NULL DEFAULT 'pending', chosen_slots TEXT,
  meeting_start TIMESTAMPTZ, meeting_end TIMESTAMPTZ, meet_link TEXT, event_id TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS training_invites_partner_idx ON training_invites (partner_id);
`);
// Case-insensitive unique staff emails (emails are stored lowercase by the app as well).
await exec('CREATE UNIQUE INDEX IF NOT EXISTS staff_email_lower_key ON staff (lower(email))');

// feedback: a TimescaleDB hypertable needs the time column in every unique index, so on Timescale the
// primary key is (id, created_at). `id` is still generated and unique in practice, so lookups by id work.
await exec(`
CREATE TABLE IF NOT EXISTS feedback (
  id SERIAL, program_id INTEGER REFERENCES programs(id), source TEXT,
  rating INTEGER, would_recommend BOOLEAN, most_valued TEXT, suggestions TEXT,
  raw_text TEXT, image_path TEXT, needs_review BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (${timescaleAvailable ? 'id, created_at' : 'id'})
);
ALTER TABLE feedback ADD COLUMN IF NOT EXISTS image_url TEXT;
ALTER TABLE feedback ADD COLUMN IF NOT EXISTS language TEXT;
ALTER TABLE feedback ADD COLUMN IF NOT EXISTS translated_text TEXT;
ALTER TABLE feedback ADD COLUMN IF NOT EXISTS audio_transcript TEXT;
ALTER TABLE feedback ADD COLUMN IF NOT EXISTS summary TEXT;
CREATE INDEX IF NOT EXISTS feedback_program_idx ON feedback(program_id);
`);

export let isTimescale = false;
if (timescaleAvailable) {
  try {
    await exec('CREATE EXTENSION IF NOT EXISTS timescaledb');
    await exec("SELECT create_hypertable('feedback','created_at', if_not_exists => TRUE, migrate_data => TRUE)");
    isTimescale = true;
  } catch (e) {
    console.warn('[db] TimescaleDB not enabled, using plain Postgres:', e.message);
  }
}
export let hasDailyAggregate = false;
if (isTimescale) {
  try {
    const have = await q("SELECT 1 FROM timescaledb_information.continuous_aggregates WHERE view_name='feedback_daily'");
    if (!have.rows.length) {
      await exec(`CREATE MATERIALIZED VIEW feedback_daily WITH (timescaledb.continuous, timescaledb.materialized_only=false) AS
        SELECT time_bucket('1 day', created_at) AS day, program_id, COUNT(*)::int AS responses,
               AVG(rating)::float8 AS avg_rating, COUNT(rating)::int AS rated
        FROM feedback GROUP BY 1, 2 WITH NO DATA`);
      await exec("SELECT add_continuous_aggregate_policy('feedback_daily', start_offset => INTERVAL '3 days', end_offset => INTERVAL '1 minute', schedule_interval => INTERVAL '1 hour', if_not_exists => TRUE)");
    }
    hasDailyAggregate = true;
  } catch (e) {
    console.warn('[db] continuous aggregate not created, using plain SQL:', e.message);
  }
}

export const KIT_ITEMS = ['Participant Kits', 'Facilitator Kits', 'Facilitator Manuals', 'Replacement Materials'];
export const PARTNER_STAGES = [
  'expression_of_interest',
  'discovery',
  'pdsa_review',
  'pdsa_signed',
  'active',
  'inactive',
];
export const PROGRAM_DELIVERY_FORMATS = ['in_person', 'virtual', 'hybrid'];
export const USER_ROLES = [
  'root',
  'admin',
  'support',
  'staff',
  'partner_admin',
  'site_coordinator',
  'facilitator',
];
