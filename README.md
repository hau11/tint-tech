# Bid Hunter — Cloudflare edition

Same app, rebuilt native for Cloudflare Workers: $0/month hosting, always-on,
nightly discovery scans via Cron Triggers, D1 database, KV blueprint storage,
and email ingest for BuildingConnected / PlanHub / GC portal ITB invitations.

- Deploy guide: DEPLOY.md (start there)
- src/worker.js      — routes, auth, cron, email ingest
- src/discovery.js   — 16-source scanner (SAM.gov API + 15 public boards)
- src/store.js       — D1 storage (all data in one exportable table)
- src/claude.js      — AI scoring, blueprint copilot, proposal writer
- frontend/app.jsx   — UI source; rebuild with `npm run build` after edits

Limits vs the Node version: blueprint uploads cap at 10 MB (Workers memory) —
split big plan books to A-sheets + Division 08 specs, which you should do anyway.
Uploaded blueprints are kept 24 hours, then expire automatically.


---

# V2 — Phase 1 (shipped)

Phase 1 lays the foundation the rest of V2 builds on. The V1 app is untouched
and still serves every existing route.

## What's in
- `migrations/` — normalized D1 schema (20 tables), indexes, seeded pricing profiles.
  Applied with `npx wrangler d1 migrations apply tint-intelligence --remote`.
- `src/engines.js` — **deterministic** engines. No AI, no network. Film keyword
  dictionary, sheet classification, takeoff math, pricing (material/labor/
  equipment/mobilization/overhead/profit), 0-100 bid score with weighted
  categories, bid readiness, cross-source deduplication, source quality, date
  parsing. AI explains these numbers; it never computes them.
- `src/db.js` — V2 data access layer + the non-destructive KV to V2 migration.
- `tests/engines.test.js` — 29 tests covering every deterministic calculation
  (`npm test`). These caught two real bugs during development: a dedup rule that
  failed to merge the four Fletcher Daniels name variants, and a day-count that
  was off by one at bid deadlines.
- V2 API routes under `/api/v2/*`, plus `/api/admin/migrate-v2` and `/api/config`.
- R2 document storage with SHA-256 dedup, shared upload validation
  (`MAX_DOCUMENT_SIZE` — frontend and backend can no longer disagree).

# V2 — Phase 2 (shipped): document intelligence

## Architecture decision: extraction runs in the browser
Cloudflare Workers cap CPU per request (10ms on the free plan). Parsing a plan
set server-side would exceed that and force a paid plan. So the browser extracts
PDF text with pdf.js and posts the text to `/api/v2/documents/:id/pages`. Your
device does the parsing; only text crosses the wire; hosting stays $0.

## The pipeline
    upload -> browser text extraction -> index + classify every page (free)
      -> rank pages by film/glazing relevance (free)
      -> send ONLY relevant pages to Claude
      -> VALIDATE every finding against real citations
      -> persist film_scope / glazing_items / project_risks

In testing, a 6-page document sent 3 pages to the AI: the cover sheet and the
mechanical plan were filtered out for free. On a 300-page plan book that
difference is the whole AI bill.

## The anti-fabrication layer
`validateFilmFindings()` / `validateGlazingFindings()` in `src/analyze.js` are
the mechanical enforcement of "never invent construction data" — prompts alone
are not trusted. A finding is DISCARDED, not displayed, if it:
- cites a page or sheet that was never supplied
- gives a quantity with no arithmetic shown
- uses a film type outside the known list
- reports an implausible dimension
Blank manufacturers become "Not specified" — never guessed. SPECIFIED and
RECOMMENDED stay separate fields. The UI shows how many findings were discarded.

## New routes
    POST /api/v2/documents/:id/pages      index extracted page text
    POST /api/v2/projects/:id/analyze     staged analysis -> cited findings
    GET  /api/v2/projects/:id/search?q=   keyword search, no AI cost
    POST /api/v2/projects/:id/ask         Copilot answering from indexed evidence
    POST /api/v2/projects/:id/rfi         RFI generated from a detected conflict

# V2 — Phase 3 (shipped): takeoff workbench -> pricing -> proposal

The Takeoff tab is now a working estimator screen fed by the analysis.

- Glazing found by Analyze fills the takeoff automatically, each line showing
  its source sheet, its arithmetic, and a verification flag when confidence is
  below 90%.
- Lines with no usable dimensions show **Unknown** in amber and are excluded
  from totals — never estimated into the number.
- Any line is editable. An edited line is marked "edited", its
  `estimator_override` flag is set, and re-running Analyze will not overwrite it.
- Roll planning: recommends a roll width from the largest pane and warns when
  panes exceed 72" and will need a seam.
- Pricing runs off the seeded pricing profiles with conservative / target /
  aggressive scenarios.
- Proposal is generated from the real film scope, real quantities, and the
  computed price. Unselected products print as "To be confirmed". If there are
  no usable quantities, proposal generation is refused rather than invented.

# V2 — Phase 4 (shipped): addendum intelligence + scope conflicts

New **Addenda** tab on every project.

## Addendum comparison
Upload a new addendum: the browser extracts it, then the app diffs it against
the scope you already hold. The diff is DETERMINISTIC — it compares structured
records, so "W-201 quantity 24 -> 38, +392 SF" is a fact, not an AI opinion.
AI is used only to read the new document, never to decide what changed.

Reports: items added / removed / changed, net SF delta, dollar impact at your
installed rate, and a HIGH/MEDIUM/LOW impact rating. A film SPECIFICATION change
outweighs quantity drift in that rating, because swapping the required film
re-prices the whole job.

Window marks are matched on mark + floor. Items with no mark are reported as
"unmatched" rather than paired by guesswork.

## Scope conflict detection (deterministic, zero AI cost)
Four conflict classes, each with a ready-to-send RFI:
1. **film-type-mismatch** (HIGH) — drawing says solar control, spec says security
   at the same location. The classic money-loser.
2. **product-not-named** (MEDIUM) — a spec section is cited but no manufacturer
   or basis-of-design product is given.
3. **attachment-undefined** (HIGH) — security or blast film with no stated
   attachment system. Materially changes cost.
4. **unsupported-quantity** (MEDIUM) — a quantity on record with no calculation
   or source excerpt behind it.

One tap turns any conflict into a drafted RFI you can copy and send.

## Honest status — what is NOT built yet
- OCR for scanned/image-only sheets (detected and flagged, not read)
- Project Command Center UI, dashboard redesign, analytics pages
- Queues-based async processing
- Historical pricing intelligence (win/loss data feeding production rates)

The V1 app and all its routes are untouched and still serve the live site.


## Lead relevance filtering (src/relevance.js)

The discovery scanner used to match any "window" or "glass", which buried real
film work under blinds, shades, window cleaning, auto glass, and Microsoft
Windows licenses. Leads are now graded:

- **high** — explicit film language (window film, security film, solar control
  film, decorative/frosted film, blast mitigation, anti-graffiti, spec section
  08 87 13, and manufacturer names). Bid these.
- **medium** — glazing scope where film is plausibly specified or sellable:
  window replacement, storefront, curtain wall, glazing packages. Worth a look;
  this is where the value-engineering pitch lives.
- **excluded** — dropped before you ever see them: blinds, shades, drapery,
  window coverings, window/glass cleaning, auto glass and windshields, shower
  doors, window AC units, drive-thru windows, Microsoft Windows, and unrelated
  trades (mowing, roofing, paving, alarms, guard services).

Important override: a lead mentioning BOTH blinds and film stays **high**, with
a note to verify film is really in scope. Exclusions only veto leads that have
no film language of their own.

Every lead now carries  explaining why it surfaced, shown in the
Discovery list. The Discovery tab has a **Film specified / All relevant** toggle.

SAM.gov queries are film-first: five nationwide film searches plus three
regional glazing searches.


# V2 — Phase 5 (shipped): command center, win/loss loop, analytics

## Command Center dashboard
Replaces the generic pipeline view with an action-oriented one: greeting, active
/ hot / pipeline / due-this-week stats, a past-due warning, **What should I bid
today?** (top 5, where an urgent deadline outranks a higher score), a bid
calendar bucketed Past due / Today / This week / Next 30 / Later, and a bid
results panel.

## Win/loss loop
Every project has **Record bid result** on its Overview tab: Won / Lost / No
Decision / Cancelled / Scope Removed. Losses capture why (Price, Competitor, GC
picked another sub, scope removed, cancelled, no response). Wins optionally
capture actual SF installed and actual labor hours.

## Historical pricing intelligence
Those actuals become real production rates: SF/hour, material $/SF, labor $/SF,
and gross margin per film type — replacing the seeded estimates. 
flags a proposed rate drifting 25%+ from your history.

## The honesty rule, enforced in code
Nothing is presented as reliable below 5 decided bids. A 100% win rate off one
bid returns  and says so.  refuses to crown a
best GC on thin data. Jobs missing actuals are excluded from rate calculations
rather than estimated.

## Relationship scores
Now computed from real bid history (bids, wins, completed work, recency,
responsiveness) with a concrete next action per contractor. Real history
overrides a hand-set star rating; a contractor with no history scores 0, not a
consolation 5.


# V2 — Phase 6 (shipped): scanned sheets, search, health, exports

## OCR for scanned drawings
Many plan sets are scans with no text layer. Previously those pages were only
flagged. Now, after indexing, the browser rasterises the blank pages (via pdf.js
canvas at up to 1600px) and sends them to Claude vision, which transcribes the
title block, sheet number, and any legible schedule rows or film notes.

Deliberate limits: vision runs a maximum of 8 pages per request because it costs
far more per page than text, and only pages with under 30 characters of extracted
text take this path. An unreadable page stores nothing — no invented sheet
numbers, no guessed dimensions. The UI reports how many pages were read, how many
were skipped, and why.

## Global search
New Search tab across projects, companies, film scope, sheets, RFIs, and
contacts. Verified working: 08 87 13 finds the film scope record, A-700 finds the
sheet, JE Dunn finds the company, Fletcher finds the project. Ranking weights
exact field matches above substrings buried in a paragraph, and a multi-word
query requires every term to appear somewhere.

## System Health
New tab showing Database, R2, Claude, SAM.gov, Discovery, Login protection, and
Cron. Anything unconfigured shows the exact command to fix it. It also flags an
unset APP_PASSWORD as a real risk rather than a checkbox.

## CSV exports
Projects, bid results, and per-project takeoffs export to CSV for Excel or
Sheets. Values starting with = + - @ are escaped so scraped text cannot execute
as a spreadsheet formula.


# V2 — Phase 7 (shipped): Project Copilot + bid checklist

## Ask tab — the Project Copilot
The evidence-based Q&A route built in Phase 2 finally has a UI. Ask a question
about a project and it answers from the pages already indexed for that project:
no re-uploading the PDF, and far cheaper per question than resending a document.
Answers come back in contractor format (ANSWER / EVIDENCE / CONFIDENCE / ACTION)
and each one reports how many indexed pages it read. If no documents are indexed
yet it says so plainly rather than guessing.

## Checklist tab
The 17-item bid checklist from the spec, with a difference: items the app can
verify tick themselves and are labelled **verified** — plans downloaded, film
scope found, quantities calculated, manufacturer confirmed, margin computed.
Items only you can know (site access, removal, exclusions) stay manual and are
labelled **checked by you**.

Two deliberate rules: a manufacturer of Not specified does NOT tick the
Confirm manufacturer box, and a verified item cannot be unticked by hand. A
checklist that lies about what is done is worse than no checklist.

readyToBid depends only on the core scope and pricing items, so a missing site
visit does not block a bid that is otherwise priced.


# V2 — Phase 8 (shipped): morning brief by email

## What it sends
At 6:30 AM Central the cron runs the discovery scan, then builds and emails a
brief covering:
- **Needs you today** — bids due today, pre-bid meetings today or tomorrow,
  past-due bids to close out, and bids due soon that are still unscored
- **Bid deadlines** for the next 7 days, with reminders firing at 7 and 2 days
- **Pre-bid meetings** in the next week (easy to miss, often mandatory)
- **New leads** from the overnight scan, high relevance first, each linking to
  the source posting and showing why it matched
- **Highest scoring open work** (70+)

Subject lines summarise the day: "Bid Hunter: 1 due TODAY, 2 new leads".
On a quiet day it says so plainly rather than padding.

## Email is optional
The brief is generated deterministically and previewable in System Health
whether or not email is configured. If no provider key is set, the send endpoint
returns `sent: false` with the reason — it never reports a silent success.

Sending uses Resend (DEPLOY.md step J) because Cloudflare Workers cannot send
arbitrary email. Nothing else in the app depends on it.

## Safety
Digest HTML escapes lead titles, so a malicious scraped title cannot inject
markup into your inbox. Covered by a test.


# V2 — Phase 9 (shipped): early opportunities

A bid posting means you are already competing on price. A project still in
planning or design means you can get film written into the specification, which
is worth far more. New **Early Leads** tab.

## How it works
Paste anything about an upcoming project — a planning commission agenda item, a
permit record, a development announcement, a news story — and it reports:

- **Stage** (Planning / Design / Permitting / Pre-Bid / Bidding), with the exact
  phrase that determined it. Unknown when nothing matches, never guessed.
- **Building type and size**, size only when a figure is actually stated.
- **Film potential** as an explicit RANGE, labelled a planning-stage estimate
  based on typical glazing ratios, not a takeoff.
- **Early opportunity score** where Design and Planning outrank Bidding, because
  early is where the influence is.
- **Next action** tuned to the stage — at Design it tells you to reach the
  specification writer, at Planning to reach the owner before an architect is
  even selected.

Verified end to end: a 240,000 SF office tower planning notice scored 85, stage
Planning, film potential $324,000-$756,000, and flagged the missing architect
as the gap that matters. The same engine scored a bid-stage notice at 20.

## The honesty rules
No building size is invented — if the text does not state one, film potential
returns Unknown with the reason. Every range carries the caveat that it is not
a takeoff.


## Scope-first discovery (Phase 9b)

Feedback from real use: the board was full of glass and glazing jobs, not film
work. Three changes:

1. **Discovery now opens on Film & tinting.** Leads split into two tabs —
   *Film & tinting* (the posting actually names film or tinting work) and
   *Glazing upsell* (window/glass work where film is an add-on pitch). Glass no
   longer buries film.
2. **Every film lead is tagged by scope** — Security, Solar Control, Decorative,
   Privacy, Bird Strike, Anti-Graffiti, Blast Mitigation, Whiteboard, Projection,
   Switchable, Exterior — with filter chips so you can view only the work you
   want. Patterns allow an intervening word, because real postings say
   "security WINDOW film", not "security film".
3. **Vocabulary widened to service-contract phrasing.** Public boards title film
   work as services, not construction scope: "Window Tinting Services",
   "window tinting service", "film installation", "architectural film",
   "furnish and install film". These were being missed entirely.

SAM.gov queries are now film-first: seven nationwide film searches (window film,
window tinting, security film, solar control film, safety film, blast
mitigation, anti-graffiti) plus one regional glazing query for the upsell feed.

When there are no film jobs, the board says so plainly and points at the glazing
tab — film-specific public bids are genuinely rare, and pretending otherwise
would just hide the truth behind a longer list.


# V2.5 — Hidden Tint Scope + BUILD MY BID

## Audit first
18 of the V2.5 module list was already built across earlier phases (Command
Center, Early Opportunity, Document Intelligence, Film Intelligence, AI Takeoff,
Pricing, Bid Readiness, Risk, Addendum, RFI, GC Intelligence, Historical
Pricing, Win/Loss, Copilot, Analytics, Search, Checklist, Digest). Nothing was
rebuilt. Two genuine gaps were closed.

## Hidden Tint Scope Detector (§8) — src/hidden.js
Directly addresses the real complaint that discovery returns glass jobs, not
film jobs: those glass jobs ARE the opportunity, they just have not been
recognised as one.

For any project with glazing and no film specification, it reports the glazing
signals found (curtain wall, storefront, glass partitions, atrium glass...), the
conditions that make a specific film sell (west-facing glare, security
hardening, privacy rooms, bird strike, graffiti exposure), which films fit, a
confidence figure, and a sized opportunity RANGE.

Sizing is honest by construction: measured glazing gives the tightest range,
building size gives a rough one clearly marked not a takeoff, and with neither
it returns UNKNOWN with the reason. It never invents a square footage.

A Money Radar endpoint ranks every open project by hidden opportunity.

## BUILD MY BID (§36)
One button on a new Build Bid tab runs the whole pipeline: validates project
info and documents, pulls film scope, computes the takeoff, prices Aggressive /
Target / Premium, scores the bid, runs scope-conflict detection, computes
readiness, finds the best contact, saves the bid to history, and states the next
action.

Critically, it refuses to price a project with no verified quantities — it
returns REVIEW with "a bid price would be invented rather than calculated"
instead of producing a number. All arithmetic is deterministic; AI is not
involved in any financial calculation.

Verified end to end: 1,896 SF takeoff produced Aggressive $23,212 / Target
$25,025 / Premium $26,839, score 75 -> BID, readiness 67%, 2 scope conflicts
detected, and two blockers surfaced before submitting.


# Pursuit phase — verification, contacts, outreach, follow-ups

Audit first: 22 of the spec's phases were already built. Nothing was rebuilt.
This phase closed the biggest remaining gap — the app could find, analyze, and
price work but had no way to ACT on it.

## Estimator verification with a permanent audit trail
Critical Rule "never overwrite AI output" is now enforced by the schema. Every
verification writes a `verification_events` row holding the original AI value
forever, then applies the estimator's number as an override.

Display: "AI 1,176 → verified 1,260 (+84, +7.1%)", status ESTIMATOR VERIFIED. A
swing of 20% or more is flagged as worth re-checking the source sheet.

Over time `verificationAccuracy()` reports how far off AI takeoffs run and in
which direction — withheld until at least 5 verified items exist.

## Who should I call?
Contacts are ranked deterministically by role, and the ranking changes with the
project stage: on a bidding project the estimator wins ("estimators control which
subs get invited to bid"); on a Design-stage project the architect wins ("the
project is early enough that the architect can still write film into the
specification"). With no contacts on record it falls back to the GC company and
says so — it never invents a person, an email, or a phone number.

## Outreach generator
Drafts an email or call script from verified project facts only, with talking
points and one clear ask. Capped at 120 words. Every draft is labelled
"nothing is sent automatically" — the app has no send path by design.

## Follow-up engine
`scheduleFollowups()` builds the whole sequence from the bid date: intro
follow-up, second follow-up, pre-bid check (7 days out), final review (2 days
out), submit day, post-bid call, award check. Nothing is ever created already
overdue, and re-running is idempotent. A new Follow-ups tab groups everything
into Overdue / Today / This week / Upcoming.


# Specification Hunter + Job Costing

## Specification Hunter (new sidebar tab)
Architect profiles built from your own project records: how many projects, how
many carried a film opportunity, which film type they favour, which manufacturer
they name. Then it surfaces the projects where the specification can still
change — anything in Planning, Design, or Permitting.

The advice differs by situation. For an architect who already specifies film:
"ask to be listed as an approved installer." For one who does not: "offer a
lunch-and-learn or a spec section before the documents are finalised." At Design
stage the next action says so plainly — that is the last stage where film can be
added cheaply.

Thin records are labelled "not enough to call this a pattern" rather than
presented as a trend, and a manufacturer of "Not specified" is never counted.

## Job Costing (new project tab)
Enter what a job actually cost by category. The app compares it to the bid it
generated and reports variance per line, total cost and profit variance, and
actual margin.

It also explains the variance in plain terms. Verified against a real bid: labor
came in 30.8% over, and it reported "Your production rate for this kind of work
may be optimistic — record actual SF and hours so the rate corrects itself,"
plus "You made $1,524 less than estimated on this job."

`costTrends()` rolls actuals across jobs into corrected rates, withheld until at
least 3 completed jobs exist.


# Market Intelligence, Notifications, and WIN THIS JOB

## Market + Territory Intelligence (new Market tab)
Every figure is separated into VERIFIED (contract values from awarded projects
you recorded), ESTIMATED (derived ranges), or UNKNOWN. That separation is
structural, not a label — mixing the three would make the page a lie.

Verified on a near-empty database: it reported 0 verified revenue with
"No awarded projects recorded yet" and a territory value of UNKNOWN rather than
inventing a market size.

Territories aggregate by city: project density, film rate, nearest distance,
dominant building type and film type, with each value labelled.

Film SF with no quantity is counted and excluded — "2 film finding(s) have no
quantity, excluded, not guessed."

## Notifications (bell on the dashboard)
Derived from live state, never stored stale: bids due today or within 2 days,
pre-bid meetings, past-due deadlines, high-scoring untouched projects, bids due
soon with no score, unreviewed addenda, overdue follow-ups, and submitted bids
with no recorded result. Sorted by severity. A quiet day says so.

## WIN THIS JOB (new project tab)
Pursuit strategy grounded in stored evidence: the calculated bid, film scope,
risks, contacts, and your real win/loss history with that GC. Produces strategy,
pricing posture, talking points, questions for the GC, differentiators, risks
worth raising, and post-bid actions.

It will not invent competitors, competitor pricing, or relationships. With no
history it says so — verified output included "No bid history with this GC yet"
rather than implying a pattern. It also never recommends a bid number; pricing
stays deterministic.
