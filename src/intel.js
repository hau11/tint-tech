// Architect intelligence + job costing. Deterministic.
// Two ideas: (1) the architect writes the specification, so knowing who
// specifies what is how you get written in before a bid exists; (2) comparing
// estimated to actual is the only way pricing ever gets more accurate.
import { num } from "./engines.js";

const round2 = n => Math.round(n * 100) / 100;
export const MIN_SAMPLE = 3;   // architects produce fewer data points than bids

/* ============================================================
   ARCHITECT INTELLIGENCE
   ============================================================ */
export function buildArchitectProfiles(projects = [], filmScope = []) {
  const filmByProject = {};
  for (const f of filmScope) {
    if (!filmByProject[f.project_id]) filmByProject[f.project_id] = [];
    filmByProject[f.project_id].push(f);
  }

  const byArchitect = {};
  for (const p of projects) {
    const name = (p.architect || "").trim();
    if (!name) continue;
    if (!byArchitect[name]) byArchitect[name] = {
      architect: name, projects: 0, filmOpportunities: 0, specifiedCount: 0,
      filmTypes: {}, manufacturers: {}, buildingTypes: {}, cities: {},
      projectIds: [], stages: {}
    };
    const a = byArchitect[name];
    a.projects++;
    a.projectIds.push(p.id);
    if (p.project_type) a.buildingTypes[p.project_type] = (a.buildingTypes[p.project_type] || 0) + 1;
    if (p.city) a.cities[p.city] = (a.cities[p.city] || 0) + 1;
    if (p.stage) a.stages[p.stage] = (a.stages[p.stage] || 0) + 1;

    const films = filmByProject[p.id] || [];
    if (films.length) a.filmOpportunities++;
    for (const f of films) {
      if (f.film_type) a.filmTypes[f.film_type] = (a.filmTypes[f.film_type] || 0) + 1;
      if (f.spec_section) a.specifiedCount++;
      const mfr = (f.manufacturer || "").trim();
      if (mfr && !/^not specified$/i.test(mfr)) a.manufacturers[mfr] = (a.manufacturers[mfr] || 0) + 1;
    }
  }

  return Object.values(byArchitect).map(a => {
    const topFilm = topOf(a.filmTypes);
    const topMfr = topOf(a.manufacturers);
    return {
      ...a,
      topFilmType: topFilm,
      topManufacturer: topMfr,
      specifiesFilm: a.specifiedCount > 0,
      filmRate: a.projects ? Math.round(a.filmOpportunities / a.projects * 100) : 0,
      reliable: a.projects >= MIN_SAMPLE,
      note: a.projects >= MIN_SAMPLE
        ? `${a.filmOpportunities} of ${a.projects} projects had a film opportunity.`
        : `Only ${a.projects} project${a.projects === 1 ? "" : "s"} on record — not enough to call this a pattern.`,
      priority: priorityFor(a)
    };
  }).sort((x, y) => y.filmOpportunities - x.filmOpportunities || y.projects - x.projects);
}

function priorityFor(a) {
  // Someone who already specifies film is a relationship to protect. Someone
  // with lots of glazing work and no film spec is the bigger opening.
  if (a.specifiedCount > 0) return { level: "HIGH", reason: "Already specifies film — protect and expand this relationship." };
  if (a.filmOpportunities > 0) return { level: "HIGH", reason: "Film opportunities on their projects but no specification yet — the opening is here." };
  if (a.projects >= MIN_SAMPLE) return { level: "MEDIUM", reason: "Repeat commercial work with no film identified yet." };
  return { level: "LOW", reason: "Not enough history yet." };
}

function topOf(counts) {
  const e = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return e ? { name: e[0], count: e[1] } : null;
}

/** Turn architect profiles into concrete specification opportunities. */
export function findSpecificationOpportunities(profiles = [], projects = []) {
  const out = [];
  for (const a of profiles) {
    const theirProjects = projects.filter(p => (p.architect || "").trim() === a.architect);
    // Early-stage projects are where a specification can still change
    const early = theirProjects.filter(p => ["Planning", "Design", "Permitting"].includes(p.stage));
    for (const p of early) {
      out.push({
        architect: a.architect, project_id: p.id, project_name: p.name,
        stage: p.stage,
        film_category: a.topFilmType?.name || null,
        current_manufacturer: a.topManufacturer?.name || null,
        opportunity: a.specifiesFilm
          ? `Already specifies ${a.topFilmType?.name || "film"} — ask to be listed as an approved installer on this one.`
          : "No film specified on their work yet — offer a lunch-and-learn or a spec section before the documents are finalised.",
        next_action: p.stage === "Design"
          ? "Contact the specification writer now — Design is the last stage where film can be added cheaply."
          : "Introduce film early, before an architect locks the envelope package.",
        priority: a.specifiesFilm ? "HIGH" : early.length > 1 ? "HIGH" : "MEDIUM"
      });
    }
  }
  return out.sort((a, b) => (a.priority === "HIGH" ? -1 : 1) - (b.priority === "HIGH" ? -1 : 1));
}

/* ============================================================
   JOB COSTING — estimated vs actual
   ============================================================ */
export const COST_CATEGORIES = ["material", "labor", "equipment", "mobilization", "other"];

export function computeJobCost(estimated = {}, actual = {}) {
  const lines = COST_CATEGORIES.map(cat => {
    const est = num(estimated[cat]);
    const act = num(actual[cat]);
    const variance = (est != null && act != null) ? round2(act - est) : null;
    const percent = (est != null && act != null && est !== 0) ? Math.round((act - est) / est * 1000) / 10 : null;
    return {
      category: cat, estimated: est, actual: act, variance, percent,
      status: variance == null ? "incomplete" : variance > 0 ? "over" : variance < 0 ? "under" : "on target",
      flag: percent != null && Math.abs(percent) >= 15
        ? `${Math.abs(percent)}% ${percent > 0 ? "over" : "under"} estimate`
        : null
    };
  });

  const totalEst = sum(lines.map(l => l.estimated));
  const totalAct = sum(lines.map(l => l.actual));
  const complete = lines.every(l => l.actual != null || l.estimated == null);
  const anyActual = lines.some(l => l.actual != null);

  const contractPrice = num(actual.contractPrice ?? estimated.contractPrice);
  const estimatedProfit = (contractPrice != null && totalEst != null) ? round2(contractPrice - totalEst) : null;
  const actualProfit = (contractPrice != null && totalAct != null) ? round2(contractPrice - totalAct) : null;

  return {
    lines,
    totalEstimated: totalEst, totalActual: totalAct,
    totalVariance: (totalEst != null && totalAct != null) ? round2(totalAct - totalEst) : null,
    contractPrice,
    estimatedProfit, actualProfit,
    profitVariance: (estimatedProfit != null && actualProfit != null) ? round2(actualProfit - estimatedProfit) : null,
    estimatedMargin: (contractPrice && estimatedProfit != null) ? round2(estimatedProfit / contractPrice * 100) : null,
    actualMargin: (contractPrice && actualProfit != null) ? round2(actualProfit / contractPrice * 100) : null,
    complete,
    note: !anyActual
      ? "No actual costs recorded yet. Enter them after the job to learn what this work really costs."
      : complete ? null : "Partial actuals — variance covers only the categories entered."
  };
}

/** What the variances are telling you. Only speaks when there is evidence. */
export function explainVariance(jobCost) {
  const msgs = [];
  for (const l of jobCost.lines) {
    if (!l.flag) continue;
    if (l.category === "labor" && l.percent > 0)
      msgs.push(`Labor ran ${l.percent}% over. Your production rate for this kind of work may be optimistic — record actual SF and hours so the rate corrects itself.`);
    else if (l.category === "labor" && l.percent < 0)
      msgs.push(`Labor came in ${Math.abs(l.percent)}% under. You may be pricing this work more conservatively than you need to.`);
    else if (l.category === "material" && l.percent > 0)
      msgs.push(`Material ran ${l.percent}% over — check whether the waste factor or the film cost per SF is out of date.`);
    else msgs.push(`${cap(l.category)} was ${l.flag}.`);
  }
  if (jobCost.profitVariance != null && Math.abs(jobCost.profitVariance) >= 500) {
    msgs.push(jobCost.profitVariance > 0
      ? `You made ${fmt(jobCost.profitVariance)} more than estimated on this job.`
      : `You made ${fmt(Math.abs(jobCost.profitVariance))} less than estimated on this job.`);
  }
  return msgs;
}

/** Roll actuals across jobs into corrected rates — needs a real sample. */
export function costTrends(jobCosts = [], minSample = MIN_SAMPLE) {
  const byCategory = {};
  for (const j of jobCosts) {
    const est = num(j.estimated), act = num(j.actual);
    if (est == null || act == null || est === 0) continue;
    if (!byCategory[j.category]) byCategory[j.category] = [];
    byCategory[j.category].push((act - est) / est * 100);
  }
  const out = {};
  for (const [cat, arr] of Object.entries(byCategory)) {
    const mean = arr.reduce((s, v) => s + v, 0) / arr.length;
    out[cat] = {
      sample: arr.length,
      reliable: arr.length >= minSample,
      averageVariancePercent: Math.round(mean * 10) / 10,
      note: arr.length >= minSample
        ? `Across ${arr.length} jobs, ${cat} runs ${Math.abs(Math.round(mean))}% ${mean > 0 ? "over" : "under"} estimate.`
        : `${arr.length} job(s) — not enough to adjust your rates on.`
    };
  }
  return out;
}

function sum(arr) {
  const vals = arr.filter(v => v != null);
  return vals.length ? round2(vals.reduce((s, v) => s + v, 0)) : null;
}
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const fmt = n => "$" + Math.round(n).toLocaleString("en-US");
