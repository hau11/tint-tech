-- ============================================================
-- Phase C: pluggable webhook output format.
--
-- Bid Hunter and TintOS stay completely separate applications —
-- separate repos, separate stacks, separate databases, separate deploys.
-- The only thing that crosses between them is one signed HTTP POST, and
-- this column decides what shape that POST takes.
--
-- 'generic'    — Bid Hunter's own nested payload. Any receiver, any CRM.
-- 'tinttechos' — flattened to the shape TintOS's /v1/public/leads
--                (the literal string keeps its original spelling on purpose:
--                 it is a persisted column value, and renaming it would
--                 orphan every customer row already configured with it)
--                intake endpoint validates, including its intakeKey.
--
-- Adding a third format later is a new case in webhooks.js, not a change
-- to either application's core.
-- ============================================================

ALTER TABLE customers ADD COLUMN webhook_format TEXT NOT NULL DEFAULT 'generic';

-- Some receivers authenticate with a key in the body rather than a header.
-- TintOS's intake endpoint is one: it takes an `intakeKey` that maps
-- the submission to an organization. Kept separate from webhook_secret,
-- which is the HMAC signing secret and is never transmitted.
ALTER TABLE customers ADD COLUMN webhook_auth_key TEXT;
