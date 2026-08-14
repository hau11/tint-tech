-- Estimator verification audit trail (Critical Rule: never overwrite AI output)
CREATE TABLE IF NOT EXISTS verification_events (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  entity_type TEXT,            -- glazing_item | film_scope | takeoff | bid
  entity_id TEXT,
  field TEXT,
  ai_value TEXT,               -- preserved forever
  verified_value TEXT,
  difference REAL,
  verified_by TEXT,
  notes TEXT,
  created_at TEXT, updated_at TEXT
);

-- Outreach drafts. Nothing is ever sent automatically.
CREATE TABLE IF NOT EXISTS outreach (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  contact_id TEXT,
  channel TEXT,                -- email | call | note
  purpose TEXT,                -- intro | bid_question | follow_up | post_bid | award
  subject TEXT,
  body TEXT,
  status TEXT DEFAULT 'Draft', -- Draft | Sent | Responded | No response
  sent_at TEXT, responded_at TEXT,
  model TEXT, prompt_version TEXT,
  created_at TEXT, updated_at TEXT
);

-- Follow-up tasks
CREATE TABLE IF NOT EXISTS followups (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  outreach_id TEXT,
  contact_name TEXT,
  action TEXT,                 -- Call | Email | Review | Submit
  reason TEXT,
  due_date TEXT,
  status TEXT DEFAULT 'Open',  -- Open | Done | Skipped
  completed_at TEXT,
  auto_generated INTEGER DEFAULT 0,
  created_at TEXT, updated_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_verification_project ON verification_events (project_id);
CREATE INDEX IF NOT EXISTS idx_verification_entity ON verification_events (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_outreach_project ON outreach (project_id);
CREATE INDEX IF NOT EXISTS idx_outreach_status ON outreach (status);
CREATE INDEX IF NOT EXISTS idx_followups_project ON followups (project_id);
CREATE INDEX IF NOT EXISTS idx_followups_due ON followups (due_date);
CREATE INDEX IF NOT EXISTS idx_followups_status ON followups (status);
