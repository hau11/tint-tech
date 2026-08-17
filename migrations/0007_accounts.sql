-- ============================================================
-- Phase A: accounts. Turns a single-operator tool into a
-- multi-customer SaaS. Nothing existing is altered or dropped —
-- every V1/V2 table keeps working exactly as it does today.
-- ============================================================

-- A paying contractor company. Leads are delivered to a customer,
-- billed to a customer, and every portal query is scoped by customer_id.
CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  company_name TEXT NOT NULL,
  contact_name TEXT,
  email TEXT,
  phone TEXT,
  city TEXT, state TEXT,

  status TEXT NOT NULL DEFAULT 'active',   -- active | paused | cancelled

  -- Billing configuration. Quarterly is the default cycle: billable events
  -- accumulate through the quarter and are invoiced once at period close,
  -- rather than firing an invoice per lead.
  billing_cycle TEXT NOT NULL DEFAULT 'quarterly',  -- quarterly | monthly | manual
  billing_model TEXT NOT NULL DEFAULT 'claimed',    -- delivered | claimed | bid_submitted | won | custom
  price_per_lead REAL DEFAULT 0,
  price_per_claim REAL DEFAULT 0,
  price_per_bid REAL DEFAULT 0,
  price_per_win REAL DEFAULT 0,

  -- Territory / scope preferences used to decide who gets which lead.
  service_states TEXT,                     -- JSON array e.g. ["MO","KS"]
  max_distance_miles REAL,
  film_types TEXT,                         -- JSON array of scope tags

  stripe_customer_id TEXT,
  notes TEXT,
  created_at TEXT, updated_at TEXT
);
CREATE INDEX IF NOT EXISTS customers_status_idx ON customers (status);

-- A login. Admin users have customer_id NULL and see everything;
-- contractor users are bound to exactly one customer.
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  customer_id TEXT REFERENCES customers(id) ON DELETE CASCADE,

  username TEXT NOT NULL,
  email TEXT,
  -- Format: pbkdf2$<iterations>$<salt_b64>$<hash_b64>. No plaintext, ever.
  password_hash TEXT NOT NULL,

  role TEXT NOT NULL DEFAULT 'contractor',  -- admin | contractor
  full_name TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,

  last_login_at TEXT,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,

  must_change_password INTEGER NOT NULL DEFAULT 0,
  created_at TEXT, updated_at TEXT
);
-- Usernames are unique across the whole system, so a login form needs only
-- a username and password (no "which company are you?" step).
CREATE UNIQUE INDEX IF NOT EXISTS users_username_idx ON users (username);
CREATE INDEX IF NOT EXISTS users_customer_idx ON users (customer_id);

-- Server-side sessions. The cookie holds a random token; this table stores
-- only its SHA-256, so a database leak cannot be replayed as a login.
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  customer_id TEXT,
  role TEXT NOT NULL,

  ip_address TEXT,
  user_agent TEXT,

  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT, updated_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS sessions_token_idx ON sessions (token_hash);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions (user_id);
CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions (expires_at);
