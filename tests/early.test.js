import { test } from "node:test";
import assert from "node:assert/strict";
import {
  detectStage, isEarly, detectBuildingType, extractBuildingSf,
  estimateFilmPotential, computeEarlyScore, earlyNextAction, assessEarlyOpportunity
} from "../src/early.js";

/* ---------- stage ---------- */
test("detects planning-stage language", () => {
  assert.equal(detectStage("Planning commission to review site plan for proposed office tower").stage, "Planning");
  assert.equal(detectStage("Board approves $90M bond issue for school renovations").stage, "Planning");
});
test("detects design stage", () => {
  assert.equal(detectStage("Architect selected for new justice center; design development underway").stage, "Design");
  assert.equal(detectStage("100% CD set issued for review").stage, "Design");
});
test("detects permitting and bidding", () => {
  assert.equal(detectStage("Building permit issued for medical office building").stage, "Permitting");
  assert.equal(detectStage("Invitation to Bid — bids due September 3").stage, "Bidding");
  assert.equal(detectStage("Pre-bid meeting scheduled").stage, "Pre-Bid");
});
test("bidding language wins over planning when both appear", () => {
  assert.equal(detectStage("Site plan approved; sealed bids due Sept 3").stage, "Bidding");
});
test("unknown text is Unknown, not guessed", () => {
  assert.equal(detectStage("Company announces new leadership team").stage, "Unknown");
  assert.equal(detectStage("").stage, "Unknown");
});
test("early stages are the ones you can still influence", () => {
  assert.equal(isEarly("Planning"), true);
  assert.equal(isEarly("Design"), true);
  assert.equal(isEarly("Bidding"), false);
});

/* ---------- building type + size ---------- */
test("identifies high-glazing building types", () => {
  assert.equal(detectBuildingType("new class A office tower downtown").type, "Office / commercial");
  assert.equal(detectBuildingType("replacement hospital campus").type, "Healthcare");
  assert.equal(detectBuildingType("new airport concourse").type, "Airport");
});
test("warehouses score a low glazing factor, not zero", () => {
  const w = detectBuildingType("new distribution center");
  assert.equal(w.type, "Industrial");
  assert.ok(w.glazingFactor < 0.5);
});
test("extracts a stated building size in several formats", () => {
  assert.equal(extractBuildingSf("a 250,000 square foot office building"), 250000);
  assert.equal(extractBuildingSf("120000 sf medical center"), 120000);
  assert.equal(extractBuildingSf("1.2 million square feet of space"), 1200000);
});
test("never invents a building size", () => {
  assert.equal(extractBuildingSf("large new office building"), null);
  assert.equal(extractBuildingSf(""), null);
});

/* ---------- potential ---------- */
test("film potential is a labelled range, not a quote", () => {
  const p = estimateFilmPotential({ buildingSf: 200000, buildingType: "Office / commercial" });
  assert.ok(p.glazingSfLow > 0 && p.glazingSfHigh > p.glazingSfLow);
  assert.ok(p.valueHigh > p.valueLow);
  assert.match(p.note, /not a takeoff/i);
});
test("unknown size or type returns nulls with a reason", () => {
  const a = estimateFilmPotential({ buildingSf: null, buildingType: "Healthcare" });
  assert.equal(a.valueLow, null);
  assert.match(a.note, /No building size stated/);
  const b = estimateFilmPotential({ buildingSf: 100000, buildingType: "Unknown" });
  assert.equal(b.valueLow, null);
  assert.match(b.note, /Building type unknown/);
});

/* ---------- scoring ---------- */
test("a big design-stage local project scores high", () => {
  const s = computeEarlyScore({ stage:"Design", buildingType:"Office / commercial", glazingFactor:1.0,
    buildingSf:300000, distanceMiles:20, hasArchitect:true, hasOwner:true });
  assert.ok(s.total >= 85, "got " + s.total);
});
test("design stage outscores bidding — you can still influence the spec", () => {
  const base = { buildingType:"Healthcare", glazingFactor:1.0, buildingSf:150000, distanceMiles:25, hasArchitect:true };
  assert.ok(computeEarlyScore({ ...base, stage:"Design" }).total >
            computeEarlyScore({ ...base, stage:"Bidding" }).total);
});
test("a far-away warehouse with no details scores low and lists what is missing", () => {
  const s = computeEarlyScore({ stage:"Unknown", buildingType:"Unknown", buildingSf:null, distanceMiles:800 });
  assert.ok(s.total < 20, "got " + s.total);
  assert.ok(s.unknowns.length >= 3);
});
test("missing architect is called out because they specify the film", () => {
  const s = computeEarlyScore({ stage:"Design", hasArchitect:false });
  assert.ok(s.unknowns.some(u => /architect/i.test(u)));
});

/* ---------- next action ---------- */
test("next action changes with stage", () => {
  assert.match(earlyNextAction({ stage:"Design", hasArchitect:true }), /specification writer/i);
  assert.match(earlyNextAction({ stage:"Planning", hasOwner:true }), /owner or developer/i);
  assert.match(earlyNextAction({ stage:"Bidding" }), /price it/i);
});

/* ---------- full assessment ---------- */
test("a real-world planning notice is assessed end to end", () => {
  const a = assessEarlyOpportunity(
    "Planning commission to review site plan for a proposed 240,000 square foot class A office tower in Overland Park",
    { distanceMiles: 18, hasOwner: true });
  assert.equal(a.stage, "Planning");
  assert.equal(a.buildingType, "Office / commercial");
  assert.equal(a.buildingSf, 240000);
  assert.equal(a.early, true);
  assert.ok(a.score > 60);
  assert.ok(a.potential.valueLow > 0);
  assert.match(a.nextAction, /owner or developer/i);
});
test("an unrelated news item assesses as not early and low value", () => {
  const a = assessEarlyOpportunity("Local firm announces new hire in accounting department");
  assert.equal(a.stage, "Unknown");
  assert.equal(a.early, false);
  assert.equal(a.buildingSf, null);
  assert.equal(a.potential.valueLow, null);
});
