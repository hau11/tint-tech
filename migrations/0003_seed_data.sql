-- Default pricing profiles. These are STARTING POINTS the estimator must tune —
-- they are not market quotes. Real numbers replace them via the pricing page or
-- accumulate from completed bids (historical pricing intelligence).
INSERT OR IGNORE INTO pricing_profiles
 (id,name,film_type,manufacturer,product,material_cost_per_sf,labor_hours_per_100sf,labor_cost_per_hour,equipment_cost_per_job,mobilization_cost,default_waste_percent,default_overhead_percent,default_profit_percent,active)
VALUES
 ('pp-solar-standard','Solar — standard storefront','Solar Control',NULL,NULL,2.25,5.6,65,0,350,10,12,35,1),
 ('pp-solar-curtain','Solar — curtain wall / high-rise','Solar Control',NULL,NULL,2.60,8.3,65,1200,600,12,12,40,1),
 ('pp-security-standard','Security — standard (no attachment)','Security',NULL,NULL,3.40,7.1,65,0,350,10,12,38,1),
 ('pp-security-attach','Security — with attachment system','Security',NULL,NULL,4.80,14.3,72,900,600,12,15,42,1),
 ('pp-safety-standard','Safety film — standard','Safety',NULL,NULL,2.10,5.9,65,0,350,10,12,35,1),
 ('pp-decorative-frost','Decorative / frosted','Decorative',NULL,NULL,3.10,7.7,65,0,300,15,12,40,1),
 ('pp-privacy','Privacy film','Privacy',NULL,NULL,3.00,7.7,65,0,300,15,12,40,1),
 ('pp-birdstrike','Bird strike / bird-safe','Bird Strike',NULL,NULL,4.20,9.1,65,600,450,12,12,40,1),
 ('pp-blast','Blast mitigation','Blast Mitigation',NULL,NULL,5.50,15.4,72,1200,750,12,15,42,1),
 ('pp-antigraffiti','Anti-graffiti','Anti-Graffiti',NULL,NULL,1.85,5.0,65,0,300,10,12,35,1),
 ('pp-exterior','Exterior applied','Exterior',NULL,NULL,3.20,10.0,68,1500,600,12,15,40,1),
 ('pp-energy','Energy retrofit / low-e','Energy Retrofit',NULL,NULL,2.95,6.7,65,0,350,10,12,38,1);
