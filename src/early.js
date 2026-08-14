// Early opportunity intelligence (spec §30, §82).
// A bid posting means you're already competing on price. A project still in
// planning or design means you can get film written into the specification —
// which is worth far more. This detects how early a project is and what to do
// about it. Deterministic and testable.
import { num } from "./engines.js";

/* ---------- project stage, earliest to latest ---------- */
export const STAGES = ["Planning", "Design", "Permitting", "Pre-Bid", "Bidding", "Construction", "Unknown"];

const STAGE_RULES = [
  { stage: "Bidding",     re: /\b(invitation to bid|bids? due|bid opening|sealed bids?|ifb|rfp|rfq|solicitation|addendum)\b/i },
  { stage: "Pre-Bid",     re: /\b(pre-?bid|pre-?qualification|prequalif|bidders? list|invitation to qualify|out to bid soon)\b/i },
  { stage: "Permitting",  re: /\b(building permit|permit (issued|application|approved)|plan review|code review)\b/i },
  { stage: "Design",      re: /\b(design development|schematic design|construction documents|dd set|cd set|design phase|architect selected|design contract awarded|100% cd)\b/i },
  { stage: "Planning",    re: /\b(planning commission|zoning|rezoning|site plan|feasibility|capital improvement|bond (program|issue|referendum)|master plan|proposed (development|project|building)|conceptual)\b/i }
];

/** Detect how far along a project is. Returns Unknown rather than guessing. */
export function detectStage(text) {
  const hay = String(text || "");
  if (!hay.trim()) return { stage: "Unknown", matched: null };
  for (const rule of STAGE_RULES) {
    const m = hay.match(rule.re);
    if (m) return { stage: rule.stage, matched: m[0] };
  }
  return { stage: "Unknown", matched: null };
}

export function isEarly(stage) {
  return ["Planning", "Design", "Permitting"].includes(stage);
}

/* ---------- building types worth chasing early ---------- */
const HIGH_GLAZING_TYPES = [
  { type: "Office / commercial", re: /\b(office (building|tower|park)|corporate (campus|headquarters)|mixed[- ]use|class a office)\b/i, factor: 1.0 },
  { type: "Healthcare",          re: /\b(hospital|medical (center|office building|campus)|clinic|surgery center|mob)\b/i, factor: 1.0 },
  { type: "Higher education",    re: /\b(university|college|campus|academic building|student (center|union)|residence hall)\b/i, factor: 0.9 },
  { type: "K-12 school",         re: /\b(elementary|middle school|high school|school district|k-?12)\b/i, factor: 0.85 },
  { type: "Government / civic",  re: /\b(courthouse|city hall|municipal|county (building|annex)|federal building|library|justice center)\b/i, factor: 1.0 },
  { type: "Airport",             re: /\b(airport|terminal|concourse|aviation)\b/i, factor: 1.0 },
  { type: "Data center",         re: /\b(data center|mission critical|colocation)\b/i, factor: 0.7 },
  { type: "Hospitality",         re: /\b(hotel|hospitality|resort|conference center)\b/i, factor: 0.9 },
  { type: "Multifamily",         re: /\b(apartment|multifamily|multi-family|residences|senior living)\b/i, factor: 0.8 },
  { type: "Retail",              re: /\b(retail|shopping center|storefront retail|grocery)\b/i, factor: 0.75 },
  { type: "Industrial",          re: /\b(warehouse|distribution center|manufacturing|industrial)\b/i, factor: 0.3 }
];

export function detectBuildingType(text) {
  const hay = String(text || "");
  for (const t of HIGH_GLAZING_TYPES) {
    if (t.re.test(hay)) return { type: t.type, glazingFactor: t.factor };
  }
  return { type: "Unknown", glazingFactor: null };
}

/** Pull a building size in square feet if one is stated. Never estimated. */
export function extractBuildingSf(text) {
  const hay = String(text || "").replace(/,/g, "");
  // "250,000 square foot", "250000 sf", "1.2 million square feet"
  const million = hay.match(/(\d+(?:\.\d+)?)\s*million\s*(?:square\s*(?:feet|foot)|sq\.?\s*ft|sf)\b/i);
  if (million) return Math.round(parseFloat(million[1]) * 1e6);
  const plain = hay.match(/(\d{4,9})\s*(?:square\s*(?:feet|foot)|sq\.?\s*ft\.?|sf)\b/i);
  if (plain) return parseInt(plain[1], 10);
  return null;
}

/**
 * Estimate the film opportunity for an early-stage project.
 * Returns nulls when the inputs aren't known — no invented dollar figures.
 */
export function estimateFilmPotential({ buildingSf, buildingType, glazingRatio = null, pricePerSf = 9 } = {}) {
  const sf = num(buildingSf);
  const t = HIGH_GLAZING_TYPES.find(x => x.type === buildingType);
  const factor = t?.factor ?? null;
  if (sf == null || factor == null) {
    return {
      glazingSfLow: null, glazingSfHigh: null, valueLow: null, valueHigh: null,
      note: sf == null
        ? "No building size stated — film potential cannot be estimated from this source."
        : "Building type unknown — film potential cannot be estimated."
    };
  }
  // Typical exterior glazing runs roughly 15-35% of floor area on commercial
  // buildings; the type factor scales that. These are planning-stage ranges,
  // not takeoffs, and the UI must say so.
  const lowRatio = (glazingRatio ?? 0.15) * factor;
  const highRatio = (glazingRatio ?? 0.35) * factor;
  const glazingSfLow = Math.round(sf * lowRatio);
  const glazingSfHigh = Math.round(sf * highRatio);
  return {
    glazingSfLow, glazingSfHigh,
    valueLow: Math.round(glazingSfLow * pricePerSf),
    valueHigh: Math.round(glazingSfHigh * pricePerSf),
    note: "Planning-stage range only — based on typical glazing ratios, not a takeoff. Verify against drawings when they are issued."
  };
}

/* ---------- early opportunity score (0-100) ---------- */
export function computeEarlyScore({ stage, buildingType, buildingSf, distanceMiles, hasArchitect, hasOwner, glazingFactor } = {}) {
  const parts = {};
  const unknowns = [];

  // Earlier is better — you can still influence the specification
  parts.stage = stage === "Design" ? 30 : stage === "Planning" ? 25 : stage === "Permitting" ? 22
    : stage === "Pre-Bid" ? 12 : stage === "Bidding" ? 5 : 0;
  if (!stage || stage === "Unknown") unknowns.push("Project stage unknown.");

  const factor = num(glazingFactor);
  parts.glazingPotential = factor == null ? 0 : Math.round(factor * 25);
  if (factor == null) unknowns.push("Building type unknown — glazing potential not assessed.");

  const sf = num(buildingSf);
  if (sf == null) { parts.size = 0; unknowns.push("Building size not stated."); }
  else if (sf >= 250000) parts.size = 20;
  else if (sf >= 100000) parts.size = 16;
  else if (sf >= 50000) parts.size = 12;
  else if (sf >= 20000) parts.size = 8;
  else parts.size = 4;

  const miles = num(distanceMiles);
  if (miles == null) { parts.distance = 0; unknowns.push("Distance unknown."); }
  else if (miles <= 40) parts.distance = 15;
  else if (miles <= 100) parts.distance = 10;
  else if (miles <= 250) parts.distance = 5;
  else parts.distance = 2;

  // Knowing who to call is most of the value of an early lead
  parts.contactability = (hasArchitect ? 6 : 0) + (hasOwner ? 4 : 0);
  if (!hasArchitect) unknowns.push("Architect not identified — that's who specifies film.");

  const total = Math.min(100, Object.values(parts).reduce((a, b) => a + b, 0));
  return { total, breakdown: parts, unknowns };
}

/** What to actually do about an early lead. */
export function earlyNextAction({ stage, hasArchitect, hasOwner }) {
  if (stage === "Planning") {
    return hasOwner
      ? "Contact the owner or developer now — introduce film before an architect is even selected."
      : "Find the owner or developer from the planning agenda, then introduce film early.";
  }
  if (stage === "Design") {
    return hasArchitect
      ? "Contact the architect's specification writer — this is the window to get film into Division 08."
      : "Identify the architect. Design phase is your best chance to get film specified.";
  }
  if (stage === "Permitting") {
    return "Drawings exist. Ask the architect or owner for the glazing package and offer a budget number.";
  }
  if (stage === "Pre-Bid") {
    return "Get on the bidders list now and ask GCs whether film is in the scope.";
  }
  if (stage === "Bidding") {
    return "Already bidding — treat as a normal opportunity and price it.";
  }
  return "Confirm the project stage before deciding how to approach it.";
}

/** Full assessment from a block of text (news item, agenda, permit record). */
export function assessEarlyOpportunity(text, { distanceMiles = null, hasArchitect = false, hasOwner = false } = {}) {
  const { stage, matched } = detectStage(text);
  const { type, glazingFactor } = detectBuildingType(text);
  const buildingSf = extractBuildingSf(text);
  const score = computeEarlyScore({ stage, buildingType: type, buildingSf, distanceMiles, hasArchitect, hasOwner, glazingFactor });
  const potential = estimateFilmPotential({ buildingSf, buildingType: type });
  return {
    stage, stageEvidence: matched,
    buildingType: type, buildingSf,
    early: isEarly(stage),
    score: score.total, breakdown: score.breakdown, unknowns: score.unknowns,
    potential,
    nextAction: earlyNextAction({ stage, hasArchitect, hasOwner })
  };
}
