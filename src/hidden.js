// Hidden Tint Scope Detector (V2.5 §8).
// Most commercial projects have significant glazing and never mention film.
// Those are not dead leads — they are the ones where you can still get film
// specified or sold as an add-on. This finds them and sizes the opportunity as
// an explicit RANGE, never as a quantity the system pretends to know.
import { num } from "./engines.js";

/* ---------- glazing signals, weighted by how much film they usually carry ---------- */
const GLAZING_SIGNALS = [
  { term: "curtain wall",      weight: 10, filmFit: ["Solar Control", "Safety"] },
  { term: "curtainwall",       weight: 10, filmFit: ["Solar Control", "Safety"] },
  { term: "storefront",        weight: 9,  filmFit: ["Solar Control", "Security", "Safety"] },
  { term: "window wall",       weight: 9,  filmFit: ["Solar Control"] },
  { term: "vision glass",      weight: 7,  filmFit: ["Solar Control"] },
  { term: "glass partition",   weight: 8,  filmFit: ["Decorative", "Privacy"] },
  { term: "glass wall",        weight: 8,  filmFit: ["Decorative", "Privacy"] },
  { term: "interior glass",    weight: 7,  filmFit: ["Decorative", "Privacy"] },
  { term: "glass door",        weight: 5,  filmFit: ["Safety", "Decorative"] },
  { term: "skylight",          weight: 6,  filmFit: ["Solar Control"] },
  { term: "clerestory",        weight: 6,  filmFit: ["Solar Control"] },
  { term: "punched window",    weight: 6,  filmFit: ["Solar Control", "Security"] },
  { term: "exterior glazing",  weight: 8,  filmFit: ["Solar Control"] },
  { term: "insulated glass",   weight: 5,  filmFit: ["Solar Control"] },
  { term: "window schedule",   weight: 7,  filmFit: [] },
  { term: "glazing schedule",  weight: 7,  filmFit: [] },
  { term: "aluminum framed",   weight: 4,  filmFit: [] },
  { term: "spandrel",          weight: 3,  filmFit: [] },
  { term: "atrium glass",      weight: 7,  filmFit: ["Solar Control", "Bird Strike"] },
  { term: "glass railing",     weight: 4,  filmFit: ["Decorative", "Safety"] },
  { term: "glazed",            weight: 4,  filmFit: [] },
  { term: "glazing",           weight: 6,  filmFit: [] }
];

/* ---------- conditions that make a specific film an easy sell ---------- */
const DRIVERS = [
  { driver: "Solar heat / glare",   re: /\b(south|west)[- ]facing|solar heat|heat gain|glare|sun exposure|daylighting|energy (efficiency|conservation|code)|shgc\b/i, film: "Solar Control" },
  { driver: "Security / hardening", re: /\b(security|hardening|forced entry|vandal|detention|courthouse|police|justice center|school safety|active shooter)\b/i, film: "Security" },
  { driver: "Safety glazing",       re: /\b(safety glazing|glass breakage|impact resistant|hurricane|tempered)\b/i, film: "Safety" },
  { driver: "Privacy",              re: /\b(privacy|confidential|exam rooms?|conference rooms?|patient rooms?|hr office|meeting rooms?|treatment rooms?|break rooms?)\b/i, film: "Privacy" },
  { driver: "Branding / decorative",re: /\b(branding|graphics|manifestation|frosted|logo|wayfinding|lobby)\b/i, film: "Decorative" },
  { driver: "Bird strike",          re: /\b(bird ?strike|bird ?safe|audubon|leed pilot credit 55|atrium glass)\b/i, film: "Bird Strike" },
  { driver: "Graffiti exposure",    re: /\b(graffiti|transit|bus shelter|parking structure|vandalism)\b/i, film: "Anti-Graffiti" }
];

/**
 * Detect a hidden film opportunity in a project that never mentions film.
 * @param text  project title, description, or extracted document text
 * @param opts.filmAlreadySpecified  true when film IS named (then there is nothing hidden)
 * @param opts.knownGlazingSf        measured glazing SF, if a takeoff exists
 * @param opts.buildingSf            building size, if stated
 */
export function detectHiddenTintScope(text, opts = {}) {
  const hay = " " + String(text || "").toLowerCase().replace(/\s+/g, " ") + " ";
  const signals = GLAZING_SIGNALS.filter(s => hay.includes(s.term));
  const drivers = DRIVERS.filter(d => d.re.test(hay)).map(d => ({ driver: d.driver, film: d.film }));

  if (opts.filmAlreadySpecified) {
    return {
      hidden: false, reason: "Film is already specified on this project — nothing hidden.",
      signals: signals.map(s => s.term), drivers, confidence: null, potential: null
    };
  }
  if (!signals.length) {
    return {
      hidden: false, reason: "No glazing signals found — no basis for a film opportunity.",
      signals: [], drivers, confidence: null, potential: null
    };
  }

  // Confidence that a real film opportunity exists here. Driven by how much
  // glazing evidence there is and whether a condition favours a specific film.
  const signalScore = Math.min(60, signals.reduce((s, x) => s + x.weight, 0) * 2);
  const driverScore = Math.min(30, drivers.length * 15);
  const measuredBonus = num(opts.knownGlazingSf) > 0 ? 15 : num(opts.buildingSf) > 0 ? 8 : 0;
  const confidence = Math.min(95, signalScore + driverScore + measuredBonus);

  // Which films fit, most-supported first
  const fitCounts = {};
  for (const s of signals) for (const f of s.filmFit) fitCounts[f] = (fitCounts[f] || 0) + s.weight;
  for (const d of drivers) fitCounts[d.film] = (fitCounts[d.film] || 0) + 15;
  const recommendedFilms = Object.entries(fitCounts).sort((a, b) => b[1] - a[1]).map(([f]) => f).slice(0, 3);

  return {
    hidden: true,
    signals: signals.map(s => s.term),
    drivers,
    recommendedFilms,
    confidence,
    potential: estimateHiddenPotential(opts),
    reason: `Glazing detected (${signals.slice(0, 3).map(s => s.term).join(", ")}) with no film specification found.`,
    recommendedAction: drivers.length
      ? `Contact the architect or GC about ${recommendedFilms[0] || "film"} — the documents already describe a condition it solves (${drivers[0].driver.toLowerCase()}).`
      : "Contact the architect or specifier before the bid documents are finalized, while film can still be added to the scope."
  };
}

/**
 * Size the opportunity. Ranges only, and null when there is nothing to base a
 * number on — a made-up square footage here would poison a bid.
 */
export function estimateHiddenPotential({ knownGlazingSf, buildingSf, coverageLow = 0.3, coverageHigh = 0.7, pricePerSf = 9 } = {}) {
  const glazing = num(knownGlazingSf);
  if (glazing != null && glazing > 0) {
    const low = Math.round(glazing * coverageLow);
    const high = Math.round(glazing * coverageHigh);
    return {
      basis: "measured glazing",
      glazingSf: glazing,
      filmSfLow: low, filmSfHigh: high,
      valueLow: Math.round(low * pricePerSf), valueHigh: Math.round(high * pricePerSf),
      label: "ESTIMATED",
      note: `Based on ${glazing.toLocaleString()} SF of measured glazing at ${Math.round(coverageLow * 100)}–${Math.round(coverageHigh * 100)}% film coverage. Coverage varies by project — verify against the drawings.`
    };
  }
  const bldg = num(buildingSf);
  if (bldg != null && bldg > 0) {
    // Typical commercial exterior glazing is roughly 15-35% of floor area
    const glazLow = bldg * 0.15, glazHigh = bldg * 0.35;
    return {
      basis: "building size",
      glazingSf: null,
      filmSfLow: Math.round(glazLow * coverageLow), filmSfHigh: Math.round(glazHigh * coverageHigh),
      valueLow: Math.round(glazLow * coverageLow * pricePerSf),
      valueHigh: Math.round(glazHigh * coverageHigh * pricePerSf),
      label: "ESTIMATED",
      note: `Rough range from a ${bldg.toLocaleString()} SF building using typical glazing ratios. This is a planning-stage figure, not a takeoff.`
    };
  }
  return {
    basis: null, glazingSf: null,
    filmSfLow: null, filmSfHigh: null, valueLow: null, valueHigh: null,
    label: "UNKNOWN",
    note: "No glazing quantity or building size available — the opportunity cannot be sized yet. Upload drawings or add the building size."
  };
}

/** Rank hidden opportunities for the Money Radar. */
export function rankHiddenOpportunities(items = [], limit = 20) {
  return items
    .filter(i => i.hidden)
    .map(i => ({
      ...i,
      rankScore: Math.round((i.confidence || 0) * 0.5 + Math.min(50, (i.potential?.valueHigh || 0) / 4000))
    }))
    .sort((a, b) => b.rankScore - a.rankScore)
    .slice(0, limit);
}
