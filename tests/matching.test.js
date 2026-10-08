import { test } from "node:test";
import assert from "node:assert/strict";
import { matchCustomers, bestMatch, MATCH_WEIGHTS } from "../src/matching.js";

const KC = { id: "p1", state: "MO", filmTypes: ["Security", "Solar Control"], distance_miles: 20 };
const abc = { id: "c1", company_name: "ABC Window Films", service_states: ["MO", "KS"], film_types: ["Security"] };
const xyz = { id: "c2", company_name: "XYZ Tint", service_states: ["KS"], film_types: ["Solar Control"] };
const anywhere = { id: "c3", company_name: "Anywhere Films" };

test("a customer who serves the state outranks one with no territory set", () => {
  // An explicit territory is the stronger signal: naming your states says where
  // you work. No territory usually means nobody filled it in.
  const ranked = matchCustomers(KC, [anywhere, abc]);
  assert.equal(ranked[0].customerId, "c1");
  assert.equal(ranked[0].rank, 1);
  assert.ok(ranked[0].score > ranked[1].score);
  assert.match(ranked[0].reasons.join(" "), /Serves MO/);
});

test("a customer outside the state is excluded, and told why", () => {
  // Returned rather than dropped, so the operator can see who was considered.
  const ranked = matchCustomers(KC, [xyz]);
  assert.equal(ranked[0].eligible, false);
  assert.equal(ranked[0].rank, null);
  assert.match(ranked[0].blockers.join(" "), /Does not serve MO/);
  assert.match(ranked[0].blockers.join(" "), /KS/, "should say what they do cover");
});

test("film scope lifts a match, and the primary scope lifts it further", () => {
  const r = matchCustomers(KC, [abc])[0];
  assert.ok(r.reasons.some(x => /Sells Security/.test(x)));
  assert.ok(r.reasons.some(x => /Primary scope/.test(x)));
  assert.equal(r.score, MATCH_WEIGHTS.stateExplicit + MATCH_WEIGHTS.filmOverlap
    + MATCH_WEIGHTS.filmPrimary);
});

test("a scope mismatch lowers the rank but never excludes", () => {
  // A contractor who has not listed bird-strike film can still want the job.
  // Territory is a hard rule; scope is only a preference.
  const bird = { id: "c4", company_name: "Bird Co", service_states: ["MO"], film_types: ["Bird Strike"] };
  const r = matchCustomers(KC, [bird])[0];
  assert.equal(r.eligible, true);
  assert.match(r.reasons.join(" "), /not excluded for it/);
});

test("an unknown distance earns nothing and is never guessed", () => {
  // This codebase does not invent numbers. With no distance on the project the
  // limit cannot be applied, and that is said out loud rather than assumed.
  const capped = { id: "c5", company_name: "Capped", service_states: ["MO"], max_distance_miles: 50 };
  const r = matchCustomers({ id: "p2", state: "MO", filmTypes: [] }, [capped])[0];
  assert.equal(r.eligible, true);
  assert.equal(r.score, MATCH_WEIGHTS.stateExplicit, "no distance credit without a distance");
  assert.match(r.reasons.join(" "), /Distance unknown/);
});

test("a project beyond the distance limit is excluded", () => {
  const capped = { id: "c5", company_name: "Capped", service_states: ["MO"], max_distance_miles: 50 };
  const r = matchCustomers({ id: "p3", state: "MO", distance_miles: 300 }, [capped])[0];
  assert.equal(r.eligible, false);
  assert.match(r.blockers.join(" "), /beyond their 50 mile limit/);
});

test("a customer who already has the project is blocked", () => {
  // The unique index on (project_id, customer_id) enforces this anyway, so
  // suggesting them would offer a delivery guaranteed to fail.
  const r = matchCustomers(KC, [abc], { alreadyDelivered: ["c1"] })[0];
  assert.equal(r.eligible, false);
  assert.match(r.blockers.join(" "), /Already has this project/);
});

test("an inactive account is never suggested", () => {
  const off = { id: "c6", company_name: "Dormant", service_states: ["MO"], active: 0 };
  assert.equal(matchCustomers(KC, [off])[0].eligible, false);
});

test("territory stored as D1 JSON text behaves like an array", () => {
  // D1 holds these columns as TEXT, so the real runtime shape is a string.
  const fromDb = { id: "c7", company_name: "FromDb", service_states: JSON.stringify(["MO"]), film_types: JSON.stringify(["Security"]) };
  const r = matchCustomers(KC, [fromDb])[0];
  assert.equal(r.eligible, true);
  assert.match(r.reasons.join(" "), /Serves MO/);
});

test("a hand-typed comma list is tolerated", () => {
  const typed = { id: "c8", company_name: "Typed", service_states: "MO, KS" };
  assert.equal(matchCustomers(KC, [typed])[0].eligible, true);
});

test("malformed settings never break routing", () => {
  // Routing runs on every delivery. A bad stored value must degrade, not throw.
  for (const junk of ["{{{", "", null, undefined, 42, {}]) {
    const r = matchCustomers(KC, [{ id: "x", company_name: "X", service_states: junk, film_types: junk }]);
    assert.equal(r.length, 1, JSON.stringify(junk));
    assert.ok(Number.isFinite(r[0].score));
  }
  assert.deepEqual(matchCustomers(KC, null), []);
  assert.equal(matchCustomers(null, [abc]).length, 1);
});

test("ranking is stable, so two runs never disagree", () => {
  // Equal scores break by company name. Without that, delivery order would
  // wobble between runs and exclusivity could land on a different customer.
  const a = { id: "a", company_name: "Alpha", service_states: ["MO"] };
  const b = { id: "b", company_name: "Beta", service_states: ["MO"] };
  assert.deepEqual(matchCustomers(KC, [b, a]).map(r => r.customerId), ["a", "b"]);
  assert.deepEqual(matchCustomers(KC, [a, b]).map(r => r.customerId), ["a", "b"]);
});

test("bestMatch returns the top eligible customer, or null", () => {
  assert.equal(bestMatch(KC, [xyz, abc]).customerId, "c1");
  assert.equal(bestMatch(KC, [xyz]), null, "no eligible customer means no recommendation");
  assert.equal(bestMatch(KC, []), null);
});
