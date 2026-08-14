// Blue Book (webapi.bluebook.net) webhook notification ingest.
//
// Docs: https://webapi.bluebook.net/Help/Api/POST-api-v1-webhooks-notifications
//
// CAVEAT: that page could not be fetched when this was written (the domain is
// blocked by this environment's network egress policy), so the exact payload
// Blue Book sends is unconfirmed. bluebookToLead() is written defensively —
// it checks several plausible field-name variants (camelCase, PascalCase) and
// unwraps common webhook envelope shapes ({data:...}, {payload:...}) — rather
// than assuming one exact schema. If a real notification doesn't map cleanly,
// widen the candidate lists in `pick()` below to match the actual field names.
import { classifyFilmRelevance } from "./relevance.js";

const uid = () => Math.random().toString(36).slice(2, 10);

const pick = (obj, keys) => {
  for (const k of keys) {
    const v = obj?.[k];
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return "";
};

/** Normalize a date-ish value to M/D/YYYY, the format the rest of Discovery expects. */
function normalizeDate(v) {
  if (!v) return "";
  const d = new Date(v);
  if (!isNaN(d)) return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
  return String(v);
}

/**
 * Map a Blue Book webhook notification payload onto the same lead shape the
 * Discovery scanners produce (src/discovery.js), so webhook-pushed leads get
 * identical relevance grading, film-type tagging, and dedup as scanned ones.
 */
export function bluebookToLead(raw) {
  // Unwrap common webhook envelope shapes.
  const body = raw?.data || raw?.Data || raw?.payload || raw?.Payload
    || raw?.notification || raw?.Notification || raw || {};

  const title = pick(body, ["title", "Title", "projectName", "ProjectName", "name", "Name", "subject", "Subject"])
    || "Untitled Blue Book notification";
  const description = pick(body, ["description", "Description", "scope", "Scope", "scopeOfWork", "ScopeOfWork", "notes", "Notes", "summary", "Summary"]);
  const projectNo = pick(body, ["projectNumber", "ProjectNumber", "bidNumber", "BidNumber", "projectId", "ProjectId", "id", "Id"]) || "-";
  const bidDate = normalizeDate(pick(body, ["bidDate", "BidDate", "dueDate", "DueDate", "closeDate", "CloseDate", "biddingDate", "BiddingDate"]));
  const link = pick(body, ["url", "Url", "projectUrl", "ProjectUrl", "link", "Link", "detailsUrl", "DetailsUrl"]);
  const city = pick(body, ["city", "City"]);
  const state = pick(body, ["state", "State", "stateCode", "StateCode"]);
  const owner = pick(body, ["owner", "Owner", "client", "Client"]);
  const gc = pick(body, ["generalContractor", "GeneralContractor", "gc", "Gc", "company", "Company"]);

  const hay = [title, description, owner, gc].filter(Boolean).join(" ");
  const cls = classifyFilmRelevance(hay);

  return {
    id: uid(),
    projectNo: String(projectNo),
    title: String(title).slice(0, 160),
    bidDate,
    links: link ? { page: link } : {},
    relevance: cls.relevance, relevanceScore: cls.score, matchReasons: cls.reasons, filmTypes: cls.filmTypes,
    stillOpen: true,
    state: state ? String(state) : "",
    city: city ? String(city) : "",
    owner: owner ? String(owner) : "",
    gc: gc ? String(gc) : "",
    source: "Blue Book (webhook)",
    sourceUrl: link || "https://www.thebluebook.com/",
    foundAt: new Date().toISOString().slice(0, 10)
  };
}
