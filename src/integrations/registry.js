// Canonical registry of every construction data source Bid Hunter has
// assessed, static metadata plus a function to merge in real, live status.
//
// This is intentionally NOT a registry of implemented API clients — most rows
// here have no code behind them yet, on purpose. A source only gets a real
// connector once its actual docs (or a live account) have been seen; see the
// "status" values below and DEPLOY.md for what that means per source.
//
// status values:
//   "integrated"          - real code in this repo, tested against actual responses
//   "docs_confirmed"       - verified from real docs/payloads, partially built
//   "public_known"         - widely-documented public API, not live-verified this build
//   "covered_indirectly"   - reached today via public bid boards or an indirect connector, no formal API
//   "commercial_required"  - needs a paid/sales relationship before any code is worth writing
//   "unverified"           - no confirmed public API found; contact the provider

export const SOURCE_REGISTRY = [
  // ---- Phase 1 ----
  {
    id: "buildingconnected", name: "BuildingConnected", phase: 1,
    status: "integrated", auth: "OAuth 2.0 (three-legged)", access: "Free API access; BuildingConnected product approval may require Autodesk",
    licensing: "unverified",
    note: "OAuth flow, GET /construction/buildingconnected/v2/projects, and full field mapping confirmed against real docs and a real sample response."
  },
  {
    id: "samgov", name: "SAM.gov", phase: 1,
    status: "integrated", auth: "Free API key (self-serve at sam.gov)", access: "Public, no cost",
    licensing: "public",
    note: "Live in src/discovery.js — 7 nationwide film-language queries + 1 regional glazing sweep, rate-limited to the ~10/day personal-key ceiling."
  },
  {
    id: "bluebook", name: "Blue Book Network", phase: 1,
    status: "docs_confirmed", auth: "Shared-token webhook", access: "Unverified beyond the one confirmed endpoint",
    licensing: "unverified",
    note: "POST /api/v1/webhooks/notifications confirmed and integrated. The rest of their API catalog (project search, company/contact data) was never seen."
  },
  {
    id: "dodge", name: "Dodge Construction Network", phase: 1,
    status: "commercial_required", auth: "Unverified", access: "Paid subscription; API/data-feed add-on, sales-mediated (general knowledge, not verified)",
    licensing: "commercial",
    note: "A sales conversation, not an engineering task. Send real docs once you have an account rep and I'll build the connector."
  },
  {
    id: "constructconnect", name: "ConstructConnect", phase: 1,
    status: "commercial_required", auth: "Unverified", access: "Enterprise data feeds, sales-mediated (general knowledge, not verified)",
    licensing: "commercial",
    note: "iSqFt and SmartBid were both absorbed into ConstructConnect over the years — likely one relationship covers all three."
  },
  {
    id: "planhub", name: "PlanHub", phase: 1,
    status: "unverified", auth: "Unverified", access: "No confirmed public developer program found",
    licensing: "unverified",
    note: "If you have a PlanHub account, check account settings/support for an integrations page and send it over."
  },

  // ---- Phase 2 ----
  {
    id: "usaspending", name: "USAspending.gov", phase: 2,
    status: "public_known", auth: "None historically required (general knowledge)", access: "Public, free",
    licensing: "public",
    note: "Highest-value next build once verifiable — federal contractor award history. Not live-checked this session; api.usaspending.gov was blocked same as every other domain."
  },
  {
    id: "gov_portals", name: "State & local government bid portals", phase: 2,
    status: "covered_indirectly", auth: "None (public listing pages)", access: "Public",
    licensing: "public",
    note: "21 sources live in src/discovery.js: Missouri OA-FMDC/MissouriBUYS, Kansas state, Jackson/Johnson/Wyandotte counties, 16th Circuit, 6 city halls, 4 school districts, KCI, KU, KU Med. Public notice boards, not formal APIs."
  },
  {
    id: "permits", name: "Building permit databases", phase: 2,
    status: "unverified", auth: "Varies by jurisdiction", access: "Some cities run open-data (Socrata-style) portals; not universal",
    licensing: "unverified",
    note: "Needs a dedicated per-jurisdiction research pass once a network-open session is available."
  },

  // ---- Phase 3 ----
  {
    id: "procore", name: "Procore", phase: 3,
    status: "unverified", auth: "OAuth 2.0 (general knowledge)", access: "Sandbox likely self-serve; production data scoped to projects you're already connected to",
    licensing: "unverified",
    note: "Built for collaborating on projects you're already invited into, not for discovering new bid opportunities — lower priority than it looks."
  },
  {
    id: "acc", name: "Autodesk Construction Cloud", phase: 3,
    status: "unverified", auth: "Same OAuth family as BuildingConnected", access: "Hub/project-scoped, same limitation as Procore",
    licensing: "unverified",
    note: "Useful once you're working a project in ACC, not a discovery feed for new ones."
  },
  {
    id: "gc_plan_rooms", name: "Major GC plan rooms", phase: 3,
    status: "covered_indirectly", auth: "Per-GC login", access: "No unified API — each GC runs its own portal",
    licensing: "n/a",
    note: "Already tracked per-contractor in the Contractors tab. BuildingConnected/PlanHub exist because GCs use them as the aggregation layer instead of a public API."
  },
  {
    id: "architect_specs", name: "Architect / specification sources", phase: 3,
    status: "covered_indirectly", auth: "n/a", access: "No project-specific spec database exists to query",
    licensing: "n/a",
    note: "Handled by the document-intelligence pipeline reading the real spec book a project hands you."
  }
];

const STATUS_LABEL = {
  integrated: "Integrated", docs_confirmed: "Docs confirmed", public_known: "Public, known",
  covered_indirectly: "Covered indirectly", commercial_required: "Commercial required", unverified: "Unverified"
};

/** Merge the static registry with real, live status for the sources that have one. */
export async function integrationsStatus(env, store) {
  const meta = (await store.get("meta")) || {};
  const bcTokens = await store.get("bc_tokens");

  const live = {
    buildingconnected: bcTokens
      ? { connected: true, detail: meta.bcLastSync ? `Last synced ${meta.bcLastSync.slice(0, 10)}` : "Connected — not yet synced" }
      : { connected: false, detail: "Set BC_CLIENT_ID/BC_CLIENT_SECRET, then Connect" },
    bluebook: meta.bluebookLastReceived
      ? { connected: true, detail: `Last notification ${meta.bluebookLastReceived.slice(0, 10)}` }
      : { connected: false, detail: "Register the webhook callback in Blue Book" },
    samgov: env.SAM_API_KEY
      ? { connected: true, detail: meta.samLastRun ? `Last scan ${meta.samLastRun.slice(0, 10)}` : "Key set, not scanned yet" }
      : { connected: false, detail: "Run: npx wrangler secret put SAM_API_KEY" },
    gov_portals: { connected: true, detail: meta.samLastRun || "Runs with the nightly Discovery scan" }
  };

  return SOURCE_REGISTRY.map(s => ({
    ...s,
    statusLabel: STATUS_LABEL[s.status],
    live: live[s.id] || null
  }));
}
