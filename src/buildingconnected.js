// BuildingConnected (Autodesk Platform Services) integration.
//
// Docs: https://aps.autodesk.com/en/docs/buildingconnected/v2/reference/http/buildingconnected-projects-GET/
//
// CONFIRMED from the docs page (screenshots + a sample response, 2026-08-14)
// — this whole integration is now built against real, seen field names:
//   - Method and URI: GET https://developer.api.autodesk.com/construction/buildingconnected/v2/projects
//   - Authentication Context: "User context required" — three-legged OAuth.
//     BuildingConnected data is scoped to a real person's account, so this is
//     NOT a silent server-to-server integration: a human has to click Connect,
//     log into Autodesk/BuildingConnected once, and grant access. (The docs
//     also mention a Secure Service Account (SSA) flow — headless but still
//     user-scoped, needs an Autodesk admin to provision a service account
//     ahead of time. Not implemented here; Authorization Code flow below
//     covers the same endpoint and needs no extra Autodesk-side setup.)
//   - Required OAuth Scopes: data:read
//   - Request header: Authorization: Bearer <three-legged access token>
//   - Query filters use `filter[field]=value` — e.g. `filter[updatedAt]=<ISO>..`
//     for an open-ended range. Used below to make Sync incremental.
//   - Pagination: response has `pagination.nextUrl`, a ready-to-fetch full URL.
//   - Response envelope: `{ pagination: {...}, results: [ {project...}, ... ] }`.
//     Each project carries (among others): id, name, number, client,
//     description (HTML), notes (HTML), value, projectSize/Units, location
//     {city, state, complete, coords, ...}, architect, company {name, ...},
//     bidsDueAt, dueAt, closedAt, awarded, state, isPublic, marketSector.
// The OAuth authorize/token endpoints below are Autodesk Platform Services'
// stable, publicly documented v2 auth endpoints (shared across all APS
// products) — those are implemented for real, independent of the BC-specific
// page.
//
// Two things below are still educated guesses, not confirmed by the docs:
//   1. The project's public web URL isn't in the response — `link` is
//      constructed from `id` as `app.buildingconnected.com/projects/{id}`,
//      BuildingConnected's known web app host. If that routing is wrong,
//      it'll 404 in a browser but doesn't affect the lead data itself.
//   2. `company` on a project is mapped to `gc` (general contractor) since
//      that's the most useful reading for "who's running this project" —
//      the one sample response we've seen doesn't make this unambiguous
//      (its example company has businessType "Subcontractor", which is odd
//      for a GC). If GC names come through wrong, this is the field to swap.
import { classifyFilmRelevance } from "./relevance.js";

const uid = () => Math.random().toString(36).slice(2, 10);

const AUTH_BASE = "https://developer.api.autodesk.com/authentication/v2";
const AUTHORIZE_URL = AUTH_BASE + "/authorize";
const TOKEN_URL = AUTH_BASE + "/token";
const SCOPE = "data:read";

// CONFIRMED — see file header.
const DEFAULT_PROJECTS_URL = "https://developer.api.autodesk.com/construction/buildingconnected/v2/projects";

export function redirectUri(env) {
  return (env.APP_URL || "").replace(/\/$/, "") + "/api/integrations/buildingconnected/callback";
}

export function buildAuthorizeUrl(env) {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: env.BC_CLIENT_ID || "",
    redirect_uri: redirectUri(env),
    scope: SCOPE
  });
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

async function tokenRequest(env, form) {
  const basic = btoa(`${env.BC_CLIENT_ID}:${env.BC_CLIENT_SECRET}`);
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "Authorization": `Basic ${basic}` },
    body: form
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error_description || data.error || `Autodesk token request failed (HTTP ${res.status})`);
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Date.now() + (Number(data.expires_in) || 3600) * 1000
  };
}

/** Step 2 of three-legged OAuth: trade the ?code=... Autodesk sent back for tokens. */
export function exchangeCode(env, code) {
  return tokenRequest(env, new URLSearchParams({
    grant_type: "authorization_code", code, redirect_uri: redirectUri(env)
  }));
}

export function refreshTokens(env, refresh_token) {
  return tokenRequest(env, new URLSearchParams({ grant_type: "refresh_token", refresh_token }));
}

/** Returns a valid access token from storage, refreshing first if it's expired (or about to be). Null if never connected. */
export async function ensureAccessToken(env, store) {
  const tok = await store.get("bc_tokens");
  if (!tok) return null;
  if (tok.expires_at && tok.expires_at - Date.now() > 60_000) return tok.access_token;
  if (!tok.refresh_token) return null;
  const fresh = await refreshTokens(env, tok.refresh_token);
  const merged = { ...fresh, refresh_token: fresh.refresh_token || tok.refresh_token };
  await store.set("bc_tokens", merged);
  return merged.access_token;
}

function normalizeDate(v) {
  if (!v) return "";
  const d = new Date(v);
  if (!isNaN(d)) return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
  return String(v);
}

const stripHtml = s => String(s || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

/**
 * Map one BuildingConnected project object (the confirmed `results[]` shape)
 * onto the same lead shape Discovery's scanners produce (src/discovery.js),
 * so BC leads get identical film/glazing relevance grading and dedup as
 * scanned and Blue Book leads. See file header for the two fields that are
 * still educated guesses (project link, company->gc).
 */
export function bcProjectToLead(raw) {
  const p = raw?.project || raw || {};
  const title = p.name || "Untitled BuildingConnected project";
  const description = stripHtml(p.description);
  const notes = stripHtml(p.notes);
  const projectNo = p.number != null ? String(p.number) : (p.id || "-");
  const bidDate = normalizeDate(p.bidsDueAt || p.dueAt);
  const link = p.id ? `https://app.buildingconnected.com/projects/${p.id}` : "";
  const loc = p.location || {};
  const city = loc.city || "";
  const state = loc.state || "";
  const owner = p.client || "";
  const gc = p.company?.name || "";
  const architect = p.architect || "";
  const value = Number(p.value) || null;

  const hay = [title, description, notes, owner, gc, architect, p.marketSector].filter(Boolean).join(" ");
  const cls = classifyFilmRelevance(hay);

  return {
    id: uid(),
    projectNo,
    title: String(title).slice(0, 160),
    bidDate,
    links: link ? { page: link } : {},
    relevance: cls.relevance, relevanceScore: cls.score, matchReasons: cls.reasons, filmTypes: cls.filmTypes,
    stillOpen: !p.closedAt,
    state, city, owner, gc, architect,
    value: value || undefined,
    projectType: p.isPublic === true ? "Public" : p.isPublic === false ? "Private" : "",
    source: "BuildingConnected",
    sourceUrl: link || "https://www.buildingconnected.com/",
    foundAt: new Date().toISOString().slice(0, 10)
  };
}

export function buildProjectsUrl(baseUrl, { updatedSince } = {}) {
  let url = baseUrl;
  if (updatedSince) {
    const sep = url.includes("?") ? "&" : "?";
    url += `${sep}filter[updatedAt]=${encodeURIComponent(updatedSince)}..`;
  }
  return url;
}

/**
 * Fetch every project BuildingConnected returns and map each to a lead.
 * Pass `updatedSince` (an ISO timestamp, e.g. the last sync time) to only
 * pull projects that changed since then via `filter[updatedAt]=<iso>..` —
 * confirmed real query syntax — instead of re-fetching everything each sync.
 */
export async function fetchProjectLeads(env, accessToken, { updatedSince } = {}) {
  let next = buildProjectsUrl(env.BC_PROJECTS_URL || DEFAULT_PROJECTS_URL, { updatedSince });
  const leads = [];
  let pages = 0;
  while (next && pages < 20) {
    const res = await fetch(next, { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" } });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`BuildingConnected API HTTP ${res.status}${body ? " — " + body.slice(0, 200) : ""}`);
    }
    const data = await res.json();
    const items = data.results || data.data || data.projects || (Array.isArray(data) ? data : []);
    for (const item of items) leads.push(bcProjectToLead(item));
    next = data.pagination?.nextUrl || data.nextUrl || data.next || null;
    pages++;
  }
  return leads;
}
