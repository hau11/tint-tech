import { test } from "node:test";
import assert from "node:assert/strict";
import { buildMarketIntel, buildTerritories, buildNotifications, LABELS } from "../src/market.js";

const P = (id, extra = {}) => ({ id, name: "P" + id, status: "Qualified", ...extra });

/* ---------- market: verified vs estimated must never mix ---------- */
test("awarded revenue is VERIFIED, open pipeline is ESTIMATED", () => {
  const m = buildMarketIntel({
    projects: [P("a", { city: "KC" }), P("b", { city: "KC" })],
    bids: [{ project_id: "a", bid_amount: 40000 }, { project_id: "b", bid_amount: 25000 }],
    results: [{ project_id: "a", result: "Won" }]
  });
  assert.equal(m.revenue.verified.amount, 40000);
  assert.equal(m.revenue.verified.projects, 1);
  assert.equal(m.revenue.verified.label, LABELS.VERIFIED);
  assert.equal(m.revenue.estimated.low, 25000);
  assert.equal(m.revenue.estimated.label, LABELS.ESTIMATED);
});
test("an empty database reports zero, never a sample statistic", () => {
  const m = buildMarketIntel({});
  assert.equal(m.projectsDiscovered, 0);
  assert.equal(m.revenue.verified.amount, 0);
  assert.match(m.revenue.verified.note, /No awarded projects recorded/i);
  assert.match(m.conversionNote, /No projects on record/i);
});
test("film findings with no quantity are excluded and counted, not guessed", () => {
  const m = buildMarketIntel({
    projects: [P("a")],
    filmScope: [{ project_id: "a", film_type: "Security", quantity_sf: 1200 },
                { project_id: "a", film_type: "Solar Control", quantity_sf: null }]
  });
  assert.equal(m.filmSf.specified, 1200);
  assert.equal(m.filmSf.unknownItems, 1);
  assert.match(m.filmSf.note, /excluded, not guessed/i);
});
test("with no film quantities at all the label is UNKNOWN", () => {
  const m = buildMarketIntel({ projects: [P("a")], filmScope: [{ project_id: "a", quantity_sf: null }] });
  assert.equal(m.filmSf.label, LABELS.UNKNOWN);
});
test("breakdowns rank by count", () => {
  const m = buildMarketIntel({
    projects: [P("a", { city: "KC", general_contractor: "JE Dunn" }),
               P("b", { city: "KC", general_contractor: "Turner" }),
               P("c", { city: "Olathe", general_contractor: "JE Dunn" })]
  });
  assert.equal(m.topCities[0].name, "KC");
  assert.equal(m.topCities[0].count, 2);
  assert.equal(m.topGcs[0].name, "JE Dunn");
});

/* ---------- territory ---------- */
test("territories aggregate by city with film rate", () => {
  const t = buildTerritories({
    projects: [P("a", { city: "Overland Park", state: "KS", distance_miles: 25 }),
               P("b", { city: "Overland Park", state: "KS", distance_miles: 30 }),
               P("c", { city: "Lawrence", state: "KS" })],
    filmScope: [{ project_id: "a", film_type: "Security" }],
    bids: [{ project_id: "a", bid_amount: 50000 }]
  });
  const op = t.find(x => x.city === "Overland Park");
  assert.equal(op.projects, 2);
  assert.equal(op.filmOpportunities, 1);
  assert.equal(op.filmRate, 50);
  assert.equal(op.distanceMiles, 25, "nearest project defines the distance");
  assert.equal(op.estimatedValue, 50000);
  assert.equal(op.valueLabel, LABELS.ESTIMATED);
});
test("a territory with no priced work reports UNKNOWN value, not zero", () => {
  const t = buildTerritories({ projects: [P("c", { city: "Lawrence" })] });
  assert.equal(t[0].estimatedValue, null);
  assert.equal(t[0].valueLabel, LABELS.UNKNOWN);
  assert.match(t[0].note, /none priced yet/i);
});
test("projects with no city are skipped rather than bucketed as blank", () => {
  const t = buildTerritories({ projects: [P("a", { city: "" }), P("b", { city: "KC" })] });
  assert.equal(t.length, 1);
});

/* ---------- notifications ---------- */
const NOW = new Date("2026-08-12T08:00:00");
const iso = d => new Date(Date.UTC(2026, 7, 12 + d)).toISOString().slice(0, 10);

test("a bid due today is a high-severity notification", () => {
  const n = buildNotifications({ projects: [P("a", { bid_due: iso(0) })], now: NOW });
  assert.ok(n.items.some(i => i.severity === "high" && /due TODAY/.test(i.title)));
});
test("a pre-bid tomorrow is high severity", () => {
  const n = buildNotifications({ projects: [P("a", { prebid_date: iso(1) })], now: NOW });
  assert.ok(n.items.some(i => i.type === "prebid" && i.severity === "high"));
});
test("a hot untouched project is surfaced", () => {
  const n = buildNotifications({
    projects: [P("a", { status: "New", score_json: JSON.stringify({ total: 88 }) })], now: NOW });
  assert.ok(n.items.some(i => i.type === "hot" && /88\/100/.test(i.title)));
});
test("an unreviewed addendum is high severity", () => {
  const n = buildNotifications({ addenda: [{ project_id: "a", addendum_number: "2" }], now: NOW });
  assert.ok(n.items.some(i => i.type === "addendum" && i.severity === "high"));
});
test("a reviewed addendum does not nag", () => {
  const n = buildNotifications({ addenda: [{ project_id: "a", addendum_number: "2", impact_score: 40 }], now: NOW });
  assert.ok(!n.items.some(i => i.type === "addendum"));
});
test("overdue follow-ups appear, completed ones do not", () => {
  const n = buildNotifications({
    followups: [{ project_id: "a", status: "Open", action: "Call", reason: "x", due_date: iso(-3) },
                { project_id: "a", status: "Done", action: "Call", reason: "y", due_date: iso(-9) }], now: NOW });
  assert.equal(n.items.filter(i => i.type === "followup").length, 1);
});
test("closed projects generate nothing", () => {
  const n = buildNotifications({ projects: [P("a", { status: "Awarded", bid_due: iso(0) })], now: NOW });
  assert.ok(!n.items.some(i => i.type === "bid_due"));
});
test("a submitted bid with no recorded result is a gentle reminder", () => {
  const n = buildNotifications({ projects: [P("a", { status: "Submitted" })], results: [], now: NOW });
  assert.ok(n.items.some(i => i.type === "result_needed" && i.severity === "low"));
});
test("high severity sorts above medium and low", () => {
  const n = buildNotifications({
    projects: [P("a", { status: "Submitted" }), P("b", { bid_due: iso(0) })], now: NOW });
  assert.equal(n.items[0].severity, "high");
});
test("a quiet day says so", () => {
  const n = buildNotifications({ projects: [], now: NOW });
  assert.equal(n.quiet, true);
  assert.equal(n.counts.total, 0);
});
