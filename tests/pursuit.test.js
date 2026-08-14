import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildVerification, verificationAccuracy, scheduleFollowups,
  groupFollowups, rankContacts, bestContact, FOLLOWUP_TEMPLATES
} from "../src/pursuit.js";

/* ---------- verification: the AI value must survive forever ---------- */
test("verification records both values and the difference", () => {
  const v = buildVerification({ aiValue: 7528, verifiedValue: 7812 });
  assert.equal(v.ok, true);
  assert.equal(v.aiValue, 7528, "AI value must be preserved");
  assert.equal(v.verifiedValue, 7812);
  assert.equal(v.difference, 284);
  assert.equal(v.percentDiff, 3.8);
  assert.equal(v.status, "ESTIMATOR VERIFIED");
  assert.match(v.display, /7,528.*7,812/);
});
test("a big swing is flagged for review", () => {
  const v = buildVerification({ aiValue: 1000, verifiedValue: 1500 });
  assert.match(v.flag, /50% — worth checking the source sheet/);
  assert.equal(buildVerification({ aiValue: 1000, verifiedValue: 1050 }).flag, null);
});
test("verifying something the AI never produced still works", () => {
  const v = buildVerification({ aiValue: null, verifiedValue: 900 });
  assert.equal(v.aiValue, null);
  assert.equal(v.difference, null);
  assert.match(v.display, /Estimator entered 900/);
});
test("a missing verified value is rejected, not guessed", () => {
  assert.equal(buildVerification({ aiValue: 100, verifiedValue: null }).ok, false);
});
test("negative differences are preserved (AI ran high)", () => {
  const v = buildVerification({ aiValue: 5000, verifiedValue: 4200 });
  assert.equal(v.difference, -800);
  assert.equal(v.percentDiff, -16);
});

test("AI accuracy is withheld until there is enough history", () => {
  const few = verificationAccuracy([{ ai_value: 100, verified_value: 110 }]);
  assert.equal(few.reliable, false);
  assert.equal(few.meanAbsPercent, null);
  assert.match(few.note, /need at least 5/);
});
test("AI accuracy and bias are computed once the sample is there", () => {
  const events = Array.from({ length: 6 }, () => ({ ai_value: 1000, verified_value: 1100 }));
  const a = verificationAccuracy(events);
  assert.equal(a.reliable, true);
  assert.equal(a.meanAbsPercent, 10);
  assert.equal(a.bias, 10);
  assert.match(a.note, /tend to run low/);
});

/* ---------- follow-up scheduling ---------- */
const NOW = new Date("2026-08-12T09:00:00");
test("a schedule is built around the bid date", () => {
  const s = scheduleFollowups({ projectId: "p1", bidDue: "2026-09-10", startDate: NOW });
  const keys = s.map(x => x.key);
  assert.ok(keys.includes("intro_followup"));
  assert.ok(keys.includes("pre_bid_check"));
  assert.ok(keys.includes("bid_reminder"));
  assert.ok(keys.includes("post_bid"));
  const reminder = s.find(x => x.key === "bid_reminder");
  assert.equal(reminder.due_date, "2026-09-08", "2 days before the bid");
  const submit = s.find(x => x.key === "submit");
  assert.equal(submit.due_date, "2026-09-10");
});
test("dates are returned in order", () => {
  const s = scheduleFollowups({ projectId: "p1", bidDue: "2026-09-10", startDate: NOW });
  const dates = s.map(x => x.due_date);
  assert.deepEqual(dates, [...dates].sort());
});
test("nothing is scheduled in the past", () => {
  const s = scheduleFollowups({ projectId: "p1", bidDue: "2026-08-13", startDate: NOW });
  assert.ok(s.every(x => x.due_date >= "2026-08-12"), "no overdue tasks on creation");
  assert.ok(!s.some(x => x.key === "pre_bid_check"), "a 7-day-out task is skipped when the bid is tomorrow");
});
test("with no bid date only the generic follow-ups are created", () => {
  const s = scheduleFollowups({ projectId: "p1", bidDue: null, startDate: NOW });
  assert.equal(s.length, 2);
  assert.deepEqual(s.map(x => x.key), ["intro_followup", "second_followup"]);
});
test("template shape is stable", () => {
  assert.ok(FOLLOWUP_TEMPLATES.every(t => t.key && t.action && t.reason));
});

/* ---------- grouping ---------- */
test("follow-ups bucket into overdue / today / this week / upcoming", () => {
  const g = groupFollowups([
    { id: 1, due_date: "2026-08-09", status: "Open" },
    { id: 2, due_date: "2026-08-12", status: "Open" },
    { id: 3, due_date: "2026-08-15", status: "Open" },
    { id: 4, due_date: "2026-09-30", status: "Open" },
    { id: 5, due_date: "2026-08-01", status: "Done" }
  ], NOW);
  assert.equal(g.overdue.length, 1);
  assert.equal(g.today.length, 1);
  assert.equal(g.thisWeek.length, 1);
  assert.equal(g.upcoming.length, 1);
  assert.equal(g.done.length, 1);
  assert.equal(g.needsAttention, 2);
});
test("completed follow-ups never show as overdue", () => {
  const g = groupFollowups([{ id: 1, due_date: "2026-01-01", status: "Done" }], NOW);
  assert.equal(g.overdue.length, 0);
});

/* ---------- contact ranking ---------- */
const CONTACTS = [
  { name: "Owner Rep", role: "Owner" },
  { name: "Jane Smith", role: "Estimator", email: "j@x.com", phone: "816-555-0100", confidence: 90 },
  { name: "Ann Lee", role: "Architect", email: "a@y.com" }
];
test("the estimator wins on a bidding project", () => {
  const b = bestContact(CONTACTS);
  assert.equal(b.name, "Jane Smith");
  assert.equal(b.priority, "HIGH");
  assert.match(b.reason, /which subs get invited/i);
  assert.equal(b.canEmail, true);
  assert.equal(b.canCall, true);
});
test("on an early project the architect outranks the estimator", () => {
  const b = bestContact(CONTACTS, { projectStage: "Design" });
  assert.equal(b.name, "Ann Lee");
  assert.match(b.reason, /still write film into the specification/i);
});
test("contact details raise the ranking", () => {
  const ranked = rankContacts([
    { name: "A", role: "Estimator" },
    { name: "B", role: "Estimator", email: "b@x.com", phone: "1" }
  ]);
  assert.equal(ranked[0].name, "B");
});
test("no contacts returns null rather than a placeholder", () => {
  assert.equal(bestContact([]), null);
});
