// Market + territory intelligence and the notification engine.
// Every figure is separated into VERIFIED (contract values you entered),
// ESTIMATED (ranges we derived), or UNKNOWN. Mixing those three would make the
// whole page a lie, so the separation is structural, not cosmetic.
import { num } from "./engines.js";

const round = n => Math.round(n);
export const LABELS = { VERIFIED: "VERIFIED", ESTIMATED: "ESTIMATED", UNKNOWN: "UNKNOWN" };

/* ============================================================
   MARKET INTELLIGENCE
   ============================================================ */
export function buildMarketIntel({ projects = [], filmScope = [], bids = [], results = [] } = {}) {
  const filmByProject = {};
  for (const f of filmScope) (filmByProject[f.project_id] ||= []).push(f);
  const bidByProject = {};
  for (const b of bids) if (!bidByProject[b.project_id]) bidByProject[b.project_id] = b;

  const wonIds = new Set(results.filter(r => r.result === "Won").map(r => r.project_id));

  let verifiedRevenue = 0, verifiedCount = 0;
  let estimatedLow = 0, estimatedHigh = 0, estimatedCount = 0;
  let filmSfSpecified = 0, filmSfUnknown = 0;

  const byFilmType = {}, byProjectType = {}, byCity = {}, byGc = {}, byArchitect = {};

  for (const p of projects) {
    const films = filmByProject[p.id] || [];
    const bid = bidByProject[p.id];

    if (wonIds.has(p.id) && num(bid?.bid_amount) != null) {
      verifiedRevenue += num(bid.bid_amount); verifiedCount++;
    } else if (num(bid?.bid_amount) != null) {
      estimatedLow += num(bid.bid_amount); estimatedHigh += num(bid.bid_amount); estimatedCount++;
    } else if (num(p.estimated_project_value) != null) {
      estimatedLow += num(p.estimated_project_value); estimatedHigh += num(p.estimated_project_value) * 1.4; estimatedCount++;
    }

    for (const f of films) {
      const sf = num(f.quantity_sf);
      if (sf != null) filmSfSpecified += sf; else filmSfUnknown++;
      if (f.film_type) byFilmType[f.film_type] = (byFilmType[f.film_type] || 0) + 1;
    }
    if (p.project_type) byProjectType[p.project_type] = (byProjectType[p.project_type] || 0) + 1;
    if (p.city) byCity[p.city] = (byCity[p.city] || 0) + 1;
    if (p.general_contractor) byGc[p.general_contractor] = (byGc[p.general_contractor] || 0) + 1;
    if (p.architect) byArchitect[p.architect] = (byArchitect[p.architect] || 0) + 1;
  }

  const opportunities = projects.filter(p => (filmByProject[p.id] || []).length > 0).length;

  return {
    projectsDiscovered: projects.length,
    filmOpportunities: opportunities,
    conversionNote: projects.length
      ? `${opportunities} of ${projects.length} discovered projects show a film opportunity.`
      : "No projects on record yet.",
    revenue: {
      verified: { amount: round(verifiedRevenue), projects: verifiedCount, label: LABELS.VERIFIED,
        note: verifiedCount ? `From ${verifiedCount} awarded project(s) you recorded.` : "No awarded projects recorded yet." },
      estimated: { low: round(estimatedLow), high: round(estimatedHigh), projects: estimatedCount, label: LABELS.ESTIMATED,
        note: estimatedCount ? `Across ${estimatedCount} open project(s). Estimates, not contracts.` : "Nothing priced yet." }
    },
    filmSf: {
      specified: round(filmSfSpecified), label: filmSfSpecified ? LABELS.ESTIMATED : LABELS.UNKNOWN,
      unknownItems: filmSfUnknown,
      note: filmSfUnknown ? `${filmSfUnknown} film finding(s) have no quantity — those are excluded, not guessed.` : null
    },
    topFilmTypes: topN(byFilmType), topProjectTypes: topN(byProjectType),
    topCities: topN(byCity), topGcs: topN(byGc), topArchitects: topN(byArchitect)
  };
}

function topN(counts, n = 6) {
  return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, n)
    .map(([name, count]) => ({ name, count }));
}

/* ============================================================
   TERRITORY INTELLIGENCE
   ============================================================ */
export function buildTerritories({ projects = [], filmScope = [], bids = [], homeCity = "Belton" } = {}) {
  const filmByProject = {};
  for (const f of filmScope) (filmByProject[f.project_id] ||= []).push(f);
  const bidByProject = {};
  for (const b of bids) if (!bidByProject[b.project_id]) bidByProject[b.project_id] = b;

  const territories = {};
  for (const p of projects) {
    const city = (p.city || "").trim();
    if (!city) continue;
    const t = (territories[city] ||= {
      city, state: p.state || "", projects: 0, filmOpportunities: 0,
      estimatedValue: 0, valuedProjects: 0, filmTypes: {}, buildingTypes: {}, distanceMiles: null
    });
    t.projects++;
    if (num(p.distance_miles) != null) {
      t.distanceMiles = t.distanceMiles == null ? num(p.distance_miles)
        : Math.min(t.distanceMiles, num(p.distance_miles));
    }
    const films = filmByProject[p.id] || [];
    if (films.length) t.filmOpportunities++;
    for (const f of films) if (f.film_type) t.filmTypes[f.film_type] = (t.filmTypes[f.film_type] || 0) + 1;
    if (p.project_type) t.buildingTypes[p.project_type] = (t.buildingTypes[p.project_type] || 0) + 1;
    const value = num(bidByProject[p.id]?.bid_amount) ?? num(p.estimated_project_value);
    if (value != null) { t.estimatedValue += value; t.valuedProjects++; }
  }

  return Object.values(territories).map(t => ({
    ...t,
    estimatedValue: t.valuedProjects ? round(t.estimatedValue) : null,
    valueLabel: t.valuedProjects ? LABELS.ESTIMATED : LABELS.UNKNOWN,
    topFilmType: topN(t.filmTypes, 1)[0]?.name || null,
    topBuildingType: topN(t.buildingTypes, 1)[0]?.name || null,
    density: t.projects,
    filmRate: t.projects ? Math.round(t.filmOpportunities / t.projects * 100) : 0,
    isHome: t.city.toLowerCase() === String(homeCity).toLowerCase(),
    note: t.valuedProjects
      ? `${t.valuedProjects} of ${t.projects} project(s) have a value figure.`
      : `${t.projects} project(s), none priced yet — value unknown.`
  })).sort((a, b) => b.filmOpportunities - a.filmOpportunities || b.projects - a.projects);
}

/* ============================================================
   NOTIFICATIONS
   Derived from real state, never stored stale.
   ============================================================ */
export function buildNotifications({ projects = [], followups = [], addenda = [], results = [], now = new Date() } = {}) {
  const items = [];
  const today = startOfDay(now);
  const push = (severity, type, title, detail, projectId) =>
    items.push({ severity, type, title, detail, projectId });

  const open = projects.filter(p => !["Awarded", "Lost", "Cancelled", "Archived", "Completed", "No Decision"].includes(p.status));

  for (const p of open) {
    const d = daysUntil(p.bid_due, today);
    if (d === 0) push("high", "bid_due", `${p.name} — bid due TODAY`, p.bid_due, p.id);
    else if (d != null && d > 0 && d <= 2) push("high", "bid_due", `${p.name} — bid due in ${d} day${d === 1 ? "" : "s"}`, p.bid_due, p.id);
    else if (d != null && d < 0) push("medium", "past_due", `${p.name} — deadline passed`, "Record the result or archive it.", p.id);

    const pb = daysUntil(p.prebid_date, today);
    if (pb != null && pb >= 0 && pb <= 2)
      push("high", "prebid", `${p.name} — pre-bid meeting ${pb === 0 ? "today" : `in ${pb} day${pb === 1 ? "" : "s"}`}`, p.prebid_date, p.id);

    let score = null;
    try { score = p.score_json ? JSON.parse(p.score_json).total : null; } catch { /* ignore */ }
    if (score != null && score >= 80 && ["New", "Discovered"].includes(p.status))
      push("medium", "hot", `${p.name} — scored ${score}/100 and untouched`, "High-scoring opportunity with no work started.", p.id);

    if (d != null && d >= 0 && d <= 7 && score == null)
      push("medium", "unscored", `${p.name} — due in ${d} day(s), not scored`, "Run BUILD MY BID or score it.", p.id);
  }

  // addenda that arrived but were never compared
  for (const a of addenda) {
    if (!a.impact_score && a.impact_score !== 0)
      push("high", "addendum", `Addendum ${a.addendum_number || ""} not reviewed`, "Compare it against your takeoff before bidding.", a.project_id);
  }

  for (const f of followups) {
    if (f.status !== "Open") continue;
    const d = daysUntil(f.due_date, today);
    if (d == null) continue;
    if (d < 0) push("medium", "followup", `Overdue: ${f.action} — ${f.reason}`, f.due_date, f.project_id);
    else if (d === 0) push("medium", "followup", `Today: ${f.action} — ${f.reason}`, f.due_date, f.project_id);
  }

  // awarded/lost projects with no recorded result
  const decided = new Set(results.map(r => r.project_id));
  for (const p of projects) {
    if (["Submitted"].includes(p.status) && !decided.has(p.id))
      push("low", "result_needed", `${p.name} — bid submitted, no result recorded`, "Record won or lost so pricing can learn from it.", p.id);
  }

  const order = { high: 0, medium: 1, low: 2 };
  items.sort((a, b) => order[a.severity] - order[b.severity]);
  return {
    items,
    counts: {
      high: items.filter(i => i.severity === "high").length,
      medium: items.filter(i => i.severity === "medium").length,
      low: items.filter(i => i.severity === "low").length,
      total: items.length
    },
    quiet: items.length === 0
  };
}

function startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function daysUntil(dateStr, today) {
  const m = String(dateStr || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  return Math.round((Date.UTC(+m[1], +m[2] - 1, +m[3]) -
    Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())) / 86400000);
}
