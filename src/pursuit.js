// Pursuit engine: estimator verification audit trail + follow-up scheduling.
// Deterministic. AI writes outreach copy; it never decides schedules or math.
import { num } from "./engines.js";

/* ============================================================
   ESTIMATOR VERIFICATION (never overwrite the AI value)
   ============================================================ */
export function buildVerification({ aiValue, verifiedValue, field = "quantity", verifiedBy = "Estimator", notes = null }) {
  const ai = num(aiValue);
  const ver = num(verifiedValue);
  if (ver == null) return { ok: false, error: "A verified value is required." };

  const difference = ai == null ? null : Math.round((ver - ai) * 100) / 100;
  const percentDiff = (ai != null && ai !== 0) ? Math.round((ver - ai) / ai * 1000) / 10 : null;

  return {
    ok: true,
    field,
    aiValue: ai,                       // preserved, never replaced
    verifiedValue: ver,
    difference,
    percentDiff,
    verifiedBy,
    notes,
    status: "ESTIMATOR VERIFIED",
    display: ai == null
      ? `Estimator entered ${ver.toLocaleString()}`
      : `AI ${ai.toLocaleString()} → verified ${ver.toLocaleString()} (${difference > 0 ? "+" : ""}${difference.toLocaleString()}${percentDiff != null ? `, ${percentDiff > 0 ? "+" : ""}${percentDiff}%` : ""})`,
    // A large swing is worth surfacing: it usually means the AI misread a schedule
    flag: percentDiff != null && Math.abs(percentDiff) >= 20
      ? `Verified value differs from the AI estimate by ${Math.abs(percentDiff)}% — worth checking the source sheet.`
      : null
  };
}

/** Accuracy of AI takeoffs over time, once there is enough history. */
export function verificationAccuracy(events = [], minSample = 5) {
  const usable = events.filter(e => num(e.ai_value) != null && num(e.verified_value) != null && num(e.ai_value) !== 0);
  if (usable.length < minSample) {
    return {
      sample: usable.length, reliable: false,
      meanAbsPercent: null, bias: null,
      note: `${usable.length} verified item(s) — need at least ${minSample} before AI accuracy means anything.`
    };
  }
  const diffs = usable.map(e => (num(e.verified_value) - num(e.ai_value)) / num(e.ai_value) * 100);
  const meanAbs = diffs.reduce((s, d) => s + Math.abs(d), 0) / diffs.length;
  const mean = diffs.reduce((s, d) => s + d, 0) / diffs.length;
  return {
    sample: usable.length, reliable: true,
    meanAbsPercent: Math.round(meanAbs * 10) / 10,
    bias: Math.round(mean * 10) / 10,
    note: `Across ${usable.length} verified items, AI takeoffs are off by an average of ${Math.round(meanAbs * 10) / 10}%${Math.abs(mean) >= 3 ? `, and tend to run ${mean > 0 ? "low" : "high"}` : ""}.`
  };
}

/* ============================================================
   FOLLOW-UP SCHEDULING
   ============================================================ */
export const FOLLOWUP_TEMPLATES = [
  { key: "intro_followup",  offsetDays: 2,  action: "Email", reason: "Follow up on the introduction" },
  { key: "second_followup", offsetDays: 5,  action: "Call",  reason: "Second follow-up — no response yet" },
  { key: "pre_bid_check",   beforeBidDays: 7, action: "Call", reason: "Confirm scope and ask outstanding questions" },
  { key: "bid_reminder",    beforeBidDays: 2, action: "Review", reason: "Final review before the bid deadline" },
  { key: "submit",          beforeBidDays: 0, action: "Submit", reason: "Bid is due today" },
  { key: "post_bid",        afterBidDays: 3,  action: "Call",  reason: "Post-bid follow-up — ask where you landed" },
  { key: "award_check",     afterBidDays: 14, action: "Email", reason: "Award status check" }
];

/**
 * Generate the follow-up schedule for a project. Pure date math — no AI.
 * Past-dated items are skipped so a new project doesn't create overdue tasks.
 */
export function scheduleFollowups({ projectId, bidDue, contactName = null, startDate = new Date(), outreachId = null }) {
  const start = startOfDay(startDate);
  const bid = bidDue ? parseISO(bidDue) : null;
  const out = [];

  for (const t of FOLLOWUP_TEMPLATES) {
    let due = null;
    if (t.offsetDays != null) due = addDays(start, t.offsetDays);
    else if (t.beforeBidDays != null && bid) due = addDays(bid, -t.beforeBidDays);
    else if (t.afterBidDays != null && bid) due = addDays(bid, t.afterBidDays);
    if (!due) continue;
    if (due < start) continue;              // never create something already overdue
    out.push({
      key: t.key, project_id: projectId, outreach_id: outreachId,
      contact_name: contactName, action: t.action, reason: t.reason,
      due_date: due.toISOString().slice(0, 10),
      status: "Open", auto_generated: 1
    });
  }
  return out.sort((a, b) => a.due_date.localeCompare(b.due_date));
}

/** Bucket follow-ups the way a person works a day. */
export function groupFollowups(items = [], now = new Date()) {
  const today = startOfDay(now);
  const buckets = { overdue: [], today: [], thisWeek: [], upcoming: [], done: [] };
  for (const f of items) {
    if (f.status === "Done" || f.status === "Skipped") { buckets.done.push(f); continue; }
    const d = f.due_date ? daysBetween(today, f.due_date) : null;
    const row = { ...f, daysUntil: d };
    if (d == null) buckets.upcoming.push(row);
    else if (d < 0) buckets.overdue.push(row);
    else if (d === 0) buckets.today.push(row);
    else if (d <= 7) buckets.thisWeek.push(row);
    else buckets.upcoming.push(row);
  }
  for (const k of Object.keys(buckets)) {
    buckets[k].sort((a, b) => String(a.due_date || "").localeCompare(String(b.due_date || "")));
  }
  return {
    ...buckets,
    counts: {
      overdue: buckets.overdue.length, today: buckets.today.length,
      thisWeek: buckets.thisWeek.length, upcoming: buckets.upcoming.length
    },
    needsAttention: buckets.overdue.length + buckets.today.length
  };
}

/* ============================================================
   BEST CONTACT (deterministic ranking)
   ============================================================ */
const ROLE_PRIORITY = {
  "Estimator": 100, "Preconstruction": 95, "Preconstruction Manager": 95,
  "Procurement": 80, "Project Manager": 75, "Specification Writer": 90,
  "Architect": 85, "Glazing Contractor": 70, "Owner": 60, "Developer": 60,
  "Facility Manager": 55, "Other": 30
};

export function rankContacts(contacts = [], { projectStage = null } = {}) {
  return contacts
    .map(c => {
      const role = c.role || c.title || "Other";
      let score = ROLE_PRIORITY[role] ?? 30;
      // Early projects: the specifier matters more than the estimator
      if (["Planning", "Design", "Permitting"].includes(projectStage)) {
        if (/architect|specification/i.test(role)) score += 25;
        if (/estimator|procurement/i.test(role)) score -= 20;
      }
      if (c.email) score += 8;
      if (c.phone) score += 6;
      if (num(c.confidence) != null) score += Math.round(num(c.confidence) / 20);
      return { ...c, contactScore: score, role };
    })
    .sort((a, b) => b.contactScore - a.contactScore);
}

export function bestContact(contacts = [], opts = {}) {
  const ranked = rankContacts(contacts, opts);
  if (!ranked.length) return null;
  const top = ranked[0];
  return {
    ...top,
    priority: top.contactScore >= 90 ? "HIGH" : top.contactScore >= 60 ? "MEDIUM" : "LOW",
    reason: reasonFor(top, opts.projectStage),
    canEmail: Boolean(top.email),
    canCall: Boolean(top.phone)
  };
}

function reasonFor(c, stage) {
  const role = (c.role || "").toLowerCase();
  if (/estimator|precon/.test(role)) return "Estimators control which subs get invited to bid.";
  if (/specification|architect/.test(role)) {
    return ["Planning", "Design", "Permitting"].includes(stage)
      ? "The project is early enough that the architect can still write film into the specification."
      : "Architects can clarify film scope and specification conflicts.";
  }
  if (/procurement/.test(role)) return "Procurement holds the bid list and the documents.";
  if (/glazing/.test(role)) return "The glazing contractor often subcontracts film — a referral route.";
  if (/owner|developer|facility/.test(role)) return "Owners can add film scope directly, outside the GC's bid.";
  return "Listed contact on this project.";
}

/* helpers */
function startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function parseISO(s) {
  const m = String(s || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
}
function daysBetween(today, dateStr) {
  const d = parseISO(dateStr);
  if (!d) return null;
  return Math.round((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) -
    Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())) / 86400000);
}
