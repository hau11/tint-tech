-- ============================================================
-- Release window.
--
-- Billing on claim means the contractor commits money before they've
-- opened the documents. Sometimes what's inside isn't what the listing
-- implied: the project was already awarded, there's no film scope, the GC
-- won't respond. Charging for those produces disputes over email, which
-- are undocumented and corrosive.
--
-- A short window to release a claimed lead — with a required reason —
-- converts that dispute into structured data. The release reasons are the
-- point: they tell you which discovery sources produce leads contractors
-- can't actually use.
-- ============================================================

ALTER TABLE leads ADD COLUMN released_at TEXT;
ALTER TABLE leads ADD COLUMN release_reason TEXT;
ALTER TABLE leads ADD COLUMN release_detail TEXT;

-- Hours after claiming during which a lead can still be released.
-- 0 disables releases entirely for that customer.
ALTER TABLE customers ADD COLUMN release_window_hours INTEGER NOT NULL DEFAULT 48;

CREATE INDEX IF NOT EXISTS leads_released_idx ON leads (released_at);
-- Release-rate analysis is per source, so this is the index that matters.
CREATE INDEX IF NOT EXISTS leads_source_released_idx ON leads (source, released_at);

-- An exclusive lead that gets released must stop blocking other
-- contractors. The original unique index treated any claimed exclusive
-- lead as a permanent hold; this replaces it so released claims free the
-- project again.
DROP INDEX IF EXISTS leads_exclusive_claim_idx;
CREATE UNIQUE INDEX IF NOT EXISTS leads_exclusive_claim_idx
  ON leads (project_id)
  WHERE exclusivity = 'exclusive' AND claimed_at IS NOT NULL AND released_at IS NULL;
