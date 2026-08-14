// Deterministic engines — NO AI, NO network, NO Cloudflare bindings.
// Everything here is pure math and string logic so it can be unit-tested and
// so that prices and scores are reproducible. AI explains these numbers;
// it never computes them.

export const FILM_TYPES = [
  "Solar Control", "Security", "Safety", "Decorative", "Privacy", "Frosted",
  "Bird Strike", "Blast Mitigation", "Anti-Graffiti", "Exterior",
  "Energy Retrofit", "Switchable", "Projection", "Whiteboard", "Other"
];

export const PROJECT_STATUSES = [
  "New", "Discovered", "Qualified", "Analyzing", "Takeoff", "Pricing",
  "Ready to Bid", "Submitted", "Awarded", "Lost", "No Decision", "Cancelled", "Archived"
];

export const UNKNOWN = "Unknown";
export const NOT_SPECIFIED = "Not specified";

/* ============================================================
   FILM SEARCH DICTIONARY
   ============================================================ */
export const FILM_DICTIONARY = {
  "Solar Control": ["window film", "solar film", "solar control", "solar-control", "sun control",
    "sun-control", "uv film", "heat rejection", "glare reduction", "solar protection",
    "energy film", "low-e film", "low e film", "spectrally selective"],
  "Security": ["security film", "safety film", "security glazing film", "anti-shatter",
    "antishatter", "forced entry", "forced-entry", "blast film", "bomb blast",
    "retention film", "attachment system", "protective film", "glass retention"],
  "Decorative": ["decorative film", "etched film", "manifestation", "translucent film",
    "opaque film", "patterned film", "gradient film", "dusted crystal"],
  "Privacy": ["privacy film", "one-way film", "one way mirror film"],
  "Frosted": ["frosted film", "frost film", "sandblast film", "acid etch film"],
  "Bird Strike": ["bird strike", "bird-strike", "bird safe", "bird-safe", "bird deterrent",
    "bird friendly", "bird-friendly", "fritted pattern film"],
  "Blast Mitigation": ["blast mitigation", "blast resistant", "blast-resistant",
    "anti-terrorism", "antiterrorism", "gsa level", "ufc 4-010-01"],
  "Anti-Graffiti": ["anti-graffiti", "antigraffiti", "graffiti film", "sacrificial film"],
  "Switchable": ["switchable film", "smart film", "pdlc", "electrochromic film"],
  "Projection": ["projection film", "rear projection film"],
  "Whiteboard": ["whiteboard film", "dry erase film", "dry-erase film"],
  "Exterior": ["exterior film", "exterior applied", "exterior grade film"]
};

// Glazing terms — film may be an opportunity even when "film" is never written
export const GLAZING_TERMS = ["storefront", "curtain wall", "curtainwall", "punched window",
  "window schedule", "glazing schedule", "insulated glass", "spandrel", "vision glass",
  "glass door", "glass wall", "skylight", "glass railing", "aluminum framed", "tempered glass",
  "laminated glass", "monolithic glass", "glazing system", "fenestration"];

export const SPEC_SECTIONS = ["08 87 00", "08 87 13", "088713", "088700", "08 80 00", "088000",
  "08 44 13", "084413", "08 41 13", "084113"];

/**
 * Scan text for film + glazing evidence. Returns matched terms with the film
 * type they imply. Purely lexical — this is the cheap pre-filter that decides
 * which pages are worth sending to the AI (AI cost control, spec §46).
 */
export function detectFilmTerms(text) {
  if (!text) return { filmMatches: [], glazingMatches: [], specMatches: [], relevance: 0 };
  const hay = String(text).toLowerCase();
  const filmMatches = [];
  for (const [type, terms] of Object.entries(FILM_DICTIONARY)) {
    for (const term of terms) {
      if (hay.includes(term)) filmMatches.push({ type, term });
    }
  }
  const glazingMatches = GLAZING_TERMS.filter(t => hay.includes(t));
  const specMatches = SPEC_SECTIONS.filter(s => hay.includes(s.toLowerCase()));
  // relevance 0-100: film evidence weighs most, then spec sections, then glazing
  const relevance = Math.min(100,
    filmMatches.length * 25 + specMatches.length * 20 + glazingMatches.length * 6);
  return { filmMatches, glazingMatches, specMatches, relevance };
}

export function classifySheetText(text) {
  const hay = String(text || "").toLowerCase();
  if (!hay.trim()) return "Other";
  if (/window schedule/.test(hay)) return "Window Schedule";
  if (/glazing schedule|glass schedule/.test(hay)) return "Glazing Schedule";
  if (/\baddend(um|a)\b/.test(hay)) return "Addendum";
  if (/\belevation\b/.test(hay)) return "Elevation";
  if (/floor plan|\bplan\b.*\blevel\b/.test(hay)) return "Floor Plan";
  if (/section 08|division 08|specification|\bpart 1\b.*\bgeneral\b/.test(hay)) return "Specification";
  if (/structural|\bfooting\b|\bcolumn schedule\b/.test(hay)) return "Structural";
  if (/mechanical|electrical|plumbing|\bhvac\b/.test(hay)) return "MEP";
  if (/\bcivil\b|\bgrading\b|\bsite plan\b/.test(hay)) return "Civil";
  if (/architectural|\ba-\d{3}\b/.test(hay)) return "Architectural";
  return "Other";
}

/* ============================================================
   CONFIDENCE
   ============================================================ */
export function confidenceLabel(score) {
  if (score == null || isNaN(score)) return { label: UNKNOWN, needsVerification: true };
  const pct = score <= 1 ? score * 100 : score;
  if (pct >= 90) return { label: "HIGH", pct: Math.round(pct), needsVerification: false };
  if (pct >= 70) return { label: "MEDIUM", pct: Math.round(pct), needsVerification: true };
  return { label: "LOW", pct: Math.round(pct), needsVerification: true };
}

/* ============================================================
   TAKEOFF ENGINE  —  quantity x width x height = SF
   ============================================================ */
export function computeGlazingItem(item) {
  const qty = num(item.quantity), w = num(item.width_ft), h = num(item.height_ft);
  if (qty == null || w == null || h == null) {
    return {
      area_sf: null,
      calculation: UNKNOWN,
      reason: "No usable dimensions found in available documents."
    };
  }
  const area = round2(qty * w * h);
  return {
    area_sf: area,
    calculation: `${trim(qty)} × ${trim(w)}' × ${trim(h)}' = ${area.toLocaleString()} SF`
  };
}

/**
 * Roll up glazing items into a takeoff. Items missing dimensions are reported
 * separately as unknowns instead of being silently dropped or guessed.
 */
export function computeTakeoff(items = [], opts = {}) {
  const wastePercent = num(opts.wastePercent) ?? 10;
  const coveragePercent = num(opts.coveragePercent) ?? 100;
  const lines = [];
  const unknowns = [];
  let totalGlazing = 0;
  for (const it of items) {
    const c = computeGlazingItem(it);
    if (c.area_sf == null) { unknowns.push({ ...it, reason: c.reason }); continue; }
    totalGlazing += c.area_sf;
    lines.push({ ...it, area_sf: c.area_sf, calculation: c.calculation });
  }
  totalGlazing = round2(totalGlazing);
  const filmSf = round2(totalGlazing * coveragePercent / 100);
  const wasteSf = round2(filmSf * wastePercent / 100);
  const materialSf = round2(filmSf + wasteSf);
  // Confidence: driven by how much of the scope has real dimensions
  const known = lines.length, total = lines.length + unknowns.length;
  const coverageRatio = total ? known / total : 0;
  const confidence = total === 0 ? null : round2(coverageRatio * 100);
  return {
    lines, unknowns,
    totalGlazingSf: totalGlazing,
    filmSf, wastePercent, wasteSf, materialSf,
    confidence,
    confidenceDetail: confidenceLabel(confidence),
    note: unknowns.length
      ? `${unknowns.length} item(s) lack usable dimensions and are excluded from the total. Estimator verification required.`
      : null
  };
}

/* ============================================================
   PRICING ENGINE
   Material + Labor + Equipment + Mobilization + Other
   + Overhead + Profit = Bid Price
   ============================================================ */
export function computePricing(input = {}) {
  const materialSf = num(input.materialSf) ?? 0;      // film SF incl. waste
  const billableSf = num(input.filmSf) ?? materialSf;  // SF actually installed
  const materialCostPerSf = num(input.materialCostPerSf) ?? 0;
  const laborHoursPer100Sf = num(input.laborHoursPer100Sf);
  const productionRateSfPerHour = num(input.productionRateSfPerHour);
  const laborRate = num(input.laborCostPerHour) ?? 0;

  const materialCost = round2(materialSf * materialCostPerSf);

  // Labor hours from either a per-100SF rate or a production rate (SF/hour)
  let laborHours = null;
  if (laborHoursPer100Sf != null) laborHours = billableSf / 100 * laborHoursPer100Sf;
  else if (productionRateSfPerHour) laborHours = billableSf / productionRateSfPerHour;
  laborHours = laborHours == null ? 0 : round2(laborHours);
  const laborCost = round2(laborHours * laborRate);

  const equipmentCost = num(input.equipmentCost) ?? 0;
  const mobilizationCost = num(input.mobilizationCost) ?? 0;
  const removalCost = num(input.removalCost) ?? 0;
  const surfacePrepCost = num(input.surfacePrepCost) ?? 0;
  const liftCost = num(input.liftCost) ?? 0;
  const freightCost = num(input.freightCost) ?? 0;
  const engineeringCost = num(input.engineeringCost) ?? 0;
  const otherCost = round2(removalCost + surfacePrepCost + liftCost + freightCost + engineeringCost);

  const directCost = round2(materialCost + laborCost + equipmentCost + mobilizationCost + otherCost);
  const overheadPercent = num(input.overheadPercent) ?? 0;
  const overhead = round2(directCost * overheadPercent / 100);
  const totalCost = round2(directCost + overhead);

  const profitPercent = num(input.profitPercent) ?? 0;
  const profit = round2(totalCost * profitPercent / 100);
  const bidPrice = round2(totalCost + profit);

  const grossProfit = round2(bidPrice - totalCost);
  const grossMargin = bidPrice > 0 ? round2(grossProfit / bidPrice * 100) : 0;

  return {
    materialSf, billableSf,
    materialCost, laborHours, laborCost,
    equipmentCost, mobilizationCost,
    removalCost, surfacePrepCost, liftCost, freightCost, engineeringCost, otherCost,
    directCost, overheadPercent, overhead, totalCost,
    profitPercent, profit, bidPrice, grossProfit, grossMargin
  };
}

/** Conservative / Target / Aggressive scenarios off one input set. */
export function pricingScenarios(input = {}) {
  const base = num(input.profitPercent) ?? 35;
  return {
    conservative: computePricing({ ...input, profitPercent: base + 10 }),
    target: computePricing({ ...input, profitPercent: base }),
    aggressive: computePricing({ ...input, profitPercent: Math.max(0, base - 10) })
  };
}

/* ============================================================
   BID SCORE — deterministic, 0-100 (spec §18)
   AI explains this score; it does not set it.
   ============================================================ */
export const SCORE_WEIGHTS = {
  filmOpportunity: 25, revenue: 20, grossProfit: 20,
  distance: 10, timeline: 10, gcRelationship: 5, competition: 5, strategic: 5
};

export function computeBidScore(p = {}) {
  const parts = {};
  const unknowns = [];

  // Film opportunity (0-25): explicit spec > film evidence > glazing only
  if (p.filmExplicitlySpecified) parts.filmOpportunity = 25;
  else if (p.filmEvidenceCount > 0) parts.filmOpportunity = Math.min(20, 10 + p.filmEvidenceCount * 2);
  else if (p.glazingEvidenceCount > 0) parts.filmOpportunity = 8;
  else { parts.filmOpportunity = 0; unknowns.push("No film or glazing evidence yet — upload documents."); }

  // Revenue (0-20)
  const rev = num(p.estimatedRevenue);
  if (rev == null) { parts.revenue = 0; unknowns.push("Estimated revenue unknown."); }
  else if (rev >= 75000) parts.revenue = 20;
  else if (rev >= 40000) parts.revenue = 15;
  else if (rev >= 20000) parts.revenue = 10;
  else if (rev >= 7500) parts.revenue = 5;
  else parts.revenue = 2;

  // Gross profit (0-20)
  const gp = num(p.estimatedGrossProfit);
  if (gp == null) { parts.grossProfit = 0; unknowns.push("Estimated gross profit unknown."); }
  else if (gp >= 20000) parts.grossProfit = 20;
  else if (gp >= 10000) parts.grossProfit = 15;
  else if (gp >= 5000) parts.grossProfit = 10;
  else if (gp >= 2000) parts.grossProfit = 5;
  else parts.grossProfit = 2;

  // Distance from Belton, MO (0-10)
  const miles = num(p.distanceMiles);
  if (miles == null) { parts.distance = 0; unknowns.push("Distance unknown — no project address."); }
  else if (miles <= 40) parts.distance = 10;
  else if (miles <= 75) parts.distance = 7;
  else if (miles <= 150) parts.distance = 4;
  else if (miles <= 400) parts.distance = 2;
  else parts.distance = 1;

  // Bid timeline (0-10)
  const days = num(p.daysUntilBid);
  if (days == null) { parts.timeline = 0; unknowns.push("Bid date unknown."); }
  else if (days < 0) parts.timeline = 0;
  else if (days >= 7) parts.timeline = 10;
  else if (days >= 4) parts.timeline = 6;
  else if (days >= 2) parts.timeline = 3;
  else parts.timeline = 1;

  // GC relationship (0-5) — relationship score 0-100
  const rel = num(p.gcRelationshipScore);
  parts.gcRelationship = rel == null ? 0 : Math.round(Math.min(5, rel / 20));

  // Competition (0-5): low=5, medium=3, high=1
  const comp = String(p.competition || "").toLowerCase();
  parts.competition = comp === "low" ? 5 : comp === "medium" ? 3 : comp === "high" ? 1 : 0;
  if (!comp) unknowns.push("Competition level not assessed.");

  // Strategic value (0-5)
  const strat = String(p.strategicValue || "").toLowerCase();
  parts.strategic = strat === "high" ? 5 : strat === "medium" ? 3 : strat === "low" ? 1 : 0;

  const total = Object.values(parts).reduce((a, b) => a + b, 0);
  return { total, breakdown: parts, weights: SCORE_WEIGHTS, unknowns };
}

export function bidRecommendation(score) {
  const t = typeof score === "object" ? score.total : score;
  if (t >= 70) return { action: "BID", color: "green" };
  if (t >= 45) return { action: "REVIEW", color: "amber" };
  return { action: "SKIP", color: "red" };
}

/* ============================================================
   BID READINESS (spec §20)
   ============================================================ */
export const READINESS_ITEMS = [
  ["projectIdentified", "Project information"],
  ["gcIdentified", "General contractor identified"],
  ["architectIdentified", "Architect identified"],
  ["bidDateVerified", "Bid date verified"],
  ["addendaReviewed", "All addenda reviewed"],
  ["filmScopeIdentified", "Film scope identified"],
  ["quantitiesEstimated", "Quantities estimated"],
  ["filmProductsIdentified", "Film products identified"],
  ["pricingComplete", "Pricing complete"],
  ["exclusionsReviewed", "Exclusions reviewed"],
  ["rfisResolved", "RFI issues resolved"],
  ["proposalGenerated", "Proposal generated"]
];

export function computeBidReadiness(flags = {}) {
  const items = READINESS_ITEMS.map(([key, label]) => ({ key, label, done: Boolean(flags[key]) }));
  const done = items.filter(i => i.done).length;
  return {
    percent: Math.round(done / items.length * 100),
    done, total: items.length,
    items,
    outstanding: items.filter(i => !i.done).map(i => i.label)
  };
}

/* ============================================================
   DEDUPLICATION (spec §32)
   ============================================================ */
const STOPWORDS = new Set(["the", "a", "an", "of", "and", "for", "at", "to", "in", "on",
  "project", "building", "bldg", "replace", "replacement", "repair", "repairs", "phase",
  "state", "office", "city", "county", "improvements", "renovation", "renovations"]);

export function normalizeName(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(w => w && !STOPWORDS.has(w))
    .sort()
    .join(" ")
    .trim();
}

export function normalizeSolicitation(no) {
  const s = String(no || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return s && s !== "-" ? s : "";
}

/** Stable key used for dedupe across sources. */
export function dedupeKey(p = {}) {
  const sol = normalizeSolicitation(p.project_number || p.projectNo || p.bidNumber);
  if (sol) return "sol:" + sol;
  const addr = String(p.address || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (addr.length > 8) return "addr:" + addr;
  return "name:" + normalizeName(p.name || p.title);
}

export function isDuplicate(a, b) {
  if (!a || !b) return false;
  if (dedupeKey(a) === dedupeKey(b)) return true;
  const solA = normalizeSolicitation(a.project_number || a.bidNumber);
  const solB = normalizeSolicitation(b.project_number || b.bidNumber);
  if (solA && solB && solA === solB) return true;
  const nameA = normalizeName(a.name), nameB = normalizeName(b.name);
  if (nameA && nameB) {
    if (nameA === nameB) return true;
    if (tokenOverlap(nameA, nameB) >= 0.8) return true;
    // One name fully contained in the other (needs >=2 distinctive tokens to
    // avoid merging unrelated short titles).
    const c = tokenContainment(nameA, nameB);
    if (c.containment === 1 && c.smallerSize >= 2) return true;
  }
  const urlA = String(a.source_url || "").trim(), urlB = String(b.source_url || "").trim();
  if (urlA && urlA === urlB) return true;
  return false;
}

function tokenContainment(a, b) {
  const A = new Set(a.split(" ")), B = new Set(b.split(" "));
  const [small, large] = A.size <= B.size ? [A, B] : [B, A];
  if (!small.size) return { containment: 0, smallerSize: 0 };
  let hit = 0;
  for (const t of small) if (large.has(t)) hit++;
  return { containment: hit / small.size, smallerSize: small.size };
}

function tokenOverlap(a, b) {
  const A = new Set(a.split(" ")), B = new Set(b.split(" "));
  if (!A.size || !B.size) return 0;
  let hit = 0;
  for (const t of A) if (B.has(t)) hit++;
  return hit / Math.max(A.size, B.size);
}

/* ============================================================
   SOURCE QUALITY (spec §33)
   ============================================================ */
export function sourceQualityScore(s = {}) {
  let score = 0;
  if (s.official) score += 30;
  if (s.documentsAvailable) score += 20;
  if (s.bidDatesReliable) score += 20;
  if (s.projectDetails) score += 15;
  const dupRate = num(s.duplicateRate) ?? 0;      // 0-1
  score += Math.round(10 * (1 - Math.min(1, dupRate)));
  const useful = num(s.historicalUsefulness) ?? 0; // 0-1
  score += Math.round(5 * Math.min(1, useful));
  return Math.max(0, Math.min(100, score));
}

/* ============================================================
   DATES / HELPERS
   ============================================================ */
export function daysUntil(dateStr, now = new Date()) {
  if (!dateStr) return null;
  const iso = toISODate(dateStr);
  if (!iso) return null;
  const [y, m, d] = iso.split("-").map(Number);
  const target = Date.UTC(y, m - 1, d);
  const start = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((target - start) / 86400000);
}

/** Accepts yyyy-mm-dd, m/d/yyyy, m/d/yy. Returns yyyy-mm-dd or null. */
export function toISODate(input) {
  const s = String(input || "").trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (m) {
    let y = m[3].length === 2 ? "20" + m[3] : m[3];
    return `${y}-${pad(m[1])}-${pad(m[2])}`;
  }
  return null;
}

const pad = n => String(n).padStart(2, "0");
export function num(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
}
function round2(n) { return Math.round(n * 100) / 100; }
function trim(n) { return Number.isInteger(n) ? n : round2(n); }

/* ============================================================
   ROLL OPTIMIZER + TAKEOFF ASSEMBLY (Phase 3)
   ============================================================ */
export const ROLL_WIDTHS_IN = [36, 48, 60, 72];
export const ROLL_LENGTH_FT = 100;

/**
 * Rolls needed for a given material area. Uses usable width after trim, since
 * a pane wider than the roll needs a seam and wastes the remainder.
 */
export function computeRolls({ materialSf, rollWidthIn = 60, rollLengthFt = ROLL_LENGTH_FT, trimIn = 0.5 }) {
  const sf = num(materialSf);
  if (sf == null || sf <= 0) return { rolls: 0, rollSf: 0, coverageSf: 0, leftoverSf: 0 };
  const usableWidthFt = (num(rollWidthIn) - num(trimIn)) / 12;
  const rollSf = round2(usableWidthFt * num(rollLengthFt));
  const rolls = Math.ceil(sf / rollSf);
  return {
    rolls, rollSf,
    coverageSf: round2(rolls * rollSf),
    leftoverSf: round2(rolls * rollSf - sf)
  };
}

/** Widest pane that fits a roll without seaming. */
export function recommendRollWidth(glazingItems = []) {
  const widths = glazingItems
    .map(g => Math.max(num(g.width_ft) ?? 0, num(g.height_ft) ?? 0))
    .filter(w => w > 0);
  if (!widths.length) return { rollWidthIn: 60, reason: "No dimensions available — defaulted to 60\".", maxPaneFt: null };
  const maxPane = Math.max(...widths);
  const fit = ROLL_WIDTHS_IN.find(w => (w - 0.5) / 12 >= maxPane);
  return fit
    ? { rollWidthIn: fit, maxPaneFt: round2(maxPane), reason: `Largest pane dimension is ${round2(maxPane)}' — a ${fit}" roll covers it without a seam.` }
    : { rollWidthIn: 72, maxPaneFt: round2(maxPane), reason: `Largest pane dimension is ${round2(maxPane)}', which exceeds a 72" roll — those panes will need a seam.`, seamRequired: true };
}

/**
 * Build editable takeoff lines from stored glazing items.
 * Estimator-edited rows are preserved and marked; AI values are never
 * overwritten silently.
 */
export function buildTakeoffLines(glazingItems = [], { defaultFilmType = null, wastePercent = 10 } = {}) {
  return glazingItems.map(g => {
    const qty = num(g.quantity), w = num(g.width_ft), h = num(g.height_ft);
    const known = qty != null && w != null && h != null;
    const area = known ? round2(qty * w * h) : null;
    return {
      id: g.id,
      windowMark: g.window_mark || null,
      windowType: g.window_type || null,
      floor: g.floor || null,
      quantity: qty, widthFt: w, heightFt: h,
      areaSf: area,
      calculation: known
        ? `${trim(qty)} × ${trim(w)}' × ${trim(h)}' = ${area.toLocaleString()} SF`
        : UNKNOWN,
      filmType: g.film_type || defaultFilmType,
      wastePercent,
      materialSf: area != null ? round2(area * (1 + wastePercent / 100)) : null,
      sourceSheet: g.source_sheet || null,
      sourcePage: g.source_page ?? null,
      confidence: num(g.confidence),
      estimatorOverride: Boolean(g.estimator_override),
      needsVerification: !known || (num(g.confidence) ?? 0) < 90
    };
  });
}

/** Group a takeoff by floor, then by film type — how estimators read it. */
export function summarizeTakeoff(lines = []) {
  const byFloor = {}, byFilmType = {};
  let total = 0, unknownCount = 0;
  for (const l of lines) {
    if (l.areaSf == null) { unknownCount++; continue; }
    total += l.areaSf;
    const f = l.floor || "Unassigned";
    byFloor[f] = round2((byFloor[f] || 0) + l.areaSf);
    const t = l.filmType || "Unassigned";
    byFilmType[t] = round2((byFilmType[t] || 0) + l.areaSf);
  }
  return {
    totalSf: round2(total),
    byFloor, byFilmType,
    lineCount: lines.length,
    unknownCount,
    verifiedSf: round2(lines.filter(l => l.areaSf != null && !l.needsVerification)
      .reduce((s, l) => s + l.areaSf, 0))
  };
}
