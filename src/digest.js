// Morning digest + deadline reminders.
// The content is built deterministically so it can be unit-tested and so the
// same digest can be previewed in-app whether or not email is configured.
import { num } from "./engines.js";

export const REMINDER_DAYS = [7, 2];   // warn a week out, then two days out

const fmtMoney = n => {
  const v = num(n);
  return v == null ? null : "$" + Math.round(v).toLocaleString("en-US");
};
const dayLabel = d =>
  d === 0 ? "due TODAY" : d === 1 ? "due TOMORROW" : `${d} days left`;

/**
 * Assemble the morning brief.
 * Returns a structured object; rendering is separate so the same data drives
 * both the email and the in-app preview.
 */
export function buildDigest({ leads = [], projects = [], scanSummary = null, now = new Date() } = {}) {
  const today = startOfDay(now);

  // 1. New leads found since the last digest (high relevance first)
  const newLeads = leads
    .filter(l => l.foundAt && startOfDay(new Date(l.foundAt + "T12:00:00")) >= addDays(today, -1))
    .sort((a, b) => (b.relevance === "high") - (a.relevance === "high") || (b.relevanceScore || 0) - (a.relevanceScore || 0))
    .slice(0, 12);

  // 2. Deadlines that need action
  const open = projects.filter(p =>
    !["Awarded", "Lost", "Cancelled", "Archived", "Completed", "No Decision"].includes(p.status));

  const withDays = open.map(p => ({ ...p, days: daysUntil(p.bid_due, today) }));
  const dueToday = withDays.filter(p => p.days === 0);
  const dueSoon = withDays.filter(p => p.days != null && p.days > 0 && p.days <= 7)
    .sort((a, b) => a.days - b.days);
  const reminders = withDays.filter(p => REMINDER_DAYS.includes(p.days));
  const pastDue = withDays.filter(p => p.days != null && p.days < 0);

  // 3. Pre-bid meetings coming up — easy to miss, and attendance is often mandatory
  const preBids = open
    .map(p => ({ ...p, preBidDays: daysUntil(p.prebid_date, today) }))
    .filter(p => p.preBidDays != null && p.preBidDays >= 0 && p.preBidDays <= 7)
    .sort((a, b) => a.preBidDays - b.preBidDays);

  // 4. Highest-scoring open work
  const hot = withDays
    .map(p => ({ ...p, bidScore: parseScore(p) }))
    .filter(p => (p.bidScore ?? 0) >= 70 && (p.days == null || p.days >= 0))
    .sort((a, b) => (b.bidScore || 0) - (a.bidScore || 0))
    .slice(0, 5);

  // 5. Things that need a decision from you
  const actions = [];
  for (const p of dueToday) actions.push({ urgency: "high", text: `${p.name} — bid is due TODAY` });
  for (const p of preBids.filter(p => p.preBidDays <= 1))
    actions.push({ urgency: "high", text: `${p.name} — pre-bid meeting ${p.preBidDays === 0 ? "today" : "tomorrow"}` });
  for (const p of pastDue.slice(0, 3))
    actions.push({ urgency: "medium", text: `${p.name} — deadline passed, record the result or archive it` });
  for (const p of dueSoon.filter(p => parseScore(p) == null).slice(0, 3))
    actions.push({ urgency: "medium", text: `${p.name} — due in ${p.days} days and not scored yet` });

  const hasContent = Boolean(
    newLeads.length || dueToday.length || dueSoon.length || preBids.length || actions.length || pastDue.length);

  return {
    date: today.toISOString().slice(0, 10),
    newLeads, dueToday, dueSoon, reminders, pastDue, preBids, hot, actions,
    scanSummary,
    counts: {
      newLeads: newLeads.length,
      dueThisWeek: dueToday.length + dueSoon.length,
      preBids: preBids.length,
      pastDue: pastDue.length,
      openProjects: open.length
    },
    hasContent,
    subject: buildSubject({ newLeads, dueToday, dueSoon, preBids })
  };
}

function buildSubject({ newLeads, dueToday, dueSoon, preBids }) {
  const bits = [];
  if (dueToday.length) bits.push(`${dueToday.length} due TODAY`);
  if (newLeads.length) bits.push(`${newLeads.length} new lead${newLeads.length === 1 ? "" : "s"}`);
  if (dueSoon.length) bits.push(`${dueSoon.length} due this week`);
  if (preBids.length) bits.push(`${preBids.length} pre-bid`);
  return bits.length ? `Tint Intelligence: ${bits.join(", ")}` : "Tint Intelligence: nothing needs you today";
}

/* ============================================================
   RENDERING
   ============================================================ */
export function renderDigestText(d, appUrl = "") {
  const L = [];
  L.push(`TINT INTELLIGENCE — ${d.date}`);
  L.push("");
  if (!d.hasContent) {
    L.push("No new leads and no deadlines in the next 7 days.");
    L.push("The scanner ran and found nothing that needs you today.");
    return L.join("\n");
  }
  if (d.actions.length) {
    L.push("NEEDS YOU TODAY");
    d.actions.forEach(a => L.push(`  ${a.urgency === "high" ? "!" : "-"} ${a.text}`));
    L.push("");
  }
  if (d.dueToday.length || d.dueSoon.length) {
    L.push("BID DEADLINES");
    [...d.dueToday, ...d.dueSoon].forEach(p =>
      L.push(`  ${dayLabel(p.days)} — ${p.name}${p.bid_due ? ` (${p.bid_due})` : ""}`));
    L.push("");
  }
  if (d.preBids.length) {
    L.push("PRE-BID MEETINGS");
    d.preBids.forEach(p =>
      L.push(`  ${p.preBidDays === 0 ? "today" : p.preBidDays + " days"} — ${p.name} (${p.prebid_date})`));
    L.push("");
  }
  if (d.newLeads.length) {
    L.push(`NEW LEADS (${d.newLeads.length})`);
    d.newLeads.forEach(l => {
      L.push(`  [${(l.relevance || "").toUpperCase()}] ${l.title}`);
      const meta = [l.projectNo && l.projectNo !== "-" ? l.projectNo : null, l.bidDate ? "bids " + l.bidDate : null, l.source]
        .filter(Boolean).join(" · ");
      if (meta) L.push(`         ${meta}`);
    });
    L.push("");
  }
  if (d.hot.length) {
    L.push("HIGHEST SCORING OPEN WORK");
    d.hot.forEach(p => L.push(`  ${p.bidScore}/100 — ${p.name}${p.days != null ? ` (${dayLabel(p.days)})` : ""}`));
    L.push("");
  }
  if (d.scanSummary) L.push(`Scan: ${d.scanSummary}`);
  if (appUrl) { L.push(""); L.push(`Open the app: ${appUrl}`); }
  return L.join("\n");
}

export function renderDigestHtml(d, appUrl = "") {
  const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const S = {
    body: "margin:0;padding:0;background:#F5F8FC;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0C2340",
    wrap: "max-width:600px;margin:0 auto;padding:20px",
    card: "background:#fff;border:1px solid #DBE4F0;border-radius:12px;padding:18px;margin-bottom:14px",
    h2: "margin:0 0 10px;font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#5B6B80",
    row: "padding:8px 0;border-bottom:1px solid #EDF2F9;font-size:14px;line-height:1.5",
    meta: "font-size:12px;color:#5B6B80"
  };
  const P = [];
  P.push(`<div style="${S.body}"><div style="${S.wrap}">`);
  P.push(`<div style="background:#0C2340;color:#fff;border-radius:12px;padding:18px;margin-bottom:14px">
    <div style="font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#4BA3F5;font-weight:600">Tint Tech KC</div>
    <div style="font-size:20px;font-weight:800;margin-top:4px">Morning brief</div>
    <div style="${S.meta};color:rgba(255,255,255,.7)">${esc(d.date)}</div></div>`);

  if (!d.hasContent) {
    P.push(`<div style="${S.card}"><p style="margin:0;font-size:14px">No new leads and no deadlines in the next 7 days. The scanner ran and found nothing that needs you today.</p></div>`);
  } else {
    if (d.actions.length) {
      P.push(`<div style="${S.card}"><div style="${S.h2}">Needs you today</div>`);
      d.actions.forEach(a => P.push(
        `<div style="${S.row};color:${a.urgency === "high" ? "#C43D3D" : "#0C2340"};font-weight:${a.urgency === "high" ? 600 : 400}">${esc(a.text)}</div>`));
      P.push(`</div>`);
    }
    if (d.dueToday.length || d.dueSoon.length) {
      P.push(`<div style="${S.card}"><div style="${S.h2}">Bid deadlines</div>`);
      [...d.dueToday, ...d.dueSoon].forEach(p => P.push(
        `<div style="${S.row}"><b style="color:${p.days <= 2 ? "#C43D3D" : "#1E82E6"}">${esc(dayLabel(p.days))}</b> — ${esc(p.name)}
         <div style="${S.meta}">${esc(p.bid_due || "")}${p.general_contractor ? " · GC: " + esc(p.general_contractor) : ""}</div></div>`));
      P.push(`</div>`);
    }
    if (d.preBids.length) {
      P.push(`<div style="${S.card}"><div style="${S.h2}">Pre-bid meetings</div>`);
      d.preBids.forEach(p => P.push(
        `<div style="${S.row}"><b>${p.preBidDays === 0 ? "Today" : p.preBidDays + " days"}</b> — ${esc(p.name)}
         <div style="${S.meta}">${esc(p.prebid_date || "")}</div></div>`));
      P.push(`</div>`);
    }
    if (d.newLeads.length) {
      P.push(`<div style="${S.card}"><div style="${S.h2}">New leads (${d.newLeads.length})</div>`);
      d.newLeads.forEach(l => {
        const color = l.relevance === "high" ? "#1B9E6B" : "#D97E00";
        const link = l.links?.page || l.links?.ifb || l.sourceUrl;
        const title = link ? `<a href="${esc(link)}" style="color:#0C2340">${esc(l.title)}</a>` : esc(l.title);
        P.push(`<div style="${S.row}">
          <span style="display:inline-block;font-size:10px;font-weight:700;color:${color};background:${color}1A;padding:2px 7px;border-radius:99px;text-transform:uppercase">${esc(l.relevance || "")}</span>
          ${title}
          <div style="${S.meta}">${esc([l.projectNo && l.projectNo !== "-" ? l.projectNo : null, l.bidDate ? "bids " + l.bidDate : null, l.source].filter(Boolean).join(" · "))}</div>
          ${l.matchReasons?.length ? `<div style="font-size:11px;color:#1E82E6">${esc(l.matchReasons[0])}</div>` : ""}
        </div>`);
      });
      P.push(`</div>`);
    }
    if (d.hot.length) {
      P.push(`<div style="${S.card}"><div style="${S.h2}">Highest scoring open work</div>`);
      d.hot.forEach(p => P.push(
        `<div style="${S.row}"><b style="font-family:ui-monospace,monospace">${p.bidScore}/100</b> — ${esc(p.name)}
         ${p.days != null ? `<div style="${S.meta}">${esc(dayLabel(p.days))}</div>` : ""}</div>`));
      P.push(`</div>`);
    }
  }
  if (appUrl) {
    P.push(`<div style="text-align:center;padding:6px 0 18px">
      <a href="${esc(appUrl)}" style="display:inline-block;background:#1E82E6;color:#fff;text-decoration:none;font-weight:600;font-size:14px;padding:11px 20px;border-radius:9px">Open Tint Intelligence</a></div>`);
  }
  if (d.scanSummary) P.push(`<div style="${S.meta};text-align:center;padding-bottom:16px">${esc(d.scanSummary)}</div>`);
  P.push(`</div></div>`);
  return P.join("");
}

/* ============================================================
   SENDING (optional provider)
   ============================================================ */
export async function sendEmail(env, { to, subject, html, text }) {
  const key = env.RESEND_API_KEY;
  if (!key) return { sent: false, reason: "No RESEND_API_KEY configured — digest generated but not emailed." };
  if (!to) return { sent: false, reason: "No DIGEST_TO address configured." };
  const from = env.DIGEST_FROM || "Tint Intelligence <onboarding@resend.dev>";
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({ from, to: [to], subject, html, text })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { sent: false, reason: data.message || `Email provider returned HTTP ${res.status}` };
  return { sent: true, id: data.id };
}

/* helpers */
function startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function daysUntil(dateStr, today) {
  if (!dateStr) return null;
  const m = String(dateStr).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const target = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  const start = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((target - start) / 86400000);
}
function parseScore(p) {
  try {
    const s = p.score_json ? JSON.parse(p.score_json) : p.score;
    return s?.total ?? null;
  } catch { return null; }
}
