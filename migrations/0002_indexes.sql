-- Performance indexes for V2 query paths
CREATE INDEX IF NOT EXISTS idx_projects_bid_due ON projects (bid_due);
CREATE INDEX IF NOT EXISTS idx_projects_status ON projects (status);
CREATE INDEX IF NOT EXISTS idx_projects_state ON projects (state);
CREATE INDEX IF NOT EXISTS idx_projects_city ON projects (city);
CREATE INDEX IF NOT EXISTS idx_projects_gc ON projects (general_contractor);
CREATE INDEX IF NOT EXISTS idx_projects_dedupe ON projects (dedupe_key);
CREATE INDEX IF NOT EXISTS idx_projects_number ON projects (project_number);

CREATE INDEX IF NOT EXISTS idx_film_project ON film_scope (project_id);
CREATE INDEX IF NOT EXISTS idx_film_type ON film_scope (film_type);
CREATE INDEX IF NOT EXISTS idx_glazing_project ON glazing_items (project_id);

CREATE INDEX IF NOT EXISTS idx_docs_project ON project_documents (project_id);
CREATE INDEX IF NOT EXISTS idx_docs_hash ON project_documents (hash);
CREATE INDEX IF NOT EXISTS idx_sheets_project ON project_sheets (project_id);
CREATE INDEX IF NOT EXISTS idx_sheets_number ON project_sheets (sheet_number);
CREATE INDEX IF NOT EXISTS idx_sheets_document ON project_sheets (document_id);

CREATE INDEX IF NOT EXISTS idx_takeoffs_project ON takeoffs (project_id);
CREATE INDEX IF NOT EXISTS idx_takeoff_items_takeoff ON takeoff_items (takeoff_id);
CREATE INDEX IF NOT EXISTS idx_bids_project ON bids (project_id);
CREATE INDEX IF NOT EXISTS idx_bid_results_project ON bid_results (project_id);
CREATE INDEX IF NOT EXISTS idx_contacts_project ON project_contacts (project_id);
CREATE INDEX IF NOT EXISTS idx_contacts_company ON project_contacts (company_id);
CREATE INDEX IF NOT EXISTS idx_rfis_project ON rfis (project_id);
CREATE INDEX IF NOT EXISTS idx_addenda_project ON addenda (project_id);
CREATE INDEX IF NOT EXISTS idx_addendum_changes_addendum ON addendum_changes (addendum_id);
CREATE INDEX IF NOT EXISTS idx_ai_project ON ai_analysis (project_id);
CREATE INDEX IF NOT EXISTS idx_risks_project ON project_risks (project_id);
CREATE INDEX IF NOT EXISTS idx_checklist_project ON bid_checklist (project_id);
CREATE INDEX IF NOT EXISTS idx_companies_name ON companies (name);
CREATE INDEX IF NOT EXISTS idx_companies_type ON companies (company_type);
