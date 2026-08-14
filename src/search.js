// Global search + system health. Deterministic, no AI, no network.

/* ============================================================
   GLOBAL SEARCH
   Ranks matches so an estimator finds the record they meant.
   ============================================================ */
const FIELD_WEIGHTS = {
  projects:   { name: 10, project_number: 10, general_contractor: 6, owner: 5, architect: 5, city: 4, notes: 2 },
  companies:  { name: 10, markets: 4, hq: 3, notes: 2 },
  film_scope: { film_type: 8, manufacturer: 7, product: 7, spec_section: 9, sheet: 6, location: 4 },
  project_sheets: { sheet_number: 9, sheet_title: 6, text_content: 1 },
  rfis:       { subject: 9, question: 3 },
  project_contacts: { name: 10, title: 5, email: 6, role: 4 }
};

const LABELS = {
  projects: "Project", companies: "Company", film_scope: "Film scope",
  project_sheets: "Sheet", rfis: "RFI", project_contacts: "Contact"
};

/** Score one record against a query. Returns 0 when nothing matches. */
export function scoreRecord(record, query, table) {
  const q = String(query || "").toLowerCase().trim();
  if (!q) return { score: 0, hits: [] };
  const terms = q.split(/\s+/).filter(Boolean);
  const weights = FIELD_WEIGHTS[table] || {};
  let score = 0;
  const hits = [];

  for (const [field, weight] of Object.entries(weights)) {
    const raw = record[field];
    if (raw == null) continue;
    const val = String(raw).toLowerCase();
    for (const term of terms) {
      if (!val.includes(term)) continue;
      // exact field match beats a substring buried in a paragraph
      const exact = val === term;
      const startsWith = val.startsWith(term);
      score += weight * (exact ? 3 : startsWith ? 2 : 1);
      if (!hits.includes(field)) hits.push(field);
    }
  }
  // every term must appear somewhere, so a two-word query doesn't match on one
  const allTermsFound = terms.every(term =>
    Object.keys(weights).some(f => String(record[f] ?? "").toLowerCase().includes(term)));
  if (!allTermsFound) score = Math.floor(score / 4);
  return { score, hits };
}

/** Build a short, readable result row. */
export function buildSearchResult(record, table, hits, score) {
  const titleField = { projects: "name", companies: "name", film_scope: "film_type",
    project_sheets: "sheet_number", rfis: "subject", project_contacts: "name" }[table] || "name";
  const subtitleParts = {
    projects: [record.project_number, record.city && record.state ? `${record.city}, ${record.state}` : null, record.general_contractor],
    companies: [record.company_type, record.hq],
    film_scope: [record.manufacturer, record.spec_section && `Spec ${record.spec_section}`, record.sheet && `Sheet ${record.sheet}`],
    project_sheets: [record.sheet_title, record.classification, record.page_number != null ? `p.${record.page_number}` : null],
    rfis: [record.status],
    project_contacts: [record.role, record.email]
  }[table] || [];

  return {
    id: record.id,
    type: table,
    typeLabel: LABELS[table] || table,
    title: String(record[titleField] ?? "(untitled)").slice(0, 120),
    subtitle: subtitleParts.filter(Boolean).join(" · ").slice(0, 140),
    projectId: record.project_id || (table === "projects" ? record.id : null),
    matchedFields: hits,
    score
  };
}

export function rankSearchResults(rows = [], limit = 30) {
  return rows.filter(r => r.score > 0).sort((a, b) => b.score - a.score).slice(0, limit);
}

/* ============================================================
   SYSTEM HEALTH
   ============================================================ */
export function summarizeHealth(checks = {}) {
  const items = [];
  const add = (name, status, detail) => items.push({ name, status, detail });

  add("Database", checks.database ? "Healthy" : "Error",
    checks.database ? `${checks.projectCount ?? 0} projects` : "Cannot read the projects table — run the migrations.");
  add("Document storage (R2)", checks.r2 ? "Healthy" : "Not configured",
    checks.r2 ? "Bucket bound" : "Create the tint-documents bucket (DEPLOY.md step G).");
  add("AI (Claude)", checks.claudeKey ? "Healthy" : "Not configured",
    checks.claudeKey ? "API key set" : "Run: npx wrangler secret put ANTHROPIC_API_KEY");
  add("SAM.gov federal feed", checks.samKey ? "Healthy" : "Not configured",
    checks.samKey ? (checks.samLastRun ? `Last scan ${checks.samLastRun.slice(0, 10)}` : "Key set, not scanned yet")
                  : "Run: npx wrangler secret put SAM_API_KEY");
  add("Discovery scan", checks.lastDiscovery ? "Healthy" : "Warning",
    checks.lastDiscovery ? `Last run ${checks.lastDiscovery}` : "No scan recorded yet — tap Scan now on Discovery.");
  add("Login protection", checks.passwordSet ? "Healthy" : "Warning",
    checks.passwordSet ? "Password required" : "APP_PASSWORD is not set — anyone with the URL can open this app.");
  add("Morning email digest", checks.digest ? "Healthy" : "Not configured",
    checks.digest
      ? `Sends to ${checks.digestTo}${checks.lastDigest ? ` · last sent ${checks.lastDigest.slice(0, 10)}` : ""}`
      : "Set RESEND_API_KEY and DIGEST_TO to get the brief by email (see DEPLOY.md step J).");
  add("Nightly cron", checks.cron ? "Healthy" : "Warning",
    checks.cron ? "Scheduled 6:30 AM Central" : "No cron trigger configured.");

  const worst = items.some(i => i.status === "Error") ? "Error"
    : items.some(i => i.status === "Warning" || i.status === "Not configured") ? "Warning" : "Healthy";
  return {
    overall: worst,
    items,
    healthy: items.filter(i => i.status === "Healthy").length,
    total: items.length
  };
}

/* ============================================================
   CSV EXPORT
   ============================================================ */
export function toCsv(rows = [], columns = null) {
  if (!rows.length) return "";
  const cols = columns || Object.keys(rows[0]);
  const esc = v => {
    if (v == null) return "";
    const s = String(v);
    // guard against spreadsheet formula injection from scraped text
    const safe = /^[=+\-@]/.test(s) ? "'" + s : s;
    return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  return [cols.join(","), ...rows.map(r => cols.map(c => esc(r[c])).join(","))].join("\n");
}
