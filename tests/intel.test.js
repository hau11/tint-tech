import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildArchitectProfiles, findSpecificationOpportunities,
  computeJobCost, explainVariance, costTrends, COST_CATEGORIES
} from "../src/intel.js";

/* ---------- architect intelligence ---------- */
const PROJECTS = [
  { id: "p1", architect: "IAA", project_type: "Government", city: "Kansas City", stage: "Design" },
  { id: "p2", architect: "IAA", project_type: "Government", city: "Kansas City", stage: "Bidding" },
  { id: "p3", architect: "IAA", project_type: "Healthcare", city: "Overland Park", stage: "Planning" },
  { id: "p4", architect: "HOK", project_type: "Higher education", city: "Lawrence", stage: "Bidding" },
  { id: "p5", architect: "", project_type: "Office", city: "KC", stage: "Bidding" }
];
const FILM = [
  { project_id: "p1", film_type: "Security", spec_section: "08 87 13", manufacturer: "3M" },
  { project_id: "p2", film_type: "Security", spec_section: "08 87 13", manufacturer: "3M" },
  { project_id: "p3", film_type: "Solar Control", manufacturer: "Not specified" }
];

test("profiles group by architect and ignore blank names", () => {
  const p = buildArchitectProfiles(PROJECTS, FILM);
  assert.equal(p.length, 2);
  const iaa = p.find(x => x.architect === "IAA");
  assert.equal(iaa.projects, 3);
  assert.equal(iaa.filmOpportunities, 3);
});
test("the architect who specifies film is identified with their product", () => {
  const iaa = buildArchitectProfiles(PROJECTS, FILM).find(x => x.architect === "IAA");
  assert.equal(iaa.specifiesFilm, true);
  assert.equal(iaa.topFilmType.name, "Security");
  assert.equal(iaa.topManufacturer.name, "3M");
  assert.equal(iaa.priority.level, "HIGH");
  assert.match(iaa.priority.reason, /protect and expand/i);
});
test("'Not specified' is never counted as a manufacturer", () => {
  const p = buildArchitectProfiles(
    [{ id: "x", architect: "Solo" }],
    [{ project_id: "x", film_type: "Solar Control", manufacturer: "Not specified" }]);
  assert.equal(p[0].topManufacturer, null);
});
test("a thin record is labelled as not a pattern", () => {
  const hok = buildArchitectProfiles(PROJECTS, FILM).find(x => x.architect === "HOK");
  assert.equal(hok.reliable, false);
  assert.match(hok.note, /not enough to call this a pattern/i);
});
test("no architects returns an empty list, not a placeholder", () => {
  assert.deepEqual(buildArchitectProfiles([], []), []);
  assert.deepEqual(buildArchitectProfiles([{ id: "a", architect: "" }], []), []);
});

test("specification opportunities target early-stage projects only", () => {
  const profiles = buildArchitectProfiles(PROJECTS, FILM);
  const opps = findSpecificationOpportunities(profiles, PROJECTS);
  const ids = opps.map(o => o.project_id);
  assert.ok(ids.includes("p1"), "Design stage is the whole point");
  assert.ok(ids.includes("p3"), "Planning stage too");
  assert.ok(!ids.includes("p2"), "a bidding project is too late to change the spec");
});
test("the advice differs for a specifier vs a non-specifier", () => {
  const opps = findSpecificationOpportunities(buildArchitectProfiles(PROJECTS, FILM), PROJECTS);
  const design = opps.find(o => o.project_id === "p1");
  assert.match(design.opportunity, /approved installer/i);
  assert.match(design.next_action, /last stage where film can be added/i);
});

/* ---------- job costing ---------- */
test("variance is computed per category", () => {
  const j = computeJobCost(
    { material: 8000, labor: 6000, equipment: 500, contractPrice: 25000 },
    { material: 8600, labor: 7400, equipment: 500 });
  const mat = j.lines.find(l => l.category === "material");
  assert.equal(mat.variance, 600);
  assert.equal(mat.percent, 7.5);
  assert.equal(mat.status, "over");
  const lab = j.lines.find(l => l.category === "labor");
  assert.equal(lab.percent, 23.3);
  assert.match(lab.flag, /23.3% over estimate/);
});
test("estimated and actual profit are both reported", () => {
  const j = computeJobCost(
    { material: 8000, labor: 6000, contractPrice: 25000 },
    { material: 8600, labor: 7400 });
  assert.equal(j.totalEstimated, 14000);
  assert.equal(j.totalActual, 16000);
  assert.equal(j.estimatedProfit, 11000);
  assert.equal(j.actualProfit, 9000);
  assert.equal(j.profitVariance, -2000);
  assert.equal(j.estimatedMargin, 44);
  assert.equal(j.actualMargin, 36);
});
test("with no actuals it says so instead of showing zeros", () => {
  const j = computeJobCost({ material: 8000, labor: 6000 }, {});
  assert.equal(j.totalActual, null);
  assert.equal(j.totalVariance, null);
  assert.match(j.note, /No actual costs recorded yet/i);
});
test("partial actuals are flagged as partial", () => {
  const j = computeJobCost({ material: 8000, labor: 6000 }, { material: 8100 });
  assert.equal(j.complete, false);
  assert.match(j.note, /Partial actuals/i);
});
test("categories are stable", () => {
  assert.deepEqual(COST_CATEGORIES, ["material", "labor", "equipment", "mobilization", "other"]);
});

test("variance explanation names the likely cause", () => {
  const j = computeJobCost({ material: 8000, labor: 6000, contractPrice: 25000 },
                           { material: 8000, labor: 7400 });
  const msgs = explainVariance(j);
  assert.ok(msgs.some(m => /production rate.*optimistic/i.test(m)));
  assert.ok(msgs.some(m => /less than estimated/i.test(m)));
});
test("a job on target produces no noise", () => {
  const j = computeJobCost({ material: 8000, labor: 6000, contractPrice: 20000 },
                           { material: 8050, labor: 6100 });
  assert.equal(explainVariance(j).length, 0);
});

test("cost trends stay silent until there is a sample", () => {
  const t = costTrends([{ category: "labor", estimated: 1000, actual: 1200 }]);
  assert.equal(t.labor.reliable, false);
  assert.match(t.labor.note, /not enough to adjust your rates/i);
});
test("cost trends report a real pattern once there is one", () => {
  const rows = Array.from({ length: 4 }, () => ({ category: "labor", estimated: 1000, actual: 1200 }));
  const t = costTrends(rows);
  assert.equal(t.labor.reliable, true);
  assert.equal(t.labor.averageVariancePercent, 20);
  assert.match(t.labor.note, /runs 20% over estimate/);
});
