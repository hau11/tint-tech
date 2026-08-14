import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreRecord, buildSearchResult, rankSearchResults, summarizeHealth, toCsv } from "../src/search.js";

/* ---------- search ranking ---------- */
test("exact field match outranks a buried substring", () => {
  const exact = scoreRecord({ name: "JE Dunn" }, "JE Dunn", "companies").score;
  const buried = scoreRecord({ name: "Other", notes: "we bid against JE Dunn once" }, "JE Dunn", "companies").score;
  assert.ok(exact > buried, `${exact} should beat ${buried}`);
});
test("spec section search finds film scope", () => {
  const r = scoreRecord({ film_type: "Security", spec_section: "08 87 13" }, "08 87 13", "film_scope");
  assert.ok(r.score > 0);
  assert.ok(r.hits.includes("spec_section"));
});
test("searching a sheet number finds the sheet", () => {
  const r = scoreRecord({ sheet_number: "A-700", sheet_title: "Window Schedule" }, "A-700", "project_sheets");
  assert.ok(r.score > 0);
});
test("a multi-word query requires every term somewhere", () => {
  const both = scoreRecord({ name: "Fletcher Daniels window replacement" }, "fletcher window", "projects").score;
  const one  = scoreRecord({ name: "Fletcher Daniels tuckpoint" }, "fletcher window", "projects").score;
  assert.ok(both > one, "a record matching both terms must rank higher");
});
test("no match scores zero", () => {
  assert.equal(scoreRecord({ name: "Turner" }, "zzzzz", "companies").score, 0);
  assert.equal(scoreRecord({ name: "Turner" }, "", "companies").score, 0);
});
test("results are ranked and capped", () => {
  const rows = Array.from({ length: 50 }, (_, i) => ({ id: i, score: i }));
  const ranked = rankSearchResults(rows, 10);
  assert.equal(ranked.length, 10);
  assert.equal(ranked[0].score, 49);
});
test("zero-score rows are dropped from results", () => {
  assert.equal(rankSearchResults([{ score: 0 }, { score: 5 }]).length, 1);
});
test("search results carry a readable title and subtitle", () => {
  const r = buildSearchResult(
    { id: "p1", name: "O2512-01 Fletcher Daniels", project_number: "O2512-01", city: "Kansas City", state: "MO", general_contractor: "JE Dunn" },
    "projects", ["name"], 30);
  assert.equal(r.typeLabel, "Project");
  assert.match(r.subtitle, /Kansas City, MO/);
  assert.equal(r.projectId, "p1");
});

/* ---------- system health ---------- */
test("a fully configured system reports healthy", () => {
  const h = summarizeHealth({ database: true, projectCount: 12, r2: true, claudeKey: true,
    samKey: true, samLastRun: "2026-08-12T06:00:00Z", lastDiscovery: "2026-08-12",
    bluebookLastReceived: "2026-08-12T06:00:00Z", passwordSet: true,
    cron: true, digest: true, digestTo: "info@tinttechkc.com" });
  assert.equal(h.overall, "Healthy");
  assert.equal(h.healthy, h.total);
});
test("a missing database is an Error, not a warning", () => {
  const h = summarizeHealth({ database: false, r2: true, claudeKey: true, passwordSet: true, cron: true });
  assert.equal(h.overall, "Error");
  assert.match(h.items.find(i => i.name === "Database").detail, /migrations/i);
});
test("an unset password is called out plainly", () => {
  const h = summarizeHealth({ database: true, r2: true, claudeKey: true, passwordSet: false, cron: true });
  assert.equal(h.overall, "Warning");
  assert.match(h.items.find(i => i.name === "Login protection").detail, /anyone with the URL/i);
});
test("missing keys give the exact command to fix them", () => {
  const h = summarizeHealth({ database: true, claudeKey: false, samKey: false });
  assert.match(h.items.find(i => i.name === "AI (Claude)").detail, /wrangler secret put ANTHROPIC_API_KEY/);
  assert.match(h.items.find(i => /SAM/.test(i.name)).detail, /wrangler secret put SAM_API_KEY/);
});

/* ---------- CSV ---------- */
test("csv quotes commas, quotes and newlines", () => {
  const csv = toCsv([{ a: 'He said "hi"', b: "x,y", c: "line1\nline2" }]);
  assert.match(csv, /"He said ""hi"""/);
  assert.match(csv, /"x,y"/);
  assert.match(csv, /"line1\nline2"/);
});
test("csv neutralises spreadsheet formula injection", () => {
  const csv = toCsv([{ a: "=cmd|'/c calc'!A1" }]);
  assert.ok(csv.includes("'=cmd"), "leading = must be escaped");
});
test("csv respects a column list and empty input", () => {
  assert.equal(toCsv([{ a: 1, b: 2 }], ["b"]), "b\n2");
  assert.equal(toCsv([]), "");
});
