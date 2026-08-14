import { test } from "node:test";
import assert from "node:assert/strict";
import {
  extractSheetNumber, extractSpecSections, rankPages, selectPagesForAI,
  analysisSummary, buildEvidencePack, validateFilmFindings, validateGlazingFindings
} from "../src/analyze.js";

/* ---------- sheet numbers ---------- */
test("finds sheet numbers in common formats", () => {
  assert.equal(extractSheetNumber("... SHEET NO. A-201"), "A-201");
  assert.equal(extractSheetNumber("WINDOW SCHEDULE                     A700"), "A-700");
  assert.equal(extractSheetNumber("drawing S-100.1 structural"), "S-100.1");
});
test("returns null rather than guessing a sheet number", () => {
  assert.equal(extractSheetNumber("General notes with no sheet marking"), null);
  assert.equal(extractSheetNumber(""), null);
  assert.equal(extractSheetNumber(null), null);
});
test("extracts CSI spec sections", () => {
  const s = extractSpecSections("SECTION 08 87 13 WINDOW FILM and 08 80 00 GLAZING");
  assert.ok(s.includes("08 87 13"));
  assert.ok(s.includes("08 80 00"));
});

/* ---------- ranking / cost control ---------- */
const PAGES = [
  { page: 1, text: "COVER SHEET. Index of drawings." },
  { page: 2, text: "WINDOW SCHEDULE A700. W-101 qty 42, storefront, insulated glass." },
  { page: 3, text: "SECTION 08 87 13 WINDOW FILM. Provide anti-shatter security film at Level 3." },
  { page: 4, text: "MECHANICAL DUCT PLAN. HVAC routing." },
  { page: 5, text: "SOUTH ELEVATION A-201 showing curtain wall and punched windows." },
  { page: 6, text: "" }
];
test("ranks film and glazing pages above irrelevant ones", () => {
  const r = rankPages(PAGES);
  const spec = r.find(p => p.page_number === 3);
  const mech = r.find(p => p.page_number === 4);
  assert.ok(spec.relevance_score > mech.relevance_score);
  assert.equal(spec.classification, "Specification");
  assert.ok(spec.spec_sections.includes("08 87 13"));
});
test("blank pages are flagged as needing OCR, not analyzed", () => {
  const r = rankPages(PAGES);
  assert.equal(r.find(p => p.page_number === 6).empty, true);
  assert.ok(!selectPagesForAI(r).some(p => p.page_number === 6));
});
test("selection excludes irrelevant pages — this is the AI cost control", () => {
  const r = rankPages(PAGES);
  const sel = selectPagesForAI(r);
  const nums = sel.map(p => p.page_number);
  assert.ok(nums.includes(3) && nums.includes(2));
  assert.ok(!nums.includes(1), "cover sheet should not be sent");
  assert.ok(!nums.includes(4), "mechanical plan should not be sent");
  assert.ok(sel.length < PAGES.length);
});
test("schedules and 08-8x specs get priority ordering", () => {
  const sel = selectPagesForAI(rankPages(PAGES));
  assert.ok([2, 3].includes(sel[0].page_number));
});
test("selection respects maxPages budget", () => {
  const many = Array.from({ length: 200 }, (_, i) => ({ page: i + 1, text: "security film storefront glazing" }));
  assert.equal(selectPagesForAI(rankPages(many), { maxPages: 24 }).length, 24);
});
test("analysis summary counts references", () => {
  const r = rankPages(PAGES);
  const s = analysisSummary(r, selectPagesForAI(r));
  assert.equal(s.pagesAnalyzed, 6);
  assert.ok(s.filmReferences > 0);
  assert.ok(s.glazingReferences > 0);
  assert.equal(s.scannedPagesNeedingOcr, 1);
});
test("evidence pack truncates long pages", () => {
  const pack = buildEvidencePack([{ page_number: 1, sheet_number: "A-201", classification: "Elevation", text: "x".repeat(9000) }], 500);
  assert.equal(pack[0].excerpt.length, 500);
  assert.equal(pack[0].sheet, "A-201");
});

/* ---------- VALIDATION: the anti-fabrication layer ---------- */
const EVIDENCE = [
  { page: 3, sheet: "A-521", classification: "Specification", documentId: "doc1" },
  { page: 7, sheet: "A-700", classification: "Window Schedule", documentId: "doc1" }
];

test("accepts a properly cited film finding", () => {
  const { accepted, rejected } = validateFilmFindings([{
    type: "Security", manufacturer: "3M", product: "Ultra S800",
    quantitySF: 3420, calculation: "38 x 5' x 18' = 3420 SF",
    sheet: "A-521", page: 3, specSection: "08 87 13", confidence: 96
  }], EVIDENCE);
  assert.equal(accepted.length, 1);
  assert.equal(rejected.length, 0);
  assert.equal(accepted[0].confidence, 96);
  assert.equal(accepted[0].isSpecified, true);
});
test("REJECTS a finding citing a page we never sent (hallucinated citation)", () => {
  const { accepted, rejected } = validateFilmFindings([{
    type: "Security", quantitySF: 5000, calculation: "x", sheet: "A-999", page: 42, confidence: 99
  }], EVIDENCE);
  assert.equal(accepted.length, 0);
  assert.match(rejected[0].reasons[0], /no citation/);
});
test("REJECTS a quantity with no calculation shown", () => {
  const { accepted, rejected } = validateFilmFindings([{
    type: "Solar Control", quantitySF: 12000, sheet: "A-521", page: 3
  }], EVIDENCE);
  assert.equal(accepted.length, 0);
  assert.ok(rejected[0].reasons.some(r => /calculation/.test(r)));
});
test("REJECTS an invented film type", () => {
  const { accepted, rejected } = validateFilmFindings([{
    type: "Magic Film", sheet: "A-521", page: 3
  }], EVIDENCE);
  assert.equal(accepted.length, 0);
  assert.ok(rejected[0].reasons.some(r => /unknown film type/.test(r)));
});
test("blank manufacturer becomes 'Not specified', never guessed", () => {
  const { accepted } = validateFilmFindings([
    { type: "Security", sheet: "A-521", page: 3, manufacturer: "", product: null },
    { type: "Safety", sheet: "A-700", page: 7, manufacturer: "unknown", product: "TBD" }
  ], EVIDENCE);
  assert.equal(accepted[0].manufacturer, "Not specified");
  assert.equal(accepted[0].product, "Not specified");
  assert.equal(accepted[1].manufacturer, "Not specified");
  assert.equal(accepted[1].product, "Not specified");
});
test("a sheet-only citation is accepted when the sheet was supplied", () => {
  const { accepted } = validateFilmFindings([
    { type: "Decorative", sheet: "A-700", page: null, confidence: 0.8 }
  ], EVIDENCE);
  assert.equal(accepted.length, 1);
  assert.equal(accepted[0].confidence, 80, "0-1 confidence normalizes to 0-100");
});
test("recommendation is kept distinct from specification", () => {
  const { accepted } = validateFilmFindings([
    { type: "Solar Control", sheet: "A-521", page: 3, isRecommendation: true }
  ], EVIDENCE);
  assert.equal(accepted[0].isRecommendation, true);
  assert.equal(accepted[0].isSpecified, false);
});
test("garbage AI output does not crash or leak through", () => {
  assert.equal(validateFilmFindings(null, EVIDENCE).accepted.length, 0);
  assert.equal(validateFilmFindings("not an array", EVIDENCE).accepted.length, 0);
  assert.equal(validateFilmFindings([null, 42, "x"], EVIDENCE).accepted.length, 0);
});

test("glazing: implausible dimensions are rejected", () => {
  const { accepted, rejected } = validateGlazingFindings([
    { windowMark: "W-101", quantity: 42, widthFt: 4, heightFt: 7, sheet: "A-700", page: 7 },
    { windowMark: "W-999", quantity: 10, widthFt: 400, heightFt: 7, sheet: "A-700", page: 7 },
    { windowMark: "W-000", quantity: -5, widthFt: 4, heightFt: 7, sheet: "A-700", page: 7 }
  ], EVIDENCE);
  assert.equal(accepted.length, 1);
  assert.equal(accepted[0].windowMark, "W-101");
  assert.equal(rejected.length, 2);
});
test("glazing: missing dimensions are allowed through as nulls, not invented", () => {
  const { accepted } = validateGlazingFindings([
    { windowMark: "W-103", quantity: 10, widthFt: null, heightFt: null, sheet: "A-700", page: 7 }
  ], EVIDENCE);
  assert.equal(accepted.length, 1);
  assert.equal(accepted[0].widthFt, null);
});
