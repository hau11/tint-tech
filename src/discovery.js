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
// A handful of municipal sites (Cloudflare/Imperva-style bot walls) reject the
// honest UA above outright — not because of anything we do, just because it
// doesn't look like a browser. For those specific sources we fall back to a
// plain, real-world browser UA (see the `ua` field per source below) so the
// request reads like an ordinary visitor loading a public bid-notice page.
const BROWSER_UA = { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36" };

// Keyword tiers for film relevance
const HIGH = /\b(window|windows|glaz|glass|storefront|curtain\s*wall|film|fenestration|skylight|entrance\s*door)\b/i;
const MED = /\b(renovat|remodel|interior|exterior|envelope|facade|fa\u00e7ade|tenant\s*(finish|improve)|build[\s-]?out|courthouse|office\s*build)\b/i;

export const SOURCES = [
  // --- Federal ---
  { id: "sam", name: "SAM.gov (Federal)", kind: "sam", url: "https://sam.gov" },
  // --- Missouri state ---
  // state tag matters: without it a geography filter drops this source, and it
  // is the most productive board on the list.
  { id: "fmdc", name: "Missouri OA-FMDC (state construction)", kind: "fmdc",
    url: "https://oa.mo.gov/facilities/bid-opportunities/bid-listing-electronic-plans", state: "MO" },
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
    url: "https://jocogov.ionwave.net/CurrentSourcingEvents.aspx", state: "KS",
    note: "IonWave's own robots.txt disallows automated access to this page, so we don't scrape it — check it by hand." },
  { id: "wyco", name: "Wyandotte County / KCK purchasing", kind: "generic",
    url: "https://purchasing.wycokck.org/eProcurement/Bid_Download.aspx", state: "KS" },
  // --- Cities ---
  // kcmo.gov 403'd our honest research UA outright (bot wall); the plain
  // browser UA below gets through. The page itself is just a directory to
  // Bonfire/DemandStar/Plan Room though, so this mainly stops the source
  // from reporting an error — it won't surface much on its own.
  { id: "kcmo", name: "KCMO procurement", kind: "generic",
    url: "https://www.kcmo.gov/city-hall/departments/general-services/bids", state: "MO", ua: BROWSER_UA },
  // --- Schools ---
  // Old URL 404'd (site restructure). Same bot-wall issue as kcmo above.
  { id: "bluevalley", name: "Blue Valley USD 229 purchasing", kind: "generic",
    url: "https://www.bluevalleyk12.org/about/dept/business-operations/purchasing", state: "KS", ua: BROWSER_UA },
  // Old URL 404'd. Actual bids live on Olathe's IonWave portal, which — like
  // Johnson County's above — disallows automated access via robots.txt.
  { id: "olathe", name: "Olathe Public Schools purchasing", kind: "generic",
    url: "https://www.olatheschools.org/departments/business-and-finance", state: "KS",
    note: "Bids post to an IonWave portal that disallows automated access (robots.txt) - check it by hand." },
  // Old URL 404'd; this one lists real open bids with due dates directly
  // in the page (confirmed 9/2026) - should be the best of this batch.
  { id: "smsd", name: "Shawnee Mission SD purchasing", kind: "generic",
    url: "https://www.smsd.org/about/departments/purchasing-bidding/bids-bid-summaries", state: "KS" },
  // Old URL 404'd. Live listings sit behind a login-gated bidding system
  // this page links to, so expect this one to stay thin.
  { id: "kcps", name: "Kansas City Public Schools procurement", kind: "generic",
    url: "https://www.kcpublicschools.org/about/departments/purchasing", state: "MO",
    note: "Full listings require a free account on the district's Online Bidding System - this page only announces them." },
  // --- KC-metro cities (round 2) ---
  { id: "indep", name: "Independence MO bids/RFPs", kind: "generic",
    url: "https://www.independencemo.gov/government/city-departments/internal-services/finance-department/procurement-division/bidrfp-opportunities", state: "MO" },
  { id: "leessummit", name: "Lee's Summit MO solicitations", kind: "generic",
    url: "https://cityofls.net/procurement-contract-services/solicitation-information", state: "MO",
    note: "Construction docs live on QuestCDN; this page lists open solicitations." },
  { id: "overlandpark", name: "Overland Park KS bids", kind: "generic",
    url: "https://www.opkansas.org/doing-business/bids-proposals/", state: "KS",
    note: "Best-known URL - first scan will confirm." },
  // Site itself loads fine in a real browser; it's specifically our old
  // research UA that got 403'd (same bot wall as kcmo/bluevalley above).
  { id: "olathecity", name: "City of Olathe KS procurement", kind: "generic",
    url: "https://www.olatheks.gov/government/procurement/bids-and-proposals/bids-and-proposal-process", state: "KS", ua: BROWSER_UA,
    note: "Formal bids post to a Bonfire/Mercell portal (JS); this page announces and links them." },
  { id: "lenexa", name: "Lenexa KS current bids", kind: "generic",
    url: "https://www.lenexa.com/Business-Development/Bids-and-Requests-for-Proposals/Current-Bids-Proposals-Opportunities", state: "KS" },
  // --- KC-metro cities (round 3 — Clay/Platte County side, north of the river) ---
  { id: "claycounty", name: "Clay County MO purchasing", kind: "generic",
    url: "https://www.claycountygov.com/government/purchasing/formal-bid-solicitations", state: "MO",
    note: "Bids post to an OpenGov portal (procurement.opengov.com/portal/claycounty) that may block automated requests; this page only announces them." },
  { id: "plattecounty", name: "Platte County MO purchasing", kind: "generic",
    url: "https://www.co.platte.mo.us/bid-notices", state: "MO",
    note: "Bids post to an IonWave portal that disallows automated access (robots.txt) - check it by hand." },
  { id: "liberty", name: "City of Liberty MO bids", kind: "generic",
    url: "https://www.libertymissouri.gov/Bids.aspx", state: "MO" },
  { id: "bluesprings", name: "City of Blue Springs MO bids", kind: "generic",
    url: "https://www.bluespringsgov.com/Bids.aspx", state: "MO" },
  { id: "raytown", name: "City of Raytown MO bids", kind: "generic",
    url: "https://www.raytown.mo.us/bids", state: "MO" },
  { id: "gladstone", name: "City of Gladstone MO bids/RFPs", kind: "generic",
    url: "https://www.gladstone.mo.us/documents/rfp", state: "MO",
    note: "This path is disallowed by the city's own robots.txt - check it by hand." },
  { id: "grandview", name: "City of Grandview MO public notices", kind: "generic",
    url: "https://www.grandview.org/government/public-notices", state: "MO",
    note: "Responses submit through QuestCDN; this page lists the open notices." },
  { id: "plattecity", name: "City of Platte City MO bids", kind: "generic",
    url: "https://www.plattecity.org/pview.aspx?id=16900&catid=627", state: "MO" },
  { id: "nkcschools", name: "North Kansas City School District purchasing", kind: "generic",
    url: "https://www.nkcschools.org/district/dept/purchasing/current-bids-proposals-rfps", state: "MO" },
  { id: "parkhill", name: "Park Hill School District (MO) RFPs", kind: "generic",
    url: "https://www.parkhill.k12.mo.us/requests-for-proposals", state: "MO" },
  { id: "libertyschools", name: "Liberty Public Schools (MO) purchasing", kind: "generic",
    url: "https://www.lps53.org/departments/purchasing/quotes-bids-and-rfp-opportunities", state: "MO" },
  { id: "bssd", name: "Blue Springs School District (MO) RFPs", kind: "generic",
    url: "https://www.bssd.net/requests-for-bidsproposals", state: "MO" },
  { id: "raytownschools", name: "Raytown School District (MO) procurement", kind: "generic",
    url: "https://www.raytownschools.org/district-info/procurement", state: "MO" },
  // --- Airports / universities / medical ---
  // flykci.com is dead - the airport's site moved to flykc.com.
  { id: "kci", name: "KCI / KCMO Aviation business opportunities", kind: "generic",
    url: "https://flykc.com/business-opportunities", state: "MO" },
  // --- Statewide Kansas (outside KC metro) ---
  { id: "wichita", name: "City of Wichita KS purchasing", kind: "generic",
    url: "https://www.wichita.gov/429/Purchasing", state: "KS" },
  { id: "sedgwickco", name: "Sedgwick County KS purchasing", kind: "generic",
    url: "https://www.sedgwickcounty.org/finance/purchasing/current-bids-and-proposals/", state: "KS" },
  { id: "wichitastate", name: "Wichita State University bids", kind: "generic",
    url: "https://www.wichita.edu/services/purchasing/Bid_Documents/BidDocuments.php", state: "KS" },
  { id: "topeka", name: "City of Topeka KS purchasing", kind: "generic",
    url: "https://www.topeka.gov/business/suppliers/index.php", state: "KS",
    note: "Bids post to the city's Tyler e-pro portal (JS, login-gated); this page only announces them." },
  { id: "lawrence", name: "City of Lawrence KS purchasing", kind: "generic",
    url: "https://lawrenceks.gov/finance/purchasing/", state: "KS",
    note: "Bids post to an OpenGov eProcurement portal that blocks automated requests; this page only announces them." },
  { id: "wichitaschools", name: "Wichita Public Schools (USD 259) purchasing", kind: "generic",
    url: "https://www.publicpurchase.com/gems/259usdwichita,ks/buyer/public/home", state: "KS",
    note: "Public Purchase requires a free login to view open bids; this page is the portal's public landing screen." },
  { id: "kstate", name: "Kansas State University purchasing", kind: "generic",
    url: "https://www.k-state.edu/finsvcs/purchasing/for-suppliers/", state: "KS",
    note: "Bids post to a separate bid portal (bidportal.ksu.edu); this page only announces them." },
  // Covers Hillsdale/Hillsdale Lake, Paola, Louisburg - southern KC-metro
  // exurbs. Bids post to an OpenGov portal (procurement.opengov.com/portal/miamicountyks)
  // that has blocked automated requests elsewhere in this list (see Lawrence,
  // KS above), so the browser UA and a "check by hand" fallback both apply here.
  { id: "miamico", name: "Miami County KS purchasing (Hillsdale area)", kind: "generic",
    url: "https://www.miamicountyks.gov/1025/OpenGov-Procurement---Current-Bids-RFPs", state: "KS", ua: BROWSER_UA,
    note: "Bids post to an OpenGov portal that may block automated requests - check it by hand." },
  // --- Statewide Kansas (round 2 — remaining major cities/counties/universities) ---
  { id: "manhattanks", name: "City of Manhattan KS bid postings", kind: "generic",
    url: "https://www.manhattanks.gov/2228/Bid-Postings", state: "KS" },
  { id: "rileyco", name: "Riley County KS bid postings", kind: "generic",
    url: "https://www.rileycountyks.gov/80/Bid-Postings", state: "KS" },
  { id: "salina", name: "City of Salina KS bids", kind: "generic",
    url: "https://www.salina-ks.gov/bids", state: "KS" },
  { id: "salineco", name: "Saline County KS purchasing", kind: "generic",
    url: "https://salinecountyks.gov/purchasing", state: "KS",
    note: "Bids post to a DemandStar portal; this page only announces them." },
  { id: "hutchinson", name: "City of Hutchinson KS open bids", kind: "generic",
    url: "https://www.hutchinsonks.gov/open-bids", state: "KS",
    note: "This page renders mostly via JavaScript - if the scan flags it thin, check it by hand." },
  { id: "emporia", name: "City of Emporia KS bids", kind: "generic",
    url: "https://www.emporiaks.gov/bids.aspx", state: "KS" },
  { id: "emporiastate", name: "Emporia State University vendor info", kind: "generic",
    url: "https://www.emporia.edu/about-emporia-state-university/business-office/purchasing/vendor-information/", state: "KS",
    note: "Bids post to a BidNet Direct portal; this page only announces them." },
  { id: "leavenworth", name: "City of Leavenworth KS RFPs", kind: "generic",
    url: "https://www.leavenworthks.gov/rfps", state: "KS" },
  { id: "leavenworthco", name: "Leavenworth County KS bid opportunities", kind: "generic",
    url: "https://www.leavenworthcounty.gov/information/bid_opportunities/index.php", state: "KS" },
  { id: "gardencity", name: "City of Garden City KS bids", kind: "generic",
    url: "https://www.garden-city.org/Bids.aspx", state: "KS" },
  { id: "dodgecity", name: "City of Dodge City KS bids", kind: "generic",
    url: "https://www.dodgecity.org/Bids.aspx", state: "KS" },
  { id: "junctioncity", name: "City of Junction City KS bids", kind: "generic",
    url: "https://www.junctioncity-ks.gov/bids.aspx", state: "KS" },
  { id: "pittsburgks", name: "City of Pittsburg KS bids and proposals", kind: "generic",
    url: "https://www.pittks.org/city-government/bids-and-proposals/", state: "KS",
    note: "Bids post to a BidExpress portal; this page only announces them." },
  { id: "pittstate", name: "Pittsburg State University bids", kind: "generic",
    url: "https://www.pittstate.edu/office/purchasing/bids.html", state: "KS",
    note: "Bids post to BidNet Direct / Vendor Registry; this page only announces them." },
  { id: "hays", name: "City of Hays KS bids", kind: "generic",
    url: "https://www.haysusa.com/Bids.aspx", state: "KS" },
  { id: "fhsu", name: "Fort Hays State University bids", kind: "generic",
    url: "https://www.fhsu.edu/purchasing/bids/", state: "KS",
    note: "Bids post to a Vendor Registry portal; this page only announces them." },
  { id: "douglasco", name: "Douglas County KS purchasing", kind: "generic",
    url: "https://www.dgcoks.gov/administration/purchasing", state: "KS",
    note: "Bids post to a bids&tenders portal (vendor registration required); this page only announces them." },
  { id: "shawneeco", name: "Shawnee County KS purchasing", kind: "generic",
    url: "https://www.snco.gov/purchasing/", state: "KS",
    note: "Bids post to the county's own online bid portal (rpm365.sncoapps.us); this page only announces them." },
  { id: "butlerco", name: "Butler County KS bids", kind: "generic",
    url: "https://www.bucoks.gov/bids.aspx", state: "KS" },
  // --- Statewide Missouri (outside KC metro) ---
  { id: "stlouiscity", name: "City of St. Louis MO procurement", kind: "generic",
    url: "https://www.stlouis-mo.gov/government/procurement/index.cfm", state: "MO" },
  { id: "stlouiscounty", name: "St. Louis County MO procurement", kind: "generic",
    url: "https://stlouiscountymo.gov/services/services-links/procurement/", state: "MO", ua: BROWSER_UA,
    note: "This one blocked even a plain browser UA when checked - may need to be looked at by hand regardless." },
  { id: "springfieldmo", name: "City of Springfield MO purchasing", kind: "generic",
    url: "https://www.springfieldmo.gov/5375/Current-Bid-Notices", state: "MO" },
  { id: "columbiamo", name: "City of Columbia MO purchasing", kind: "generic",
    url: "https://www.como.gov/finance/vendors/bid-solicitations/", state: "MO",
    note: "Bids post to an IonWave portal that disallows automated access (robots.txt) - check it by hand." },
  { id: "jeffcity", name: "Jefferson City MO purchasing", kind: "generic",
    url: "https://www.jeffcomo.gov/347/Bids", state: "MO",
    note: "This page links out to the actual bid list rather than showing it inline - check it by hand." },
  { id: "mizzoupdc", name: "University of Missouri (Mizzou) construction bids", kind: "generic",
    url: "https://pdc-projects.missouri.edu/", state: "MO" },
  { id: "missouristate", name: "Missouri State University (Springfield) solicitations", kind: "generic",
    url: "https://www.missouristate.edu/Procurement/SolicitationPosting/default.htm", state: "MO" },
  // --- Lake of the Ozarks ---
  // Confirmed 9/2026: lists a real open bid with a sealed-bid deadline
  // directly on the page, no portal login needed to view it.
  { id: "lakeozark", name: "City of Lake Ozark MO bids", kind: "generic",
    url: "https://cityoflakeozark.net/bids-and-proposals/", state: "MO" },
  { id: "osagebeach", name: "City of Osage Beach MO bids", kind: "generic",
    url: "https://osagebeach-mo.gov/Bids.aspx", state: "MO" },
  // Camden County itself (the unincorporated lake area) has no dedicated
  // online bid system as of this writing - Lake Ozark and Osage Beach above
  // are the two incorporated cities actually running one.
  { id: "stlpublicschools", name: "St. Louis Public Schools purchasing", kind: "generic",
    url: "https://www.slps.org/departments/finance-division/welcome-to-procurement/bonfire-bid-opportunities", state: "MO",
    note: "Bids post to a Bonfire portal (slps.bonfirehub.com); this page only announces them." },
  // --- Statewide Missouri (round 2 — remaining major cities/counties/universities) ---
  { id: "stjoseph", name: "City of St. Joseph MO purchasing", kind: "generic",
    url: "https://www.stjosephmo.gov/179/Purchasing", state: "MO" },
  { id: "buchananco", name: "Buchanan County MO procurement requests", kind: "generic",
    url: "https://www.co.buchanan.mo.us/procurement-requests", state: "MO" },
  { id: "mwsu", name: "Missouri Western State University current bids", kind: "generic",
    url: "https://www.missouriwestern.edu/purchasing/current-bids/", state: "MO" },
  { id: "joplin", name: "City of Joplin MO bids", kind: "generic",
    url: "https://www.joplinmo.org/Bids.aspx", state: "MO" },
  { id: "jasperco", name: "Jasper County MO invitation to bid", kind: "generic",
    url: "https://www.jaspercountymo.gov/invitation-to-bid", state: "MO" },
  { id: "capegirardeau", name: "City of Cape Girardeau MO bids", kind: "generic",
    url: "https://www.cityofcapegirardeau.org/departments/administrative/finance/bids/", state: "MO" },
  { id: "capegirardeauco", name: "Cape Girardeau County MO purchasing", kind: "generic",
    url: "https://www.capecounty.us/county-purchasing-information", state: "MO",
    note: "Bids post to an IonWave portal that disallows automated access (robots.txt) - check it by hand." },
  { id: "semo", name: "Southeast Missouri State University vendors", kind: "generic",
    url: "https://semo.edu/finance-admin/vendors.html", state: "MO" },
  { id: "stcharles", name: "City of St. Charles MO bids/purchases", kind: "generic",
    url: "https://www.stcharlescitymo.gov/161/Bids-Purchases", state: "MO" },
  { id: "stcharlesco", name: "St. Charles County MO bids", kind: "generic",
    url: "https://www.sccmo.org/Bids.aspx", state: "MO" },
  { id: "booneco", name: "Boone County MO purchasing", kind: "generic",
    url: "https://www.boonemo.gov/purchasing/", state: "MO",
    note: "Bids post to an IonWave/Euna portal that disallows automated access (robots.txt) - check it by hand." },
  { id: "greeneco", name: "Greene County MO purchasing", kind: "generic",
    url: "https://greenecountymo.gov/purchasing/bids.php", state: "MO",
    note: "Bids post to a BeaconBid portal; this page only announces them." },
  { id: "truman", name: "Truman State University open bids", kind: "generic",
    url: "https://www.truman.edu/businessoffice/purchasing/open-bids/", state: "MO" },
  { id: "nwmissouri", name: "Northwest Missouri State University bid listing", kind: "generic",
    url: "https://www.nwmissouri.edu/services/purchasing/bidlisting.htm", state: "MO",
    note: "Bids post to a Workday Strategic Sourcing portal; this page redirects there." },
  { id: "lincolnu", name: "Lincoln University (MO) bid information", kind: "generic",
    url: "https://www.lincolnu.edu/about-lincoln/purchasing/bid-information/index.html", state: "MO" },
  { id: "sedalia", name: "City of Sedalia MO bids/RFPs", kind: "generic",
    url: "https://www.sedalia.com/bids-rfps/", state: "MO" },
  { id: "warrensburg", name: "City of Warrensburg MO bids", kind: "generic",
    url: "https://www.warrensburg-mo.gov/bids.aspx", state: "MO" },
  { id: "ucm", name: "University of Central Missouri procurement", kind: "generic",
    url: "https://www.ucmo.edu/offices/procurement-and-materials-management/index.php", state: "MO",
    note: "Bids post to an IonWave portal that disallows automated access (robots.txt) - check it by hand." },
  { id: "kumed", name: "KU Medical Center bids", kind: "generic",
    url: "https://www.kumc.edu/finance/supply-chain/bid-opportunities.html", state: "KS" },
  { id: "ku", name: "University of Kansas bids", kind: "generic",
    url: "https://procurement.ku.edu/kuother-bid-opportunities", state: "KS" },

  /* ---- statewide portals outside the KC metro ----
     Every entry below was fetched and confirmed to return server-rendered HTML
     with real solicitation content before being added. Candidates that returned
     a JavaScript shell (CA, FL, VA, NY), a 404/403, or a page with no bid
     content (NM) were left out rather than listed as coverage we do not have. */
  // MANUAL: these three serve a page full of text but NOT the solicitation rows.
  // Their links are navigation or table headers, so the js-portal heuristic
  // (which only fires under 600 characters) would pass them as "ok" while they
  // returned zero leads forever. Listed so they can be checked by hand, and
  // excluded from the automated scan so they can never be counted as searched.
  { id: "txesbd", name: "Texas Electronic State Business Daily", kind: "generic",
    url: "https://www.txsmartbuy.gov/esbd", state: "TX", access: "MANUAL",
    note: "Results load via JavaScript; the served HTML has no solicitation rows." },
  { id: "paemkt", name: "Pennsylvania eMarketplace", kind: "generic",
    url: "https://www.emarketplace.state.pa.us/Search.aspx", state: "PA", access: "MANUAL",
    note: "Search form only. Results need a POST, so the page serves headers and no rows." },
  { id: "ncevp", name: "North Carolina electronic Vendor Portal", kind: "generic",
    url: "https://evp.nc.gov/solicitations/", state: "NC", access: "MANUAL",
    note: "Results load via JavaScript; the served HTML has no solicitation rows." },
  { id: "azapp", name: "Arizona Procurement Portal", kind: "generic",
    url: "https://app.az.gov/page.aspx/en/rfp/request_browse_public", state: "AZ" },
  { id: "tncpo", name: "Tennessee Central Procurement Office", kind: "generic",
    url: "https://www.tn.gov/generalservices/procurement/central-procurement-office--cpo-/supplier-information/request-for-proposals--rfp--opportunities1.html", state: "TN" },
  // MANUAL: the Periscope/BuySpeed "bso" platform. Shared by these four states,
  // so one adapter would have unlocked all of them, which is why it was tried.
  // It does not yield: the search runs as a JSF AJAX partial on top of
  // ViewState, a CSRF token and a session cookie, and a plain form POST just
  // re-renders the page with no rows and no no-records message. Emulating that
  // would break silently on any update by them, which is the exact failure this
  // registry exists to prevent. robots.txt permits /bso (it only disallows
  // /craft), so this is a brittleness judgement, not an access one.
  { id: "macommbuys", name: "Massachusetts COMMBUYS", kind: "generic",
    url: "https://www.commbuys.com/bso/view/search/external/advancedSearchBid.xhtml",
    state: "MA", access: "MANUAL", note: "Periscope bso platform: results need a JSF AJAX POST, not reachable by fetch." },
  { id: "njstart", name: "NJSTART", kind: "generic",
    url: "https://www.njstart.gov/bso/view/search/external/advancedSearchBid.xhtml",
    state: "NJ", access: "MANUAL", note: "Periscope bso platform: results need a JSF AJAX POST, not reachable by fetch." },
  { id: "nvepro", name: "NevadaEPro", kind: "generic",
    url: "https://nevadaepro.com/bso/view/search/external/advancedSearchBid.xhtml",
    state: "NV", access: "MANUAL", note: "Periscope bso platform: results need a JSF AJAX POST, not reachable by fetch." },
  { id: "orbuys", name: "OregonBuys", kind: "generic",
    url: "https://oregonbuys.gov/bso/view/search/external/advancedSearchBid.xhtml",
    state: "OR", access: "MANUAL", note: "Periscope bso platform: results need a JSF AJAX POST, not reachable by fetch." },
  { id: "inidoa", name: "Indiana IDOA business opportunities", kind: "generic",
    url: "https://www.in.gov/idoa/procurement/current-business-opportunities/", state: "IN" }
];

/* ================= SOURCE REGISTRY =================
   Everything below turns the flat list above into something that can grow to
   national coverage without rewriting the scanner. Entries stay terse: the
   defaults here describe what the existing 89 sources already are (free,
   public, plain HTML), so only the exceptions need spelling out.
   ================================================== */

/** Census regions, so a user can say Midwest without ticking twelve boxes. */
export const REGIONS = {
  Northeast: ["CT","ME","MA","NH","NJ","NY","PA","RI","VT"],
  Midwest:   ["IA","IL","IN","KS","MI","MN","MO","ND","NE","OH","SD","WI"],
  South:     ["AL","AR","DC","DE","FL","GA","KY","LA","MD","MS","NC","OK","SC","TN","TX","VA","WV"],
  West:      ["AK","AZ","CA","CO","HI","ID","MT","NM","NV","OR","UT","WA","WY"]
};

export function regionOf(state) {
  const s = String(state || "").toUpperCase();
  for (const [name, members] of Object.entries(REGIONS)) if (members.includes(s)) return name;
  return null;
}

/**
 * How reachable a source actually is. The point of recording this is honesty:
 * the app must never imply it searched somewhere it cannot reach. Anything
 * beyond FREE is not scanned automatically and is surfaced for manual search.
 */
export const ACCESS = ["FREE", "MANUAL", "FREE_TO_SEARCH", "FREE_WITH_ACCOUNT", "FREEMIUM", "PAID", "UNKNOWN"];

// MANUAL means the page is public and free but does not serve its listings as
// HTML, so it cannot be scanned. It is shown as Manual Search Required rather
// than quietly dropped, because the board is still worth a human visit.

/** Fill in the defaults the terse entries above leave implicit. */
export function normalizeSource(src = {}) {
  const state = src.state || null;
  return {
    platform: "html",      // which adapter reads it; html = fetch and parse
    access: "FREE",        // every current source is a public board, no login
    enabled: true,
    note: null,
    ...src,
    state,
    scope: src.scope || (src.kind === "sam" ? "federal" : state ? "state" : "unknown"),
    region: src.kind === "sam" ? "National" : regionOf(state)
  };
}

/** The whole registry, normalized. */
export function sourceRegistry() {
  return SOURCES.map(normalizeSource);
}

/**
 * Pick the sources a scan should cover. Pure, so the geography rules can be
 * tested without touching the network.
 *
 * No filter means the entire United States, which is the default on purpose.
 * Federal sources are always included unless explicitly excluded: SAM.gov
 * covers every state, so dropping it when someone filters to one state would
 * silently lose the best nationwide feed.
 */
// What coverage actually exists, per region. The UI uses this to say plainly
// that a region has no automated sources, rather than running a scan that
// quietly returns only the federal feed and looks like a thorough search.
//
// Northeast is currently 0 automated: every portal tried there either blocks
// us (NH and RI return 403), has moved (VT, NY 404), or serves its listings
// via JavaScript (NJ, PA, CT, MA). That is a real gap, not an oversight.
export function coverageByRegion() {
  const out = {};
  for (const region of Object.keys(REGIONS)) {
    const all = sourceRegistry().filter(s => s.state && REGIONS[region].includes(String(s.state).toUpperCase()));
    out[region] = {
      automated: all.filter(s => s.access === "FREE" && s.enabled).length,
      manual: all.filter(s => s.access !== "FREE").length,
      states: [...new Set(all.filter(s => s.access === "FREE").map(s => s.state))].sort()
    };
  }
  return out;
}

export function selectSources({ states = null, regions = null, includeFederal = true, onlyAutomatable = true } = {}) {
  const wanted = new Set();
  for (const s of states || []) if (s) wanted.add(String(s).toUpperCase());
  for (const r of regions || []) for (const s of (REGIONS[r] || [])) wanted.add(s);

  return sourceRegistry().filter(src => {
    if (!src.enabled) return false;
    if (onlyAutomatable && src.access !== "FREE") return false;
    if (src.scope === "federal") return includeFederal;
    if (!wanted.size) return true;                  // no filter = all of the US
    return src.state && wanted.has(src.state.toUpperCase());
  });
}

const today = () => new Date().toISOString().slice(0, 10);

/* ---------------- FMDC structured parser (verified) ---------------- */
export function parseFmdcHtml(html, terms) {
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
    const cls = classifyFilmRelevance(title, terms);
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

/* ---------------- Readable-text measure ---------------- */
// How much text a human would actually see on this page. Used only to tell a
// page that genuinely has no film work on it from one that rendered nothing
// because its listings are drawn by JavaScript.
//
// This deliberately does NOT use cheerio, for two reasons:
//
// 1. Correctness. cheerio's .text() includes the contents of <script> tags,
//    because they are text nodes. A JS-rendered portal is mostly script, so it
//    scored tens of thousands of "characters" and was reported as a source that
//    answered fine and simply had nothing — when in truth we never read it.
//    stlouiscounty measured 3383 that way and has 16 readable characters.
// 2. Cost. It was a second full DOM parse of a page parseGenericHtml had
//    already parsed: ~876ms of CPU across 31 sources, against ~77ms here.
export function visibleTextLength(html) {
  return String(html || "")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&[a-z#0-9]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim().length;
}

/* ---------------- Generic link/text scanner ---------------- */
export function parseGenericHtml(html, src, terms) {
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
    const cls = classifyFilmRelevance(hay, terms);
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
// Federal queries are budgeted, because the quota is the real ceiling here.
// A personal SAM.gov key allows roughly 10 requests a day; a system account
// key allows far more. SAM_DAILY_BUDGET lets the scan use whatever the key
// actually permits without a code change when that key is upgraded.
export const SAM_CORE_QUERIES = [
// Film-explicit and nationwide. SAM matches the title as a substring, so
// "window tint" also covers "window tinting" in one request.
  { title: "window film" },
  { title: "window tint" },
  { title: "security film" },
  { title: "solar control film" },
  { title: "safety film" },
  { title: "blast mitigation" },
  { title: "anti-graffiti" }
];

// Spent only when the budget allows. Ordered by expected value, so a key with
// room for one extra request spends it on the NAICS sweep.
// 
// The NAICS query is the important one. Title search only finds work that
// says film in its title, which is exactly the opportunity the classifier is
// meant to catch when it does NOT. NAICS 238150 is Glass and Glazing
// Contractors, so it surfaces the scope itself and lets relevance.js judge
// it, rather than relying on a procurement officer choosing our vocabulary.
export const SAM_EXTENDED_QUERIES = [
  { ncode: "238150", label: "NAICS 238150 glass and glazing contractors" },
  { title: "decorative film" },
  { title: "privacy film" },
  { title: "frosted film" },
  { title: "uv film" },
  { title: "bird strike" },
  { title: "08 87 13" },
// The glazing upsell, affordable again only with a larger key.
  { title: "glazing" }
];

// Pure, so the budget rules are testable without touching the network.
export function planSamQueries(budget) {
  const n = Math.floor(Number(budget));
  const b = Number.isFinite(n) && n > 0 ? n : SAM_CORE_QUERIES.length + 1;
  if (b <= SAM_CORE_QUERIES.length) return SAM_CORE_QUERIES.slice(0, b);
  return [...SAM_CORE_QUERIES, ...SAM_EXTENDED_QUERIES.slice(0, b - SAM_CORE_QUERIES.length)];
}

// A small key must be rationed to one scan a day. A large one can afford to
// look several times a day, which matters because federal notices post on
// business hours, not on our cron schedule.
export function samCooldownHours(budget) {
  const n = Math.floor(Number(budget));
  return Number.isFinite(n) && n >= 40 ? 6 : 20;
}

async function scanSam(env, store, terms) {
  const key = env.SAM_API_KEY;
  if (!key) return { status: "skipped", found: 0, leads: [], error: "No SAM_API_KEY secret set" };
  const meta = (await store.get("meta")) || {};
// Budget comes from the key, not from code. Raise SAM_DAILY_BUDGET after
// upgrading to a system account and both the query count and the scan
// frequency follow automatically.
  const budget = env.SAM_DAILY_BUDGET;
  const queries = planSamQueries(budget);
  const cooldown = samCooldownHours(budget);
  const last = meta.samLastRun ? Date.now() - new Date(meta.samLastRun).getTime() : Infinity;
  if (last < cooldown * 3600 * 1000) {
    return { status: "skipped", found: 0, leads: [],
      error: `SAM already scanned in the last ${cooldown}h (daily API limit protection)` };
  }
  const fmt = d => `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}/${d.getFullYear()}`;
  const to = new Date(); const from = new Date(Date.now() - 60 * 86400000);
  const leads = []; const seen = new Set();
  let spent = 0, stoppedAfter = null, stopReason = null;
  for (const q of queries) {
// A query is either a title search or a NAICS sweep, never both.
    const filter = q.ncode
      ? `&ncode=${encodeURIComponent(q.ncode)}`
      : `&title=${encodeURIComponent(q.title)}`;
    const url = `https://api.sam.gov/opportunities/v2/search?api_key=${key}&postedFrom=${fmt(from)}` +
    // Two things here are free, in the sense that neither spends another request
    // against the daily quota.
    // 
    // limit was 25. SAM allows far more per call, and the cost is one request
    // either way, so 100 returns four times the work for the same quota.
    // 
    // ptype was o,k,p: solicitation, combined synopsis, presolicitation. Adding
    // r (sources sought) and s (special notice) widens it to the stage BEFORE a
    // solicitation exists, where an agency is still asking who can do this. That
    // is the only point at which film can still be written into the spec, which
    // is worth more than bidding a job where the scope is already fixed.
      `&postedTo=${fmt(to)}&limit=100&ptype=o,k,p,r,s${filter}${q.state ? `&state=${q.state}` : ""}`;
    const res = await fetch(url, { headers: UA });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      const limited = res.status === 429 || /RATE|LIMIT|exceeded/i.test(body);
      // Stop, do not throw. Throwing discarded every lead the earlier queries had
      // already collected, which made reaching the ceiling maximally destructive at
      // exactly the moment you are probing for it. Keep what we have and report how
      // far we got, so the budget can be tuned from evidence instead of guesswork.
      stoppedAfter = spent;
      stopReason = `SAM.gov HTTP ${res.status}` +
        (limited ? " — daily rate limit reached (resets midnight ET)" : "") +
        `. Stopped after ${spent} of ${queries.length} queries.` +
        (limited ? ` Set SAM_DAILY_BUDGET to about ${Math.max(1, spent)}.` : "");
      break;
    }
    spent++;
    const data = await res.json();
    for (const op of data.opportunitiesData || []) {
      if (seen.has(op.noticeId)) continue;
      seen.add(op.noticeId);
      const title = op.title || "";
      const cls = classifyFilmRelevance(title + " " + (op.description || ""), terms);
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
  meta.samQueriesSpent = spent;
  await store.set("meta", meta);
  // A partial sweep still reports ok when it found work, because those leads are
  // real. The reason rides along so System Health shows the ceiling was reached.
  if (stoppedAfter !== null) {
    return { status: leads.length ? "ok" : "error", found: leads.length, leads, error: stopReason };
  }
  return { status: "ok", found: leads.length, leads };
}

/* ---------------- Orchestrator ---------------- */
async function scanOne(src, env, store, terms) {
  try {
    if (src.kind === "sam") return await scanSam(env, store, terms);
    const res = await fetch(src.url, { headers: src.ua || UA, redirect: "follow" });
    if (!res.ok) return { status: "error", found: 0, leads: [], error: `HTTP ${res.status}` };
    const html = await res.text();
    const leads = src.kind === "fmdc" ? parseFmdcHtml(html, terms) : parseGenericHtml(html, src, terms);
    // Heuristic: JS-rendered portals return pages with almost no readable text.
    // Only checked when the parser found nothing, since a page that yielded
    // leads has self-evidently been read.
    if (leads.length === 0) {
      const textLen = visibleTextLength(html);
      if (textLen < 600) {
        return { status: "js-portal", found: 0, leads: [], error: src.note || "Page renders with JavaScript - check it manually." };
      }
    }
    return { status: "ok", found: leads.length, leads };
  } catch (e) {
    return { status: "error", found: 0, leads: [], error: e.message };
  }
}

// A lead earns its spot by being newly scanned and matching the current
// classifier. Without this, runDiscovery's merge (below) keeps every past
// lead forever — including ones seeded/classified under an older version
// of relevance.js, or whose bid deadline has simply already passed — so the
// cached list only ever grows and old noise never ages out on its own.
function isStale(lead) {
  const AGE_LIMIT_MS = 60 * 24 * 60 * 60 * 1000; // 60 days
  if (lead.foundAt) {
    const foundMs = new Date(lead.foundAt).getTime();
    if (!isNaN(foundMs) && Date.now() - foundMs > AGE_LIMIT_MS) return true;
  }
  if (lead.bidDate) {
    const parts = String(lead.bidDate).split("/");
    if (parts.length === 3) {
      let [mm, dd, yyyy] = parts;
      if (yyyy.length === 2) yyyy = "20" + yyyy;
      const due = new Date(`${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`);
      // 3-day grace period so a bid due today/yesterday doesn't vanish
      // before someone gets a chance to look at it.
      if (!isNaN(due) && due.getTime() < Date.now() - 3 * 24 * 60 * 60 * 1000) return true;
    }
  }
  return false;
}

// Cloudflare caps one Worker invocation at 50 subrequests on the free plan.
// SOURCES is 89 entries and the SAM source fans out to 8 queries of its own,
// so scanning everything at once asks for roughly 96 and the invocation is
// killed before it can reply -- which the browser surfaces as a bare
// "Failed to fetch" with no status code to go on. Scanning in slices keeps
// every invocation comfortably inside the cap.
export const SCAN_BATCH = 10;

/** Pure slice maths for a batched scan. Exported so it can be tested directly. */
export function scanSlice(total, offset, limit) {
  const t = Math.max(0, Math.floor(total) || 0);
  const start = Math.min(Math.max(0, Math.floor(offset) || 0), t);
  const want = Math.floor(limit) || SCAN_BATCH;
  // Clamped on both ends: a caller cannot ask for one source at a time and
  // crawl forever, nor raise the batch back over the subrequest cap.
  const size = Math.min(Math.max(1, want), SCAN_BATCH);
  const end = Math.min(start + size, t);
  return { start, end, nextOffset: end, done: end >= t, total: t };
}

export async function runDiscovery(env, store, { offset = 0, limit = SCAN_BATCH, states = null, regions = null } = {}) {
  // Geography is applied BEFORE slicing, so the cursor walks the selected set
  // rather than the whole registry. Filtering after slicing would make most
  // batches empty and the scan appear to stall.
  const selected = selectSources({ states, regions });
  const plan = scanSlice(selected.length, offset, limit);
  const batch = selected.slice(plan.start, plan.end);
  // User vocabulary is read once per batch and passed down, so keyword settings
  // apply to every source without each parser reaching for storage itself.
  const terms = (await store.get("keywords")) || null;
  const results = await Promise.all(batch.map(async src => ({ src, ...(await scanOne(src, env, store, terms)) })));
  const discovered = ((await store.get("discovered")) || []).filter(l => !isStale(l));
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
  // Record that a scan actually ran. System Health used to infer this from
  // the first stored lead, which meant a scan that legitimately found nothing
  // reported "No scan recorded yet" and told you to scan again -- forever.
  // Film-specific public bids are genuinely rare, so zero leads is a normal
  // outcome, not evidence the scan never happened.
  const scanMeta = (await store.get("meta")) || {};
  scanMeta.lastDiscovery = new Date().toISOString();
  await store.set("meta", scanMeta);

  // Per-source health. lastSuccess only moves when a source actually answered,
  // so a board that has been dead for months cannot keep looking current just
  // because the scan tried it again this morning.
  const health = (await store.get("sourceHealth")) || {};
  const checkedAt = new Date().toISOString();
  for (const r of results) {
    const prev = health[r.src.id] || {};
    health[r.src.id] = {
      ...prev,
      name: r.src.name,
      state: r.src.state || null,
      lastChecked: checkedAt,
      lastStatus: r.status,
      lastError: r.error || null,
      lastFound: r.found,
      lastSuccess: r.status === "ok" ? checkedAt : (prev.lastSuccess || null)
    };
  }
  await store.set("sourceHealth", health);
  return {
    sources: results.map(r => ({ id: r.src.id, name: r.src.name, status: r.status, found: r.found, error: r.error || null })),
    new: fresh.length,
    leads: updated,
    offset: plan.start,
    nextOffset: plan.nextOffset,
    total: plan.total,
    selected: selected.length,
    done: plan.done
  };
}

/* ---------------- Lead -> Opportunity ---------------- */
// Discovery leads carry dates as M/D/YYYY (or M/D/YY); the Opportunity form
// expects YYYY-MM-DD (native <input type="date">).
function toIsoDate(mdy) {
  const parts = (mdy || "").split("/");
  if (parts.length !== 3) return "";
  let [mm, dd, yyyy] = parts;
  if (yyyy.length === 2) yyyy = "20" + yyyy;
  return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
}

export function leadToOpportunity(lead) {
  return {
    id: uid(),
    name: `${lead.projectNo && lead.projectNo !== "-" ? lead.projectNo + " — " : ""}${lead.title}`.slice(0, 150),
    owner: lead.owner || lead.source, architect: lead.architect || "", gc: lead.gc || "",
    bidNumber: lead.projectNo === "-" ? "" : lead.projectNo,
    bidDue: toIsoDate(lead.bidDate), preBid: toIsoDate(lead.preBidDate),
    city: lead.city || "", county: "", state: lead.state || "", value: lead.value || "",
    type: lead.projectType || "Public",
    source: lead.links?.page || lead.links?.ifb || lead.sourceUrl,
    discovered: lead.foundAt, status: "New", filmTypes: [],
    notes: `Auto-discovered from ${lead.source} (${lead.relevance} relevance). Verify scope and dates at the source link.`,
    score: null
  };
}
