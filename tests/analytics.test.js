import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeWinLoss, breakdownBy, bestPerformer, historicalPricing,
  compareToHistory, computeRelationshipScore, rankTodaysBids, bidCalendar, MIN_SAMPLE
} from "../src/analytics.js";

const R = (result, extra={}) => ({ result, bid_amount: 40000, gross_profit: 12000, ...extra });

/* ---------- win / loss ---------- */
test("win rate and revenue are computed from decided bids only", () => {
  const w = computeWinLoss([
    R("Won"), R("Won"), R("Lost"), R("Lost"), R("Lost"),
    R("No Decision"), R("Cancelled")
  ]);
  assert.equal(w.decided, 5);
  assert.equal(w.won, 2);
  assert.equal(w.winRate, 40);
  assert.equal(w.revenueWon, 80000);
  assert.equal(w.profitWon, 24000);
  assert.equal(w.noDecision, 1);
  assert.equal(w.cancelled, 1);
});
test("a tiny sample is flagged as not meaningful", () => {
  const w = computeWinLoss([R("Won")]);
  assert.equal(w.winRate, 100);
  assert.equal(w.reliable, false);
  assert.match(w.note, /too few to be meaningful/i);
});
test("sample at the threshold becomes reliable", () => {
  const w = computeWinLoss(Array.from({length: MIN_SAMPLE}, (_,i)=>R(i<3?"Won":"Lost")));
  assert.equal(w.reliable, true);
  assert.equal(w.note, null);
});
test("loss reasons are tallied and the top one surfaced", () => {
  const w = computeWinLoss([
    R("Lost",{reason:"Price"}), R("Lost",{reason:"Price"}),
    R("Lost",{reason:"Competitor"}), R("Won")
  ]);
  assert.equal(w.lossReasons.Price, 2);
  assert.equal(w.topLossReason, "Price");
});
test("no results at all is safe", () => {
  const w = computeWinLoss([]);
  assert.equal(w.winRate, null);
  assert.equal(w.reliable, false);
});

/* ---------- breakdowns ---------- */
test("breakdown by GC computes per-group win rate", () => {
  const rows = breakdownBy([
    R("Won",{gc:"JE Dunn"}), R("Won",{gc:"JE Dunn"}), R("Lost",{gc:"JE Dunn"}),
    R("Lost",{gc:"Turner"}), R("Lost",{gc:"Turner"})
  ], "gc");
  const dunn = rows.find(r=>r.group==="JE Dunn");
  assert.equal(dunn.bids, 3);
  assert.equal(dunn.won, 2);
  assert.equal(dunn.winRate, 67);
  assert.equal(rows.find(r=>r.group==="Turner").winRate, 0);
});
test("bestPerformer refuses to crown a winner on thin data", () => {
  const rows = breakdownBy([R("Won",{gc:"JE Dunn"})], "gc");
  const best = bestPerformer(rows);
  assert.equal(best.reliable, false);
  assert.match(best.note, /not enough to call this a pattern/i);
});
test("bestPerformer names a leader once the sample supports it", () => {
  const results = [
    ...Array.from({length:4},()=>R("Won",{gc:"JE Dunn"})),
    R("Lost",{gc:"JE Dunn"}),
    ...Array.from({length:5},()=>R("Lost",{gc:"Turner"}))
  ];
  const best = bestPerformer(breakdownBy(results,"gc"));
  assert.equal(best.group, "JE Dunn");
  assert.equal(best.reliable, true);
  assert.equal(best.winRate, 80);
});

/* ---------- historical pricing ---------- */
const job = (sf, hours, extra={}) => ({
  film_type:"Security", actual_sf:sf, actual_labor_hours:hours,
  actual_material_cost: sf*2.4, actual_labor_cost: sf*1.9, gross_margin:31, ...extra
});
test("production rate is derived from real completed work", () => {
  const h = historicalPricing([job(1000,20), job(2000,36)], "Security");
  assert.equal(h.sample, 2);
  assert.equal(h.productionRateSfPerHour, 53.6);   // 3000 SF / 56 hours
  assert.equal(h.materialCostPerSf, 2.4);
  assert.equal(h.laborCostPerSf, 1.9);
  assert.equal(h.grossMarginPercent, 31);
});
test("thin history is labelled as a rough indication", () => {
  const h = historicalPricing([job(1000,20)], "Security");
  assert.equal(h.reliable, false);
  assert.match(h.note, /rough indication/i);
});
test("enough history becomes reliable", () => {
  const h = historicalPricing(Array.from({length:MIN_SAMPLE},()=>job(1000,20)), "Security");
  assert.equal(h.reliable, true);
  assert.match(h.note, /Based on 5 completed projects/);
});
test("no history returns nulls, never invented rates", () => {
  const h = historicalPricing([], "Security");
  assert.equal(h.sample, 0);
  assert.equal(h.productionRateSfPerHour, null);
  assert.equal(h.materialCostPerSf, null);
  assert.match(h.note, /No completed projects/i);
});
test("history filters by film type", () => {
  const h = historicalPricing([job(1000,20), job(500,10,{film_type:"Solar Control"})], "Security");
  assert.equal(h.sample, 1);
});
test("jobs missing actuals are excluded rather than guessed", () => {
  const h = historicalPricing([job(1000,20), {film_type:"Security", actual_sf:500}], "Security");
  assert.equal(h.sample, 1);
});

test("comparing a proposed rate to history flags big drift", () => {
  assert.equal(compareToHistory(3.5, 2.4).flag, "warn");
  assert.equal(compareToHistory(2.5, 2.4).flag, "ok");
  assert.match(compareToHistory(3.5, 2.4).note, /above your historical average/);
  assert.equal(compareToHistory(3.5, null).delta, null);
});

/* ---------- relationship ---------- */
test("relationship score rewards wins and recency", () => {
  const strong = computeRelationshipScore({ bids_submitted:7, wins:3, completed_projects:3,
    active_contacts:2, days_since_contact:14, unanswered_bids:0 });
  assert.ok(strong.score >= 70, "got " + strong.score);
  assert.equal(strong.tier, "Strong");
});
test("no history scores zero with a concrete next action", () => {
  const cold = computeRelationshipScore({});
  assert.equal(cold.score, 0);
  assert.equal(cold.tier, "No history");
  assert.match(cold.nextAction, /portal/i);
});
test("stale contact scores lower than recent contact", () => {
  const base = { bids_submitted:5, wins:2, completed_projects:1, active_contacts:1 };
  const recent = computeRelationshipScore({...base, days_since_contact:10});
  const stale  = computeRelationshipScore({...base, days_since_contact:400});
  assert.ok(recent.score > stale.score);
});

/* ---------- dashboard ---------- */
const NOW = new Date("2026-08-12T09:00:00");
const P = (name, days, score, status="Qualified") => ({
  id:name, name, status,
  bid_due: days==null ? null : new Date(Date.UTC(2026,7,12+days)).toISOString().slice(0,10),
  score_json: score==null ? null : JSON.stringify({total:score})
});

test("today's bids put urgent deadlines ahead of higher scores", () => {
  const top = rankTodaysBids([
    P("far-high", 25, 95),
    P("urgent-mid", 3, 60),
    P("far-low", 40, 30)
  ], { now: NOW });
  assert.equal(top[0].name, "urgent-mid", "a bid due in 3 days outranks a better one due in 25");
  assert.equal(top[1].name, "far-high");
});
test("past-due and closed projects are excluded from today's list", () => {
  const top = rankTodaysBids([
    P("past", -2, 90), P("awarded", 5, 90, "Awarded"), P("live", 10, 50)
  ], { now: NOW });
  assert.equal(top.length, 1);
  assert.equal(top[0].name, "live");
});
test("unscored projects still appear, ranked below scored ones", () => {
  const top = rankTodaysBids([P("unscored", 20, null), P("scored", 20, 55)], { now: NOW });
  assert.equal(top[0].name, "scored");
  assert.equal(top.length, 2);
});

test("bid calendar buckets by urgency", () => {
  const cal = bidCalendar([
    P("overdue", -3, 50), P("today", 0, 50), P("week", 4, 50),
    P("month", 20, 50), P("later", 60, 50), P("nodate", null, 50),
    P("won", 5, 50, "Awarded")
  ], NOW);
  assert.equal(cal.pastDue.length, 1);
  assert.equal(cal.today.length, 1);
  assert.equal(cal.thisWeek.length, 1);
  assert.equal(cal.next30.length, 1);
  assert.equal(cal.later.length, 1);
  assert.equal(cal.noDate.length, 1);
  assert.ok(!JSON.stringify(cal).includes("won"), "awarded projects are not on the calendar");
});
