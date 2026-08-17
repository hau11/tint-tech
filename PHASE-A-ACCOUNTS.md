# Lead Attribution & Billing — Phase A (accounts) SHIPPED

Turning a single-operator tool into a multi-customer SaaS. Phase A is the
foundation the attribution and billing system sits on: until a *customer*
exists as a first-class record, there is nothing to attribute a lead to or
bill for.

**Nothing existing was changed.** Every V1 and V2 route, table, and test
still works. `npm test` is 248/248 (229 original + 19 new).

## The finding that drove this phase

Before Phase A, `authorized()` compared one shared `APP_PASSWORD` against
HTTP Basic auth. There were no users, no sessions, no roles, and none of
the 25 tables carried a customer column. Every project was implicitly
yours. That's correct for a tool you run alone, and unworkable the moment
contractors log in and get invoiced.

## What's in

### Migration `0007_accounts.sql` — three new tables

- **`customers`** — the paying contractor company. Carries billing config
  (`billing_cycle` defaults to `quarterly`, `billing_model`, and a price
  per lead / claim / bid / win) and territory preferences used later to
  decide who gets which lead.
- **`users`** — a login. `role` is `admin` or `contractor`. Admin users
  have `customer_id NULL` and see everything; a contractor user is bound
  to exactly one customer and cannot be created without one (enforced in
  code, not just convention).
- **`sessions`** — server-side sessions with expiry and revocation.

### `src/auth.js`

- **Passwords**: PBKDF2-SHA256, 210,000 iterations, 16-byte random salt,
  stored as `pbkdf2$<iterations>$<salt>$<hash>`. Workers has no bcrypt (it's
  a native module), and PBKDF2 via WebCrypto is the correct available
  choice — not a compromise.
- **Sessions**: the cookie carries a random 256-bit token; the database
  stores only its SHA-256. A dump of the `sessions` table cannot be
  replayed as a login. Cookie is `HttpOnly; Secure; SameSite=Lax`, 12-hour
  TTL.
- **Lockout**: 8 failed attempts locks the account for 15 minutes.
- **Enumeration resistance**: a login attempt for a username that doesn't
  exist still runs a full PBKDF2 hash, so response time doesn't reveal
  which usernames are real. Wrong-user and wrong-password return the
  identical message.
- **`identify()`** resolves a request to `admin`, `contractor`, or
  `legacy-admin` (your existing `APP_PASSWORD`, kept working so your
  bookmark and the email-ingest token don't break).

### Routes

```
POST /api/auth/login              username + password -> session cookie
POST /api/auth/logout
GET  /api/auth/me                 current user + their customer
POST /api/auth/change-password    revokes every other session on success

GET  /api/admin/customers         admin only
POST /api/admin/customers         creates company + optional first login
GET  /api/admin/customers/:id     includes that customer's users
PUT  /api/admin/customers/:id
POST /api/admin/users
PUT  /api/admin/users/:id
POST /api/admin/users/:id/reset-password
```

### The authorization chokepoint

One check in `worker.js` handles customer isolation:

```js
if (actor.kind === "contractor" && path.startsWith("/api/")
    && !auth.contractorMayAccess(path)) {
  return json({ error: "Not authorized" }, 403);
}
```

A contractor session can reach `/api/portal/*` and its own auth routes.
Everything else — every V2 route, the admin surface, discovery, pricing —
returns 403. This is deliberately a default-deny allowlist: a route added
later is admin-only until someone explicitly opens it to the portal, which
is the safe direction for a mistake to fall.

### Tests (`tests/auth.test.js`, 19)

Salted hashing, wrong-password rejection, malformed-hash handling, token
uniqueness, hash-not-token storage, cookie flags, identical failure for
bad user vs. bad password, lockout, disabled accounts, unique
case-insensitive usernames, contractor-requires-customer, session
resolution to the right customer, revocation, expiry, garbage cookies,
legacy `APP_PASSWORD`, and the contractor route allowlist.

## Setting up your first contractor

```bash
npx wrangler d1 migrations apply tint-intelligence --remote
```

Then, signed in as admin:

```bash
curl -X POST https://your-worker.workers.dev/api/admin/customers \
  -u "admin:$APP_PASSWORD" \
  -H "content-type: application/json" \
  -d '{
    "company_name": "ABC Window Films",
    "contact_name": "Dave Reyes",
    "email": "dave@abcwindowfilms.com",
    "state": "MO",
    "billing_cycle": "quarterly",
    "billing_model": "claimed",
    "price_per_claim": 75,
    "price_per_win": 500,
    "username": "abcwindowfilms",
    "password": "temporary-password-here"
  }'
```

That creates the company and its first login in one call. The user is
flagged `must_change_password`, so the portal will force a reset on first
sign-in.

## Environment

No new variables. `APP_PASSWORD` keeps its existing meaning.

Set `APP_PASSWORD` before sharing any URL — with it unset, `identify()`
has no legacy path and `authorized()` used to return `true` for everyone.

## What Phase A deliberately does NOT do

- No lead records, delivery, or attribution yet (Phase B)
- No customer portal UI yet (Phase C) — the API is there, the screens aren't
- No billing, invoices, or Stripe (Phase E)
- Admin UI still uses `APP_PASSWORD` basic auth. It works, but it produces
  no user id, so admin actions can't be attributed to a person in the audit
  trail. Worth creating yourself a real admin account once the portal login
  screen exists.

## Next: Phase B

`leads` + an immutable `lead_events` log, with `lead.status` as a
projection recomputable from events rather than a field that can silently
disagree with history. Then delivery → view → claim → pursuing → bid →
win/loss, exclusivity, and reservation.

One thing to settle before B: with quarterly billing and `billing_model`
defaulting to `claimed`, a contractor who claims 12 leads in a quarter at
$75 sees a $900 invoice 90 days later. That's a large, surprising number
if they haven't been watching. The portal should show a running
"this quarter so far" total on every screen — cheap to build in Phase C,
and it's the difference between an invoice that gets paid and one that
gets disputed.
