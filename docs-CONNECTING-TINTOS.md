# Connecting Bid Hunter to TintOS

Two separate applications. Separate repos, separate stacks, separate
databases, separate deploys, separate failure domains. The only thing
crossing between them is **one signed HTTP POST**.

```
Bid Hunter (Cloudflare Workers + D1)
  │
  │  POST + HMAC signature, on every lead delivery
  ├──────────────► ABC Window Films' CRM        (format: generic)
  ├──────────────► XYZ Tint's CRM               (format: generic)
  └──────────────► TintOS                 (format: tinttechos)
                     ▲
   tinttechkc.com ───┘   already wired to the same intake endpoint
```

Nothing is shared: no database, no auth, no library. Either app can be
rebuilt, redeployed, or taken offline without touching the other. If Tint
Tech OS is down, Bid Hunter records the webhook failure and the lead still
exists in Bid Hunter — the contractor sees it in the portal regardless.

## Why a webhook and not a merge

Bid Hunter is a product you **sell to other window film contractors**. Tint
Tech OS runs **your own business**. Merging them would put competitors'
bid data inside your company's CRM, which is both a trust problem and a
sales objection you can't answer. Keeping them separate is part of the
product, not just an engineering preference.

The upside: "send leads straight to your CRM" is a feature every customer
wants. Built once, sold to everyone, and you happen to be customer #1.

## Setup

### 1. Apply the new migrations (Bid Hunter)

```bash
npx wrangler d1 migrations apply bid-hunter --remote
# 0009_outbound_webhooks.sql, 0010_webhook_format.sql
```

### 2. Get an intake key from TintOS

```sql
select public.issue_intake_key(
  (select id from public.organizations where slug = 'tint-tech-kc'),
  'Bid Hunter', 'bidhunter', '{}'          -- empty origins = server-to-server
);
-- returns: tk_bidhunter_9f2c8a...
```

### 3. Point Tint Tech KC's Bid Hunter customer record at it

```bash
curl -X PUT https://your-worker.workers.dev/api/admin/customers/<id>/webhook \
  -u "admin:$APP_PASSWORD" \
  -H "content-type: application/json" \
  -d '{
    "enabled": true,
    "url": "https://api.tinttechkc.com/v1/public/leads",
    "format": "tinttechos",
    "authKey": "tk_bidhunter_9f2c8a...",
    "secret": "a-long-random-string-you-generate"
  }'
```

For any other contractor pointing at their own CRM, use
`"format": "generic"` and omit `authKey`.

## What happens on delivery

1. You deliver a project to a customer in Bid Hunter.
2. The lead is written to D1 with its `LEAD-YYYY-NNNNNN` id and the full
   attribution event chain. **This always happens first.**
3. If that customer has a webhook enabled, Bid Hunter POSTs the lead.
4. Success or failure is recorded in `webhook_deliveries` either way.
5. TintOS's intake endpoint dedupes, creates the contact and an
   opportunity on the New Lead stage, tagged `source: 'bidhunter'`.

A webhook failure **never rolls back the delivery**. The lead exists in Bid
Hunter regardless, and the contractor sees it in the portal. That ordering
is deliberate: a customer's broken endpoint must not be able to erase a
lead you've already delivered and may bill for.

## The two payload formats

**`generic`** — Bid Hunter's own nested envelope, for any receiver:

```json
{ "event": "lead.delivered", "sentAt": "...",
  "lead": { "id": "LEAD-2026-000184", "price": 75, ... },
  "project": { "name": "...", "generalContractor": "...", "bidDue": "..." },
  "customer": { "id": "...", "company": "..." } }
```

**`tinttechos`** — flattened to exactly what TintOS validates:

```json
{ "intakeKey": "tk_bidhunter_...", "name": "JE Dunn", "city": "Kansas City",
  "state": "MO", "segment": "commercial", "projectTitle": "...",
  "estimatedValue": 4200000, "solicitationNumber": "IFB-24-118",
  "dueDate": "2026-09-04", "sourceUrl": "...",
  "meta": { "bidHunterLeadId": "LEAD-2026-000184", ... } }
```

TintOS runs a **strict whitelist** on that endpoint
(`forbidNonWhitelisted`), so a single unexpected key rejects the whole
request. `tests/webhooks.test.js` pins the allowed key set — add a field to
the payload without adding it to the receiver's DTO and the test suite
fails there, not in production at 2am.

Note `meta.bidHunterLeadId`: the Bid Hunter lead id travels into the CRM,
so a job you eventually win in TintOS can be traced back to the exact
lead that produced it.

## Verifying the signature on the receiving end

Every POST carries `x-bidhunter-signature`, an HMAC-SHA256 of the raw body
using the shared secret. Verify it before trusting the request:

```js
const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
if (!timingSafeEqual(Buffer.from(expected), Buffer.from(received))) reject();
```

TintOS's intake endpoint currently authenticates on the `intakeKey`
alone. Adding signature verification there is a worthwhile hardening step —
the key is a bearer credential, while the signature proves the body wasn't
altered in transit.

## Watching it work

```
GET /api/admin/customers/<id>/webhook
```

Returns the current config (never the secret or intake key) plus the last
25 delivery attempts with status codes and errors. A webhook that fails
silently is worse than no webhook, because the customer believes their CRM
has the lead when it doesn't.

## Known limitations

- **No retry yet.** A failed delivery is logged but not re-attempted. The
  lead is safe in Bid Hunter and visible in the portal, so nothing is lost,
  but the CRM copy has to be re-sent manually. A Cloudflare Queue with
  backoff is the right fix.
- **Delivery only.** Later lifecycle events (claimed, bid submitted, won)
  don't currently push. Since you own both ends for Tint Tech KC, the more
  useful direction is probably TintOS reporting a won job *back* to
  Bid Hunter to confirm an award.
- **No admin UI for webhook config** — it's curl or the API for now.
