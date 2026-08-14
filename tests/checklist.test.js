import { test } from "node:test";
import assert from "node:assert/strict";
import { buildChecklist, CHECKLIST_ITEMS } from "../src/checklist.js";

test("an empty project has nothing ticked and is not ready to bid", () => {
  const c = buildChecklist({});
  assert.equal(c.done, 0);
  assert.equal(c.percent, 0);
  assert.equal(c.readyToBid, false);
  assert.ok(c.blockers.includes("Verify film scope"));
});
test("auto items tick from real project data, marked as verified", () => {
  const c = buildChecklist({
    documents: [{ document_type: "plans" }, { document_type: "specifications" }],
    filmScope: [{ film_type: "Security", manufacturer: "3M", attachment_required: "true" }],
    glazing: [{ area_sf: 1176, glass_type: "Insulated" }],
    takeoffs: [{ total_material_sf: 1300 }],
    bids: [{ labor_cost: 3000, gross_margin: 31 }],
    hasProposal: true
  });
  const byKey = Object.fromEntries(c.items.map(i => [i.key, i]));
  assert.equal(byKey.plans.done, true);
  assert.equal(byKey.plans.source, "verified");
  assert.equal(byKey.filmScope.done, true);
  assert.equal(byKey.glazingQty.done, true);
  assert.equal(byKey.manufacturer.done, true);
  assert.equal(byKey.margin.done, true);
  assert.equal(c.readyToBid, true);
});
test("a manufacturer of 'Not specified' does NOT count as confirmed", () => {
  const c = buildChecklist({ filmScope: [{ film_type: "Security", manufacturer: "Not specified" }] });
  const item = c.items.find(i => i.key === "manufacturer");
  assert.equal(item.done, false, "an unspecified product must not tick the box");
});
test("glazing with no usable area does not tick quantities", () => {
  const c = buildChecklist({ glazing: [{ area_sf: null }] });
  assert.equal(c.items.find(i => i.key === "glazingQty").done, false);
});
test("manual ticks are honoured and labelled differently from verified", () => {
  const c = buildChecklist({}, { access: true, removal: true });
  const access = c.items.find(i => i.key === "access");
  assert.equal(access.done, true);
  assert.equal(access.source, "checked by you");
});
test("a verified item cannot be un-ticked by hand", () => {
  const c = buildChecklist({ filmScope: [{ film_type: "Security" }] }, {});
  const item = c.items.find(i => i.key === "filmScope");
  assert.equal(item.canTick, false, "already verified — nothing to tick");
});
test("readyToBid only depends on the core pricing/scope items", () => {
  const core = buildChecklist({
    filmScope: [{ film_type: "Security" }],
    glazing: [{ area_sf: 500 }],
    takeoffs: [{ total_material_sf: 550 }],
    bids: [{ labor_cost: 1000, gross_margin: 30 }]
  });
  assert.equal(core.readyToBid, true, "site-visit items should not block");
  assert.ok(core.percent < 100);
});
test("checklist shape is stable", () => {
  const c = buildChecklist({});
  assert.equal(c.items.length, CHECKLIST_ITEMS.length);
  assert.ok(c.items.every(i => typeof i.label === "string"));
});
