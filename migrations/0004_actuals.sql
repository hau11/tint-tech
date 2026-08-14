-- Phase 5: capture what a job ACTUALLY took, so production rates come from
-- real work instead of estimates. Without these columns the record-result
-- call failed silently whenever actuals were supplied.
ALTER TABLE bid_results ADD COLUMN actual_sf REAL;
ALTER TABLE bid_results ADD COLUMN actual_labor_hours REAL;
ALTER TABLE bid_results ADD COLUMN actual_material_cost REAL;
ALTER TABLE bid_results ADD COLUMN actual_labor_cost REAL;
ALTER TABLE bid_results ADD COLUMN actual_equipment_cost REAL;
ALTER TABLE bid_results ADD COLUMN film_type TEXT;
ALTER TABLE bid_results ADD COLUMN contract_price REAL;

CREATE INDEX IF NOT EXISTS idx_bid_results_result ON bid_results (result);
CREATE INDEX IF NOT EXISTS idx_bid_results_film ON bid_results (film_type);
