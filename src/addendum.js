// Addendum intelligence + scope conflict detection.
// The diffs here are DETERMINISTIC — comparing structured records we already
// extracted. AI is used only to describe impact in words, never to decide what
// changed. That keeps "Addendum 2 added 840 SF" a fact, not an opinion.
import { num, FILM_TYPES } from "./engines.js";

const round2 = n => Math.round(n * 100) / 100;
const keyOf = g => [
  (g.window_mark || g.windowMark || "").toString().trim().toUpperCase(),
  (g.floor || "").toString().trim().toUpperCase()
].filter(Boolean).join("|") || null;

function areaOf(g) {
  const q = num(g.quantity), w = num(g.width_ft ?? g.widthFt), h = num(g.height_ft ?? g.heightFt);
  if (q == null || w == null || h == null) return null;
  return round2(q * w * h);
}

/**
 * Compare glazing between the current record (before) and what a new document
 * revision reports (after). Items without a window mark can't be matched, so
 * they are reported as unmatched rather than guessed at.
 */
export function diffGlazing(before = [], after = []) {
  const beforeMap = new Map(), unmatchedBefore = [], unmatchedAfter = [];
  for (const g of before) {
    const k = keyOf(g);
    k ? beforeMap.set(k, g) : unmatchedBefore.push(g);
  }
  const added = [], removed = [], changed = [], unchanged = [];
  const seen = new Set();

  for (const g of after) {
    const k = keyOf(g);
    if (!k) { unmatchedAfter.push(g); continue; }
    seen.add(k);
    const prev = beforeMap.get(k);
    if (!prev) {
      added.push({ key: k, mark: g.window_mark || g.windowMark, item: g, areaSf: areaOf(g) });
      continue;
    }
    const prevArea = areaOf(prev), nextArea = areaOf(g);
    const fields = [];
    for (const [label, a, b] of [
      ["quantity", num(prev.quantity), num(g.quantity)],
      ["width_ft", num(prev.width_ft ?? prev.widthFt), num(g.width_ft ?? g.widthFt)],
      ["height_ft", num(prev.height_ft ?? prev.heightFt), num(g.height_ft ?? g.heightFt)]
    ]) {
      if (a !== b) fields.push({ field: label, from: a, to: b });
    }
    if (fields.length) {
      changed.push({
        key: k, mark: g.window_mark || g.windowMark, fields,
        areaBefore: prevArea, areaAfter: nextArea,
        areaDeltaSf: (prevArea != null && nextArea != null) ? round2(nextArea - prevArea) : null
      });
    } else unchanged.push(k);
  }
  for (const [k, g] of beforeMap) {
    if (!seen.has(k)) removed.push({ key: k, mark: g.window_mark || g.windowMark, item: g, areaSf: areaOf(g) });
  }

  const addedSf = added.reduce((s, a) => s + (a.areaSf || 0), 0);
  const removedSf = removed.reduce((s, r) => s + (r.areaSf || 0), 0);
  const changedSf = changed.reduce((s, c) => s + (c.areaDeltaSf || 0), 0);

  return {
    added, removed, changed, unchangedCount: unchanged.length,
    unmatchedBefore, unmatchedAfter,
    netSfDelta: round2(addedSf - removedSf + changedSf),
    addedSf: round2(addedSf), removedSf: round2(removedSf), changedSf: round2(changedSf),
    hasChanges: Boolean(added.length || removed.length || changed.length)
  };
}

/** Compare film scope between revisions. */
export function diffFilmScope(before = [], after = []) {
  const norm = f => ({
    type: f.film_type || f.type,
    spec: (f.spec_section || f.specSection || "").trim(),
    manufacturer: (f.manufacturer || "").trim(),
    product: (f.product || "").trim(),
    sheet: (f.sheet || "").trim().toUpperCase(),
    qty: num(f.quantity_sf ?? f.quantitySF)
  });
  const b = before.map(norm), a = after.map(norm);
  const idOf = f => `${f.type}|${f.sheet}`;
  const bMap = new Map(b.map(f => [idOf(f), f]));
  const added = [], removed = [], changed = [];
  const seen = new Set();

  for (const f of a) {
    const id = idOf(f);
    seen.add(id);
    const prev = bMap.get(id);
    if (!prev) { added.push(f); continue; }
    const fields = [];
    for (const k of ["spec", "manufacturer", "product", "qty"]) {
      if (String(prev[k] ?? "") !== String(f[k] ?? "")) fields.push({ field: k, from: prev[k], to: f[k] });
    }
    if (fields.length) changed.push({ type: f.type, sheet: f.sheet, fields });
  }
  for (const [id, f] of bMap) if (!seen.has(id)) removed.push(f);
  return { added, removed, changed, hasChanges: Boolean(added.length || removed.length || changed.length) };
}

/**
 * Scope conflicts — deterministic. The classic one: the drawing says solar
 * control at a location while the specification says security film for the
 * same glazing. Missing that costs real money at bid time.
 */
export function detectScopeConflicts(filmScope = []) {
  const conflicts = [];

  // 1. Same sheet, different film types claimed at the same location
  const byLocation = new Map();
  for (const f of filmScope) {
    const loc = (f.location || f.floor || "").toString().trim().toUpperCase();
    if (!loc) continue;
    if (!byLocation.has(loc)) byLocation.set(loc, []);
    byLocation.get(loc).push(f);
  }
  for (const [loc, items] of byLocation) {
    const types = [...new Set(items.map(i => i.film_type || i.type).filter(Boolean))];
    if (types.length > 1) {
      conflicts.push({
        kind: "film-type-mismatch",
        description: `Two different film types are indicated at the same location (${loc}): ${types.join(" and ")}.`,
        sourceA: describe(items.find(i => (i.film_type || i.type) === types[0])),
        sourceB: describe(items.find(i => (i.film_type || i.type) === types[1])),
        severity: "HIGH",
        suggestedRFI: `Drawings and specifications indicate different window film types at ${loc} (${types.join(" vs ")}). Please confirm the required film type at this location.`
      });
    }
  }

  // 2. A spec section is cited but the manufacturer/product is never named
  for (const f of filmScope) {
    const mfr = (f.manufacturer || "").trim();
    if ((f.spec_section || f.specSection) && (!mfr || /^not specified$/i.test(mfr))) {
      conflicts.push({
        kind: "product-not-named",
        description: `${f.film_type || f.type} film is specified under ${f.spec_section || f.specSection} but no manufacturer or product is named.`,
        sourceA: describe(f), sourceB: null,
        severity: "MEDIUM",
        suggestedRFI: `Specification ${f.spec_section || f.specSection} requires window film but does not name an approved manufacturer or product. Please identify the basis-of-design product or confirm that an equivalent may be proposed.`
      });
    }
  }

  // 3. Security/blast film without a stated attachment requirement
  for (const f of filmScope) {
    const type = f.film_type || f.type;
    const attach = f.attachment_required ?? f.attachmentRequired;
    if (["Security", "Blast Mitigation"].includes(type) && (attach === null || attach === undefined || attach === "")) {
      conflicts.push({
        kind: "attachment-undefined",
        description: `${type} film is indicated but the documents do not state whether an attachment system is required.`,
        sourceA: describe(f), sourceB: null,
        severity: "HIGH",
        suggestedRFI: `${type} film is indicated at ${f.location || f.sheet || "the referenced glazing"}. Please confirm whether a wet-glaze or mechanical attachment system is required, as this materially affects cost and installation.`
      });
    }
  }

  // 4. A quantity that arrived with no calculation behind it
  for (const f of filmScope) {
    const qty = num(f.quantity_sf ?? f.quantitySF);
    if (qty != null && !(f.calculation || f.source_excerpt)) {
      conflicts.push({
        kind: "unsupported-quantity",
        description: `A quantity of ${qty} SF is recorded for ${f.film_type || f.type} with no supporting calculation or source excerpt.`,
        sourceA: describe(f), sourceB: null,
        severity: "MEDIUM",
        suggestedRFI: null
      });
    }
  }

  return dedupeConflicts(conflicts);
}

function describe(f) {
  if (!f) return null;
  return [f.sheet && `Sheet ${f.sheet}`, (f.spec_section || f.specSection) && `Spec ${f.spec_section || f.specSection}`,
    f.source_page != null && `p.${f.source_page}`].filter(Boolean).join(" · ") || "no citation";
}

function dedupeConflicts(list) {
  const seen = new Set(), out = [];
  for (const c of list) {
    const k = c.kind + "|" + c.description;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(c);
  }
  return out;
}

/** Money impact of a scope change. Returns null when we can't know. */
export function estimateCostImpact(netSfDelta, { installedPricePerSf } = {}) {
  const sf = num(netSfDelta), rate = num(installedPricePerSf);
  if (sf == null || rate == null) return { amount: null, note: "Cost impact unknown — price this scope first." };
  const amount = round2(sf * rate);
  return {
    amount,
    direction: amount > 0 ? "increase" : amount < 0 ? "decrease" : "none",
    note: `${Math.abs(sf).toLocaleString()} SF × $${rate}/SF installed`
  };
}

/** Parse an addendum number out of a filename or page text. Null if absent. */
export function parseAddendumNumber(text) {
  const m = String(text || "").match(/addend(?:um|a)\s*(?:no\.?|#|number)?\s*(\d+)/i);
  return m ? m[1] : null;
}

export function summarizeAddendumImpact(glazingDiff, filmDiff, costImpact) {
  const changes = [];
  if (glazingDiff.added.length) changes.push(`${glazingDiff.added.length} glazing item(s) added (+${glazingDiff.addedSf.toLocaleString()} SF)`);
  if (glazingDiff.removed.length) changes.push(`${glazingDiff.removed.length} removed (-${glazingDiff.removedSf.toLocaleString()} SF)`);
  if (glazingDiff.changed.length) changes.push(`${glazingDiff.changed.length} quantity/dimension change(s)`);
  if (filmDiff.added.length) changes.push(`${filmDiff.added.length} new film reference(s)`);
  if (filmDiff.changed.length) changes.push(`${filmDiff.changed.length} film specification change(s)`);
  if (filmDiff.removed.length) changes.push(`${filmDiff.removed.length} film reference(s) removed`);

  // 0-100: how much an estimator needs to care.
  // Calibration: ~1,000 SF of net change alone reaches the top of the quantity
  // band (40). A film SPEC change outweighs quantity — swapping the required
  // film re-prices the whole job, so it carries more weight than SF drift.
  let impact = 0;
  impact += Math.min(40, Math.abs(glazingDiff.netSfDelta) / 25);
  impact += filmDiff.changed.length * 20 + filmDiff.added.length * 15 + filmDiff.removed.length * 20;
  impact += glazingDiff.changed.length * 6;
  impact = Math.min(100, Math.round(impact));

  return {
    tintRelevantChanges: changes.length,
    changes,
    netSfDelta: glazingDiff.netSfDelta,
    costImpact,
    impactScore: impact,
    severity: impact >= 60 ? "HIGH" : impact >= 25 ? "MEDIUM" : "LOW",
    noChanges: !glazingDiff.hasChanges && !filmDiff.hasChanges
  };
}
