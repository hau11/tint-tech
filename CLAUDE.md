# Bid Hunter — project context

Commercial construction lead-generation SaaS for window film contractors.
Finds bid opportunities, analyzes plans and specs, and delivers qualified
leads to paying contractor customers with full attribution tracking.

Also called "Tint Intelligence AI". Same app.

## Stack

Cloudflare Workers (single `src/worker.js` entry), D1 (SQLite), R2 for
documents, KV for cache. Frontend is React built with esbuild into two
bundles. No framework, no ORM, no build step for the worker itself.

```bash
npm test              # node --test, 327 passing — keep it that way
npm run build         # builds public/app.js and public/portal.js
npx wrangler dev      # local
npx wrangler deploy
npx wrangler d1 migrations apply bid-hunter --remote
```

## Layout

```
src/worker.js      HTTP + cron entry. 110KB. All routing lives here.
src/db.js          D1 data access layer
src/auth.js        accounts, PBKDF2 passwords, sessions
src/leads.js       lead lifecycle + immutable attribution events
src/webhooks.js    outbound lead delivery to a customer's own CRM
src/engines.js     deterministic scoring/takeoff math (no AI)
src/analyze.js     Claude-backed document analysis
frontend/app.jsx   admin UI (300KB bundle)
frontend/portal.jsx contractor portal (168KB bundle)
migrations/        D1 migrations, applied in order
tests/             node --test, pure-function heavy
```

## Non-negotiable rules in this codebase

**Never fabricate data.** `analyze.js` has an explicit anti-fabrication
layer and the pricing engines are deterministic arithmetic with AI kept
out of every financial calculation. Keep it that way. If a number can't be
derived, show that it's unknown rather than estimating it.

**`db.insert()` is `INSERT OR REPLACE`.** It silently overwrites on id
collision. Never use it for `lead_events` or any immutable record.
`leads.js:appendEvent()` uses a plain INSERT for exactly this reason, and
`tests/leads.test.js` proves a duplicate id is rejected.

**The lead event log is append-only.** No update, no delete. Voiding an
event writes a marker and keeps the original row. `leads.status` is a cache;
`deriveStatus(events)` is the truth, and `attributionRecord()` returns
`statusMatchesEvents` so a mismatch surfaces instead of being trusted.

**Billing is on CLAIM, invoiced quarterly.** `billing_model` defaults to
`'claimed'`. A contractor commits money before opening the documents, so a
**release window** (default 48h from the claim, per-customer configurable)
lets them hand a lead back with a required reason and no charge. A released
lead is never billable under any model — `billingTrigger()` checks
`released_at` first. The claim event is never voided; attribution is
append-only and the release is a second event alongside it.

The release reasons are the point, not a concession: `/api/admin/leads/release-analytics`
shows release rate and forfeited revenue **per discovery source**, which is
what tells you whether SAM.gov or BlueBook is worth the spend.

**A self-reported win is not a confirmed award.** `billingTrigger(lead,'won')`
requires `award_confirmed_at`. A customer clicking "we won" flags the event
`self_reported: true` and does not make the lead billable.

**Customer isolation is a single chokepoint** in `worker.js`: a contractor
session may only reach `/api/portal/*`. It's a default-deny allowlist, so a
route added later is admin-only until someone opens it deliberately. Every
portal query is additionally scoped `WHERE customer_id = ?` from the
session — never from the URL or body.

**`leads` is a local variable name** in three digest/cron blocks in
`worker.js`. The module is imported as `leadFlow`. Shadowing it throws at
runtime via temporal dead zone.

## Auth model

- Contractors: username + password → server-side session cookie. PBKDF2-SHA256
  at 210k iterations (Workers has no bcrypt — this is the correct choice,
  not a compromise). Only the SHA-256 of the session token is stored.
- Operator: legacy `APP_PASSWORD` HTTP Basic still works and is
  admin-equivalent. It produces no user id, so admin actions can't be
  attributed to a person — worth creating a real admin account eventually.

## What's built

Phases A (accounts), B (leads + attribution), C (portal UI) are done, plus
outbound webhooks. Discovery, document analysis, takeoffs, pricing, and bid
packets predate that work and were already in production.

## What's next

- **Phase D** — award detection + human review queue. Note: public award
  data covers government solicitations well and private GC-to-subcontractor
  awards almost never. Build the manual review queue as the primary path
  and automation as the assist, not the reverse.
- **Phase E** — billable events (unique constraint on
  customer_id + lead_id + event_type), quarterly invoices, Stripe with
  verified webhook signatures. Never trust a client-side payment claim.
- **Phase F** — notifications, activity feed, reports, CSV export.
- **Overdue refactor**: extract a router from `worker.js`.
- **Webhook retry**: a failed outbound delivery is logged but not retried.
  A Cloudflare Queue with backoff is the right fix.

The original 67-section spec is the source of truth for D/E/F.

## Testing conventions

`node --test`, plain JS, no framework. Deterministic logic lives in pure
functions with no DB and no network so it can be tested exhaustively; DB
code gets a small in-memory fake (see the top of `tests/leads.test.js`).
Follow that split for anything new.
