// Film relevance classifier.
// The old scanner matched any "window" or "glass" and buried real film work under
// blinds, window cleaning, and glass repair. This scores a lead into one of:
//   high      explicit film language — bid this
//   medium    glazing scope where film is plausibly specified or sellable
//   low       weak signal, shown only if the user asks for it
//   excluded  actively not film work (blinds, washing, auto glass, etc.)
// Every result carries `reasons` so the user can see WHY it matched.

/* ---------- Tier 1: explicit film language ---------- */
// Which film type each explicit term implies, so leads can be filtered by the
// scope of work the user actually sells.
export const TERM_TO_TYPE = [
  // Patterns allow an intervening word: real postings say "security WINDOW film".
  { type: "Security",         re: /security\s+(\w+\s+)?film|safety\s+(\w+\s+)?film|anti-?shatter|shatter resistant|fragment retention|glass retention|forced entry|attachment system|protective film/i },
  { type: "Blast Mitigation", re: /blast\s+(\w+\s+)?film|blast mitigation|ballistic|bomb blast|anti-?terrorism|ufc 4-010-01/i },
  { type: "Solar Control",    re: /solar\s+(\w+\s+)?film|solar control|sun control|heat rejection|glare reduction|uv\s+(\w+\s+)?film|spectrally selective|low-?e film|energy\s+(\w+\s+)?film|window tint|tinting/i },
  { type: "Decorative",       re: /decorative\s+(\w+\s+)?film|etched film|frosted|frost film|sandblast|dusted crystal|manifestation|patterned film|translucent film/i },
  { type: "Privacy",          re: /privacy\s+(\w+\s+)?film|one-?way (mirror )?film|opaque film/i },
  { type: "Bird Strike",      re: /bird[ -]?strike|bird[ -]?safe|bird deterrent|bird friendly|fritted/i },
  { type: "Anti-Graffiti",    re: /anti-?graffiti|graffiti\s+(\w+\s+)?film|sacrificial film/i },
  { type: "Switchable",       re: /switchable film|smart film|pdlc|electrochromic film/i },
  { type: "Whiteboard",       re: /whiteboard film|dry ?erase film/i },
  { type: "Projection",       re: /projection film/i },
  { type: "Exterior",         re: /exterior (applied )?film|exterior grade film/i }
];

const FILM_EXPLICIT = [
  "window film", "windowfilm", "window tint", "window tinting", "tinting", "tinted film",
  // service-contract phrasing — how film work is usually titled on public boards
  "tinting services", "tint services", "window tinting service", "film installation",
  "install window film", "apply window film", "furnish and install film", "window filming",
  "film application", "architectural film", "glass film", "window glazing film",
  "solar film", "solar control film", "sun control film", "solar-control film",
  "security film", "safety film", "anti-shatter", "antishatter", "shatter resistant film",
  "fragment retention", "glass retention film", "blast film", "blast mitigation",
  "forced entry film", "ballistic film", "attachment system",
  "decorative film", "privacy film", "frosted film", "frost film", "etched film",
  "sandblast film", "dusted crystal", "manifestation film", "translucent film",
  "bird strike film", "bird safe film", "bird deterrent film", "fritted film",
  "anti-graffiti film", "antigraffiti film", "sacrificial film",
  "whiteboard film", "dry erase film", "projection film",
  "switchable film", "smart film", "pdlc film", "electrochromic film",
  "low-e film", "low e film", "energy film", "spectrally selective film",
  "uv film", "heat rejection film", "glare reduction film",
  "applied film", "surface applied film", "film application",
  "3m fasara", "llumar", "solar gard", "hanita", "madico", "suntek", "huper optik",
  // Terms below do NOT contain the substring "window film", so the generic
  // entry above cannot catch them. Anything that does contain it (e.g.
  // "security window film") is already covered and is not repeated here.
  "glazing film", "reflective film", "insulating film", "insulating window film",
  "low emissivity film", "opaque film", "graphics film", "glass graphics",
  "protective film", "bomb blast film", "blast mitigation film", "forced-entry film",
  "bird-strike film", "safety/security film", "sun control film",
  "08 87 13", "088713", "08 87 00", "088700"     // CSI: window films
];

/* ---------- Tier 2: glazing scope where film is a real opportunity ---------- */
const GLAZING_SCOPE = [
  "storefront", "store front", "curtain wall", "curtainwall",
  "glazing", "glazed", "vision glass", "spandrel",
  "window replacement", "replace windows", "window system", "window systems",
  "fenestration", "aluminum window", "punched window", "exterior window",
  "glass wall", "glass partition", "interior glass", "glass door",
  "skylight", "clerestory", "atrium glass", "window wall",
  "exterior glazing", "interior glazing", "glass storefront", "aluminum storefront",
  "glazing replacement", "glass replacement", "window renovation", "window upgrades",
  "privacy glazing", "decorative glazing",
  // Security glazing scopes. These are prime security-film territory and were
  // missing entirely: a courthouse asking for blast-resistant glazing and
  // forced-entry resistance scored 12 and was hidden as "low".
  "security glazing", "blast resistant glazing", "blast-resistant glazing",
  "forced entry resistance", "forced-entry resistance", "attack resistant glazing",
  "bullet resistant glazing", "ballistic glazing", "impact resistant glazing"
];

// A subset of tier 2 that is strong enough ON ITS OWN to be worth a look — a
// whole-building window replacement is exactly where film gets pitched as a
// value-engineering alternative (this is the Fletcher Daniels case).
const GLAZING_STRONG = [
  "window replacement", "replace windows", "replacement windows",
  "storefront", "store front", "curtain wall", "curtainwall",
  "glazing package", "glazing contractor", "window systems", "window system",
  // A standing glass-and-glazing services contract is the glazier's whole
  // scope, which is the single best place to be sitting when film comes up.
  // "glazing" alone is only tier 2, so Jackson County's "Bid 10015707 Glass
  // and Glazing Services" scored 12 and was hidden as low.
  "glass and glazing", "glazing services", "glass & glazing",
  "glass partition", "glass wall", "window wall",
  "security glazing", "blast resistant glazing", "blast-resistant glazing",
  "forced entry resistance", "forced-entry resistance", "attack resistant glazing",
  "bullet resistant glazing", "ballistic glazing"
];

/* ---------- Tier 3: weak context (only counts alongside tier 2) ---------- */
const SUPPORTING = [
  "energy efficiency", "energy conservation", "solar heat gain", "shgc",
  // "safety glazing" stays weak on purpose: it is code-mandated tempered glass
  // and appears on nearly every job. "security glazing" was promoted to tier 2.
  "safety glazing", "hurricane protection", "impact resistant",
  "solar heat gain coefficient", "glare control", "cooling load",
  "thermal performance", "leed", "bird deterrent",
  "school safety", "hardening", "daylighting", "glare", "uv protection",
  "building envelope", "facade improvement", "tenant improvement"
];

/* ---------- Hard exclusions: not film work, no matter what else matched ---------- */
const EXCLUSIONS = [
  // window coverings — the #1 false positive
  "blind", "blinds", "shade", "shades", "roller shade", "solar shade",
  "drapery", "draperies", "curtain rod", "window covering", "window treatment",
  "venetian", "louver blind", "mini blind", "cellular shade", "roman shade",
  // cleaning / maintenance services
  "window cleaning", "window washing", "glass cleaning", "janitorial", "custodial",
  // unrelated "window"/"glass" senses
  "microsoft windows", "windows server", "windows license", "windows 10", "windows 11",
  "window air conditioner", "window unit", "window well", "windows operating",
  "drive-thru window", "drive through window", "teller window", "service window",
  "auto glass", "automotive glass", "vehicle glass", "windshield",
  "glass block", "glassware", "stained glass restoration", "mirror replacement",
  "shower door", "shower enclosure", "glass railing repair",
  // trades that aren't ours
  "mowing", "landscap", "snow removal", "paving", "asphalt", "roof replacement",
  "elevator", "plumbing repair", "sewer", "hvac replacement", "boiler",
  "uniform", "food service", "armed security guard", "security guard services",
  "security camera", "alarm monitoring", "fire alarm", "sprinkler system"
];

const has = (hay, term) => hay.includes(term);

/**
 * Classify a lead's text for window-film relevance.
 * @returns {{relevance:'high'|'medium'|'low'|'excluded', score:number, reasons:string[], matched:{film:string[],glazing:string[]}}}
 */
/* ---------- caller-supplied vocabulary ---------- */

/** The built-in lists, exposed so a settings screen can show what it is editing. */
export const DEFAULT_TERMS = Object.freeze({
  film: FILM_EXPLICIT, glazing: GLAZING_SCOPE, glazingStrong: GLAZING_STRONG,
  supporting: SUPPORTING, exclusions: EXCLUSIONS
});

const clean = list => (Array.isArray(list) ? list : [])
  .map(t => String(t || "").toLowerCase().trim()).filter(Boolean);

/**
 * Fold user vocabulary into the built-in lists. Additive per category, plus a
 * `disabled` list that switches individual terms off wherever they appear.
 * Pure and total: bad input is ignored rather than throwing, because this runs
 * inside the scan and a malformed setting must never take discovery down.
 */
export function mergeTerms(custom = {}) {
  const c = custom && typeof custom === "object" ? custom : {};
  const off = new Set(clean(c.disabled));
  const merge = (base, extra) =>
    [...new Set([...base, ...clean(extra)])].filter(t => !off.has(t));
  return {
    film: merge(FILM_EXPLICIT, c.film),
    glazing: merge(GLAZING_SCOPE, c.glazing),
    glazingStrong: merge(GLAZING_STRONG, c.glazingStrong),
    supporting: merge(SUPPORTING, c.supporting),
    exclusions: merge(EXCLUSIONS, c.exclusions)
  };
}

export function classifyFilmRelevance(text, custom) {
  const hay = " " + String(text || "").toLowerCase().replace(/\s+/g, " ") + " ";
  if (!hay.trim()) return { relevance: "excluded", score: 0, reasons: ["No text to classify"], filmTypes: [], matched: { film: [], glazing: [] } };

  const terms = custom ? mergeTerms(custom) : DEFAULT_TERMS;
  const filmHits = terms.film.filter(t => has(hay, t));
  const glazHits = terms.glazing.filter(t => has(hay, t));
  const strongGlaz = terms.glazingStrong.filter(t => has(hay, t));
  const supportHits = terms.supporting.filter(t => has(hay, t));
  const exclusionHits = terms.exclusions.filter(t => has(hay, t));

  // Explicit film language beats exclusions: "blinds and window film" is still
  // a film job. Exclusions only veto leads with no film language of their own.
  if (exclusionHits.length && !filmHits.length) {
    return {
      relevance: "excluded",
      score: 0,
      reasons: [`Not film work — matched "${exclusionHits[0]}"`],
      filmTypes: [],
      // Which term vetoed it, so a caller can tell a veto apart from a plain
      // no-match. parseGenericHtml needs that distinction: a veto found only
      // in borrowed page context must not bury a title that stands on its own.
      excludedBy: exclusionHits[0],
      matched: { film: [], glazing: glazHits }
    };
  }

  const filmTypes = TERM_TO_TYPE.filter(t => t.re.test(hay)).map(t => t.type);
  const reasons = [];
  let score = 0;

  if (filmHits.length) {
    score += 60 + Math.min(20, filmHits.length * 8);
    reasons.push(`Film specified: "${filmHits.slice(0, 3).join('", "')}"`);
  }
  if (glazHits.length) {
    score += Math.min(35, glazHits.length * 12) + (strongGlaz.length ? 8 : 0);
    reasons.push(`Glazing scope: "${glazHits.slice(0, 3).join('", "')}"`);
  }
  if (supportHits.length && glazHits.length) {
    score += Math.min(10, supportHits.length * 5);
    reasons.push(`Supporting signal: "${supportHits.slice(0, 2).join('", "')}"`);
  }
  if (exclusionHits.length && filmHits.length) {
    reasons.push(`Note: also mentions "${exclusionHits[0]}" — verify film is in the scope`);
  }

  score = Math.min(100, score);

  let relevance;
  if (filmHits.length) relevance = "high";
  else if (strongGlaz.length || glazHits.length >= 2 || (glazHits.length === 1 && supportHits.length)) relevance = "medium";
  else if (glazHits.length === 1) relevance = "low";
  else relevance = "excluded";

  if (relevance === "excluded" && !reasons.length) reasons.push("No film or glazing language found");

  return { relevance, score, reasons, filmTypes, matched: { film: filmHits, glazing: glazHits } };
}

/** Filter a batch of leads, keeping only what's worth an estimator's attention. */
export function filterRelevant(leads = [], { minRelevance = "medium", terms = null } = {}) {
  const rank = { high: 3, medium: 2, low: 1, excluded: 0 };
  const floor = rank[minRelevance] ?? 2;
  const kept = [], dropped = [];
  for (const lead of leads) {
    const text = [lead.title, lead.projectNo, lead.description, lead.context].filter(Boolean).join(" ");
    const c = classifyFilmRelevance(text, terms);
    const enriched = { ...lead, relevance: c.relevance, relevanceScore: c.score, matchReasons: c.reasons, filmTypes: c.filmTypes };
    (rank[c.relevance] >= floor ? kept : dropped).push(enriched);
  }
  return { kept, dropped, droppedCount: dropped.length };
}
