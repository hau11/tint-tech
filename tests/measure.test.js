import { test } from "node:test";
import assert from "node:assert/strict";
import { calibrate, measureRectangle, parseFeetInches, formatFeetInches, summarizeMeasurements } from "../src/measure.js";

const cal = calibrate({ pixelDistance: 100, realLength: 10 });   // 10 ft across 100 px

test("nothing can be measured before the scale is calibrated", () => {
  // The whole anti-fabrication position rests on this. An image carries no
  // reliable scale, so without calibration there is no number to give.
  for (const bad of [null, undefined, {}, { ok: false }]) {
    const r = measureRectangle({ x0: 0, y0: 0, x1: 50, y1: 50 }, bad);
    assert.equal(r.ok, false, JSON.stringify(bad));
    assert.match(r.reason, /not calibrated/i);
  }
});

test("a rectangle becomes real feet, with the arithmetic shown", () => {
  const r = measureRectangle({ x0: 10, y0: 10, x1: 60, y1: 40 }, cal);
  assert.equal(r.ok, true);
  assert.equal(r.width_ft, 5);    // 50 px at 0.1 ft/px
  assert.equal(r.height_ft, 3);   // 30 px
  assert.equal(r.area_sf, 15);
  assert.ok(r.calculation.includes("1 x 5' x 3' = 15 SF"), r.calculation);
});

test("quantity multiplies the area", () => {
  const r = measureRectangle({ x0: 0, y0: 0, x1: 50, y1: 30 }, cal, { quantity: 4 });
  assert.equal(r.area_sf, 60);
  assert.ok(r.calculation.startsWith("4 x "), r.calculation);
});

test("a rectangle dragged backwards still measures positive", () => {
  // Dragging right-to-left or bottom-to-top is normal, and a negative
  // dimension would silently corrupt the bid total.
  const a = measureRectangle({ x0: 60, y0: 40, x1: 10, y1: 10 }, cal);
  const b = measureRectangle({ x0: 10, y0: 10, x1: 60, y1: 40 }, cal);
  assert.equal(a.area_sf, b.area_sf);
});

test("a zero-area shape is refused rather than priced at nothing", () => {
  const r = measureRectangle({ x0: 10, y0: 10, x1: 10, y1: 40 }, cal);
  assert.equal(r.ok, false);
  assert.match(r.reason, /no area/i);
});

test("calibrating on a very short line is flagged, not silently trusted", () => {
  // Every later measurement inherits the calibration error, so a 15 px
  // reference quietly multiplies into every line of the bid.
  const short = calibrate({ pixelDistance: 15, realLength: 10 });
  assert.equal(short.ok, true);
  assert.equal(short.lowConfidence, true);
  assert.match(short.warning, /15 pixels/);
  assert.equal(measureRectangle({ x0: 0, y0: 0, x1: 50, y1: 30 }, short).lowConfidence, true,
    "the warning has to travel with the measurement, not stay on the calibration");
});

test("calibration refuses bad input instead of inventing a scale", () => {
  assert.equal(calibrate({ pixelDistance: 0, realLength: 10 }).ok, false);
  assert.equal(calibrate({ pixelDistance: -5, realLength: 10 }).ok, false);
  assert.equal(calibrate({ pixelDistance: 100, realLength: "" }).ok, false);
  assert.equal(calibrate({ pixelDistance: 100, realLength: "abc" }).ok, false);
  assert.equal(calibrate({}).ok, false);
  assert.equal(calibrate().ok, false);
});

test("dimensions are parsed the way an estimator types them", () => {
  assert.equal(parseFeetInches(10), 10);
  assert.equal(parseFeetInches("10"), 10);
  assert.equal(parseFeetInches("10.5"), 10.5);
  assert.equal(parseFeetInches("10 6"), 10.5);
  assert.equal(parseFeetInches("10-6"), 10.5);
  assert.equal(parseFeetInches("10ft 6in"), 10.5);
  assert.equal(parseFeetInches("126in"), 10.5);
  // Nonsense must read as unknown rather than as some number.
  assert.equal(parseFeetInches("10-14"), null, "14 inches is not a dimension");
  assert.equal(parseFeetInches("abc"), null);
  assert.equal(parseFeetInches(""), null);
  assert.equal(parseFeetInches(-5), null);
  assert.equal(parseFeetInches(0), null);
});

test("feet are displayed the way a glazier reads them", () => {
  assert.equal(formatFeetInches(10.5), "10'-6\"");
  assert.equal(formatFeetInches(10), "10'-0\"");
  // Rounding up to 12 inches must roll into the next foot, not print 9ft-12in.
  assert.equal(formatFeetInches(9.999), "10'-0\"");
  assert.equal(formatFeetInches(0), "Unknown");
  assert.equal(formatFeetInches(NaN), "Unknown");
});

test("the summary excludes unmeasured items and says so", () => {
  // Never estimated into the total. A bid that quietly invents a number for a
  // pane nobody measured is the failure this codebase exists to prevent.
  const items = [
    measureRectangle({ x0: 0, y0: 0, x1: 50, y1: 30 }, cal, { filmType: "Security" }),
    measureRectangle({ x0: 0, y0: 0, x1: 50, y1: 30 }, cal, { filmType: "Security" }),
    measureRectangle({ x0: 0, y0: 0, x1: 0, y1: 0 }, cal)
  ];
  const s = summarizeMeasurements(items);
  assert.equal(s.count, 2);
  assert.equal(s.excluded, 1);
  assert.equal(s.totalSf, 30);
  assert.equal(s.byFilm.Security, 30);
  assert.match(s.note, /excluded, not estimated/);
});

test("an empty takeoff totals zero rather than failing", () => {
  const s = summarizeMeasurements([]);
  assert.equal(s.count, 0);
  assert.equal(s.totalSf, 0);
  assert.equal(s.note, null);
});
