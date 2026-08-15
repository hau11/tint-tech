// BuildingConnected (Autodesk Platform Services) integration.
//
// Docs: https://aps.autodesk.com/en/docs/buildingconnected/v2/reference/http/buildingconnected-projects-GET/
//
// CONFIRMED from the docs page (screenshots, 2026-08-14) — this part is real:
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
//   - Data format: JSON
// The OAuth authorize/token endpoints below are Autodesk Platform Services'
// stable, publicly documented v2 auth endpoints (shared across all APS
// products) — those are implemented for real, independent of the one page.
//
// STILL NOT CONFIRMED (the docs domain is blocked from this build environment
// beyond the screenshots we've been sent so far): any query parameters
// (pagination? filters?) and the response body's field names. The field
// candidates in bcProjectToLead() below are still a best-effort guess. See
// DEPLOY.md step L for how to confirm and correct them once you can see the
// "Query Parameters" and "Response" sections of that page (or a sample
// request/response, if the page has a "Try it" panel — that's the fastest way
// to get both at once).
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

const pick = (obj, keys) => {
  for (const k of keys) {
    const v = obj?.[k];
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return "";
};

function normalizeDate(v) {
  if (!v) return "";
  const d = new Date(v);
  if (!isNaN(d)) return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
  return String(v);
}

/**
 * Map one BuildingConnected project object onto the same lead shape Discovery's
 * scanners produce (src/discovery.js), so BC leads get identical film/glazing
 * relevance grading and dedup as scanned and Blue Book leads.
 * Field names are best-effort placeholders — see file header.
 */
export function bcProjectToLead(raw) {
  const p = raw?.project || raw || {};
  const title = pick(p, ["name", "projectName", "title"]) || "Untitled BuildingConnected project";
  const description = pick(p, ["description", "scope", "notes", "scopeOfWork"]);
  const projectNo = pick(p, ["projectNumber", "number", "projectId", "id"]) || "-";
  const bidDate = normalizeDate(pick(p, ["bidDate", "dueDate", "bidsDueAt", "biddingClosesAt", "closeDate"]));
  const link = pick(p, ["url", "webUrl", "link", "permalink"]);
  const city = pick(p, ["city", "locationCity"]);
  const state = pick(p, ["state", "locationState", "region"]);
  const owner = pick(p, ["owner", "clientName", "client"]);
  const gc = pick(p, ["generalContractor", "company", "companyName"]);

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
    source: "BuildingConnected",
    sourceUrl: link || "https://www.buildingconnected.com/",
    foundAt: new Date().toISOString().slice(0, 10)
  };
}

/** Fetch every project BuildingConnected returns and map each to a lead. Handles a few common pagination shapes defensively. */
export async function fetchProjectLeads(env, accessToken) {
  let next = env.BC_PROJECTS_URL || DEFAULT_PROJECTS_URL;
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
    next = data.nextUrl || data.next || data.pagination?.next || null;
    pages++;
  }
  return leads;
}
