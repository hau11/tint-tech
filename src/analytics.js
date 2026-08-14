// Analytics + historical pricing intelligence.
// All deterministic. The rule throughout: never present a statistic as reliable
// when the sample is too small to support it. A 100% win rate off one bid is
// noise, and telling an estimator otherwise costs real money.
import { num } from "./engines.js";

const round2 = n => Math.round(n * 100) / 100;
const round1 = n => Math.round(n * 10) / 10;

export const MIN_SAMPLE = 5;   // below this, figures are labelled "not yet meaningful"

export const LOSS_REASONS = [
  "Price", "Competitor", "GC selected another subcontractor", "Scope removed",
  "Project cancelled", "No response", "Other", "Unknown"
];

/* ============================================================
   WIN / LOSS
   ============================================================ */
export function computeWinLoss(results = []) {
  const decided = results.filter(r => ["Won", "Lost"].includes(r.result));
  const won = decided.filter(r => r.result === "Won");
  const lost = decided.filter(r => r.result === "Lost");
  const noDecision = results.filter(r => r.result === "No Decision").length;
  const cancelled = results.filter(r => ["Cancelled", "Scope Removed"].includes(r.result)).length;

  const revenueWon = won.reduce((s, r) => s + (num(r.bid_amount) || 0), 0);
  const profitWon = won.reduce((s, r) => s + (num(r.gross_profit) || 0), 0);

  const winRate = decided.length ? Math.round(won.length / decided.length * 100) : null;

  // Why we lose — the most actionable number on the page
  const lossReasons = {};
  for (const r of lost) {
    const key = r.reason || "Unknown";
    lossReasons[key] = (lossReasons[key] || 0) + 1;
  }

  return {
    total: results.length,
    decided: decided.length,
    won: won.length,
    lost: lost.length,
    noDecision, cancelled,
    winRate,
    revenueWon: round2(revenueWon),
    profitWon: round2(profitWon),
    avgWonBid: won.length ? round2(revenueWon / won.length) : null,
    lossReasons,
    topLossReason: Object.entries(lossReasons).sort((a, b) => b[1] - a[1])[0]?.[0] || null,
    reliable: decided.length >= MIN_SAMPLE,
    note: decided.length >= MIN_SAMPLE
      ? null
      : `Based on ${decided.length} decided bid${decided.length === 1 ? "" : "s"} — too few to be meaningful yet. ${MIN_SAMPLE} is the minimum for a usable win rate.`
  };
}

/** Win rate sliced by any dimension (gc, film type, project type, city). */
export function breakdownBy(results = [], key) {
  const groups = {};
  for (const r of results) {
    const g = (r[key] || "Unknown").toString();
    if (!groups[g]) groups[g] = { group: g, bids: 0, won: 0, lost: 0, revenue: 0, profit: 0 };
    const row = groups[g];
    if (["Won", "Lost"].includes(r.result)) row.bids++;
    if (r.result === "Won") {
      row.won++;
      row.revenue += num(r.bid_amount) || 0;
      row.profit += num(r.gross_profit) || 0;
    }
    if (r.result === "Lost") row.lost++;
  }
  return Object.values(groups)
    .map(row => ({
      ...row,
      revenue: round2(row.revenue),
      profit: round2(row.profit),
      winRate: row.bids ? Math.round(row.won / row.bids * 100) : null,
      reliable: row.bids >= MIN_SAMPLE
    }))
    .sort((a, b) => (b.winRate ?? -1) - (a.winRate ?? -1) || b.bids - a.bids);
}

/** Best performer in a breakdown — only when the sample supports the claim. */
export function bestPerformer(rows = []) {
  const eligible = rows.filter(r => r.reliable && r.winRate != null);
  if (!eligible.length) {
    const most = rows.filter(r => r.bids > 0).sort((a, b) => b.bids - a.bids)[0];
    return most
      ? { group: most.group, winRate: most.winRate, bids: most.bids, reliable: false,
          note: `Only ${most.bids} decided bid${most.bids === 1 ? "" : "s"} — not enough to call this a pattern.` }
      : null;
  }
  const top = eligible[0];
  return { group: top.group, winRate: top.winRate, bids: top.bids, reliable: true, note: null };
}

/* ============================================================
   HISTORICAL PRICING INTELLIGENCE
   Learn real production rates and costs from completed jobs.
   ============================================================ */
export function historicalPricing(completed = [], filmType = null) {
  const rows = completed.filter(c =>
    (!filmType || c.film_type === filmType) &&
    num(c.actual_sf) > 0 && num(c.actual_labor_hours) > 0);

  if (!rows.length) {
    return {
      filmType, sample: 0, reliable: false,
      productionRateSfPerHour: null, materialCostPerSf: null,
      laborCostPerSf: null, grossMarginPercent: null,
      note: "No completed projects recorded for this film type yet. Pricing profiles still use your default estimates."
    };
  }

  const totalSf = rows.reduce((s, r) => s + num(r.actual_sf), 0);
  const totalHours = rows.reduce((s, r) => s + num(r.actual_labor_hours), 0);
  const withMaterial = rows.filter(r => num(r.actual_material_cost) != null);
  const withLabor = rows.filter(r => num(r.actual_labor_cost) != null);
  const withMargin = rows.filter(r => num(r.gross_margin) != null);

  const materialSf = withMaterial.reduce((s, r) => s + num(r.actual_sf), 0);
  const laborSf = withLabor.reduce((s, r) => s + num(r.actual_sf), 0);

  return {
    filmType,
    sample: rows.length,
    reliable: rows.length >= MIN_SAMPLE,
    totalSf: round2(totalSf),
    productionRateSfPerHour: round1(totalSf / totalHours),
    materialCostPerSf: materialSf
      ? round2(withMaterial.reduce((s, r) => s + num(r.actual_material_cost), 0) / materialSf) : null,
    laborCostPerSf: laborSf
      ? round2(withLabor.reduce((s, r) => s + num(r.actual_labor_cost), 0) / laborSf) : null,
    grossMarginPercent: withMargin.length
      ? Math.round(withMargin.reduce((s, r) => s + num(r.gross_margin), 0) / withMargin.length) : null,
    note: rows.length >= MIN_SAMPLE
      ? `Based on ${rows.length} completed projects.`
      : `Based on ${rows.length} completed project${rows.length === 1 ? "" : "s"} — treat as a rough indication, not a rate to bid on.`
  };
}

/** Compare a proposed rate against history so an estimator sees drift. */
export function compareToHistory(proposed, historical) {
  const p = num(proposed), h = num(historical);
  if (p == null || h == null) return { delta: null, note: "No historical figure to compare against." };
  const delta = round2(p - h);
  const pct = h !== 0 ? Math.round((p - h) / h * 100) : null;
  let flag = "ok";
  if (pct != null && Math.abs(pct) >= 25) flag = "warn";
  return {
    delta, percent: pct, flag,
    note: pct == null ? null
      : pct > 0 ? `${pct}% above your historical average.`
      : pct < 0 ? `${Math.abs(pct)}% below your historical average.`
      : "Matches your historical average."
  };
}

/* ============================================================
   RELATIONSHIP SCORE (0-100)
   ============================================================ */
export function computeRelationshipScore(company = {}) {
  const bids = num(company.bids_submitted) || 0;
  const wins = num(company.wins) || 0;
  const completed = num(company.completed_projects) || 0;
  const contacts = num(company.active_contacts) || 0;
  const daysSinceContact = num(company.days_since_contact);
  const unanswered = num(company.unanswered_bids) || 0;

  let score = 0;
  score += Math.min(20, bids * 4);                   // engagement
  score += Math.min(30, wins * 10);                  // proven wins
  score += Math.min(20, completed * 7);              // delivered work
  score += Math.min(10, contacts * 5);               // people you know
  if (daysSinceContact != null) {                    // recency
    score += daysSinceContact <= 30 ? 15 : daysSinceContact <= 90 ? 10 : daysSinceContact <= 180 ? 5 : 0;
  }
  // Responsiveness only counts once there IS a relationship — a contractor you
  // have never bid to should score 0, not 5 for never ignoring you.
  if (bids > 0) score += Math.min(5, Math.max(0, 5 - unanswered * 2));
  score = Math.max(0, Math.min(100, Math.round(score)));

  const tier = score >= 70 ? "Strong" : score >= 40 ? "Developing" : score > 0 ? "Cold" : "No history";
  return {
    score, tier,
    nextAction: score === 0 ? "Register in their subcontractor portal and introduce the company."
      : score < 40 ? "Follow up on an open bid or ask to be added to their bid list."
      : score < 70 ? "Keep bidding and check in with your estimator contact."
      : "Maintain the relationship — ask about upcoming projects before they bid."
  };
}

/* ============================================================
   DASHBOARD: what should I bid today
   ============================================================ */
export function rankTodaysBids(projects = [], { limit = 5, now = new Date() } = {}) {
  const open = projects.filter(p =>
    !["Awarded", "Lost", "Cancelled", "Archived", "No Decision", "Completed"].includes(p.status));

  const scored = open.map(p => {
    let score = null;
    try { score = p.score_json ? JSON.parse(p.score_json) : p.score || null; } catch { score = null; }
    const days = daysBetween(now, p.bid_due);
    return {
      ...p,
      bidScore: score?.total ?? null,
      daysUntilBid: days,
      urgent: days != null && days >= 0 && days <= 7,
      pastDue: days != null && days < 0
    };
  }).filter(p => !p.pastDue);

  return scored.sort((a, b) => {
    // urgent work first, then by score, then by nearest deadline
    if (a.urgent !== b.urgent) return a.urgent ? -1 : 1;
    if ((b.bidScore ?? -1) !== (a.bidScore ?? -1)) return (b.bidScore ?? -1) - (a.bidScore ?? -1);
    return (a.daysUntilBid ?? 9999) - (b.daysUntilBid ?? 9999);
  }).slice(0, limit);
}

/** Group open bids into TODAY / THIS WEEK / NEXT 30 DAYS / LATER / PAST DUE. */
export function bidCalendar(projects = [], now = new Date()) {
  const buckets = { pastDue: [], today: [], thisWeek: [], next30: [], later: [], noDate: [] };
  for (const p of projects) {
    if (["Awarded", "Lost", "Cancelled", "Archived", "Completed"].includes(p.status)) continue;
    const d = daysBetween(now, p.bid_due);
    if (d == null) { buckets.noDate.push(p); continue; }
    const row = { ...p, daysUntilBid: d };
    if (d < 0) buckets.pastDue.push(row);
    else if (d === 0) buckets.today.push(row);
    else if (d <= 7) buckets.thisWeek.push(row);
    else if (d <= 30) buckets.next30.push(row);
    else buckets.later.push(row);
  }
  for (const k of Object.keys(buckets)) {
    buckets[k].sort((a, b) => (a.daysUntilBid ?? 9999) - (b.daysUntilBid ?? 9999));
  }
  return buckets;
}

function daysBetween(now, dateStr) {
  if (!dateStr) return null;
  const m = String(dateStr).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const target = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  const start = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((target - start) / 86400000);
}
