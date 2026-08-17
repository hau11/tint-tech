# Lead Attribution & Billing — Phase B (leads + attribution) SHIPPED

`npm test` is **296/296** (229 original + 19 Phase A + 29 Phase B, and the
19 earlier ones still pass). No existing route, table, or behaviour changed.

## The model

A **project** is discovered once and is global. A **lead** is the delivery
of that project to one customer. That split is the whole design: the same
project can go to three contractors as three leads, each with its own
lifecycle, price, and billing, without duplicating project data or the
document intelligence attached to it.

## Migration `0008_leads_attribution.sql`

- **`leads`** — `lead_id` (LEAD-2026-000184), project, customer, status,
  every lifecycle timestamp, frozen price, exclusivity, reservation, and
  the attribution window.
- **`lead_events`** — **append only**. The evidence that you found the
  opportunity, delivered it, and the customer acted on it.
- **`lead_terms_acceptances`** / **`lead_terms_versions`** — configurable
  terms, and a record of exactly which text each customer accepted.
- **`lead_counters`** — per-year sequence. `UPDATE ... RETURNING` is atomic
  in SQLite, so two simultaneous deliveries cannot get the same number.

### Constraints doing real work

```sql
-- the same project is never delivered to the same customer twice
CREATE UNIQUE INDEX leads_project_customer_idx ON leads (project_id, customer_id);

-- at most one CLAIMED exclusive lead per project — enforced by the
-- database, not only by application logic
CREATE UNIQUE INDEX leads_exclusive_claim_idx ON leads (project_id)
  WHERE exclusivity = 'exclusive' AND claimed_at IS NOT NULL;
```

## `src/leads.js`

Follows this codebase's existing split: deterministic logic as pure
functions (no DB, no network, exhaustively tested), with thin persistence
wrappers around them.

**The event log is the source of truth.** `leads.status` is a cache.
`deriveStatus(events)` recomputes it, ranked by lifecycle progression
rather than array order, so an out-of-order replay still lands correctly
and voided events stop counting. `attributionRecord()` returns
`statusMatchesEvents` — if the cache and the log ever disagree, that
surfaces instead of being silently trusted.

**`appendEvent()` uses a plain `INSERT`, never `db.insert()`.** The
existing `db.insert()` helper is `INSERT OR REPLACE`, which would silently
overwrite an event on an id collision. Attribution history that can be
rewritten isn't evidence. There is deliberately no update or delete for
`lead_events` in this module — voiding writes a marker and keeps the row.

**Attribution confidence** (§14) scores the six-step chain and *names what
is missing*, so the number is defensible in a dispute rather than an
opaque percentage: "Customer never opened the lead", "No bid recorded —
cannot show the lead was acted on".

**An award signal is never reported as a confirmation** (§56). A
`won`-model billing trigger requires `award_confirmed_at`, not a
customer's self-reported win. A self-reported win carries
`self_reported: true` in its event metadata.

## Routes

```
# Contractor portal — every query scoped by session customer_id
GET  /api/portal/leads[?status=]
GET  /api/portal/summary          counts + quarter-to-date charges
GET  /api/portal/leads/:id        records the view, returns project intel
POST /api/portal/leads/:id/claim      requires acceptTerms
POST /api/portal/leads/:id/pursuing
POST /api/portal/leads/:id/bid        { amount, bidDate, notes }
POST /api/portal/leads/:id/outcome    { outcome: won|lost|cancelled, ... }
POST /api/portal/leads/:id/decline
POST /api/portal/leads/:id/reserve    { hours }

# Admin
GET  /api/admin/leads[?status=&customer=&billing=&q=]
POST /api/admin/leads/deliver     { projectId, customerIds[], exclusivity }
GET  /api/admin/leads/:id
GET  /api/admin/leads/:id/attribution
POST /api/admin/lead-events/:id/void   { reason }   -- marks, never deletes
GET  /api/admin/activity          live feed
GET/POST /api/admin/terms
```

Customer isolation is the Phase A chokepoint plus a second scoping in
every portal query: `WHERE customer_id = ?` with the id taken from the
session, never from the URL or body. Guessing another customer's lead id
returns 404.

## Behaviours worth knowing

- **Multiple views are one lead.** `view_count` increments and every view
  is logged, but `viewed_at` is set once and never moves.
- **Price is frozen at delivery.** Changing a customer's pricing later
  never re-prices leads already sent.
- **Claiming requires accepting terms** when an active terms version
  exists — and the acceptance stores a hash of the exact text shown, plus
  the exact price sentence, not just a version number.
- **Partial delivery failures are reported honestly.** Delivering to five
  customers where two fail returns both lists rather than a blanket OK.
- **Reservations expire on the existing daily cron**, releasing the lead
  and logging `RESERVATION_EXPIRED`.

## One implementation note

`worker.js` uses `leads` as a local variable name in three digest routes
and the cron. The module is therefore imported as `leadFlow` — shadowing
it would put the module in a temporal dead zone inside those blocks and
throw at runtime. Their code was left untouched.

## Not yet built

- Customer portal **UI** (Phase C) — the API is complete, the screens are not
- Award detection + review queue (Phase D)
- Billable events, invoices, Stripe (Phase E) — `billingTrigger()` decides
  eligibility, but nothing creates a charge yet
- Notifications for claim/bid/win (Phase F)

## Before Phase C

Create an active terms version, or claiming works without recording
consent:

```bash
curl -X POST .../api/admin/terms -u "admin:$APP_PASSWORD" \
  -H "content-type: application/json" \
  -d '{"version":"v1.0","body":"<your lead terms>","activate":true}'
```

Your own lawyer should write that text — the system stores and proves
consent, it does not supply the language.
