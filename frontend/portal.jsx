import { useState, useEffect, useCallback } from "react";
import {
  Loader2, LogOut, CheckCircle2, XCircle, Clock, MapPin, Building2,
  Calendar, FileText, AlertTriangle, ArrowLeft, Send, Trophy, Ban, Timer
} from "lucide-react";

/* ============ Tint Intelligence — contractor portal ============
   Deliberately a separate bundle from the admin app (app.jsx). Different
   audience, different job: a contractor opens this to decide "do I want
   this job?" and little else. Keeping it separate also means the admin
   tool's 172KB never loads for a customer, and an admin-side change can't
   break the customer-facing surface.
   ============================================================== */

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Archivo:wght@600;700;800&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;600&display=swap');
:root{
  --navy:#0C2340; --ink:#071A30; --azure:#1E82E6; --azure2:#4BA3F5;
  --paper:#F5F8FC; --card:#FFFFFF; --line:#DBE4F0; --slate:#5B6B80;
  --good:#1B9E6B; --warn:#D97E00; --bad:#C43D3D;
}
*{box-sizing:border-box} body{margin:0}
.pf{font-family:'Inter',sans-serif;color:var(--navy);background:var(--paper);min-height:100vh}
.pf h1,.pf h2,.pf h3,.disp{font-family:'Archivo',sans-serif;letter-spacing:-.01em;margin:0}
.mono{font-family:'JetBrains Mono',monospace;font-variant-numeric:tabular-nums}

.top{background:linear-gradient(180deg,var(--navy),var(--ink));color:#fff;padding:14px 20px;
  display:flex;align-items:center;gap:14px;flex-wrap:wrap;position:sticky;top:0;z-index:20}
.top b{font-family:'Archivo';font-weight:800;font-size:16px}
.top .who{margin-left:auto;font-size:12.5px;color:rgba(255,255,255,.7);display:flex;align-items:center;gap:12px}
.ghost{background:rgba(255,255,255,.1);border:0;color:#fff;border-radius:8px;padding:8px 12px;
  font:600 12.5px 'Inter';cursor:pointer;display:inline-flex;align-items:center;gap:6px;min-height:38px}
.ghost:hover{background:rgba(255,255,255,.18)}

/* Quarter-to-date bar. Present on every screen on purpose: a quarterly
   invoice should never be the first time a number is seen. */
.qtd{background:#EAF3FE;border-bottom:1px solid var(--line);padding:9px 20px;font-size:13px;
  display:flex;gap:16px;align-items:center;flex-wrap:wrap;color:var(--navy)}
.qtd b{font-family:'JetBrains Mono';font-variant-numeric:tabular-nums}

.wrap{max-width:1080px;margin:0 auto;padding:22px 20px 70px}
.tabs{display:flex;gap:6px;overflow-x:auto;padding-bottom:12px;margin-bottom:4px}
.tabs button{border:1px solid var(--line);background:#fff;color:var(--slate);border-radius:999px;
  padding:9px 15px;font:600 13px 'Inter';cursor:pointer;white-space:nowrap;min-height:40px}
.tabs button.on{background:var(--azure);border-color:var(--azure);color:#fff}
.tabs .n{opacity:.7;margin-left:5px}

.card{background:var(--card);border:1px solid var(--line);border-radius:14px}
.lead{padding:16px;margin-bottom:10px;display:block;width:100%;text-align:left;cursor:pointer;
  border:1px solid var(--line);background:#fff;border-radius:14px;transition:border-color .15s,box-shadow .15s}
.lead:hover{border-color:var(--azure);box-shadow:0 2px 12px rgba(12,35,64,.07)}
.lead .id{font:600 11.5px 'JetBrains Mono';color:var(--azure);letter-spacing:.02em}
.lead h3{font-size:16px;font-weight:700;margin:4px 0 5px}
.meta{display:flex;flex-wrap:wrap;gap:12px;color:var(--slate);font-size:12.5px;align-items:center}
.meta span{display:inline-flex;align-items:center;gap:5px}

.pill{display:inline-flex;align-items:center;gap:5px;border-radius:999px;padding:3px 10px;
  font:600 11.5px 'Inter';white-space:nowrap}
.p-new{background:#E6F0FB;color:#15558F} .p-act{background:#FFF2DE;color:#8A5200}
.p-bid{background:#EDE7FB;color:#4B2E97} .p-won{background:#E3F5EC;color:#116646}
.p-lost{background:#FBE9E9;color:#8C2B2B} .p-dead{background:#EEF1F5;color:var(--slate)}

.due{font:600 12.5px 'Inter'} .due.soon{color:var(--bad)} .due.near{color:var(--warn)}

.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;border:0;border-radius:10px;
  padding:12px 18px;font:600 14px 'Inter';cursor:pointer;min-height:46px;transition:filter .15s}
.btn:hover{filter:brightness(1.06)} .btn:disabled{opacity:.55;cursor:not-allowed}
.btn.pri{background:var(--azure);color:#fff} .btn.win{background:var(--good);color:#fff}
.btn.sec{background:#fff;border:1px solid var(--line);color:var(--navy)}
.btn.dang{background:#fff;border:1px solid #E7B9B9;color:var(--bad)}
.btn.full{width:100%}

.det h1{font-size:23px;font-weight:800;line-height:1.25;margin:6px 0 6px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;margin:16px 0}
.fact{background:#fff;border:1px solid var(--line);border-radius:12px;padding:13px}
.fact label{display:block;font-size:11px;text-transform:uppercase;letter-spacing:.07em;color:var(--slate);font-weight:600}
.fact div{font-size:15px;font-weight:600;margin-top:5px}

.disclose{background:#FFF8E8;border:1px solid #F0DDB0;border-radius:12px;padding:14px;
  display:flex;gap:10px;font-size:13.5px;line-height:1.5;margin:16px 0}
.err{background:#FBE9E9;border:1px solid #E7B9B9;color:#8C2B2B;border-radius:10px;padding:11px 13px;
  font-size:13.5px;margin:12px 0}
.ok{background:#E3F5EC;border:1px solid #A9DCC4;color:#116646;border-radius:10px;padding:11px 13px;
  font-size:13.5px;margin:12px 0}

.tl{list-style:none;padding:0;margin:14px 0 0}
.tl li{position:relative;padding:0 0 15px 22px;font-size:13px;color:var(--slate)}
.tl li::before{content:'';position:absolute;left:3px;top:5px;width:9px;height:9px;border-radius:50%;background:var(--azure)}
.tl li::after{content:'';position:absolute;left:7px;top:16px;bottom:0;width:1px;background:var(--line)}
.tl li:last-child::after{display:none}
.tl b{color:var(--navy);font-weight:600;display:block}
.tl .void{text-decoration:line-through;opacity:.55}

.modal{position:fixed;inset:0;background:rgba(7,26,48,.55);display:flex;align-items:center;
  justify-content:center;padding:18px;z-index:60}
.sheet{background:#fff;border-radius:16px;max-width:560px;width:100%;max-height:88vh;overflow:auto;padding:22px}
.terms{background:var(--paper);border:1px solid var(--line);border-radius:10px;padding:14px;
  max-height:230px;overflow:auto;font-size:12.5px;line-height:1.6;white-space:pre-wrap;margin:12px 0}
label.chk{display:flex;gap:9px;align-items:flex-start;font-size:13.5px;line-height:1.5;cursor:pointer;margin:12px 0}
input[type=checkbox]{width:19px;height:19px;margin-top:1px;flex-shrink:0;accent-color:var(--azure)}
.field{margin:12px 0}
.field label{display:block;font-size:12.5px;font-weight:600;color:var(--slate);margin-bottom:6px}
.field input,.field select,.field textarea{width:100%;padding:11px 13px;border:1px solid var(--line);
  border-radius:10px;font:400 14px 'Inter';min-height:46px}
.field input:focus,.field select:focus,.field textarea:focus{outline:2px solid var(--azure);outline-offset:1px}

.empty{text-align:center;padding:52px 20px;color:var(--slate)}
.empty h3{font-size:16px;color:var(--navy);margin-bottom:7px}

.login{max-width:390px;margin:9vh auto;padding:0 20px}
.login .card{padding:26px}
.center{display:flex;align-items:center;justify-content:center;padding:60px;color:var(--slate);gap:9px}
@media(max-width:640px){ .wrap{padding:16px 14px 60px} .det h1{font-size:20px} }
`;

const api = async (path, opts = {}) => {
  const res = await fetch(path, {
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    ...opts
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(body.error || `Request failed (${res.status})`), { status: res.status, body });
  return body;
};

const money = n => "$" + Number(n || 0).toLocaleString();
const dateStr = s => s ? new Date(s).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "—";

function daysUntil(iso) {
  if (!iso) return null;
  return Math.ceil((new Date(iso) - new Date()) / 86400000);
}

/* Buckets shown as tabs. Maps the lifecycle statuses onto the six views
   the spec asks for, so a contractor never has to learn our vocabulary. */
const TABS = [
  { key: "new", label: "New", statuses: ["DELIVERED", "VIEWED"] },
  { key: "active", label: "Active", statuses: ["CLAIMED", "PURSUING"] },
  { key: "bids", label: "Bids submitted", statuses: ["BID_SUBMITTED", "AWAITING_RESULT"] },
  { key: "won", label: "Won", statuses: ["WON"] },
  { key: "lost", label: "Lost", statuses: ["LOST", "CANCELLED", "DECLINED", "RELEASED"] },
  { key: "billing", label: "Billing", statuses: ["BILLABLE", "INVOICED", "PAID"] }
];

const STATUS_PILL = {
  DELIVERED: ["p-new", "New"], VIEWED: ["p-new", "Opened"],
  CLAIMED: ["p-act", "Claimed"], PURSUING: ["p-act", "Pursuing"],
  BID_SUBMITTED: ["p-bid", "Bid submitted"], AWAITING_RESULT: ["p-bid", "Awaiting result"],
  WON: ["p-won", "Won"], LOST: ["p-lost", "Lost"],
  CANCELLED: ["p-dead", "Cancelled"], DECLINED: ["p-dead", "Passed"],
  RELEASED: ["p-dead", "Released"],
  BILLABLE: ["p-act", "Billable"], INVOICED: ["p-act", "Invoiced"], PAID: ["p-won", "Paid"]
};

/* ---------------- login ---------------- */

function Login({ onIn }) {
  const [username, setU] = useState("");
  const [password, setP] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async e => {
    e.preventDefault();
    setBusy(true); setErr("");
    try {
      await api("/api/auth/login", { method: "POST", body: JSON.stringify({ username, password }) });
      onIn();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  return (
    <div className="pf">
      <div className="login">
        <div style={{ textAlign: "center", marginBottom: 20 }}>
          <div className="disp" style={{ fontSize: 21, fontWeight: 800 }}>Tint Intelligence</div>
          <div style={{ color: "var(--slate)", fontSize: 13.5, marginTop: 4 }}>Contractor lead portal</div>
        </div>
        <form className="card" onSubmit={submit}>
          <div className="field">
            <label htmlFor="u">Username</label>
            <input id="u" value={username} onChange={e => setU(e.target.value)} autoComplete="username" required />
          </div>
          <div className="field">
            <label htmlFor="p">Password</label>
            <input id="p" type="password" value={password} onChange={e => setP(e.target.value)} autoComplete="current-password" required />
          </div>
          {err && <div className="err">{err}</div>}
          <button className="btn pri full" disabled={busy} style={{ marginTop: 6 }}>
            {busy ? <><Loader2 size={16} className="spin" /> Signing in…</> : "Sign in"}
          </button>
        </form>
        <p style={{ color: "var(--slate)", fontSize: 12, textAlign: "center", marginTop: 16 }}>
          Trouble signing in? Contact your Tint Intelligence rep.
        </p>
      </div>
    </div>
  );
}

/* ---------------- claim modal ---------------- */

function ClaimModal({ lead, disclosure, terms, onClose, onDone }) {
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const claim = async () => {
    setBusy(true); setErr("");
    try {
      await api(`/api/portal/leads/${lead.id}/claim`, {
        method: "POST", body: JSON.stringify({ acceptTerms: true })
      });
      onDone();
    } catch (e) { setErr(e.message); setBusy(false); }
  };

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Claim this opportunity">
      <div className="sheet">
        <h2 style={{ fontSize: 19 }}>Claim this opportunity</h2>
        <p style={{ color: "var(--slate)", fontSize: 13.5, marginTop: 6 }}>{lead.project_name}</p>

        {/* The price is stated before the action, never after. */}
        <div className="disclose">
          <AlertTriangle size={17} style={{ flexShrink: 0, color: "var(--warn)" }} />
          <div>{disclosure}</div>
        </div>

        {terms && (
          <>
            <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--slate)" }}>
              Lead terms ({terms.version})
            </div>
            <div className="terms">{terms.body}</div>
            <label className="chk">
              <input type="checkbox" checked={agree} onChange={e => setAgree(e.target.checked)} />
              <span>I have read and accept the lead terms above, and I understand the charge described.</span>
            </label>
          </>
        )}

        {err && <div className="err">{err}</div>}

        <div style={{ display: "flex", gap: 9, marginTop: 14 }}>
          <button className="btn sec" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn pri" style={{ flex: 1 }} onClick={claim} disabled={busy || (terms && !agree)}>
            {busy ? <><Loader2 size={16} className="spin" /> Claiming…</> : "Claim this lead"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------------- bid / outcome modals ---------------- */

function BidModal({ lead, onClose, onDone }) {
  const [amount, setAmount] = useState("");
  const [bidDate, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const save = async () => {
    setBusy(true); setErr("");
    try {
      await api(`/api/portal/leads/${lead.id}/bid`, {
        method: "POST",
        body: JSON.stringify({ amount: Number(amount), bidDate: new Date(bidDate).toISOString(), notes })
      });
      onDone();
    } catch (e) { setErr(e.message); setBusy(false); }
  };

  return (
    <div className="modal" role="dialog" aria-modal="true">
      <div className="sheet">
        <h2 style={{ fontSize: 19 }}>Record your bid</h2>
        <div className="field">
          <label htmlFor="amt">Bid amount</label>
          <input id="amt" type="number" min="1" step="1" value={amount}
            onChange={e => setAmount(e.target.value)} placeholder="84500" />
        </div>
        <div className="field">
          <label htmlFor="bd">Bid date</label>
          <input id="bd" type="date" value={bidDate} onChange={e => setDate(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="nt">Notes (optional)</label>
          <textarea id="nt" rows={3} value={notes} onChange={e => setNotes(e.target.value)}
            placeholder="Scope, exclusions, who you bid to…" />
        </div>
        {err && <div className="err">{err}</div>}
        <div style={{ display: "flex", gap: 9 }}>
          <button className="btn sec" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn pri" style={{ flex: 1 }} onClick={save} disabled={busy || !amount}>
            {busy ? "Saving…" : "Save bid"}
          </button>
        </div>
      </div>
    </div>
  );
}

function OutcomeModal({ lead, onClose, onDone }) {
  const [outcome, setOutcome] = useState("won");
  const [awardAmount, setAward] = useState("");
  const [lossReason, setLoss] = useState("Price");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const save = async () => {
    setBusy(true); setErr("");
    try {
      await api(`/api/portal/leads/${lead.id}/outcome`, {
        method: "POST",
        body: JSON.stringify({
          outcome,
          awardAmount: outcome === "won" ? Number(awardAmount) || null : null,
          lossReason: outcome === "lost" ? lossReason : null,
          notes
        })
      });
      onDone();
    } catch (e) { setErr(e.message); setBusy(false); }
  };

  return (
    <div className="modal" role="dialog" aria-modal="true">
      <div className="sheet">
        <h2 style={{ fontSize: 19 }}>How did this one turn out?</h2>
        <div className="field">
          <label htmlFor="oc">Result</label>
          <select id="oc" value={outcome} onChange={e => setOutcome(e.target.value)}>
            <option value="won">We won it</option>
            <option value="lost">We lost it</option>
            <option value="cancelled">Project cancelled</option>
          </select>
        </div>
        {outcome === "won" && (
          <div className="field">
            <label htmlFor="aw">Award amount</label>
            <input id="aw" type="number" min="0" value={awardAmount} onChange={e => setAward(e.target.value)} placeholder="84500" />
          </div>
        )}
        {outcome === "lost" && (
          <div className="field">
            <label htmlFor="lr">Why?</label>
            <select id="lr" value={lossReason} onChange={e => setLoss(e.target.value)}>
              <option>Price</option><option>Competitor</option>
              <option>GC picked another sub</option><option>Scope removed</option>
              <option>No response</option><option>Other</option>
            </select>
          </div>
        )}
        <div className="field">
          <label htmlFor="on">Notes (optional)</label>
          <textarea id="on" rows={3} value={notes} onChange={e => setNotes(e.target.value)} />
        </div>
        {err && <div className="err">{err}</div>}
        <div style={{ display: "flex", gap: 9 }}>
          <button className="btn sec" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn win" style={{ flex: 1 }} onClick={save} disabled={busy}>
            {busy ? "Saving…" : "Save result"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ReleaseModal({ lead, release, onClose, onDone }) {
  const [reason, setReason] = useState("no_film_scope");
  const [detail, setDetail] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const LABELS = {
    already_awarded: "Project was already awarded",
    no_film_scope: "No window film in the scope",
    wrong_location: "Outside our service area",
    bad_contact: "Can't reach the GC or owner",
    duplicate: "We already had this project",
    deadline_passed: "Bid date had already passed",
    inaccurate_listing: "Details don't match the listing",
    other: "Something else"
  };

  const submit = async () => {
    setBusy(true); setErr("");
    try {
      await api(`/api/portal/leads/${lead.id}/release`, {
        method: "POST", body: JSON.stringify({ reason, detail })
      });
      onDone();
    } catch (e) { setErr(e.message); setBusy(false); }
  };

  return (
    <div className="modal" role="dialog" aria-modal="true">
      <div className="sheet">
        <h2 style={{ fontSize: 19 }}>Hand this lead back</h2>
        <p style={{ color: "var(--slate)", fontSize: 13.5, marginTop: 6 }}>
          You won't be charged for it. You have {release.hoursRemaining} hour
          {release.hoursRemaining === 1 ? "" : "s"} left to do this.
        </p>

        <div className="field">
          <label htmlFor="rr">What was wrong with it?</label>
          <select id="rr" value={reason} onChange={e => setReason(e.target.value)}>
            {release.reasons.map(r => <option key={r} value={r}>{LABELS[r] || r}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="rd">Anything else? (optional)</label>
          <textarea id="rd" rows={3} value={detail} onChange={e => setDetail(e.target.value)}
            placeholder="Helps us stop sending leads like this one." />
        </div>

        {err && <div className="err">{err}</div>}
        <div style={{ display: "flex", gap: 9 }}>
          <button className="btn sec" onClick={onClose} disabled={busy}>Keep it</button>
          <button className="btn dang" style={{ flex: 1 }} onClick={submit} disabled={busy}>
            {busy ? "Releasing…" : "Release this lead"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------------- lead detail ---------------- */

function LeadDetail({ leadRowId, onBack, onChanged }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [modal, setModal] = useState(null);
  const [flash, setFlash] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api(`/api/portal/leads/${leadRowId}`).then(setData).catch(e => setErr(e.message));
  }, [leadRowId]);

  useEffect(() => { load(); }, [load]);

  const act = async (action, body = {}) => {
    setBusy(true);
    try {
      const r = await api(`/api/portal/leads/${leadRowId}/${action}`, { method: "POST", body: JSON.stringify(body) });
      if (r.message) setFlash(r.message);
      load(); onChanged();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  if (err) return <div className="wrap"><div className="err">{err}</div>
    <button className="btn sec" onClick={onBack}>Back to leads</button></div>;
  if (!data) return <div className="center"><Loader2 size={18} className="spin" /> Loading…</div>;

  const { lead, project, actions, billingDisclosure, terms, timeline, release } = data;
  const p = project || {};
  const dLeft = daysUntil(p.bid_due);
  const [cls, label] = STATUS_PILL[lead.status] || ["p-dead", lead.status];

  return (
    <div className="wrap det">
      <button className="ghost" onClick={onBack}
        style={{ background: "#fff", border: "1px solid var(--line)", color: "var(--navy)", marginBottom: 12 }}>
        <ArrowLeft size={15} /> All leads
      </button>

      <div className="mono" style={{ fontSize: 11.5, color: "var(--azure)", fontWeight: 600 }}>{lead.lead_id}</div>
      <h1>{p.name || "Opportunity"}</h1>
      <div className="meta" style={{ marginBottom: 4 }}>
        <span className={`pill ${cls}`}>{label}</span>
        {p.city && <span><MapPin size={13} />{p.city}{p.state ? `, ${p.state}` : ""}</span>}
        {p.bid_due && (
          <span className={`due ${dLeft <= 3 ? "soon" : dLeft <= 7 ? "near" : ""}`}>
            <Calendar size={13} style={{ verticalAlign: -2, marginRight: 4 }} />
            Bid due {dateStr(p.bid_due)}{dLeft != null && dLeft >= 0 ? ` · ${dLeft} day${dLeft === 1 ? "" : "s"}` : ""}
          </span>
        )}
      </div>

      {flash && <div className="ok"><CheckCircle2 size={16} style={{ verticalAlign: -3 }} /> {flash}</div>}

      {release && (
        <div className="disclose" style={{ background: "#EAF3FE", borderColor: "#BBD9F7" }}>
          <Clock size={17} style={{ flexShrink: 0, color: "var(--azure)" }} />
          <div>
            Opened the documents and it isn't what you expected? You have{" "}
            <strong>{release.hoursRemaining} hour{release.hoursRemaining === 1 ? "" : "s"}</strong>{" "}
            to hand this back without being charged.
          </div>
        </div>
      )}

      <div className="grid">
        <div className="fact"><label>General contractor</label><div>{p.general_contractor || "Not listed"}</div></div>
        <div className="fact"><label>Architect</label><div>{p.architect || "Not listed"}</div></div>
        <div className="fact"><label>Project type</label><div>{p.project_type || "Not stated"}</div></div>
        <div className="fact">
          <label>Estimated glazing</label>
          <div>{p.estimated_glazing_square_feet ? `${Number(p.estimated_glazing_square_feet).toLocaleString()} SF` : "Unknown"}</div>
        </div>
      </div>

      {/* Billing terms are shown before any billable action, always. */}
      {["DELIVERED", "VIEWED"].includes(lead.status) && (
        <div className="disclose">
          <AlertTriangle size={17} style={{ flexShrink: 0, color: "var(--warn)" }} />
          <div>{billingDisclosure}</div>
        </div>
      )}

      {lead.bid_amount ? (
        <div className="fact" style={{ marginBottom: 14 }}>
          <label>Your bid</label>
          <div className="mono">{money(lead.bid_amount)} · submitted {dateStr(lead.bid_submitted_at)}</div>
        </div>
      ) : null}

      {/* Actions come from the server, so the UI can never offer a
          transition the backend would reject. */}
      <div style={{ display: "flex", gap: 9, flexWrap: "wrap", margin: "16px 0" }}>
        {actions.includes("claim") && (
          <button className="btn pri" disabled={busy} onClick={() => setModal("claim")}>
            <CheckCircle2 size={16} /> Claim this lead
          </button>
        )}
        {actions.includes("reserve") && (
          <button className="btn sec" disabled={busy} onClick={() => act("reserve", { hours: 48 })}>
            <Timer size={16} /> Hold for 48 hours
          </button>
        )}
        {actions.includes("pursuing") && (
          <button className="btn pri" disabled={busy} onClick={() => act("pursuing")}>
            <Send size={16} /> We're pursuing this
          </button>
        )}
        {actions.includes("submit_bid") && (
          <button className="btn pri" disabled={busy} onClick={() => setModal("bid")}>
            <FileText size={16} /> Record our bid
          </button>
        )}
        {actions.includes("report_won") && (
          <button className="btn win" disabled={busy} onClick={() => setModal("outcome")}>
            <Trophy size={16} /> Report the result
          </button>
        )}
        {actions.includes("release") && release && (
          <button className="btn sec" disabled={busy} onClick={() => setModal("release")}>
            <Ban size={16} /> Hand this back
          </button>
        )}
        {actions.includes("decline") && (
          <button className="btn dang" disabled={busy}
            onClick={() => act("decline", { reason: "Not a fit" })}>
            <Ban size={16} /> Not interested
          </button>
        )}
      </div>

      {p.notes && (
        <div className="card" style={{ padding: 16, marginBottom: 14 }}>
          <label style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".07em", color: "var(--slate)", fontWeight: 600 }}>
            Scope notes
          </label>
          <p style={{ fontSize: 13.5, lineHeight: 1.6, margin: "7px 0 0" }}>{p.notes}</p>
        </div>
      )}

      {p.source_url && (
        <a className="btn sec" href={p.source_url} target="_blank" rel="noopener noreferrer">
          <Building2 size={16} /> View original posting
        </a>
      )}

      <h3 style={{ fontSize: 15, marginTop: 26 }}>History</h3>
      <ul className="tl">
        {timeline.map((t, i) => (
          <li key={i} className={t.voided ? "void" : ""}>
            <b>{t.label}</b>{dateStr(t.at)} · {t.actor}
          </li>
        ))}
      </ul>

      {modal === "claim" && (
        <ClaimModal lead={{ ...lead, project_name: p.name }} disclosure={billingDisclosure} terms={terms}
          onClose={() => setModal(null)}
          onDone={() => { setModal(null); setFlash("You have claimed this opportunity."); load(); onChanged(); }} />
      )}
      {modal === "release" && release && (
        <ReleaseModal lead={lead} release={release} onClose={() => setModal(null)}
          onDone={() => { setModal(null); setFlash("Released. You won't be charged for this lead."); load(); onChanged(); }} />
      )}
      {modal === "bid" && <BidModal lead={lead} onClose={() => setModal(null)}
        onDone={() => { setModal(null); load(); onChanged(); }} />}
      {modal === "outcome" && <OutcomeModal lead={lead} onClose={() => setModal(null)}
        onDone={() => { setModal(null); load(); onChanged(); }} />}
    </div>
  );
}

/* ---------------- board ---------------- */

function Board({ onOpen, refreshKey }) {
  const [leads, setLeads] = useState(null);
  const [tab, setTab] = useState("new");
  const [err, setErr] = useState("");

  useEffect(() => {
    api("/api/portal/leads").then(setLeads).catch(e => setErr(e.message));
  }, [refreshKey]);

  if (err) return <div className="wrap"><div className="err">{err}</div></div>;
  if (!leads) return <div className="center"><Loader2 size={18} className="spin" /> Loading your leads…</div>;

  const counts = {};
  for (const t of TABS) counts[t.key] = leads.filter(l => t.statuses.includes(l.status)).length;
  const shown = leads.filter(l => (TABS.find(t => t.key === tab)?.statuses || []).includes(l.status));

  return (
    <div className="wrap">
      <div className="tabs">
        {TABS.map(t => (
          <button key={t.key} className={tab === t.key ? "on" : ""} onClick={() => setTab(t.key)}>
            {t.label}{counts[t.key] > 0 && <span className="n">{counts[t.key]}</span>}
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <div className="empty card">
          <h3>Nothing here yet</h3>
          <p style={{ fontSize: 13.5 }}>
            {tab === "new"
              ? "New opportunities will appear here as we find them."
              : "No leads in this stage right now."}
          </p>
        </div>
      ) : shown.map(l => {
        const dLeft = daysUntil(l.bid_due);
        const [cls, label] = STATUS_PILL[l.status] || ["p-dead", l.status];
        return (
          <button key={l.id} className="lead" onClick={() => onOpen(l.id)}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
              <div style={{ minWidth: 0 }}>
                <div className="id">{l.lead_id}</div>
                <h3>{l.project_name}</h3>
                <div className="meta">
                  {l.city && <span><MapPin size={13} />{l.city}{l.state ? `, ${l.state}` : ""}</span>}
                  {l.general_contractor && <span><Building2 size={13} />{l.general_contractor}</span>}
                  {l.bid_due && (
                    <span className={`due ${dLeft <= 3 ? "soon" : dLeft <= 7 ? "near" : ""}`}>
                      <Clock size={13} />
                      {dLeft < 0 ? "Bid date passed" : dLeft === 0 ? "Due today" : `${dLeft} days left`}
                    </span>
                  )}
                </div>
              </div>
              <span className={`pill ${cls}`}>{label}</span>
            </div>
          </button>
        );
      })}
    </div>
  );
}

/* ---------------- shell ---------------- */

export default function Portal() {
  const [me, setMe] = useState(undefined);   // undefined = checking
  const [summary, setSummary] = useState(null);
  const [openLead, setOpenLead] = useState(null);
  const [refreshKey, setRefresh] = useState(0);

  const loadMe = useCallback(() => {
    api("/api/auth/me")
      .then(r => setMe(r))
      .catch(() => setMe(null));
  }, []);

  const loadSummary = useCallback(() => {
    api("/api/portal/summary").then(setSummary).catch(() => setSummary(null));
  }, []);

  useEffect(() => { loadMe(); }, [loadMe]);
  useEffect(() => { if (me?.user) loadSummary(); }, [me, refreshKey, loadSummary]);

  const signOut = async () => {
    await api("/api/auth/logout", { method: "POST" }).catch(() => {});
    setMe(null); setOpenLead(null);
  };

  if (me === undefined) return <><style>{CSS}</style><div className="pf"><div className="center"><Loader2 size={18} className="spin" /></div></div></>;
  if (!me?.user) return <><style>{CSS}</style><Login onIn={loadMe} /></>;

  return (
    <>
      <style>{CSS}</style>
      <div className="pf">
        <header className="top">
          <b>Tint Intelligence</b>
          <span style={{ fontSize: 12.5, color: "rgba(255,255,255,.6)" }}>
            {me.customer?.company_name}
          </span>
          <div className="who">
            <span>{me.user.username}</span>
            <button className="ghost" onClick={signOut}><LogOut size={14} /> Sign out</button>
          </div>
        </header>

        {/* Always visible. The whole point: no surprise at invoice time. */}
        {summary && (
          <div className="qtd">
            <span>
              This quarter so far: <b>{summary.quarterToDate.billableLeads}</b> billable
              lead{summary.quarterToDate.billableLeads === 1 ? "" : "s"} ·
              {" "}<b>{money(summary.quarterToDate.amount)}</b>
            </span>
            <span style={{ color: "var(--slate)", fontSize: 12 }}>
              Invoiced at the end of the quarter.
            </span>
          </div>
        )}

        {openLead
          ? <LeadDetail leadRowId={openLead} onBack={() => setOpenLead(null)}
              onChanged={() => setRefresh(k => k + 1)} />
          : <Board onOpen={setOpenLead} refreshKey={refreshKey} />}
      </div>
    </>
  );
}

import { createRoot } from "react-dom/client";
const rootEl = document.getElementById("root");
if (rootEl) createRoot(rootEl).render(<Portal />);
