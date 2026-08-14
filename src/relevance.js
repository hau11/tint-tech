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
  { type: "Bird Strike",      re: /bird ?strike|bird ?safe|bird deterrent|bird friendly|fritted/i },
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
  "08 87 13", "088713", "08 87 00", "088700"     // CSI: window films
];

/* ---------- Tier 2: glazing scope where film is a real opportunity ---------- */
const GLAZING_SCOPE = [
  "storefront", "store front", "curtain wall", "curtainwall",
  "glazing", "glazed", "vision glass", "spandrel",
  "window replacement", "replace windows", "window system", "window systems",
  "fenestration", "aluminum window", "punched window", "exterior window",
  "glass wall", "glass partition", "interior glass", "glass door",
  "skylight", "clerestory", "atrium glass", "window wall"
];

// A subset of tier 2 that is strong enough ON ITS OWN to be worth a look — a
// whole-building window replacement is exactly where film gets pitched as a
// value-engineering alternative (this is the Fletcher Daniels case).
const GLAZING_STRONG = [
  "window replacement", "replace windows", "replacement windows",
  "storefront", "store front", "curtain wall", "curtainwall",
  "glazing package", "glazing contractor", "window systems", "window system",
  "glass partition", "glass wall", "window wall"
];

/* ---------- Tier 3: weak context (only counts alongside tier 2) ---------- */
const SUPPORTING = [
  "energy efficiency", "energy conservation", "solar heat gain", "shgc",
  "safety glazing", "security glazing", "hurricane protection", "impact resistant",
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
export function classifyFilmRelevance(text) {
  const hay = " " + String(text || "").toLowerCase().replace(/\s+/g, " ") + " ";
  if (!hay.trim()) return { relevance: "excluded", score: 0, reasons: ["No text to classify"], filmTypes: [], matched: { film: [], glazing: [] } };

  const filmHits = FILM_EXPLICIT.filter(t => has(hay, t));
  const glazHits = GLAZING_SCOPE.filter(t => has(hay, t));
  const strongGlaz = GLAZING_STRONG.filter(t => has(hay, t));
  const supportHits = SUPPORTING.filter(t => has(hay, t));
  const exclusionHits = EXCLUSIONS.filter(t => has(hay, t));

  // Explicit film language beats exclusions: "blinds and window film" is still
  // a film job. Exclusions only veto leads with no film language of their own.
  if (exclusionHits.length && !filmHits.length) {
    return {
      relevance: "excluded",
      score: 0,
      reasons: [`Not film work — matched "${exclusionHits[0]}"`],
      filmTypes: [],
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
export function filterRelevant(leads = [], { minRelevance = "medium" } = {}) {
  const rank = { high: 3, medium: 2, low: 1, excluded: 0 };
  const floor = rank[minRelevance] ?? 2;
  const kept = [], dropped = [];
  for (const lead of leads) {
    const text = [lead.title, lead.projectNo, lead.description, lead.context].filter(Boolean).join(" ");
    const c = classifyFilmRelevance(text);
    const enriched = { ...lead, relevance: c.relevance, relevanceScore: c.score, matchReasons: c.reasons, filmTypes: c.filmTypes };
    (rank[c.relevance] >= floor ? kept : dropped).push(enriched);
  }
  return { kept, dropped, droppedCount: dropped.length };
}
