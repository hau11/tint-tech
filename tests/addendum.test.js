import { test } from "node:test";
import assert from "node:assert/strict";
import {
  diffGlazing, diffFilmScope, detectScopeConflicts,
  estimateCostImpact, parseAddendumNumber, summarizeAddendumImpact
} from "../src/addendum.js";

const BEFORE = [
  { window_mark: "W-201", floor: "Level 2", quantity: 24, width_ft: 4, height_ft: 7 },
  { window_mark: "W-202", floor: "Level 2", quantity: 10, width_ft: 5, height_ft: 6 },
  { window_mark: "W-301", floor: "Level 3", quantity: 8, width_ft: 4, height_ft: 8 }
];

test("detects a quantity change and its exact SF impact", () => {
  // The classic addendum: W-203 quantity 24 -> 38
  const after = [
    { window_mark: "W-201", floor: "Level 2", quantity: 38, width_ft: 4, height_ft: 7 },
    { window_mark: "W-202", floor: "Level 2", quantity: 10, width_ft: 5, height_ft: 6 },
    { window_mark: "W-301", floor: "Level 3", quantity: 8, width_ft: 4, height_ft: 8 }
  ];
  const d = diffGlazing(BEFORE, after);
  assert.equal(d.changed.length, 1);
  assert.equal(d.changed[0].mark, "W-201");
  assert.deepEqual(d.changed[0].fields[0], { field: "quantity", from: 24, to: 38 });
  assert.equal(d.changed[0].areaBefore, 672);
  assert.equal(d.changed[0].areaAfter, 1064);
  assert.equal(d.changed[0].areaDeltaSf, 392);   // 14 extra windows x 28 SF
  assert.equal(d.netSfDelta, 392);
});
test("detects added and removed glazing", () => {
  const after = [
    BEFORE[0], BEFORE[1],
    { window_mark: "W-401", floor: "Level 4", quantity: 6, width_ft: 5, height_ft: 10 }
  ];
  const d = diffGlazing(BEFORE, after);
  assert.equal(d.added.length, 1);
  assert.equal(d.added[0].mark, "W-401");
  assert.equal(d.added[0].areaSf, 300);
  assert.equal(d.removed.length, 1);
  assert.equal(d.removed[0].mark, "W-301");
  assert.equal(d.removed[0].areaSf, 256);
  assert.equal(d.netSfDelta, 44);              // 300 added - 256 removed
});
test("identical revisions report no changes", () => {
  const d = diffGlazing(BEFORE, BEFORE);
  assert.equal(d.hasChanges, false);
  assert.equal(d.netSfDelta, 0);
  assert.equal(d.unchangedCount, 3);
});
test("unmarked items are reported as unmatched, never silently paired", () => {
  const d = diffGlazing([{ quantity: 5, width_ft: 3, height_ft: 4 }], [{ quantity: 9, width_ft: 3, height_ft: 4 }]);
  assert.equal(d.unmatchedBefore.length, 1);
  assert.equal(d.unmatchedAfter.length, 1);
  assert.equal(d.changed.length, 0);
});
test("same mark on a different floor is a different item", () => {
  const d = diffGlazing(
    [{ window_mark: "W-1", floor: "Level 1", quantity: 2, width_ft: 3, height_ft: 4 }],
    [{ window_mark: "W-1", floor: "Level 9", quantity: 2, width_ft: 3, height_ft: 4 }]);
  assert.equal(d.added.length, 1);
  assert.equal(d.removed.length, 1);
});

test("film spec change is detected (manufacturer swapped in an addendum)", () => {
  const d = diffFilmScope(
    [{ film_type: "Security", sheet: "A-521", spec_section: "08 87 13", manufacturer: "3M" }],
    [{ film_type: "Security", sheet: "A-521", spec_section: "08 87 13", manufacturer: "Llumar" }]);
  assert.equal(d.changed.length, 1);
  assert.deepEqual(d.changed[0].fields[0], { field: "manufacturer", from: "3M", to: "Llumar" });
});
test("new film reference added on a new sheet", () => {
  const d = diffFilmScope(
    [{ film_type: "Solar Control", sheet: "A-201" }],
    [{ film_type: "Solar Control", sheet: "A-201" }, { film_type: "Security", sheet: "A-602" }]);
  assert.equal(d.added.length, 1);
  assert.equal(d.added[0].type, "Security");
  assert.equal(d.removed.length, 0);
});

/* ---------- scope conflicts ---------- */
test("catches drawing-vs-spec film type conflict at one location", () => {
  const c = detectScopeConflicts([
    { film_type: "Solar Control", location: "Level 3 East", sheet: "A-501" },
    { film_type: "Security", location: "Level 3 East", sheet: "A-521", spec_section: "08 87 13", manufacturer: "3M", attachment_required: "true" }
  ]);
  const conflict = c.find(x => x.kind === "film-type-mismatch");
  assert.ok(conflict, "expected a film-type-mismatch conflict");
  assert.equal(conflict.severity, "HIGH");
  assert.match(conflict.suggestedRFI, /confirm the required film type/i);
});
test("flags a spec section with no named product", () => {
  const c = detectScopeConflicts([
    { film_type: "Security", spec_section: "08 87 13", manufacturer: "Not specified", attachment_required: "true" }
  ]);
  assert.ok(c.some(x => x.kind === "product-not-named"));
});
test("flags security film with undefined attachment requirement", () => {
  const c = detectScopeConflicts([
    { film_type: "Security", sheet: "A-521", spec_section: "08 87 13", manufacturer: "3M" }
  ]);
  const a = c.find(x => x.kind === "attachment-undefined");
  assert.ok(a);
  assert.equal(a.severity, "HIGH");
  assert.match(a.suggestedRFI, /attachment system/i);
});
test("flags a quantity with nothing supporting it", () => {
  const c = detectScopeConflicts([
    { film_type: "Solar Control", quantity_sf: 5000, sheet: "A-201", attachment_required: "n/a" }
  ]);
  assert.ok(c.some(x => x.kind === "unsupported-quantity"));
});
test("clean scope produces no conflicts", () => {
  const c = detectScopeConflicts([
    { film_type: "Security", location: "Level 3", sheet: "A-521", spec_section: "08 87 13",
      manufacturer: "3M", product: "Ultra S800", attachment_required: "true",
      quantity_sf: 3420, calculation: "38 x 5 x 18" }
  ]);
  assert.equal(c.length, 0);
});
test("empty input is safe", () => {
  assert.equal(detectScopeConflicts([]).length, 0);
  assert.equal(detectScopeConflicts().length, 0);
});

/* ---------- impact ---------- */
test("cost impact is computed only when a rate is known", () => {
  const known = estimateCostImpact(392, { installedPricePerSf: 8.5 });
  assert.equal(known.amount, 3332);
  assert.equal(known.direction, "increase");
  const unknown = estimateCostImpact(392, {});
  assert.equal(unknown.amount, null);
  assert.match(unknown.note, /unknown/i);
});
test("addendum number parsing", () => {
  assert.equal(parseAddendumNumber("ADDENDUM NO. 2"), "2");
  assert.equal(parseAddendumNumber("addendum #3 window revisions"), "3");
  assert.equal(parseAddendumNumber("plans.pdf"), null);
});
test("impact summary rates a big scope change as HIGH", () => {
  const g = diffGlazing(BEFORE, [
    { window_mark: "W-201", floor: "Level 2", quantity: 60, width_ft: 4, height_ft: 7 },
    BEFORE[1], BEFORE[2]
  ]);
  const f = diffFilmScope([{ film_type: "Solar Control", sheet: "A-201" }],
                          [{ film_type: "Security", sheet: "A-201" }, { film_type: "Solar Control", sheet: "A-201" }]);
  const s = summarizeAddendumImpact(g, f, estimateCostImpact(g.netSfDelta, { installedPricePerSf: 8.5 }));
  assert.equal(s.severity, "HIGH");
  assert.ok(s.netSfDelta > 1000);
  assert.ok(s.costImpact.amount > 0);
  assert.ok(s.changes.length >= 2);
});
test("no-change addendum is reported plainly", () => {
  const s = summarizeAddendumImpact(diffGlazing(BEFORE, BEFORE), diffFilmScope([], []), estimateCostImpact(0, {}));
  assert.equal(s.noChanges, true);
  assert.equal(s.tintRelevantChanges, 0);
  assert.equal(s.severity, "LOW");
});
