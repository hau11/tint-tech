// Document intelligence pipeline (deterministic parts).
// Pages arrive already text-extracted by the browser (Workers CPU limits make
// server-side PDF parsing impractical on the free tier). Everything here is
// pure logic so it is unit-testable and cheap.
import { detectFilmTerms, classifySheetText, FILM_TYPES, num } from "./engines.js";

/* ---------- sheet numbers ---------- */
const SHEET_PATTERNS = [
  /\bSHEET\s*(?:NO\.?|NUMBER)?\s*[:#]?\s*([A-Z]{1,3}-?\d{1,3}(?:\.\d+)?)\b/i,
  /\b([AGSMEPCLTFID]{1,2}-\d{1,3}(?:\.\d+)?)\b/,        // A-201, AD-101, S-100.1
  /\b([AGSMEPCLTFID]{1,2}\d{3}(?:\.\d+)?)\b/            // A201
];

/** Pull the drawing sheet number out of page text. Returns null if absent —
 *  never a guess, because a wrong citation is worse than no citation. */
export function extractSheetNumber(text) {
  const s = String(text || "");
  if (!s.trim()) return null;
  // Sheet numbers usually live in the title block: check the tail first, then head.
  const zones = [s.slice(-600), s.slice(0, 600), s];
  for (const zone of zones) {
    for (const re of SHEET_PATTERNS) {
      const m = zone.match(re);
      if (m && m[1]) return m[1].toUpperCase().replace(/^([A-Z]{1,3})(\d)/, "$1-$2");
    }
  }
  return null;
}

/** Spec section numbers, e.g. 08 87 13 */
export function extractSpecSections(text) {
  const s = String(text || "");
  const out = new Set();
  const re = /\b(0[0-9]|1[0-4])\s?(\d{2})\s?(\d{2})(?:\.\d+)?\b/g;
  let m;
  while ((m = re.exec(s))) out.add(`${m[1]} ${m[2]} ${m[3]}`);
  return [...out];
}

/* ---------- page ranking (AI cost control, spec §46) ---------- */
export function rankPages(pages = []) {
  return pages.map((p, i) => {
    const text = p.text || p.text_content || "";
    const det = detectFilmTerms(text);
    return {
      ...p,
      page_number: p.page_number ?? p.page ?? i + 1,
      sheet_number: p.sheet_number || extractSheetNumber(text),
      classification: p.classification || classifySheetText(text),
      spec_sections: extractSpecSections(text),
      film_matches: det.filmMatches,
      glazing_matches: det.glazingMatches,
      relevance_score: det.relevance,
      empty: text.trim().length < 30    // likely a scanned image page -> needs OCR
    };
  });
}

/** Choose which pages are worth spending AI tokens on. */
export function selectPagesForAI(ranked = [], { maxPages = 24, minRelevance = 1 } = {}) {
  const scored = ranked.filter(p => p.relevance_score >= minRelevance && !p.empty);
  // Schedules and specs are disproportionately valuable — boost them
  const boost = p => p.relevance_score +
    (/Window Schedule|Glazing Schedule/.test(p.classification) ? 40 : 0) +
    (/Specification/.test(p.classification) ? 25 : 0) +
    (p.spec_sections.some(s => s.startsWith("08 8")) ? 30 : 0);
  return [...scored].sort((a, b) => boost(b) - boost(a)).slice(0, maxPages);
}

export function analysisSummary(ranked = [], selected = []) {
  return {
    pagesAnalyzed: ranked.length,
    pagesSentToAI: selected.length,
    filmReferences: ranked.reduce((s, p) => s + p.film_matches.length, 0),
    glazingReferences: ranked.reduce((s, p) => s + p.glazing_matches.length, 0),
    scheduleReferences: ranked.filter(p => /Schedule/.test(p.classification)).length,
    scannedPagesNeedingOcr: ranked.filter(p => p.empty).length
  };
}

/** Trimmed evidence pack — only what the AI needs, with page anchors. */
export function buildEvidencePack(selected = [], charsPerPage = 2600) {
  return selected.map(p => ({
    page: p.page_number,
    sheet: p.sheet_number || "unknown",
    classification: p.classification,
    documentId: p.document_id || p.documentId || null,
    excerpt: String(p.text || p.text_content || "").replace(/\s+/g, " ").slice(0, charsPerPage)
  }));
}

/* ============================================================
   VALIDATION — the enforcement layer for "never invent data".
   AI output is not trusted; findings without a real citation that
   maps to a page we actually sent are dropped, not displayed.
   ============================================================ */
export function validateFilmFindings(findings, evidence = []) {
  const validPages = new Set(evidence.map(e => e.page));
  const validSheets = new Set(evidence.map(e => String(e.sheet).toUpperCase()).filter(s => s !== "UNKNOWN"));
  const accepted = [], rejected = [];

  for (const f of Array.isArray(findings) ? findings : []) {
    const reasons = [];
    if (!f || typeof f !== "object") { rejected.push({ finding: f, reasons: ["not an object"] }); continue; }
    if (!FILM_TYPES.includes(f.type)) reasons.push(`unknown film type "${f.type}"`);

    const page = num(f.page);
    const sheet = f.sheet ? String(f.sheet).toUpperCase() : null;
    const citesPage = page != null && validPages.has(page);
    const citesSheet = sheet && validSheets.has(sheet);
    if (!citesPage && !citesSheet) reasons.push("no citation matching a supplied page or sheet");

    const qty = num(f.quantitySF);
    if (qty != null && qty <= 0) reasons.push("non-positive quantity");
    if (qty != null && !f.calculation) reasons.push("quantity without a shown calculation");

    if (reasons.length) { rejected.push({ finding: f, reasons }); continue; }

    accepted.push({
      type: f.type,
      manufacturer: blankToNotSpecified(f.manufacturer),
      product: blankToNotSpecified(f.product),
      quantitySF: qty,
      calculation: f.calculation || null,
      location: f.location || null,
      floor: f.floor || null,
      sheet: sheet || null,
      specSection: f.specSection || null,
      vlt: blankToNotSpecified(f.vlt),
      interiorExterior: f.interiorExterior || null,
      attachmentRequired: f.attachmentRequired ?? null,
      confidence: clamp01(f.confidence),
      page: citesPage ? page : null,
      documentId: f.documentId || (evidence.find(e => e.page === page)?.documentId ?? null),
      excerpt: (f.excerpt || "").slice(0, 400) || null,
      isSpecified: Boolean(f.specSection || f.isSpecified),
      isRecommendation: Boolean(f.isRecommendation)
    });
  }
  return { accepted, rejected };
}

export function validateGlazingFindings(findings, evidence = []) {
  const validPages = new Set(evidence.map(e => e.page));
  const validSheets = new Set(evidence.map(e => String(e.sheet).toUpperCase()).filter(s => s !== "UNKNOWN"));
  const accepted = [], rejected = [];
  for (const g of Array.isArray(findings) ? findings : []) {
    const reasons = [];
    if (!g || typeof g !== "object") { rejected.push({ finding: g, reasons: ["not an object"] }); continue; }
    const page = num(g.page);
    const sheet = g.sheet ? String(g.sheet).toUpperCase() : null;
    if (!(page != null && validPages.has(page)) && !(sheet && validSheets.has(sheet)))
      reasons.push("no citation matching a supplied page or sheet");
    const qty = num(g.quantity), w = num(g.widthFt), h = num(g.heightFt);
    if (qty != null && qty <= 0) reasons.push("non-positive quantity");
    if (w != null && (w <= 0 || w > 60)) reasons.push("implausible width");
    if (h != null && (h <= 0 || h > 60)) reasons.push("implausible height");
    if (reasons.length) { rejected.push({ finding: g, reasons }); continue; }
    accepted.push({
      windowMark: g.windowMark || null, windowType: g.windowType || null,
      floor: g.floor || null, elevation: g.elevation || null,
      quantity: qty, widthFt: w, heightFt: h,
      glassType: g.glassType || null, frameType: g.frameType || null,
      sheet: sheet || null, page: page ?? null,
      confidence: clamp01(g.confidence)
    });
  }
  return { accepted, rejected };
}

function blankToNotSpecified(v) {
  const s = String(v ?? "").trim();
  if (!s || /^(unknown|n\/?a|none|null|tbd)$/i.test(s)) return "Not specified";
  return s;
}
function clamp01(v) {
  const n = num(v);
  if (n == null) return null;
  const pct = n <= 1 ? n * 100 : n;
  return Math.max(0, Math.min(100, Math.round(pct)));
}
