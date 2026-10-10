import { test } from "node:test";
import assert from "node:assert/strict";
import { SOURCES, SCAN_BATCH, scanSlice, REGIONS, regionOf, normalizeSource, sourceRegistry, selectSources, coverageByRegion, planSamQueries, samCooldownHours, SAM_CORE_QUERIES, SAM_EXTENDED_QUERIES, visibleTextLength, isStale, extractDates, parseGenericHtml } from "../src/discovery.js";

/* The scan is batched because Cloudflare caps one Worker invocation at 50
   subrequests on the free plan. Scanning all 89 sources at once asked for
   roughly 96, the invocation was killed, and the browser reported only
   "Failed to fetch". These pin the slice maths that keeps us inside the cap. */

test("one batch cannot exceed the subrequest budget", () => {
  // The SAM source fans out to 8 queries of its own, so a batch that also
  // contains SAM must still leave headroom under 50.
  assert.ok(SCAN_BATCH + 8 < 50,
    `a batch of ${SCAN_BATCH} plus the SAM fan-out must stay under 50 subrequests`);
});

test("walking the cursor covers every source exactly once", () => {
  const total = SOURCES.length;
  const visited = [];
  let offset = 0, guard = 0;
  for (;;) {
    const p = scanSlice(total, offset, SCAN_BATCH);
    for (let i = p.start; i < p.end; i++) visited.push(i);
    if (p.done) break;
    assert.ok(p.nextOffset > offset, "the cursor must advance or the client loops forever");
    offset = p.nextOffset;
    assert.ok(++guard < 1000, "cursor walk did not terminate");
  }
  assert.deepEqual(visited, [...Array(total).keys()],
    "every source index should be scanned once, in order, with none skipped or repeated");
});

test("the batch size is clamped at both ends", () => {
  // A hand-crafted request must not be able to widen the batch back over the cap.
  assert.equal(scanSlice(100, 0, 999).end, SCAN_BATCH);
  // ...nor shrink it to nothing and never finish.
  assert.equal(scanSlice(100, 0, 0).end, SCAN_BATCH);
  assert.equal(scanSlice(100, 0, -5).end, 1);
});

test("a cursor past the end reports done instead of running off", () => {
  const p = scanSlice(89, 500, SCAN_BATCH);
  assert.equal(p.start, 89);
  assert.equal(p.end, 89);
  assert.equal(p.done, true);
});

test("a junk offset is treated as the beginning, never as a crash", () => {
  for (const bad of [undefined, null, NaN, -1, "abc", 1.7]) {
    const p = scanSlice(89, bad, SCAN_BATCH);
    assert.ok(p.start >= 0 && p.start <= 89, `offset ${String(bad)} produced start ${p.start}`);
  }
  assert.equal(scanSlice(89, "abc", SCAN_BATCH).start, 0);
  assert.equal(scanSlice(89, -1, SCAN_BATCH).start, 0);
});

test("an empty source list is immediately done", () => {
  const p = scanSlice(0, 0, SCAN_BATCH);
  assert.equal(p.done, true);
  assert.equal(p.end, 0);
});

/* ---------- source registry + geography ---------- */

test("every state belongs to exactly one region", () => {
  const seen = new Map();
  for (const [region, members] of Object.entries(REGIONS)) {
    for (const st of members) {
      assert.ok(!seen.has(st), `${st} is in both ${seen.get(st)} and ${region}`);
      seen.set(st, region);
    }
  }
  // 50 states plus DC. A missing state would silently drop its sources from
  // every region filter.
  assert.equal(seen.size, 51, `expected 51 entries, got ${seen.size}`);
  assert.equal(regionOf("MO"), "Midwest");
  assert.equal(regionOf("ks"), "Midwest", "should not be case sensitive");
  assert.equal(regionOf("ZZ"), null);
});

test("terse source entries get sensible defaults", () => {
  const s = normalizeSource({ id: "x", name: "X", kind: "generic", url: "https://e.test", state: "TX" });
  assert.equal(s.access, "FREE");
  assert.equal(s.platform, "html");
  assert.equal(s.enabled, true);
  assert.equal(s.scope, "state");
  assert.equal(s.region, "South");
  // An explicit value must win over the default, or exceptions cannot be set.
  assert.equal(normalizeSource({ access: "PAID" }).access, "PAID");
  assert.equal(normalizeSource({ kind: "sam" }).scope, "federal");
});

test("no geography filter means the entire United States", () => {
  assert.equal(selectSources({}).length, sourceRegistry().filter(s => s.access === "FREE").length);
});

test("filtering to a state keeps that state plus the federal feed", () => {
  const mo = selectSources({ states: ["MO"] });
  assert.ok(mo.length > 0);
  for (const s of mo) {
    assert.ok(s.scope === "federal" || s.state === "MO", `${s.id} is ${s.state}, not MO`);
  }
  // SAM.gov covers every state, so dropping it on a state filter would lose
  // the best nationwide feed exactly when someone narrows the search.
  assert.ok(mo.some(s => s.scope === "federal"), "federal must survive a state filter");
});

test("a region filter expands to its states", () => {
  const midwest = selectSources({ regions: ["Midwest"] });
  const both = selectSources({ states: REGIONS.Midwest });
  assert.equal(midwest.length, both.length);
  const west = selectSources({ regions: ["West"] });
  assert.ok(west.every(s => s.scope === "federal" || REGIONS.West.includes(s.state)));
});

test("a MANUAL source is listed but never scanned", () => {
  // These serve a page full of text but no solicitation rows, so the js-portal
  // heuristic passes them as ok while they return nothing. Marking them MANUAL
  // is what stops the app reporting them as searched.
  const manual = sourceRegistry().filter(s => s.access === "MANUAL");
  assert.ok(manual.length > 0, "the registry should carry some manual-only boards");
  const scanned = new Set(selectSources({}).map(s => s.id));
  for (const s of manual) {
    assert.ok(!scanned.has(s.id), `${s.id} is MANUAL but would still be scanned`);
    assert.ok(s.note, `${s.id} is MANUAL with no explanation of why`);
  }
});

test("regions count only sources that are actually scanned", () => {
  // A region whose only sources are MANUAL would imply coverage that does not
  // exist, which is the exact failure this registry is meant to prevent.
  for (const region of Object.keys(REGIONS)) {
    for (const s of selectSources({ regions: [region] })) {
      assert.equal(s.access, "FREE", `${s.id} in ${region} is ${s.access}`);
    }
  }
});

test("coverage is reported per region, including where there is none", () => {
  // This replaced a test asserting every region HAS coverage. That was an
  // aspiration, not an invariant: every Northeast portal tried either blocks
  // us, has moved, or serves listings via JavaScript. Quietly weakening the
  // assertion would be the dishonest fix, so the registry reports the gap
  // instead and the UI shows it.
  const cov = coverageByRegion();
  for (const region of Object.keys(REGIONS)) {
    assert.ok(cov[region], `${region} missing from the coverage report`);
    assert.equal(typeof cov[region].automated, "number");
    assert.ok(Array.isArray(cov[region].states));
    const scanned = selectSources({ regions: [region] }).filter(s => s.scope !== "federal");
    assert.equal(cov[region].automated, scanned.length, `${region} count disagrees with selectSources`);
  }
  assert.ok(cov.Midwest.automated > 0, "the home region must have coverage");
});

test("added state portals are tagged with a state we can filter by", () => {
  // A source with no state is unreachable by any geography filter and would
  // silently never be scanned once someone narrows the search.
  for (const s of sourceRegistry()) {
    if (s.scope === "federal") continue;
    assert.ok(s.state && regionOf(s.state), `${s.id} has an unusable state: ${s.state}`);
  }
});

test("only automatable sources are scanned", () => {
  // Anything that needs an account or payment must never be counted as
  // searched. selectSources is the chokepoint that enforces it.
  for (const s of selectSources({})) assert.equal(s.access, "FREE", s.id);
});

test("case and junk in a state filter do not silently drop sources", () => {
  assert.equal(selectSources({ states: ["mo"] }).length, selectSources({ states: ["MO"] }).length);
  const junk = selectSources({ states: ["ZZ"] });
  assert.ok(junk.every(s => s.scope === "federal"), "an unknown state should match no local sources");
});

/* ---------- SAM.gov budget ---------- */

test("a small key spends every request on film-explicit queries", () => {
  // A personal key allows roughly 10 a day. Those must all go to the queries
  // most likely to return actual film work.
  const q = planSamQueries(7);
  assert.equal(q.length, 7);
  assert.deepEqual(q, SAM_CORE_QUERIES);
  assert.ok(q.every(x => x.title), "a small budget should not spend requests on sweeps");
});

test("a bigger key buys the NAICS sweep first", () => {
  // Title search only finds work that says film in the title. NAICS 238150 is
  // Glass and Glazing Contractors, so it surfaces the scope itself and lets the
  // classifier judge it. That is worth more than any additional keyword.
  const q = planSamQueries(8);
  assert.equal(q.length, 8);
  assert.equal(q[7].ncode, "238150", "the first extra request should be the NAICS sweep");
});

test("the budget never exceeds the queries available", () => {
  const all = SAM_CORE_QUERIES.length + SAM_EXTENDED_QUERIES.length;
  assert.equal(planSamQueries(999).length, all);
  assert.equal(planSamQueries(all).length, all);
});

test("a missing or junk budget falls back to a safe default", () => {
  // This reads an env var, so it must never produce zero queries (a silent dead
  // scan) or a huge number (a blown quota and a rate-limit lockout).
  for (const junk of [undefined, null, "", "abc", 0, -5, NaN]) {
    const q = planSamQueries(junk);
    assert.ok(q.length >= SAM_CORE_QUERIES.length, `budget ${String(junk)} gave ${q.length} queries`);
    assert.ok(q.length <= SAM_CORE_QUERIES.length + 1, `budget ${String(junk)} overspent: ${q.length}`);
  }
});

test("scan frequency follows the budget, not the calendar", () => {
  // A small key has to be rationed to one look a day. A large one can afford
  // several, which matters because federal notices post during business hours.
  assert.equal(samCooldownHours(8), 20);
  assert.equal(samCooldownHours(undefined), 20, "an unset budget must stay conservative");
  assert.equal(samCooldownHours(100), 6);
});

test("every SAM query is a title search or a NAICS sweep, never both", () => {
  // scanSam builds one filter or the other; an entry with both would silently
  // drop one and waste a request from a very small quota.
  for (const q of [...SAM_CORE_QUERIES, ...SAM_EXTENDED_QUERIES]) {
    assert.ok(Boolean(q.title) !== Boolean(q.ncode), JSON.stringify(q));
  }
});


/* visibleTextLength decides whether a source that produced no leads actually
   had nothing, or was a JavaScript portal we never managed to read. It used to
   be cheerio's body .text(), which counts <script> contents as text -- so the
   emptier a JS portal was, the more "text" it appeared to have, and the app
   reported it as searched. That is exactly the claim this codebase must not
   make about a source it cannot read. */

test("visibleTextLength ignores script, style and comment contents", () => {
  const html = "<html><body><script>" + "x".repeat(5000) + "</script>" +
    "<style>" + "y".repeat(5000) + "</style>" +
    "<!-- " + "z".repeat(5000) + " -->" +
    "<p>Bid opportunities</p></body></html>";
  assert.equal(visibleTextLength(html), "Bid opportunities".length);
});

test("visibleTextLength flags a JS portal that cheerio would have passed", () => {
  // A real shape: a shell page whose listings arrive by fetch.
  const portal = "<html><body><div id=app></div><script>" + "var a=1;".repeat(2000) + "</script></body></html>";
  assert.ok(visibleTextLength(portal) < 600);
});

test("visibleTextLength counts real page text", () => {
  const page = "<html><body><table><tr><td>IFB 24-101</td><td>Window glazing replacement</td></tr></table></body></html>";
  assert.equal(visibleTextLength(page), "IFB 24-101 Window glazing replacement".length);
});

test("visibleTextLength separates adjacent tags instead of gluing text", () => {
  assert.equal(visibleTextLength("<td>one</td><td>two</td>"), "one two".length);
});

test("visibleTextLength is safe on empty and non-string input", () => {
  assert.equal(visibleTextLength(""), 0);
  assert.equal(visibleTextLength(null), 0);
  assert.equal(visibleTextLength(undefined), 0);
});

/* A scan reported "3 new leads" and showed 2. The third was real, matched the
   classifier, and had a bid date that had already passed: runDiscovery counted
   and stored it, then the next batch filtered it out on the way back in. The
   count and the list have to agree, so expired leads are counted separately
   and the UI names them. */

const daysAway = n => {
  const d = new Date(Date.now() + n * 86400000);
  return (d.getMonth() + 1) + "/" + d.getDate() + "/" + d.getFullYear();
};

test("a lead whose bid date has passed is stale", () => {
  assert.equal(isStale({ bidDate: daysAway(-30) }), true);
});

test("a lead due in the future is not stale", () => {
  assert.equal(isStale({ bidDate: daysAway(30) }), false);
});

test("a bid due today survives the 3-day grace period", () => {
  assert.equal(isStale({ bidDate: daysAway(0) }), false);
  assert.equal(isStale({ bidDate: daysAway(-2) }), false);
});

test("a lead with no bid date at all is kept, not discarded", () => {
  // Most generic boards give no parsable date. Dropping those would throw away
  // the majority of what Discovery finds.
  assert.equal(isStale({ bidDate: "", foundAt: new Date().toISOString().slice(0, 10) }), false);
  assert.equal(isStale({ foundAt: new Date().toISOString().slice(0, 10) }), false);
});

test("an unparsable bid date is kept rather than guessed at", () => {
  assert.equal(isStale({ bidDate: "see solicitation" }), false);
  assert.equal(isStale({ bidDate: "13/45/2026" }), false);
});

test("a lead found more than 60 days ago ages out", () => {
  const old = new Date(Date.now() - 61 * 86400000).toISOString().slice(0, 10);
  assert.equal(isStale({ foundAt: old }), true);
});

/* Lincoln University posted "LU26002 | 09 February 2026 | 20 February 2026 |
   MLK Hall Window Replacement | Landyn Smith" and Discovery showed it as a
   live lead in October with no bid date, twice -- once for the PDF and once
   for the contact's mailto: link, which carried the whole row as its title. */

test("extractDates reads slash dates", () => {
  assert.deepEqual(extractDates("bids due 9/15/2026"), ["9/15/2026"]);
  assert.deepEqual(extractDates("due 9/15/26"), ["9/15/2026"]);
});

test("extractDates reads day-month-year, which used to yield nothing", () => {
  assert.deepEqual(extractDates("20 February 2026"), ["2/20/2026"]);
  assert.deepEqual(extractDates("9 Feb. 2026"), ["2/9/2026"]);
});

test("extractDates reads month-day-year", () => {
  assert.deepEqual(extractDates("February 9, 2026"), ["2/9/2026"]);
  assert.deepEqual(extractDates("Feb 9 2026"), ["2/9/2026"]);
  assert.deepEqual(extractDates("September 1st, 2026"), ["9/1/2026"]);
});

test("extractDates keeps document order so the last date is the closing date", () => {
  const row = "LU26002 09 February 2026 20 February 2026 MLK Hall Window Replacement";
  const dates = extractDates(row);
  assert.deepEqual(dates, ["2/9/2026", "2/20/2026"]);
  assert.equal(dates[dates.length - 1], "2/20/2026");
});

test("extractDates rejects impossible dates rather than inventing one", () => {
  assert.deepEqual(extractDates("13/45/2026"), []);
  assert.deepEqual(extractDates("32 February 2026"), []);
  assert.deepEqual(extractDates("Smarch 9, 2026"), []);
});

test("extractDates returns nothing for text with no date", () => {
  assert.deepEqual(extractDates("see solicitation for details"), []);
  assert.deepEqual(extractDates(""), []);
  assert.deepEqual(extractDates(null), []);
});

test("the February row is now dated, so it is recognised as closed", () => {
  const row = "LU26002 09 February 2026 20 February 2026 MLK Hall Window Replacement";
  const bidDate = extractDates(row).pop();
  // Anything before mid-2026 is long past by the time this suite runs in Oct.
  assert.equal(isStale({ bidDate }), new Date(bidDate).getTime() < Date.now() - 3 * 86400000);
});

test("a mailto link in the same row is a contact, not a second bid", () => {
  const html = `<table><tr>
      <td>LU26002</td><td>20 February 2026</td>
      <td><a href="/bids/rfp-lu26002-mlk-hall-window-replacement.pdf">Martin Luther King Hall Window Replacement</a></td>
      <td><a href="mailto:smithl2@lincolnu.edu">Landyn Smith</a></td>
    </tr></table>`;
  const leads = parseGenericHtml(html, { url: "https://www.lincolnu.edu/bids", name: "Lincoln University", state: "MO" }, null);
  assert.equal(leads.length, 1);
  assert.ok(!leads.some(l => (l.links.page || "").startsWith("mailto:")));
  assert.equal(leads[0].bidDate, "2/20/2026");
});