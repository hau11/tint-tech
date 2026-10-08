import { test } from "node:test";
import assert from "node:assert/strict";
import { SOURCES, SCAN_BATCH, scanSlice, REGIONS, regionOf, normalizeSource, sourceRegistry, selectSources } from "../src/discovery.js";

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

test("every region has at least one non-federal source", () => {
  // Coverage used to be Midwest-only, so a user filtering to the West got the
  // federal feed and nothing else while the UI implied a real search. If this
  // fails, a region was added to REGIONS without any source behind it.
  for (const region of Object.keys(REGIONS)) {
    const local = selectSources({ regions: [region] }).filter(s => s.scope !== "federal");
    assert.ok(local.length > 0, `${region} has no non-federal source behind it`);
  }
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
