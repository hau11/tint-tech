import { test } from "node:test";
import assert from "node:assert/strict";
import { SOURCES, SCAN_BATCH, scanSlice } from "../src/discovery.js";

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
