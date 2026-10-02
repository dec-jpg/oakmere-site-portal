// Database connection and schema.
// The schema is applied on every boot (all statements are idempotent), so a
// Railway deploy never ends up running code against a database that is
// missing tables or columns. scripts/migrate.js runs the same thing by hand.
const { Pool, types } = require('pg');

// Return DATE columns as plain 'YYYY-MM-DD' strings rather than midnight timestamps.
types.setTypeParser(1082, v => v);

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('DATABASE_URL is not set. Add a PostgreSQL service on Railway and reference its DATABASE_URL.');
  process.exit(1);
}

const needsSsl = /sslmode=require/.test(connectionString) || /proxy\.rlwy\.net/.test(connectionString);
const pool = new Pool({ connectionString, ssl: needsSsl ? { rejectUnauthorized: false } : false, max: 10 });

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'manager',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sites (
  id SERIAL PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  address TEXT,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  radius_m INTEGER NOT NULL DEFAULT 250,
  site_manager TEXT,
  site_phone TEXT,
  muster_point TEXT,
  first_aid TEXT,
  welfare TEXT,
  site_rules TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS companies (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  trade TEXT,
  contact_name TEXT,
  contact_email TEXT,
  contact_phone TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS companies_name_uq ON companies (LOWER(name));

CREATE TABLE IF NOT EXISTS operatives (
  id SERIAL PRIMARY KEY,
  full_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  company_id INTEGER REFERENCES companies(id) ON DELETE SET NULL,
  company_other TEXT,
  trade TEXT,
  cscs_type TEXT,
  cscs_number TEXT,
  cscs_expiry DATE,
  emergency_name TEXT,
  emergency_phone TEXT,
  device_token TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS operatives_phone_idx ON operatives (phone);
CREATE INDEX IF NOT EXISTS operatives_token_idx ON operatives (device_token);

CREATE TABLE IF NOT EXISTS inductions (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  year INTEGER NOT NULL,
  intro TEXT,
  sections JSONB NOT NULL DEFAULT '[]',
  questions JSONB NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'draft',
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS induction_records (
  id SERIAL PRIMARY KEY,
  operative_id INTEGER NOT NULL REFERENCES operatives(id) ON DELETE CASCADE,
  induction_id INTEGER NOT NULL REFERENCES inductions(id) ON DELETE CASCADE,
  site_id INTEGER REFERENCES sites(id) ON DELETE SET NULL,
  signature TEXT,
  attempts INTEGER NOT NULL DEFAULT 1,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (operative_id, induction_id)
);

CREATE TABLE IF NOT EXISTS site_briefings (
  id SERIAL PRIMARY KEY,
  operative_id INTEGER NOT NULL REFERENCES operatives(id) ON DELETE CASCADE,
  site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  confirmed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (operative_id, site_id)
);

CREATE TABLE IF NOT EXISTS attendance (
  id SERIAL PRIMARY KEY,
  operative_id INTEGER NOT NULL REFERENCES operatives(id) ON DELETE CASCADE,
  site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  company_name TEXT,
  method TEXT NOT NULL DEFAULT 'mobile',
  in_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  in_lat DOUBLE PRECISION,
  in_lng DOUBLE PRECISION,
  in_distance_m INTEGER,
  in_photo TEXT,
  in_note TEXT,
  out_at TIMESTAMPTZ,
  out_lat DOUBLE PRECISION,
  out_lng DOUBLE PRECISION,
  out_distance_m INTEGER,
  out_photo TEXT,
  out_note TEXT,
  auto_closed BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX IF NOT EXISTS attendance_open_idx ON attendance (site_id) WHERE out_at IS NULL;
CREATE INDEX IF NOT EXISTS attendance_in_idx ON attendance (in_at);

CREATE TABLE IF NOT EXISTS refusals (
  id SERIAL PRIMARY KEY,
  operative_id INTEGER REFERENCES operatives(id) ON DELETE CASCADE,
  site_id INTEGER REFERENCES sites(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  reason TEXT NOT NULL,
  distance_m INTEGER,
  at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS rams (
  id SERIAL PRIMARY KEY,
  site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  reference TEXT,
  revision TEXT,
  received_on DATE NOT NULL DEFAULT CURRENT_DATE,
  status TEXT NOT NULL DEFAULT 'received',
  review_comments TEXT,
  reviewed_by TEXT,
  reviewed_at TIMESTAMPTZ,
  review_due DATE,
  file_name TEXT,
  file_mime TEXT,
  file_data BYTEA,
  uploaded_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS rams_briefings (
  id SERIAL PRIMARY KEY,
  rams_id INTEGER NOT NULL REFERENCES rams(id) ON DELETE CASCADE,
  operative_id INTEGER NOT NULL REFERENCES operatives(id) ON DELETE CASCADE,
  confirmed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (rams_id, operative_id)
);

CREATE TABLE IF NOT EXISTS kiosks (
  id SERIAL PRIMARY KEY,
  site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  label TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
`;

async function migrate() {
  await pool.query(SCHEMA);
}

const q = (text, params) => pool.query(text, params);

module.exports = { pool, q, migrate };
