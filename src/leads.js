/* ============================================================
   leads.js — lead lifecycle, attribution, and the immutable event log.

   Design rule, borrowed from the rest of this codebase: the deterministic
   parts are pure functions with no database and no network, so they can be
   tested exhaustively. Anything touching D1 is a thin wrapper around them.

   Second rule, specific to this module: lead_events is APPEND ONLY.
   db.insert() in db.js uses INSERT OR REPLACE, which would silently
   overwrite an event on an id collision. Attribution history cannot be
   allowed to change, so appendEvent() writes with a plain INSERT.
   ============================================================ */

export const LEAD_STATUSES = [
  "DISCOVERED", "QUALIFIED", "DELIVERED", "VIEWED", "CLAIMED", "PURSUING",
  "BID_SUBMITTED", "AWAITING_RESULT", "WON", "LOST", "CANCELLED",
  "DECLINED", "RELEASED", "EXPIRED", "BILLABLE", "INVOICED", "PAID"
];

export const EVENT_TYPES = [
  "LEAD_CREATED", "LEAD_QUALIFIED", "LEAD_DELIVERED", "LEAD_VIEWED",
  "LEAD_CLAIMED", "LEAD_DECLINED", "LEAD_RELEASED", "LEAD_RESERVED", "RESERVATION_EXPIRED",
  "LEAD_PURSUING", "BID_SUBMITTED", "AWARD_SIGNAL", "AWARD_CONFIRMED",
  "LEAD_WON", "LEAD_LOST", "LEAD_CANCELLED", "TERMS_ACCEPTED",
  "LEAD_BILLABLE", "INVOICE_CREATED", "INVOICE_PAID",
  "DISPUTE_CREATED", "DISPUTE_RESOLVED", "EVENT_VOIDED"
];

/* ---------------- pure: identifiers ---------------- */

export function formatLeadId(year, number) {
  return `LEAD-${year}-${String(number).padStart(6, "0")}`;
}

/* ---------------- pure: status projection ----------------
   The stored leads.status column is a cache. This function recomputes it
   from the event log, which is the source of truth. If the two ever
   disagree, the events win — and disagreement is itself a bug worth
   surfacing rather than papering over.
   -------------------------------------------------------- */

// Later entries win. Ordering is by lifecycle progression, not by time,
// so an out-of-order event replay still lands on the right status.
const STATUS_RANK = {
  LEAD_CREATED: 1, LEAD_QUALIFIED: 2, LEAD_DELIVERED: 3, LEAD_VIEWED: 4,
  LEAD_CLAIMED: 5, LEAD_PURSUING: 6, BID_SUBMITTED: 7, AWARD_SIGNAL: 8,
  AWARD_CONFIRMED: 9, LEAD_WON: 10, LEAD_LOST: 10, LEAD_CANCELLED: 10,
  LEAD_DECLINED: 10, LEAD_RELEASED: 10, RESERVATION_EXPIRED: 3,
  LEAD_BILLABLE: 11, INVOICE_CREATED: 12, INVOICE_PAID: 13
};

const EVENT_TO_STATUS = {
  LEAD_CREATED: "DISCOVERED", LEAD_QUALIFIED: "QUALIFIED",
  LEAD_DELIVERED: "DELIVERED", LEAD_VIEWED: "VIEWED", LEAD_CLAIMED: "CLAIMED",
  LEAD_PURSUING: "PURSUING", BID_SUBMITTED: "BID_SUBMITTED",
  AWARD_SIGNAL: "AWAITING_RESULT", AWARD_CONFIRMED: "AWAITING_RESULT",
  LEAD_WON: "WON", LEAD_LOST: "LOST", LEAD_CANCELLED: "CANCELLED",
  LEAD_DECLINED: "DECLINED", LEAD_RELEASED: "RELEASED",
  RESERVATION_EXPIRED: "DELIVERED",
  LEAD_BILLABLE: "BILLABLE", INVOICE_CREATED: "INVOICED", INVOICE_PAID: "PAID"
};

export function deriveStatus(events = []) {
  let best = null, bestRank = 0;
  for (const e of events) {
    if (e.voided_at) continue;                  // voided events don't move status
    const rank = STATUS_RANK[e.event_type];
    if (rank === undefined) continue;
    if (rank >= bestRank) { bestRank = rank; best = e.event_type; }
  }
  return best ? EVENT_TO_STATUS[best] : "DISCOVERED";
}

/* ---------------- pure: what can happen next ---------------- */

export function allowedActions(status) {
  switch (status) {
    case "DELIVERED":
    case "VIEWED":      return ["claim", "decline", "reserve"];
    case "CLAIMED":     return ["pursuing", "release", "decline"];
    case "PURSUING":    return ["submit_bid", "release", "decline"];
    case "BID_SUBMITTED":
    case "AWAITING_RESULT": return ["report_won", "report_lost", "report_cancelled"];
    default:            return [];
  }
}

export function canTransition(status, action) {
  return allowedActions(status).includes(action);
}

/* ---------------- pure: claim eligibility ---------------- */

/**
 * Decides whether a customer may claim a lead right now.
 * `otherExclusiveClaim` is true when another customer already claimed this
 * project exclusively — the database enforces this too, but checking here
 * produces a readable message instead of a constraint violation.
 */
export function canClaim(lead, { now = new Date(), otherExclusiveClaim = false } = {}) {
  if (!lead) return { ok: false, reason: "Lead not found." };
  if (lead.claimed_at) return { ok: false, reason: "You have already claimed this lead." };
  if (lead.declined_at) return { ok: false, reason: "You passed on this lead." };
  if (!canTransition(lead.status, "claim"))
    return { ok: false, reason: `A lead in ${lead.status} cannot be claimed.` };
  if (otherExclusiveClaim)
    return { ok: false, reason: "This exclusive opportunity has already been claimed by another contractor." };

  // A reservation held by someone else blocks claiming until it lapses.
  if (lead.reserved_until && new Date(lead.reserved_until) > now && lead.reserved_by
      && lead.reserved_by !== lead.customer_id) {
    return { ok: false, reason: "This lead is reserved by another contractor until " + lead.reserved_until };
  }
  return { ok: true };
}

export function isReservationExpired(lead, now = new Date()) {
  return Boolean(lead?.reserved_until && new Date(lead.reserved_until) <= now);
}

/* ---------------- pure: attribution confidence ----------------
   Spec §14. Every point is tied to a recorded event, never to an
   assumption. A missing step lowers the score AND is named, so the number
   is defensible in a dispute rather than being an opaque percentage.
   -------------------------------------------------------------- */

const ATTRIBUTION_STEPS = [
  { key: "discovered", weight: 15, event: "LEAD_CREATED",
    yes: "Opportunity discovered by Tint Intelligence",
    no:  "No discovery record — origin of this opportunity is unproven" },
  { key: "delivered", weight: 20, event: "LEAD_DELIVERED",
    yes: "Lead delivered to the customer",
    no:  "No delivery record" },
  { key: "viewed", weight: 15, event: "LEAD_VIEWED",
    yes: "Customer opened the lead",
    no:  "Customer never opened the lead" },
  { key: "claimed", weight: 20, event: "LEAD_CLAIMED",
    yes: "Customer claimed the lead and accepted the terms",
    no:  "Customer never claimed the lead" },
  { key: "pursuing", weight: 10, event: "LEAD_PURSUING",
    yes: "Customer marked the project as being pursued",
    no:  "Customer never marked this as pursued" },
  { key: "bid", weight: 20, event: "BID_SUBMITTED",
    yes: "Customer submitted a bid on the project",
    no:  "No bid recorded — cannot show the lead was acted on" }
];

export function attributionConfidence(events = []) {
  const present = new Set(events.filter(e => !e.voided_at).map(e => e.event_type));
  let score = 0;
  const have = [], missing = [];

  for (const step of ATTRIBUTION_STEPS) {
    if (present.has(step.event)) { score += step.weight; have.push(step.yes); }
    else missing.push(step.no);
  }

  const awardConfirmed = present.has("AWARD_CONFIRMED");
  const awardSignalOnly = present.has("AWARD_SIGNAL") && !awardConfirmed;

  let label;
  if (score >= 90) label = "Strong";
  else if (score >= 65) label = "Moderate";
  else if (score >= 40) label = "Weak";
  else label = "Insufficient";

  return {
    score,
    label,
    have,
    missing,
    awardConfirmed,
    awardSignalOnly,
    // The honesty rule this codebase already applies elsewhere: a signal is
    // not a confirmation, and we say so rather than rounding up.
    note: awardSignalOnly
      ? "An award signal was detected but not confirmed. This is not proof the project was awarded."
      : null
  };
}

/* ---------------- pure: billing eligibility ----------------
   Whether the configured rule has been satisfied. This decides only
   ELIGIBILITY; creating the billable event is Phase E's job.
   ------------------------------------------------------------ */

export const RELEASE_REASONS = [
  "already_awarded",      // project was awarded before we delivered it
  "no_film_scope",        // documents show no window film work
  "wrong_location",       // outside the contractor's service area
  "bad_contact",          // GC/owner unreachable or wrong details
  "duplicate",            // same project already received from elsewhere
  "deadline_passed",      // bid date had already passed
  "inaccurate_listing",   // details materially differ from the listing
  "other"
];

/**
 * Whether a claimed lead can still be handed back. The window runs from
 * the claim, not the delivery — the clock should start when the contractor
 * actually opens the documents.
 */
export function canRelease(lead, customer, now = new Date()) {
  const hours = customer?.release_window_hours ?? 48;
  if (hours <= 0) return { ok: false, reason: "Released leads are not permitted on your account." };
  if (!lead?.claimed_at) return { ok: false, reason: "This lead has not been claimed." };
  if (lead.released_at) return { ok: false, reason: "This lead was already released." };
  if (lead.bid_submitted_at)
    return { ok: false, reason: "A lead with a submitted bid cannot be released." };
  if (!canTransition(lead.status, "release"))
    return { ok: false, reason: `A lead in ${lead.status} cannot be released.` };

  const deadline = new Date(new Date(lead.claimed_at).getTime() + hours * 3600000);
  if (now > deadline) {
    return { ok: false, reason: `The ${hours}-hour release window closed on ${deadline.toISOString().slice(0, 10)}.` };
  }
  return { ok: true, deadline: deadline.toISOString() };
}

/** Hours left to release, or null when releasing isn't available. */
export function releaseWindowRemaining(lead, customer, now = new Date()) {
  const check = canRelease(lead, customer, now);
  if (!check.ok) return null;
  return Math.max(0, (new Date(check.deadline) - now) / 3600000);
}

export function billingTrigger(lead, model) {
  // A released lead is never billable, even though claimed_at is still set.
  // The claim genuinely happened and stays in the event log; the charge
  // simply doesn't follow from it.
  if (lead.released_at) return { eligible: false, event: null, amountField: null, releasedAt: lead.released_at };
  switch (model) {
    case "delivered":     return { eligible: Boolean(lead.delivered_at), event: "LEAD_DELIVERED", amountField: "price_per_lead" };
    case "claimed":       return { eligible: Boolean(lead.claimed_at), event: "LEAD_CLAIMED", amountField: "price_per_claim" };
    case "bid_submitted": return { eligible: Boolean(lead.bid_submitted_at), event: "BID_SUBMITTED", amountField: "price_per_bid" };
    case "won":           return { eligible: Boolean(lead.award_confirmed_at && lead.won_at), event: "PROJECT_WON", amountField: "price_per_win" };
    default:              return { eligible: false, event: null, amountField: null };
  }
}

/**
 * The sentence shown to the customer BEFORE they take a billable action
 * (spec §54). Never let a charge be a surprise.
 */
export function billingDisclosure(model, prices = {}) {
  const money = n => `$${Number(n || 0).toLocaleString()}`;
  switch (model) {
    case "delivered":
      return `This lead was billed at ${money(prices.price_per_lead)} when it was delivered to you.`;
    case "claimed":
      return `Claiming this lead creates a ${money(prices.price_per_claim)} charge on your next quarterly invoice.`;
    case "bid_submitted":
      return `You are billed ${money(prices.price_per_bid)} only if you submit a bid on this project.`;
    case "won":
      return `You are billed ${money(prices.price_per_win)} only if you are awarded this project.`;
    default:
      return "Billing terms for this lead have not been configured. Contact us before proceeding.";
  }
}

/* ---------------- pure: timeline ---------------- */

const EVENT_LABELS = {
  LEAD_CREATED: "Lead discovered", LEAD_QUALIFIED: "Qualified",
  LEAD_DELIVERED: "Delivered to customer", LEAD_VIEWED: "Opened by customer",
  LEAD_CLAIMED: "Claimed", LEAD_DECLINED: "Passed on",
  LEAD_RELEASED: "Released back",
  LEAD_RESERVED: "Reserved", RESERVATION_EXPIRED: "Reservation expired",
  LEAD_PURSUING: "Marked as pursuing", BID_SUBMITTED: "Bid submitted",
  AWARD_SIGNAL: "Award signal detected", AWARD_CONFIRMED: "Award confirmed",
  LEAD_WON: "Project won", LEAD_LOST: "Project lost",
  LEAD_CANCELLED: "Project cancelled", TERMS_ACCEPTED: "Terms accepted",
  LEAD_BILLABLE: "Became billable", INVOICE_CREATED: "Invoiced",
  INVOICE_PAID: "Paid", DISPUTE_CREATED: "Dispute opened",
  DISPUTE_RESOLVED: "Dispute resolved", EVENT_VOIDED: "Event voided"
};

export function buildTimeline(events = []) {
  return [...events]
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
    .map(e => ({
      at: e.created_at,
      type: e.event_type,
      label: EVENT_LABELS[e.event_type] || e.event_type,
      actor: e.actor_label || (e.actor_type === "system" ? "System" : "—"),
      voided: Boolean(e.voided_at),
      metadata: safeJson(e.metadata)
    }));
}

function safeJson(s) { try { return s ? JSON.parse(s) : null; } catch { return null; } }

/* ---------------- persistence ---------------- */

function uid() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
const nowIso = () => new Date().toISOString();

/**
 * APPEND ONLY. Uses a plain INSERT, never INSERT OR REPLACE, so an event
 * can never overwrite an earlier one. There is deliberately no update or
 * delete function in this module for lead_events — voiding writes a
 * marker and keeps the original row.
 */
export async function appendEvent(db, {
  leadId, projectId, customerId, eventType, actorType = "system",
  actorId = null, actorLabel = null, metadata = null, ip = null, userAgent = null
}) {
  if (!EVENT_TYPES.includes(eventType)) throw new Error(`Unknown event type: ${eventType}`);
  const row = {
    id: uid(), lead_id: leadId, project_id: projectId || null,
    customer_id: customerId || null, event_type: eventType,
    actor_type: actorType, actor_id: actorId, actor_label: actorLabel,
    metadata: metadata ? JSON.stringify(metadata) : null,
    ip_address: ip, user_agent: (userAgent || "").slice(0, 300) || null,
    created_at: nowIso()
  };
  await db.run(
    `INSERT INTO lead_events
      (id, lead_id, project_id, customer_id, event_type, actor_type, actor_id,
       actor_label, metadata, ip_address, user_agent, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    row.id, row.lead_id, row.project_id, row.customer_id, row.event_type,
    row.actor_type, row.actor_id, row.actor_label, row.metadata,
    row.ip_address, row.user_agent, row.created_at
  );
  return row;
}

/** Allocates the next LEAD-YYYY-NNNNNN. Atomic via UPDATE ... RETURNING. */
export async function nextLeadId(db, year = new Date().getFullYear()) {
  await db.run(
    "INSERT INTO lead_counters (year, next_number) VALUES (?, 1) ON CONFLICT(year) DO NOTHING", year);
  const row = await db.first(
    "UPDATE lead_counters SET next_number = next_number + 1 WHERE year = ? RETURNING next_number", year);
  const assigned = (row?.next_number ?? 1) - 1;
  return formatLeadId(year, assigned);
}

export async function getEvents(db, leadRowId) {
  return db.all("SELECT * FROM lead_events WHERE lead_id = ? ORDER BY created_at ASC", leadRowId);
}

/**
 * Delivers a project to a customer as a new lead. Price and billing model
 * are frozen onto the lead now, so a later pricing change never re-prices
 * work already sent.
 */
export async function deliverLead(db, {
  projectId, customerId, exclusivity = "shared", attributionWindowDays = 180,
  actorId = null, actorLabel = null, priceOverride = null
}) {
  const project = await db.first("SELECT * FROM projects WHERE id = ?", projectId);
  if (!project) throw new Error("Project not found.");
  const customer = await db.first("SELECT * FROM customers WHERE id = ?", customerId);
  if (!customer) throw new Error("Customer not found.");
  if (customer.status !== "active") throw new Error(`${customer.company_name} is not an active customer.`);

  const dup = await db.first(
    "SELECT * FROM leads WHERE project_id = ? AND customer_id = ?", projectId, customerId);
  if (dup) throw new Error(`This project was already delivered to ${customer.company_name} as ${dup.lead_id}.`);

  if (exclusivity === "exclusive") {
    const claimed = await db.first(
      "SELECT lead_id FROM leads WHERE project_id = ? AND exclusivity = 'exclusive' AND claimed_at IS NOT NULL",
      projectId);
    if (claimed) throw new Error(`Another contractor already holds this project exclusively (${claimed.lead_id}).`);
  }

  const model = customer.billing_model || "claimed";
  const priceByModel = {
    delivered: customer.price_per_lead, claimed: customer.price_per_claim,
    bid_submitted: customer.price_per_bid, won: customer.price_per_win
  };
  const price = priceOverride ?? priceByModel[model] ?? 0;

  const at = nowIso();
  const windowEnd = new Date(Date.now() + attributionWindowDays * 86400000).toISOString();
  const leadIdText = await nextLeadId(db);

  const lead = await db.insert("leads", {
    lead_id: leadIdText,
    project_id: projectId,
    customer_id: customerId,
    status: "DELIVERED",
    source: project.source || null,
    delivery_method: "portal",
    lead_price: price,
    billing_model: model,
    billing_status: "NOT_BILLABLE",
    exclusivity,
    created_at: at,
    delivered_at: at,
    attribution_window_start: at,
    attribution_window_end: windowEnd,
    updated_at: at
  });

  // Two events: the discovery claim and the delivery. Both matter in a
  // dispute — the first is what makes it OUR lead.
  await appendEvent(db, {
    leadId: lead.id, projectId, customerId, eventType: "LEAD_CREATED",
    actorType: "system", metadata: { source: project.source, project_name: project.name }
  });
  await appendEvent(db, {
    leadId: lead.id, projectId, customerId, eventType: "LEAD_DELIVERED",
    actorType: actorId ? "admin" : "system", actorId, actorLabel,
    metadata: { price, billing_model: model, exclusivity }
  });

  return lead;
}

/** Records a view. Multiple views are logged, but viewed_at is set once. */
export async function recordView(db, lead, { userId, actorLabel, ip, userAgent }) {
  const patch = { view_count: (lead.view_count || 0) + 1 };
  if (!lead.viewed_at) {
    patch.viewed_at = nowIso();
    if (lead.status === "DELIVERED") patch.status = "VIEWED";
  }
  await db.update("leads", lead.id, patch);
  await appendEvent(db, {
    leadId: lead.id, projectId: lead.project_id, customerId: lead.customer_id,
    eventType: "LEAD_VIEWED", actorType: "contractor", actorId: userId,
    actorLabel, ip, userAgent,
    metadata: { view_number: patch.view_count, first_view: !lead.viewed_at }
  });
  return { ...lead, ...patch };
}

export async function claimLead(db, lead, { userId, actorLabel, ip, userAgent, terms }) {
  let otherExclusiveClaim = false;
  if (lead.exclusivity === "exclusive") {
    const other = await db.first(
      "SELECT id FROM leads WHERE project_id = ? AND id != ? AND exclusivity = 'exclusive' AND claimed_at IS NOT NULL",
      lead.project_id, lead.id);
    otherExclusiveClaim = Boolean(other);
  }

  const check = canClaim(lead, { otherExclusiveClaim });
  if (!check.ok) throw new Error(check.reason);

  const at = nowIso();
  await db.update("leads", lead.id, { status: "CLAIMED", claimed_at: at });

  if (terms?.version) {
    await db.insert("lead_terms_acceptances", {
      lead_id: lead.id, customer_id: lead.customer_id, user_id: userId,
      terms_version: terms.version, terms_hash: terms.hash,
      terms_text: terms.body || null,
      billing_disclosure: terms.disclosure || null,
      accepted_at: at, ip_address: ip, user_agent: (userAgent || "").slice(0, 300)
    });
    await appendEvent(db, {
      leadId: lead.id, projectId: lead.project_id, customerId: lead.customer_id,
      eventType: "TERMS_ACCEPTED", actorType: "contractor", actorId: userId, actorLabel,
      ip, userAgent, metadata: { version: terms.version, hash: terms.hash, disclosure: terms.disclosure }
    });
  }

  await appendEvent(db, {
    leadId: lead.id, projectId: lead.project_id, customerId: lead.customer_id,
    eventType: "LEAD_CLAIMED", actorType: "contractor", actorId: userId, actorLabel,
    ip, userAgent, metadata: { price: lead.lead_price, billing_model: lead.billing_model }
  });

  return db.first("SELECT * FROM leads WHERE id = ?", lead.id);
}

export async function markPursuing(db, lead, ctx) {
  if (!canTransition(lead.status, "pursuing"))
    throw new Error(`A lead in ${lead.status} cannot be marked as pursuing.`);
  const at = nowIso();
  await db.update("leads", lead.id, { status: "PURSUING", pursuing_at: at });
  await appendEvent(db, {
    leadId: lead.id, projectId: lead.project_id, customerId: lead.customer_id,
    eventType: "LEAD_PURSUING", actorType: "contractor",
    actorId: ctx.userId, actorLabel: ctx.actorLabel, ip: ctx.ip, userAgent: ctx.userAgent
  });
  return db.first("SELECT * FROM leads WHERE id = ?", lead.id);
}

export async function submitBid(db, lead, { amount, bidDate, notes, userId, actorLabel, ip, userAgent }) {
  if (!canTransition(lead.status, "submit_bid"))
    throw new Error(`A lead in ${lead.status} cannot record a bid.`);
  const value = Number(amount);
  if (!Number.isFinite(value) || value <= 0) throw new Error("Enter the bid amount.");

  const at = bidDate || nowIso();
  await db.update("leads", lead.id, {
    status: "BID_SUBMITTED", bid_submitted_at: at, bid_amount: value,
    customer_notes: notes || lead.customer_notes
  });
  await appendEvent(db, {
    leadId: lead.id, projectId: lead.project_id, customerId: lead.customer_id,
    eventType: "BID_SUBMITTED", actorType: "contractor", actorId: userId, actorLabel,
    ip, userAgent, metadata: { bid_amount: value, bid_date: at, notes: notes || null }
  });
  return db.first("SELECT * FROM leads WHERE id = ?", lead.id);
}

export async function reportOutcome(db, lead, {
  outcome, awardAmount, lossReason, notes, userId, actorLabel, ip, userAgent
}) {
  const map = { won: "report_won", lost: "report_lost", cancelled: "report_cancelled" };
  if (!map[outcome]) throw new Error("Outcome must be won, lost, or cancelled.");
  if (!canTransition(lead.status, map[outcome]))
    throw new Error(`A lead in ${lead.status} cannot report an outcome yet.`);

  const at = nowIso();
  const patch = { customer_notes: notes || lead.customer_notes };
  let eventType;

  if (outcome === "won") {
    patch.status = "WON"; patch.won_at = at;
    patch.award_amount = Number(awardAmount) || null;
    eventType = "LEAD_WON";
  } else if (outcome === "lost") {
    patch.status = "LOST"; patch.lost_at = at; patch.loss_reason = lossReason || null;
    eventType = "LEAD_LOST";
  } else {
    patch.status = "CANCELLED"; eventType = "LEAD_CANCELLED";
  }

  await db.update("leads", lead.id, patch);
  await appendEvent(db, {
    leadId: lead.id, projectId: lead.project_id, customerId: lead.customer_id,
    eventType, actorType: "contractor", actorId: userId, actorLabel, ip, userAgent,
    metadata: {
      award_amount: patch.award_amount ?? null,
      loss_reason: lossReason || null,
      // A customer-reported win is not the same as a verified one. Phase D
      // and the admin review queue decide whether this becomes billable.
      self_reported: true
    }
  });
  return db.first("SELECT * FROM leads WHERE id = ?", lead.id);
}

export async function declineLead(db, lead, { reason, userId, actorLabel, ip, userAgent }) {
  if (!canTransition(lead.status, "decline"))
    throw new Error(`A lead in ${lead.status} cannot be declined.`);
  const at = nowIso();
  await db.update("leads", lead.id, {
    status: "DECLINED", declined_at: at, decline_reason: reason || null
  });
  await appendEvent(db, {
    leadId: lead.id, projectId: lead.project_id, customerId: lead.customer_id,
    eventType: "LEAD_DECLINED", actorType: "contractor", actorId: userId, actorLabel,
    ip, userAgent, metadata: { reason: reason || null }
  });
  return db.first("SELECT * FROM leads WHERE id = ?", lead.id);
}

/**
 * Hands a claimed lead back. The claim event is NOT voided — it happened,
 * and the attribution log is append-only. A LEAD_RELEASED event is
 * appended alongside it, and the billing guard in billingTrigger() stops
 * the charge from following.
 */
export async function releaseLead(db, lead, customer, { reason, detail, userId, actorLabel, ip, userAgent }) {
  const check = canRelease(lead, customer);
  if (!check.ok) throw new Error(check.reason);
  if (!reason || !RELEASE_REASONS.includes(reason)) {
    throw new Error(`A reason is required. One of: ${RELEASE_REASONS.join(", ")}`);
  }

  const at = nowIso();
  await db.update("leads", lead.id, {
    status: "RELEASED",
    released_at: at,
    release_reason: reason,
    release_detail: detail || null,
    billing_status: "NOT_BILLABLE"
  });

  await appendEvent(db, {
    leadId: lead.id, projectId: lead.project_id, customerId: lead.customer_id,
    eventType: "LEAD_RELEASED", actorType: "contractor", actorId: userId, actorLabel,
    ip, userAgent,
    metadata: {
      reason, detail: detail || null,
      claimed_at: lead.claimed_at,
      hours_held: ((new Date(at) - new Date(lead.claimed_at)) / 3600000).toFixed(1),
      forfeited_charge: lead.lead_price
    }
  });

  return db.first("SELECT * FROM leads WHERE id = ?", lead.id);
}

/**
 * Release rate per discovery source. This is the reason the release window
 * is worth building: it turns "that lead was junk" into a number that says
 * which sources are worth the spend.
 */
export async function releaseAnalytics(db, { since = null } = {}) {
  const rows = await db.all(
    `SELECT source,
            COUNT(*) AS claimed,
            SUM(CASE WHEN released_at IS NOT NULL THEN 1 ELSE 0 END) AS released,
            SUM(CASE WHEN released_at IS NOT NULL THEN lead_price ELSE 0 END) AS forfeited
       FROM leads
      WHERE claimed_at IS NOT NULL ${since ? "AND claimed_at >= ?" : ""}
      GROUP BY source
      ORDER BY released DESC`,
    ...(since ? [since] : []));

  const reasons = await db.all(
    `SELECT source, release_reason, COUNT(*) AS n
       FROM leads
      WHERE released_at IS NOT NULL ${since ? "AND released_at >= ?" : ""}
      GROUP BY source, release_reason
      ORDER BY n DESC`,
    ...(since ? [since] : []));

  return (rows || []).map(r => ({
    source: r.source || "unknown",
    claimed: r.claimed,
    released: r.released,
    releaseRate: r.claimed ? +((100 * r.released) / r.claimed).toFixed(1) : 0,
    forfeited: r.forfeited || 0,
    topReasons: (reasons || [])
      .filter(x => (x.source || "unknown") === (r.source || "unknown"))
      .slice(0, 3)
      .map(x => ({ reason: x.release_reason, count: x.n }))
  }));
}

export async function reserveLead(db, lead, { hours = 48, userId, actorLabel }) {
  if (lead.claimed_at) throw new Error("This lead is already claimed.");
  const until = new Date(Date.now() + hours * 3600000).toISOString();
  await db.update("leads", lead.id, { reserved_until: until });
  await appendEvent(db, {
    leadId: lead.id, projectId: lead.project_id, customerId: lead.customer_id,
    eventType: "LEAD_RESERVED", actorType: "contractor", actorId: userId, actorLabel,
    metadata: { hours, until }
  });
  return db.first("SELECT * FROM leads WHERE id = ?", lead.id);
}

/** Cron helper: releases reservations that have lapsed without a claim. */
export async function expireReservations(db, now = new Date()) {
  const stale = await db.all(
    "SELECT * FROM leads WHERE reserved_until IS NOT NULL AND reserved_until <= ? AND claimed_at IS NULL",
    now.toISOString());
  for (const lead of stale) {
    await db.update("leads", lead.id, { reserved_until: null });
    await appendEvent(db, {
      leadId: lead.id, projectId: lead.project_id, customerId: lead.customer_id,
      eventType: "RESERVATION_EXPIRED", actorType: "system",
      metadata: { was_reserved_until: lead.reserved_until }
    });
  }
  return { expired: stale.length };
}

/** Full attribution record for one lead (spec §13). */
export async function attributionRecord(db, lead) {
  const events = await getEvents(db, lead.id);
  const confidence = attributionConfidence(events);
  const derived = deriveStatus(events);
  return {
    lead_id: lead.lead_id,
    project_id: lead.project_id,
    customer_id: lead.customer_id,
    status: lead.status,
    derivedStatus: derived,
    // If these disagree the event log is authoritative; surfacing the
    // mismatch beats silently trusting a cached column.
    statusMatchesEvents: derived === lead.status,
    timeline: buildTimeline(events),
    confidence,
    attributionWindow: {
      start: lead.attribution_window_start,
      end: lead.attribution_window_end,
      open: lead.attribution_window_end
        ? new Date(lead.attribution_window_end) > new Date() : null
    },
    billing: {
      model: lead.billing_model,
      price: lead.lead_price,
      status: lead.billing_status,
      trigger: billingTrigger(lead, lead.billing_model)
    }
  };
}

export async function activeTerms(db) {
  return db.first("SELECT * FROM lead_terms_versions WHERE is_active = 1 ORDER BY created_at DESC");
}
