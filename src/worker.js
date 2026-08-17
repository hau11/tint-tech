// Bid Hunter — Cloudflare Worker
// Handles: API routes, basic-auth, static frontend, weekly discovery cron,
// and email ingest (BuildingConnected / PlanHub / GC portal ITB invitations).
import PostalMime from "postal-mime";
import { makeStore, uid } from "./store.js";
import { scoreOpportunity, blueprintChat, generateProposal } from "./claude.js";
import { runDiscovery, leadToOpportunity } from "./discovery.js";
import { bluebookToLead } from "./bluebook.js";
import { buildAuthorizeUrl, exchangeCode, ensureAccessToken, fetchProjectLeads } from "./buildingconnected.js";
import { integrationsStatus } from "./integrations/registry.js";
import { makeDb, migrateKvToV2 } from "./db.js";
import { findDocumentLinks, analyzableDocuments, describeDocumentSet } from "./documents.js";
import {
  computeWinLoss, breakdownBy, bestPerformer, historicalPricing,
  computeRelationshipScore, rankTodaysBids, bidCalendar, LOSS_REASONS
} from "./analytics.js";
import { scoreRecord, buildSearchResult, rankSearchResults, summarizeHealth, toCsv } from "./search.js";
import { buildChecklist, CHECKLIST_ITEMS } from "./checklist.js";
import { buildDigest, renderDigestText, renderDigestHtml, sendEmail } from "./digest.js";
import * as auth from "./auth.js";
// Aliased to leadFlow: `leads` is used as a local array name in the digest
// routes and the cron, and shadowing it would put the module in a temporal
// dead zone inside those blocks.
import * as leadFlow from "./leads.js";
import * as webhooks from "./webhooks.js";
import { assessEarlyOpportunity, detectStage, isEarly } from "./early.js";
import { classifyFilmRelevance } from "./relevance.js";
import { detectHiddenTintScope, estimateHiddenPotential, rankHiddenOpportunities } from "./hidden.js";
import {
  buildVerification, verificationAccuracy, scheduleFollowups,
  groupFollowups, rankContacts, bestContact as pickBestContact
} from "./pursuit.js";
import {
  buildArchitectProfiles, findSpecificationOpportunities,
  computeJobCost, explainVariance, costTrends, COST_CATEGORIES
} from "./intel.js";
import { buildMarketIntel, buildTerritories, buildNotifications } from "./market.js";
import {
  rankPages, selectPagesForAI, analysisSummary, buildEvidencePack,
  validateFilmFindings, validateGlazingFindings, extractSheetNumber
} from "./analyze.js";
import {
  diffGlazing, diffFilmScope, detectScopeConflicts, estimateCostImpact,
  parseAddendumNumber, summarizeAddendumImpact
} from "./addendum.js";
import {
  extractFilmScope, extractGlazing, analyzeRisks, generateRFI,
  answerFromEvidence, generateProposalV2, readScannedPage, generateOutreach, winThisJob, PROMPT_VERSIONS
} from "./claude.js";
import {
  computeTakeoff, computePricing, pricingScenarios, computeBidScore,
  bidRecommendation, computeBidReadiness, detectFilmTerms, classifySheetText,
  confidenceLabel, daysUntil, READINESS_ITEMS,
  buildTakeoffLines, summarizeTakeoff, computeRolls, recommendRollWidth
} from "./engines.js";

// Single source of truth for upload limits (spec §50) — frontend reads this
// from /api/config so the two can never disagree.
const MAX_DOCUMENT_SIZE = 10 * 1024 * 1024; // 10 MB (Workers memory ceiling)
const ALLOWED_MIME = ["application/pdf", "image/png", "image/jpeg"];
// Server-side fetch can be larger than a phone upload: it streams into R2 and
// the browser extracts text locally.
const MAX_FETCH_SIZE = 60 * 1024 * 1024;
const UA_HEADERS = { "user-agent": "Mozilla/5.0 (compatible; TintIntelligenceAI/2.0; bid research; contact: info@tinttechkc.com)" };
const ALLOWED_EXT = [".pdf", ".png", ".jpg", ".jpeg"];

const ok = (data) => json({ ok: true, data });
const fail = (message, status = 400) => json({ ok: false, error: message }, status);

function validateUpload(file) {
  if (!file || typeof file === "string") return "No file received";
  const name = String(file.name || "").toLowerCase();
  if (file.size > MAX_DOCUMENT_SIZE)
    return `File is larger than ${Math.round(MAX_DOCUMENT_SIZE / 1048576)} MB. Split the plan set — extract the A-series sheets and Division 08 specs and upload that portion.`;
  if (!ALLOWED_MIME.includes(file.type) && !ALLOWED_EXT.some(e => name.endsWith(e)))
    return "Only PDF, PNG, and JPEG files are accepted.";
  return null;
}

async function sha256Hex(buf) {
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join("");
}

function safeScore(p) { try { return p.score_json ? JSON.parse(p.score_json) : null; } catch { return null; } }

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

function authorized(request, env) {
  if (!env.APP_PASSWORD) return true; // no password set — open (set one before sharing the URL)
  const header = request.headers.get("authorization") || "";
  try {
    const decoded = atob(header.split(" ")[1] || "");
    const given = decoded.split(":").slice(1).join(":");
    return given === env.APP_PASSWORD;
  } catch { return false; }
}

const HIGH_KW = /\b(window|windows|glaz|glass|storefront|curtain\s*wall|film|fenestration|skylight)\b/i;

function b64(buf) {
  const bytes = new Uint8Array(buf);
  let s = "";
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  return btoa(s);
}

/* ---- Email ITB → lead ---- */
function emailToLead({ from, subject, text }) {
  const f = (from || "").toLowerCase();
  let source = "Email ITB";
  if (f.includes("buildingconnected") || f.includes("autodesk")) source = "BuildingConnected (ITB email)";
  else if (f.includes("planhub")) source = "PlanHub (ITB email)";
  else if (f.includes("constructconnect")) source = "ConstructConnect (email)";
  else if (f.includes("dodge")) source = "Dodge (email)";
  else if (f.includes("demandstar")) source = "DemandStar (email)";
  const body = (text || "").slice(0, 4000);
  const link = (body.match(/https?:\/\/[^\s"'<>)\]]+/i) || [""])[0];
  const dates = body.match(/\d{1,2}\/\d{1,2}\/\d{2,4}/g) || [];
  const hay = subject + " " + body.slice(0, 500);
  return {
    id: uid(),
    projectNo: (hay.match(/\b(?:IFB|RFP|RFQ|BID|ITB)\s*#?\s*[0-9][0-9\w.-]*/i) || ["-"])[0].trim(),
    title: (subject || "Untitled invitation").replace(/^(fwd?:|re:)\s*/i, "").slice(0, 160),
    bidDate: dates.length ? dates[0] : "",
    links: link ? { page: link } : {},
    relevance: HIGH_KW.test(hay) ? "high" : "medium",
    stillOpen: true, state: "",
    source, sourceUrl: link || "",
    foundAt: new Date().toISOString().slice(0, 10)
  };
}

async function saveLead(store, lead) {
  const discovered = (await store.get("discovered")) || [];
  const key = (lead.source + "|" + lead.title).toLowerCase();
  if (discovered.some(l => (l.source + "|" + l.title).toLowerCase() === key)) return false;
  await store.set("discovered", [lead, ...discovered].slice(0, 200));
  return true;
}

async function v2Health(env) {
  try {
    const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM projects").first();
    return { migrated: true, projects: row?.n ?? 0 };
  } catch {
    return { migrated: false, note: "Run the V2 migrations (see DEPLOY.md step G)." };
  }
}

/* ============================================================
   Auth routes. Deliberately outside the session gate — a person
   without a session has to be able to reach the login endpoint.
   ============================================================ */
async function handleAuthRoutes({ path, request, env, db }) {
  const ip = request.headers.get("cf-connecting-ip") || "";
  const userAgent = request.headers.get("user-agent") || "";

  if (path === "/api/auth/login" && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    try {
      const { token, user } = await auth.login(db, {
        username: body.username, password: body.password, ip, userAgent
      });
      return new Response(JSON.stringify({ ok: true, user }), {
        status: 200,
        headers: { "content-type": "application/json", "set-cookie": auth.sessionCookie(token) }
      });
    } catch (e) {
      // Same shape for every failure — never reveals whether the username exists.
      return json({ error: e.message || "Incorrect username or password." }, 401);
    }
  }

  if (path === "/api/auth/logout" && request.method === "POST") {
    const token = auth.parseCookies(request)[auth.SESSION_COOKIE];
    await auth.logout(db, token);
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json", "set-cookie": auth.clearedCookieHeader() }
    });
  }

  if (path === "/api/auth/me" && request.method === "GET") {
    const actor = await auth.identify(request, env, db);
    if (!actor) return json({ error: "Not signed in" }, 401);
    if (actor.kind === "legacy-admin")
      return json({ user: { role: "admin", username: "operator", legacy: true } });

    const user = await db.first("SELECT * FROM users WHERE id = ?", actor.userId);
    if (!user) return json({ error: "Not signed in" }, 401);
    const customer = user.customer_id
      ? await db.first("SELECT id, company_name, billing_cycle, billing_model FROM customers WHERE id = ?", user.customer_id)
      : null;
    return json({ user: auth.publicUser(user), customer });
  }

  if (path === "/api/auth/change-password" && request.method === "POST") {
    const actor = await auth.identify(request, env, db);
    if (!actor || !actor.userId) return json({ error: "Not signed in" }, 401);
    const body = await request.json().catch(() => ({}));
    const user = await db.first("SELECT * FROM users WHERE id = ?", actor.userId);
    if (!user) return json({ error: "Not signed in" }, 401);

    if (!(await auth.verifyPassword(body.currentPassword || "", user.password_hash)))
      return json({ error: "Your current password is incorrect." }, 400);
    try {
      await db.update("users", user.id, {
        password_hash: await auth.hashPassword(body.newPassword || ""),
        must_change_password: 0
      });
    } catch (e) {
      return json({ error: e.message }, 400);
    }
    // Every other session for this user is revoked, so a stolen cookie dies
    // the moment the real owner changes their password.
    await db.run(
      "UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND id != ?",
      new Date().toISOString(), user.id, actor.sessionId || ""
    );
    return json({ ok: true });
  }

  return json({ error: "Not found" }, 404);
}

/* Admin-only customer & user management (mounted under /api/admin/). */
async function handleAccountAdmin({ path, request, db }) {
  if (path === "/api/admin/customers" && request.method === "GET")
    return json(await db.all("SELECT * FROM customers ORDER BY company_name"));

  if (path === "/api/admin/customers" && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    try {
      const customer = await auth.createCustomer(db, body);
      // Optionally create the first login alongside the company, since a
      // customer with no user can't actually do anything.
      let user = null;
      if (body.username && body.password) {
        user = auth.publicUser(await auth.createUser(db, {
          username: body.username, password: body.password,
          role: "contractor", customerId: customer.id,
          email: body.email, fullName: body.contact_name,
          mustChangePassword: true
        }));
      }
      return json({ customer, user });
    } catch (e) { return json({ error: e.message }, 400); }
  }

  let m = path.match(/^\/api\/admin\/customers\/([\w-]+)$/);
  if (m && request.method === "PUT")
    return json(await db.update("customers", m[1], await request.json()));
  if (m && request.method === "GET") {
    const customer = await db.first("SELECT * FROM customers WHERE id = ?", m[1]);
    if (!customer) return json({ error: "Customer not found" }, 404);
    const users = await db.all(
      "SELECT id, username, email, full_name, role, is_active, last_login_at FROM users WHERE customer_id = ?", m[1]);
    return json({ ...customer, users });
  }

  if (path === "/api/admin/users" && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    try {
      return json(auth.publicUser(await auth.createUser(db, {
        username: body.username, password: body.password,
        role: body.role || "contractor", customerId: body.customerId || null,
        email: body.email, fullName: body.fullName, mustChangePassword: true
      })));
    } catch (e) { return json({ error: e.message }, 400); }
  }

  m = path.match(/^\/api\/admin\/users\/([\w-]+)\/reset-password$/);
  if (m && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    try {
      await db.update("users", m[1], {
        password_hash: await auth.hashPassword(body.password || ""),
        must_change_password: 1, failed_attempts: 0, locked_until: null
      });
      // Force re-login everywhere with the old password.
      await db.run("UPDATE sessions SET revoked_at = ? WHERE user_id = ?", new Date().toISOString(), m[1]);
      return json({ ok: true });
    } catch (e) { return json({ error: e.message }, 400); }
  }

  m = path.match(/^\/api\/admin\/users\/([\w-]+)$/);
  if (m && request.method === "PUT")
    return json(await db.update("users", m[1], await request.json()));

  return null;
}

/* ============================================================
   Portal routes — everything a signed-in contractor can reach.
   EVERY query is scoped by actor.customerId, taken from the session and
   never from the request. That is what prevents one contractor reading
   another's leads by editing a URL (spec §52).
   ============================================================ */
async function handlePortalRoutes({ path, request, env, db, actor }) {
  const customerId = actor.customerId;
  if (!customerId) return json({ error: "No customer on this account" }, 403);

  const ip = request.headers.get("cf-connecting-ip") || "";
  const userAgent = request.headers.get("user-agent") || "";
  const user = await db.first("SELECT username, full_name FROM users WHERE id = ?", actor.userId);
  const actorLabel = user?.full_name || user?.username || "contractor";
  const ctx = { userId: actor.userId, actorLabel, ip, userAgent };

  /* ---- the lead board ---- */
  if (path === "/api/portal/leads" && request.method === "GET") {
    const status = new URL(request.url).searchParams.get("status");
    let sql = `SELECT l.*, p.name AS project_name, p.city, p.state, p.bid_due,
                      p.general_contractor, p.architect, p.project_type,
                      p.estimated_glazing_square_feet, p.score_json
               FROM leads l JOIN projects p ON p.id = l.project_id
               WHERE l.customer_id = ?`;
    const binds = [customerId];
    if (status) { sql += " AND l.status = ?"; binds.push(status); }
    sql += " ORDER BY (p.bid_due IS NULL), p.bid_due ASC, l.delivered_at DESC LIMIT 300";
    const rows = await db.all(sql, ...binds);
    return json(rows.map(r => ({ ...r, actions: leadFlow.allowedActions(r.status) })));
  }

  /* ---- counts for the portal header ---- */
  if (path === "/api/portal/summary" && request.method === "GET") {
    const rows = await db.all(
      "SELECT status, COUNT(*) AS n, SUM(lead_price) AS value FROM leads WHERE customer_id = ? GROUP BY status",
      customerId);
    const byStatus = {};
    for (const r of rows) byStatus[r.status] = { count: r.n, value: r.value || 0 };

    // Running quarter-to-date charges, shown on every screen so a
    // quarterly invoice is never a surprise (spec §54).
    const now = new Date();
    const qStart = new Date(Date.UTC(now.getUTCFullYear(), Math.floor(now.getUTCMonth() / 3) * 3, 1)).toISOString();
    const qtd = await db.first(
      `SELECT COUNT(*) AS n, COALESCE(SUM(lead_price),0) AS amount
         FROM leads WHERE customer_id = ? AND billable_at IS NOT NULL AND billable_at >= ?`,
      customerId, qStart);
    return json({
      byStatus,
      quarterToDate: { since: qStart, billableLeads: qtd?.n || 0, amount: qtd?.amount || 0 }
    });
  }

  /* ---- one lead, with the full project intelligence ---- */
  let m = path.match(/^\/api\/portal\/leads\/([\w-]+)$/);
  if (m && request.method === "GET") {
    const lead = await db.first(
      "SELECT * FROM leads WHERE id = ? AND customer_id = ?", m[1], customerId);
    if (!lead) return json({ error: "Lead not found" }, 404);

    const updated = await leadFlow.recordView(db, lead, ctx);
    const [project, terms, customer] = await Promise.all([
      db.getProject(lead.project_id),
      leadFlow.activeTerms(db),
      db.first("SELECT * FROM customers WHERE id = ?", customerId)
    ]);

    const releaseLeft = leadFlow.releaseWindowRemaining(updated, customer);

    return json({
      lead: updated,
      project,
      actions: leadFlow.allowedActions(updated.status),
      // Non-null only while the lead can actually be handed back, so the
      // UI never offers a release that the server would refuse.
      release: releaseLeft === null ? null : {
        hoursRemaining: +releaseLeft.toFixed(1),
        reasons: leadFlow.RELEASE_REASONS
      },
      billingDisclosure: leadFlow.billingDisclosure(lead.billing_model, customer || {}),
      terms: terms ? { version: terms.version, body: terms.body } : null,
      timeline: leadFlow.buildTimeline(await leadFlow.getEvents(db, lead.id))
    });
  }

  /* ---- lifecycle actions ---- */
  m = path.match(/^\/api\/portal\/leads\/([\w-]+)\/(\w+)$/);
  if (m && request.method === "POST") {
    const [, leadRowId, action] = m;
    const lead = await db.first(
      "SELECT * FROM leads WHERE id = ? AND customer_id = ?", leadRowId, customerId);
    if (!lead) return json({ error: "Lead not found" }, 404);
    const body = await request.json().catch(() => ({}));

    try {
      if (action === "claim") {
        const terms = await leadFlow.activeTerms(db);
        const customer = await db.first("SELECT * FROM customers WHERE id = ?", customerId);
        // Refuse to record a claim unless the customer confirmed the terms
        // they were shown. A claim is a billable act; consent is the record
        // that makes it collectable.
        if (terms && !body.acceptTerms)
          return json({ error: "You must accept the lead terms to claim this opportunity.", terms: { version: terms.version, body: terms.body } }, 400);

        const updated = await leadFlow.claimLead(db, lead, {
          ...ctx,
          terms: terms ? {
            version: terms.version, hash: terms.content_hash, body: terms.body,
            disclosure: leadFlow.billingDisclosure(lead.billing_model, customer || {})
          } : null
        });
        return json({ ok: true, lead: updated, message: "You have claimed this opportunity." });
      }
      if (action === "pursuing")
        return json({ ok: true, lead: await leadFlow.markPursuing(db, lead, ctx) });
      if (action === "bid")
        return json({ ok: true, lead: await leadFlow.submitBid(db, lead, {
          ...ctx, amount: body.amount, bidDate: body.bidDate, notes: body.notes }) });
      if (action === "outcome")
        return json({ ok: true, lead: await leadFlow.reportOutcome(db, lead, {
          ...ctx, outcome: body.outcome, awardAmount: body.awardAmount,
          lossReason: body.lossReason, notes: body.notes }) });
      if (action === "decline")
        return json({ ok: true, lead: await leadFlow.declineLead(db, lead, { ...ctx, reason: body.reason }) });
      if (action === "reserve")
        return json({ ok: true, lead: await leadFlow.reserveLead(db, lead, { ...ctx, hours: body.hours || 48 }) });
      if (action === "release") {
        const customer = await db.first("SELECT * FROM customers WHERE id = ?", customerId);
        const updated = await leadFlow.releaseLead(db, lead, customer, {
          ...ctx, reason: body.reason, detail: body.detail
        });
        return json({ ok: true, lead: updated,
          message: "Released. You won't be charged for this lead." });
      }
    } catch (e) {
      return json({ error: e.message }, 400);
    }
    return json({ error: "Unknown action" }, 404);
  }

  return json({ error: "Not found" }, 404);
}

/* ============================================================
   Admin lead management + attribution.
   ============================================================ */
async function handleLeadAdmin({ path, request, db, actor }) {
  const actorLabel = actor.kind === "legacy-admin" ? "operator" : (actor.userId || "admin");

  if (path === "/api/admin/leads" && request.method === "GET") {
    const params = new URL(request.url).searchParams;
    let sql = `SELECT l.*, p.name AS project_name, p.bid_due, c.company_name
               FROM leads l JOIN projects p ON p.id = l.project_id
               JOIN customers c ON c.id = l.customer_id WHERE 1=1`;
    const binds = [];
    for (const [key, col] of [["status", "l.status"], ["customer", "l.customer_id"], ["billing", "l.billing_status"]]) {
      const v = params.get(key);
      if (v) { sql += ` AND ${col} = ?`; binds.push(v); }
    }
    const q = params.get("q");
    if (q) { sql += " AND (l.lead_id LIKE ? OR p.name LIKE ? OR c.company_name LIKE ?)"; binds.push(`%${q}%`, `%${q}%`, `%${q}%`); }
    sql += " ORDER BY l.delivered_at DESC LIMIT 500";
    return json(await db.all(sql, ...binds));
  }

  // Deliver a project to one or more customers.
  if (path === "/api/admin/leads/deliver" && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    const customerIds = body.customerIds || (body.customerId ? [body.customerId] : []);
    if (!body.projectId || !customerIds.length)
      return json({ error: "projectId and at least one customerId are required." }, 400);

    const delivered = [], failed = [];
    for (const customerId of customerIds) {
      try {
        const lead = await leadFlow.deliverLead(db, {
          projectId: body.projectId, customerId,
          exclusivity: body.exclusivity || "shared",
          attributionWindowDays: body.attributionWindowDays ?? 180,
          actorId: actor.userId, actorLabel,
          priceOverride: body.price ?? null
        });

        // Push into the customer's own CRM if they've configured a webhook.
        // A failure here is reported but never rolls back the delivery —
        // the lead exists in our database either way.
        const [proj, cust] = await Promise.all([
          db.first("SELECT * FROM projects WHERE id = ?", body.projectId),
          db.first("SELECT * FROM customers WHERE id = ?", customerId)
        ]);
        const hook = await webhooks.deliverWebhook(db, { lead, project: proj, customer: cust });

        delivered.push({ ...lead, webhook: hook });
      } catch (e) {
        failed.push({ customerId, error: e.message });
      }
    }
    // Partial success is reported honestly rather than as a blanket OK.
    return json({ delivered, failed, ok: failed.length === 0 });
  }

  /* ---- release rates by discovery source ----
     Which sources produce leads contractors claim and then hand back.
     This is the payoff for having a release window at all. */
  if (path === "/api/admin/leads/release-analytics" && request.method === "GET") {
    const since = new URL(request.url).searchParams.get("since");
    return json(await leadFlow.releaseAnalytics(db, { since }));
  }

  let m = path.match(/^\/api\/admin\/leads\/([\w-]+)\/attribution$/);
  if (m && request.method === "GET") {
    const lead = await db.first("SELECT * FROM leads WHERE id = ? OR lead_id = ?", m[1], m[1]);
    if (!lead) return json({ error: "Lead not found" }, 404);
    return json(await leadFlow.attributionRecord(db, lead));
  }

  m = path.match(/^\/api\/admin\/leads\/([\w-]+)$/);
  if (m && request.method === "GET") {
    const lead = await db.first("SELECT * FROM leads WHERE id = ? OR lead_id = ?", m[1], m[1]);
    if (!lead) return json({ error: "Lead not found" }, 404);
    const [project, customer, events] = await Promise.all([
      db.getProject(lead.project_id),
      db.first("SELECT * FROM customers WHERE id = ?", lead.customer_id),
      leadFlow.getEvents(db, lead.id)
    ]);
    return json({
      lead, project, customer,
      timeline: leadFlow.buildTimeline(events),
      confidence: leadFlow.attributionConfidence(events)
    });
  }

  // Void an event. The row is NEVER deleted (spec §47) — voiding writes a
  // marker plus an EVENT_VOIDED event, so the original stays visible.
  m = path.match(/^\/api\/admin\/lead-events\/([\w-]+)\/void$/);
  if (m && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    if (!body.reason) return json({ error: "A reason is required to void an event." }, 400);
    const ev = await db.first("SELECT * FROM lead_events WHERE id = ?", m[1]);
    if (!ev) return json({ error: "Event not found" }, 404);
    await db.run("UPDATE lead_events SET voided_at = ?, voided_by = ?, void_reason = ? WHERE id = ?",
      new Date().toISOString(), actor.userId || "operator", body.reason, m[1]);
    await leadFlow.appendEvent(db, {
      leadId: ev.lead_id, projectId: ev.project_id, customerId: ev.customer_id,
      eventType: "EVENT_VOIDED", actorType: "admin", actorId: actor.userId, actorLabel,
      metadata: { voided_event_id: ev.id, voided_event_type: ev.event_type, reason: body.reason }
    });
    // Status is recomputed from the surviving events.
    const events = await leadFlow.getEvents(db, ev.lead_id);
    await db.update("leads", ev.lead_id, { status: leadFlow.deriveStatus(events) });
    return json({ ok: true });
  }

  /* ---- live activity feed (spec §24) ---- */
  if (path === "/api/admin/activity" && request.method === "GET") {
    const rows = await db.all(
      `SELECT e.*, l.lead_id AS lead_number, p.name AS project_name, c.company_name
         FROM lead_events e
         JOIN leads l ON l.id = e.lead_id
         LEFT JOIN projects p ON p.id = e.project_id
         LEFT JOIN customers c ON c.id = e.customer_id
        ORDER BY e.created_at DESC LIMIT 100`);
    return json(rows);
  }

  /* ---- terms management (spec §38) ---- */
  // Webhook config lives on the customer record; this route also exposes
  // the delivery log so a silent failure is visible rather than assumed.
  let wm = path.match(/^\/api\/admin\/customers\/([\w-]+)\/webhook$/);
  if (wm && request.method === "PUT") {
    const body = await request.json().catch(() => ({}));
    const format = body.format || "generic";
    if (!["generic", "tinttechos"].includes(format))
      return json({ error: "format must be 'generic' or 'tinttechos'." }, 400);
    if (format === "tinttechos" && body.enabled && !body.authKey)
      return json({ error: "The TintOS format requires an intakeKey (authKey)." }, 400);

    await db.update("customers", wm[1], {
      webhook_url: body.url || null,
      webhook_secret: body.secret || null,
      webhook_format: format,
      webhook_auth_key: body.authKey || null,
      webhook_enabled: body.enabled ? 1 : 0
    });
    return json({ ok: true });
  }
  if (wm && request.method === "GET") {
    // webhook_secret and webhook_auth_key are never returned.
    const c = await db.first(
      "SELECT webhook_url, webhook_enabled, webhook_format FROM customers WHERE id = ?", wm[1]);
    const recent = await db.all(
      "SELECT id, lead_id, status, response_code, error, created_at FROM webhook_deliveries WHERE customer_id = ? ORDER BY created_at DESC LIMIT 25",
      wm[1]);
    return json({ ...c, recent });
  }

  if (path === "/api/admin/terms" && request.method === "GET")
    return json(await db.all("SELECT * FROM lead_terms_versions ORDER BY created_at DESC"));

  if (path === "/api/admin/terms" && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    if (!body.version || !body.body) return json({ error: "version and body are required." }, 400);
    const hash = await auth.sha256Hex(body.body);
    if (body.activate) await db.run("UPDATE lead_terms_versions SET is_active = 0");
    return json(await db.insert("lead_terms_versions", {
      version: body.version, body: body.body, content_hash: hash,
      is_active: body.activate ? 1 : 0, updated_at: new Date().toISOString()
    }));
  }

  return null;
}

export default {
  /* ================= HTTP ================= */
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const store = makeStore(env);

    // Email-ingest webhook is authenticated by its own token, not the login box
    // (so Zapier/Make can post to it): /api/ingest/email?token=APP_PASSWORD
    if (path === "/api/ingest/email" && request.method === "POST") {
      if (env.APP_PASSWORD && url.searchParams.get("token") !== env.APP_PASSWORD)
        return json({ error: "Bad token" }, 401);
      const body = await request.json().catch(() => ({}));
      const lead = emailToLead(body);
      const added = await saveLead(store, lead);
      return json({ ok: true, added, lead });
    }

    // Blue Book webhook notifications land here — same shared-token pattern as
    // the email ingest above: register https://YOUR-APP/api/ingest/bluebook?token=APP_PASSWORD
    // as the callback URL in Blue Book. See src/bluebook.js for the payload-mapping caveat.
    if (path === "/api/ingest/bluebook" && request.method === "POST") {
      if (env.APP_PASSWORD && url.searchParams.get("token") !== env.APP_PASSWORD)
        return json({ error: "Bad token" }, 401);
      const body = await request.json().catch(() => ({}));
      const lead = bluebookToLead(body);
      const added = await saveLead(store, lead);
      if (added) {
        const meta = (await store.get("meta")) || {};
        meta.bluebookLastReceived = new Date().toISOString();
        await store.set("meta", meta);
      }
      return json({ ok: true, added, lead });
    }

    /* ---- Authentication ----------------------------------------------
       Contractors log in with their own username/password and get a
       server-side session cookie. The operator's legacy APP_PASSWORD basic
       auth still works and is admin-equivalent, so existing bookmarks and
       the email-ingest token keep functioning. */
    const authDb = makeDb(env);

    if (path.startsWith("/api/auth/")) {
      return handleAuthRoutes({ path, request, env, db: authDb });
    }

    const actor = await auth.identify(request, env, authDb);

    if (!actor) {
      if (!path.startsWith("/api/")) return env.ASSETS.fetch(request);
      return json({ error: "Login required" }, 401);
    }

    // A contractor session may only reach portal routes. Single server-side
    // chokepoint preventing one customer reading another's data.
    if (actor.kind === "contractor" && path.startsWith("/api/") && !auth.contractorMayAccess(path)) {
      return json({ error: "Not authorized" }, 403);
    }

    if (!path.startsWith("/api/")) return env.ASSETS.fetch(request);

    try {
      /* ---- Opportunities ---- */
      if (path === "/api/opportunities" && request.method === "GET")
        return json((await store.get("opportunities")) || []);
      if (path === "/api/opportunities" && request.method === "POST") {
        const body = await request.json();
        const opp = { ...body, id: body.id || uid() };
        const all = (await store.get("opportunities")) || [];
        await store.set("opportunities", [opp, ...all]);
        return json(opp);
      }
      let m = path.match(/^\/api\/opportunities\/([\w-]+)$/);
      if (m && request.method === "PUT") {
        const body = await request.json();
        const all = (await store.get("opportunities")) || [];
        const i = all.findIndex(o => o.id === m[1]);
        const merged = { ...(i !== -1 ? all[i] : {}), ...body, id: m[1] };
        if (i === -1) all.unshift(merged); else all[i] = merged;
        await store.set("opportunities", all);
        return json(merged);
      }
      if (m && request.method === "DELETE") {
        const all = ((await store.get("opportunities")) || []).filter(o => o.id !== m[1]);
        await store.set("opportunities", all);
        const t = (await store.get("takeoffs")) || {}; delete t[m[1]]; await store.set("takeoffs", t);
        const p = (await store.get("proposals")) || {}; delete p[m[1]]; await store.set("proposals", p);
        return json({ ok: true });
      }

      /* ---- Contractors ---- */
      if (path === "/api/contractors" && request.method === "GET")
        return json((await store.get("contractors")) || []);
      if (path === "/api/contractors" && request.method === "POST") {
        const body = await request.json();
        const gc = { ...body, id: body.id || uid() };
        const all = (await store.get("contractors")) || [];
        await store.set("contractors", [gc, ...all]);
        return json(gc);
      }
      m = path.match(/^\/api\/contractors\/([\w-]+)$/);
      if (m && request.method === "PUT") {
        const body = await request.json();
        const all = (await store.get("contractors")) || [];
        const i = all.findIndex(g => g.id === m[1]);
        const merged = { ...(i !== -1 ? all[i] : {}), ...body, id: m[1] };
        if (i === -1) all.unshift(merged); else all[i] = merged;
        await store.set("contractors", all);
        return json(merged);
      }
      if (m && request.method === "DELETE") {
        await store.set("contractors", ((await store.get("contractors")) || []).filter(g => g.id !== m[1]));
        return json({ ok: true });
      }

      /* ---- Takeoffs & Proposals ---- */
      m = path.match(/^\/api\/takeoffs\/([\w-]+)$/);
      if (m && request.method === "GET") return json(((await store.get("takeoffs")) || {})[m[1]] || null);
      if (m && request.method === "PUT") {
        const t = (await store.get("takeoffs")) || {};
        t[m[1]] = await request.json();
        await store.set("takeoffs", t);
        return json(t[m[1]]);
      }
      m = path.match(/^\/api\/proposals\/([\w-]+)$/);
      if (m && request.method === "GET") return json({ text: ((await store.get("proposals")) || {})[m[1]] || "" });
      if (m && request.method === "PUT") {
        const p = (await store.get("proposals")) || {};
        p[m[1]] = (await request.json()).text || "";
        await store.set("proposals", p);
        return json({ ok: true });
      }

      /* ---- AI ---- */
      m = path.match(/^\/api\/ai\/score\/([\w-]+)$/);
      if (m && request.method === "POST") {
        const all = (await store.get("opportunities")) || [];
        const opp = all.find(o => o.id === m[1]);
        if (!opp) return json({ error: "Not found" }, 404);
        const score = await scoreOpportunity(env, opp);
        opp.score = score;
        await store.set("opportunities", all);
        return json(score);
      }
      m = path.match(/^\/api\/ai\/proposal\/([\w-]+)$/);
      if (m && request.method === "POST") {
        const all = (await store.get("opportunities")) || [];
        const opp = all.find(o => o.id === m[1]);
        if (!opp) return json({ error: "Not found" }, 404);
        const { takeoff, computed } = await request.json();
        const text = await generateProposal(env, { opp, takeoff, computed });
        const p = (await store.get("proposals")) || {};
        p[opp.id] = text;
        await store.set("proposals", p);
        return json({ text });
      }

      /* ---- Blueprint Copilot ---- */
      if (path === "/api/blueprint/upload" && request.method === "POST") {
        const fd = await request.formData();
        const file = fd.get("file");
        if (!file || typeof file === "string") return json({ error: "No file received" }, 400);
        const invalid = validateUpload(file);
        if (invalid) return json({ error: invalid }, 400);
        const isPdf = file.type === "application/pdf" || (file.name || "").toLowerCase().endsWith(".pdf");
        const docId = uid();
        const doc = {
          name: file.name, media: isPdf ? "application/pdf" : file.type,
          kind: isPdf ? "document" : "image", base64: b64(await file.arrayBuffer())
        };
        await env.BLUEPRINTS.put(docId, JSON.stringify(doc), { expirationTtl: 86400 });
        return json({ docId, name: file.name, size: file.size });
      }
      if (path === "/api/ai/blueprint" && request.method === "POST") {
        const { docId, messages } = await request.json();
        const raw = await env.BLUEPRINTS.get(docId);
        if (!raw) return json({ error: "Blueprint expired from storage (kept 24h) — re-upload the file." }, 410);
        const text = await blueprintChat(env, { doc: JSON.parse(raw), messages });
        return json({ text });
      }

      /* ---- Discovery ---- */
      if (path === "/api/discovery/leads" && request.method === "GET")
        return json((await store.get("discovered")) || []);
      if (path === "/api/discovery/run" && request.method === "POST")
        return json(await runDiscovery(env, store));
      m = path.match(/^\/api\/discovery\/import\/([\w-]+)$/);
      if (m && request.method === "POST") {
        const discovered = (await store.get("discovered")) || [];
        const lead = discovered.find(l => l.id === m[1]);
        if (!lead) return json({ error: "Not found" }, 404);
        const opp = leadToOpportunity(lead);
        const all = (await store.get("opportunities")) || [];
        await store.set("opportunities", [opp, ...all]);
        await store.set("discovered", discovered.filter(l => l.id !== m[1]));
        return json(opp);
      }
      m = path.match(/^\/api\/discovery\/leads\/([\w-]+)$/);
      if (m && request.method === "DELETE") {
        const discovered = (await store.get("discovered")) || [];
        const lead = discovered.find(l => l.id === m[1]);
        if (lead) {
          const dismissed = (await store.get("dismissed")) || [];
          dismissed.push((lead.source + "|" + lead.title).toLowerCase());
          await store.set("dismissed", dismissed.slice(-500));
        }
        await store.set("discovered", discovered.filter(l => l.id !== m[1]));
        return json({ ok: true });
      }

      /* ---- BuildingConnected (Autodesk) — three-legged OAuth, see src/buildingconnected.js ---- */
      if (path === "/api/integrations/buildingconnected/connect" && request.method === "GET") {
        if (!env.BC_CLIENT_ID) return json({ error: "BC_CLIENT_ID is not set — see DEPLOY.md step L." }, 400);
        return Response.redirect(buildAuthorizeUrl(env), 302);
      }
      if (path === "/api/integrations/buildingconnected/callback" && request.method === "GET") {
        const oauthErr = url.searchParams.get("error");
        if (oauthErr) return json({ error: "Autodesk declined: " + oauthErr }, 400);
        const code = url.searchParams.get("code");
        if (!code) return json({ error: "Missing authorization code" }, 400);
        const tok = await exchangeCode(env, code);
        await store.set("bc_tokens", tok);
        return Response.redirect((env.APP_URL || "/") + "#health", 302);
      }
      if (path === "/api/integrations/buildingconnected/sync" && request.method === "POST") {
        const token = await ensureAccessToken(env, store);
        if (!token) return json({ error: "Not connected yet — tap Connect BuildingConnected first." }, 400);
        const meta = (await store.get("meta")) || {};
        // After the first sync, only ask BuildingConnected for what changed
        // since last time (filter[updatedAt]=<iso>..) instead of refetching
        // every project on the account each run.
        const leads = await fetchProjectLeads(env, token, { updatedSince: meta.bcLastSync || null });
        let added = 0;
        for (const lead of leads) { if (await saveLead(store, lead)) added++; }
        meta.bcLastSync = new Date().toISOString();
        await store.set("meta", meta);
        return json({ ok: true, found: leads.length, added });
      }

      /* ---- Contractor portal (Phase C) ---- */
      if (path.startsWith("/api/portal/")) {
        return handlePortalRoutes({ path, request, env, db: makeDb(env), actor });
      }

      /* ---- Admin: leads & attribution (Phase B) ---- */
      if (path.startsWith("/api/admin/leads") || path.startsWith("/api/admin/lead-events")
          || path === "/api/admin/activity" || path === "/api/admin/terms") {
        const handled = await handleLeadAdmin({ path, request, db: makeDb(env), actor });
        if (handled) return handled;
      }

      /* ---- Admin: customers & logins (Phase A) ---- */
      if (path.startsWith("/api/admin/customers") || path.startsWith("/api/admin/users")) {
        const handled = await handleAccountAdmin({ path, request, db: makeDb(env) });
        if (handled) return handled;
      }

      /* ================= V2 ROUTES ================= */
      if (path.startsWith("/api/v2/") || path === "/api/admin/migrate-v2" || path === "/api/config") {
        const db = makeDb(env);

        if (path === "/api/config")
          return ok({ maxDocumentSize: MAX_DOCUMENT_SIZE, allowedMime: ALLOWED_MIME, readinessItems: READINESS_ITEMS });

        // --- one-time (idempotent) migration of legacy KV data ---
        if (path === "/api/admin/migrate-v2" && request.method === "POST")
          return ok(await migrateKvToV2(env, store));

        // --- projects ---
        if (path === "/api/v2/projects" && request.method === "GET")
          return ok(await db.listProjects({
            status: url.searchParams.get("status") || undefined,
            state: url.searchParams.get("state") || undefined
          }));
        if (path === "/api/v2/projects" && request.method === "POST") {
          const body = await request.json();
          if (!body.name) return fail("Project name is required");
          const r = await db.upsertProject(body);
          return ok(r);
        }

        let pm = path.match(/^\/api\/v2\/projects\/([\w-]+)$/);
        if (pm && request.method === "GET") {
          const p = await db.getProject(pm[1]);
          return p ? ok(p) : fail("Project not found", 404);
        }
        if (pm && request.method === "PUT")
          return ok(await db.update("projects", pm[1], await request.json()));
        if (pm && request.method === "DELETE")
          return ok(await db.remove("projects", pm[1]));

        // --- child collections (generic list/create) ---
        const CHILD = {
          documents: "project_documents", film: "film_scope", glazing: "glazing_items",
          contacts: "project_contacts", rfis: "rfis", addenda: "addenda",   // GET/POST only
          risks: "project_risks", bids: "bids"
          // NOTE: 'checklist' is deliberately NOT here. It has its own route that
          // computes auto-verified items; the generic handler would shadow it and
          // return raw rows instead.
        };
        pm = path.match(/^\/api\/v2\/projects\/([\w-]+)\/(\w+)$/);
        if (pm && CHILD[pm[2]]) {
          const [, projectId, key] = pm;
          const table = CHILD[key];
          if (request.method === "GET")
            return ok(await db.all(`SELECT * FROM ${table} WHERE project_id = ?`, projectId));
          if (request.method === "POST")
            return ok(await db.insert(table, { ...(await request.json()), project_id: projectId }));
        }

        // --- deterministic takeoff from stored glazing items ---
        pm = path.match(/^\/api\/v2\/projects\/([\w-]+)\/takeoff$/);
        if (pm && request.method === "POST") {
          const body = await request.json().catch(() => ({}));
          const items = body.items || await db.all("SELECT * FROM glazing_items WHERE project_id = ?", pm[1]);
          const result = computeTakeoff(items, {
            wastePercent: body.wastePercent, coveragePercent: body.coveragePercent
          });
          const row = await db.insert("takeoffs", {
            project_id: pm[1], name: body.name || "Takeoff",
            total_glazing_sf: result.totalGlazingSf, total_film_sf: result.filmSf,
            waste_percent: result.wastePercent, waste_sf: result.wasteSf,
            total_material_sf: result.materialSf, confidence: result.confidence,
            status: "calculated", inputs_json: JSON.stringify(body), updated_at: new Date().toISOString()
          });
          return ok({ ...result, takeoffId: row.id });
        }

        // --- deterministic pricing ---
        pm = path.match(/^\/api\/v2\/projects\/([\w-]+)\/pricing$/);
        if (pm && request.method === "POST") {
          const body = await request.json();
          let inputs = body;
          if (body.pricingProfileId) {
            const pp = await db.first("SELECT * FROM pricing_profiles WHERE id = ?", body.pricingProfileId);
            if (pp) inputs = {
              materialCostPerSf: pp.material_cost_per_sf,
              laborHoursPer100Sf: pp.labor_hours_per_100sf,
              laborCostPerHour: pp.labor_cost_per_hour,
              equipmentCost: pp.equipment_cost_per_job,
              mobilizationCost: pp.mobilization_cost,
              overheadPercent: pp.default_overhead_percent,
              profitPercent: pp.default_profit_percent,
              ...body
            };
          }
          return ok({ pricing: computePricing(inputs), scenarios: pricingScenarios(inputs) });
        }
        if (path === "/api/v2/pricing-profiles" && request.method === "GET")
          return ok(await db.all("SELECT * FROM pricing_profiles WHERE active = 1"));

        // --- deterministic score + recommendation + readiness ---
        pm = path.match(/^\/api\/v2\/projects\/([\w-]+)\/score$/);
        if (pm && request.method === "POST") {
          const extra = await request.json().catch(() => ({}));
          const score = await db.scoreProject(pm[1], extra);
          if (!score) return fail("Project not found", 404);
          return ok({ score, recommendation: bidRecommendation(score) });
        }
        pm = path.match(/^\/api\/v2\/projects\/([\w-]+)\/readiness$/);
        if (pm && request.method === "GET") {
          const p = await db.getProject(pm[1]);
          if (!p) return fail("Project not found", 404);
          return ok(computeBidReadiness({
            projectIdentified: Boolean(p.name),
            gcIdentified: Boolean(p.general_contractor),
            architectIdentified: Boolean(p.architect),
            bidDateVerified: Boolean(p.bid_due),
            addendaReviewed: (p.addenda || []).length > 0,
            filmScopeIdentified: (p.filmScope || []).length > 0,
            // Quantities count whether they came from a saved takeoff OR from
            // glazing lines with usable dimensions (the workbench totals live).
            quantitiesEstimated: (p.takeoffs || []).some(t => t.total_film_sf > 0)
              || (p.glazing || []).some(g => Number(g.area_sf) > 0),
            filmProductsIdentified: (p.filmScope || []).some(f => f.product),
            pricingComplete: (p.bids || []).some(b => b.bid_amount > 0),
            exclusionsReviewed: Boolean(((await store.get("proposals")) || {})[p.id]),
            rfisResolved: (p.rfis || []).every(r => r.status !== "Open"),
            proposalGenerated: Boolean(((await store.get("proposals")) || {})[p.id])
          }));
        }

        // --- bid result (win/loss learning loop) ---
        pm = path.match(/^\/api\/v2\/projects\/([\w-]+)\/result$/);
        if (pm && request.method === "POST") {
          const body = await request.json();
          const latestBid = await db.first(
            "SELECT id FROM bids WHERE project_id = ? ORDER BY created_at DESC", pm[1]);
          const film = await db.first("SELECT film_type FROM film_scope WHERE project_id = ?", pm[1]);
          const allowed = ["result", "competitor", "winning_price", "reason", "notes",
            "actual_sf", "actual_labor_hours", "actual_material_cost", "actual_labor_cost",
            "actual_equipment_cost", "contract_price"];
          const clean = {};
          for (const k of allowed) if (body[k] !== undefined && body[k] !== null) clean[k] = body[k];
          const row = await db.insert("bid_results", {
            ...clean,
            bid_id: latestBid?.id || null,
            project_id: pm[1],
            film_type: body.film_type || film?.film_type || null,
            awarded_at: body.awarded_at || new Date().toISOString().slice(0, 10)
          });
          const statusMap = { Won: "Awarded", Lost: "Lost", Cancelled: "Cancelled", "No Decision": "No Decision" };
          if (statusMap[body.result]) await db.update("projects", pm[1], { status: statusMap[body.result] });
          return ok(row);
        }

        // --- companies ---
        if (path === "/api/v2/companies" && request.method === "GET")
          return ok(await db.all("SELECT * FROM companies ORDER BY relationship_score DESC"));
        if (path === "/api/v2/companies" && request.method === "POST")
          return ok(await db.insert("companies", await request.json()));

        // --- analytics ---
        if (path === "/api/v2/analytics/dashboard") {
          const projects = await db.all("SELECT * FROM projects");
          const results = await db.all("SELECT * FROM bid_results");
          const decided = results.filter(r => ["Won", "Lost"].includes(r.result));
          const won = decided.filter(r => r.result === "Won");
          const active = projects.filter(p => !["Lost", "Cancelled", "Archived", "No Decision"].includes(p.status));
          return ok({
            activeProjects: active.length,
            hotOpportunities: active.filter(p => (safeScore(p)?.total || 0) >= 70).length,
            bidsDueThisWeek: active.filter(p => {
              const d = daysUntil(p.bid_due);
              return d !== null && d >= 0 && d <= 7;
            }).length,
            pipelineValue: active.reduce((s, p) => s + (Number(p.estimated_project_value) || 0), 0),
            totalBids: decided.length,
            won: won.length,
            lost: decided.length - won.length,
            winRate: decided.length ? Math.round(won.length / decided.length * 100) : null,
            note: decided.length < 5 ? "Fewer than 5 decided bids — win-rate figures are not yet statistically meaningful." : null
          });
        }

        // --- document text analysis (deterministic pre-filter, no AI cost) ---
        if (path === "/api/v2/documents/scan" && request.method === "POST") {
          const { text } = await request.json();
          const det = detectFilmTerms(text);
          return ok({ ...det, classification: classifySheetText(text), confidence: confidenceLabel(det.relevance) });
        }

        // --- R2 document upload (metadata in D1, file in R2) ---
        if (path === "/api/v2/documents/upload" && request.method === "POST") {
          if (!env.DOCUMENTS) return fail("R2 bucket not configured yet. See DEPLOY.md step G.", 501);
          const fd = await request.formData();
          const file = fd.get("file");
          const projectId = fd.get("projectId");
          const invalid = validateUpload(file);
          if (invalid) return fail(invalid);
          if (!projectId) return fail("projectId is required");
          const buf = await file.arrayBuffer();
          const hash = await sha256Hex(buf);
          const dupe = await db.first("SELECT * FROM project_documents WHERE project_id = ? AND hash = ?", projectId, hash);
          if (dupe) return ok({ ...dupe, duplicate: true });
          const storageKey = `${projectId}/${hash}-${file.name}`;
          await env.DOCUMENTS.put(storageKey, buf, { httpMetadata: { contentType: file.type } });
          const row = await db.insert("project_documents", {
            project_id: projectId, filename: file.name,
            document_type: fd.get("documentType") || "other",
            storage_key: storageKey, mime_type: file.type, file_size: file.size,
            hash, status: "stored", processing_status: "pending",
            uploaded_at: new Date().toISOString()
          });
          return ok(row);
        }
        pm = path.match(/^\/api\/v2\/documents\/([\w-]+)\/download$/);
        if (pm && request.method === "GET") {
          if (!env.DOCUMENTS) return fail("R2 bucket not configured", 501);
          const doc = await db.first("SELECT * FROM project_documents WHERE id = ?", pm[1]);
          if (!doc) return fail("Document not found", 404);
          const obj = await env.DOCUMENTS.get(doc.storage_key);
          if (!obj) return fail("File missing from storage", 404);
          return new Response(obj.body, { headers: { "content-type": doc.mime_type || "application/octet-stream" } });
        }

        // --- discovery sources status ---
        if (path === "/api/v2/discovery/sources")
          return ok(await db.all("SELECT * FROM discovery_sources"));

        /* ---------- MARKET + TERRITORY + NOTIFICATIONS ---------- */

        if (path === "/api/v2/market" && request.method === "GET") {
          const [projects, filmScope, bidRows, results] = await Promise.all([
            db.all("SELECT * FROM projects"),
            db.all("SELECT project_id, film_type, quantity_sf FROM film_scope"),
            db.all("SELECT project_id, bid_amount FROM bids ORDER BY created_at DESC"),
            db.all("SELECT project_id, result FROM bid_results")
          ]);
          return ok({
            market: buildMarketIntel({ projects, filmScope, bids: bidRows, results }),
            territories: buildTerritories({ projects, filmScope, bids: bidRows })
          });
        }

        if (path === "/api/v2/notifications" && request.method === "GET") {
          const [projects, followupRows, addendaRows, results] = await Promise.all([
            db.all("SELECT * FROM projects"),
            db.all("SELECT * FROM followups WHERE status = 'Open'"),
            db.all("SELECT * FROM addenda"),
            db.all("SELECT project_id FROM bid_results")
          ]);
          return ok(buildNotifications({ projects, followups: followupRows, addenda: addendaRows, results }));
        }

        // WIN THIS JOB — pursuit strategy grounded in stored evidence
        pm = path.match(/^\/api\/v2\/projects\/([\w-]+)\/win-strategy$/);
        if (pm && request.method === "POST") {
          const p = await db.getProject(pm[1]);
          if (!p) return fail("Project not found", 404);
          const bid = (p.bids || [])[0] || null;

          // our real history with this GC — never invented
          let gcHistory = null;
          if (p.general_contractor) {
            const rows = await db.all(
              `SELECT br.result, b.bid_amount, b.gross_margin
               FROM bid_results br
               LEFT JOIN projects pr ON pr.id = br.project_id
               LEFT JOIN bids b ON b.id = br.bid_id
               WHERE pr.general_contractor = ?`, p.general_contractor);
            const decided = rows.filter(r => ["Won", "Lost"].includes(r.result));
            gcHistory = decided.length
              ? { bids: decided.length, wins: decided.filter(r => r.result === "Won").length,
                  reliable: decided.length >= 5,
                  note: decided.length >= 5 ? null : "Fewer than 5 decided bids with this GC — not a reliable pattern." }
              : { bids: 0, wins: 0, reliable: false, note: "No bid history with this GC yet." };
          }

          const hidden = detectHiddenTintScope(
            [p.name, p.project_type, p.notes].filter(Boolean).join(" "),
            { filmAlreadySpecified: (p.filmScope || []).some(f => f.spec_section),
              knownGlazingSf: (p.glazing || []).reduce((s2, g) => s2 + (Number(g.area_sf) || 0), 0) || null,
              buildingSf: p.building_square_feet || null });

          const res = await winThisJob(env, {
            project: p,
            bid: bid ? { bidPrice: bid.bid_amount, margin: bid.gross_margin, grossProfit: bid.gross_profit } : null,
            filmScope: (p.filmScope || []).map(f => ({ type: f.film_type, spec: f.spec_section,
              manufacturer: f.manufacturer, sheet: f.sheet, sf: f.quantity_sf })),
            risks: (p.risks || []).map(r => ({ severity: r.severity, title: r.title })),
            contacts: (p.contacts || []).map(c => ({ name: c.name, role: c.role })),
            gcHistory, hidden: hidden.hidden ? hidden : null
          });
          if (!res.ok) return fail(res.error, 502);

          await db.insert("ai_analysis", {
            project_id: pm[1], analysis_type: "bid_recommendation",
            model: "claude-sonnet-4-6", prompt_version: "win-v2.5",
            result_json: JSON.stringify(res.json), confidence: null
          });
          return ok({ ...res.json, gcHistory, hasBid: Boolean(bid) });
        }

        /* ---------- ARCHITECT INTELLIGENCE + SPEC HUNTER ---------- */

        if (path === "/api/v2/architects" && request.method === "GET") {
          const [projects, film] = await Promise.all([
            db.all("SELECT * FROM projects"),
            db.all("SELECT project_id, film_type, spec_section, manufacturer FROM film_scope")
          ]);
          const profiles = buildArchitectProfiles(projects, film);
          return ok({
            profiles,
            count: profiles.length,
            note: profiles.length ? null
              : "No architects on record yet. Architects come from bid documents — add one on a project's Overview and this fills in."
          });
        }

        if (path === "/api/v2/spec-hunter" && request.method === "GET") {
          const [projects, film, saved] = await Promise.all([
            db.all("SELECT * FROM projects"),
            db.all("SELECT project_id, film_type, spec_section, manufacturer FROM film_scope"),
            db.all("SELECT * FROM specification_opportunities WHERE status = 'Open'")
          ]);
          const profiles = buildArchitectProfiles(projects, film);
          const found = findSpecificationOpportunities(profiles, projects);
          return ok({
            opportunities: found, saved, profiles: profiles.slice(0, 10),
            note: found.length ? null
              : "No specification opportunities yet. These appear when an architect is named on a project still in Planning, Design, or Permitting — that's the window where film can still be written into the spec."
          });
        }

        if (path === "/api/v2/spec-opportunities" && request.method === "POST")
          return ok(await db.insert("specification_opportunities", await request.json()));
        pm = path.match(/^\/api\/v2\/spec-opportunities\/([\w-]+)$/);
        if (pm && request.method === "PUT")
          return ok(await db.update("specification_opportunities", pm[1], await request.json()));

        /* ---------- JOB COSTING ---------- */

        pm = path.match(/^\/api\/v2\/projects\/([\w-]+)\/job-cost$/);
        if (pm && request.method === "GET") {
          const p = await db.first("SELECT * FROM projects WHERE id = ?", pm[1]);
          if (!p) return fail("Project not found", 404);
          const bid = await db.first("SELECT * FROM bids WHERE project_id = ? ORDER BY created_at DESC", pm[1]);
          const rows = await db.all("SELECT * FROM job_costs WHERE project_id = ?", pm[1]);
          const estimated = {
            material: bid?.material_cost ?? null, labor: bid?.labor_cost ?? null,
            equipment: bid?.equipment_cost ?? null, mobilization: bid?.mobilization_cost ?? null,
            other: bid?.other_cost ?? null, contractPrice: bid?.bid_amount ?? null
          };
          const actual = { contractPrice: null };
          for (const r of rows) {
            if (r.actual != null) actual[r.category] = r.actual;
            if (r.category === "contract" && r.actual != null) actual.contractPrice = r.actual;
          }
          if (actual.contractPrice == null) actual.contractPrice = estimated.contractPrice;
          const jc = computeJobCost(estimated, actual);
          return ok({ ...jc, insights: explainVariance(jc), bidId: bid?.id || null,
            hasBid: Boolean(bid),
            note: bid ? jc.note : "No bid on record yet — run BUILD MY BID first so there's an estimate to compare against." });
        }
        if (pm && request.method === "POST") {
          const body = await request.json();
          if (!COST_CATEGORIES.includes(body.category) && body.category !== "contract")
            return fail("Unknown cost category: " + body.category);
          const existing = await db.first("SELECT * FROM job_costs WHERE project_id = ? AND category = ?", pm[1], body.category);
          const row = { project_id: pm[1], category: body.category,
            estimated: body.estimated ?? null, actual: body.actual ?? null,
            notes: body.notes || null, recorded_at: new Date().toISOString().slice(0, 10) };
          const saved = existing ? await db.update("job_costs", existing.id, row) : await db.insert("job_costs", row);
          return ok(saved);
        }

        if (path === "/api/v2/job-costs/trends" && request.method === "GET") {
          const rows = await db.all("SELECT * FROM job_costs WHERE actual IS NOT NULL AND estimated IS NOT NULL");
          return ok({ trends: costTrends(rows), sample: rows.length,
            note: rows.length ? null : "No completed job costs yet. Record actuals after a job and your estimates start correcting themselves." });
        }

        /* ---------- PURSUIT: verification, contacts, outreach, follow-ups ---------- */

        // Estimator verification — the AI value is never overwritten
        pm = path.match(/^\/api\/v2\/projects\/([\w-]+)\/verify$/);
        if (pm && request.method === "POST") {
          const { entityType, entityId, field, verifiedValue, notes, verifiedBy } = await request.json();
          if (!entityId) return fail("entityId is required");
          const table = { glazing_item: "glazing_items", film_scope: "film_scope" }[entityType];
          if (!table) return fail("Unknown entity type: " + entityType);
          const row = await db.first(`SELECT * FROM ${table} WHERE id = ?`, entityId);
          if (!row) return fail("Item not found", 404);

          const aiField = field || (entityType === "glazing_item" ? "area_sf" : "quantity_sf");
          const v = buildVerification({
            aiValue: row[aiField], verifiedValue, field: aiField,
            verifiedBy: verifiedBy || "Estimator", notes
          });
          if (!v.ok) return fail(v.error);

          // Audit trail first — this record is permanent
          const evt = await db.insert("verification_events", {
            project_id: pm[1], entity_type: entityType, entity_id: entityId,
            field: aiField, ai_value: String(v.aiValue ?? ""), verified_value: String(v.verifiedValue),
            difference: v.difference, verified_by: v.verifiedBy, notes: v.notes || null
          });
          // Then apply, flagged as an override
          const patch = { [aiField]: v.verifiedValue, estimator_override: 1 };
          if (entityType === "glazing_item") {
            patch.calculation = `Estimator verified: ${v.verifiedValue.toLocaleString()} SF` +
              (v.aiValue != null ? ` (AI estimated ${v.aiValue.toLocaleString()})` : "");
            patch.confidence = 100;
          }
          await db.update(table, entityId, patch);
          return ok({ ...v, eventId: evt.id });
        }

        pm = path.match(/^\/api\/v2\/projects\/([\w-]+)\/verifications$/);
        if (pm && request.method === "GET") {
          const events = await db.all("SELECT * FROM verification_events WHERE project_id = ? ORDER BY created_at DESC", pm[1]);
          return ok({ events, accuracy: verificationAccuracy(events) });
        }
        if (path === "/api/v2/verifications/accuracy" && request.method === "GET") {
          const events = await db.all("SELECT * FROM verification_events");
          return ok(verificationAccuracy(events));
        }

        // Who should I call?
        pm = path.match(/^\/api\/v2\/projects\/([\w-]+)\/best-contact$/);
        if (pm && request.method === "GET") {
          const p = await db.first("SELECT * FROM projects WHERE id = ?", pm[1]);
          if (!p) return fail("Project not found", 404);
          const contacts = await db.all("SELECT * FROM project_contacts WHERE project_id = ?", pm[1]);
          const ranked = rankContacts(contacts, { projectStage: p.stage });
          const best = pickBestContact(contacts, { projectStage: p.stage });
          if (!best) {
            // fall back to the GC company record — never invent a person
            const co = p.general_contractor
              ? await db.first("SELECT * FROM companies WHERE name = ?", p.general_contractor) : null;
            return ok({
              best: co ? { name: co.name, role: "Company (no named contact)", phone: co.phone, email: co.email,
                priority: "MEDIUM", reason: "No individual contact on record — start with the company's bid desk.",
                canEmail: Boolean(co.email), canCall: Boolean(co.phone) } : null,
              ranked: [],
              note: co ? null : "No contacts on record. Add one from the bid documents — the app will never invent contact details."
            });
          }
          return ok({ best, ranked });
        }

        // Outreach — always a draft, never sent
        pm = path.match(/^\/api\/v2\/projects\/([\w-]+)\/outreach$/);
        if (pm && request.method === "GET")
          return ok(await db.all("SELECT * FROM outreach WHERE project_id = ? ORDER BY created_at DESC", pm[1]));
        if (pm && request.method === "POST") {
          const body = await request.json().catch(() => ({}));
          const p = await db.getProject(pm[1]);
          if (!p) return fail("Project not found", 404);
          const contacts = await db.all("SELECT * FROM project_contacts WHERE project_id = ?", pm[1]);
          const contact = body.contactId
            ? contacts.find(c => c.id === body.contactId)
            : pickBestContact(contacts, { projectStage: p.stage });
          const hidden = detectHiddenTintScope(
            [p.name, p.project_type, p.notes].filter(Boolean).join(" "),
            { filmAlreadySpecified: (p.filmScope || []).some(f => f.spec_section),
              knownGlazingSf: (p.glazing || []).reduce((s2, g) => s2 + (Number(g.area_sf) || 0), 0) || null,
              buildingSf: p.building_square_feet || null });

          const res = await generateOutreach(env, {
            project: p, contact, purpose: body.purpose || "intro",
            channel: body.channel || "email",
            filmScope: (p.filmScope || []).map(f => ({ type: f.film_type, spec: f.spec_section, sheet: f.sheet })),
            hidden: hidden.hidden ? hidden : null
          });
          if (!res.ok) return fail(res.error, 502);

          const row = await db.insert("outreach", {
            project_id: pm[1], contact_id: contact?.id || null,
            channel: body.channel || "email", purpose: body.purpose || "intro",
            subject: res.json.subject || null, body: res.json.body || "",
            status: "Draft", model: "claude-sonnet-4-6", prompt_version: "outreach-v2.5"
          });
          return ok({ ...row, talkingPoints: res.json.talkingPoints || [], ask: res.json.ask || null,
                      contact: contact || null,
                      note: "Draft only — nothing is sent automatically. Copy it into your email when you're ready." });
        }
        pm = path.match(/^\/api\/v2\/outreach\/([\w-]+)$/);
        if (pm && request.method === "PUT") {
          const body = await request.json();
          if (body.status === "Sent" && !body.sent_at) body.sent_at = new Date().toISOString();
          return ok(await db.update("outreach", pm[1], body));
        }

        // Follow-ups
        pm = path.match(/^\/api\/v2\/projects\/([\w-]+)\/followups$/);
        if (pm && request.method === "POST") {
          const body = await request.json().catch(() => ({}));
          const p = await db.first("SELECT * FROM projects WHERE id = ?", pm[1]);
          if (!p) return fail("Project not found", 404);
          if (body.action) {   // a single manual task
            const row = await db.insert("followups", {
              project_id: pm[1], action: body.action, reason: body.reason || null,
              contact_name: body.contactName || null, due_date: body.dueDate || null, status: "Open"
            });
            return ok({ created: 1, followups: [row] });
          }
          const planned = scheduleFollowups({
            projectId: pm[1], bidDue: p.bid_due,
            contactName: body.contactName || null, outreachId: body.outreachId || null
          });
          const existing = await db.all("SELECT * FROM followups WHERE project_id = ? AND auto_generated = 1", pm[1]);
          const have = new Set(existing.map(e => e.action + "|" + e.due_date));
          const created = [];
          for (const f of planned) {
            if (have.has(f.action + "|" + f.due_date)) continue;   // idempotent
            const { key, ...row } = f;
            created.push(await db.insert("followups", row));
          }
          return ok({ created: created.length, skipped: planned.length - created.length, followups: created });
        }
        if (path === "/api/v2/followups" && request.method === "GET") {
          const rows = await db.all(
            `SELECT f.*, p.name AS project_name FROM followups f
             LEFT JOIN projects p ON p.id = f.project_id
             ORDER BY (f.due_date IS NULL), f.due_date LIMIT 300`);
          return ok(groupFollowups(rows));
        }
        pm = path.match(/^\/api\/v2\/followups\/([\w-]+)$/);
        if (pm && request.method === "PUT") {
          const body = await request.json();
          if (body.status === "Done" && !body.completed_at) body.completed_at = new Date().toISOString();
          return ok(await db.update("followups", pm[1], body));
        }
        if (pm && request.method === "DELETE") return ok(await db.remove("followups", pm[1]));

        /* ---------- V2.5: hidden tint scope + BUILD MY BID ---------- */

        // Hidden tint opportunity for one project — glazing with no film named
        pm = path.match(/^\/api\/v2\/projects\/([\w-]+)\/hidden$/);
        if (pm && request.method === "GET") {
          const p = await db.getProject(pm[1]);
          if (!p) return fail("Project not found", 404);
          const sheets = await db.all(
            "SELECT substr(text_content,1,2000) AS t FROM project_sheets WHERE project_id = ? ORDER BY relevance_score DESC LIMIT 25", pm[1]);
          const text = [p.name, p.project_type, p.notes, ...sheets.map(s => s.t)].filter(Boolean).join(" ");
          const measuredGlazing = (p.glazing || []).reduce((s2, g) => s2 + (Number(g.area_sf) || 0), 0);
          return ok(detectHiddenTintScope(text, {
            filmAlreadySpecified: (p.filmScope || []).some(f => f.spec_section),
            knownGlazingSf: measuredGlazing || null,
            buildingSf: p.building_square_feet || null
          }));
        }

        // Money Radar — every open project ranked by hidden film opportunity
        if (path === "/api/v2/money-radar" && request.method === "GET") {
          const projects = await db.all(
            "SELECT * FROM projects WHERE status NOT IN ('Lost','Cancelled','Archived','Completed') LIMIT 150");
          const out = [];
          for (const p of projects) {
            const film = await db.all("SELECT film_type, spec_section, quantity_sf FROM film_scope WHERE project_id = ?", p.id);
            const glaz = await db.all("SELECT area_sf FROM glazing_items WHERE project_id = ?", p.id);
            const measured = glaz.reduce((s2, g) => s2 + (Number(g.area_sf) || 0), 0);
            const h = detectHiddenTintScope(
              [p.name, p.project_type, p.notes].filter(Boolean).join(" "),
              { filmAlreadySpecified: film.some(f => f.spec_section),
                knownGlazingSf: measured || null, buildingSf: p.building_square_feet || null });
            out.push({
              projectId: p.id, name: p.name, status: p.status, bidDue: p.bid_due,
              city: p.city, state: p.state, gc: p.general_contractor,
              filmSpecified: film.some(f => f.spec_section),
              specifiedSf: film.reduce((s2, f) => s2 + (Number(f.quantity_sf) || 0), 0) || null,
              measuredGlazingSf: measured || null,
              ...h
            });
          }
          const hidden = rankHiddenOpportunities(out);
          const specified = out.filter(o => o.filmSpecified);
          return ok({
            specified, hidden,
            totals: {
              projects: out.length,
              withSpecifiedFilm: specified.length,
              hiddenOpportunities: hidden.length,
              estimatedValueLow: hidden.reduce((s2, h2) => s2 + (h2.potential?.valueLow || 0), 0),
              estimatedValueHigh: hidden.reduce((s2, h2) => s2 + (h2.potential?.valueHigh || 0), 0)
            },
            note: "Hidden-opportunity values are ESTIMATED ranges, not quotes. Sizing requires a glazing quantity or building size."
          });
        }

        // BUILD MY BID — orchestrates the whole pipeline into one bid package
        pm = path.match(/^\/api\/v2\/projects\/([\w-]+)\/build-bid$/);
        if (pm && request.method === "POST") {
          const projectId = pm[1];
          const body = await request.json().catch(() => ({}));
          const p = await db.getProject(projectId);
          if (!p) return fail("Project not found", 404);
          const steps = [];
          const step = (name, status, detail) => steps.push({ name, status, detail });

          // 1. what do we actually know
          step("Project information", p.name ? "ok" : "warn", p.general_contractor ? `GC: ${p.general_contractor}` : "No GC identified");
          const docs = p.documents || [];
          step("Documents", docs.length ? "ok" : "warn",
            docs.length ? `${docs.length} document(s) on file` : "No documents — upload or fetch plans for a real takeoff");

          // 2. film scope
          const film = p.filmScope || [];
          const specified = film.some(f => f.spec_section);
          step("Film scope", film.length ? "ok" : "warn",
            film.length ? `${film.length} film finding(s)${specified ? ", specified in the documents" : ", not formally specified"}` : "No film scope found yet");

          // 3. quantities — deterministic, from stored glazing
          const lines = buildTakeoffLines(p.glazing || [], { wastePercent: body.wastePercent ?? 10 });
          const summary = summarizeTakeoff(lines);
          step("Takeoff", summary.totalSf > 0 ? "ok" : "blocked",
            summary.totalSf > 0
              ? `${summary.totalSf.toLocaleString()} SF from ${lines.length} line(s)${summary.unknownCount ? `, ${summary.unknownCount} without dimensions` : ""}`
              : "No usable quantities — run Analyze on a plan set or enter glazing lines");

          // hidden opportunity when nothing is specified
          const hidden = detectHiddenTintScope(
            [p.name, p.project_type, p.notes].filter(Boolean).join(" "),
            { filmAlreadySpecified: specified, knownGlazingSf: summary.totalSf || null, buildingSf: p.building_square_feet || null });

          if (!summary.totalSf) {
            return ok({
              ready: false, steps, hidden,
              recommendation: { action: "REVIEW", reason: "No verified quantities yet — a bid price would be invented rather than calculated." },
              readiness: computeBidReadiness({
                projectIdentified: Boolean(p.name), gcIdentified: Boolean(p.general_contractor),
                architectIdentified: Boolean(p.architect), bidDateVerified: Boolean(p.bid_due),
                filmScopeIdentified: film.length > 0
              })
            });
          }

          // 4. pricing — deterministic, three scenarios
          const wastePercent = body.wastePercent ?? 10;
          const materialSf = Math.round(summary.totalSf * (1 + wastePercent / 100) * 100) / 100;
          const rollRec = recommendRollWidth(p.glazing || []);
          const rollPlan = { ...rollRec, ...computeRolls({ materialSf, rollWidthIn: rollRec.rollWidthIn }) };

          let inputs = { materialSf, filmSf: summary.totalSf,
            materialCostPerSf: 3.25, productionRateSfPerHour: 18, laborCostPerHour: 65,
            overheadPercent: 12, profitPercent: 35, ...body };
          if (body.pricingProfileId) {
            const pp = await db.first("SELECT * FROM pricing_profiles WHERE id = ?", body.pricingProfileId);
            if (pp) inputs = { materialSf, filmSf: summary.totalSf,
              materialCostPerSf: pp.material_cost_per_sf, laborHoursPer100Sf: pp.labor_hours_per_100sf,
              laborCostPerHour: pp.labor_cost_per_hour, equipmentCost: pp.equipment_cost_per_job,
              mobilizationCost: pp.mobilization_cost, overheadPercent: pp.default_overhead_percent,
              profitPercent: pp.default_profit_percent, ...body };
          }
          const scenarios = pricingScenarios(inputs);
          const pricing = scenarios.target;
          step("Pricing", "ok", `Target ${Math.round(pricing.bidPrice).toLocaleString()} at ${pricing.grossMargin}% margin`);

          // 5. risks + conflicts (deterministic scan of what we hold)
          const conflicts = detectScopeConflicts(film);
          const storedRisks = p.risks || [];
          step("Risks", storedRisks.length + conflicts.length ? "warn" : "ok",
            `${storedRisks.length} risk(s), ${conflicts.length} scope conflict(s)`);

          // 6. score + readiness
          const score = await db.scoreProject(projectId, {
            estimatedRevenue: pricing.bidPrice, estimatedGrossProfit: pricing.grossProfit,
            distanceMiles: p.distance_miles, competition: body.competition, strategicValue: body.strategicValue
          });
          const proposals = (await store.get("proposals")) || {};
          const readiness = computeBidReadiness({
            projectIdentified: Boolean(p.name), gcIdentified: Boolean(p.general_contractor),
            architectIdentified: Boolean(p.architect), bidDateVerified: Boolean(p.bid_due),
            addendaReviewed: (p.addenda || []).length > 0,
            filmScopeIdentified: film.length > 0, quantitiesEstimated: summary.totalSf > 0,
            filmProductsIdentified: film.some(f => f.product && !/^not specified$/i.test(f.product)),
            pricingComplete: true, exclusionsReviewed: Boolean(proposals[projectId]),
            rfisResolved: (p.rfis || []).every(r => r.status !== "Open"),
            proposalGenerated: Boolean(proposals[projectId])
          });

          // 7. who to call
          const contacts = p.contacts || [];
          let bestContact = contacts.find(c => /estimator|precon/i.test(c.role || c.title || "")) || contacts[0] || null;
          if (!bestContact && p.general_contractor) {
            const co = await db.first("SELECT * FROM companies WHERE name = ?", p.general_contractor);
            if (co) bestContact = { name: co.name, role: "Company", phone: co.phone, email: co.email, source: "Contractor record" };
          }
          step("Best contact", bestContact ? "ok" : "warn",
            bestContact ? `${bestContact.name}${bestContact.role ? " — " + bestContact.role : ""}` : "No contact on record");

          // 8. persist the bid so it becomes history
          const bid = await db.insert("bids", {
            project_id: projectId, bid_amount: pricing.bidPrice,
            material_cost: pricing.materialCost, labor_cost: pricing.laborCost,
            equipment_cost: pricing.equipmentCost, mobilization_cost: pricing.mobilizationCost,
            overhead: pricing.overhead, profit: pricing.profit,
            gross_profit: pricing.grossProfit, gross_margin: pricing.grossMargin,
            bid_status: "Draft", breakdown_json: JSON.stringify({ inputs, scenarios: {
              aggressive: scenarios.aggressive.bidPrice, target: scenarios.target.bidPrice, premium: scenarios.conservative.bidPrice } })
          });
          await db.update("projects", projectId, { status: "Ready to Bid" });

          const rec = bidRecommendation(score);
          const blockers = [];
          if (summary.unknownCount) blockers.push(`${summary.unknownCount} takeoff line(s) have no dimensions`);
          if (conflicts.some(c => c.severity === "HIGH")) blockers.push("High-severity scope conflict unresolved");
          if (!film.some(f => f.product && !/^not specified$/i.test(f.product))) blockers.push("No film product confirmed");

          return ok({
            ready: true, steps, bidId: bid.id,
            takeoff: { totalSf: summary.totalSf, byFloor: summary.byFloor, byFilmType: summary.byFilmType,
              unknownCount: summary.unknownCount, materialSf, confidence: summary.confidence },
            rollPlan,
            pricing: {
              aggressive: { price: scenarios.aggressive.bidPrice, margin: scenarios.aggressive.grossMargin },
              target: { price: scenarios.target.bidPrice, margin: scenarios.target.grossMargin },
              premium: { price: scenarios.conservative.bidPrice, margin: scenarios.conservative.grossMargin },
              detail: pricing, recommended: pricing.bidPrice, label: "ESTIMATED"
            },
            score, recommendation: rec, readiness,
            risks: storedRisks, conflicts, hidden, bestContact,
            filmScope: film, blockers,
            nextAction: blockers.length ? `Resolve before bidding: ${blockers[0]}`
              : rec.action === "BID" ? "Generate the proposal and submit."
              : "Review the score breakdown before committing."
          });
        }

        // Lead grader — paste any bid title and see exactly how the scanner would
        // treat it. This is how you check the filter without waiting for a real
        // film bid to appear, and how you diagnose "why didn't this show up?".
        if (path === "/api/v2/relevance/check" && request.method === "POST") {
          const { text } = await request.json();
          if (!text || !text.trim()) return fail("Paste a bid title or description to check.");
          const c = classifyFilmRelevance(text);
          const tab = c.relevance === "high" ? "Film & tinting"
            : c.relevance === "medium" ? "Glazing upsell"
            : c.relevance === "low" ? "Not shown (weak signal)"
            : "Filtered out";
          return ok({
            ...c,
            input: text,
            wouldAppear: ["high", "medium"].includes(c.relevance),
            tab,
            explanation: c.relevance === "high"
              ? "The posting names film or tinting work — this is your scope."
              : c.relevance === "medium"
              ? "Glazing work with no film named. Shown under Glazing upsell as an add-on pitch."
              : c.relevance === "low"
              ? "Only a passing glazing mention — too weak to surface."
              : "Not film work. " + (c.reasons[0] || "")
          });
        }

        /* ---------- PHASE 9: early opportunities + contacts ---------- */

        // Assess any text (planning agenda item, news, permit record) for early
        // film opportunity — before it ever reaches a bid board.
        if (path === "/api/v2/early/assess" && request.method === "POST") {
          const { text, distanceMiles, hasArchitect, hasOwner } = await request.json();
          if (!text || text.trim().length < 10) return fail("Paste the project description or announcement text.");
          return ok(assessEarlyOpportunity(text, { distanceMiles, hasArchitect, hasOwner }));
        }

        // Create an early-stage project from an assessment
        if (path === "/api/v2/early/track" && request.method === "POST") {
          const body = await request.json();
          if (!body.name) return fail("A project name is required");
          const a = assessEarlyOpportunity(body.text || body.name, {
            distanceMiles: body.distanceMiles, hasArchitect: Boolean(body.architect), hasOwner: Boolean(body.owner)
          });
          const r = await db.upsertProject({
            name: body.name,
            owner: body.owner || null, architect: body.architect || null,
            developer: body.developer || null,
            city: body.city || null, state: body.state || null,
            project_type: a.buildingType,
            building_square_feet: a.buildingSf,
            estimated_glazing_square_feet: a.potential.glazingSfLow || null,
            estimated_project_value: a.potential.valueLow || null,
            distance_miles: body.distanceMiles ?? null,
            status: "New", stage: a.stage,
            source: body.source || "Early opportunity (manual)",
            source_url: body.sourceUrl || null,
            notes: [
              `EARLY OPPORTUNITY — stage: ${a.stage}${a.stageEvidence ? ` ("${a.stageEvidence}")` : ""}`,
              a.potential.valueLow ? `Planning-stage film potential: $${a.potential.valueLow.toLocaleString()}–$${a.potential.valueHigh.toLocaleString()} (${a.potential.note})` : a.potential.note,
              `Next action: ${a.nextAction}`,
              body.text ? `Source text: ${String(body.text).slice(0, 600)}` : null
            ].filter(Boolean).join("\n\n"),
            score_json: JSON.stringify({ total: a.score, breakdown: a.breakdown, reasoning: a.nextAction, at: new Date().toISOString().slice(0,10), early: true })
          });
          return ok({ ...r, assessment: a });
        }

        // Early-stage projects on the board
        if (path === "/api/v2/early" && request.method === "GET") {
          const rows = await db.all("SELECT * FROM projects WHERE stage IS NOT NULL AND stage != '' ORDER BY created_at DESC LIMIT 100");
          const early = rows.filter(p => isEarly(p.stage));
          return ok({ projects: early, count: early.length });
        }

        /* ---------- PHASE 8: morning digest ---------- */

        // Preview today's brief in the app — works whether or not email is set up
        if (path === "/api/v2/digest" && request.method === "GET") {
          const [leads, projects] = await Promise.all([
            store.get("discovered"), db.all("SELECT * FROM projects")
          ]);
          const digest = buildDigest({ leads: leads || [], projects });
          return ok({
            ...digest,
            html: renderDigestHtml(digest, url.origin),
            text: renderDigestText(digest, url.origin),
            emailConfigured: Boolean(env.RESEND_API_KEY && env.DIGEST_TO),
            to: env.DIGEST_TO || null
          });
        }

        // Send it now (used by the "Send test" button and by the cron)
        if (path === "/api/v2/digest/send" && request.method === "POST") {
          const body = await request.json().catch(() => ({}));
          const [leads, projects] = await Promise.all([
            store.get("discovered"), db.all("SELECT * FROM projects")
          ]);
          const digest = buildDigest({ leads: leads || [], projects });
          const result = await sendEmail(env, {
            to: body.to || env.DIGEST_TO,
            subject: digest.subject,
            html: renderDigestHtml(digest, url.origin),
            text: renderDigestText(digest, url.origin)
          });
          if (!result.sent) return ok({ sent: false, reason: result.reason, digest });
          const meta = (await store.get("meta")) || {};
          await store.set("meta", { ...meta, lastDigestAt: new Date().toISOString() });
          return ok({ sent: true, to: body.to || env.DIGEST_TO, subject: digest.subject });
        }

        /* ---------- PHASE 7: checklist + contacts ---------- */

        pm = path.match(/^\/api\/v2\/projects\/([\w-]+)\/checklist$/);
        if (pm && request.method === "GET") {
          const project = await db.getProject(pm[1]);
          if (!project) return fail("Project not found", 404);
          const proposals = (await store.get("proposals")) || {};
          const manualRows = await db.all("SELECT * FROM bid_checklist WHERE project_id = ?", pm[1]);
          const manual = {};
          for (const r of manualRows) if (r.checked) manual[r.item] = true;
          return ok(buildChecklist({ ...project, hasProposal: Boolean(proposals[pm[1]]) }, manual));
        }
        if (pm && request.method === "PUT") {
          const { item, checked } = await request.json();
          if (!CHECKLIST_ITEMS.some(i => i.key === item)) return fail("Unknown checklist item: " + item);
          const existing = await db.first("SELECT * FROM bid_checklist WHERE project_id = ? AND item = ?", pm[1], item);
          if (existing) await db.update("bid_checklist", existing.id, { checked: checked ? 1 : 0 });
          else await db.insert("bid_checklist", { project_id: pm[1], item, checked: checked ? 1 : 0 });
          const project = await db.getProject(pm[1]);
          const proposals = (await store.get("proposals")) || {};
          const rows = await db.all("SELECT * FROM bid_checklist WHERE project_id = ?", pm[1]);
          const manual = {};
          for (const r of rows) if (r.checked) manual[r.item] = true;
          return ok(buildChecklist({ ...project, hasProposal: Boolean(proposals[pm[1]]) }, manual));
        }

        pm = path.match(/^\/api\/v2\/contacts\/([\w-]+)$/);
        if (pm && request.method === "PUT") return ok(await db.update("project_contacts", pm[1], await request.json()));
        if (pm && request.method === "DELETE") return ok(await db.remove("project_contacts", pm[1]));

        /* ---------- PHASE 6: OCR, search, health, exports ---------- */

        // Read scanned/image-only sheets with vision. The browser rasterises the
        // pages that had no text layer and posts them here.
        pm = path.match(/^\/api\/v2\/documents\/([\w-]+)\/ocr$/);
        if (pm && request.method === "POST") {
          const { projectId, images } = await request.json();
          if (!projectId || !Array.isArray(images) || !images.length)
            return fail("projectId and images[] are required");
          if (images.length > 8)
            return fail("Send at most 8 scanned pages per request — vision is expensive, so this is deliberate.");
          const project = await db.first("SELECT * FROM projects WHERE id = ?", projectId);
          if (!project) return fail("Project not found", 404);

          const res = await readScannedPage(env, {
            images, project, pageNumbers: images.map(i => i.page)
          });
          if (!res.ok) return fail(res.error, 502);

          const pages = Array.isArray(res.json.pages) ? res.json.pages : [];
          let indexed = 0;
          for (const p of pages) {
            const text = String(p.legibleText || "").trim();
            if (!text) continue;               // unreadable page: store nothing rather than a guess
            const det = detectFilmTerms(text);
            const existing = await db.first(
              "SELECT id FROM project_sheets WHERE document_id = ? AND page_number = ?", pm[1], p.page);
            const row = {
              project_id: projectId, document_id: pm[1],
              sheet_number: p.sheetNumber || null, sheet_title: p.sheetTitle || null,
              page_number: p.page,
              ocr_text: text.slice(0, 20000),
              text_content: text.slice(0, 20000),
              classification: p.classification || classifySheetText(text),
              relevance_score: det.relevance
            };
            existing ? await db.update("project_sheets", existing.id, row) : await db.insert("project_sheets", row);
            indexed++;
          }
          return ok({
            pagesSent: images.length,
            pagesRead: indexed,
            unreadable: images.length - indexed,
            pages,
            note: indexed < images.length
              ? `${images.length - indexed} page(s) were too low-resolution to read. Nothing was invented for them.`
              : null
          });
        }

        // Global search across projects, companies, film scope, sheets, RFIs, contacts
        if (path === "/api/v2/search" && request.method === "GET") {
          const q = (url.searchParams.get("q") || "").trim();
          if (q.length < 2) return fail("Enter at least 2 characters to search");
          const like = "%" + q.toLowerCase() + "%";
          const [projects, companies, film, sheets, rfiRows, contacts] = await Promise.all([
            db.all(`SELECT * FROM projects WHERE lower(name||' '||COALESCE(project_number,'')||' '||COALESCE(general_contractor,'')||' '||COALESCE(owner,'')||' '||COALESCE(city,'')||' '||COALESCE(notes,'')) LIKE ? LIMIT 40`, like),
            db.all(`SELECT * FROM companies WHERE lower(name||' '||COALESCE(markets,'')||' '||COALESCE(hq,'')) LIKE ? LIMIT 25`, like),
            db.all(`SELECT * FROM film_scope WHERE lower(COALESCE(film_type,'')||' '||COALESCE(manufacturer,'')||' '||COALESCE(product,'')||' '||COALESCE(spec_section,'')||' '||COALESCE(sheet,'')) LIKE ? LIMIT 25`, like),
            db.all(`SELECT id, project_id, sheet_number, sheet_title, page_number, classification, substr(text_content,1,300) AS text_content FROM project_sheets WHERE lower(COALESCE(sheet_number,'')||' '||COALESCE(sheet_title,'')||' '||COALESCE(text_content,'')) LIKE ? LIMIT 40`, like),
            db.all(`SELECT * FROM rfis WHERE lower(COALESCE(subject,'')||' '||COALESCE(question,'')) LIKE ? LIMIT 20`, like),
            db.all(`SELECT * FROM project_contacts WHERE lower(COALESCE(name,'')||' '||COALESCE(email,'')||' '||COALESCE(title,'')) LIKE ? LIMIT 20`, like)
          ]);
          const all = [];
          const push = (rows, table) => rows.forEach(r => {
            const { score, hits } = scoreRecord(r, q, table);
            if (score > 0) all.push(buildSearchResult(r, table, hits, score));
          });
          push(projects, "projects"); push(companies, "companies"); push(film, "film_scope");
          push(sheets, "project_sheets"); push(rfiRows, "rfis"); push(contacts, "project_contacts");
          const results = rankSearchResults(all, 30);
          return ok({ query: q, count: results.length, results });
        }

        // System health
        if (path === "/api/v2/health" && request.method === "GET") {
          let database = false, projectCount = 0;
          try {
            const row = await db.first("SELECT COUNT(*) AS n FROM projects");
            database = true; projectCount = row?.n ?? 0;
          } catch { /* leave false */ }
          const meta = (await store.get("meta")) || {};
          const discovered = (await store.get("discovered")) || [];
          return ok(summarizeHealth({
            database, projectCount,
            r2: Boolean(env.DOCUMENTS),
            claudeKey: Boolean(env.ANTHROPIC_API_KEY),
            samKey: Boolean(env.SAM_API_KEY),
            samLastRun: meta.samLastRun || null,
            lastDiscovery: discovered[0]?.foundAt || null,
            bluebookLastReceived: meta.bluebookLastReceived || null,
            bcConnected: Boolean(await store.get("bc_tokens")),
            bcLastSync: meta.bcLastSync || null,
            passwordSet: Boolean(env.APP_PASSWORD),
            cron: true,
            digest: Boolean(env.RESEND_API_KEY && env.DIGEST_TO),
            digestTo: env.DIGEST_TO || null,
            lastDigest: meta.lastDigestAt || null
          }));
        }

        if (path === "/api/v2/integrations" && request.method === "GET")
          return ok({ items: await integrationsStatus(env, store) });

        // CSV exports
        pm = path.match(/^\/api\/v2\/export\/(projects|takeoff|results)$/);
        if (pm && request.method === "GET") {
          const kind = pm[1];
          let rows = [], cols = null, name = kind;
          if (kind === "projects") {
            rows = await db.all("SELECT * FROM projects ORDER BY bid_due");
            cols = ["name","project_number","status","bid_due","prebid_date","general_contractor",
              "architect","owner","city","state","estimated_project_value","source_url"];
          } else if (kind === "takeoff") {
            const projectId = url.searchParams.get("projectId");
            if (!projectId) return fail("projectId is required for a takeoff export");
            rows = await db.all("SELECT * FROM glazing_items WHERE project_id = ? ORDER BY floor, window_mark", projectId);
            cols = ["window_mark","floor","window_type","quantity","width_ft","height_ft","area_sf",
              "glass_type","source_sheet","source_page","confidence","estimator_override","calculation"];
            name = "takeoff-" + projectId;
          } else {
            rows = await db.all(`SELECT br.*, p.name AS project, p.general_contractor AS gc
                                 FROM bid_results br LEFT JOIN projects p ON p.id = br.project_id
                                 ORDER BY br.created_at DESC`);
            cols = ["project","gc","result","reason","competitor","winning_price","actual_sf",
              "actual_labor_hours","film_type","awarded_at","notes"];
            name = "bid-results";
          }
          const csv = toCsv(rows, cols);
          return new Response(csv, { headers: {
            "content-type": "text/csv; charset=utf-8",
            "content-disposition": `attachment; filename="${name}.csv"`
          }});
        }

        /* ---------- PHASE 5: command center + analytics ---------- */

        // Everything the dashboard needs in one request
        if (path === "/api/v2/dashboard" && request.method === "GET") {
          const [projects, results] = await Promise.all([
            db.all("SELECT * FROM projects"),
            db.all(`SELECT br.*, p.general_contractor AS gc, p.project_type, p.city, p.state,
                           b.bid_amount, b.gross_profit, b.gross_margin
                    FROM bid_results br
                    LEFT JOIN projects p ON p.id = br.project_id
                    LEFT JOIN bids b ON b.id = br.bid_id`)
          ]);
          const open = projects.filter(p => !["Awarded","Lost","Cancelled","Archived","Completed","No Decision"].includes(p.status));
          const cal = bidCalendar(projects);
          const wl = computeWinLoss(results);
          return ok({
            activeProjects: open.length,
            hotOpportunities: open.filter(p => {
              try { return (JSON.parse(p.score_json || "{}").total || 0) >= 70; } catch { return false; }
            }).length,
            bidsDueThisWeek: cal.today.length + cal.thisWeek.length,
            pastDue: cal.pastDue.length,
            pipelineValue: Math.round(open.reduce((s,p)=>s+(Number(p.estimated_project_value)||0),0)),
            todaysBids: rankTodaysBids(projects, { limit: 5 }),
            calendar: cal,
            winLoss: wl
          });
        }

        if (path === "/api/v2/analytics" && request.method === "GET") {
          const results = await db.all(
            `SELECT br.*, p.general_contractor AS gc, p.project_type, p.state,
                    b.bid_amount, b.gross_profit, b.gross_margin
             FROM bid_results br
             LEFT JOIN projects p ON p.id = br.project_id
             LEFT JOIN bids b ON b.id = br.bid_id`);
          // film type per project, for the film-type breakdown
          const films = await db.all("SELECT project_id, film_type FROM film_scope");
          const filmByProject = {};
          for (const f of films) if (!filmByProject[f.project_id]) filmByProject[f.project_id] = f.film_type;
          const enriched = results.map(r => ({ ...r, film_type: filmByProject[r.project_id] || "Unknown" }));

          const byGc = breakdownBy(enriched, "gc");
          const byType = breakdownBy(enriched, "project_type");
          const byFilm = breakdownBy(enriched, "film_type");
          return ok({
            winLoss: computeWinLoss(enriched),
            byGc, byProjectType: byType, byFilmType: byFilm,
            best: {
              gc: bestPerformer(byGc),
              projectType: bestPerformer(byType),
              filmType: bestPerformer(byFilm)
            },
            lossReasons: LOSS_REASONS
          });
        }

        // Historical production rates learned from completed work
        if (path === "/api/v2/analytics/pricing" && request.method === "GET") {
          const filmType = url.searchParams.get("filmType");
          const completed = await db.all(
            `SELECT br.*, b.gross_margin, b.bid_amount FROM bid_results br
             LEFT JOIN bids b ON b.id = br.bid_id WHERE br.result = 'Won'`);
          return ok(historicalPricing(completed, filmType));
        }

        // Record actual production after a job — this is what makes the
        // historical rates real instead of guesses.
        pm = path.match(/^\/api\/v2\/results\/([\w-]+)\/actuals$/);
        if (pm && request.method === "PUT")
          return ok(await db.update("bid_results", pm[1], await request.json()));

        if (path === "/api/v2/companies/relationships" && request.method === "GET") {
          const companies = await db.all("SELECT * FROM companies");
          const out = [];
          for (const c of companies) {
            const stats = await db.first(
              `SELECT COUNT(*) AS bids,
                      SUM(CASE WHEN br.result='Won' THEN 1 ELSE 0 END) AS wins
               FROM bid_results br LEFT JOIN projects p ON p.id = br.project_id
               WHERE p.general_contractor = ?`, c.name);
            const rel = computeRelationshipScore({
              bids_submitted: stats?.bids || 0,
              wins: stats?.wins || 0,
              completed_projects: stats?.wins || 0,
              active_contacts: 0,
              days_since_contact: null,
              unanswered_bids: 0
            });
            // Bid history is stronger evidence than a hand-set star rating, so it
            // wins when it exists; otherwise keep whatever the user set.
            const hasHistory = (stats?.bids || 0) > 0;
            const score = hasHistory ? rel.score : (c.relationship_score || 0);
            const tier = hasHistory ? rel.tier
              : score >= 70 ? "Strong" : score >= 40 ? "Developing" : score > 0 ? "Cold" : "No history";
            out.push({ ...c, computed: { ...rel, score, tier }, relationship_score: score,
              bids: stats?.bids || 0, wins: stats?.wins || 0 });
          }
          return ok(out.sort((a, b) => b.relationship_score - a.relationship_score));
        }

        /* ---------- AUTO DOCUMENT FETCH ---------- */
        // Find the plans/specs/addenda on the project's source page so the user
        // never has to download files to their phone and hunt for them.
        pm = path.match(/^\/api\/v2\/projects\/([\w-]+)\/documents\/discover$/);
        if (pm && request.method === "POST") {
          const project = await db.first("SELECT * FROM projects WHERE id = ?", pm[1]);
          if (!project) return fail("Project not found", 404);
          const body = await request.json().catch(() => ({}));
          const pageUrl = body.url || project.source_url || project.source;
          if (!pageUrl || !/^https?:/i.test(pageUrl))
            return fail("This project has no source web page on record. Add the bid posting URL in Overview, or upload the file yourself.", 409);
          let res;
          try {
            res = await fetch(pageUrl, { headers: UA_HEADERS, redirect: "follow" });
          } catch (e) { return fail("Could not reach the source page: " + e.message, 502); }
          if (!res.ok) return fail(`Source page returned HTTP ${res.status}. It may require a login — upload the file yourself instead.`, 502);
          const ctype = res.headers.get("content-type") || "";
          // The source URL may itself BE the pdf
          if (/pdf/i.test(ctype)) {
            return ok({ pageUrl, documents: [{
              url: pageUrl, filename: pageUrl.split("/").pop(), text: "Source document",
              type: "specifications", label: "Document", ext: "pdf"
            }], note: "The source link is a document itself." });
          }
          const html = await res.text();
          const documents = findDocumentLinks(html, pageUrl);
          const analyzable = analyzableDocuments(documents);
          return ok({
            pageUrl, documents, analyzableCount: analyzable.length,
            summary: describeDocumentSet(documents),
            note: documents.length ? null : "No PDFs found on that page. The portal may require a login, in which case upload the file yourself."
          });
        }

        // Download a discovered document into R2 so the browser can read it
        // without the user ever touching a file picker.
        pm = path.match(/^\/api\/v2\/projects\/([\w-]+)\/documents\/fetch$/);
        if (pm && request.method === "POST") {
          if (!env.DOCUMENTS) return fail("R2 bucket not configured. See DEPLOY.md step G.", 501);
          const projectId = pm[1];
          const { url: docUrl, documentType, filename } = await request.json();
          if (!docUrl || !/^https?:/i.test(docUrl)) return fail("A document URL is required");
          let res;
          try {
            res = await fetch(docUrl, { headers: UA_HEADERS, redirect: "follow" });
          } catch (e) { return fail("Could not download the document: " + e.message, 502); }
          if (!res.ok) return fail(`Document download failed (HTTP ${res.status}).`, 502);
          const buf = await res.arrayBuffer();
          if (buf.byteLength > MAX_FETCH_SIZE)
            return fail(`That document is ${Math.round(buf.byteLength / 1048576)} MB, over the ${Math.round(MAX_FETCH_SIZE / 1048576)} MB limit. Download just the architectural sheets and upload them instead.`, 413);
          const hash = await sha256Hex(buf);
          const existing = await db.first("SELECT * FROM project_documents WHERE project_id = ? AND hash = ?", projectId, hash);
          if (existing) return ok({ ...existing, duplicate: true });
          const name = filename || decodeURIComponent(docUrl.split("/").pop().split("?")[0]);
          const storageKey = `${projectId}/${hash}-${name}`.slice(0, 400);
          await env.DOCUMENTS.put(storageKey, buf, { httpMetadata: { contentType: "application/pdf" } });
          const row = await db.insert("project_documents", {
            project_id: projectId, filename: name,
            document_type: documentType || "other",
            source_url: docUrl, storage_key: storageKey,
            mime_type: "application/pdf", file_size: buf.byteLength,
            hash, status: "stored", processing_status: "pending",
            uploaded_at: new Date().toISOString()
          });
          return ok({ ...row, sizeMb: Math.round(buf.byteLength / 104857.6) / 10 });
        }

        /* ---------- PHASE 4: addendum intelligence ---------- */

        // Compare a new revision's extracted pages against what we already hold.
        // The diff is deterministic; AI only names the impact.
        pm = path.match(/^\/api\/v2\/projects\/([\w-]+)\/addenda\/compare$/);
        if (pm && request.method === "POST") {
          const projectId = pm[1];
          const { documentId, addendumNumber, filename, installedPricePerSf } = await request.json();
          const project = await db.first("SELECT * FROM projects WHERE id = ?", projectId);
          if (!project) return fail("Project not found", 404);

          const sheets = await db.all("SELECT * FROM project_sheets WHERE document_id = ?", documentId);
          if (!sheets.length)
            return fail("That document has not been indexed yet. Upload and index it first.", 409);

          // current record = what the project holds right now
          const [currentGlazing, currentFilm] = await Promise.all([
            db.all("SELECT * FROM glazing_items WHERE project_id = ?", projectId),
            db.all("SELECT * FROM film_scope WHERE project_id = ?", projectId)
          ]);

          // extract the revision's scope from the addendum pages only
          const ranked = rankPages(sheets);
          const selected = selectPagesForAI(ranked);
          if (!selected.length)
            return ok({
              summary: { noChanges: true, tintRelevantChanges: 0, changes: [], severity: "LOW" },
              note: "No film or glazing terminology found in this addendum. Nothing tint-relevant detected."
            });
          const evidence = buildEvidencePack(selected);
          const [filmRes, glazRes] = await Promise.all([
            extractFilmScope(env, { project, evidence }),
            extractGlazing(env, { project, evidence })
          ]);
          if (!filmRes.ok) return fail(filmRes.error, 502);
          const newFilm = validateFilmFindings(filmRes.json.filmOpportunities, evidence).accepted;
          const newGlazing = glazRes.ok
            ? validateGlazingFindings(glazRes.json.glazingItems, evidence).accepted : [];

          const glazingDiff = diffGlazing(currentGlazing, newGlazing.map(g => ({
            window_mark: g.windowMark, floor: g.floor,
            quantity: g.quantity, width_ft: g.widthFt, height_ft: g.heightFt
          })));
          const filmDiff = diffFilmScope(currentFilm, newFilm.map(f => ({
            film_type: f.type, sheet: f.sheet, spec_section: f.specSection,
            manufacturer: f.manufacturer, product: f.product, quantity_sf: f.quantitySF
          })));
          const cost = estimateCostImpact(glazingDiff.netSfDelta, { installedPricePerSf });
          const summary = summarizeAddendumImpact(glazingDiff, filmDiff, cost);

          const num_ = addendumNumber || parseAddendumNumber(filename) ||
            parseAddendumNumber(sheets.map(x => x.text_content || "").join(" ").slice(0, 4000));
          const addendumRow = await db.insert("addenda", {
            project_id: projectId, document_id: documentId,
            addendum_number: num_ || "unnumbered",
            summary: summary.changes.join("; ") || "No tint-relevant changes detected",
            impact_score: summary.impactScore
          });
          for (const c of glazingDiff.changed) {
            await db.insert("addendum_changes", {
              addendum_id: addendumRow.id, sheet: null, section: c.mark,
              change_type: "changed",
              old_value: JSON.stringify(c.fields.map(f => `${f.field}: ${f.from}`)),
              new_value: JSON.stringify(c.fields.map(f => `${f.field}: ${f.to}`)),
              impact_description: c.areaDeltaSf != null ? `${c.areaDeltaSf > 0 ? "+" : ""}${c.areaDeltaSf} SF` : "SF impact unknown",
              estimated_cost_impact: (c.areaDeltaSf != null && installedPricePerSf)
                ? Math.round(c.areaDeltaSf * installedPricePerSf * 100) / 100 : null
            });
          }
          for (const a of [...glazingDiff.added.map(x => ["added", x.mark, x.areaSf]),
                           ...glazingDiff.removed.map(x => ["removed", x.mark, x.areaSf])]) {
            await db.insert("addendum_changes", {
              addendum_id: addendumRow.id, section: a[1], change_type: a[0],
              impact_description: a[2] != null ? `${a[0] === "added" ? "+" : "-"}${a[2]} SF` : "SF impact unknown"
            });
          }
          return ok({ addendumId: addendumRow.id, addendumNumber: num_, summary, glazingDiff, filmDiff, cost });
        }

        // Deterministic scope-conflict scan over what we already hold
        pm = path.match(/^\/api\/v2\/projects\/([\w-]+)\/conflicts$/);
        if (pm && request.method === "GET") {
          const film = await db.all("SELECT * FROM film_scope WHERE project_id = ?", pm[1]);
          return ok({ conflicts: detectScopeConflicts(film), scanned: film.length });
        }

        // RFI list / update / delete
        pm = path.match(/^\/api\/v2\/rfis\/([\w-]+)$/);
        if (pm && request.method === "PUT") return ok(await db.update("rfis", pm[1], await request.json()));
        if (pm && request.method === "DELETE") return ok(await db.remove("rfis", pm[1]));

        /* ---------- PHASE 3: takeoff workbench ---------- */

        // Everything the takeoff screen needs in one round trip (mobile-friendly)
        pm = path.match(/^\/api\/v2\/projects\/([\w-]+)\/workbench$/);
        if (pm && request.method === "GET") {
          const projectId = pm[1];
          const project = await db.first("SELECT * FROM projects WHERE id = ?", projectId);
          if (!project) return fail("Project not found", 404);
          const wastePercent = Number(url.searchParams.get("waste") ?? 10);
          const [glazingRows, filmRows, profiles] = await Promise.all([
            db.all("SELECT * FROM glazing_items WHERE project_id = ? ORDER BY floor, window_mark", projectId),
            db.all("SELECT * FROM film_scope WHERE project_id = ?", projectId),
            db.all("SELECT * FROM pricing_profiles WHERE active = 1")
          ]);
          const defaultFilmType = filmRows.find(f => f.spec_section)?.film_type
            || filmRows[0]?.film_type || null;
          const lines = buildTakeoffLines(glazingRows, { defaultFilmType, wastePercent });
          const summary = summarizeTakeoff(lines);
          const rollRec = recommendRollWidth(glazingRows);
          const materialSf = Math.round(summary.totalSf * (1 + wastePercent / 100) * 100) / 100;
          return ok({
            project, lines, summary, filmScope: filmRows, pricingProfiles: profiles,
            wastePercent, materialSf,
            rollPlan: { ...rollRec, ...computeRolls({ materialSf, rollWidthIn: rollRec.rollWidthIn }) },
            hasAnalysis: glazingRows.length > 0
          });
        }

        // Estimator edits a glazing line — AI value is replaced and the row is
        // marked as an override so re-analysis will not overwrite it.
        pm = path.match(/^\/api\/v2\/glazing\/([\w-]+)$/);
        if (pm && request.method === "PUT") {
          const body = await request.json();
          const patch = { estimator_override: 1 };
          for (const k of ["window_mark", "window_type", "floor", "elevation",
            "quantity", "width_ft", "height_ft", "glass_type", "film_type"]) {
            if (body[k] !== undefined) patch[k] = body[k];
          }
          const q = Number(patch.quantity), w = Number(patch.width_ft), h = Number(patch.height_ft);
          const existing = await db.first("SELECT * FROM glazing_items WHERE id = ?", pm[1]);
          if (!existing) return fail("Glazing item not found", 404);
          const qq = isNaN(q) ? existing.quantity : q;
          const ww = isNaN(w) ? existing.width_ft : w;
          const hh = isNaN(h) ? existing.height_ft : h;
          if (qq != null && ww != null && hh != null) {
            patch.area_sf = Math.round(qq * ww * hh * 100) / 100;
            patch.calculation = `${qq} × ${ww}' × ${hh}' = ${patch.area_sf.toLocaleString()} SF (estimator override)`;
          }
          return ok(await db.update("glazing_items", pm[1], patch));
        }
        if (pm && request.method === "DELETE")
          return ok(await db.remove("glazing_items", pm[1]));
        if (path === "/api/v2/glazing" && request.method === "POST") {
          const body = await request.json();
          const q = Number(body.quantity), w = Number(body.width_ft), h = Number(body.height_ft);
          const area = [q, w, h].every(n => !isNaN(n)) ? Math.round(q * w * h * 100) / 100 : null;
          return ok(await db.insert("glazing_items", {
            ...body, area_sf: area, estimator_override: 1, confidence: 100,
            source_sheet: body.source_sheet || "Estimator entry",
            calculation: area != null ? `${q} × ${w}' × ${h}' = ${area.toLocaleString()} SF (estimator entry)` : "Unknown"
          }));
        }

        // Proposal built from verified project data
        pm = path.match(/^\/api\/v2\/projects\/([\w-]+)\/proposal$/);
        if (pm && request.method === "POST") {
          const projectId = pm[1];
          const body = await request.json().catch(() => ({}));
          const project = await db.first("SELECT * FROM projects WHERE id = ?", projectId);
          if (!project) return fail("Project not found", 404);
          const [glazingRows, filmRows] = await Promise.all([
            db.all("SELECT * FROM glazing_items WHERE project_id = ?", projectId),
            db.all("SELECT * FROM film_scope WHERE project_id = ?", projectId)
          ]);
          const wastePercent = Number(body.wastePercent ?? 10);
          const lines = buildTakeoffLines(glazingRows, { wastePercent });
          const summary = summarizeTakeoff(lines);
          if (!summary.totalSf)
            return fail("No usable quantities yet. Run Analyze or enter glazing lines before generating a proposal.", 409);
          const materialSf = Math.round(summary.totalSf * (1 + wastePercent / 100) * 100) / 100;
          const rollRec = recommendRollWidth(glazingRows);
          const rollPlan = { ...rollRec, ...computeRolls({ materialSf, rollWidthIn: rollRec.rollWidthIn }) };
          const pricing = computePricing({ ...body, materialSf, filmSf: summary.totalSf });
          const text = await generateProposalV2(env, {
            project,
            filmScope: filmRows.map(f => ({
              type: f.film_type, manufacturer: f.manufacturer || "Not specified",
              product: f.product || "Not specified", sheet: f.sheet, spec: f.spec_section
            })),
            takeoff: { totalSf: summary.totalSf, byFloor: summary.byFloor,
              wastePercent, materialSf, unknownLines: summary.unknownCount },
            pricing, rollPlan
          });
          const proposals = (await store.get("proposals")) || {};
          proposals[projectId] = text;
          await store.set("proposals", proposals);
          const bid = await db.insert("bids", {
            project_id: projectId, bid_amount: pricing.bidPrice,
            material_cost: pricing.materialCost, labor_cost: pricing.laborCost,
            equipment_cost: pricing.equipmentCost, mobilization_cost: pricing.mobilizationCost,
            overhead: pricing.overhead, profit: pricing.profit,
            gross_profit: pricing.grossProfit, gross_margin: pricing.grossMargin,
            bid_status: "Draft", breakdown_json: JSON.stringify(pricing)
          });
          await db.update("projects", projectId, { status: "Pricing" });
          await db.scoreProject(projectId);
          return ok({ text, pricing, rollPlan, summary, bidId: bid.id });
        }

        /* ---------- PHASE 2: document intelligence ---------- */

        // Browser extracts PDF text (Workers CPU limits) and posts pages here.
        let dm = path.match(/^\/api\/v2\/documents\/([\w-]+)\/pages$/);
        if (dm && request.method === "POST") {
          const { projectId, pages } = await request.json();
          if (!projectId || !Array.isArray(pages)) return fail("projectId and pages[] are required");
          const ranked = rankPages(pages.map(p => ({ ...p, document_id: dm[1] })));
          await db.run("DELETE FROM project_sheets WHERE document_id = ?", dm[1]);
          // batch inserts to stay well inside D1 limits
          for (const p of ranked) {
            await db.insert("project_sheets", {
              project_id: projectId, document_id: dm[1],
              sheet_number: p.sheet_number, sheet_title: p.sheet_title || null,
              page_number: p.page_number,
              text_content: String(p.text || "").slice(0, 20000),
              classification: p.classification,
              relevance_score: p.relevance_score
            });
          }
          await db.update("project_documents", dm[1], {
            page_count: ranked.length, processing_status: "indexed",
            processed_at: new Date().toISOString()
          });
          return ok({ indexed: ranked.length, summary: analysisSummary(ranked, selectPagesForAI(ranked)) });
        }

        // Full project analysis: cheap filter -> only relevant pages to AI -> validate -> persist
        pm = path.match(/^\/api\/v2\/projects\/([\w-]+)\/analyze$/);
        if (pm && request.method === "POST") {
          const projectId = pm[1];
          const project = await db.first("SELECT * FROM projects WHERE id = ?", projectId);
          if (!project) return fail("Project not found", 404);
          const sheets = await db.all("SELECT * FROM project_sheets WHERE project_id = ?", projectId);
          if (!sheets.length)
            return fail("No indexed documents for this project yet. Upload plans or specs first.", 409);

          const ranked = rankPages(sheets);
          const selected = selectPagesForAI(ranked);
          const summary = analysisSummary(ranked, selected);
          if (!selected.length)
            return ok({ summary, filmScope: [], glazing: [], risks: [],
              note: "No pages contained film or glazing terminology. Nothing was sent to the AI." });

          const evidence = buildEvidencePack(selected);

          const filmRes = await extractFilmScope(env, { project, evidence });
          if (!filmRes.ok) return fail(filmRes.error, 502);
          const film = validateFilmFindings(filmRes.json.filmOpportunities, evidence);

          const glazRes = await extractGlazing(env, { project, evidence });
          const glaz = glazRes.ok
            ? validateGlazingFindings(glazRes.json.glazingItems, evidence)
            : { accepted: [], rejected: [] };

          // persist film scope (replacing prior AI findings, keeping estimator tags)
          await db.run("DELETE FROM film_scope WHERE project_id = ? AND source_excerpt != ?",
            projectId, "Estimator tag from legacy opportunity record");
          for (const f of film.accepted) {
            await db.insert("film_scope", {
              project_id: projectId, film_type: f.type,
              manufacturer: f.manufacturer, product: f.product,
              location: f.location, floor: f.floor, sheet: f.sheet,
              spec_section: f.specSection, quantity_sf: f.quantitySF,
              vlt: f.vlt, interior_exterior: f.interiorExterior,
              attachment_required: f.attachmentRequired == null ? null : String(f.attachmentRequired),
              confidence: f.confidence,
              source_document_id: f.documentId, source_page: f.page,
              source_excerpt: f.excerpt, updated_at: new Date().toISOString()
            });
          }
          // persist glazing (never overwrite estimator-edited rows)
          await db.run("DELETE FROM glazing_items WHERE project_id = ? AND estimator_override = 0", projectId);
          for (const g of glaz.accepted) {
            const area = (g.quantity != null && g.widthFt != null && g.heightFt != null)
              ? Math.round(g.quantity * g.widthFt * g.heightFt * 100) / 100 : null;
            await db.insert("glazing_items", {
              project_id: projectId, window_mark: g.windowMark, window_type: g.windowType,
              floor: g.floor, elevation: g.elevation,
              quantity: g.quantity, width_ft: g.widthFt, height_ft: g.heightFt, area_sf: area,
              glass_type: g.glassType, frame_type: g.frameType,
              source_sheet: g.sheet, source_page: g.page, confidence: g.confidence,
              calculation: area != null
                ? `${g.quantity} × ${g.widthFt}' × ${g.heightFt}' = ${area.toLocaleString()} SF`
                : "Unknown — no usable dimensions in available documents"
            });
          }

          // risks + scope conflicts
          let risks = [], conflicts = [];
          const riskRes = await analyzeRisks(env, { project, evidence,
            filmScope: film.accepted, glazing: glaz.accepted });
          if (riskRes.ok) {
            risks = Array.isArray(riskRes.json.risks) ? riskRes.json.risks : [];
            conflicts = Array.isArray(riskRes.json.scopeConflicts) ? riskRes.json.scopeConflicts : [];
            await db.run("DELETE FROM project_risks WHERE project_id = ?", projectId);
            for (const r of risks) {
              await db.insert("project_risks", {
                project_id: projectId,
                severity: ["HIGH", "MEDIUM", "LOW"].includes(r.severity) ? r.severity : "MEDIUM",
                title: r.title || "Unspecified risk", reason: r.reason || null,
                source: r.source || null, recommended_action: r.recommendedAction || null
              });
            }
          }

          await db.insert("ai_analysis", {
            project_id: projectId, analysis_type: "project",
            model: "claude-sonnet-4-6", prompt_version: PROMPT_VERSIONS.film,
            result_json: JSON.stringify({ summary, film: film.accepted, glazing: glaz.accepted, risks, conflicts }),
            confidence: film.accepted.length
              ? Math.round(film.accepted.reduce((s, f) => s + (f.confidence || 0), 0) / film.accepted.length)
              : null
          });
          await db.update("projects", projectId, { status: "Analyzing" });
          await db.scoreProject(projectId);

          return ok({
            summary: {
              ...summary,
              filmFindings: film.accepted.length,
              glazingFindings: glaz.accepted.length,
              risks: risks.length,
              scopeConflicts: conflicts.length
            },
            filmScope: film.accepted,
            glazing: glaz.accepted,
            risks, conflicts,
            aiSummary: filmRes.json.summary || null,
            missingInformation: filmRes.json.missingInformation || [],
            // transparency: what the AI claimed but could not support with a citation
            discarded: {
              film: film.rejected.length, glazing: glaz.rejected.length,
              detail: [...film.rejected, ...glaz.rejected].slice(0, 10)
            }
          });
        }

        // Keyword search across indexed pages (no AI cost)
        pm = path.match(/^\/api\/v2\/projects\/([\w-]+)\/search$/);
        if (pm && request.method === "GET") {
          const q = (url.searchParams.get("q") || "").trim();
          if (!q) return fail("Missing search term ?q=");
          const rows = await db.all(
            "SELECT id, sheet_number, page_number, classification, relevance_score, substr(text_content,1,400) AS snippet FROM project_sheets WHERE project_id = ? AND lower(text_content) LIKE ? ORDER BY relevance_score DESC LIMIT 40",
            pm[1], "%" + q.toLowerCase() + "%");
          return ok({ query: q, hits: rows.length, results: rows });
        }

        // Project Copilot — answers from indexed evidence, no PDF resend
        pm = path.match(/^\/api\/v2\/projects\/([\w-]+)\/ask$/);
        if (pm && request.method === "POST") {
          const { question, history } = await request.json();
          if (!question) return fail("question is required");
          const project = await db.first("SELECT * FROM projects WHERE id = ?", pm[1]);
          if (!project) return fail("Project not found", 404);
          const sheets = await db.all("SELECT * FROM project_sheets WHERE project_id = ?", pm[1]);
          if (!sheets.length) return fail("No indexed documents for this project yet.", 409);
          const ranked = rankPages(sheets);
          // pull pages matching the question's own words, then top-relevance pages
          const words = question.toLowerCase().split(/\W+/).filter(w => w.length > 3);
          const matching = ranked.filter(p =>
            words.some(w => String(p.text_content || "").toLowerCase().includes(w)));
          const pool = [...new Set([...matching, ...selectPagesForAI(ranked, { maxPages: 10 })])].slice(0, 14);
          const [filmScope, glazing] = await Promise.all([
            db.all("SELECT film_type, manufacturer, product, quantity_sf, sheet, spec_section, confidence FROM film_scope WHERE project_id = ?", pm[1]),
            db.all("SELECT window_mark, quantity, width_ft, height_ft, area_sf, source_sheet FROM glazing_items WHERE project_id = ?", pm[1])
          ]);
          const text = await answerFromEvidence(env, {
            project, question, evidence: buildEvidencePack(pool, 2000),
            filmScope, glazing, history: history || []
          });
          return ok({ text, pagesConsulted: pool.length });
        }

        // Generate an RFI from a detected conflict
        pm = path.match(/^\/api\/v2\/projects\/([\w-]+)\/rfi$/);
        if (pm && request.method === "POST") {
          const conflict = await request.json();
          const project = await db.first("SELECT * FROM projects WHERE id = ?", pm[1]);
          if (!project) return fail("Project not found", 404);
          const res = await generateRFI(env, { project, conflict });
          if (!res.ok) return fail(res.error, 502);
          const row = await db.insert("rfis", {
            project_id: pm[1], subject: res.json.subject || "RFI",
            question: res.json.question || "", source_sheet: res.json.reference || null,
            status: "Draft", updated_at: new Date().toISOString()
          });
          return ok(row);
        }

        return fail("Unknown V2 route: " + path, 404);
      }

      /* ---- Health ---- */
      if (path === "/api/health")
        return json({
          ok: true, platform: "cloudflare",
          claudeKey: Boolean(env.ANTHROPIC_API_KEY),
          samKey: Boolean(env.SAM_API_KEY),
          opportunities: ((await store.get("opportunities")) || []).length,
          r2: Boolean(env.DOCUMENTS),
          v2: await v2Health(env)
        });

      return json({ error: "Not found" }, 404);
    } catch (e) {
      return json({ error: e.message || "Server error" }, e.status || 500);
    }
  },

  /* ================= Discovery + morning brief (Cron Trigger) ================= */
  // The cron itself still fires every morning (the digest — deadlines, follow-ups,
  // pre-bids — is genuinely daily-relevant), but the discovery *scan* only runs on
  // Mondays: public bid boards don't turn over daily, and it's kinder to those
  // sites and to the SAM.gov rate limit to check once a week instead of nightly.
  async scheduled(event, env, ctx) {
    const store = makeStore(env);
    const db = makeDb(env);
    ctx.waitUntil((async () => {
      // Release lead reservations that lapsed without a claim, so a lead
      // parked by one contractor becomes available again on schedule.
      try {
        const expired = await leadFlow.expireReservations(db);
        if (expired.expired) console.log("[leads] reservations expired:", expired.expired);
      } catch (e) { console.error("[leads] reservation expiry failed:", e.message); }

      const isMonday = new Date(event.scheduledTime).getUTCDay() === 1;
      let scanSummary = null;
      if (isMonday) {
        try {
          const r = await runDiscovery(env, store);
          const okCount = r.sources.filter(s => s.status === "ok").length;
          scanSummary = `${okCount}/${r.sources.length} sources responded, ${r.new} new leads.`;
          console.log("[discovery] weekly:", scanSummary);
        } catch (e) {
          scanSummary = "Discovery scan failed: " + e.message;
          console.error("[discovery] weekly failed:", e.message);
        }
      } else {
        console.log("[discovery] skipped — runs Mondays only");
      }
      // Morning brief every day regardless, so deadlines and follow-ups still
      // surface daily even on days the scan didn't run.
      try {
        if (!env.RESEND_API_KEY || !env.DIGEST_TO) {
          console.log("[digest] skipped — RESEND_API_KEY / DIGEST_TO not configured");
          return;
        }
        const [leads, projects] = await Promise.all([
          store.get("discovered"), db.all("SELECT * FROM projects")
        ]);
        const digest = buildDigest({ leads: leads || [], projects, scanSummary });
        const appUrl = env.APP_URL || "";
        const sent = await sendEmail(env, {
          to: env.DIGEST_TO, subject: digest.subject,
          html: renderDigestHtml(digest, appUrl), text: renderDigestText(digest, appUrl)
        });
        console.log("[digest]", sent.sent ? "sent to " + env.DIGEST_TO : "not sent: " + sent.reason);
        if (sent.sent) {
          const meta = (await store.get("meta")) || {};
          await store.set("meta", { ...meta, lastDigestAt: new Date().toISOString() });
        }
      } catch (e) { console.error("[digest] failed:", e.message); }
    })());
  },

  /* ================= Email ingest (Cloudflare Email Routing) ================= */
  // Route e.g. leads@tinttechkc.com to this Worker, then auto-forward
  // BuildingConnected / PlanHub / GC ITB invitations to that address.
  async email(message, env, ctx) {
    const store = makeStore(env);
    const parsed = await PostalMime.parse(message.raw);
    const lead = emailToLead({
      from: parsed.from?.address || message.from,
      subject: parsed.subject || "",
      text: parsed.text || parsed.html || ""
    });
    await saveLead(store, lead);
  }
};
