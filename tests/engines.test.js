import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeGlazingItem, computeTakeoff, computePricing, pricingScenarios,
  computeBidScore, bidRecommendation, computeBidReadiness,
  detectFilmTerms, classifySheetText, confidenceLabel,
  normalizeName, normalizeSolicitation, dedupeKey, isDuplicate,
  toISODate, daysUntil, sourceQualityScore
} from "../src/engines.js";

/* ---------- §71 takeoff calculations ---------- */
test("glazing item: 42 x 4 x 7 = 1176", () => {
  assert.equal(computeGlazingItem({ quantity: 42, width_ft: 4, height_ft: 7 }).area_sf, 1176);
});
test("glazing item: 18 x 5 x 8 = 720", () => {
  assert.equal(computeGlazingItem({ quantity: 18, width_ft: 5, height_ft: 8 }).area_sf, 720);
});
test("glazing item with missing dimension returns Unknown, never a guess", () => {
  const r = computeGlazingItem({ quantity: 42, width_ft: null, height_ft: 7 });
  assert.equal(r.area_sf, null);
  assert.equal(r.calculation, "Unknown");
  assert.match(r.reason, /No usable dimensions/);
});
test("takeoff: 10,000 SF at 5% waste = 10,500 material SF", () => {
  const t = computeTakeoff([{ quantity: 100, width_ft: 10, height_ft: 10 }], { wastePercent: 5 });
  assert.equal(t.totalGlazingSf, 10000);
  assert.equal(t.materialSf, 10500);
  assert.equal(t.wasteSf, 500);
});
test("takeoff excludes unknown-dimension items and flags them", () => {
  const t = computeTakeoff([
    { quantity: 42, width_ft: 4, height_ft: 7 },
    { quantity: 18, width_ft: 5, height_ft: 8 },
    { quantity: 10, width_ft: null, height_ft: 6 }
  ], { wastePercent: 10 });
  assert.equal(t.totalGlazingSf, 1896);          // 1176 + 720, unknown excluded
  assert.equal(t.unknowns.length, 1);
  assert.match(t.note, /Estimator verification required/);
  assert.equal(Math.round(t.confidence), 67);    // 2 of 3 items known
});
test("takeoff coverage percent applies to film SF", () => {
  const t = computeTakeoff([{ quantity: 1, width_ft: 100, height_ft: 100 }], { wastePercent: 0, coveragePercent: 50 });
  assert.equal(t.totalGlazingSf, 10000);
  assert.equal(t.filmSf, 5000);
});

/* ---------- §71 pricing ---------- */
test("pricing: 10,000 SF at $2 material + $1.50/SF labor = $35,000 direct", () => {
  // 10,000 SF, $2/SF material = 20,000. Labor: 10 SF/hr production, $15/hr
  // => 1000 hours x $15 = 15,000. Total direct 35,000.
  const p = computePricing({
    materialSf: 10000, filmSf: 10000, materialCostPerSf: 2,
    productionRateSfPerHour: 10, laborCostPerHour: 15,
    overheadPercent: 0, profitPercent: 0
  });
  assert.equal(p.materialCost, 20000);
  assert.equal(p.laborCost, 15000);
  assert.equal(p.directCost, 35000);
  assert.equal(p.bidPrice, 35000);
});
test("pricing: overhead and profit compound correctly", () => {
  const p = computePricing({
    materialSf: 1000, filmSf: 1000, materialCostPerSf: 2,
    productionRateSfPerHour: 20, laborCostPerHour: 60,
    overheadPercent: 10, profitPercent: 35
  });
  assert.equal(p.materialCost, 2000);
  assert.equal(p.laborHours, 50);
  assert.equal(p.laborCost, 3000);
  assert.equal(p.directCost, 5000);
  assert.equal(p.overhead, 500);
  assert.equal(p.totalCost, 5500);
  assert.equal(p.profit, 1925);
  assert.equal(p.bidPrice, 7425);
  assert.equal(p.grossProfit, 1925);
  assert.equal(p.grossMargin, 25.93);
});
test("pricing: labor hours per 100 SF path", () => {
  const p = computePricing({
    materialSf: 1000, filmSf: 1000, materialCostPerSf: 0,
    laborHoursPer100Sf: 5, laborCostPerHour: 65
  });
  assert.equal(p.laborHours, 50);
  assert.equal(p.laborCost, 3250);
});
test("pricing: other costs roll into direct cost", () => {
  const p = computePricing({
    materialSf: 0, filmSf: 0, materialCostPerSf: 0, laborCostPerHour: 0,
    equipmentCost: 100, mobilizationCost: 200, removalCost: 300,
    surfacePrepCost: 50, liftCost: 400, freightCost: 25, engineeringCost: 75
  });
  assert.equal(p.otherCost, 850);
  assert.equal(p.directCost, 1150);
});
test("pricing scenarios order: aggressive < target < conservative", () => {
  const s = pricingScenarios({ materialSf: 1000, filmSf: 1000, materialCostPerSf: 2,
    productionRateSfPerHour: 20, laborCostPerHour: 60, overheadPercent: 10, profitPercent: 35 });
  assert.ok(s.aggressive.bidPrice < s.target.bidPrice);
  assert.ok(s.target.bidPrice < s.conservative.bidPrice);
});

/* ---------- §72 score ---------- */
test("strong project scores high and recommends BID", () => {
  const s = computeBidScore({
    filmExplicitlySpecified: true, estimatedRevenue: 90000, estimatedGrossProfit: 25000,
    distanceMiles: 34, daysUntilBid: 12, gcRelationshipScore: 100,
    competition: "low", strategicValue: "high"
  });
  assert.equal(s.total, 100);
  assert.equal(bidRecommendation(s).action, "BID");
});
test("weak project scores low and recommends SKIP", () => {
  const s = computeBidScore({
    filmExplicitlySpecified: false, filmEvidenceCount: 0, glazingEvidenceCount: 0,
    estimatedRevenue: null, estimatedGrossProfit: null,
    distanceMiles: 600, daysUntilBid: 1, gcRelationshipScore: null
  });
  assert.ok(s.total < 45, "expected < 45, got " + s.total);
  assert.equal(bidRecommendation(s).action, "SKIP");
  assert.ok(s.unknowns.length >= 4);
});
test("score never exceeds category weights", () => {
  const s = computeBidScore({ filmExplicitlySpecified: true, filmEvidenceCount: 99,
    estimatedRevenue: 1e9, estimatedGrossProfit: 1e9, distanceMiles: 0, daysUntilBid: 999,
    gcRelationshipScore: 1000, competition: "low", strategicValue: "high" });
  assert.equal(s.breakdown.filmOpportunity, 25);
  assert.equal(s.breakdown.gcRelationship, 5);
  assert.ok(s.total <= 100);
});
test("unknown inputs score zero rather than being invented", () => {
  const s = computeBidScore({});
  assert.equal(s.breakdown.revenue, 0);
  assert.equal(s.breakdown.distance, 0);
  assert.ok(s.unknowns.some(u => /revenue/i.test(u)));
});
test("mid project recommends REVIEW", () => {
  const s = computeBidScore({ filmEvidenceCount: 2, estimatedRevenue: 45000,
    estimatedGrossProfit: 11000, distanceMiles: 50, daysUntilBid: 8,
    gcRelationshipScore: 40, competition: "medium" });
  assert.equal(bidRecommendation(s).action, "REVIEW");
});

/* ---------- readiness ---------- */
test("bid readiness percentage and outstanding list", () => {
  const r = computeBidReadiness({ projectIdentified: true, gcIdentified: true,
    bidDateVerified: true, filmScopeIdentified: true, quantitiesEstimated: true });
  assert.equal(r.done, 5);
  assert.equal(r.total, 12);
  assert.equal(r.percent, 42);
  assert.ok(r.outstanding.includes("Pricing complete"));
});

/* ---------- film detection ---------- */
test("detects security film terminology", () => {
  const r = detectFilmTerms("Provide anti-shatter security film at all Level 3 storefront glazing per 08 87 13.");
  assert.ok(r.filmMatches.some(m => m.type === "Security"));
  assert.ok(r.glazingMatches.includes("storefront"));
  assert.ok(r.specMatches.includes("08 87 13"));
  assert.ok(r.relevance > 50);
});
test("detects glazing opportunity even when film is never mentioned", () => {
  const r = detectFilmTerms("Aluminum framed curtain wall with insulated glass, see window schedule.");
  assert.equal(r.filmMatches.length, 0);
  assert.ok(r.glazingMatches.length >= 2);
  assert.ok(r.relevance > 0);
});
test("empty text is not relevant", () => {
  assert.equal(detectFilmTerms("").relevance, 0);
  assert.equal(detectFilmTerms(null).relevance, 0);
});
test("sheet classification", () => {
  assert.equal(classifySheetText("WINDOW SCHEDULE — LEVEL 2"), "Window Schedule");
  assert.equal(classifySheetText("SOUTH ELEVATION"), "Elevation");
  assert.equal(classifySheetText("ADDENDUM NO. 2"), "Addendum");
  assert.equal(classifySheetText("SECTION 08 87 13 WINDOW FILM"), "Specification");
  assert.equal(classifySheetText(""), "Other");
});

/* ---------- confidence ---------- */
test("confidence bands", () => {
  assert.equal(confidenceLabel(96).label, "HIGH");
  assert.equal(confidenceLabel(0.96).label, "HIGH");
  assert.equal(confidenceLabel(75).label, "MEDIUM");
  assert.equal(confidenceLabel(40).label, "LOW");
  assert.equal(confidenceLabel(null).label, "Unknown");
  assert.equal(confidenceLabel(75).needsVerification, true);
});

/* ---------- dedup §32 ---------- */
test("the four Fletcher Daniels variants collapse to one project", () => {
  const a = { name: "O2512-01", project_number: "O2512-01" };
  const b = { name: "Replace Windows Fletcher Daniels", project_number: "O2512-01" };
  const c = { name: "Fletcher Daniels State Office Building" };
  const d = { name: "Window Replacement — Fletcher Daniels" };
  assert.ok(isDuplicate(a, b), "same solicitation number");
  assert.ok(isDuplicate(c, d), "same normalized name");
  assert.equal(dedupeKey(a), dedupeKey(b));
});
test("different projects are not merged", () => {
  assert.ok(!isDuplicate({ name: "Courthouse Glazing", project_number: "IFB-1" },
                         { name: "Airport Terminal Windows", project_number: "IFB-2" }));
});
test("solicitation normalization ignores punctuation and case", () => {
  assert.equal(normalizeSolicitation("o2512-01"), "O251201");
  assert.equal(normalizeSolicitation("-"), "");
  assert.equal(normalizeSolicitation(null), "");
});
test("name normalization drops filler words", () => {
  assert.equal(normalizeName("Replacement of the Windows"), "windows");
});

/* ---------- dates ---------- */
test("date parsing handles all three formats", () => {
  assert.equal(toISODate("2026-08-27"), "2026-08-27");
  assert.equal(toISODate("8/27/2026"), "2026-08-27");
  assert.equal(toISODate("8/27/26"), "2026-08-27");
  assert.equal(toISODate("garbage"), null);
  assert.equal(toISODate(""), null);
});
test("daysUntil counts forward and backward", () => {
  const now = new Date("2026-08-11T12:00:00");
  assert.equal(daysUntil("2026-08-27", now), 16);
  assert.equal(daysUntil("2026-08-01", now), -10);
  assert.equal(daysUntil(null, now), null);
});

/* ---------- source quality ---------- */
test("official complete source scores higher than a poor one", () => {
  const good = sourceQualityScore({ official: true, documentsAvailable: true,
    bidDatesReliable: true, projectDetails: true, duplicateRate: 0, historicalUsefulness: 1 });
  const poor = sourceQualityScore({ official: false, duplicateRate: 0.9 });
  assert.equal(good, 100);
  assert.ok(poor < 20);
});

/* ---------- Phase 3: rolls + takeoff assembly ---------- */
import { computeRolls, recommendRollWidth, buildTakeoffLines, summarizeTakeoff } from "../src/engines.js";

test("roll count: 60in roll x 100ft covers ~496 SF", () => {
  const r = computeRolls({ materialSf: 1000, rollWidthIn: 60 });
  assert.equal(r.rollSf, 495.83);
  assert.equal(r.rolls, 3);
  assert.ok(r.leftoverSf > 0);
});
test("roll count is zero for zero or unknown area", () => {
  assert.equal(computeRolls({ materialSf: 0 }).rolls, 0);
  assert.equal(computeRolls({ materialSf: null }).rolls, 0);
});
test("exact multiples do not over-order", () => {
  const r = computeRolls({ materialSf: 495.83, rollWidthIn: 60 });
  assert.equal(r.rolls, 1);
});
test("roll width recommendation avoids seams", () => {
  const r = recommendRollWidth([{ width_ft: 4, height_ft: 4.5 }, { width_ft: 3, height_ft: 4 }]);
  assert.equal(r.rollWidthIn, 60);
  assert.equal(r.maxPaneFt, 4.5);
});
test("oversize panes are flagged as needing a seam, not silently fitted", () => {
  const r = recommendRollWidth([{ width_ft: 12, height_ft: 8 }]);
  assert.equal(r.seamRequired, true);
  assert.match(r.reason, /seam/);
});
test("no dimensions returns a default with an honest reason", () => {
  const r = recommendRollWidth([]);
  assert.equal(r.maxPaneFt, null);
  assert.match(r.reason, /No dimensions available/);
});

test("takeoff lines compute area and carry citations", () => {
  const lines = buildTakeoffLines([
    { id: "1", window_mark: "W-101", floor: "Level 1", quantity: 42, width_ft: 4, height_ft: 7, source_sheet: "A-700", confidence: 95 },
    { id: "2", window_mark: "W-103", floor: "Level 3", quantity: 10, source_sheet: "A-702", confidence: 40 }
  ], { wastePercent: 10 });
  assert.equal(lines[0].areaSf, 1176);
  assert.equal(lines[0].materialSf, 1293.6);
  assert.equal(lines[0].sourceSheet, "A-700");
  assert.equal(lines[0].needsVerification, false);
  assert.equal(lines[1].areaSf, null);
  assert.equal(lines[1].calculation, "Unknown");
  assert.equal(lines[1].needsVerification, true);
});
test("low-confidence lines are flagged for estimator verification", () => {
  const [line] = buildTakeoffLines([{ id: "x", quantity: 5, width_ft: 3, height_ft: 5, confidence: 62 }]);
  assert.equal(line.areaSf, 75);
  assert.equal(line.needsVerification, true);
});
test("summary groups by floor and film type and counts unknowns", () => {
  const s = summarizeTakeoff(buildTakeoffLines([
    { id: "1", floor: "Level 1", quantity: 42, width_ft: 4, height_ft: 7, confidence: 95, film_type: "Security" },
    { id: "2", floor: "Level 2", quantity: 18, width_ft: 5, height_ft: 8, confidence: 95, film_type: "Security" },
    { id: "3", floor: "Level 3", quantity: 10, confidence: 30 }
  ]));
  assert.equal(s.totalSf, 1896);
  assert.equal(s.byFloor["Level 1"], 1176);
  assert.equal(s.byFilmType["Security"], 1896);
  assert.equal(s.unknownCount, 1);
  assert.equal(s.verifiedSf, 1896);
});
