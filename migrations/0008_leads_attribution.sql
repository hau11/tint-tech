-- ============================================================
-- Phase B: leads + attribution.
--
-- A `project` is discovered once and is global. A `lead` is the delivery
-- of that project to one customer. That split is what lets the same
-- project go to three contractors as three separate leads, each with its
-- own lifecycle, price, and billing — without duplicating project data.
-- ============================================================

-- Human-readable lead IDs (LEAD-2026-000184) need a per-year counter.
-- SQLite's UPDATE ... RETURNING is atomic, so two simultaneous deliveries
-- cannot receive the same number.
CREATE TABLE IF NOT EXISTS lead_counters (
  year INTEGER PRIMARY KEY,
  next_number INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS leads (
  id TEXT PRIMARY KEY,
  lead_id TEXT NOT NULL,                  -- LEAD-2026-000184, permanent
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,

  status TEXT NOT NULL DEFAULT 'DELIVERED',
  source TEXT,                            -- how the project was discovered
  delivery_method TEXT DEFAULT 'portal',  -- portal | email | api

  -- Money. Price is frozen onto the lead at delivery, so later changes to a
  -- customer's pricing never silently re-price a lead already sent.
  lead_price REAL DEFAULT 0,
  billing_model TEXT,                     -- delivered|claimed|bid_submitted|won
  billing_status TEXT DEFAULT 'NOT_BILLABLE',

  -- Distribution rules (spec §27/§28)
  exclusivity TEXT NOT NULL DEFAULT 'shared',  -- exclusive|shared|territory|industry
  reserved_until TEXT,

  -- Lifecycle timestamps. Every one of these is ALSO an immutable row in
  -- lead_events; these columns are a denormalised convenience for queries
  -- and sorting, never the source of truth.
  created_at TEXT, delivered_at TEXT, viewed_at TEXT, claimed_at TEXT,
  pursuing_at TEXT, bid_submitted_at TEXT, award_detected_at TEXT,
  award_confirmed_at TEXT, won_at TEXT, lost_at TEXT,
  billable_at TEXT, invoiced_at TEXT, paid_at TEXT, declined_at TEXT,

  -- Attribution window (spec §57): an award landing after this doesn't
  -- automatically attribute back to this lead.
  attribution_window_start TEXT,
  attribution_window_end TEXT,

  bid_amount REAL,
  award_amount REAL,
  loss_reason TEXT,
  decline_reason TEXT,
  customer_notes TEXT,
  view_count INTEGER NOT NULL DEFAULT 0,

  updated_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS leads_lead_id_idx ON leads (lead_id);
-- The same project is never delivered to the same customer twice.
CREATE UNIQUE INDEX IF NOT EXISTS leads_project_customer_idx ON leads (project_id, customer_id);
CREATE INDEX IF NOT EXISTS leads_customer_status_idx ON leads (customer_id, status);
CREATE INDEX IF NOT EXISTS leads_project_idx ON leads (project_id);
CREATE INDEX IF NOT EXISTS leads_billing_idx ON leads (billing_status);
-- Exclusivity enforced by the database, not just by application logic:
-- at most one CLAIMED exclusive lead can exist per project.
CREATE UNIQUE INDEX IF NOT EXISTS leads_exclusive_claim_idx
  ON leads (project_id) WHERE exclusivity = 'exclusive' AND claimed_at IS NOT NULL;

-- ------------------------------------------------------------
-- The attribution record. APPEND ONLY.
--
-- This is the evidence that Tint Intelligence found the opportunity,
-- delivered it, and the customer acted on it. If a billing dispute ever
-- matters, this table is the argument. Nothing updates or deletes rows
-- here — a correction is a new event, and a voided event keeps its
-- original row (spec §47).
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lead_events (
  id TEXT PRIMARY KEY,
  lead_id TEXT NOT NULL REFERENCES leads(id) ON DELETE RESTRICT,
  project_id TEXT,
  customer_id TEXT,

  event_type TEXT NOT NULL,
  actor_type TEXT,          -- admin | contractor | system
  actor_id TEXT,            -- users.id, or null for system/cron
  actor_label TEXT,         -- readable, kept even if the user is later deleted

  metadata TEXT,            -- JSON
  ip_address TEXT,
  user_agent TEXT,

  voided_at TEXT,           -- an admin may void an event; the row remains
  voided_by TEXT,
  void_reason TEXT,

  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS lead_events_lead_idx ON lead_events (lead_id, created_at);
CREATE INDEX IF NOT EXISTS lead_events_type_idx ON lead_events (event_type, created_at);
CREATE INDEX IF NOT EXISTS lead_events_customer_idx ON lead_events (customer_id, created_at);

-- What the customer agreed to, captured at the moment of claiming.
-- Stores a hash of the exact rendered text, not just a version number —
-- so "which terms did they accept?" has a verifiable answer even if the
-- version numbering is later reorganised.
CREATE TABLE IF NOT EXISTS lead_terms_acceptances (
  id TEXT PRIMARY KEY,
  lead_id TEXT NOT NULL REFERENCES leads(id) ON DELETE RESTRICT,
  customer_id TEXT NOT NULL,
  user_id TEXT,
  terms_version TEXT NOT NULL,
  terms_hash TEXT NOT NULL,
  terms_text TEXT,
  billing_disclosure TEXT,   -- the exact price sentence shown at claim time
  accepted_at TEXT NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  created_at TEXT
);
CREATE INDEX IF NOT EXISTS terms_lead_idx ON lead_terms_acceptances (lead_id);

-- Configurable terms (spec §38: do not hardcode legal language).
CREATE TABLE IF NOT EXISTS lead_terms_versions (
  id TEXT PRIMARY KEY,
  version TEXT NOT NULL,
  body TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 0,
  created_at TEXT, updated_at TEXT
);
CREATE INDEX IF NOT EXISTS terms_versions_active_idx ON lead_terms_versions (is_active);
