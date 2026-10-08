import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyFilmRelevance, filterRelevant, mergeTerms, DEFAULT_TERMS } from "../src/relevance.js";

const rel = t => classifyFilmRelevance(t).relevance;

/* ---------- REAL film work must come through as high ---------- */
test("explicit film scopes rank high", () => {
  for (const t of [
    "Provide and install security window film at all ground floor glazing",
    "IFB 2026-14 Solar Control Film Installation, City Hall",
    "Decorative frosted film for conference room glass partitions",
    "Bird strike film application at atrium",
    "Anti-graffiti film for transit shelters",
    "Section 08 87 13 window films",
    "Blast mitigation film with attachment system, federal courthouse",
    "Window tinting services for municipal offices"
  ]) assert.equal(rel(t), "high", t);
});

/* ---------- The false positives that were burying real leads ---------- */
test("blinds and window coverings are excluded", () => {
  for (const t of [
    "Furnish and install window blinds, district office",
    "Roller shades for classroom windows",
    "RFP for drapery and window treatments",
    "Replace mini blinds in dormitory windows",
    "Solar shades and cellular shades installation"
  ]) assert.equal(rel(t), "excluded", t);
});
test("window cleaning is excluded", () => {
  assert.equal(rel("Annual window cleaning services for county buildings"), "excluded");
  assert.equal(rel("Exterior glass cleaning and pressure washing"), "excluded");
});
test("non-glazing senses of 'window' are excluded", () => {
  assert.equal(rel("Microsoft Windows Server license renewal"), "excluded");
  assert.equal(rel("Window air conditioner units for annex"), "excluded");
  assert.equal(rel("Drive-thru teller window replacement"), "excluded");
  assert.equal(rel("Auto glass and windshield replacement contract"), "excluded");
});
test("unrelated trades are excluded", () => {
  assert.equal(rel("Lawn mowing and landscaping services"), "excluded");
  assert.equal(rel("Roof replacement, maintenance building"), "excluded");
  assert.equal(rel("Armed security guard services"), "excluded");
  assert.equal(rel("Fire alarm system upgrade"), "excluded");
});

/* ---------- The critical override ---------- */
test("a lead mentioning BOTH blinds and film stays high", () => {
  const c = classifyFilmRelevance("Furnish blinds and security window film, high school renovation");
  assert.equal(c.relevance, "high");
  assert.ok(c.reasons.some(r => /verify film is in the scope/i.test(r)),
    "should warn that blinds are also in scope");
});

/* ---------- Genuine glazing opportunities stay visible ---------- */
test("real glazing scope is medium, not discarded", () => {
  assert.equal(rel("Replace windows and tuckpoint, Fletcher Daniels State Office Building"), "medium");
  assert.equal(rel("Storefront and curtain wall replacement, terminal renovation"), "medium");
  assert.equal(rel("Aluminum window systems and glazing package"), "medium");
});
test("glazing plus an energy/safety driver is medium", () => {
  assert.equal(rel("Window replacement for energy efficiency, admin building"), "medium");
  assert.equal(rel("Storefront glazing, school safety hardening project"), "medium");
});
test("a single weak glazing mention is low, not medium", () => {
  assert.equal(rel("Interior remodel including one glass door"), "low");
});
test("generic renovations no longer match at all", () => {
  for (const t of [
    "Interior renovation of administrative offices",
    "Building envelope repairs, phase 2",
    "Courthouse restroom remodel",
    "Parking lot resurfacing"
  ]) assert.notEqual(rel(t), "high", t);
  assert.equal(rel("Courthouse restroom remodel"), "excluded");
});

/* ---------- scoring + filtering ---------- */
test("film leads outscore glazing-only leads", () => {
  const film = classifyFilmRelevance("security window film installation");
  const glaz = classifyFilmRelevance("storefront glazing replacement");
  assert.ok(film.score > glaz.score);
  assert.ok(film.score >= 60);
});
test("reasons explain the match to the user", () => {
  const c = classifyFilmRelevance("Provide solar control film at west elevation storefront");
  assert.ok(c.reasons.some(r => /Film specified/.test(r)));
  assert.ok(c.reasons.some(r => /Glazing scope/.test(r)));
});
test("filterRelevant drops the noise and keeps the work", () => {
  const leads = [
    { title: "Security window film, police station" },
    { title: "Window blinds for library" },
    { title: "Replace windows and storefront, city hall" },
    { title: "Window cleaning services" },
    { title: "Lawn mowing" },
    { title: "Microsoft Windows licenses" }
  ];
  const { kept, droppedCount } = filterRelevant(leads);
  assert.equal(kept.length, 2);
  assert.equal(droppedCount, 4);
  assert.equal(kept[0].relevance, "high");
  assert.ok(kept[0].matchReasons.length);
});
test("minRelevance low still surfaces weak leads", () => {
  const leads = [{ title: "Interior remodel including one glass door" }];
  assert.equal(filterRelevant(leads, { minRelevance: "medium" }).kept.length, 0);
  assert.equal(filterRelevant(leads, { minRelevance: "low" }).kept.length, 1);
});
test("empty or junk text is excluded safely", () => {
  assert.equal(rel(""), "excluded");
  assert.equal(rel(null), "excluded");
  assert.equal(rel("   "), "excluded");
});

/* ---------- end-to-end through the real FMDC parser ---------- */
import { parseFmdcHtml, parseGenericHtml, SOURCES } from "../src/discovery.js";

test("FMDC parser now filters out blinds and cleaning rows", () => {
  const html = `<table>
<tr><td>Project Number</td><td>Title</td><td>Bid Date</td><td>A</td><td>R</td></tr>
<tr><td>O2512-01</td><td>Replace Windows & Tuckpoint Fletcher Daniels State Office Building</td><td>8/27/2026</td><td></td><td></td></tr>
<tr><td>B2601-01</td><td>Furnish and Install Window Blinds, Capitol Complex</td><td>9/1/2026</td><td></td><td></td></tr>
<tr><td>C2602-01</td><td>Annual Window Cleaning Services</td><td>9/3/2026</td><td></td><td></td></tr>
<tr><td>S2603-01</td><td>Security Window Film Installation, Highway Patrol HQ</td><td>9/8/2026</td><td></td><td></td></tr>
<tr><td>L2604-01</td><td>Lawn Mowing and Grounds Maintenance</td><td>9/9/2026</td><td></td><td></td></tr>
<tr><td>R2605-01</td><td>Restroom Renovation, District Office</td><td>9/10/2026</td><td></td><td></td></tr>
</table>`;
  const leads = parseFmdcHtml(html);
  const nums = leads.map(l => l.projectNo);
  assert.ok(nums.includes("S2603-01"), "security film must be kept");
  assert.ok(nums.includes("O2512-01"), "window replacement must be kept");
  assert.ok(!nums.includes("B2601-01"), "blinds must be dropped");
  assert.ok(!nums.includes("C2602-01"), "window cleaning must be dropped");
  assert.ok(!nums.includes("L2604-01"), "mowing must be dropped");
  assert.ok(!nums.includes("R2605-01"), "generic restroom reno must be dropped");
  assert.equal(leads.length, 2);
  assert.equal(leads.find(l => l.projectNo === "S2603-01").relevance, "high");
  assert.ok(leads[0].matchReasons.length > 0, "leads carry match reasons");
});

test("generic scanner drops window-covering listings", () => {
  const html = `<html><body><ul>
<li><a href="/b/1">RFP 26-01 Window Blinds and Roller Shades Replacement</a> due 9/1/2026</li>
<li><a href="/b/2">IFB 26-02 Security Film for Detention Glazing</a> due 9/5/2026</li>
<li><a href="/b/3">Bid 26-03 Storefront and Curtain Wall Replacement Package</a> due 9/7/2026</li>
<li><a href="/b/4">RFQ 26-04 Window Washing Services</a> due 9/8/2026</li>
</ul></body></html>`;
  const leads = parseGenericHtml(html, SOURCES.find(s => s.id === "joco"));
  const titles = leads.map(l => l.title).join(" | ");
  assert.ok(/Security Film/.test(titles));
  assert.ok(/Storefront/.test(titles));
  assert.ok(!/Blinds/.test(titles), "blinds should be gone");
  assert.ok(!/Washing/.test(titles), "window washing should be gone");
  assert.equal(leads.length, 2);
});

/* ---------- scope tagging (Phase 9b) ---------- */
test("film type is tagged even with an intervening word", () => {
  const t = s => classifyFilmRelevance(s).filmTypes;
  assert.ok(t("Furnish and install security window film").includes("Security"));
  assert.ok(t("Solar control window film, admin building").includes("Solar Control"));
  assert.ok(t("Blast mitigation window film, courthouse").includes("Blast Mitigation"));
});
test("service-contract phrasing is caught — this is how film work is usually posted", () => {
  for (const s of [
    "Window Tinting Services for County Facilities",
    "RFP: window tinting service, city hall",
    "Furnish and install film at detention glazing",
    "Architectural film installation, district office"
  ]) assert.equal(classifyFilmRelevance(s).relevance, "high", s);
});
test("tinting is tagged as solar control so it can be filtered by scope", () => {
  assert.ok(classifyFilmRelevance("Window Tinting Services").filmTypes.includes("Solar Control"));
});
test("each specialty film gets its own tag", () => {
  const cases = [
    ["Bird strike film at atrium", "Bird Strike"],
    ["Anti-graffiti film for shelters", "Anti-Graffiti"],
    ["Decorative frosted film, conference rooms", "Decorative"],
    ["Privacy film for exam rooms", "Privacy"],
    ["Whiteboard film for classrooms", "Whiteboard"]
  ];
  for (const [text, type] of cases)
    assert.ok(classifyFilmRelevance(text).filmTypes.includes(type), `${text} -> ${type}`);
});
test("glazing-only work carries no film type, so it can be separated from real film jobs", () => {
  const c = classifyFilmRelevance("Replace windows and tuckpoint, state office building");
  assert.equal(c.relevance, "medium");
  assert.deepEqual(c.filmTypes, []);
});
test("excluded leads never carry a film type", () => {
  assert.deepEqual(classifyFilmRelevance("Window blinds and roller shades").filmTypes, []);
});

/* ---------- security glazing scopes (nationwide expansion, step 1) ---------- */

test("blast-resistant glazing and forced-entry resistance surface as film work", () => {
  // This scored 12 and was hidden as "low". Blast-resistant glazing and
  // forced-entry resistance are prime security-film territory, and neither
  // phrase appeared in any term list.
  const c = classifyFilmRelevance(
    "Courthouse Security Upgrades - blast resistant glazing and forced entry resistance at ground floor");
  assert.equal(c.relevance, "medium");
  assert.ok(c.score > 12, `score should beat the old 12, got ${c.score}`);
  assert.ok(c.filmTypes.includes("Security"), "should be tagged as a Security film opportunity");
  assert.match(c.reasons.join(" "), /blast resistant glazing|forced entry resistance/);
});

test("safety glazing alone stays weak", () => {
  // Deliberately NOT promoted with the security terms: safety glazing is
  // code-mandated tempered glass and appears on nearly every job, so treating
  // it as a strong signal would flood the board.
  const c = classifyFilmRelevance("Interior remodel with safety glazing at doors per code");
  assert.ok(c.score < 30, `safety glazing alone should stay weak, got ${c.score}`);
});

test("film terms that do not contain the words window film still match", () => {
  // FILM_EXPLICIT is substring-matched, so anything containing "window film"
  // is already covered. These are the ones that are not.
  for (const phrase of ["Provide glazing film to existing vision glass",
                        "Bird-strike film at atrium glass",
                        "Install reflective film on south elevation",
                        "Apply anti-graffiti sacrificial film"]) {
    assert.equal(classifyFilmRelevance(phrase).relevance, "high", phrase);
  }
});

test("the hyphenated bird-strike spelling is typed, not just matched", () => {
  assert.ok(classifyFilmRelevance("bird-strike film").filmTypes.includes("Bird Strike"));
  assert.ok(classifyFilmRelevance("bird strike film").filmTypes.includes("Bird Strike"));
});

test("widening the lists did not let the usual false positives back in", () => {
  for (const phrase of ["Lawn Mowing Services - grounds maintenance",
                        "Replace Window Blinds - new blinds and drapery",
                        "Window cleaning services for county buildings",
                        "Windshield replacement for fleet vehicles",
                        "Microsoft Windows license renewal"]) {
    assert.equal(classifyFilmRelevance(phrase).relevance, "excluded", phrase);
  }
});

/* ---------- configurable vocabulary ---------- */

test("a custom term is matched without touching code", () => {
  const text = "Supply and install heliotrope shielding to the atrium";
  assert.equal(classifyFilmRelevance(text).relevance, "excluded", "unknown by default");
  const c = classifyFilmRelevance(text, { film: ["heliotrope shielding"] });
  assert.equal(c.relevance, "high");
});

test("a default term can be switched off", () => {
  // Someone who never sells bird-strike work should be able to stop seeing it.
  const text = "Bird deterrent film at the atrium";
  assert.equal(classifyFilmRelevance(text).relevance, "high");
  const off = classifyFilmRelevance(text, { disabled: ["bird deterrent film"] });
  assert.notEqual(off.relevance, "high");
});

test("a custom exclusion suppresses a lead", () => {
  const text = "Install window film at the stadium";
  assert.equal(classifyFilmRelevance(text).relevance, "high");
  const c = classifyFilmRelevance(text, { exclusions: ["stadium"] });
  // Explicit film language still beats an exclusion, by design, but the
  // conflict has to be surfaced rather than silently resolved.
  assert.match(c.reasons.join(" "), /stadium/);
});

test("merging is normalised, de-duplicated and case-insensitive", () => {
  const m = mergeTerms({ film: ["  FOO Film  ", "foo film", "", null] });
  assert.equal(m.film.filter(t => t === "foo film").length, 1, "should appear exactly once");
  assert.ok(!m.film.includes(""), "blank entries dropped");
});

test("malformed settings never take the scan down", () => {
  // This runs inside the scan, so bad stored input must degrade to defaults.
  for (const junk of [null, undefined, "nope", 42, [], { film: "not-an-array" }, { disabled: 7 }]) {
    const m = mergeTerms(junk);
    assert.ok(Array.isArray(m.film) && m.film.length > 0, JSON.stringify(junk));
  }
  assert.equal(classifyFilmRelevance("window film", "garbage").relevance, "high");
});

test("the defaults are exposed so a settings screen can show them", () => {
  for (const k of ["film", "glazing", "glazingStrong", "supporting", "exclusions"]) {
    assert.ok(Array.isArray(DEFAULT_TERMS[k]) && DEFAULT_TERMS[k].length, k);
  }
});
