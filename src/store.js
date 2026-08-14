// D1-backed key-value store. Each collection (opportunities, contractors, ...)
// is stored as one JSON document — simple, fast for a single-team app, and
// the whole database exports with one query.
export const uid = () => Math.random().toString(36).slice(2, 10);
const today = () => new Date().toISOString().slice(0, 10);

const SEED = {
  opportunities: [
    {
      id: "opp-jcfc", name: "Jackson County Family Court — Glazing Package (IFB)",
      owner: "Jackson County, Missouri", architect: "", gc: "", bidNumber: "IFB (glazing)",
      bidDue: "2026-08-11", preBid: "", city: "Kansas City", county: "Jackson", state: "MO",
      value: "", type: "Public / County — Renovation", source: "Jackson County procurement",
      discovered: "2026-08-01", status: "Qualified", filmTypes: ["Security", "Safety"],
      notes: "Verified live lead. Courthouse glazing scope — strong fit for security/safety film add-on or direct film spec.",
      score: null
    },
    {
      id: "opp-o2512", name: "O2512-01 — Replace Windows & Tuckpoint, Fletcher Daniels State Office Bldg",
      owner: "State of Missouri (OA-FMDC)", architect: "International Architects Atelier (KC)", gc: "",
      bidNumber: "O2512-01", bidDue: "2026-08-27", preBid: "2026-08-12",
      city: "Kansas City", county: "Jackson", state: "MO", value: "",
      type: "Public / State — Window replacement (568 windows)",
      source: "https://oa.mo.gov/facilities/bid-opportunities/bid-listing-electronic-plans",
      discovered: "2026-08-05", status: "Qualified", filmTypes: ["Energy Retrofit", "Solar Control"],
      notes: "568 windows, 615 E 13th St KC. Pre-bid 10AM Aug 12, Suite 510 (photo ID). PM: Joseph 'Vance' Jisa (573) 690-7120, joseph.jisa@oa.mo.gov. Film NOT specified (full replacement) — attend pre-bid for glazier/GC relationships.",
      score: null
    }
  ],
  contractors: [
    { name: "JE Dunn Construction", hq: "Kansas City, MO", markets: "Healthcare, Higher Ed, Commercial, Government", portal: "https://www.jedunn.com/subcontractors", phone: "(816) 474-8600", email: "", rel: 2, notes: "HQ in KC — top target. Register in their sub portal.", contacts: [] },
    { name: "McCownGordon Construction", hq: "Kansas City, MO", markets: "K-12, Civic, Commercial, Manufacturing", portal: "https://mccowngordon.com/subcontractors/", phone: "(816) 960-1111", email: "", rel: 1, notes: "Heavy K-12 bond work across KC metro — safety film fit.", contacts: [] },
    { name: "Turner Construction", hq: "Kansas City office", markets: "Commercial, Aviation, Healthcare", portal: "https://www.turnerconstruction.com/subcontractors", phone: "", email: "", rel: 0, notes: "", contacts: [] },
    { name: "Clayco", hq: "St. Louis / Overland Park, KS", markets: "Industrial, Data Centers, Commercial", portal: "https://claycorp.com/subcontractors/", phone: "", email: "", rel: 0, notes: "Data center glazing / privacy film opportunities.", contacts: [] },
    { name: "Whiting-Turner", hq: "Kansas City office", markets: "Retail, Commercial, Institutional", portal: "https://www.whiting-turner.com/subcontractors/", phone: "", email: "", rel: 0, notes: "", contacts: [] },
    { name: "Burns & McDonnell", hq: "Kansas City, MO", markets: "Mission Critical, Utilities, Aviation, Federal", portal: "https://www.burnsmcd.com", phone: "(816) 333-9400", email: "", rel: 0, notes: "Design-build — blast mitigation / federal film specs.", contacts: [] },
    { name: "Crossland Construction", hq: "Columbus, KS", markets: "Commercial, Education, Municipal", portal: "https://www.crossland.com/subcontractors", phone: "", email: "", rel: 0, notes: "Strong KS-side presence.", contacts: [] },
    { name: "Nabholz Construction", hq: "Overland Park, KS office", markets: "Healthcare, Education, Commercial", portal: "https://www.nabholz.com/subcontractor-resources/", phone: "", email: "", rel: 0, notes: "", contacts: [] },
    { name: "Titan Built", hq: "Kansas City metro", markets: "Commercial interiors, Tenant finish", portal: "", phone: "", email: "", rel: 0, notes: "Tenant-finish decorative/privacy film work.", contacts: [] }
  ].map(c => ({ id: uid(), ...c })),
  takeoffs: {},
  proposals: {},
  discovered: [],
  dismissed: [],
  meta: { samLastRun: null, installedAt: today() }
};

let initialized = false;

export function makeStore(env) {
  async function init() {
    if (initialized) return;
    await env.DB.exec("CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
    initialized = true;
  }
  async function get(key) {
    await init();
    const row = await env.DB.prepare("SELECT value FROM kv WHERE key = ?").bind(key).first();
    if (row) return JSON.parse(row.value);
    if (key in SEED) {
      await set(key, SEED[key]);
      return structuredClone(SEED[key]);
    }
    return null;
  }
  async function set(key, value) {
    await init();
    await env.DB.prepare(
      "INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
    ).bind(key, JSON.stringify(value)).run();
  }
  return { get, set };
}
