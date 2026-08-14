// Automatic document discovery.
// Given a bid posting URL, find the plans / specs / IFB / addenda PDFs so the
// estimator never has to hunt for files on a phone. Deterministic and testable:
// no AI decides what a document is, the link text and filename do.
import * as cheerio from "cheerio";

export const DOC_TYPES = ["plans", "specifications", "addendum", "bid_form", "solicitation", "other"];

const RULES = [
  // order matters — first match wins
  { type: "addendum",       re: /addend(um|a)|revision\s*no|rev\s*\d/i,                     label: "Addendum" },
  { type: "plans",          re: /\b(plans?|drawings?|sheet\s*set|plan\s*set|blueprint)\b/i, label: "Plans / drawings" },
  { type: "specifications", re: /\b(spec(s|ification)?s?|project\s*manual|manual|division\s*08)\b/i, label: "Specifications" },
  { type: "bid_form",       re: /\b(bid\s*(form|sheet|proposal)|pricing\s*form|schedule\s*of\s*values)\b/i, label: "Bid form" },
  { type: "solicitation",   re: /\b(invitation|ifb|rfp|rfq|itb|solicitation|instructions?\s*to\s*bidders)\b/i, label: "Invitation / IFB" },
  { type: "other",          re: /\b(prebid|pre-bid|sign[\s-]?in|attendee|wage|prevailing|insurance)\b/i, label: "Supporting document" }
];

/** Classify one document link by its visible text and filename. */
export function classifyDocumentLink(text, href = "") {
  let file = href || "";
  try { file = decodeURIComponent(file); } catch { /* keep raw */ }
  // separators to spaces so \b word boundaries work on filenames
  const hay = `${text || ""} ${file}`.replace(/[_+\-\/]/g, " ");
  for (const r of RULES) {
    if (r.re.test(hay)) return { type: r.type, label: r.label };
  }
  return { type: "other", label: "Document" };
}

const isDocHref = href => /\.(pdf|zip)(\?|#|$)/i.test(href || "");

/**
 * Scrape a bid page for downloadable documents.
 * Returns [{url, filename, text, type, label, ext}]
 */
export function findDocumentLinks(html, baseUrl) {
  const $ = cheerio.load(String(html || "").replace(/></g, "> <"));
  const out = [];
  const seen = new Set();
  $("a").each((_, a) => {
    const href = $(a).attr("href");
    if (!href || !isDocHref(href)) return;
    let url;
    try { url = new URL(href, baseUrl).href; } catch { return; }
    if (seen.has(url)) return;
    seen.add(url);
    const text = $(a).text().replace(/\s+/g, " ").trim();
    let filename = url.split("/").pop().split("?")[0];
    try { filename = decodeURIComponent(filename); } catch { /* keep raw */ }

    // Classify from the link's OWN text plus its filename. Surrounding row text
    // is only a fallback for generic links ("Download", "Click here") — using it
    // otherwise made every link in a row inherit its neighbours' labels.
    const generic = text.length <= 3 || /^(download|click here|view|open|here|link|pdf)$/i.test(text);
    let cls = classifyDocumentLink(text, filename);
    let label = text;
    if (generic || cls.type === "other") {
      const context = ($(a).closest("tr,li,p,div").first().text() || "").replace(/\s+/g, " ").trim().slice(0, 200);
      if (generic) {
        const ctxCls = classifyDocumentLink(context, filename);
        if (ctxCls.type !== "other") { cls = ctxCls; label = context; }
      }
    }
    out.push({
      url, filename,
      text: (label || filename).slice(0, 160),
      type: cls.type, label: cls.label,
      ext: (filename.match(/\.(\w+)$/) || [, ""])[1].toLowerCase()
    });
  });
  // Most useful first: specs and plans before supporting paperwork
  const rank = { specifications: 0, plans: 1, addendum: 2, solicitation: 3, bid_form: 4, other: 5 };
  return out.sort((a, b) => (rank[a.type] ?? 9) - (rank[b.type] ?? 9));
}

/** Documents worth analyzing for film scope (skip wage rates, sign-in sheets). */
export function analyzableDocuments(docs = []) {
  return docs.filter(d => d.ext === "pdf" && ["specifications", "plans", "addendum", "solicitation"].includes(d.type));
}

/** Friendly note about what will happen, used in the UI. */
export function describeDocumentSet(docs = []) {
  if (!docs.length) return "No downloadable documents found on the source page.";
  const counts = {};
  for (const d of docs) counts[d.label] = (counts[d.label] || 0) + 1;
  return Object.entries(counts).map(([k, v]) => `${v} ${k}${v > 1 ? "s" : ""}`).join(", ");
}
