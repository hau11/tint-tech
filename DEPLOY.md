# Deploy to Cloudflare — step by step (beginner friendly)

One-time setup, about 20 minutes. You'll type a few commands; copy them exactly.

## A. One-time computer setup
1. Install Node.js 18+ from https://nodejs.org (big green button, default options)
2. Unzip this folder somewhere easy (Desktop is fine)
3. Open a terminal IN this folder:
   - Windows: open the folder, click the address bar, type `cmd`, press Enter
   - Mac: right-click the folder > Services > New Terminal at Folder
4. Run:  npm install

## B. Connect to your Cloudflare account
5. Run:  npx wrangler login
   (a browser tab opens — click Allow)

## C. Create the database + blueprint storage (one time)
6. Run:  npx wrangler d1 create tint-intelligence
   It prints a database_id like "a1b2c3...". Copy it.
7. Open wrangler.jsonc in Notepad — replace PASTE_YOUR_D1_ID_HERE with that id. Save.
8. Run:  npx wrangler kv namespace create BLUEPRINTS
   Copy the id it prints; replace PASTE_YOUR_KV_ID_HERE in wrangler.jsonc. Save.

## D. Deploy + set your 3 secret keys
9.  Run:  npx wrangler deploy
10. Run:  npx wrangler secret put ANTHROPIC_API_KEY   (paste your key from console.anthropic.com, Enter)
11. Run:  npx wrangler secret put APP_PASSWORD        (invent your login password, Enter)
12. Run:  npx wrangler secret put SAM_API_KEY         (paste your SAM.gov key, Enter)

Done. Your app is live at the URL step 9 printed:
https://tint-intelligence-ai.YOUR-SUBDOMAIN.workers.dev
Open it on your phone — any username + your APP_PASSWORD. Then Safari > Share >
Add to Home Screen to make it feel like an app.

The nightly discovery scan runs automatically at 6:30 AM Central — no server to
keep awake, that's Cloudflare's Cron doing it for free.

## E. Your own address (optional, 2 min)
Cloudflare dashboard > Workers & Pages > tint-intelligence-ai > Settings >
Domains & Routes > Add > Custom domain > app.tinttechkc.com. Done — DNS is
automatic because the domain is already on Cloudflare.

## F. BuildingConnected / PlanHub leads by email (the good part)
1. Cloudflare dashboard > your domain (tinttechkc.com) > Email > Email Routing > enable it
2. Create address: leads@tinttechkc.com > action "Send to a Worker" > pick tint-intelligence-ai
3. In Gmail/Outlook, add an auto-forward rule: anything from
   buildingconnected.com / planhub.com / GC portals forwards to leads@tinttechkc.com
   (Gmail asks to confirm the forward address — the confirmation email itself will
   show up as a lead in your Discovery tab; open it there and click the confirm link)
Every ITB invitation now lands in Discovery automatically, tagged by platform,
with the bid date and link pulled out.

No email routing on the domain? Alternative: a free Zapier "Email Parser" zap
that POSTs to https://YOUR-APP-URL/api/ingest/email?token=YOUR_APP_PASSWORD
with JSON {"from":"...","subject":"...","text":"..."}.

## Updating later
After any code change:  npx wrangler deploy   (that's the whole update process)

---

# V2 UPGRADE — additional one-time steps

Phase 1 of V2 adds a normalized database, an R2 document store, and the
deterministic takeoff/pricing/scoring engines. Your existing app keeps running
throughout; nothing is deleted.

## G. Create the R2 bucket (for full-size project documents)
1. Cloudflare dashboard > R2 > Create bucket
2. Name it exactly:  tint-documents
   (Or from the terminal:  npx wrangler r2 bucket create tint-documents )

R2 has a generous free tier. If you skip this step everything else still works —
document upload routes simply return "R2 bucket not configured yet."

## H. Apply the V2 database migrations
In your app folder:

   npx wrangler d1 migrations apply tint-intelligence --remote

Type `y` when it lists the three migrations. This ADDS tables. It does not
touch or delete your existing `kv` data.

## I. Deploy and migrate your existing data
   npm run build
   npx wrangler deploy

Then run the data migration once (replace with your URL and password):

   curl -u x:YOUR_APP_PASSWORD -X POST https://tint-intelligence-ai.YOUR-SUBDOMAIN.workers.dev/api/admin/migrate-v2

It reports how many projects and companies moved across. It is safe to run more
than once — duplicates are merged, never re-created. Your old data stays in the
`kv` table as a backup.

## Verify
   curl -u x:YOUR_APP_PASSWORD https://YOUR-URL/api/health

Look for:  "v2": { "migrated": true, "projects": 2 }  and  "r2": true

## Run the test suite any time
   npm test

---

## Phase 2 notes
No extra setup — Phase 2 rides on the same migrations and deploy commands:

    npm run build
    npx wrangler deploy

Open any opportunity and use the new **Analyze** tab: upload a PDF, watch it
read the pages on your device, then get film findings with sheet citations,
a glazing table, and bid risks.

Tip: scanned/photographed sheets have no embedded text. The app detects these
and reports them as "pages needing OCR" rather than pretending to read them.
For those, use the Blueprint Copilot tab, which sends the image to AI vision.

---

## Phase 5 note — one extra migration

Phase 5 adds columns for recording what a job actually took. Run the migrations
again after copying in the new files:

    npx wrangler d1 migrations apply tint-intelligence --remote
    npm run build
    npx wrangler deploy

Only the new migration applies; the earlier ones are skipped automatically.

---

## J. Morning email brief (optional, 5 minutes)

The brief is built either way — you can read it in System Health any time. These
steps are only for having it emailed to you at 6:30 AM.

Cloudflare Workers cannot send arbitrary email, so this uses Resend (free tier
covers 3,000 emails/month — far more than one brief a day).

1. Sign up at https://resend.com (free)
2. API Keys > Create API Key > copy it
3. In your app folder, run these three, one at a time:

       npx wrangler secret put RESEND_API_KEY
       (paste the Resend key)

       npx wrangler secret put DIGEST_TO
       (type: info@tinttechkc.com)

       npx wrangler secret put APP_URL
       (type your app URL, e.g. https://tint-intelligence-ai.haut011.workers.dev)

4. Deploy:  npx wrangler deploy
5. Open System Health in the app and press "Send it to me now" to test.

Sending from your own domain (optional): in Resend, add tinttechkc.com as a
domain and follow their DNS steps (Cloudflare makes this quick since your DNS is
already there). Then set one more secret:

       npx wrangler secret put DIGEST_FROM
       (type: Bid Hunter <alerts@tinttechkc.com>)

Until you do that, the brief sends from Resend's shared test address, which
works fine but is more likely to land in spam. Check your junk folder on the
first send and mark it "not junk".

## K. Blue Book webhook leads

Blue Book (webapi.bluebook.net) can push new-project notifications straight
into Discovery, the same way the email ingest in step F does.

1. In Blue Book, register this as your webhook callback URL:

       https://YOUR-APP-URL/api/ingest/bluebook?token=YOUR_APP_PASSWORD

   (same shared-secret pattern as the email ingest endpoint — no separate key
   to generate.)
2. That's it — no deploy needed, the route already exists. System Health shows
   "Blue Book webhook" as Healthy once the first notification arrives, with
   the date of the last one received.

**Caveat:** Blue Book's exact notification payload wasn't available while
this was built (their API docs domain isn't reachable from the build
environment), so `src/bluebook.js` maps a defensive best-guess set of field
names (`title`/`Title`/`projectName`/..., `dueDate`/`DueDate`/`closeDate`/...,
etc.) rather than one confirmed schema. If a real notification doesn't show
up correctly in Discovery, check the raw payload against the candidate field
names at the top of `bluebookToLead()` in that file and widen the list to
match.

## L. BuildingConnected (Autodesk) leads

Unlike Blue Book, BuildingConnected uses three-legged OAuth — a real person
has to log into their Autodesk / BuildingConnected account once and grant
access. There's no API key to paste in.

1. Register an app at https://aps.autodesk.com (My Apps > Create App).
   - Callback URL: `https://YOUR-APP-URL/api/integrations/buildingconnected/callback`
   - Request the `data:read` scope, and access to the BuildingConnected API
     product (Autodesk may require your app/account to be approved for BC
     access — ask their sales/partner team if the product isn't selectable).
2. Copy the Client ID and Client Secret it gives you, then:

       npx wrangler secret put BC_CLIENT_ID
       npx wrangler secret put BC_CLIENT_SECRET

   (APP_URL must also be set — see step J above; it's reused here to build
   the OAuth callback URL.)
3. Deploy:  npx wrangler deploy
4. Open System Health in the app and click **Connect BuildingConnected**. Log
   into Autodesk when prompted, approve access, and you'll land back in the
   app connected. Click **Sync now** any time to pull current projects into
   Discovery, graded by the same film/glazing relevance engine as every other
   source.

**Status — confirmed vs. still-guessed:** built from Autodesk's docs page in
stages as screenshots came in (the docs domain itself is blocked from this
build environment). Confirmed for real: the auth model (three-legged OAuth,
`data:read` scope, `Authorization: Bearer <token>` header), the OAuth
authorize/token endpoints (Autodesk's stable v2 auth endpoints, unrelated to
the BC-specific page), and the exact request URL —
`GET https://developer.api.autodesk.com/construction/buildingconnected/v2/projects`.
That URL is hardcoded correctly now (still overridable without a code change
via a `BC_PROJECTS_URL` secret, in case it turns out to need query
parameters).

**Still a guess:** the response body's field names — `bcProjectToLead()` in
`src/buildingconnected.js` uses a defensive best-effort list (`name`/
`projectName`/`title`, `bidDate`/`dueDate`/..., etc.) since the docs page's
Response/schema section hasn't been seen yet. If Sync now runs but leads come
through titled "Untitled BuildingConnected project" or with blank fields,
scroll that docs page down to its Response section (or find a "Try it" panel
with a sample response — that shows every real field name in one shot) and
send it over, or update the `pick(p, [...])` candidate lists in
`bcProjectToLead()` directly to match.

---

## Pursuit phase — one extra migration

    npx wrangler d1 migrations apply tint-intelligence --remote
    npm run build
    npx wrangler deploy

Adds verification_events, outreach, and followups tables. Earlier migrations
are skipped automatically.

---

## Architect intelligence + job costing — one more migration

    npx wrangler d1 migrations apply tint-intelligence --remote
    npm run build
    npx wrangler deploy

Adds specification_opportunities and job_costs tables.
