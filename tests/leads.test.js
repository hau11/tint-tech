import { test } from "node:test";
import assert from "node:assert";
import {
  formatLeadId, deriveStatus, allowedActions, canTransition, canClaim,
  isReservationExpired, attributionConfidence, billingTrigger, billingDisclosure,
  buildTimeline, appendEvent, nextLeadId, getEvents, deliverLead, recordView,
  claimLead, markPursuing, submitBid, reportOutcome, declineLead, reserveLead,
  expireReservations, attributionRecord
} from "../src/leads.js";

/* ------------------------------------------------------------------
   In-memory stand-in for the D1 db object. Mirrors the real semantics
   that matter here: db.insert is INSERT OR REPLACE (so it CAN overwrite),
   while appendEvent uses db.run with a plain INSERT (so it cannot).
   ------------------------------------------------------------------ */
function fakeDb() {
  const t = {
    leads: [], lead_events: [], projects: [], customers: [],
    lead_counters: [], lead_terms_acceptances: [], lead_terms_versions: []
  };
  let seq = 0;
  const uid = () => `id_${++seq}`;

  const db = {
    _t: t,
    async insert(table, obj) {
      const row = { id: obj.id || uid(), created_at: obj.created_at || new Date().toISOString(), ...obj };
      const i = t[table].findIndex(r => r.id === row.id);
      if (i >= 0) t[table][i] = row; else t[table].push(row);   // INSERT OR REPLACE
      return row;
    },
    async update(table, id, patch) {
      const row = t[table].find(r => r.id === id);
      if (!row) return null;
      Object.assign(row, patch, { updated_at: new Date().toISOString() });
      return row;
    },
    async first(sql, ...b) {
      if (sql.includes("FROM projects WHERE id")) return t.projects.find(r => r.id === b[0]) || null;
      if (sql.includes("FROM customers WHERE id")) return t.customers.find(r => r.id === b[0]) || null;
      if (sql.includes("FROM leads WHERE id = ? AND customer_id"))
        return t.leads.find(r => r.id === b[0] && r.customer_id === b[1]) || null;
      if (sql.includes("FROM leads WHERE id = ? OR lead_id"))
        return t.leads.find(r => r.id === b[0] || r.lead_id === b[1]) || null;
      if (sql.includes("FROM leads WHERE id")) return t.leads.find(r => r.id === b[0]) || null;
      if (sql.includes("FROM leads WHERE project_id = ? AND customer_id"))
        return t.leads.find(r => r.project_id === b[0] && r.customer_id === b[1]) || null;
      if (sql.includes("exclusivity = 'exclusive' AND claimed_at IS NOT NULL")) {
        if (sql.includes("id != ?"))
          return t.leads.find(r => r.project_id === b[0] && r.id !== b[1] && r.exclusivity === "exclusive" && r.claimed_at) || null;
        return t.leads.find(r => r.project_id === b[0] && r.exclusivity === "exclusive" && r.claimed_at) || null;
      }
      if (sql.includes("FROM lead_terms_versions WHERE is_active"))
        return t.lead_terms_versions.find(r => r.is_active === 1) || null;
      if (sql.startsWith("UPDATE lead_counters")) {
        const row = t.lead_counters.find(r => r.year === b[0]);
        row.next_number += 1;
        return { next_number: row.next_number };
      }
      return null;
    },
    async all(sql, ...b) {
      if (sql.includes("FROM lead_events WHERE lead_id"))
        return t.lead_events.filter(e => e.lead_id === b[0])
          .sort((x, y) => String(x.created_at).localeCompare(String(y.created_at)));
      if (sql.includes("reserved_until IS NOT NULL"))
        return t.leads.filter(l => l.reserved_until && l.reserved_until <= b[0] && !l.claimed_at);
      return [];
    },
    async run(sql, ...b) {
      if (sql.startsWith("INSERT INTO lead_events")) {
        const [id, lead_id, project_id, customer_id, event_type, actor_type,
               actor_id, actor_label, metadata, ip_address, user_agent, created_at] = b;
        if (t.lead_events.some(e => e.id === id)) throw new Error("PRIMARY KEY constraint failed");
        t.lead_events.push({ id, lead_id, project_id, customer_id, event_type, actor_type,
          actor_id, actor_label, metadata, ip_address, user_agent, created_at, voided_at: null });
        return { success: true };
      }
      if (sql.includes("INSERT INTO lead_counters")) {
        if (!t.lead_counters.some(r => r.year === b[0])) t.lead_counters.push({ year: b[0], next_number: 1 });
        return { success: true };
      }
      if (sql.startsWith("UPDATE lead_events SET voided_at")) {
        const ev = t.lead_events.find(e => e.id === b[3]);
        if (ev) { ev.voided_at = b[0]; ev.voided_by = b[1]; ev.void_reason = b[2]; }
        return { success: true };
      }
      return { success: true };
    }
  };
  return db;
}

async function seed(db, { billing_model = "claimed", exclusivity = "shared" } = {}) {
  await db.insert("projects", { id: "proj1", name: "XYZ Medical Center Expansion", source: "SAM.gov" });
  await db.insert("customers", {
    id: "cust1", company_name: "ABC Window Films", status: "active",
    billing_model, price_per_lead: 50, price_per_claim: 75, price_per_bid: 250, price_per_win: 500
  });
  await db.insert("customers", {
    id: "cust2", company_name: "XYZ Tint", status: "active",
    billing_model, price_per_lead: 50, price_per_claim: 100, price_per_bid: 250, price_per_win: 500
  });
  return db;
}

const ctx = { userId: "u1", actorLabel: "Dave", ip: "1.2.3.4", userAgent: "test" };

/* ---------------- pure functions ---------------- */

test("lead IDs are zero-padded and year-scoped", () => {
  assert.strictEqual(formatLeadId(2026, 184), "LEAD-2026-000184");
  assert.strictEqual(formatLeadId(2026, 1), "LEAD-2026-000001");
});

test("status is derived from events, with terminal outcomes winning", () => {
  assert.strictEqual(deriveStatus([]), "DISCOVERED");
  assert.strictEqual(deriveStatus([{ event_type: "LEAD_DELIVERED" }]), "DELIVERED");
  assert.strictEqual(deriveStatus([
    { event_type: "LEAD_DELIVERED" }, { event_type: "LEAD_VIEWED" }, { event_type: "LEAD_CLAIMED" }
  ]), "CLAIMED");
  assert.strictEqual(deriveStatus([
    { event_type: "LEAD_CLAIMED" }, { event_type: "BID_SUBMITTED" }, { event_type: "LEAD_WON" }
  ]), "WON");
});

test("out-of-order events still derive the correct status", () => {
  // Ranked by lifecycle progression, not array order.
  assert.strictEqual(deriveStatus([
    { event_type: "LEAD_CLAIMED" }, { event_type: "LEAD_DELIVERED" }, { event_type: "LEAD_VIEWED" }
  ]), "CLAIMED");
});

test("voided events do not move status", () => {
  assert.strictEqual(deriveStatus([
    { event_type: "LEAD_DELIVERED" },
    { event_type: "LEAD_CLAIMED", voided_at: "2026-01-01T00:00:00Z" }
  ]), "DELIVERED");
});

test("allowed actions match the lifecycle stage", () => {
  assert.deepStrictEqual(allowedActions("DELIVERED"), ["claim", "decline", "reserve"]);
  // "release" was added with the release window — a claimed lead can be
  // handed back inside the window without a charge.
  assert.deepStrictEqual(allowedActions("CLAIMED"), ["pursuing", "release", "decline"]);
  assert.deepStrictEqual(allowedActions("PURSUING"), ["submit_bid", "release", "decline"]);
  assert.deepStrictEqual(allowedActions("WON"), []);
  assert.strictEqual(canTransition("DELIVERED", "submit_bid"), false);
});

test("attribution confidence is 100 only with the complete chain", () => {
  const full = ["LEAD_CREATED", "LEAD_DELIVERED", "LEAD_VIEWED", "LEAD_CLAIMED",
                "LEAD_PURSUING", "BID_SUBMITTED"].map(event_type => ({ event_type }));
  const r = attributionConfidence(full);
  assert.strictEqual(r.score, 100);
  assert.strictEqual(r.label, "Strong");
  assert.strictEqual(r.missing.length, 0);
});

test("attribution confidence names what is missing", () => {
  const r = attributionConfidence([{ event_type: "LEAD_CREATED" }, { event_type: "LEAD_DELIVERED" }]);
  assert.strictEqual(r.score, 35);
  assert.strictEqual(r.label, "Insufficient");
  assert.ok(r.missing.some(m => /never opened/i.test(m)));
  assert.ok(r.missing.some(m => /No bid recorded/i.test(m)));
});

test("an award signal is never reported as a confirmation", () => {
  const r = attributionConfidence([{ event_type: "LEAD_DELIVERED" }, { event_type: "AWARD_SIGNAL" }]);
  assert.strictEqual(r.awardConfirmed, false);
  assert.strictEqual(r.awardSignalOnly, true);
  assert.match(r.note, /not proof/i);
});

test("billing triggers fire only on the configured event", () => {
  const lead = { delivered_at: "x", claimed_at: null, bid_submitted_at: null };
  assert.strictEqual(billingTrigger(lead, "delivered").eligible, true);
  assert.strictEqual(billingTrigger(lead, "claimed").eligible, false);
  assert.strictEqual(billingTrigger({ ...lead, claimed_at: "y" }, "claimed").eligible, true);
});

test("winning-model billing requires a CONFIRMED award, not a self-reported win", () => {
  assert.strictEqual(billingTrigger({ won_at: "x", award_confirmed_at: null }, "won").eligible, false);
  assert.strictEqual(billingTrigger({ won_at: "x", award_confirmed_at: "y" }, "won").eligible, true);
});

test("the billing disclosure states the real price before the action", () => {
  const msg = billingDisclosure("claimed", { price_per_claim: 75 });
  assert.match(msg, /\$75/);
  assert.match(msg, /Claiming this lead/i);
  assert.match(billingDisclosure("won", { price_per_win: 500 }), /only if you are awarded/i);
  assert.match(billingDisclosure("nonsense", {}), /not been configured/i);
});

test("claim eligibility blocks a second exclusive claim", () => {
  const lead = { status: "DELIVERED", claimed_at: null };
  assert.strictEqual(canClaim(lead, { otherExclusiveClaim: true }).ok, false);
  assert.strictEqual(canClaim(lead, { otherExclusiveClaim: false }).ok, true);
  assert.strictEqual(canClaim({ ...lead, claimed_at: "x" }).ok, false);
});

test("reservation expiry is a time comparison, not a guess", () => {
  const past = new Date(Date.now() - 1000).toISOString();
  const future = new Date(Date.now() + 100000).toISOString();
  assert.strictEqual(isReservationExpired({ reserved_until: past }), true);
  assert.strictEqual(isReservationExpired({ reserved_until: future }), false);
  assert.strictEqual(isReservationExpired({}), false);
});

/* ---------------- persistence + immutability ---------------- */

test("lead IDs increment without collision", async () => {
  const db = fakeDb();
  const a = await nextLeadId(db, 2026);
  const b = await nextLeadId(db, 2026);
  assert.strictEqual(a, "LEAD-2026-000001");
  assert.strictEqual(b, "LEAD-2026-000002");
});

test("the event log is append-only — a duplicate id is rejected, not overwritten", async () => {
  const db = fakeDb();
  await appendEvent(db, { leadId: "L1", eventType: "LEAD_DELIVERED" });
  const first = db._t.lead_events[0];
  await assert.rejects(
    () => db.run("INSERT INTO lead_events", first.id, "L1", null, null, "LEAD_CLAIMED",
      "system", null, null, null, null, null, new Date().toISOString()),
    /PRIMARY KEY/);
  assert.strictEqual(db._t.lead_events.length, 1);
  assert.strictEqual(db._t.lead_events[0].event_type, "LEAD_DELIVERED");
});

test("unknown event types are refused", async () => {
  const db = fakeDb();
  await assert.rejects(() => appendEvent(db, { leadId: "L1", eventType: "MADE_UP" }), /Unknown event type/);
});

test("delivering a lead records both discovery and delivery", async () => {
  const db = await seed(fakeDb());
  const lead = await deliverLead(db, { projectId: "proj1", customerId: "cust1" });
  assert.strictEqual(lead.status, "DELIVERED");
  assert.strictEqual(lead.lead_price, 75);          // claimed model -> price_per_claim
  const events = await getEvents(db, lead.id);
  assert.deepStrictEqual(events.map(e => e.event_type), ["LEAD_CREATED", "LEAD_DELIVERED"]);
});

test("the same project cannot be delivered to the same customer twice", async () => {
  const db = await seed(fakeDb());
  await deliverLead(db, { projectId: "proj1", customerId: "cust1" });
  await assert.rejects(() => deliverLead(db, { projectId: "proj1", customerId: "cust1" }),
    /already delivered/i);
});

test("one project can go to two customers as two separate leads", async () => {
  const db = await seed(fakeDb());
  const a = await deliverLead(db, { projectId: "proj1", customerId: "cust1" });
  const b = await deliverLead(db, { projectId: "proj1", customerId: "cust2" });
  assert.notStrictEqual(a.lead_id, b.lead_id);
  assert.strictEqual(a.project_id, b.project_id);
});

test("an inactive customer cannot receive leads", async () => {
  const db = await seed(fakeDb());
  await db.update("customers", "cust1", { status: "paused" });
  await assert.rejects(() => deliverLead(db, { projectId: "proj1", customerId: "cust1" }),
    /not an active customer/i);
});

test("multiple views are logged but count as one lead", async () => {
  const db = await seed(fakeDb());
  let lead = await deliverLead(db, { projectId: "proj1", customerId: "cust1" });
  lead = await recordView(db, lead, ctx);
  const firstViewedAt = lead.viewed_at;
  assert.strictEqual(lead.status, "VIEWED");

  lead = await recordView(db, await db.first("SELECT * FROM leads WHERE id = ?", lead.id), ctx);
  assert.strictEqual(lead.viewed_at, firstViewedAt, "viewed_at must not move on re-view");
  assert.strictEqual(lead.view_count, 2);
  assert.strictEqual(db._t.leads.length, 1, "a re-view must never create a second lead");

  const views = (await getEvents(db, lead.id)).filter(e => e.event_type === "LEAD_VIEWED");
  assert.strictEqual(views.length, 2);
});

test("an exclusive lead can only be claimed by one contractor", async () => {
  const db = await seed(fakeDb());
  const a = await deliverLead(db, { projectId: "proj1", customerId: "cust1", exclusivity: "exclusive" });
  await claimLead(db, a, ctx);

  // The second delivery is blocked at delivery time once one is claimed.
  await assert.rejects(
    () => deliverLead(db, { projectId: "proj1", customerId: "cust2", exclusivity: "exclusive" }),
    /already holds this project exclusively/i);
});

test("actions are refused out of order", async () => {
  const db = await seed(fakeDb());
  const lead = await deliverLead(db, { projectId: "proj1", customerId: "cust1" });
  await assert.rejects(() => submitBid(db, lead, { ...ctx, amount: 100000 }), /cannot record a bid/i);
  await assert.rejects(() => markPursuing(db, lead, ctx), /cannot be marked as pursuing/i);
});

test("a bid requires a real amount", async () => {
  const db = await seed(fakeDb());
  let lead = await deliverLead(db, { projectId: "proj1", customerId: "cust1" });
  lead = await claimLead(db, lead, ctx);
  lead = await markPursuing(db, lead, ctx);
  await assert.rejects(() => submitBid(db, lead, { ...ctx, amount: 0 }), /bid amount/i);
  await assert.rejects(() => submitBid(db, lead, { ...ctx, amount: "abc" }), /bid amount/i);
});

test("declining a lead closes it", async () => {
  const db = await seed(fakeDb());
  const lead = await deliverLead(db, { projectId: "proj1", customerId: "cust1" });
  const out = await declineLead(db, lead, { ...ctx, reason: "Outside our territory" });
  assert.strictEqual(out.status, "DECLINED");
  assert.strictEqual(out.decline_reason, "Outside our territory");
});

test("lapsed reservations are released and logged", async () => {
  const db = await seed(fakeDb());
  const lead = await deliverLead(db, { projectId: "proj1", customerId: "cust1" });
  await reserveLead(db, lead, { ...ctx, hours: 48 });
  await db.update("leads", lead.id, { reserved_until: new Date(Date.now() - 1000).toISOString() });

  const r = await expireReservations(db);
  assert.strictEqual(r.expired, 1);
  const after = await db.first("SELECT * FROM leads WHERE id = ?", lead.id);
  assert.strictEqual(after.reserved_until, null);
  assert.ok((await getEvents(db, lead.id)).some(e => e.event_type === "RESERVATION_EXPIRED"));
});

test("claiming records the terms the customer actually saw", async () => {
  const db = await seed(fakeDb());
  const lead = await deliverLead(db, { projectId: "proj1", customerId: "cust1" });
  await claimLead(db, lead, {
    ...ctx,
    terms: { version: "v1.0", hash: "abc123", body: "Lead terms text", disclosure: "Claiming creates a $75 charge." }
  });
  const acc = db._t.lead_terms_acceptances[0];
  assert.strictEqual(acc.terms_version, "v1.0");
  assert.strictEqual(acc.terms_hash, "abc123");
  assert.match(acc.billing_disclosure, /\$75/);
  assert.ok((await getEvents(db, lead.id)).some(e => e.event_type === "TERMS_ACCEPTED"));
});

/* ---------------- the spec's acceptance scenario (§65) ---------------- */

test("ACCEPTANCE: deliver -> view -> claim -> pursue -> $100k bid -> won, with a full audit trail", async () => {
  const db = await seed(fakeDb());

  // 1-3. Admin delivers Lead A to Customer B; delivery is recorded.
  let lead = await deliverLead(db, {
    projectId: "proj1", customerId: "cust1", actorId: "admin1", actorLabel: "operator"
  });
  assert.match(lead.lead_id, /^LEAD-\d{4}-\d{6}$/);
  assert.ok(lead.delivered_at);

  // 4-6. Customer views it.
  lead = await recordView(db, lead, ctx);
  assert.ok(lead.viewed_at);

  // 7-8. Customer claims it.
  lead = await claimLead(db, await db.first("SELECT * FROM leads WHERE id = ?", lead.id), {
    ...ctx, terms: { version: "v1.0", hash: "h", body: "terms", disclosure: "Claiming creates a $75 charge." }
  });
  assert.strictEqual(lead.status, "CLAIMED");

  // 9. Pursuing.
  lead = await markPursuing(db, lead, ctx);
  assert.strictEqual(lead.status, "PURSUING");

  // 10-11. A $100,000 bid is recorded.
  lead = await submitBid(db, lead, { ...ctx, amount: 100000, notes: "Security film, levels 2-3" });
  assert.strictEqual(lead.status, "BID_SUBMITTED");
  assert.strictEqual(lead.bid_amount, 100000);

  // 16. Outcome reported as won.
  lead = await reportOutcome(db, lead, { ...ctx, outcome: "won", awardAmount: 100000 });
  assert.strictEqual(lead.status, "WON");
  assert.strictEqual(lead.award_amount, 100000);

  // 24. The complete timeline survives, in order.
  const record = await attributionRecord(db, lead);
  assert.deepStrictEqual(
    record.timeline.map(t => t.type),
    ["LEAD_CREATED", "LEAD_DELIVERED", "LEAD_VIEWED", "TERMS_ACCEPTED",
     "LEAD_CLAIMED", "LEAD_PURSUING", "BID_SUBMITTED", "LEAD_WON"]
  );
  assert.strictEqual(record.confidence.score, 100);
  assert.strictEqual(record.confidence.label, "Strong");
  assert.strictEqual(record.statusMatchesEvents, true);

  // A self-reported win is NOT yet a confirmed award, so a win-based rule
  // must not consider this billable (spec §56).
  assert.strictEqual(billingTrigger(lead, "won").eligible, false);
  assert.strictEqual(record.confidence.awardConfirmed, false);
});

test("the timeline is ordered by time, not by insertion", () => {
  const t = buildTimeline([
    { event_type: "LEAD_CLAIMED", created_at: "2026-08-04T10:00:00Z" },
    { event_type: "LEAD_DELIVERED", created_at: "2026-08-03T10:00:00Z" }
  ]);
  assert.deepStrictEqual(t.map(x => x.type), ["LEAD_DELIVERED", "LEAD_CLAIMED"]);
  assert.strictEqual(t[0].label, "Delivered to customer");
});

/* ---------------- release window ---------------- */
import { canRelease, releaseWindowRemaining, releaseLead, RELEASE_REASONS } from "../src/leads.js";

const CUST = { release_window_hours: 48 };
const hoursAgo = h => new Date(Date.now() - h * 3600000).toISOString();

test("a claimed lead can be released inside the window", () => {
  const lead = { status: "CLAIMED", claimed_at: hoursAgo(2) };
  const r = canRelease(lead, CUST);
  assert.strictEqual(r.ok, true);
  assert.ok(r.deadline);
});

test("the window closes on time", () => {
  const lead = { status: "CLAIMED", claimed_at: hoursAgo(49) };
  const r = canRelease(lead, CUST);
  assert.strictEqual(r.ok, false);
  assert.match(r.reason, /release window closed/i);
});

test("the clock starts at the claim, not the delivery", () => {
  // Delivered a week ago but only claimed an hour ago — still releasable.
  const lead = { status: "CLAIMED", delivered_at: hoursAgo(168), claimed_at: hoursAgo(1) };
  assert.strictEqual(canRelease(lead, CUST).ok, true);
});

test("a lead with a submitted bid can never be released", () => {
  const lead = { status: "BID_SUBMITTED", claimed_at: hoursAgo(1), bid_submitted_at: hoursAgo(0.5) };
  const r = canRelease(lead, CUST);
  assert.strictEqual(r.ok, false);
  assert.match(r.reason, /submitted bid/i);
});

test("releases can be disabled per customer", () => {
  const lead = { status: "CLAIMED", claimed_at: hoursAgo(1) };
  const r = canRelease(lead, { release_window_hours: 0 });
  assert.strictEqual(r.ok, false);
  assert.match(r.reason, /not permitted/i);
});

test("an unclaimed lead cannot be released", () => {
  assert.strictEqual(canRelease({ status: "DELIVERED", claimed_at: null }, CUST).ok, false);
});

test("releasing twice is refused", () => {
  const lead = { status: "RELEASED", claimed_at: hoursAgo(1), released_at: hoursAgo(0.5) };
  assert.strictEqual(canRelease(lead, CUST).ok, false);
});

test("remaining hours count down and go null once unavailable", () => {
  assert.ok(releaseWindowRemaining({ status: "CLAIMED", claimed_at: hoursAgo(2) }, CUST) > 45);
  assert.strictEqual(releaseWindowRemaining({ status: "CLAIMED", claimed_at: hoursAgo(50) }, CUST), null);
});

test("a released lead is not billable, even on the claimed model", () => {
  const claimed = { claimed_at: hoursAgo(2), released_at: null };
  assert.strictEqual(billingTrigger(claimed, "claimed").eligible, true);

  const released = { claimed_at: hoursAgo(2), released_at: hoursAgo(1) };
  assert.strictEqual(billingTrigger(released, "claimed").eligible, false);
  // Released beats every model, not just the one that would have charged.
  for (const m of ["delivered", "claimed", "bid_submitted", "won"]) {
    assert.strictEqual(billingTrigger({ ...released, delivered_at: "x", bid_submitted_at: "x",
      won_at: "x", award_confirmed_at: "x" }, m).eligible, false, `${m} must not bill a released lead`);
  }
});

test("releasing requires a reason from the known list", async () => {
  const db = await seed(fakeDb());
  let lead = await deliverLead(db, { projectId: "proj1", customerId: "cust1" });
  lead = await claimLead(db, lead, ctx);
  const customer = await db.first("SELECT * FROM customers WHERE id = ?", "cust1");

  await assert.rejects(() => releaseLead(db, lead, customer, { ...ctx, reason: null }), /reason is required/i);
  await assert.rejects(() => releaseLead(db, lead, customer, { ...ctx, reason: "because" }), /reason is required/i);
});

test("releasing keeps the claim in the log and appends a release event", async () => {
  const db = await seed(fakeDb());
  let lead = await deliverLead(db, { projectId: "proj1", customerId: "cust1" });
  lead = await claimLead(db, lead, ctx);
  const customer = await db.first("SELECT * FROM customers WHERE id = ?", "cust1");

  const out = await releaseLead(db, lead, customer, {
    ...ctx, reason: "no_film_scope", detail: "Spec has no film section."
  });
  assert.strictEqual(out.status, "RELEASED");
  assert.strictEqual(out.release_reason, "no_film_scope");

  const types = (await getEvents(db, lead.id)).map(e => e.event_type);
  // The claim is history and stays. Attribution is append-only.
  assert.ok(types.includes("LEAD_CLAIMED"), "the claim event must survive a release");
  assert.ok(types.includes("LEAD_RELEASED"));

  const rel = (await getEvents(db, lead.id)).find(e => e.event_type === "LEAD_RELEASED");
  const meta = JSON.parse(rel.metadata);
  assert.strictEqual(meta.reason, "no_film_scope");
  assert.strictEqual(meta.forfeited_charge, 75);
});

test("status derives to RELEASED from the event log", () => {
  assert.strictEqual(deriveStatus([
    { event_type: "LEAD_DELIVERED" }, { event_type: "LEAD_CLAIMED" }, { event_type: "LEAD_RELEASED" }
  ]), "RELEASED");
});

test("release is offered from CLAIMED and PURSUING only", () => {
  assert.ok(allowedActions("CLAIMED").includes("release"));
  assert.ok(allowedActions("PURSUING").includes("release"));
  assert.ok(!allowedActions("DELIVERED").includes("release"));
  assert.ok(!allowedActions("BID_SUBMITTED").includes("release"));
});

test("the reason list is a closed set", () => {
  assert.ok(RELEASE_REASONS.includes("already_awarded"));
  assert.ok(RELEASE_REASONS.includes("no_film_scope"));
  assert.ok(RELEASE_REASONS.includes("other"));
});
