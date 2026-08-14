// Discovery Engine v2 — scans public procurement sources for film-relevant projects.
// Three adapter kinds:
//   fmdc    — structured parser for the Missouri OA-FMDC bid table (verified)
//   sam     — SAM.gov federal opportunities API (official API, needs SAM_API_KEY)
//   generic — resilient link/text scanner for standard public bid pages
// Every source reports its own status after each scan, so you always know
// what's working and what needs attention. Nothing here bypasses logins or ToS.
import * as cheerio from "cheerio";
import { uid } from "./store.js";
import { classifyFilmRelevance } from "./relevance.js";

const UA = { "user-agent": "Mozilla/5.0 (compatible; TintIntelligenceAI/2.0; bid research; contact: info@tinttechkc.com)" };

// Keyword tiers for film relevance
const HIGH = /\b(window|windows|glaz|glass|storefront|curtain\s*wall|film|fenestration|skylight|entrance\s*door)\b/i;
const MED = /\b(renovat|remodel|interior|exterior|envelope|facade|fa\u00e7ade|tenant\s*(finish|improve)|build[\s-]?out|courthouse|office\s*build)\b/i;

export const SOURCES = [
  // --- Federal ---
  { id: "sam", name: "SAM.gov (Federal)", kind: "sam", url: "https://sam.gov" },
  // --- Missouri state ---
  { id: "fmdc", name: "Missouri OA-FMDC (state construction)", kind: "fmdc",
    url: "https://oa.mo.gov/facilities/bid-opportunities/bid-listing-electronic-plans" },
  { id: "mobuys", name: "MissouriBUYS / MOVERS bid board", kind: "generic",
    url: "https://missouribuys.mo.gov/bid-board/movers", state: "MO",
    note: "MOVERS is a JavaScript portal - if this scan comes back thin, check the board manually." },
  // --- Kansas state ---
  { id: "ksadmin", name: "Kansas Dept of Administration bids", kind: "generic",
    url: "https://admin.ks.gov/offices/procurement-contracts/bidding--contracts", state: "KS",
    note: "State bid events live in a PeopleSoft portal; this page links out to them." },
  // --- Counties ---
  { id: "jacksonco", name: "Jackson County MO purchasing", kind: "generic",
    url: "https://www.jacksongov.org/Government/Departments/Finance-Purchasing/Doing-Business-With-Jackson-County", state: "MO",
    note: "Formal solicitations post to Bonfire/DemandStar (JS portals); this page announces them." },
  { id: "circuit16", name: "16th Circuit Family Court bids", kind: "generic",
    url: "https://www.16thcircuit.org/family-court-bids", state: "MO" },
  { id: "joco", name: "Johnson County KS (IonWave)", kind: "generic",
    url: "https://jocogov.ionwave.net/CurrentSourcingEvents.aspx", state: "KS" },
  { id: "wyco", name: "Wyandotte County / KCK purchasing", kind: "generic",
    url: "https://purchasing.wycokck.org/eProcurement/Bid_Download.aspx", state: "KS" },
  // --- Cities ---
  { id: "kcmo", name: "KCMO procurement", kind: "generic",
    url: "https://www.kcmo.gov/city-hall/departments/general-services/procurement-services", state: "MO" },
  // --- Schools ---
  { id: "bluevalley", name: "Blue Valley USD 229 purchasing", kind: "generic",
    url: "https://www.bluevalleyk12.org/cms/one.aspx?portalId=436034&pageId=474785", state: "KS" },
  { id: "olathe", name: "Olathe Public Schools purchasing", kind: "generic",
    url: "https://www.olatheschools.org/Page/1279", state: "KS" },
  { id: "smsd", name: "Shawnee Mission SD purchasing", kind: "generic",
    url: "https://www.smsd.org/about/departments/business-finance/purchasing", state: "KS" },
  { id: "kcps", name: "Kansas City Public Schools procurement", kind: "generic",
    url: "https://www.kcpublicschools.org/about/procurement", state: "MO" },
  // --- KC-metro cities (round 2) ---
  { id: "indep", name: "Independence MO bids/RFPs", kind: "generic",
    url: "https://www.independencemo.gov/government/city-departments/internal-services/finance-department/procurement-division/bidrfp-opportunities", state: "MO" },
  { id: "leessummit", name: "Lee's Summit MO solicitations", kind: "generic",
    url: "https://cityofls.net/procurement-contract-services/solicitation-information", state: "MO",
    note: "Construction docs live on QuestCDN; this page lists open solicitations." },
  { id: "overlandpark", name: "Overland Park KS bids", kind: "generic",
    url: "https://www.opkansas.org/doing-business/bids-proposals/", state: "KS",
    note: "Best-known URL - first scan will confirm." },
  { id: "olathecity", name: "City of Olathe KS procurement", kind: "generic",
    url: "https://www.olatheks.gov/government/procurement/bids-and-proposals/bids-and-proposal-process", state: "KS",
    note: "Formal bids post to a Bonfire/Mercell portal (JS); this page announces and links them." },
  { id: "lenexa", name: "Lenexa KS current bids", kind: "generic",
    url: "https://www.lenexa.com/Business-Development/Bids-and-Requests-for-Proposals/Current-Bids-Proposals-Opportunities", state: "KS" },
  // --- Airports / universities / medical ---
  { id: "kci", name: "KCI / KCMO Aviation business opportunities", kind: "generic",
    url: "https://www.flykci.com/business/", state: "MO" },
  { id: "kumed", name: "KU Medical Center bids", kind: "generic",
    url: "https://www.kumc.edu/finance/supply-chain/bid-opportunities.html", state: "KS" },
  { id: "ku", name: "University of Kansas bids", kind: "generic",
    url: "https://procurement.ku.edu/kuother-bid-opportunities", state: "KS" }
];

const today = () => new Date().toISOString().slice(0, 10);

/* ---------------- FMDC structured parser (verified) ---------------- */
export function parseFmdcHtml(html) {
  const $ = cheerio.load(html);
  const leads = [];
  $("table tr").each((_, tr) => {
    const cells = $(tr).find("td");
    if (cells.length < 3) return;
    const projectNo = $(cells[0]).text().trim();
    if (!projectNo || /project\s*number/i.test(projectNo)) return;
    const title = $(cells[1]).text().replace(/\s+/g, " ").trim();
    const dates = $(cells[2]).text().match(/\d{1,2}\/\d{1,2}\/\d{4}/g) || [];
    const bidDate = dates.length ? dates[dates.length - 1] : "";
    const links = {};
    $(cells[2]).find("a").each((_, a) => {
      const label = $(a).text().trim().toLowerCase();
      const href = $(a).attr("href");
      if (!href) return;
      if (label.includes("invitation")) links.ifb = href;
      else if (label.includes("plans")) links.plans = href;
      else if (label.includes("spec")) links.specs = href;
    });
    const resultCell = cells.length >= 5 ? $(cells[4]).text().trim() : "";
    const awarded = /awarded|bid results|rejected/i.test(resultCell);
    const cls = classifyFilmRelevance(title);
    if (cls.relevance === "excluded" || cls.relevance === "low") return;
    leads.push({
      id: uid(), projectNo, title, bidDate, links,
      relevance: cls.relevance, relevanceScore: cls.score, matchReasons: cls.reasons, filmTypes: cls.filmTypes,
      stillOpen: !awarded, state: "MO",
      source: "Missouri OA-FMDC", sourceUrl: SOURCES.find(s => s.id === "fmdc").url,
      foundAt: today()
    });
  });
  return leads;
}

/* ---------------- Generic link/text scanner ---------------- */
export function parseGenericHtml(html, src) {
  // insert whitespace between adjacent tags so table cells don't glue together
  const $ = cheerio.load(html.replace(/></g, "> <"));
  $("script,style,nav,footer,header").remove();
  const seen = new Set();
  const leads = [];
  $("a").each((_, a) => {
    const text = $(a).text().replace(/\s+/g, " ").trim();
    const context = ($(a).closest("tr,li,p,div").first().text() || "").replace(/\s+/g, " ").trim().slice(0, 240);
    const hay = text + " " + context;
    if (text.length < 8) return;
    if (/^(home|about|contact|login|register|back|next|menu|search)$/i.test(text)) return;
    const cls = classifyFilmRelevance(hay);
    if (cls.relevance === "excluded" || cls.relevance === "low") return;
    const relevance = cls.relevance;
    let href = $(a).attr("href") || "";
    try { href = new URL(href, src.url).href; } catch { /* keep as-is */ }
    const key = (text + "|" + href).toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    const dates = context.match(/\d{1,2}\/\d{1,2}\/\d{2,4}/g) || [];
    leads.push({
      id: uid(),
      projectNo: (context.match(/\b(?:IFB|RFP|RFQ|BID|ITB)\s*#?\s*[0-9][0-9\w.-]*/i) || [""])[0].replace(/\s+/g," ").trim() || "-",
      title: (text.length > 20 ? text : context.slice(0, 140)) || text,
      bidDate: dates.length ? dates[dates.length - 1] : "",
      links: { page: href },
      relevance, relevanceScore: cls.score, matchReasons: cls.reasons, filmTypes: cls.filmTypes,
      stillOpen: true, state: src.state || "",
      source: src.name, sourceUrl: src.url,
      foundAt: today()
    });
  });
  return leads.slice(0, 25); // cap noise per source
}

/* ---------------- SAM.gov federal API ---------------- */
// 4 regional + 4 nationwide security queries = 8 of the ~10 daily API calls
// a personal SAM.gov key allows (scan is already gated to once per 20 hours).
// Film-first queries. Nationwide sweeps use film language directly; the two
// regional queries stay broader because local glazing work is worth seeing even
// when film is not named in the title.
// Film-first. Broad "window"/"glazing" searches were returning mostly glass and
// glazing work, burying the actual film jobs, so only one regional glazing query
// remains as an upsell feed.
const SAM_QUERIES = [
  { title: "window film" },          // nationwide
  { title: "window tinting" },       // nationwide
  { title: "security film" },        // nationwide
  { title: "solar control film" },   // nationwide
  { title: "safety film" },          // nationwide
  { title: "blast mitigation" },     // nationwide
  { title: "anti-graffiti" },        // nationwide
  { title: "glazing", state: "MO" }  // regional upsell
];

async function scanSam(env, store) {
  const key = env.SAM_API_KEY;
  if (!key) return { status: "skipped", found: 0, leads: [], error: "No SAM_API_KEY secret set" };
  const meta = (await store.get("meta")) || {};
  // Personal SAM.gov keys allow ~10 requests/day - only hit it once per ~20 hours
  const last = meta.samLastRun ? Date.now() - new Date(meta.samLastRun).getTime() : Infinity;
  if (last < 20 * 3600 * 1000) {
    return { status: "skipped", found: 0, leads: [], error: "SAM already scanned in the last 20h (daily API limit protection)" };
  }
  const fmt = d => `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}/${d.getFullYear()}`;
  const to = new Date(); const from = new Date(Date.now() - 60 * 86400000);
  const leads = []; const seen = new Set();
  for (const q of SAM_QUERIES) {
    const url = `https://api.sam.gov/opportunities/v2/search?api_key=${key}&postedFrom=${fmt(from)}&postedTo=${fmt(to)}&limit=25&ptype=o,k,p&title=${encodeURIComponent(q.title)}${q.state ? `&state=${q.state}` : ""}`;
    const res = await fetch(url, { headers: UA });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`SAM.gov HTTP ${res.status}${/RATE|LIMIT|exceeded/i.test(body) ? " (daily rate limit hit - resets at midnight ET)" : ""}`);
    }
    const data = await res.json();
    for (const op of data.opportunitiesData || []) {
      if (seen.has(op.noticeId)) continue;
      seen.add(op.noticeId);
      const title = op.title || "";
      const cls = classifyFilmRelevance(title + " " + (op.description || ""));
      if (cls.relevance === "excluded") continue;
      const relevance = cls.relevance;
      let bidDate = "";
      if (op.responseDeadLine) {
        const d = op.responseDeadLine.slice(0, 10).split("-"); // yyyy-mm-dd
        if (d.length === 3) bidDate = `${d[1]}/${d[2]}/${d[0]}`;
      }
      leads.push({
        id: uid(),
        projectNo: op.solicitationNumber || op.noticeId,
        title: `${title} - ${op.fullParentPathName || "Federal"}`.slice(0, 160),
        bidDate,
        links: { page: op.uiLink || `https://sam.gov/opp/${op.noticeId}/view` },
        relevance, relevanceScore: cls.score, matchReasons: cls.reasons, filmTypes: cls.filmTypes,
        stillOpen: !/award|cancel/i.test(op.type || ""),
        state: q.state || "US", source: q.state ? "SAM.gov (Federal)" : "SAM.gov (Federal — national security sweep)", sourceUrl: "https://sam.gov",
        foundAt: today()
      });
    }
  }
  meta.samLastRun = new Date().toISOString();
  await store.set("meta", meta);
  return { status: "ok", found: leads.length, leads };
}

/* ---------------- Orchestrator ---------------- */
async function scanOne(src, env, store) {
  try {
    if (src.kind === "sam") return await scanSam(env, store);
    const res = await fetch(src.url, { headers: UA, redirect: "follow" });
    if (!res.ok) return { status: "error", found: 0, leads: [], error: `HTTP ${res.status}` };
    const html = await res.text();
    const leads = src.kind === "fmdc" ? parseFmdcHtml(html) : parseGenericHtml(html, src);
    // Heuristic: JS-rendered portals return pages with almost no readable text
    const textLen = cheerio.load(html)("body").text().replace(/\s+/g, " ").length;
    if (leads.length === 0 && textLen < 600) {
      return { status: "js-portal", found: 0, leads: [], error: src.note || "Page renders with JavaScript - check it manually." };
    }
    return { status: "ok", found: leads.length, leads };
  } catch (e) {
    return { status: "error", found: 0, leads: [], error: e.message };
  }
}

export async function runDiscovery(env, store) {
  const results = await Promise.all(SOURCES.map(async src => ({ src, ...(await scanOne(src, env, store)) })));
  const discovered = (await store.get("discovered")) || [];
  const dismissed = (await store.get("dismissed")) || [];
  const opportunities = (await store.get("opportunities")) || [];
  const known = new Set([
    ...discovered.map(l => (l.source + "|" + l.title).toLowerCase()),
    ...dismissed,
    ...opportunities.map(o => (o.bidNumber || "").toLowerCase()).filter(Boolean)
  ]);
  const fresh = [];
  for (const r of results) {
    for (const l of r.leads) {
      const k = (l.source + "|" + l.title).toLowerCase();
      const bidKey = (l.projectNo || "").toLowerCase();
      if (known.has(k) || (bidKey && bidKey !== "-" && known.has(bidKey))) continue;
      known.add(k);
      fresh.push(l);
    }
  }
  const updated = [...fresh, ...discovered].slice(0, 200);
  await store.set("discovered", updated);
  return {
    sources: results.map(r => ({ id: r.src.id, name: r.src.name, status: r.status, found: r.found, error: r.error || null })),
    new: fresh.length,
    leads: updated
  };
}

/* ---------------- Lead -> Opportunity ---------------- */
export function leadToOpportunity(lead) {
  const parts = (lead.bidDate || "").split("/");
  let bidDue = "";
  if (parts.length === 3) {
    let [mm, dd, yyyy] = parts;
    if (yyyy.length === 2) yyyy = "20" + yyyy;
    bidDue = `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
  }
  return {
    id: uid(),
    name: `${lead.projectNo && lead.projectNo !== "-" ? lead.projectNo + " — " : ""}${lead.title}`.slice(0, 150),
    owner: lead.source, architect: "", gc: "",
    bidNumber: lead.projectNo === "-" ? "" : lead.projectNo,
    bidDue, preBid: "", city: "", county: "", state: lead.state || "", value: "",
    type: "Public",
    source: lead.links?.page || lead.links?.ifb || lead.sourceUrl,
    discovered: lead.foundAt, status: "New", filmTypes: [],
    notes: `Auto-discovered from ${lead.source} (${lead.relevance} relevance). Verify scope and dates at the source link.`,
    score: null
  };
}
