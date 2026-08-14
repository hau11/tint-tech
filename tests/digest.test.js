import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDigest, renderDigestText, renderDigestHtml, REMINDER_DAYS } from "../src/digest.js";

const NOW = new Date("2026-08-12T07:00:00");
const iso = days => new Date(Date.UTC(2026,7,12+days)).toISOString().slice(0,10);
const P = (name, days, extra={}) => ({ id:name, name, status:"Qualified", bid_due: days==null?null:iso(days), ...extra });
const L = (title, relevance="high", extra={}) => ({ id:title, title, relevance, relevanceScore:80,
  foundAt:"2026-08-12", source:"Missouri OA-FMDC", projectNo:"X-1", bidDate:"9/1/2026", ...extra });

test("an empty day produces an honest 'nothing needs you' digest", () => {
  const d = buildDigest({ leads:[], projects:[], now:NOW });
  assert.equal(d.hasContent, false);
  assert.match(d.subject, /nothing needs you today/i);
  assert.match(renderDigestText(d), /No new leads and no deadlines/);
});
test("a bid due today is the loudest item", () => {
  const d = buildDigest({ projects:[P("Courthouse film", 0)], now:NOW });
  assert.equal(d.dueToday.length, 1);
  assert.match(d.subject, /1 due TODAY/);
  assert.ok(d.actions.some(a => a.urgency==="high" && /due TODAY/.test(a.text)));
});
test("deadlines within a week are listed, later ones are not", () => {
  const d = buildDigest({ projects:[P("soon",3), P("later",20), P("today",0)], now:NOW });
  assert.equal(d.dueSoon.length, 1);
  assert.equal(d.dueToday.length, 1);
  assert.equal(d.counts.dueThisWeek, 2);
});
test("reminder days fire at 7 and 2 days out", () => {
  const d = buildDigest({ projects:[P("week",7), P("two",2), P("three",3)], now:NOW });
  const names = d.reminders.map(r=>r.name).sort();
  assert.deepEqual(names, ["two","week"]);
  assert.deepEqual(REMINDER_DAYS, [7,2]);
});
test("past-due bids ask you to close them out", () => {
  const d = buildDigest({ projects:[P("stale",-4)], now:NOW });
  assert.equal(d.pastDue.length, 1);
  assert.ok(d.actions.some(a => /record the result or archive/.test(a.text)));
});
test("closed projects never appear", () => {
  const d = buildDigest({ projects:[
    P("won",1,{status:"Awarded"}), P("lost",1,{status:"Lost"}), P("live",1)
  ], now:NOW });
  assert.equal(d.dueSoon.length, 1);
  assert.equal(d.dueSoon[0].name, "live");
});
test("pre-bid meetings surface, and tomorrow's is urgent", () => {
  const d = buildDigest({ projects:[
    P("prebid soon", 20, {prebid_date: iso(1)}),
    P("prebid far", 40, {prebid_date: iso(20)})
  ], now:NOW });
  assert.equal(d.preBids.length, 1);
  assert.ok(d.actions.some(a => a.urgency==="high" && /pre-bid meeting tomorrow/.test(a.text)));
});
test("new leads are sorted high-relevance first", () => {
  const d = buildDigest({ leads:[L("medium one","medium"), L("high one","high")], now:NOW });
  assert.equal(d.newLeads[0].title, "high one");
  assert.equal(d.counts.newLeads, 2);
});
test("stale leads from earlier days are not re-reported", () => {
  const d = buildDigest({ leads:[L("old", "high", {foundAt:"2026-08-01"})], now:NOW });
  assert.equal(d.newLeads.length, 0);
});
test("an unscored bid due soon is flagged as an action", () => {
  const d = buildDigest({ projects:[P("unscored",4)], now:NOW });
  assert.ok(d.actions.some(a => /not scored yet/.test(a.text)));
});
test("hot work needs a score of 70+", () => {
  const d = buildDigest({ projects:[
    P("hot",10,{score_json:JSON.stringify({total:88})}),
    P("cool",10,{score_json:JSON.stringify({total:40})})
  ], now:NOW });
  assert.equal(d.hot.length, 1);
  assert.equal(d.hot[0].name, "hot");
});

/* ---------- rendering ---------- */
test("text digest contains the essentials", () => {
  const d = buildDigest({ projects:[P("Courthouse",0)], leads:[L("Security film IFB")], now:NOW });
  const t = renderDigestText(d, "https://app.example.com");
  assert.match(t, /NEEDS YOU TODAY/);
  assert.match(t, /BID DEADLINES/);
  assert.match(t, /NEW LEADS/);
  assert.match(t, /https:\/\/app\.example\.com/);
});
test("html digest escapes injected markup", () => {
  const d = buildDigest({ leads:[L('<script>alert(1)</script>')], now:NOW });
  const html = renderDigestHtml(d);
  assert.ok(!html.includes("<script>alert"), "script tag must be escaped");
  assert.ok(html.includes("&lt;script&gt;"));
});
test("html digest links leads to their source", () => {
  const d = buildDigest({ leads:[L("Film IFB","high",{links:{page:"https://oa.mo.gov/x.pdf"}})], now:NOW });
  assert.match(renderDigestHtml(d), /href="https:\/\/oa\.mo\.gov\/x\.pdf"/);
});
test("subject line summarises the day", () => {
  const d = buildDigest({ projects:[P("a",0), P("b",3)], leads:[L("x")], now:NOW });
  assert.match(d.subject, /1 due TODAY/);
  assert.match(d.subject, /1 new lead/);
});
