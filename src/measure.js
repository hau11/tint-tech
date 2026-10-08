// On-screen takeoff measurement for flat glass.
//
// The scale is CALIBRATED by the user against a known dimension on the sheet,
// never inferred. Once a drawing is an image it carries no reliable scale: it
// may have been cropped, rescaled, or printed at a different size, and a stated
// scale like 1/4in = 1ft is only true at the original paper size. Asking vision
// to judge a dimension from pixels would be inventing a number, which this
// codebase does not do.
//
// So the rule is simple and absolute: no calibration, no measurements.

export const NO_SCALE = Object.freeze({
  ok: false,
  reason: "Not calibrated. Click two points on a known dimension and enter its real length first."
});

const round2 = n => Math.round(n * 100) / 100;

/**
 * Parse what an estimator actually types: 10, 10.5, 10\x27 6", 10-6, 126in.
 * Returns feet, or null when it cannot be read. Never guesses.
 */
export function parseFeetInches(value) {
  if (typeof value === "number") return Number.isFinite(value) && value > 0 ? value : null;
  const s = String(value || "").trim().toLowerCase();
  if (!s) return null;

  // Bare inches, e.g. 126in or 126"
  const inchesOnly = s.match(/^([0-9]+(?:\.[0-9]+)?)\s*(?:in|inch|inches|")$/);
  if (inchesOnly) { const i = parseFloat(inchesOnly[1]); return i > 0 ? round2(i / 12) : null; }

  // Feet and inches: 10 6, 10-6, 10ft 6in, 10\x27-6"
  const both = s.match(/^([0-9]+(?:\.[0-9]+)?)\s*(?:ft|feet|\x27)?\s*[-\s]\s*([0-9]+(?:\.[0-9]+)?)\s*(?:in|inch|inches|")?$/);
  if (both) {
    const f = parseFloat(both[1]), i = parseFloat(both[2]);
    if (i >= 12) return null;  // 10-14 is not a real dimension
    return f > 0 || i > 0 ? round2(f + i / 12) : null;
  }

  // Plain feet, e.g. 10, 10.5, 10ft, 10\x27
  const feet = s.match(/^([0-9]+(?:\.[0-9]+)?)\s*(?:ft|feet|\x27)?$/);
  if (feet) { const f = parseFloat(feet[1]); return f > 0 ? round2(f) : null; }
  return null;
}

/** Format feet back the way a glazier reads it: 10\x27-6". */
export function formatFeetInches(feet) {
  if (!Number.isFinite(feet) || feet <= 0) return "Unknown";
  const whole = Math.floor(feet);
  const inches = Math.round((feet - whole) * 12);
  if (inches === 12) return `${whole + 1}\x27-0"`;
  return `${whole}\x27-${inches}"`;
}

/**
 * Establish scale from one known dimension the user picked off the sheet.
 * Short reference lines are flagged rather than silently trusted: calibrating
 * on 15 pixels multiplies every later measurement error by the same factor.
 */
export function calibrate({ pixelDistance, realLength } = {}) {
  const px = Number(pixelDistance);
  const feet = parseFeetInches(realLength);
  if (!Number.isFinite(px) || px <= 0) {
    return { ok: false, reason: "Drag across a known dimension to set the scale." };
  }
  if (feet == null) {
    return { ok: false, reason: "Enter the real length, for example 10 ft 6 in, or 126 in." };
  }
  const feetPerPixel = feet / px;
  return {
    ok: true,
    feetPerPixel,
    pixelDistance: px,
    realFeet: feet,
    note: `${Math.round(px)} px = ${formatFeetInches(feet)}`,
    lowConfidence: px < 40,
    warning: px < 40
      ? `Calibrated on only ${Math.round(px)} pixels. Every measurement inherits that error, so pick a longer dimension.`
      : null
  };
}

/**
 * Turn a drawn rectangle into a glazing item, in the exact shape engines.js
 * already consumes, so it flows into the existing takeoff and pricing.
 * Returns the arithmetic alongside the number, never a bare figure.
 */
export function measureRectangle(rect = {}, cal, { quantity = 1, mark = null, filmType = null } = {}) {
  if (!cal || cal.ok !== true) return { ...NO_SCALE };
  const wPx = Math.abs(Number(rect.x1) - Number(rect.x0));
  const hPx = Math.abs(Number(rect.y1) - Number(rect.y0));
  if (!Number.isFinite(wPx) || !Number.isFinite(hPx) || wPx <= 0 || hPx <= 0) {
    return { ok: false, reason: "That shape has no area. Drag a box across the glass opening." };
  }
  const qty = Math.max(1, Math.floor(Number(quantity) || 1));
  const widthFt = round2(wPx * cal.feetPerPixel);
  const heightFt = round2(hPx * cal.feetPerPixel);
  const areaSf = round2(qty * widthFt * heightFt);
  return {
    ok: true,
    quantity: qty,
    width_ft: widthFt,
    height_ft: heightFt,
    area_sf: areaSf,
    window_mark: mark,
    film_type: filmType,
    dimensions: `${formatFeetInches(widthFt)} x ${formatFeetInches(heightFt)}`,
    calculation: `${qty} x ${widthFt}\x27 x ${heightFt}\x27 = ${areaSf} SF`,
    measured: true,
    lowConfidence: Boolean(cal.lowConfidence)
  };
}

/** Roll up measured items for the bid. Unmeasured items are counted and
 *  excluded, never estimated into the total. */
export function summarizeMeasurements(items = []) {
  const usable = items.filter(i => i && i.ok && Number.isFinite(i.area_sf));
  const excluded = items.length - usable.length;
  const totalSf = round2(usable.reduce((t, i) => t + i.area_sf, 0));
  const byFilm = {};
  for (const i of usable) {
    const key = i.film_type || "Not specified";
    byFilm[key] = round2((byFilm[key] || 0) + i.area_sf);
  }
  const largestPaneIn = usable.reduce((m, i) =>
    Math.max(m, Math.min(i.width_ft, i.height_ft) * 12), 0);
  return {
    count: usable.length,
    excluded,
    totalSf,
    byFilm,
    largestPaneIn: round2(largestPaneIn),
    note: excluded ? `${excluded} item(s) had no usable dimensions and were excluded, not estimated.` : null
  };
}
