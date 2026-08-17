/* ============================================================
   webhooks.js — outbound lead delivery to a customer's own system.

   When a lead is delivered to a customer who has a webhook configured, we
   POST it to their URL. That is the mechanism Tint Tech KC uses to pipe
   Bid Hunter leads into TintOS, and it works identically for any
   other customer pointing at their own CRM.

   Requests are signed with HMAC-SHA256 over the raw body so the receiver
   can verify the call actually came from us. Never let a receiver trust an
   unauthenticated POST that creates records.
   ============================================================ */

const enc = new TextEncoder();

export async function signPayload(secret, body) {
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(body));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Flattens a lead into the shape TintOS's /v1/public/leads endpoint
 * validates. That endpoint runs a strict whitelist (forbidNonWhitelisted),
 * so any field not in its DTO causes the whole request to be rejected —
 * this function must emit those keys and nothing else.
 *
 * Keeping the mapping here rather than loosening the receiver's validation
 * is the point: neither application knows the other's internals, and Tint
 * Tech OS's public intake API stays generic enough for the website and any
 * future source to use unchanged.
 */
export function buildTintTechOsPayload({ lead, project, customer, intakeKey }) {
  const contactName = project?.general_contractor || project?.owner || project?.name || "Bid Hunter lead";

  const message = [
    project?.name ? `Project: ${project.name}` : null,
    project?.project_type ? `Type: ${project.project_type}` : null,
    project?.estimated_glazing_square_feet
      ? `Estimated glazing: ${Number(project.estimated_glazing_square_feet).toLocaleString()} SF` : null,
    project?.architect ? `Architect: ${project.architect}` : null,
    project?.owner ? `Owner: ${project.owner}` : null,
    project?.address ? `Address: ${project.address}` : null,
    `Delivered by Bid Hunter as ${lead.lead_id}.`
  ].filter(Boolean).join("\n");

  const payload = {
    intakeKey,
    name: String(contactName).slice(0, 200),
    city: project?.city ? String(project.city).slice(0, 120) : undefined,
    // The receiver caps state at 2 characters, so anything longer is
    // dropped rather than sent and rejected.
    state: project?.state && String(project.state).length <= 2 ? project.state : undefined,
    message: message.slice(0, 5000),
    propertyType: project?.project_type ? String(project.project_type).slice(0, 120) : undefined,
    // Bid Hunter only ever surfaces commercial construction opportunities.
    segment: "commercial",
    projectTitle: project?.name ? String(project.name).slice(0, 300) : undefined,
    estimatedValue: Number.isFinite(Number(project?.estimated_project_value))
      ? Number(project.estimated_project_value) : undefined,
    solicitationNumber: project?.solicitation_number
      ? String(project.solicitation_number).slice(0, 120) : undefined,
    dueDate: project?.bid_due ? String(project.bid_due).slice(0, 40) : undefined,
    sourceUrl: project?.source_url ? String(project.source_url).slice(0, 1000) : undefined,
    meta: {
      bidHunterLeadId: lead.lead_id,
      leadPrice: lead.lead_price,
      exclusivity: lead.exclusivity,
      deliveredAt: lead.delivered_at,
      generalContractor: project?.general_contractor || null,
      architect: project?.architect || null,
      source: project?.source || null
    }
  };

  // Strip undefined so the JSON body contains only real values.
  for (const k of Object.keys(payload)) if (payload[k] === undefined) delete payload[k];
  return payload;
}

/** The shape sent to the customer's endpoint. Stable — treat as a contract. */
export function buildPayload({ lead, project, customer }) {
  return {
    event: "lead.delivered",
    sentAt: new Date().toISOString(),
    lead: {
      id: lead.lead_id,
      status: lead.status,
      price: lead.lead_price,
      exclusivity: lead.exclusivity,
      deliveredAt: lead.delivered_at,
      portalUrl: `/portal.html`,     // relative; receiver prefixes our origin
      attributionWindowEnd: lead.attribution_window_end
    },
    project: {
      name: project?.name || null,
      city: project?.city || null,
      state: project?.state || null,
      address: project?.address || null,
      generalContractor: project?.general_contractor || null,
      architect: project?.architect || null,
      owner: project?.owner || null,
      projectType: project?.project_type || null,
      bidDue: project?.bid_due || null,
      prebidDate: project?.prebid_date || null,
      estimatedValue: project?.estimated_project_value ?? null,
      estimatedGlazingSqFt: project?.estimated_glazing_square_feet ?? null,
      sourceUrl: project?.source_url || null,
      source: project?.source || null
    },
    customer: { id: customer?.id || null, company: customer?.company_name || null }
  };
}

/**
 * Fire the webhook. Deliberately never throws into the caller: a customer's
 * broken endpoint must not roll back a lead delivery that already happened
 * in our database. Failures are logged and surfaced in the admin UI instead.
 */
export async function deliverWebhook(db, { lead, project, customer }) {
  if (!customer?.webhook_enabled || !customer?.webhook_url) {
    return { status: "skipped", reason: "No webhook configured for this customer." };
  }

  const format = customer.webhook_format || "generic";
  if (format === "tinttechos" && !customer.webhook_auth_key) {
    // Fail loudly rather than sending a request the receiver will reject.
    return { status: "skipped", reason: "TintOS format needs an intake key (webhook_auth_key)." };
  }

  const payload = format === "tinttechos"
    ? buildTintTechOsPayload({ lead, project, customer, intakeKey: customer.webhook_auth_key })
    : buildPayload({ lead, project, customer });
  const body = JSON.stringify(payload);
  const at = new Date().toISOString();

  const headers = { "content-type": "application/json", "user-agent": "BidHunter-Webhook/1" };
  if (customer.webhook_secret) {
    headers["x-bidhunter-signature"] = await signPayload(customer.webhook_secret, body);
  }

  let status = "failed", code = null, error = null;
  try {
    const res = await fetch(customer.webhook_url, { method: "POST", headers, body });
    code = res.status;
    status = res.ok ? "delivered" : "failed";
    if (!res.ok) error = `Receiver returned ${res.status}`;
  } catch (e) {
    error = e.message || "Network error";
  }

  await db.run(
    `INSERT INTO webhook_deliveries
       (id, customer_id, lead_id, url, status, response_code, error, attempt, payload, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    crypto.randomUUID(), customer.id, lead.lead_id, customer.webhook_url,
    status, code, error, 1, body, at
  );

  return { status, code, error };
}
