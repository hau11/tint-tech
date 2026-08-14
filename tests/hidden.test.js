import { test } from "node:test";
import assert from "node:assert/strict";
import { detectHiddenTintScope, estimateHiddenPotential, rankHiddenOpportunities } from "../src/hidden.js";

test("a glazing project with no film mention is a hidden opportunity", () => {
  const h = detectHiddenTintScope("Storefront and curtain wall replacement, west-facing elevation, energy efficiency upgrade");
  assert.equal(h.hidden, true);
  assert.ok(h.signals.includes("storefront"));
  assert.ok(h.signals.includes("curtain wall"));
  assert.ok(h.recommendedFilms.includes("Solar Control"));
  assert.ok(h.confidence > 50);
  assert.match(h.reason, /no film specification found/i);
});
test("a project that already specifies film is NOT hidden", () => {
  const h = detectHiddenTintScope("Storefront glazing with security window film", { filmAlreadySpecified: true });
  assert.equal(h.hidden, false);
  assert.match(h.reason, /already specified/i);
});
test("no glazing signals means no opportunity — not a guess", () => {
  const h = detectHiddenTintScope("Parking lot resurfacing and striping");
  assert.equal(h.hidden, false);
  assert.equal(h.potential, null);
  assert.match(h.reason, /No glazing signals/i);
});
test("drivers point at the right film", () => {
  const sec = detectHiddenTintScope("Courthouse storefront glazing, security hardening project");
  assert.ok(sec.drivers.some(d => d.film === "Security"));
  assert.equal(sec.recommendedFilms[0], "Security");

  const priv = detectHiddenTintScope("Interior glass partitions at exam rooms and conference rooms");
  assert.ok(priv.drivers.some(d => d.film === "Privacy"));

  const bird = detectHiddenTintScope("Atrium glass and clerestory, bird safe design");
  assert.ok(bird.drivers.some(d => d.film === "Bird Strike"));
});
test("a driver raises confidence above bare glazing", () => {
  const bare = detectHiddenTintScope("storefront glazing package");
  const driven = detectHiddenTintScope("storefront glazing package, west-facing, glare control needed");
  assert.ok(driven.confidence > bare.confidence);
});

/* ---------- sizing ---------- */
test("measured glazing produces a labelled film range", () => {
  const p = estimateHiddenPotential({ knownGlazingSf: 42000 });
  assert.equal(p.basis, "measured glazing");
  assert.equal(p.filmSfLow, 12600);
  assert.equal(p.filmSfHigh, 29400);
  assert.equal(p.label, "ESTIMATED");
  assert.match(p.note, /verify against the drawings/i);
});
test("building size gives a rougher range, clearly labelled", () => {
  const p = estimateHiddenPotential({ buildingSf: 200000 });
  assert.equal(p.basis, "building size");
  assert.ok(p.filmSfHigh > p.filmSfLow);
  assert.match(p.note, /not a takeoff/i);
});
test("with nothing to measure, the opportunity is UNKNOWN, never invented", () => {
  const p = estimateHiddenPotential({});
  assert.equal(p.label, "UNKNOWN");
  assert.equal(p.valueLow, null);
  assert.equal(p.filmSfLow, null);
  assert.match(p.note, /cannot be sized yet/i);
});
test("measured glazing beats building size when both are present", () => {
  const p = estimateHiddenPotential({ knownGlazingSf: 10000, buildingSf: 500000 });
  assert.equal(p.basis, "measured glazing");
});

/* ---------- ranking ---------- */
test("ranking favours confident, larger opportunities", () => {
  const ranked = rankHiddenOpportunities([
    { hidden: true, confidence: 90, potential: { valueHigh: 200000 } },
    { hidden: true, confidence: 40, potential: { valueHigh: 5000 } },
    { hidden: false, confidence: 99, potential: { valueHigh: 999999 } }
  ]);
  assert.equal(ranked.length, 2, "non-hidden entries are excluded");
  assert.equal(ranked[0].confidence, 90);
});
test("unsized opportunities still rank on confidence alone", () => {
  const ranked = rankHiddenOpportunities([{ hidden: true, confidence: 70, potential: { valueHigh: null } }]);
  assert.equal(ranked.length, 1);
  assert.ok(ranked[0].rankScore > 0);
});
