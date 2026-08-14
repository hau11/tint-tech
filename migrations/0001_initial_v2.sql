-- Tint Intelligence V2 — normalized schema
-- The legacy `kv` table is intentionally left untouched so the existing app
-- keeps working and no data is lost. Migration into these tables is performed
-- by POST /api/admin/migrate-v2.

CREATE TABLE IF NOT EXISTS companies (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  company_type TEXT,               -- GC | Architect | Developer | Owner | Glazing Contractor | Supplier | Manufacturer | Other
  hq TEXT, website TEXT, phone TEXT, email TEXT,
  markets TEXT, notes TEXT,
  relationship_score INTEGER DEFAULT 0,
  created_at TEXT, updated_at TEXT
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  project_number TEXT,
  owner TEXT, developer TEXT, architect TEXT,
  general_contractor TEXT, glazing_contractor TEXT, project_manager TEXT,
  city TEXT, county TEXT, state TEXT, address TEXT, zip TEXT,
  latitude REAL, longitude REAL, distance_miles REAL,
  project_type TEXT, construction_type TEXT,
  estimated_project_value REAL,
  building_square_feet REAL,
  estimated_glazing_square_feet REAL,
  bid_due TEXT, prebid_date TEXT, construction_start TEXT, construction_end TEXT,
  status TEXT DEFAULT 'New',       -- see PROJECT_STATUSES in engines.js
  stage TEXT,                      -- Early | Bidding (early-opportunity support)
  source TEXT, source_url TEXT,
  dedupe_key TEXT,
  notes TEXT,
  score_json TEXT,                 -- deterministic score + AI explanation
  discovered_at TEXT, created_at TEXT, updated_at TEXT
);

CREATE TABLE IF NOT EXISTS project_documents (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  filename TEXT, document_type TEXT,   -- plans|specifications|addendum|schedule|elevation|window_schedule|glazing_schedule|bid_form|manual|other
  source_url TEXT, storage_key TEXT,   -- R2 object key
  mime_type TEXT, file_size INTEGER, page_count INTEGER,
  status TEXT, processing_status TEXT, -- pending|extracting|analyzing|complete|error
  hash TEXT,
  uploaded_at TEXT, processed_at TEXT,
  created_at TEXT, updated_at TEXT
);

CREATE TABLE IF NOT EXISTS project_sheets (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  document_id TEXT,
  sheet_number TEXT, sheet_title TEXT, page_number INTEGER,
  text_content TEXT, ocr_text TEXT,
  classification TEXT,
  relevance_score REAL,
  created_at TEXT, updated_at TEXT
);

CREATE TABLE IF NOT EXISTS film_scope (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  film_type TEXT, manufacturer TEXT, product TEXT,
  location TEXT, floor TEXT, sheet TEXT, spec_section TEXT,
  quantity_sf REAL,
  vlt TEXT, shgc TEXT, uv_rejection TEXT, visible_reflectance TEXT,
  interior_exterior TEXT, attachment_required TEXT, warranty TEXT,
  confidence REAL,
  source_document_id TEXT, source_page INTEGER, source_excerpt TEXT,
  created_at TEXT, updated_at TEXT
);

CREATE TABLE IF NOT EXISTS glazing_items (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  window_type TEXT, window_mark TEXT, floor TEXT, elevation TEXT,
  quantity REAL, width_ft REAL, height_ft REAL, area_sf REAL,
  glass_type TEXT, frame_type TEXT,
  source_sheet TEXT, source_page INTEGER,
  confidence REAL, calculation TEXT,
  estimator_override INTEGER DEFAULT 0,
  created_at TEXT, updated_at TEXT
);

CREATE TABLE IF NOT EXISTS takeoffs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  name TEXT,
  total_glazing_sf REAL, total_film_sf REAL,
  waste_percent REAL, waste_sf REAL, total_material_sf REAL,
  confidence REAL, status TEXT,
  inputs_json TEXT,
  created_at TEXT, updated_at TEXT
);

CREATE TABLE IF NOT EXISTS takeoff_items (
  id TEXT PRIMARY KEY,
  takeoff_id TEXT NOT NULL,
  film_type TEXT, film_product TEXT, window_type TEXT,
  quantity REAL, unit TEXT, area_sf REAL,
  waste_percent REAL, material_sf REAL,
  labor_hours REAL, material_cost REAL, labor_cost REAL, equipment_cost REAL,
  subtotal REAL, source TEXT, confidence REAL,
  estimator_override INTEGER DEFAULT 0,
  created_at TEXT, updated_at TEXT
);

CREATE TABLE IF NOT EXISTS pricing_profiles (
  id TEXT PRIMARY KEY,
  name TEXT, film_type TEXT, manufacturer TEXT, product TEXT,
  material_cost_per_sf REAL,
  labor_hours_per_100sf REAL,
  labor_cost_per_hour REAL,
  equipment_cost_per_job REAL,
  mobilization_cost REAL,
  default_waste_percent REAL,
  default_overhead_percent REAL,
  default_profit_percent REAL,
  active INTEGER DEFAULT 1,
  created_at TEXT, updated_at TEXT
);

CREATE TABLE IF NOT EXISTS bids (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  bid_number TEXT,
  bid_amount REAL,
  material_cost REAL, labor_cost REAL, equipment_cost REAL,
  mobilization_cost REAL, other_cost REAL,
  overhead REAL, profit REAL, gross_profit REAL, gross_margin REAL,
  bid_status TEXT, submitted_at TEXT, proposal_id TEXT,
  breakdown_json TEXT,
  created_at TEXT, updated_at TEXT
);

CREATE TABLE IF NOT EXISTS bid_results (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL, bid_id TEXT,
  result TEXT,                     -- Won|Lost|No Decision|Cancelled|Scope Removed|Unknown
  competitor TEXT, winning_price REAL, reason TEXT, notes TEXT,
  awarded_at TEXT, created_at TEXT, updated_at TEXT
);

CREATE TABLE IF NOT EXISTS project_contacts (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL, company_id TEXT,
  name TEXT, title TEXT, role TEXT,
  email TEXT, phone TEXT,
  source TEXT, confidence REAL,
  created_at TEXT, updated_at TEXT
);

CREATE TABLE IF NOT EXISTS rfis (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  subject TEXT, question TEXT,
  source_sheet TEXT, source_spec TEXT,
  status TEXT DEFAULT 'Draft', response TEXT,
  created_at TEXT, updated_at TEXT
);

CREATE TABLE IF NOT EXISTS addenda (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL, document_id TEXT,
  addendum_number TEXT, published_date TEXT,
  summary TEXT, impact_score REAL,
  created_at TEXT, updated_at TEXT
);

CREATE TABLE IF NOT EXISTS addendum_changes (
  id TEXT PRIMARY KEY,
  addendum_id TEXT NOT NULL,
  sheet TEXT, section TEXT, change_type TEXT,
  old_value TEXT, new_value TEXT,
  impact_description TEXT, estimated_cost_impact REAL,
  confidence REAL,
  created_at TEXT, updated_at TEXT
);

CREATE TABLE IF NOT EXISTS discovery_sources (
  id TEXT PRIMARY KEY,
  name TEXT, type TEXT, url TEXT, state TEXT,
  active INTEGER DEFAULT 1,
  last_run TEXT, status TEXT, quality_score INTEGER, notes TEXT,
  created_at TEXT, updated_at TEXT
);

CREATE TABLE IF NOT EXISTS discovery_runs (
  id TEXT PRIMARY KEY,
  source_id TEXT,
  started_at TEXT, completed_at TEXT,
  status TEXT, projects_found INTEGER, projects_added INTEGER, error TEXT,
  created_at TEXT, updated_at TEXT
);

CREATE TABLE IF NOT EXISTS ai_analysis (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  analysis_type TEXT,              -- project|film|glazing|takeoff|risk|scope|addendum|bid_recommendation|contact
  model TEXT, prompt_version TEXT,
  result_json TEXT, confidence REAL,
  created_at TEXT, updated_at TEXT
);

CREATE TABLE IF NOT EXISTS project_risks (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  severity TEXT,                   -- HIGH|MEDIUM|LOW
  title TEXT, reason TEXT, source TEXT, recommended_action TEXT,
  created_at TEXT, updated_at TEXT
);

CREATE TABLE IF NOT EXISTS bid_checklist (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  item TEXT, checked INTEGER DEFAULT 0, created_at TEXT, updated_at TEXT
);
