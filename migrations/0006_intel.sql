-- Architect / specifier intelligence and job costing
CREATE TABLE IF NOT EXISTS specification_opportunities (
  id TEXT PRIMARY KEY,
  architect TEXT NOT NULL,
  project_id TEXT,
  project_name TEXT,
  stage TEXT,
  film_category TEXT,
  current_manufacturer TEXT,
  opportunity TEXT,
  contact_name TEXT, contact_email TEXT, contact_phone TEXT,
  last_contacted TEXT, next_action TEXT,
  status TEXT DEFAULT 'Open',
  created_at TEXT, updated_at TEXT
);

CREATE TABLE IF NOT EXISTS job_costs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  bid_id TEXT,
  category TEXT,               -- material | labor | equipment | mobilization | other
  estimated REAL,
  actual REAL,
  notes TEXT,
  recorded_at TEXT,
  created_at TEXT, updated_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_specopps_architect ON specification_opportunities (architect);
CREATE INDEX IF NOT EXISTS idx_specopps_status ON specification_opportunities (status);
CREATE INDEX IF NOT EXISTS idx_jobcosts_project ON job_costs (project_id);
CREATE INDEX IF NOT EXISTS idx_jobcosts_category ON job_costs (category);
CREATE INDEX IF NOT EXISTS idx_projects_architect ON projects (architect);
