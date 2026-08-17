-- ============================================================
-- Phase C: outbound lead delivery.
--
-- "Send my leads straight into my CRM" is a feature every contractor
-- customer wants, and it happens to be exactly how Tint Tech KC connects
-- Bid Hunter to TintOS. Building it as a per-customer webhook means
-- it's one mechanism that serves every customer rather than a hard-coded
-- bridge to one company's system.
-- ============================================================

ALTER TABLE customers ADD COLUMN webhook_url TEXT;
ALTER TABLE customers ADD COLUMN webhook_secret TEXT;
ALTER TABLE customers ADD COLUMN webhook_enabled INTEGER NOT NULL DEFAULT 0;

-- Every attempt is logged, successes and failures alike. A webhook that
-- fails silently is worse than no webhook: the customer believes their CRM
-- has the lead when it doesn't.
CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  lead_id TEXT,
  url TEXT NOT NULL,
  status TEXT NOT NULL,          -- delivered | failed | skipped
  response_code INTEGER,
  error TEXT,
  attempt INTEGER NOT NULL DEFAULT 1,
  payload TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS webhook_deliveries_customer_idx
  ON webhook_deliveries (customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS webhook_deliveries_lead_idx
  ON webhook_deliveries (lead_id);
