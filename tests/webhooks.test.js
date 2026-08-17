import { test } from "node:test";
import assert from "node:assert";
import { signPayload, buildPayload, deliverWebhook } from "../src/webhooks.js";

function fakeDb() {
  const rows = [];
  return { _rows: rows, async run(sql, ...b) { rows.push(b); return { success: true }; } };
}

const lead = {
  lead_id: "LEAD-2026-000184", status: "DELIVERED", lead_price: 75,
  exclusivity: "shared", delivered_at: "2026-08-16T12:00:00Z",
  attribution_window_end: "2027-02-12T12:00:00Z"
};
const project = {
  name: "XYZ Medical Center Expansion", city: "Kansas City", state: "MO",
  general_contractor: "JE Dunn", bid_due: "2026-09-04", source_url: "https://sam.gov/opp/1"
};

test("payload carries the project facts a CRM needs", () => {
  const p = buildPayload({ lead, project, customer: { id: "c1", company_name: "ABC Window Films" } });
  assert.strictEqual(p.event, "lead.delivered");
  assert.strictEqual(p.lead.id, "LEAD-2026-000184");
  assert.strictEqual(p.project.generalContractor, "JE Dunn");
  assert.strictEqual(p.project.bidDue, "2026-09-04");
  assert.strictEqual(p.customer.company, "ABC Window Films");
});

test("missing project fields become null, never invented", () => {
  const p = buildPayload({ lead, project: { name: "Bare" }, customer: {} });
  assert.strictEqual(p.project.architect, null);
  assert.strictEqual(p.project.estimatedGlazingSqFt, null);
  assert.strictEqual(p.project.city, null);
});

test("the signature is stable for a body and changes with the secret", async () => {
  const body = JSON.stringify({ a: 1 });
  const a = await signPayload("secret1", body);
  const b = await signPayload("secret1", body);
  const c = await signPayload("secret2", body);
  assert.strictEqual(a, b);
  assert.notStrictEqual(a, c);
  assert.match(a, /^[0-9a-f]{64}$/);
});

test("a customer with no webhook is skipped, not failed", async () => {
  const db = fakeDb();
  const r = await deliverWebhook(db, { lead, project, customer: { id: "c1", webhook_enabled: 0 } });
  assert.strictEqual(r.status, "skipped");
  assert.strictEqual(db._rows.length, 0, "a skip should not write a delivery row");
});

test("a successful post is logged as delivered and signed", async () => {
  const db = fakeDb();
  let seenHeaders = null;
  global.fetch = async (url, opts) => { seenHeaders = opts.headers; return { ok: true, status: 200 }; };

  const r = await deliverWebhook(db, {
    lead, project,
    customer: { id: "c1", webhook_enabled: 1, webhook_url: "https://api.tinttechkc.com/v1/public/leads", webhook_secret: "s3cret" }
  });
  assert.strictEqual(r.status, "delivered");
  assert.ok(seenHeaders["x-bidhunter-signature"], "must sign when a secret is set");
  assert.strictEqual(db._rows[0][4], "delivered");
});

test("a broken receiver is recorded as failed and never throws", async () => {
  const db = fakeDb();
  global.fetch = async () => { throw new Error("ECONNREFUSED"); };

  const r = await deliverWebhook(db, {
    lead, project,
    customer: { id: "c1", webhook_enabled: 1, webhook_url: "https://down.example.com" }
  });
  assert.strictEqual(r.status, "failed");
  assert.match(r.error, /ECONNREFUSED/);
  assert.strictEqual(db._rows[0][4], "failed");
});

test("a non-2xx response is a failure, not a silent success", async () => {
  const db = fakeDb();
  global.fetch = async () => ({ ok: false, status: 500 });
  const r = await deliverWebhook(db, {
    lead, project,
    customer: { id: "c1", webhook_enabled: 1, webhook_url: "https://x.example.com" }
  });
  assert.strictEqual(r.status, "failed");
  assert.strictEqual(r.code, 500);
});

/* ------------------------------------------------------------------
   The TintOS bridge.

   TintOS validates /v1/public/leads with a strict whitelist
   (forbidNonWhitelisted), so ANY key outside its DTO rejects the entire
   request. These tests pin the exact allowed key set — if someone adds a
   field to the Bid Hunter payload without adding it to the receiver's DTO,
   this suite fails here rather than silently in production.
   ------------------------------------------------------------------ */
import { buildTintTechOsPayload } from "../src/webhooks.js";

const OS_ALLOWED_KEYS = new Set([
  "intakeKey", "name", "phone", "email", "city", "state", "message",
  "propertyType", "segment", "projectTitle", "estimatedValue",
  "solicitationNumber", "dueDate", "sourceUrl", "meta", "website_url"
]);

const fullProject = {
  name: "XYZ Medical Center Expansion", city: "Kansas City", state: "MO",
  address: "2401 Gillham Rd", general_contractor: "JE Dunn", architect: "HOK",
  owner: "XYZ Health", project_type: "Healthcare", bid_due: "2026-09-04",
  estimated_project_value: 4200000, estimated_glazing_square_feet: 12500,
  solicitation_number: "IFB-24-118", source_url: "https://sam.gov/opp/1", source: "SAM.gov"
};

test("TintOS payload emits only keys the receiver accepts", () => {
  const p = buildTintTechOsPayload({ lead, project: fullProject, customer: {}, intakeKey: "tk_bidhunter_abc" });
  for (const k of Object.keys(p)) {
    assert.ok(OS_ALLOWED_KEYS.has(k), `"${k}" is not in the TintOS DTO and would reject the request`);
  }
});

test("TintOS payload carries the intake key and marks the segment commercial", () => {
  const p = buildTintTechOsPayload({ lead, project: fullProject, customer: {}, intakeKey: "tk_bidhunter_abc" });
  assert.strictEqual(p.intakeKey, "tk_bidhunter_abc");
  assert.strictEqual(p.segment, "commercial");
  assert.strictEqual(p.projectTitle, "XYZ Medical Center Expansion");
  assert.strictEqual(p.solicitationNumber, "IFB-24-118");
  assert.strictEqual(p.estimatedValue, 4200000);
});

test("the Bid Hunter lead id survives into the CRM for round-trip attribution", () => {
  const p = buildTintTechOsPayload({ lead, project: fullProject, customer: {}, intakeKey: "k" });
  assert.strictEqual(p.meta.bidHunterLeadId, "LEAD-2026-000184");
  assert.strictEqual(p.meta.generalContractor, "JE Dunn");
});

test("receiver length limits are respected, not just hoped for", () => {
  const p = buildTintTechOsPayload({
    lead,
    project: { ...fullProject, name: "X".repeat(500), state: "Missouri" },
    customer: {}, intakeKey: "k"
  });
  assert.ok(p.projectTitle.length <= 300, "projectTitle exceeds the receiver's 300 cap");
  assert.ok(p.message.length <= 5000);
  // "Missouri" is 8 chars against a 2-char cap, so it's dropped rather than
  // sent and rejected.
  assert.strictEqual(p.state, undefined);
});

test("a sparse project produces a valid payload with no undefined keys", () => {
  const p = buildTintTechOsPayload({ lead, project: { name: "Bare Project" }, customer: {}, intakeKey: "k" });
  for (const [k, v] of Object.entries(p)) {
    assert.notStrictEqual(v, undefined, `${k} must be omitted rather than undefined`);
  }
  assert.strictEqual(p.name, "Bare Project");
  assert.ok(p.message.includes("LEAD-2026-000184"));
});

test("the tinttechos format is refused without an intake key rather than sent and bounced", async () => {
  const db = fakeDb();
  let called = false;
  global.fetch = async () => { called = true; return { ok: true, status: 200 }; };

  const r = await deliverWebhook(db, {
    lead, project: fullProject,
    customer: { id: "c1", webhook_enabled: 1, webhook_url: "https://api.tinttechkc.com/v1/public/leads",
                webhook_format: "tinttechos", webhook_auth_key: null }
  });
  assert.strictEqual(r.status, "skipped");
  assert.match(r.reason, /intake key/i);
  assert.strictEqual(called, false, "must not send a request it knows will fail");
});

test("format selection changes the body shape sent on the wire", async () => {
  const db = fakeDb();
  let sent = null;
  global.fetch = async (url, opts) => { sent = JSON.parse(opts.body); return { ok: true, status: 200 }; };

  await deliverWebhook(db, {
    lead, project: fullProject,
    customer: { id: "c1", webhook_enabled: 1, webhook_url: "https://x.example.com",
                webhook_format: "tinttechos", webhook_auth_key: "tk_1" }
  });
  assert.strictEqual(sent.intakeKey, "tk_1");
  assert.strictEqual(sent.event, undefined, "flat format must not carry the nested envelope");

  await deliverWebhook(db, {
    lead, project: fullProject,
    customer: { id: "c1", webhook_enabled: 1, webhook_url: "https://x.example.com", webhook_format: "generic" }
  });
  assert.strictEqual(sent.event, "lead.delivered");
  assert.strictEqual(sent.intakeKey, undefined);
});
