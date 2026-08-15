import { useState, useEffect, useRef, useMemo } from "react";
import {
  LayoutDashboard, Radar, FileSearch, Building2, Plus, X, Sparkles,
  Upload, Send, Calculator, FileText, Copy, Download, ChevronRight,
  Clock, MapPin, Phone, Mail, Globe, Trash2, RefreshCw, CheckCircle2, Rss,
  AlertTriangle, Loader2, ArrowLeft, Pencil, Save, Link2
} from "lucide-react";

/* ============ DESIGN TOKENS (Tint Tech KC brand) ============ */
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Archivo:wght@500;600;700;800&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;600&display=swap');
:root{
  --navy:#0C2340; --ink:#071A30; --azure:#1E82E6; --azure2:#4BA3F5;
  --paper:#F5F8FC; --card:#FFFFFF; --line:#DBE4F0; --slate:#5B6B80;
  --dark-line:rgba(255,255,255,.09); --good:#1B9E6B; --warn:#D97E00; --bad:#C43D3D;
}
*{box-sizing:border-box}
body{margin:0}
.tti{font-family:'Inter',sans-serif;color:var(--navy);background:var(--paper);min-height:100vh;display:flex}
.tti h1,.tti h2,.tti h3,.tti .disp{font-family:'Archivo',sans-serif;letter-spacing:-.01em}
.mono{font-family:'JetBrains Mono',monospace}
.side{width:250px;flex-shrink:0;background:linear-gradient(180deg,var(--navy),var(--ink));color:#fff;display:flex;flex-direction:column;position:sticky;top:0;height:100vh}
.side::after{content:'';position:absolute;right:0;top:0;bottom:0;width:3px;background:linear-gradient(180deg,var(--azure),transparent 60%)}
.brand{padding:22px 20px 18px;border-bottom:1px solid var(--dark-line);display:flex;align-items:center;gap:11px}
.brand .mark{width:34px;height:34px;border-radius:9px;background:linear-gradient(135deg,var(--azure2),var(--azure) 55%,var(--navy));flex-shrink:0;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 8px rgba(30,130,230,.35)}
.brand b{font-family:'Archivo';font-weight:800;font-size:16px;display:block;line-height:1.2}
.brand span{font-size:10.5px;color:var(--azure2);letter-spacing:.14em;text-transform:uppercase;font-weight:600}
.nav{padding:14px 10px;overflow-y:auto;flex:1}
.navgroup{margin-bottom:16px}
.navgroup:last-child{margin-bottom:0}
.navgroup .lbl2{padding:0 12px 6px;font-size:10px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:rgba(255,255,255,.38)}
.nav button{position:relative;display:flex;align-items:center;gap:11px;width:100%;padding:10px 12px;border:0;background:transparent;color:rgba(255,255,255,.72);font:600 13.5px 'Inter';border-radius:9px;cursor:pointer;text-align:left;transition:background .15s,color .15s;margin-bottom:2px}
.nav button:hover{background:rgba(255,255,255,.07);color:#fff}
.nav button.on{background:rgba(30,130,230,.2);color:#fff;box-shadow:inset 3px 0 0 var(--azure)}
.nav button .navbadge{margin-left:auto;flex-shrink:0;min-width:19px;height:19px;padding:0 5px;border-radius:999px;background:var(--azure);color:#fff;font:700 10.5px 'Inter';display:flex;align-items:center;justify-content:center}
.nav button.on .navbadge{background:#fff;color:var(--azure)}
.nav button:focus-visible,.tti button:focus-visible,.tti input:focus-visible,.tti select:focus-visible,.tti textarea:focus-visible{outline:2px solid var(--azure);outline-offset:2px}
.side .foot{margin-top:auto;padding:16px 20px;font-size:11px;color:rgba(255,255,255,.45);border-top:1px solid var(--dark-line)}
.main{flex:1;min-width:0;padding:26px 30px 60px}
.pagehead{display:flex;align-items:flex-end;justify-content:space-between;gap:14px;margin-bottom:20px;flex-wrap:wrap}
.pagehead h1{margin:0;font-size:24px;font-weight:800}
.pagehead p{margin:4px 0 0;color:var(--slate);font-size:13.5px}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;box-shadow:0 1px 2px rgba(12,35,64,.04)}
.card.hoverable{cursor:pointer;transition:box-shadow .15s,border-color .15s,transform .15s}
.card.hoverable:hover{box-shadow:0 6px 20px rgba(12,35,64,.09);border-color:#c8d7ea;transform:translateY(-1px)}
.btn{display:inline-flex;align-items:center;gap:8px;border:0;border-radius:9px;padding:10px 15px;font:600 13.5px 'Inter';cursor:pointer;transition:filter .15s,box-shadow .15s;text-decoration:none}
.btn:hover{filter:brightness(1.06)}
.btn.pri{background:var(--azure);color:#fff;box-shadow:0 2px 8px rgba(30,130,230,.3)}
.btn.dark{background:var(--navy);color:#fff}
.btn.ghost{background:#EDF2F9;color:var(--navy)}
.btn.danger{background:#FBEAEA;color:var(--bad)}
.btn.lg{padding:13px 20px;font-size:14.5px;border-radius:11px}
.btn:disabled{opacity:.5;cursor:not-allowed}
.tti input,.tti select,.tti textarea{font:500 13.5px 'Inter';color:var(--navy);background:#fff;border:1px solid var(--line);border-radius:9px;padding:9px 11px;width:100%}
.tti textarea{resize:vertical}
.lbl{font-size:11px;font-weight:700;letter-spacing:.09em;text-transform:uppercase;color:var(--slate);margin-bottom:5px;display:block}
.tag{display:inline-flex;align-items:center;font:600 11px 'Inter';padding:3px 9px;border-radius:999px}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.statgrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;margin-bottom:20px}
.stat{padding:16px 18px}
.stat .v{font-family:'Archivo';font-weight:800;font-size:26px;line-height:1.1}
.stat .k{font-size:11.5px;color:var(--slate);font-weight:600;letter-spacing:.06em;text-transform:uppercase;margin-top:4px}
/* Signature: tint-gauge — a pane of "glass" whose film tint depth = AI score */
.pane{position:relative;width:52px;height:64px;border-radius:6px;border:1.5px solid var(--navy);background:linear-gradient(135deg,#EAF3FE,#fff);overflow:hidden;flex-shrink:0}
.pane .film{position:absolute;left:0;right:0;bottom:0;background:linear-gradient(180deg,var(--azure2),var(--navy));opacity:.92;transition:height .5s}
.pane .glare{position:absolute;top:-30%;left:-60%;width:70%;height:180%;background:rgba(255,255,255,.5);transform:rotate(22deg)}
.pane .num{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font:700 15px 'JetBrains Mono';color:#fff;mix-blend-mode:difference}
.row{display:flex;align-items:center;gap:14px}
.opp{padding:16px 18px;display:flex;gap:16px;align-items:center;cursor:pointer;transition:background .12s;border-bottom:1px solid var(--line)}
.opp:hover{background:#F2F7FD}
.opp:last-child{border-bottom:0}
.msg{max-width:78%;padding:12px 15px;border-radius:13px;font-size:14px;line-height:1.55;white-space:pre-wrap;overflow-wrap:anywhere}
.msg.user{background:var(--azure);color:#fff;margin-left:auto;border-bottom-right-radius:4px}
.msg.ai{background:#fff;border:1px solid var(--line);border-bottom-left-radius:4px}
.chip{border:1px solid var(--line);background:#fff;border-radius:999px;padding:7px 13px;font:600 12px 'Inter';color:var(--navy);cursor:pointer;transition:border-color .15s}
.chip:hover{border-color:var(--azure)}
.drawer{position:fixed;inset:0;background:rgba(7,26,48,.45);z-index:50;display:flex;justify-content:flex-end}
.drawer .panel{width:min(680px,100%);background:var(--paper);height:100%;overflow-y:auto;padding:24px 26px}
.tabs{display:flex;flex-wrap:wrap;align-items:center;gap:3px 2px;border-bottom:2px solid var(--line);margin:18px 0 18px;padding-bottom:2px}
.tabs button{border:0;background:none;font:700 12.5px 'Inter';color:var(--slate);padding:8px 11px;cursor:pointer;border-bottom:2.5px solid transparent;margin-bottom:-2px;border-radius:6px 6px 0 0;white-space:nowrap}
.tabs button:hover{color:var(--navy);background:#F2F7FD}
.tabs button.on{color:var(--azure);border-color:var(--azure);background:#EAF3FE}
.tabs .div{width:1px;align-self:stretch;background:var(--line);margin:4px 3px}
.kv{display:grid;grid-template-columns:150px 1fr;gap:6px 12px;font-size:13.5px}
.kv b{color:var(--slate);font-weight:600}
.bar{height:7px;border-radius:999px;background:#E7EDF6;overflow:hidden}
.bar i{display:block;height:100%;border-radius:999px;background:linear-gradient(90deg,var(--azure),var(--azure2))}
.prose{font-size:14px;line-height:1.62}
.prose h3{font-size:15px;margin:16px 0 6px}
.disclose{margin-top:20px}
.disclose>summary{cursor:pointer;font:700 12.5px 'Inter';color:var(--slate);list-style:none;display:flex;align-items:center;gap:6px;padding:8px 2px;user-select:none}
.disclose>summary::-webkit-details-marker{display:none}
.disclose>summary::before{content:'▸';font-size:10px;transition:transform .15s}
.disclose[open]>summary::before{transform:rotate(90deg)}
.disclose>summary:hover{color:var(--navy)}
@media(max-width:860px){
  .tti{flex-direction:column}
  .side{width:100%;height:auto;position:static;flex-direction:row;align-items:center}
  .side::after{display:none}
  .brand{border:0;padding:14px 16px}
  .nav{display:flex;flex-direction:row;padding:8px;overflow-x:auto}
  .navgroup{display:flex;margin-bottom:0}
  .navgroup .lbl2{display:none}
  .nav button{margin-bottom:0}
  .nav button .navbadge{position:absolute;top:4px;right:4px;min-width:15px;height:15px;font-size:9px}
  .nav button span:not(.navbadge){display:none}
  .side .foot{display:none}
  .main{padding:18px 14px 60px}
  .kv{grid-template-columns:1fr}
  .drawer .panel{width:100%}
}
@media(prefers-reduced-motion:reduce){.pane .film{transition:none}}
`;

/* ============ CONSTANTS & SEED DATA ============ */
const FILM_TYPES = ["Solar Control","Safety","Security","Decorative","Privacy","Frosted","Bird Strike","Blast Mitigation","Anti-Graffiti","Exterior","Energy Retrofit"];
const STATUSES = ["New","Qualified","Contacted","Estimating","Proposal Sent","Negotiating","Awarded","Lost","Completed","Archived"];
const STATUS_COLORS = {New:"#5B6B80",Qualified:"#1E82E6",Contacted:"#4BA3F5",Estimating:"#7A5FD0",["Proposal Sent"]:"#D97E00",Negotiating:"#B8860B",Awarded:"#1B9E6B",Lost:"#C43D3D",Completed:"#0C2340",Archived:"#9AA7B8"};

const uid = () => Math.random().toString(36).slice(2, 10);

/* ============ BROWSER-SIDE PDF EXTRACTION ============ */
// Text extraction runs here, not on the server: Cloudflare Workers cap CPU per
// request, so parsing a plan set server-side would force a paid plan. Your
// device does the parsing; only the text goes over the wire.
const PDFJS_URL = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
const PDFJS_WORKER = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
let pdfjsPromise = null;
function loadPdfJs(){
  if(window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
  if(pdfjsPromise) return pdfjsPromise;
  pdfjsPromise = new Promise((res,rej)=>{
    const s = document.createElement("script");
    s.src = PDFJS_URL;
    s.onload = ()=>{ window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER; res(window.pdfjsLib); };
    s.onerror = ()=>rej(new Error("Could not load the PDF reader. Check your connection."));
    document.head.appendChild(s);
  });
  return pdfjsPromise;
}

// Render specific pages to PNG for vision OCR. Only used for pages that had no
// text layer — rasterising everything would be slow and expensive.
async function renderPdfPages(file, pageNumbers, onProgress){
  const pdfjsLib = await loadPdfJs();
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  const out = [];
  for(let i=0;i<pageNumbers.length;i++){
    const n = pageNumbers[i];
    const page = await pdf.getPage(n);
    // 1600px wide is enough to read a title block without huge payloads
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(2.5, 1600 / base.width);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
    const dataUrl = canvas.toDataURL("image/png");
    out.push({ page: n, mediaType: "image/png", base64: dataUrl.split(",")[1] });
    if(onProgress) onProgress(i+1, pageNumbers.length);
  }
  return out;
}

async function extractPdfPages(file, onProgress){
  const pdfjsLib = await loadPdfJs();
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  const pages = [];
  for(let i=1;i<=pdf.numPages;i++){
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const text = content.items.map(it=>it.str).join(" ").replace(/\s+/g," ").trim();
    pages.push({ page: i, text });
    if(onProgress) onProgress(i, pdf.numPages);
  }
  return pages;
}

/* ============ BACKEND API ============ */
async function api(path, opts = {}){
  const res = await fetch("/api" + path, {
    headers: {"Content-Type":"application/json"},
    method: opts.method || "GET",
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  const data = await res.json().catch(()=>({}));
  if(!res.ok) throw new Error(data.error || ("HTTP " + res.status));
  return data;
}

// V2 endpoints wrap payloads as {ok, data}
async function api2(path, opts = {}){
  const r = await api("/v2" + path, opts);
  if(r && r.ok === false) throw new Error(r.error || "Request failed");
  return r && "data" in r ? r.data : r;
}

const fmt$ = n => isNaN(n)||n===""?"—":"$"+Number(n).toLocaleString(undefined,{maximumFractionDigits:0});
const daysTo = d => { if(!d) return null; const t=(new Date(d+"T23:59")-new Date())/86400000; return Math.ceil(t); };

/* ============ SHARED PIECES ============ */
function TintPane({score}){
  const s = score==null ? 0 : score;
  return (
    <div className="pane" title={score==null?"Not scored yet":`AI score ${s}/100`} aria-label={score==null?"Not scored":`Score ${s} of 100`}>
      <div className="glare"/>
      <div className="film" style={{height:`${s}%`}}/>
      <div className="num">{score==null?"—":s}</div>
    </div>
  );
}

function StatusTag({s}){
  const c = STATUS_COLORS[s]||"#5B6B80";
  return <span className="tag" style={{background:c+"1A",color:c}}>{s}</span>;
}

function Field({label,children}){
  return <div><span className="lbl">{label}</span>{children}</div>;
}

function Empty({icon:Icon,title,body,children}){
  return (
    <div className="card" style={{padding:"44px 24px",textAlign:"center"}}>
      <Icon size={30} style={{color:"var(--azure)",margin:"0 auto 10px"}}/>
      <h3 style={{margin:"0 0 6px",fontSize:16}}>{title}</h3>
      <p style={{margin:"0 auto 16px",color:"var(--slate)",fontSize:13.5,maxWidth:420}}>{body}</p>
      {children}
    </div>
  );
}


function ConfirmBtn({label,onConfirm,style}){
  const [arm,setArm] = useState(false);
  useEffect(()=>{ if(arm){ const t=setTimeout(()=>setArm(false),2500); return ()=>clearTimeout(t);} },[arm]);
  return (
    <button className="btn danger" style={style} onClick={()=>{ if(arm){onConfirm();setArm(false);} else setArm(true); }}>
      <Trash2 size={14}/>{arm?"Click again to confirm":label}
    </button>
  );
}

/* ============ COMMAND CENTER (V2 Phase 5) ============ */
function greeting(){
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

function Dashboard({opps, setView, openOpp, goDiscovery, pendingLeads}){
  const [d,setD] = useState(null);
  const [err,setErr] = useState("");

  useEffect(()=>{ api2("/dashboard").then(setD).catch(e=>setErr(e.message)); },[]);

  if(err) return (
    <div>
      <div className="pagehead"><div><h1>Command Center</h1><p>Tint Tech KC</p></div></div>
      <div className="card" style={{padding:20}}>
        <p style={{fontSize:13.5,color:"var(--bad)"}}><AlertTriangle size={14} style={{verticalAlign:-2}}/> {err}</p>
        <p style={{fontSize:13,color:"var(--slate)"}}>If this is a fresh upgrade, run the V2 migration once (see DEPLOY.md step I).</p>
      </div>
    </div>
  );
  if(!d) return (
    <div style={{padding:40,textAlign:"center"}}>
      <Loader2 size={22} style={{color:"var(--azure)",animation:"spin 1s linear infinite"}}/>
    </div>
  );

  const wl = d.winLoss;
  return (
    <div>
      <div className="pagehead">
        <div>
          <h1>{greeting()}</h1>
          <p>Bid Hunter — {new Date().toLocaleDateString(undefined,{weekday:"long",month:"long",day:"numeric"})}</p>
        </div>
        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          <Notifications openOpp={openOpp}/>
          <button className="btn ghost" onClick={setView}><Plus size={16}/>Add opportunity</button>
          <button className="btn pri" onClick={goDiscovery}><Rss size={16}/>Find leads</button>
        </div>
      </div>

      <div className={"card"+(goDiscovery?" hoverable":"")} style={{padding:"16px 20px",marginBottom:18,display:"flex",alignItems:"center",gap:16,flexWrap:"wrap",background:pendingLeads>0?"linear-gradient(90deg,#EAF3FE,#fff)":undefined,borderColor:pendingLeads>0?"var(--azure2)":undefined}} onClick={goDiscovery}>
        <div style={{width:44,height:44,borderRadius:11,background:pendingLeads>0?"var(--azure)":"#EDF2F9",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
          <Rss size={20} color={pendingLeads>0?"#fff":"var(--slate)"}/>
        </div>
        <div style={{flex:1,minWidth:200}}>
          <div style={{fontWeight:800,fontSize:15}}>
            {pendingLeads>0 ? `${pendingLeads} new film & tinting lead${pendingLeads>1?"s":""} waiting` : "Discovery scans overnight for new tinting work"}
          </div>
          <div style={{fontSize:12.5,color:"var(--slate)",marginTop:2}}>
            {pendingLeads>0 ? "Review and import them into your pipeline." : "21 public bid boards and SAM.gov, filtered to real film & tinting scope."}
          </div>
        </div>
        <ChevronRight size={18} style={{color:"var(--slate)",flexShrink:0}}/>
      </div>

      <div className="statgrid">
        <div className="card stat"><div className="v">{d.activeProjects}</div><div className="k">Active opportunities</div></div>
        <div className="card stat"><div className="v" style={{color:d.hotOpportunities?"var(--good)":undefined}}>{d.hotOpportunities}</div><div className="k">Hot (score 70+)</div></div>
        <div className="card stat"><div className="v">{fmt$(d.pipelineValue)}</div><div className="k">Pipeline value</div></div>
        <div className="card stat">
          <div className="v" style={{color:d.bidsDueThisWeek?"var(--warn)":undefined}}>{d.bidsDueThisWeek}</div>
          <div className="k">Bids due this week</div>
        </div>
      </div>

      {d.pastDue>0 && (
        <p style={{fontSize:13,color:"var(--bad)",background:"#FBEAEA",padding:"10px 13px",borderRadius:10,marginBottom:16}}>
          <AlertTriangle size={14} style={{verticalAlign:-2}}/> {d.pastDue} bid{d.pastDue>1?"s are":" is"} past due — archive or record the result to clear the board.
        </p>
      )}

      <h2 style={{fontSize:17,margin:"4px 0 12px"}}>What should I bid today?</h2>
      {d.todaysBids.length===0 && (
        <div className="card" style={{padding:22,textAlign:"center",color:"var(--slate)",fontSize:13.5}}>
          No open bids on the board. Run a Discovery scan to find work.
        </div>
      )}
      {d.todaysBids.map(p=>(
        <div key={p.id} className="card" style={{padding:14,marginBottom:10,cursor:"pointer"}} onClick={()=>openOpp(p.id)}>
          <div style={{display:"flex",gap:14,alignItems:"center"}}>
            <TintPane score={p.bidScore}/>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontWeight:700,fontSize:14.5,marginBottom:3}}>{p.name}</div>
              <div style={{fontSize:12.5,color:"var(--slate)",display:"flex",gap:12,flexWrap:"wrap"}}>
                {(p.city||p.state) && <span><MapPin size={12} style={{verticalAlign:-1.5}}/> {[p.city,p.state].filter(Boolean).join(", ")}</span>}
                {p.general_contractor && <span>GC: {p.general_contractor}</span>}
                {p.estimated_project_value>0 && <span>{fmt$(p.estimated_project_value)}</span>}
              </div>
              <div style={{marginTop:6,display:"flex",gap:6,flexWrap:"wrap",alignItems:"center"}}>
                <StatusTag s={p.status}/>
                {p.daysUntilBid!=null && (
                  <span className="tag mono" style={{background:p.urgent?"#FBEAEA":"#EAF3FE",color:p.urgent?"var(--bad)":"var(--azure)"}}>
                    {p.daysUntilBid===0?"due today":p.daysUntilBid+" days left"}
                  </span>
                )}
                {p.bidScore==null && <span className="tag" style={{background:"#EDF2F9",color:"var(--slate)"}}>not scored</span>}
              </div>
            </div>
            <ChevronRight size={16} style={{color:"var(--slate)",flexShrink:0}}/>
          </div>
        </div>
      ))}

      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(300px,1fr))",gap:14,marginTop:20}}>
        <div className="card" style={{padding:18}}>
          <h3 style={{margin:"0 0 12px",fontSize:15,display:"flex",alignItems:"center",gap:8}}>
            <Clock size={16} style={{color:"var(--azure)"}}/>Bid calendar
          </h3>
          {[["pastDue","Past due","var(--bad)"],["today","Today","var(--bad)"],
            ["thisWeek","This week","var(--warn)"],["next30","Next 30 days","var(--navy)"],
            ["later","Later","var(--slate)"],["noDate","No date set","var(--slate)"]].map(([k,label,color])=>{
            const items = d.calendar[k] || [];
            if(!items.length) return null;
            return (
              <div key={k} style={{marginBottom:10}}>
                <div style={{fontSize:11,fontWeight:700,letterSpacing:".06em",textTransform:"uppercase",color,marginBottom:4}}>
                  {label} ({items.length})
                </div>
                {items.slice(0,4).map(p=>(
                  <div key={p.id} onClick={()=>openOpp(p.id)} style={{display:"flex",justifyContent:"space-between",gap:8,fontSize:12.5,padding:"5px 0",cursor:"pointer",borderBottom:"1px solid var(--line)"}}>
                    <span style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{p.name}</span>
                    <span className="mono" style={{flexShrink:0,color:"var(--slate)"}}>{p.bid_due||"—"}</span>
                  </div>
                ))}
              </div>
            );
          })}
          {Object.values(d.calendar).every(a=>!a.length) && <p style={{fontSize:13,color:"var(--slate)"}}>Nothing scheduled.</p>}
        </div>

        <div className="card" style={{padding:18}}>
          <h3 style={{margin:"0 0 12px",fontSize:15}}>Bid results</h3>
          {wl.decided===0 ? (
            <p style={{fontSize:13.5,color:"var(--slate)"}}>
              No results recorded yet. When a bid is decided, open the project and tap <b>Record bid result</b> — that's what builds your win rate and real production rates.
            </p>
          ) : (
            <>
              <div style={{display:"flex",gap:20,marginBottom:12,flexWrap:"wrap"}}>
                <div><div className="mono" style={{fontSize:24,fontWeight:800,color:"var(--good)"}}>{wl.won}</div>
                  <div style={{fontSize:11,color:"var(--slate)",fontWeight:600}}>WON</div></div>
                <div><div className="mono" style={{fontSize:24,fontWeight:800,color:"var(--bad)"}}>{wl.lost}</div>
                  <div style={{fontSize:11,color:"var(--slate)",fontWeight:600}}>LOST</div></div>
                <div><div className="mono" style={{fontSize:24,fontWeight:800}}>{wl.winRate}%</div>
                  <div style={{fontSize:11,color:"var(--slate)",fontWeight:600}}>WIN RATE</div></div>
              </div>
              {wl.revenueWon>0 && (
                <div style={{fontSize:13,marginBottom:8}}>
                  Revenue won <b className="mono">{fmt$(wl.revenueWon)}</b>
                  {wl.profitWon>0 && <> · profit <b className="mono">{fmt$(wl.profitWon)}</b></>}
                </div>
              )}
              {wl.topLossReason && <div style={{fontSize:13}}>Most common loss reason: <b>{wl.topLossReason}</b></div>}
              {wl.note && <p style={{fontSize:12,color:"var(--warn)",marginTop:8}}>{wl.note}</p>}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ============ OPPORTUNITY FORM ============ */
function OppForm({initial,onSave,onCancel}){
  const [f,setF] = useState(initial || {id:uid(),name:"",owner:"",architect:"",gc:"",bidNumber:"",bidDue:"",preBid:"",city:"",county:"",state:"MO",value:"",type:"",source:"",discovered:new Date().toISOString().slice(0,10),status:"New",filmTypes:[],notes:"",score:null});
  const set = (k,v)=>setF(p=>({...p,[k]:v}));
  const toggleFilm = t => set("filmTypes", f.filmTypes.includes(t)? f.filmTypes.filter(x=>x!==t) : [...f.filmTypes,t]);
  return (
    <div className="card" style={{padding:20,marginBottom:16}}>
      <h3 style={{margin:"0 0 14px",fontSize:16}}>{initial?"Edit opportunity":"New opportunity"}</h3>
      <div style={{display:"grid",gap:12}}>
        <Field label="Project name"><input value={f.name} onChange={e=>set("name",e.target.value)} placeholder="e.g. City Hall Annex — Curtain Wall Package"/></Field>
        <div className="grid2">
          <Field label="Owner"><input value={f.owner} onChange={e=>set("owner",e.target.value)}/></Field>
          <Field label="General contractor"><input value={f.gc} onChange={e=>set("gc",e.target.value)}/></Field>
          <Field label="Architect"><input value={f.architect} onChange={e=>set("architect",e.target.value)}/></Field>
          <Field label="Bid number"><input value={f.bidNumber} onChange={e=>set("bidNumber",e.target.value)}/></Field>
          <Field label="Bid due date"><input type="date" value={f.bidDue} onChange={e=>set("bidDue",e.target.value)}/></Field>
          <Field label="Pre-bid meeting"><input type="date" value={f.preBid} onChange={e=>set("preBid",e.target.value)}/></Field>
          <Field label="City"><input value={f.city} onChange={e=>set("city",e.target.value)}/></Field>
          <Field label="County"><input value={f.county} onChange={e=>set("county",e.target.value)}/></Field>
          <Field label="State"><input value={f.state} onChange={e=>set("state",e.target.value)}/></Field>
          <Field label="Est. value ($)"><input type="number" value={f.value} onChange={e=>set("value",e.target.value)}/></Field>
          <Field label="Construction type"><input value={f.type} onChange={e=>set("type",e.target.value)} placeholder="Public / K-12 — New build"/></Field>
          <Field label="Status"><select value={f.status} onChange={e=>set("status",e.target.value)}>{STATUSES.map(s=><option key={s}>{s}</option>)}</select></Field>
        </div>
        <Field label="Source (portal / URL)"><input value={f.source} onChange={e=>set("source",e.target.value)}/></Field>
        <Field label="Likely film types">
          <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
            {FILM_TYPES.map(t=>(
              <button key={t} type="button" className="chip" onClick={()=>toggleFilm(t)}
                style={f.filmTypes.includes(t)?{background:"var(--azure)",color:"#fff",borderColor:"var(--azure)"}:{}}>{t}</button>
            ))}
          </div>
        </Field>
        <Field label="Notes"><textarea rows={3} value={f.notes} onChange={e=>set("notes",e.target.value)}/></Field>
        <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
          <button className="btn ghost" onClick={onCancel}>Cancel</button>
          <button className="btn pri" disabled={!f.name.trim()} onClick={()=>onSave(f)}><Save size={15}/>Save opportunity</button>
        </div>
      </div>
    </div>
  );
}

/* ============ AI SCORING ============ */
const SCORE_KEYS = [["filmLikelihood","Film likelihood"],["size","Project size"],["profitability","Profitability"],["distance","Distance / logistics"],["competition","Competition"],["relationship","Relationship strength"],["timeline","Bid timeline"],["strategic","Strategic value"]];

const scoreOpportunity = opp => api("/ai/score/" + opp.id, {method:"POST"});

/* ============ TAKEOFF MATH ============ */
function computeTakeoff(t){
  const g = Number(t.glazingSqft)||0;
  const film = g * (Number(t.coverage)||0)/100;
  const withWaste = film * (1 + (Number(t.waste)||0)/100);
  const rollSqft = (Number(t.rollWidth)||60)/12 * 100; // 100 ft rolls
  const rolls = withWaste>0 ? Math.ceil(withWaste/rollSqft) : 0;
  const material = withWaste * (Number(t.costPerSqft)||0);
  const laborHours = film>0 ? film/(Number(t.prodRate)||18) : 0;
  const laborCost = laborHours * (Number(t.laborRate)||0);
  const crewDays = laborHours>0 ? laborHours/((Number(t.crew)||1)*8) : 0;
  const cost = material + laborCost;
  const price = cost * (1 + (Number(t.margin)||0)/100);
  return {film, withWaste, rollSqft, rolls, material, laborHours, laborCost, crewDays, cost, price};
}


/* ============ PROJECT ANALYSIS (V2) ============ */
function ConfBadge({v}){
  if(v==null) return <span className="tag" style={{background:"#EDF2F9",color:"var(--slate)"}}>Unknown</span>;
  const label = v>=90?"HIGH":v>=70?"MEDIUM":"LOW";
  const c = v>=90?"var(--good)":v>=70?"var(--warn)":"var(--bad)";
  return <span className="tag" style={{background:c+"1A",color:c}}>{label} {v}%</span>;
}

function Citation({sheet,page,spec}){
  const bits = [sheet && `Sheet ${sheet}`, spec && `Spec ${spec}`, page!=null && `p.${page}`].filter(Boolean);
  if(!bits.length) return <span style={{fontSize:11.5,color:"var(--slate)"}}>No citation</span>;
  return <span className="mono" style={{fontSize:11.5,color:"var(--azure)"}}>{bits.join(" · ")}</span>;
}

function AnalyzeTab({opp}){
  const [phase,setPhase] = useState("idle");   // idle|finding|extracting|indexing|analyzing|done
  const [progress,setProgress] = useState("");
  const [result,setResult] = useState(null);
  const [err,setErr] = useState("");
  const [docName,setDocName] = useState("");
  const [found,setFound] = useState(null);     // documents discovered on the source page
  const [ocrInfo,setOcrInfo] = useState(null);
  const fileRef = useRef();

  // Pull the pages of an already-stored document out of R2 and index them.
  const processStoredDoc = async (docId, name)=>{
    setDocName(name);
    setPhase("extracting"); setProgress("Downloading " + name + "…");
    const res = await fetch("/api/v2/documents/" + docId + "/download");
    if(!res.ok) throw new Error("Could not read the stored document.");
    const blob = await res.blob();
    const file = new File([blob], name, {type:"application/pdf"});
    const pages = await extractPdfPages(file, (i,n)=>setProgress(`Reading page ${i} of ${n}…`));
    setPhase("indexing"); setProgress(`Indexing ${pages.length} pages…`);
    const idx = await api2("/documents/" + docId + "/pages", {method:"POST", body:{projectId:opp.id, pages}});
    const blank = pages.filter(p => (p.text||"").trim().length < 30).map(p => p.page);
    if(blank.length){
      const batch = blank.slice(0, 8);
      setPhase("ocr");
      setProgress(`${blank.length} page(s) are scanned images — reading ${batch.length} with AI vision…`);
      try{
        const imgs = await renderPdfPages(file, batch, (i,n)=>setProgress(`Rendering scanned page ${i} of ${n}…`));
        const ocr = await api2("/documents/" + docId + "/ocr", {method:"POST", body:{projectId:opp.id, images:imgs}});
        setOcrInfo({...ocr, totalScanned: blank.length, attempted: batch.length});
      }catch(ocrErr){ setOcrInfo({error: ocrErr.message, totalScanned: blank.length}); }
    }
    setPhase("analyzing");
    setProgress(`${idx.summary.pagesSentToAI} of ${idx.summary.pagesAnalyzed} pages are film/glazing relevant — analyzing those…`);
    const res2 = await api2("/projects/" + opp.id + "/analyze", {method:"POST"});
    setResult(res2); setPhase("done");
  };

  const findDocs = async ()=>{
    setErr(""); setResult(null); setFound(null);
    setPhase("finding"); setProgress("Looking for plans and specs on the bid posting…");
    try{
      const r = await api2("/projects/" + opp.id + "/documents/discover", {method:"POST"});
      setFound(r); setPhase("idle");
      if(!r.documents.length) setErr(r.note || "No documents found on the source page.");
    }catch(e){ setErr(e.message); setPhase("idle"); }
  };

  const fetchAndAnalyze = async (doc)=>{
    setErr(""); setFound(null);
    try{
      setPhase("extracting"); setProgress("Downloading " + doc.filename + " from the bid site…");
      const stored = await api2("/projects/" + opp.id + "/documents/fetch", {method:"POST", body:{
        url:doc.url, documentType:doc.type, filename:doc.filename
      }});
      await processStoredDoc(stored.id, stored.filename);
    }catch(e){ setErr(e.message); setPhase("idle"); }
  };

  const run = async e => {
    const file = e.target.files?.[0]; if(!file) return;
    e.target.value = "";
    setErr(""); setResult(null); setDocName(file.name);
    try{
      // 1. register the document
      setPhase("extracting"); setProgress("Opening file…");
      const doc = await api2("/projects/" + opp.id + "/documents", {method:"POST", body:{
        filename:file.name, document_type:"plans", mime_type:file.type,
        file_size:file.size, status:"local", processing_status:"extracting",
        uploaded_at:new Date().toISOString()
      }});
      // 2. extract text in the browser
      const pages = await extractPdfPages(file, (i,n)=>setProgress(`Reading page ${i} of ${n}…`));
      // 3. index server-side (cheap keyword pass, no AI)
      setPhase("indexing"); setProgress(`Indexing ${pages.length} pages…`);
      const idx = await api2("/documents/" + doc.id + "/pages", {method:"POST", body:{projectId:opp.id, pages}});
      // 3b. scanned pages have no text layer — read those with vision
      const blank = pages.filter(p => (p.text||"").trim().length < 30).map(p => p.page);
      if(blank.length){
        const batch = blank.slice(0, 8);
        setPhase("ocr");
        setProgress(`${blank.length} page(s) are scanned images — reading ${batch.length} with AI vision…`);
        try{
          const imgs = await renderPdfPages(file, batch, (i,n)=>setProgress(`Rendering scanned page ${i} of ${n}…`));
          const ocr = await api2("/documents/" + doc.id + "/ocr", {method:"POST", body:{projectId:opp.id, images:imgs}});
          setOcrInfo({...ocr, totalScanned: blank.length, attempted: batch.length});
        }catch(ocrErr){ setOcrInfo({error: ocrErr.message, totalScanned: blank.length}); }
      }
      // 4. AI analysis on relevant pages only
      setPhase("analyzing");
      setProgress(`${idx.summary.pagesSentToAI} of ${idx.summary.pagesAnalyzed} pages are film/glazing relevant — analyzing those…`);
      const res = await api2("/projects/" + opp.id + "/analyze", {method:"POST"});
      setResult(res); setPhase("done");
    }catch(ex){ setErr(ex.message); setPhase("idle"); }
  };

  const busy = ["finding","extracting","indexing","ocr","analyzing"].includes(phase);

  return (
    <div className="card" style={{padding:18}}>
      {phase==="idle" && !result && !found && (
        <Empty icon={FileSearch} title="Analyze the plan set"
          body="Pull the plans and specs straight from the bid posting — no downloading to your phone. Your device reads the text, then only the film- and glazing-relevant pages go to the AI. Every finding must cite a real sheet or it gets thrown out.">
          <div style={{display:"flex",gap:8,justifyContent:"center",flexWrap:"wrap"}}>
            <button className="btn pri" onClick={findDocs}><Globe size={15}/>Find documents online</button>
            <button className="btn ghost" onClick={()=>fileRef.current.click()}><Upload size={15}/>Upload a file</button>
          </div>
        </Empty>
      )}

      {found && found.documents.length>0 && (
        <div>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:8,flexWrap:"wrap",marginBottom:10}}>
            <div>
              <h3 style={{margin:0,fontSize:15}}>Documents on the bid posting</h3>
              <div style={{fontSize:12.5,color:"var(--slate)"}}>{found.summary}</div>
            </div>
            <button className="btn ghost" onClick={()=>setFound(null)}><X size={14}/>Close</button>
          </div>
          {found.documents.map((d,i)=>{
            const useful = ["specifications","plans","addendum"].includes(d.type);
            return (
              <div key={i} style={{display:"flex",gap:10,alignItems:"center",padding:"10px 0",borderBottom:"1px solid var(--line)"}}>
                <span className="tag" style={{background:useful?"#E7F5EE":"#EDF2F9",color:useful?"var(--good)":"var(--slate)",flexShrink:0}}>{d.label}</span>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:13.5,fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{d.text}</div>
                  <div className="mono" style={{fontSize:11,color:"var(--slate)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{d.filename}</div>
                </div>
                <button className="btn pri" style={{padding:"8px 12px",flexShrink:0}} onClick={()=>fetchAndAnalyze(d)}>
                  <Sparkles size={13}/>Analyze
                </button>
              </div>
            );
          })}
          <p style={{fontSize:12,color:"var(--slate)",marginTop:10}}>
            Start with Specifications — that's where film is named. Plan sets are larger and slower to read.
          </p>
        </div>
      )}
      <input ref={fileRef} type="file" accept="application/pdf" onChange={run} style={{display:"none"}}/>

      {busy && (
        <div style={{padding:"22px 6px",textAlign:"center"}}>
          <Loader2 size={22} style={{color:"var(--azure)",animation:"spin 1s linear infinite"}}/>
          <p style={{fontWeight:600,fontSize:14,margin:"10px 0 4px"}}>
            {phase==="finding"?"Searching the bid posting":phase==="extracting"?"Reading document":phase==="indexing"?"Indexing pages":phase==="ocr"?"Reading scanned sheets":"AI analysis"}
          </p>
          <p style={{fontSize:12.5,color:"var(--slate)",margin:0}}>{progress}</p>
        </div>
      )}
      {err && <p style={{color:"var(--bad)",fontSize:13}}><AlertTriangle size={14} style={{verticalAlign:-2}}/> {err}</p>}

      {result && (
        <div>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:10,marginBottom:14,flexWrap:"wrap"}}>
            <div>
              <h3 style={{margin:0,fontSize:15}}>Analysis complete</h3>
              <div style={{fontSize:12,color:"var(--slate)"}}>{docName}</div>
            </div>
            <div style={{display:"flex",gap:6}}>
              <button className="btn ghost" onClick={findDocs}><Globe size={14}/>Find documents</button>
              <button className="btn ghost" onClick={()=>fileRef.current.click()}><Upload size={14}/>Upload</button>
            </div>
          </div>

          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(105px,1fr))",gap:10,marginBottom:16}}>
            {[["Pages read",result.summary.pagesAnalyzed],
              ["Sent to AI",result.summary.pagesSentToAI],
              ["Film findings",result.summary.filmFindings],
              ["Glazing items",result.summary.glazingFindings],
              ["Risks",result.summary.risks]].map(([k,v])=>(
              <div key={k} style={{background:"#F2F7FD",borderRadius:10,padding:"10px 12px"}}>
                <div className="mono" style={{fontSize:19,fontWeight:700}}>{v}</div>
                <div style={{fontSize:11,color:"var(--slate)",fontWeight:600}}>{k}</div>
              </div>
            ))}
          </div>

          {ocrInfo && (
            <p style={{fontSize:12.5,background:"#F2F7FD",padding:"9px 12px",borderRadius:9,margin:"0 0 10px"}}>
              {ocrInfo.error
                ? <><AlertTriangle size={13} style={{verticalAlign:-2,color:"var(--warn)"}}/> Scanned pages could not be read: {ocrInfo.error}</>
                : <><CheckCircle2 size={13} style={{verticalAlign:-2,color:"var(--good)"}}/> {ocrInfo.pagesRead} of {ocrInfo.attempted} scanned sheet(s) read with AI vision
                    {ocrInfo.totalScanned > ocrInfo.attempted && <> ({ocrInfo.totalScanned - ocrInfo.attempted} more scanned pages not attempted — vision is costly, so it runs 8 at a time)</>}
                    {ocrInfo.note && <> · {ocrInfo.note}</>}</>}
            </p>
          )}
          {result.aiSummary && <p style={{fontSize:13.5,lineHeight:1.6,background:"#F2F7FD",padding:"11px 13px",borderRadius:10}}>{result.aiSummary}</p>}

          {result.discarded?.film + result.discarded?.glazing > 0 && (
            <p style={{fontSize:12.5,color:"var(--warn)",background:"#FDF3E4",padding:"9px 12px",borderRadius:9}}>
              <AlertTriangle size={13} style={{verticalAlign:-2}}/> {result.discarded.film + result.discarded.glazing} AI finding(s) were discarded for lacking a verifiable citation. They are not shown or counted.
            </p>
          )}

          {result.filmScope?.length > 0 && (
            <>
              <h4 style={{fontSize:13,margin:"18px 0 8px",letterSpacing:".05em",textTransform:"uppercase",color:"var(--slate)"}}>Film scope</h4>
              {result.filmScope.map((f,i)=>(
                <div key={i} style={{border:"1px solid var(--line)",borderRadius:10,padding:12,marginBottom:8}}>
                  <div style={{display:"flex",justifyContent:"space-between",gap:8,alignItems:"center",flexWrap:"wrap"}}>
                    <b style={{fontSize:14}}>{f.type}{f.isRecommendation && <span className="tag" style={{background:"#EDF2F9",color:"var(--slate)",marginLeft:6}}>recommendation</span>}
                      {f.isSpecified && <span className="tag" style={{background:"#E7F5EE",color:"var(--good)",marginLeft:6}}>specified</span>}</b>
                    <ConfBadge v={f.confidence}/>
                  </div>
                  <div style={{fontSize:13,marginTop:6,display:"grid",gap:3}}>
                    <span>Quantity: <b className="mono">{f.quantitySF!=null? f.quantitySF.toLocaleString()+" SF" : "Unknown"}</b></span>
                    {f.calculation && <span style={{fontSize:12,color:"var(--slate)"}} className="mono">{f.calculation}</span>}
                    <span style={{fontSize:12.5}}>Manufacturer: {f.manufacturer} · Product: {f.product}</span>
                    {f.location && <span style={{fontSize:12.5}}>Location: {f.location}</span>}
                  </div>
                  <div style={{marginTop:7}}><Citation sheet={f.sheet} page={f.page} spec={f.specSection}/></div>
                  {f.excerpt && <p style={{fontSize:12,color:"var(--slate)",fontStyle:"italic",margin:"7px 0 0",borderLeft:"2px solid var(--azure2)",paddingLeft:9}}>{f.excerpt}</p>}
                </div>
              ))}
            </>
          )}

          {result.glazing?.length > 0 && (
            <>
              <h4 style={{fontSize:13,margin:"18px 0 8px",letterSpacing:".05em",textTransform:"uppercase",color:"var(--slate)"}}>Glazing found</h4>
              <div style={{overflowX:"auto"}}>
                <table style={{width:"100%",borderCollapse:"collapse",fontSize:12.5,minWidth:460}}>
                  <thead><tr style={{textAlign:"left",color:"var(--slate)"}}>
                    {["Mark","Floor","Qty","W","H","SF","Source","Conf"].map(h=><th key={h} style={{padding:"6px 8px",borderBottom:"1px solid var(--line)",fontSize:11}}>{h}</th>)}
                  </tr></thead>
                  <tbody>
                    {result.glazing.map((g,i)=>(
                      <tr key={i} style={{borderBottom:"1px solid var(--line)"}}>
                        <td style={{padding:"6px 8px",fontWeight:600}}>{g.windowMark||"—"}</td>
                        <td style={{padding:"6px 8px"}}>{g.floor||"—"}</td>
                        <td style={{padding:"6px 8px"}} className="mono">{g.quantity??"—"}</td>
                        <td style={{padding:"6px 8px"}} className="mono">{g.widthFt??"—"}</td>
                        <td style={{padding:"6px 8px"}} className="mono">{g.heightFt??"—"}</td>
                        <td style={{padding:"6px 8px",fontWeight:700}} className="mono">
                          {g.quantity!=null&&g.widthFt!=null&&g.heightFt!=null ? Math.round(g.quantity*g.widthFt*g.heightFt).toLocaleString() : "Unknown"}
                        </td>
                        <td style={{padding:"6px 8px"}}><Citation sheet={g.sheet} page={g.page}/></td>
                        <td style={{padding:"6px 8px"}}><ConfBadge v={g.confidence}/></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {result.risks?.length > 0 && (
            <>
              <h4 style={{fontSize:13,margin:"18px 0 8px",letterSpacing:".05em",textTransform:"uppercase",color:"var(--slate)"}}>Bid risks</h4>
              {result.risks.map((r,i)=>{
                const c = r.severity==="HIGH"?"var(--bad)":r.severity==="MEDIUM"?"var(--warn)":"var(--slate)";
                return (
                  <div key={i} style={{display:"flex",gap:10,padding:"9px 0",borderBottom:"1px solid var(--line)"}}>
                    <span className="tag" style={{background:c+"1A",color:c,flexShrink:0,height:"fit-content"}}>{r.severity}</span>
                    <div style={{fontSize:13}}>
                      <b>{r.title}</b>
                      {r.reason && <div style={{color:"var(--slate)",fontSize:12.5,marginTop:2}}>{r.reason}</div>}
                      {r.recommendedAction && <div style={{fontSize:12.5,marginTop:3}}>→ {r.recommendedAction}</div>}
                    </div>
                  </div>
                );
              })}
            </>
          )}

          {result.missingInformation?.length > 0 && (
            <>
              <h4 style={{fontSize:13,margin:"18px 0 8px",letterSpacing:".05em",textTransform:"uppercase",color:"var(--slate)"}}>Still needs confirming</h4>
              <ul style={{fontSize:13,lineHeight:1.6,paddingLeft:18,margin:0,color:"var(--slate)"}}>
                {result.missingInformation.map((m,i)=><li key={i}>{m}</li>)}
              </ul>
            </>
          )}

          {result.filmScope?.length===0 && result.glazing?.length===0 && (
            <p style={{fontSize:13.5,color:"var(--slate)"}}>{result.note || "No film or glazing evidence was found in this document. Try uploading the A-series sheets, window schedules, or Division 08 specifications."}</p>
          )}
        </div>
      )}
    </div>
  );
}








/* ============ MARKET + TERRITORY INTELLIGENCE ============ */
function MarketIntel({openOpp}){
  const [d,setD] = useState(null);
  const [err,setErr] = useState("");
  useEffect(()=>{ api2("/market").then(setD).catch(e=>setErr(e.message)); },[]);

  const Label = ({v}) => <span className="tag" style={{
    background: v==="VERIFIED"?"#E7F5EE":v==="ESTIMATED"?"#FDF3E4":"#EDF2F9",
    color: v==="VERIFIED"?"var(--good)":v==="ESTIMATED"?"var(--warn)":"var(--slate)",
    fontSize:10, marginLeft:6}}>{v}</span>;

  if(err) return <div><div className="pagehead"><div><h1>Market</h1></div></div>
    <div className="card" style={{padding:18}}><p style={{color:"var(--bad)",fontSize:13}}>{err}</p></div></div>;
  if(!d) return <div style={{padding:40,textAlign:"center"}}><Loader2 size={22} style={{color:"var(--azure)",animation:"spin 1s linear infinite"}}/></div>;

  const m = d.market;
  return (
    <div>
      <div className="pagehead">
        <div><h1>Market Intelligence</h1><p>Where the work is — and what's verified versus estimated</p></div>
      </div>

      <div className="statgrid">
        <div className="card stat"><div className="v">{m.projectsDiscovered}</div><div className="k">Projects discovered</div></div>
        <div className="card stat"><div className="v">{m.filmOpportunities}</div><div className="k">Film opportunities</div></div>
        <div className="card stat">
          <div className="v">{fmt$(m.revenue.verified.amount)}</div>
          <div className="k">Revenue won <Label v="VERIFIED"/></div>
        </div>
        <div className="card stat">
          <div className="v">{fmt$(m.revenue.estimated.low)}</div>
          <div className="k">Open pipeline <Label v="ESTIMATED"/></div>
        </div>
      </div>

      <div className="card" style={{padding:16,marginBottom:14}}>
        <p style={{fontSize:13,margin:"0 0 6px"}}>{m.conversionNote}</p>
        <p style={{fontSize:12.5,color:"var(--slate)",margin:"0 0 4px"}}>{m.revenue.verified.note}</p>
        <p style={{fontSize:12.5,color:"var(--slate)",margin:0}}>{m.revenue.estimated.note}</p>
        {m.filmSf.specified>0 && (
          <p style={{fontSize:13,marginTop:8}}>
            Film square footage identified: <b className="mono">{m.filmSf.specified.toLocaleString()} SF</b><Label v={m.filmSf.label}/>
          </p>
        )}
        {m.filmSf.note && <p style={{fontSize:12,color:"var(--warn)",margin:"4px 0 0"}}>{m.filmSf.note}</p>}
      </div>

      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(240px,1fr))",gap:12,marginBottom:18}}>
        {[["Film types",m.topFilmTypes],["Project types",m.topProjectTypes],
          ["Cities",m.topCities],["General contractors",m.topGcs],["Architects",m.topArchitects]]
          .filter(([,rows])=>rows.length>0).map(([title,rows])=>(
          <div key={title} className="card" style={{padding:16}}>
            <h3 style={{margin:"0 0 10px",fontSize:14}}>{title}</h3>
            {rows.map(r=>(
              <div key={r.name} style={{display:"flex",justifyContent:"space-between",fontSize:13,padding:"5px 0",borderBottom:"1px solid var(--line)"}}>
                <span style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{r.name}</span>
                <b className="mono" style={{flexShrink:0,marginLeft:8}}>{r.count}</b>
              </div>
            ))}
          </div>
        ))}
      </div>

      <h2 style={{fontSize:17,margin:"0 0 10px"}}>Territories</h2>
      {d.territories.length===0 && (
        <div className="card" style={{padding:22,textAlign:"center",color:"var(--slate)",fontSize:13.5}}>
          No cities on record yet. Territory analysis fills in as projects gain a city.
        </div>
      )}
      {d.territories.length>0 && (
        <div className="card">
          {d.territories.map(t=>(
            <div key={t.city} style={{padding:"13px 16px",borderBottom:"1px solid var(--line)"}}>
              <div style={{display:"flex",justifyContent:"space-between",gap:8,alignItems:"center",flexWrap:"wrap"}}>
                <b style={{fontSize:14}}>{t.city}{t.state?`, ${t.state}`:""}{t.isHome && <span className="tag" style={{background:"#EAF3FE",color:"var(--azure)",marginLeft:6,fontSize:10}}>home</span>}</b>
                <span className="mono" style={{fontSize:13,fontWeight:700}}>
                  {t.estimatedValue!=null ? fmt$(t.estimatedValue) : "Unknown"}
                  <Label v={t.valueLabel}/>
                </span>
              </div>
              <div style={{fontSize:12.5,color:"var(--slate)",marginTop:4,display:"flex",gap:12,flexWrap:"wrap"}}>
                <span className="mono">{t.projects} project{t.projects===1?"":"s"}</span>
                <span className="mono">{t.filmOpportunities} film ({t.filmRate}%)</span>
                {t.distanceMiles!=null && <span className="mono">{t.distanceMiles} mi</span>}
                {t.topBuildingType && <span>{t.topBuildingType}</span>}
                {t.topFilmType && <span>{t.topFilmType}</span>}
              </div>
              <p style={{fontSize:11.5,color:"var(--slate)",margin:"4px 0 0"}}>{t.note}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ============ WIN THIS JOB ============ */
function WinThisJob({opp}){
  const [r,setR] = useState(null);
  const [busy,setBusy] = useState(false);
  const [err,setErr] = useState("");

  const run = async ()=>{
    setBusy(true); setErr(""); setR(null);
    try{ setR(await api2("/projects/" + opp.id + "/win-strategy", {method:"POST", body:{}})); }
    catch(e){ setErr(e.message); }
    setBusy(false);
  };

  const List = ({title, items}) => (!items?.length ? null : (
    <div style={{marginTop:14}}>
      <h4 style={{fontSize:12,letterSpacing:".06em",textTransform:"uppercase",color:"var(--slate)",margin:"0 0 6px"}}>{title}</h4>
      <ul style={{fontSize:13.5,lineHeight:1.65,margin:0,paddingLeft:18}}>
        {items.map((t,i)=><li key={i}>{t}</li>)}
      </ul>
    </div>
  ));

  return (
    <div className="card" style={{padding:18}}>
      {!r && !busy && (
        <Empty icon={Sparkles} title="How do I win this one?"
          body="Builds a pursuit strategy from what's actually on this project: the calculated bid, film scope, risks, contacts, and your real history with this GC. It won't invent competitors or relationships.">
          <button className="btn pri" onClick={run}><Sparkles size={15}/>WIN THIS JOB</button>
        </Empty>
      )}
      {busy && <div style={{padding:28,textAlign:"center"}}>
        <Loader2 size={22} style={{color:"var(--azure)",animation:"spin 1s linear infinite"}}/>
        <p style={{fontSize:13,color:"var(--slate)",marginTop:8}}>Building the pursuit strategy…</p></div>}
      {err && <p style={{color:"var(--bad)",fontSize:13}}><AlertTriangle size={14} style={{verticalAlign:-2}}/> {err}</p>}

      {r && (
        <div>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:8,flexWrap:"wrap",marginBottom:12}}>
            <h3 style={{margin:0,fontSize:16}}>Pursuit strategy</h3>
            <button className="btn ghost" onClick={run}><RefreshCw size={14}/>Rebuild</button>
          </div>
          {!r.hasBid && (
            <p style={{fontSize:12.5,color:"var(--warn)",background:"#FDF3E4",padding:"9px 12px",borderRadius:9,margin:"0 0 12px"}}>
              <AlertTriangle size={13} style={{verticalAlign:-2}}/> No calculated bid yet — run BUILD MY BID first for pricing-aware advice.
            </p>
          )}
          <p style={{fontSize:14,lineHeight:1.65,background:"#F2F7FD",padding:"12px 14px",borderRadius:10}}>{r.strategy}</p>
          {r.pricingPosture && (
            <p style={{fontSize:13.5,marginTop:12}}><b>Pricing posture:</b> {r.pricingPosture}</p>
          )}
          <List title="Talking points" items={r.talkingPoints}/>
          <List title="Questions to ask" items={r.questionsToAsk}/>
          <List title="Why a film specialist" items={r.differentiators}/>
          <List title="Risks worth raising with the GC" items={r.risksToRaise}/>
          {r.postBid && (
            <div style={{marginTop:14}}>
              <h4 style={{fontSize:12,letterSpacing:".06em",textTransform:"uppercase",color:"var(--slate)",margin:"0 0 6px"}}>After you submit</h4>
              <p style={{fontSize:13.5,lineHeight:1.6,margin:0}}>{r.postBid}</p>
            </div>
          )}
          {r.gcHistory && (
            <p style={{fontSize:12.5,color:"var(--slate)",marginTop:14,background:"#F2F7FD",padding:"9px 12px",borderRadius:9}}>
              History with {opp.gc || "this GC"}: {r.gcHistory.bids} decided bid(s), {r.gcHistory.wins} win(s).
              {r.gcHistory.note ? " " + r.gcHistory.note : ""}
            </p>
          )}
          {r.confidenceNote && <p style={{fontSize:12,color:"var(--slate)",marginTop:8}}>{r.confidenceNote}</p>}
        </div>
      )}
    </div>
  );
}

/* ============ NOTIFICATION BELL ============ */
function Notifications({openOpp}){
  const [n,setN] = useState(null);
  const [open,setOpen] = useState(false);
  useEffect(()=>{ api2("/notifications").then(setN).catch(()=>{}); },[]);
  if(!n) return null;
  const sev = s => s==="high"?"var(--bad)":s==="medium"?"var(--warn)":"var(--slate)";

  return (
    <div style={{position:"relative"}}>
      <button className="btn ghost" onClick={()=>setOpen(o=>!o)} aria-label="Notifications">
        <AlertTriangle size={15}/>
        {n.counts.total>0 && (
          <span style={{background:n.counts.high?"var(--bad)":"var(--warn)",color:"#fff",borderRadius:99,
            fontSize:11,fontWeight:700,padding:"1px 7px"}}>{n.counts.total}</span>
        )}
      </button>
      {open && (
        <div className="card" style={{position:"absolute",right:0,top:"calc(100% + 6px)",width:"min(360px,90vw)",
          zIndex:40,maxHeight:400,overflowY:"auto",boxShadow:"0 12px 32px rgba(12,35,64,.18)"}}>
          {n.quiet && <p style={{padding:18,fontSize:13.5,color:"var(--slate)",margin:0,textAlign:"center"}}>Nothing needs you right now.</p>}
          {n.items.map((i,idx)=>(
            <div key={idx} onClick={()=>{ if(i.projectId){ openOpp(i.projectId); setOpen(false); } }}
              style={{padding:"11px 14px",borderBottom:"1px solid var(--line)",cursor:i.projectId?"pointer":"default",display:"flex",gap:9}}>
              <span style={{width:7,height:7,borderRadius:99,background:sev(i.severity),marginTop:6,flexShrink:0}}/>
              <div style={{minWidth:0}}>
                <div style={{fontSize:13,fontWeight:600}}>{i.title}</div>
                {i.detail && <div style={{fontSize:11.5,color:"var(--slate)",marginTop:2}}>{i.detail}</div>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ============ SPECIFICATION HUNTER (architect intelligence) ============ */
function SpecHunter({openOpp}){
  const [d,setD] = useState(null);
  const [err,setErr] = useState("");
  useEffect(()=>{ api2("/spec-hunter").then(setD).catch(e=>setErr(e.message)); },[]);

  const pri = p => p==="HIGH"?"var(--good)":p==="MEDIUM"?"var(--warn)":"var(--slate)";

  return (
    <div>
      <div className="pagehead">
        <div>
          <h1>Specification Hunter</h1>
          <p>Get film written into the spec before the project ever goes out to bid</p>
        </div>
      </div>
      {err && <p style={{color:"var(--bad)",fontSize:13}}><AlertTriangle size={14} style={{verticalAlign:-2}}/> {err}</p>}
      {!d && !err && <p style={{fontSize:13.5,color:"var(--slate)"}}>Loading…</p>}

      {d && d.opportunities.length===0 && (
        <Empty icon={Sparkles} title="No specification opportunities yet"
          body={d.note}/>
      )}

      {d && d.opportunities.length>0 && (
        <>
          <h3 style={{fontSize:12,letterSpacing:".06em",textTransform:"uppercase",color:"var(--slate)",margin:"0 0 8px"}}>
            Open windows ({d.opportunities.length})
          </h3>
          {d.opportunities.map((o,i)=>(
            <div key={i} className="card" style={{padding:14,marginBottom:10}}>
              <div style={{display:"flex",justifyContent:"space-between",gap:8,alignItems:"center",flexWrap:"wrap"}}>
                <b style={{fontSize:14.5}}>{o.architect}</b>
                <span className="tag" style={{background:pri(o.priority)+"1A",color:pri(o.priority)}}>{o.priority}</span>
              </div>
              <div style={{fontSize:13,color:"var(--slate)",marginTop:3,cursor:o.project_id?"pointer":"default"}}
                onClick={()=>o.project_id&&openOpp(o.project_id)}>
                {o.project_name} · <span className="tag" style={{background:"#EDE9FB",color:"#7A5FD0",fontSize:10}}>{o.stage}</span>
              </div>
              {(o.film_category || o.current_manufacturer) && (
                <div style={{fontSize:12.5,marginTop:6}}>
                  {o.film_category && <>Typically specifies <b>{o.film_category}</b></>}
                  {o.current_manufacturer && <> · usually <b>{o.current_manufacturer}</b></>}
                </div>
              )}
              <p style={{fontSize:13,margin:"8px 0 4px"}}>{o.opportunity}</p>
              <p style={{fontSize:12.5,color:"var(--azure)",margin:0,fontWeight:600}}>→ {o.next_action}</p>
            </div>
          ))}
        </>
      )}

      {d?.profiles?.length>0 && (
        <>
          <h3 style={{fontSize:12,letterSpacing:".06em",textTransform:"uppercase",color:"var(--slate)",margin:"20px 0 8px"}}>
            Architects on record
          </h3>
          <div className="card">
            {d.profiles.map((a,i)=>(
              <div key={i} style={{padding:"12px 16px",borderBottom:"1px solid var(--line)"}}>
                <div style={{display:"flex",justifyContent:"space-between",gap:8,alignItems:"center",flexWrap:"wrap"}}>
                  <b style={{fontSize:13.5}}>{a.architect}</b>
                  <span className="tag" style={{background:pri(a.priority.level)+"1A",color:pri(a.priority.level),fontSize:10}}>{a.priority.level}</span>
                </div>
                <div style={{fontSize:12.5,color:"var(--slate)",marginTop:3,display:"flex",gap:12,flexWrap:"wrap"}}>
                  <span className="mono">{a.projects} project{a.projects===1?"":"s"}</span>
                  <span className="mono">{a.filmOpportunities} film opp{a.filmOpportunities===1?"":"s"}</span>
                  {a.topFilmType && <span>{a.topFilmType.name}</span>}
                  {a.topManufacturer && <span>{a.topManufacturer.name}</span>}
                </div>
                <p style={{fontSize:12,color:a.reliable?"var(--slate)":"var(--warn)",margin:"5px 0 0"}}>{a.note}</p>
                <p style={{fontSize:12.5,margin:"4px 0 0"}}>{a.priority.reason}</p>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/* ============ JOB COST (estimated vs actual) ============ */
function JobCostTab({opp}){
  const [d,setD] = useState(null);
  const [err,setErr] = useState("");
  const [busy,setBusy] = useState(false);
  const [vals,setVals] = useState({});

  const load = ()=>api2("/projects/" + opp.id + "/job-cost").then(setD).catch(e=>setErr(e.message));
  useEffect(()=>{ load(); },[]);

  const save = async (category)=>{
    const v = vals[category];
    if(v===undefined || v==="") return;
    setBusy(true); setErr("");
    try{
      await api2("/projects/" + opp.id + "/job-cost", {method:"POST", body:{category, actual:Number(v)}});
      setVals(x=>({...x,[category]:""})); await load();
    }catch(e){ setErr(e.message); }
    setBusy(false);
  };

  if(err) return <div className="card" style={{padding:18}}><p style={{color:"var(--bad)",fontSize:13}}>{err}</p></div>;
  if(!d) return <div className="card" style={{padding:24,textAlign:"center"}}><Loader2 size={20} style={{color:"var(--azure)",animation:"spin 1s linear infinite"}}/></div>;

  const col = s => s==="over"?"var(--bad)":s==="under"?"var(--good)":"var(--slate)";

  return (
    <div className="card" style={{padding:18}}>
      <p style={{fontSize:12.5,color:"var(--slate)",margin:"0 0 14px"}}>
        After the job, enter what it actually cost. This is the only way your estimates get more accurate — and it feeds your production rates.
      </p>
      {d.note && <p style={{fontSize:12.5,color:"var(--warn)",background:"#FDF3E4",padding:"9px 12px",borderRadius:9,margin:"0 0 12px"}}>{d.note}</p>}

      <div style={{overflowX:"auto"}}>
        <table style={{width:"100%",borderCollapse:"collapse",fontSize:12.5,minWidth:460}}>
          <thead><tr style={{textAlign:"left",color:"var(--slate)"}}>
            {["Category","Estimated","Actual","Variance","Enter actual"].map(h=>
              <th key={h} style={{padding:"6px 8px",borderBottom:"1px solid var(--line)",fontSize:11}}>{h}</th>)}
          </tr></thead>
          <tbody>
            {d.lines.map(l=>(
              <tr key={l.category} style={{borderBottom:"1px solid var(--line)"}}>
                <td style={{padding:"8px",fontWeight:600,textTransform:"capitalize"}}>{l.category}</td>
                <td style={{padding:"8px"}} className="mono">{l.estimated!=null?fmt$(l.estimated):"—"}</td>
                <td style={{padding:"8px"}} className="mono">{l.actual!=null?fmt$(l.actual):"—"}</td>
                <td style={{padding:"8px",color:col(l.status)}} className="mono">
                  {l.variance!=null ? (l.variance>0?"+":"")+fmt$(l.variance) : "—"}
                  {l.percent!=null && <span style={{fontSize:11}}> ({l.percent>0?"+":""}{l.percent}%)</span>}
                  {l.flag && <div style={{fontSize:10.5,fontWeight:600}}>{l.flag}</div>}
                </td>
                <td style={{padding:"5px"}}>
                  <div style={{display:"flex",gap:4}}>
                    <input type="number" style={{padding:"5px 7px",width:92}} value={vals[l.category]??""}
                      onChange={e=>setVals(x=>({...x,[l.category]:e.target.value}))}/>
                    <button className="btn ghost" style={{padding:"5px 8px"}} disabled={busy} onClick={()=>save(l.category)}><Save size={12}/></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {d.totalActual!=null && (
        <div style={{marginTop:16,background:"var(--navy)",color:"#fff",borderRadius:12,padding:"16px 18px"}}>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(120px,1fr))",gap:"12px 16px",fontSize:12.5}}>
            {[["Estimated cost",fmt$(d.totalEstimated)],["Actual cost",fmt$(d.totalActual)],
              ["Cost variance",(d.totalVariance>0?"+":"")+fmt$(d.totalVariance)],
              ["Estimated profit",fmt$(d.estimatedProfit)],["Actual profit",fmt$(d.actualProfit)],
              ["Margin",d.actualMargin!=null?d.actualMargin+"%":"—"]].map(([k,v])=>(
              <div key={k}><div style={{opacity:.65,marginBottom:2}}>{k}</div>
                <div className="mono" style={{fontSize:16,fontWeight:600,
                  color:k==="Actual profit"?(d.profitVariance>=0?"var(--azure2)":"#FF8A8A"):"#fff"}}>{v}</div></div>
            ))}
          </div>
        </div>
      )}

      {d.insights?.length>0 && (
        <div style={{marginTop:14}}>
          <h4 style={{fontSize:12,letterSpacing:".06em",textTransform:"uppercase",color:"var(--slate)",margin:"0 0 8px"}}>What this tells you</h4>
          {d.insights.map((m,i)=>(
            <p key={i} style={{fontSize:13,lineHeight:1.55,background:"#F2F7FD",padding:"10px 12px",borderRadius:9,margin:"0 0 8px"}}>{m}</p>
          ))}
        </div>
      )}
    </div>
  );
}

/* ============ PURSUE: contacts, outreach, follow-ups ============ */
function PursueTab({opp}){
  const [data,setData] = useState({contact:null, outreach:[], followups:[], loading:true});
  const [err,setErr] = useState("");
  const [busy,setBusy] = useState(false);
  const [draft,setDraft] = useState(null);
  const [copied,setCopied] = useState(false);

  const load = async ()=>{
    try{
      const [bc,out,fu] = await Promise.all([
        api2("/projects/" + opp.id + "/best-contact"),
        api2("/projects/" + opp.id + "/outreach"),
        api2("/projects/" + opp.id + "/contacts")
      ]);
      setData({contact:bc.best, note:bc.note, ranked:bc.ranked||[], outreach:out||[], contacts:fu||[], loading:false});
    }catch(e){ setErr(e.message); setData(d=>({...d,loading:false})); }
  };
  useEffect(()=>{ load(); },[]);

  const writeOutreach = async (purpose, channel)=>{
    setBusy(true); setErr(""); setDraft(null);
    try{
      const r = await api2("/projects/" + opp.id + "/outreach", {method:"POST", body:{purpose, channel}});
      setDraft(r); load();
    }catch(e){ setErr(e.message); }
    setBusy(false);
  };

  const planFollowups = async ()=>{
    setBusy(true); setErr("");
    try{
      const r = await api2("/projects/" + opp.id + "/followups", {method:"POST", body:{contactName:data.contact?.name}});
      setErr(""); alertLike(r.created ? `${r.created} follow-up task(s) scheduled.` : "Already scheduled.");
    }catch(e){ setErr(e.message); }
    setBusy(false);
  };
  const [msg,setMsg] = useState("");
  const alertLike = t => { setMsg(t); setTimeout(()=>setMsg(""),3000); };

  const copy = async ()=>{
    const text = (draft.subject ? "Subject: " + draft.subject + "\n\n" : "") + draft.body;
    try{ await navigator.clipboard.writeText(text); setCopied(true); setTimeout(()=>setCopied(false),1600); }catch(e){}
  };

  if(data.loading) return <div className="card" style={{padding:24,textAlign:"center"}}><Loader2 size={20} style={{color:"var(--azure)",animation:"spin 1s linear infinite"}}/></div>;

  return (
    <div className="card" style={{padding:18}}>
      {err && <p style={{color:"var(--bad)",fontSize:13}}><AlertTriangle size={14} style={{verticalAlign:-2}}/> {err}</p>}
      {msg && <p style={{color:"var(--good)",fontSize:13}}><CheckCircle2 size={14} style={{verticalAlign:-2}}/> {msg}</p>}

      <h4 style={{fontSize:12,letterSpacing:".06em",textTransform:"uppercase",color:"var(--slate)",margin:"0 0 8px"}}>Who should I call?</h4>
      {!data.contact && (
        <p style={{fontSize:13.5,color:"var(--slate)"}}>{data.note || "No contacts on record yet."}</p>
      )}
      {data.contact && (
        <div style={{border:"1px solid var(--line)",borderRadius:10,padding:13,marginBottom:14}}>
          <div style={{display:"flex",justifyContent:"space-between",gap:8,alignItems:"center",flexWrap:"wrap"}}>
            <b style={{fontSize:15}}>{data.contact.name}</b>
            <span className="tag" style={{background:data.contact.priority==="HIGH"?"#E7F5EE":"#EDF2F9",
              color:data.contact.priority==="HIGH"?"var(--good)":"var(--slate)"}}>{data.contact.priority} priority</span>
          </div>
          <div style={{fontSize:12.5,color:"var(--slate)",marginTop:3}}>{data.contact.role}</div>
          <div style={{display:"flex",gap:12,marginTop:7,flexWrap:"wrap",fontSize:13}}>
            {data.contact.phone && <a href={"tel:"+data.contact.phone} style={{color:"var(--azure)",fontWeight:600,textDecoration:"none"}}><Phone size={13} style={{verticalAlign:-2}}/> {data.contact.phone}</a>}
            {data.contact.email && <a href={"mailto:"+data.contact.email} style={{color:"var(--azure)",fontWeight:600,textDecoration:"none"}}><Mail size={13} style={{verticalAlign:-2}}/> {data.contact.email}</a>}
          </div>
          {data.contact.reason && <p style={{fontSize:12.5,color:"var(--slate)",margin:"8px 0 0"}}>{data.contact.reason}</p>}
        </div>
      )}

      <h4 style={{fontSize:12,letterSpacing:".06em",textTransform:"uppercase",color:"var(--slate)",margin:"0 0 8px"}}>Write outreach</h4>
      <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:12}}>
        {[["intro","Introduction","email"],["bid_question","Scope question","email"],
          ["follow_up","Follow-up","email"],["intro","Call script","call"]].map(([p,label,ch],i)=>(
          <button key={i} className="chip" disabled={busy} onClick={()=>writeOutreach(p,ch)}>
            {busy ? "…" : label}
          </button>
        ))}
        <button className="btn ghost" style={{padding:"7px 11px"}} disabled={busy} onClick={planFollowups}>
          <Clock size={14}/>Schedule follow-ups
        </button>
      </div>

      {draft && (
        <div style={{border:"1px solid var(--line)",borderRadius:10,padding:13,marginBottom:14}}>
          <p style={{fontSize:11.5,color:"var(--warn)",background:"#FDF3E4",padding:"7px 10px",borderRadius:8,margin:"0 0 10px"}}>
            Draft only — nothing is sent automatically. Read it, edit it, then copy it into your email.
          </p>
          {draft.subject && <div style={{fontSize:13.5,marginBottom:6}}><b>Subject:</b> {draft.subject}</div>}
          <textarea rows={9} defaultValue={draft.body} style={{fontSize:13,lineHeight:1.55}}
            onChange={e=>setDraft(d=>({...d,body:e.target.value}))}/>
          {draft.ask && <p style={{fontSize:12.5,marginTop:8}}><b>The ask:</b> {draft.ask}</p>}
          {draft.talkingPoints?.length>0 && (
            <div style={{marginTop:8}}>
              <div style={{fontSize:11,fontWeight:700,letterSpacing:".05em",textTransform:"uppercase",color:"var(--slate)",marginBottom:4}}>Have ready</div>
              <ul style={{fontSize:12.5,lineHeight:1.6,margin:0,paddingLeft:18}}>
                {draft.talkingPoints.map((t,i)=><li key={i}>{t}</li>)}
              </ul>
            </div>
          )}
          <button className="btn ghost" style={{marginTop:10}} onClick={copy}>
            {copied ? <CheckCircle2 size={14} style={{color:"var(--good)"}}/> : <Copy size={14}/>}{copied?"Copied":"Copy"}
          </button>
        </div>
      )}

      {data.outreach?.length>0 && (
        <>
          <h4 style={{fontSize:12,letterSpacing:".06em",textTransform:"uppercase",color:"var(--slate)",margin:"0 0 8px"}}>Outreach history ({data.outreach.length})</h4>
          {data.outreach.slice(0,6).map(o=>(
            <div key={o.id} style={{display:"flex",gap:10,alignItems:"center",padding:"8px 0",borderBottom:"1px solid var(--line)",fontSize:12.5}}>
              <span className="tag" style={{background:"#EDF2F9",color:"var(--slate)",fontSize:10}}>{o.status}</span>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{o.subject || o.purpose}</div>
                <div style={{color:"var(--slate)",fontSize:11.5}}>{o.channel} · {(o.created_at||"").slice(0,10)}</div>
              </div>
              {o.status==="Draft" && (
                <button className="btn ghost" style={{padding:"5px 9px",fontSize:11}}
                  onClick={()=>api2("/outreach/"+o.id,{method:"PUT",body:{status:"Sent"}}).then(load)}>Mark sent</button>
              )}
            </div>
          ))}
        </>
      )}
    </div>
  );
}

/* ============ FOLLOW-UP CENTER ============ */
function FollowUps({openOpp}){
  const [g,setG] = useState(null);
  const [err,setErr] = useState("");
  const load = ()=>api2("/followups").then(setG).catch(e=>setErr(e.message));
  useEffect(()=>{ load(); },[]);

  const done = async id => { try{ await api2("/followups/"+id,{method:"PUT",body:{status:"Done"}}); load(); }catch(e){ setErr(e.message); } };

  const SECTIONS = [["overdue","Overdue","var(--bad)"],["today","Today","var(--warn)"],
    ["thisWeek","This week","var(--azure)"],["upcoming","Upcoming","var(--slate)"]];

  return (
    <div>
      <div className="pagehead">
        <div><h1>Follow-ups</h1><p>What to chase today, and who to chase</p></div>
        <button className="btn ghost" onClick={load}><RefreshCw size={15}/>Refresh</button>
      </div>
      {err && <p style={{color:"var(--bad)",fontSize:13}}>{err}</p>}
      {!g && !err && <p style={{fontSize:13.5,color:"var(--slate)"}}>Loading…</p>}
      {g && g.needsAttention===0 && g.thisWeek.length===0 && g.upcoming.length===0 && (
        <Empty icon={Clock} title="Nothing to chase"
          body="Open a project, go to the Pursue tab, and tap Schedule follow-ups. It builds the whole sequence from the bid date — intro, follow-ups, pre-bid check, deadline reminders, and post-bid award check."/>
      )}
      {g && SECTIONS.map(([key,label,color])=>{
        const items = g[key] || [];
        if(!items.length) return null;
        return (
          <div key={key} style={{marginBottom:16}}>
            <h3 style={{fontSize:12,letterSpacing:".06em",textTransform:"uppercase",color,margin:"0 0 8px"}}>
              {label} ({items.length})
            </h3>
            <div className="card">
              {items.map(f=>(
                <div key={f.id} style={{display:"flex",gap:10,alignItems:"center",padding:"12px 16px",borderBottom:"1px solid var(--line)"}}>
                  <button onClick={()=>done(f.id)} aria-label="Mark done"
                    style={{width:20,height:20,flexShrink:0,borderRadius:5,border:"1.5px solid var(--line)",background:"#fff",cursor:"pointer",padding:0}}/>
                  <div style={{flex:1,minWidth:0,cursor:f.project_id?"pointer":"default"}} onClick={()=>f.project_id&&openOpp(f.project_id)}>
                    <div style={{fontSize:13.5,fontWeight:600}}>
                      <span className="tag" style={{background:"#EDF2F9",color:"var(--navy)",marginRight:7,fontSize:10}}>{f.action}</span>
                      {f.reason}
                    </div>
                    <div style={{fontSize:12,color:"var(--slate)",marginTop:3}}>
                      {[f.project_name, f.contact_name].filter(Boolean).join(" · ")}
                    </div>
                  </div>
                  <span className="mono" style={{fontSize:12,color,flexShrink:0}}>{f.due_date}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ============ BUILD MY BID (V2.5) ============ */
function BuildMyBid({opp}){
  const [r,setR] = useState(null);
  const [busy,setBusy] = useState(false);
  const [err,setErr] = useState("");
  const [profiles,setProfiles] = useState([]);
  const [profileId,setProfileId] = useState("");

  useEffect(()=>{ api2("/pricing-profiles").then(p=>setProfiles(p||[])).catch(()=>{}); },[]);

  const run = async ()=>{
    setBusy(true); setErr(""); setR(null);
    try{
      setR(await api2("/projects/" + opp.id + "/build-bid", {method:"POST", body:{
        pricingProfileId: profileId || undefined, competition:"medium", strategicValue:"high"
      }}));
    }catch(e){ setErr(e.message); }
    setBusy(false);
  };

  const stepColor = s => s==="ok"?"var(--good)":s==="warn"?"var(--warn)":"var(--bad)";

  return (
    <div className="card" style={{padding:18}}>
      {!r && !busy && (
        <Empty icon={Sparkles} title="Build the whole bid in one pass"
          body="Runs the full pipeline: checks documents, pulls the film scope, calculates the takeoff, prices three scenarios, scores the bid, flags risks, and tells you who to call. Every number is calculated — nothing is invented.">
          <div style={{maxWidth:280,margin:"0 auto 12px"}}>
            <Field label="Pricing profile">
              <select value={profileId} onChange={e=>setProfileId(e.target.value)}>
                <option value="">Default rates</option>
                {profiles.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </Field>
          </div>
          <button className="btn pri" onClick={run}><Sparkles size={15}/>BUILD MY BID</button>
        </Empty>
      )}
      {busy && (
        <div style={{padding:30,textAlign:"center"}}>
          <Loader2 size={24} style={{color:"var(--azure)",animation:"spin 1s linear infinite"}}/>
          <p style={{fontSize:14,fontWeight:600,margin:"10px 0 2px"}}>Building your bid</p>
          <p style={{fontSize:12.5,color:"var(--slate)"}}>Takeoff, pricing, score, risks, contact…</p>
        </div>
      )}
      {err && <p style={{color:"var(--bad)",fontSize:13}}><AlertTriangle size={14} style={{verticalAlign:-2}}/> {err}</p>}

      {r && (
        <div>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:8,flexWrap:"wrap",marginBottom:14}}>
            <h3 style={{margin:0,fontSize:16}}>Bid package</h3>
            <button className="btn ghost" onClick={run}><RefreshCw size={14}/>Rebuild</button>
          </div>

          {r.steps?.map((s,i)=>(
            <div key={i} style={{display:"flex",gap:9,alignItems:"flex-start",padding:"6px 0",fontSize:12.5}}>
              <span style={{width:8,height:8,borderRadius:99,background:stepColor(s.status),marginTop:5,flexShrink:0}}/>
              <b style={{minWidth:112}}>{s.name}</b>
              <span style={{color:"var(--slate)"}}>{s.detail}</span>
            </div>
          ))}

          {!r.ready && (
            <div style={{marginTop:14,background:"#FDF3E4",borderRadius:10,padding:"12px 14px"}}>
              <b style={{fontSize:13.5,color:"var(--warn)"}}>{r.recommendation.action}</b>
              <p style={{fontSize:13,margin:"5px 0 0"}}>{r.recommendation.reason}</p>
            </div>
          )}

          {r.ready && (
            <>
              <div style={{marginTop:16,background:"var(--navy)",color:"#fff",borderRadius:12,padding:"18px"}}>
                <div style={{fontSize:11,letterSpacing:".1em",textTransform:"uppercase",opacity:.65}}>Recommended bid · estimated</div>
                <div className="mono" style={{fontSize:32,fontWeight:800,color:"var(--azure2)",lineHeight:1.15}}>
                  {fmt$(r.pricing.recommended)}
                </div>
                <div style={{display:"flex",gap:18,marginTop:12,flexWrap:"wrap",fontSize:12.5}}>
                  {[["Aggressive",r.pricing.aggressive],["Target",r.pricing.target],["Premium",r.pricing.premium]].map(([k,v])=>(
                    <div key={k}>
                      <div style={{opacity:.65}}>{k}</div>
                      <div className="mono" style={{fontWeight:600}}>{fmt$(v.price)}</div>
                      <div style={{opacity:.55,fontSize:11}}>{v.margin}% margin</div>
                    </div>
                  ))}
                </div>
                <div style={{display:"flex",gap:18,marginTop:14,paddingTop:12,borderTop:"1px solid rgba(255,255,255,.15)",flexWrap:"wrap",fontSize:12.5}}>
                  <div><div style={{opacity:.65}}>Film</div><div className="mono" style={{fontWeight:600}}>{r.takeoff.totalSf.toLocaleString()} SF</div></div>
                  <div><div style={{opacity:.65}}>Cost</div><div className="mono" style={{fontWeight:600}}>{fmt$(r.pricing.detail.totalCost)}</div></div>
                  <div><div style={{opacity:.65}}>Gross profit</div><div className="mono" style={{fontWeight:600}}>{fmt$(r.pricing.detail.grossProfit)}</div></div>
                  <div><div style={{opacity:.65}}>Rolls</div><div className="mono" style={{fontWeight:600}}>{r.rollPlan.rolls} × {r.rollPlan.rollWidthIn}"</div></div>
                </div>
              </div>

              <div style={{display:"flex",gap:10,flexWrap:"wrap",marginTop:14}}>
                <div style={{flex:1,minWidth:130,background:"#F2F7FD",borderRadius:10,padding:"11px 13px"}}>
                  <div style={{fontSize:11,color:"var(--slate)",fontWeight:600}}>BID SCORE</div>
                  <div className="mono" style={{fontSize:20,fontWeight:800}}>{r.score.total}<span style={{fontSize:12,color:"var(--slate)"}}>/100</span></div>
                  <div style={{fontSize:12,fontWeight:700,color:r.recommendation.action==="BID"?"var(--good)":r.recommendation.action==="REVIEW"?"var(--warn)":"var(--bad)"}}>{r.recommendation.action}</div>
                </div>
                <div style={{flex:1,minWidth:130,background:"#F2F7FD",borderRadius:10,padding:"11px 13px"}}>
                  <div style={{fontSize:11,color:"var(--slate)",fontWeight:600}}>READINESS</div>
                  <div className="mono" style={{fontSize:20,fontWeight:800}}>{r.readiness.percent}%</div>
                  <div style={{fontSize:11.5,color:"var(--slate)"}}>{r.readiness.done}/{r.readiness.total} checked</div>
                </div>
              </div>

              {r.blockers?.length>0 && (
                <div style={{marginTop:14,background:"#FBEAEA",borderRadius:10,padding:"12px 14px"}}>
                  <b style={{fontSize:13,color:"var(--bad)"}}>Resolve before submitting</b>
                  <ul style={{fontSize:13,margin:"6px 0 0",paddingLeft:18,lineHeight:1.6}}>
                    {r.blockers.map((b,i)=><li key={i}>{b}</li>)}
                  </ul>
                </div>
              )}

              {r.bestContact && (
                <div style={{marginTop:14,border:"1px solid var(--line)",borderRadius:10,padding:12}}>
                  <div style={{fontSize:11,color:"var(--slate)",fontWeight:600,marginBottom:3}}>BEST CONTACT</div>
                  <b style={{fontSize:14}}>{r.bestContact.name}</b>
                  <div style={{fontSize:12.5,color:"var(--slate)"}}>
                    {[r.bestContact.role,r.bestContact.phone,r.bestContact.email].filter(Boolean).join(" · ")}
                  </div>
                </div>
              )}

              <p style={{fontSize:13.5,marginTop:14,fontWeight:600}}>{r.nextAction}</p>
            </>
          )}

          {r.hidden?.hidden && (
            <div style={{marginTop:14,border:"1px solid var(--line)",borderRadius:10,padding:13,background:"#F7F5FD"}}>
              <div style={{display:"flex",gap:8,alignItems:"center",marginBottom:6,flexWrap:"wrap"}}>
                <b style={{fontSize:13.5}}>Hidden tint opportunity</b>
                <span className="tag" style={{background:"#EDE9FB",color:"#7A5FD0"}}>{r.hidden.confidence}% confidence</span>
              </div>
              <p style={{fontSize:13,margin:"0 0 6px"}}>{r.hidden.reason}</p>
              {r.hidden.potential?.valueLow!=null && (
                <div className="mono" style={{fontSize:15,fontWeight:700}}>
                  {fmt$(r.hidden.potential.valueLow)} – {fmt$(r.hidden.potential.valueHigh)}
                  <span className="tag" style={{background:"#EDF2F9",color:"var(--slate)",marginLeft:8,fontSize:10}}>{r.hidden.potential.label}</span>
                </div>
              )}
              <p style={{fontSize:11.5,color:"var(--slate)",margin:"6px 0 0"}}>{r.hidden.potential?.note}</p>
              {r.hidden.recommendedFilms?.length>0 && (
                <div style={{display:"flex",gap:4,flexWrap:"wrap",marginTop:8}}>
                  {r.hidden.recommendedFilms.map(t=><span key={t} className="tag" style={{background:"#E7F5EE",color:"var(--good)",fontSize:10}}>{t}</span>)}
                </div>
              )}
              <p style={{fontSize:12.5,marginTop:8}}>{r.hidden.recommendedAction}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ============ PROJECT COPILOT + CHECKLIST (V2 Phase 7) ============ */
const PROJECT_QUESTIONS = [
  "Where is film specified in this project?",
  "How many square feet of glazing are there?",
  "What manufacturer and product is required?",
  "Is an attachment system required?",
  "What information is still missing?",
  "What should I ask the GC?"
];

function ProjectCopilot({opp}){
  const [msgs,setMsgs] = useState([]);
  const [input,setInput] = useState("");
  const [busy,setBusy] = useState(false);
  const [err,setErr] = useState("");
  const scrollRef = useRef();

  useEffect(()=>{
    const el = scrollRef.current;
    if(el && typeof el.scrollTo === "function") el.scrollTo({top:el.scrollHeight,behavior:"smooth"});
    else if(el) el.scrollTop = el.scrollHeight;
  },[msgs,busy]);

  const ask = async (question)=>{
    const q = (question ?? input).trim();
    if(!q || busy) return;
    setErr(""); setBusy(true); setInput("");
    const next = [...msgs, {role:"user", text:q}];
    setMsgs(next);
    try{
      const r = await api2("/projects/" + opp.id + "/ask", {method:"POST", body:{
        question:q, history: msgs.slice(-6)
      }});
      setMsgs(p=>[...p, {role:"ai", text:r.text, pages:r.pagesConsulted}]);
    }catch(e){
      setErr(e.message);
      setMsgs(msgs);
    }
    setBusy(false);
  };

  return (
    <div className="card" style={{padding:18,display:"flex",flexDirection:"column",minHeight:420}}>
      <p style={{fontSize:12.5,color:"var(--slate)",margin:"0 0 12px"}}>
        Ask about this project's documents. Answers come from the pages already indexed here — no re-uploading, and every answer cites its evidence.
      </p>
      {err && <p style={{color:"var(--bad)",fontSize:13}}><AlertTriangle size={14} style={{verticalAlign:-2}}/> {err}</p>}
      <div ref={scrollRef} style={{flex:1,overflowY:"auto",background:"#EEF3FA",borderRadius:10,padding:14,display:"flex",flexDirection:"column",gap:10,minHeight:200}}>
        {msgs.length===0 && (
          <div style={{margin:"auto",textAlign:"center",color:"var(--slate)"}}>
            <Sparkles size={20} style={{color:"var(--azure)"}}/>
            <p style={{fontSize:13}}>Run Analyze on a document first, then ask anything about it.</p>
          </div>
        )}
        {msgs.map((m,i)=>(
          <div key={i} className={"msg "+(m.role==="user"?"user":"ai")}>
            {m.text}
            {m.pages!=null && <div style={{fontSize:11,color:"var(--slate)",marginTop:6}}>Read {m.pages} indexed page{m.pages===1?"":"s"}</div>}
          </div>
        ))}
        {busy && <div className="msg ai" style={{display:"flex",alignItems:"center",gap:8,color:"var(--slate)"}}>
          <Loader2 size={15} style={{animation:"spin 1s linear infinite"}}/>Checking the documents…</div>}
      </div>
      <div style={{display:"flex",gap:6,flexWrap:"wrap",margin:"10px 0"}}>
        {PROJECT_QUESTIONS.map(p=><button key={p} className="chip" disabled={busy} onClick={()=>ask(p)}>{p}</button>)}
      </div>
      <div style={{display:"flex",gap:8}}>
        <input value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>e.key==="Enter"&&ask()}
          placeholder="Ask about this project…"/>
        <button className="btn pri" disabled={busy||!input.trim()} onClick={()=>ask()} aria-label="Send"><Send size={16}/></button>
      </div>
    </div>
  );
}

function BidChecklist({opp}){
  const [c,setC] = useState(null);
  const [err,setErr] = useState("");
  const [busy,setBusy] = useState(false);

  const load = ()=>api2("/projects/" + opp.id + "/checklist").then(setC).catch(e=>setErr(e.message));
  useEffect(()=>{ load(); },[]);

  const tick = async (item,checked)=>{
    setBusy(true);
    try{ setC(await api2("/projects/" + opp.id + "/checklist", {method:"PUT", body:{item, checked}})); }
    catch(e){ setErr(e.message); }
    setBusy(false);
  };

  if(err) return <div className="card" style={{padding:18}}><p style={{color:"var(--bad)",fontSize:13}}>{err}</p></div>;
  if(!c) return <div className="card" style={{padding:24,textAlign:"center"}}><Loader2 size={20} style={{color:"var(--azure)",animation:"spin 1s linear infinite"}}/></div>;

  return (
    <div className="card" style={{padding:18}}>
      <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:14}}>
        <div className="disp" style={{fontSize:28,fontWeight:800}}>{c.percent}%</div>
        <div style={{flex:1}}>
          <div className="bar" style={{marginBottom:4}}><i style={{width:c.percent+"%",background:c.readyToBid?"var(--good)":"var(--azure)"}}/></div>
          <div style={{fontSize:12.5,color:c.readyToBid?"var(--good)":"var(--slate)"}}>{c.note}</div>
        </div>
      </div>
      {c.blockers.length>0 && (
        <p style={{fontSize:12.5,color:"var(--warn)",background:"#FDF3E4",padding:"9px 12px",borderRadius:9,margin:"0 0 12px"}}>
          <AlertTriangle size={13} style={{verticalAlign:-2}}/> Outstanding: {c.blockers.join(", ")}
        </p>
      )}
      {c.items.map(item=>(
        <div key={item.key} style={{display:"flex",alignItems:"center",gap:10,padding:"9px 0",borderBottom:"1px solid var(--line)"}}>
          <button
            onClick={()=>item.canTick && tick(item.key, !item.done)}
            disabled={busy || !item.canTick}
            aria-label={item.label}
            style={{width:20,height:20,flexShrink:0,borderRadius:5,cursor:item.canTick?"pointer":"default",
              border:"1.5px solid "+(item.done?"var(--good)":"var(--line)"),
              background:item.done?"var(--good)":"#fff",display:"flex",alignItems:"center",justifyContent:"center",padding:0}}>
            {item.done && <CheckCircle2 size={13} style={{color:"#fff"}}/>}
          </button>
          <span style={{flex:1,fontSize:13.5,color:item.done?"var(--slate)":"var(--navy)",textDecoration:item.done?"line-through":"none"}}>
            {item.label}
          </span>
          {item.source && (
            <span className="tag" style={{background:item.source==="verified"?"#E7F5EE":"#EDF2F9",
              color:item.source==="verified"?"var(--good)":"var(--slate)",flexShrink:0,fontSize:10}}>
              {item.source}
            </span>
          )}
        </div>
      ))}
      <p style={{fontSize:11.5,color:"var(--slate)",marginTop:12}}>
        Items marked "verified" are ticked automatically from your project data — the app confirmed them, so they can't be unticked. The rest are yours to check.
      </p>
    </div>
  );
}

/* ============ RECORD BID RESULT (V2 Phase 5) ============ */
const LOSS_REASONS = ["Price","Competitor","GC selected another subcontractor",
  "Scope removed","Project cancelled","No response","Other","Unknown"];

function RecordResult({opp, onSaved}){
  const [open,setOpen] = useState(false);
  const [result,setResult] = useState("Won");
  const [reason,setReason] = useState("Price");
  const [competitor,setCompetitor] = useState("");
  const [winningPrice,setWinningPrice] = useState("");
  const [actualSf,setActualSf] = useState("");
  const [actualHours,setActualHours] = useState("");
  const [notes,setNotes] = useState("");
  const [busy,setBusy] = useState(false);
  const [done,setDone] = useState(false);
  const [err,setErr] = useState("");

  const save = async ()=>{
    setBusy(true); setErr("");
    try{
      await api2("/projects/" + opp.id + "/result", {method:"POST", body:{
        result,
        reason: result==="Lost" ? reason : null,
        competitor: competitor || null,
        winning_price: winningPrice ? Number(winningPrice) : null,
        actual_sf: actualSf ? Number(actualSf) : null,
        actual_labor_hours: actualHours ? Number(actualHours) : null,
        notes: notes || null
      }});
      setDone(true); setOpen(false);
      onSaved && onSaved(result);
    }catch(e){ setErr(e.message); }
    setBusy(false);
  };

  if(done) return (
    <p style={{fontSize:13,color:"var(--good)",marginTop:12}}>
      <CheckCircle2 size={14} style={{verticalAlign:-2}}/> Result recorded — it now feeds your win rate and production rates.
    </p>
  );

  if(!open) return (
    <button className="btn ghost" style={{marginTop:12}} onClick={()=>setOpen(true)}>
      <CheckCircle2 size={15}/>Record bid result
    </button>
  );

  return (
    <div style={{marginTop:14,border:"1px solid var(--line)",borderRadius:12,padding:14}}>
      <h4 style={{margin:"0 0 10px",fontSize:14}}>Record the result</h4>
      {err && <p style={{color:"var(--bad)",fontSize:12.5}}>{err}</p>}
      <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:12}}>
        {["Won","Lost","No Decision","Cancelled","Scope Removed"].map(r=>(
          <button key={r} className="chip" onClick={()=>setResult(r)}
            style={result===r?{background:"var(--azure)",color:"#fff",borderColor:"var(--azure)"}:{}}>{r}</button>
        ))}
      </div>
      {result==="Lost" && (
        <Field label="Why did we lose?">
          <select value={reason} onChange={e=>setReason(e.target.value)}>
            {LOSS_REASONS.map(r=><option key={r}>{r}</option>)}
          </select>
        </Field>
      )}
      <div className="grid2" style={{marginTop:10}}>
        {result==="Lost" && <Field label="Who won it (optional)"><input value={competitor} onChange={e=>setCompetitor(e.target.value)}/></Field>}
        {result==="Lost" && <Field label="Their price (optional)"><input type="number" value={winningPrice} onChange={e=>setWinningPrice(e.target.value)}/></Field>}
        {result==="Won" && <Field label="Actual SF installed"><input type="number" value={actualSf} onChange={e=>setActualSf(e.target.value)}/></Field>}
        {result==="Won" && <Field label="Actual labor hours"><input type="number" value={actualHours} onChange={e=>setActualHours(e.target.value)}/></Field>}
      </div>
      {result==="Won" && <p style={{fontSize:12,color:"var(--slate)",marginTop:8}}>
        Actuals are optional but valuable — they turn your production rates from estimates into real numbers.
      </p>}
      <Field label="Notes"><textarea rows={2} value={notes} onChange={e=>setNotes(e.target.value)}/></Field>
      <div style={{display:"flex",gap:8,marginTop:10}}>
        <button className="btn pri" disabled={busy} onClick={save}>
          {busy ? <Loader2 size={14} style={{animation:"spin 1s linear infinite"}}/> : <Save size={14}/>}Save result
        </button>
        <button className="btn ghost" onClick={()=>setOpen(false)}>Cancel</button>
      </div>
    </div>
  );
}

/* ============ ADDENDA & CONFLICTS (V2 Phase 4) ============ */
function AddendaTab({opp}){
  const [conflicts,setConflicts] = useState(null);
  const [rfis,setRfis] = useState([]);
  const [phase,setPhase] = useState("idle");
  const [progress,setProgress] = useState("");
  const [cmp,setCmp] = useState(null);
  const [err,setErr] = useState("");
  const [rate,setRate] = useState(8.5);
  const fileRef = useRef();

  const load = async ()=>{
    try{
      const [c,r] = await Promise.all([
        api2("/projects/" + opp.id + "/conflicts"),
        api2("/projects/" + opp.id + "/rfis")
      ]);
      setConflicts(c); setRfis(r);
    }catch(e){ setErr(e.message); }
  };
  useEffect(()=>{ load(); },[]);

  const runAddendum = async e => {
    const file = e.target.files?.[0]; if(!file) return;
    e.target.value = ""; setErr(""); setCmp(null);
    try{
      setPhase("extracting"); setProgress("Opening addendum…");
      const doc = await api2("/projects/" + opp.id + "/documents", {method:"POST", body:{
        filename:file.name, document_type:"addendum", mime_type:file.type,
        file_size:file.size, status:"local", processing_status:"extracting",
        uploaded_at:new Date().toISOString()
      }});
      const pages = await extractPdfPages(file, (i,n)=>setProgress("Reading page " + i + " of " + n + "…"));
      setPhase("indexing"); setProgress("Indexing " + pages.length + " pages…");
      await api2("/documents/" + doc.id + "/pages", {method:"POST", body:{projectId:opp.id, pages}});
      setPhase("comparing"); setProgress("Comparing against your current takeoff…");
      const res = await api2("/projects/" + opp.id + "/addenda/compare", {method:"POST", body:{
        documentId:doc.id, filename:file.name, installedPricePerSf:Number(rate)||null
      }});
      setCmp(res); setPhase("done"); load();
    }catch(ex){ setErr(ex.message); setPhase("idle"); }
  };

  const makeRfi = async (conflict)=>{
    setErr("");
    try{ await api2("/projects/" + opp.id + "/rfi", {method:"POST", body:conflict}); load(); }
    catch(e){ setErr(e.message); }
  };

  const busy = ["extracting","indexing","comparing"].includes(phase);
  const sev = s => s==="HIGH"?"var(--bad)":s==="MEDIUM"?"var(--warn)":"var(--slate)";

  return (
    <div className="card" style={{padding:18}}>
      {err && <p style={{color:"var(--bad)",fontSize:13}}><AlertTriangle size={14} style={{verticalAlign:-2}}/> {err}</p>}

      <div style={{display:"flex",gap:10,alignItems:"flex-end",flexWrap:"wrap",marginBottom:14}}>
        <div style={{width:150}}><Field label="Installed $/SF">
          <input type="number" step="0.25" value={rate} onChange={e=>setRate(e.target.value)}/>
        </Field></div>
        <button className="btn pri" disabled={busy} onClick={()=>fileRef.current.click()}>
          {busy ? <Loader2 size={15} style={{animation:"spin 1s linear infinite"}}/> : <Upload size={15}/>}
          Upload addendum
        </button>
        <input ref={fileRef} type="file" accept="application/pdf" onChange={runAddendum} style={{display:"none"}}/>
      </div>
      {busy && <p style={{fontSize:12.5,color:"var(--slate)"}}>{progress}</p>}

      {cmp && (
        <div style={{border:"1px solid var(--line)",borderRadius:12,padding:14,marginBottom:16}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:8,flexWrap:"wrap"}}>
            <h3 style={{margin:0,fontSize:15}}>Addendum {cmp.addendumNumber || "(unnumbered)"}</h3>
            <span className="tag" style={{background:sev(cmp.summary.severity)+"1A",color:sev(cmp.summary.severity)}}>
              {cmp.summary.severity} impact
            </span>
          </div>
          {cmp.summary.noChanges ? (
            <p style={{fontSize:13.5,color:"var(--slate)",marginTop:8}}>{cmp.note || "No tint-relevant changes detected against your current takeoff."}</p>
          ) : (
            <>
              <div style={{display:"flex",gap:16,margin:"12px 0",flexWrap:"wrap"}}>
                <div><div style={{fontSize:11,color:"var(--slate)",fontWeight:600}}>NET CHANGE</div>
                  <div className="mono" style={{fontSize:18,fontWeight:700,color:cmp.summary.netSfDelta>0?"var(--bad)":"var(--good)"}}>
                    {cmp.summary.netSfDelta>0?"+":""}{cmp.summary.netSfDelta.toLocaleString()} SF</div></div>
                <div><div style={{fontSize:11,color:"var(--slate)",fontWeight:600}}>COST IMPACT</div>
                  <div className="mono" style={{fontSize:18,fontWeight:700}}>
                    {cmp.cost.amount!=null ? (cmp.cost.amount>0?"+":"")+fmt$(cmp.cost.amount) : "Unknown"}</div></div>
              </div>
              <ul style={{fontSize:13.5,lineHeight:1.65,paddingLeft:18,margin:"0 0 8px"}}>
                {cmp.summary.changes.map((c,i)=><li key={i}>{c}</li>)}
              </ul>
              {cmp.glazingDiff?.changed?.length>0 && (
                <div style={{marginTop:10}}>
                  {cmp.glazingDiff.changed.map((c,i)=>(
                    <div key={i} style={{fontSize:12.5,padding:"6px 0",borderTop:"1px solid var(--line)"}}>
                      <b>{c.mark}</b>{" "}
                      {c.fields.map(fl=><span key={fl.field} className="mono" style={{color:"var(--slate)"}}>{fl.field} {fl.from} to {fl.to} </span>)}
                      {c.areaDeltaSf!=null && <b className="mono" style={{color:c.areaDeltaSf>0?"var(--bad)":"var(--good)"}}>
                        {c.areaDeltaSf>0?"+":""}{c.areaDeltaSf} SF</b>}
                    </div>
                  ))}
                </div>
              )}
              {cmp.cost.amount==null && <p style={{fontSize:12,color:"var(--slate)"}}>{cmp.cost.note}</p>}
            </>
          )}
        </div>
      )}

      <h4 style={{fontSize:12,letterSpacing:".06em",textTransform:"uppercase",color:"var(--slate)",margin:"0 0 8px"}}>
        Scope conflicts {conflicts && "(" + conflicts.conflicts.length + ")"}
      </h4>
      {!conflicts && <p style={{fontSize:13,color:"var(--slate)"}}>Checking…</p>}
      {conflicts?.conflicts.length===0 && (
        <p style={{fontSize:13.5,color:"var(--slate)"}}>
          {conflicts.scanned===0
            ? "No film scope on record yet — run Analyze on a plan set first."
            : "No conflicts found in the current film scope."}
        </p>
      )}
      {conflicts?.conflicts.map((c,i)=>(
        <div key={i} style={{border:"1px solid var(--line)",borderRadius:10,padding:12,marginBottom:8}}>
          <div style={{display:"flex",gap:8,alignItems:"flex-start"}}>
            <span className="tag" style={{background:sev(c.severity)+"1A",color:sev(c.severity),flexShrink:0}}>{c.severity}</span>
            <div style={{flex:1}}>
              <div style={{fontSize:13.5,fontWeight:600}}>{c.description}</div>
              <div style={{fontSize:11.5,color:"var(--azure)",marginTop:4}} className="mono">
                {[c.sourceA,c.sourceB].filter(Boolean).join("  vs  ")}
              </div>
              {c.suggestedRFI && (
                <button className="btn ghost" style={{marginTop:8,padding:"7px 11px"}} onClick={()=>makeRfi(c)}>
                  <FileText size={13}/>Generate RFI
                </button>
              )}
            </div>
          </div>
        </div>
      ))}

      {rfis.length>0 && (
        <>
          <h4 style={{fontSize:12,letterSpacing:".06em",textTransform:"uppercase",color:"var(--slate)",margin:"18px 0 8px"}}>RFIs ({rfis.length})</h4>
          {rfis.map(r=>(
            <div key={r.id} style={{border:"1px solid var(--line)",borderRadius:10,padding:12,marginBottom:8}}>
              <div style={{display:"flex",justifyContent:"space-between",gap:8,alignItems:"center"}}>
                <b style={{fontSize:13.5}}>{r.subject}</b>
                <span className="tag" style={{background:"#EDF2F9",color:"var(--slate)"}}>{r.status}</span>
              </div>
              {r.source_sheet && <div className="mono" style={{fontSize:11.5,color:"var(--azure)",margin:"4px 0"}}>{r.source_sheet}</div>}
              <p style={{fontSize:13,lineHeight:1.55,margin:"6px 0 8px"}}>{r.question}</p>
              <button className="btn ghost" style={{padding:"6px 10px"}} onClick={()=>{
                navigator.clipboard?.writeText("RFI: " + r.subject + "\nReference: " + (r.source_sheet||"") + "\n\n" + r.question);
              }}><Copy size={13}/>Copy</button>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

/* ============ TAKEOFF WORKBENCH (V2 Phase 3) ============ */
function TakeoffWorkbench({opp, onProposal}){
  const [wb,setWb] = useState(null);
  const [waste,setWaste] = useState(10);
  const [err,setErr] = useState("");
  const [busy,setBusy] = useState(false);
  const [editing,setEditing] = useState(null);
  const [price,setPrice] = useState(null);
  const [profileId,setProfileId] = useState("");
  const [genning,setGenning] = useState(false);

  const load = async (w=waste)=>{
    try{ setWb(await api2("/projects/" + opp.id + "/workbench?waste=" + w)); }
    catch(e){ setErr(e.message); }
  };
  useEffect(()=>{ load(); },[]);

  const changeWaste = async v => { setWaste(v); await load(v); };

  const saveLine = async (line)=>{
    setBusy(true);
    try{
      await api2("/glazing/" + line.id, {method:"PUT", body:{
        window_mark:line.windowMark, floor:line.floor,
        quantity:Number(line.quantity)||null,
        width_ft:Number(line.widthFt)||null,
        height_ft:Number(line.heightFt)||null
      }});
      setEditing(null); await load();
    }catch(e){ setErr(e.message); }
    setBusy(false);
  };
  const addLine = async ()=>{
    setBusy(true);
    try{
      await api2("/glazing", {method:"POST", body:{project_id:opp.id, window_mark:"New", floor:"", quantity:1, width_ft:0, height_ft:0}});
      await load();
    }catch(e){ setErr(e.message); }
    setBusy(false);
  };
  const delLine = async id => { setBusy(true); try{ await api2("/glazing/"+id,{method:"DELETE"}); await load(); }catch(e){setErr(e.message);} setBusy(false); };

  const runPricing = async ()=>{
    if(!wb) return;
    setBusy(true);
    try{
      const body = profileId
        ? {pricingProfileId:profileId, materialSf:wb.materialSf, filmSf:wb.summary.totalSf}
        : {materialSf:wb.materialSf, filmSf:wb.summary.totalSf, materialCostPerSf:3.25,
           productionRateSfPerHour:18, laborCostPerHour:65, overheadPercent:12, profitPercent:35};
      setPrice(await api2("/projects/" + opp.id + "/pricing", {method:"POST", body}));
    }catch(e){ setErr(e.message); }
    setBusy(false);
  };

  const genProposal = async ()=>{
    setGenning(true); setErr("");
    try{
      const prof = wb.pricingProfiles.find(p=>p.id===profileId);
      const body = {wastePercent:waste, ...(prof ? {
        materialCostPerSf:prof.material_cost_per_sf, laborHoursPer100Sf:prof.labor_hours_per_100sf,
        laborCostPerHour:prof.labor_cost_per_hour, equipmentCost:prof.equipment_cost_per_job,
        mobilizationCost:prof.mobilization_cost, overheadPercent:prof.default_overhead_percent,
        profitPercent:prof.default_profit_percent
      } : {materialCostPerSf:3.25, productionRateSfPerHour:18, laborCostPerHour:65,
           overheadPercent:12, profitPercent:35})};
      const r = await api2("/projects/" + opp.id + "/proposal", {method:"POST", body});
      onProposal(r.text);
    }catch(e){ setErr(e.message); }
    setGenning(false);
  };

  return <TakeoffWorkbenchView {...{wb,waste,err,busy,editing,price,profileId,genning,
    changeWaste,saveLine,addLine,delLine,runPricing,genProposal,setEditing,setProfileId}}/>;
}

function TakeoffWorkbenchView({wb,waste,err,busy,editing,price,profileId,genning,
  changeWaste,saveLine,addLine,delLine,runPricing,genProposal,setEditing,setProfileId}){
  if(!wb) return (
    <div className="card" style={{padding:24,textAlign:"center",color:"var(--slate)"}}>
      <Loader2 size={20} style={{animation:"spin 1s linear infinite",color:"var(--azure)"}}/>
      <p style={{fontSize:13.5}}>Loading takeoff…</p>
    </div>
  );

  if(!wb.hasAnalysis) return (
    <div className="card" style={{padding:18}}>
      {err && <p style={{color:"var(--bad)",fontSize:13}}><AlertTriangle size={14} style={{verticalAlign:-2}}/> {err}</p>}
      <Empty icon={Calculator} title="No quantities yet"
        body="Run Analyze on a plan set and the window schedule fills this takeoff in automatically — every line showing its source sheet. You can also add lines by hand.">
        <button className="btn ghost" onClick={addLine} disabled={busy}><Plus size={15}/>Add a line manually</button>
      </Empty>
    </div>
  );

  const s = wb.summary;
  return (
    <div className="card" style={{padding:18}}>
      {err && <p style={{color:"var(--bad)",fontSize:13}}><AlertTriangle size={14} style={{verticalAlign:-2}}/> {err}</p>}

      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(115px,1fr))",gap:10,marginBottom:14}}>
        {[["Total glazing", s.totalSf.toLocaleString()+" SF"],
          ["With "+waste+"% waste", wb.materialSf.toLocaleString()+" SF"],
          ["Rolls (" + wb.rollPlan.rollWidthIn + " in)", wb.rollPlan.rolls],
          ["Lines", s.lineCount],
          ["Unknown", s.unknownCount]].map(([k,v])=>(
          <div key={k} style={{background:"#F2F7FD",borderRadius:10,padding:"10px 12px"}}>
            <div className="mono" style={{fontSize:18,fontWeight:700}}>{v}</div>
            <div style={{fontSize:11,color:"var(--slate)",fontWeight:600}}>{k}</div>
          </div>
        ))}
      </div>

      <p style={{fontSize:12.5,color:"var(--slate)",background:"#F2F7FD",padding:"9px 12px",borderRadius:9,margin:"0 0 14px"}}>
        {wb.rollPlan.reason}
      </p>
      {s.unknownCount>0 && (
        <p style={{fontSize:12.5,color:"var(--warn)",background:"#FDF3E4",padding:"9px 12px",borderRadius:9,margin:"0 0 14px"}}>
          <AlertTriangle size={13} style={{verticalAlign:-2}}/> {s.unknownCount} line(s) have no usable dimensions and are excluded from the total. Tap one to enter measurements.
        </p>
      )}

      <div style={{display:"flex",gap:10,alignItems:"flex-end",flexWrap:"wrap",marginBottom:12}}>
        <div style={{width:110}}><Field label="Waste %">
          <input type="number" value={waste} onChange={e=>changeWaste(Number(e.target.value)||0)}/>
        </Field></div>
        <div style={{flex:1,minWidth:190}}><Field label="Pricing profile">
          <select value={profileId} onChange={e=>setProfileId(e.target.value)}>
            <option value="">Default</option>
            {wb.pricingProfiles.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field></div>
        <button className="btn ghost" onClick={runPricing} disabled={busy}><Calculator size={15}/>Price it</button>
      </div>

      <div style={{overflowX:"auto",marginBottom:14}}>
        <table style={{width:"100%",borderCollapse:"collapse",fontSize:12.5,minWidth:540}}>
          <thead><tr style={{textAlign:"left",color:"var(--slate)"}}>
            {["Mark","Floor","Qty","W (ft)","H (ft)","SF","Source",""].map(h=>
              <th key={h} style={{padding:"6px 7px",borderBottom:"1px solid var(--line)",fontSize:11}}>{h}</th>)}
          </tr></thead>
          <tbody>
            {wb.lines.map(l=> editing===l.id ? (
              <tr key={l.id} style={{background:"#F2F7FD"}}>
                <td style={{padding:4}}><input defaultValue={l.windowMark||""} id={"m"+l.id} style={{padding:"5px 7px"}}/></td>
                <td style={{padding:4}}><input defaultValue={l.floor||""} id={"f"+l.id} style={{padding:"5px 7px"}}/></td>
                <td style={{padding:4}}><input type="number" defaultValue={l.quantity??""} id={"q"+l.id} style={{padding:"5px 7px",width:62}}/></td>
                <td style={{padding:4}}><input type="number" step="0.01" defaultValue={l.widthFt??""} id={"w"+l.id} style={{padding:"5px 7px",width:62}}/></td>
                <td style={{padding:4}}><input type="number" step="0.01" defaultValue={l.heightFt??""} id={"h"+l.id} style={{padding:"5px 7px",width:62}}/></td>
                <td colSpan={3} style={{padding:4}}>
                  <button className="btn pri" style={{padding:"6px 10px"}} disabled={busy} onClick={()=>saveLine({
                    id:l.id,
                    windowMark:document.getElementById("m"+l.id).value,
                    floor:document.getElementById("f"+l.id).value,
                    quantity:document.getElementById("q"+l.id).value,
                    widthFt:document.getElementById("w"+l.id).value,
                    heightFt:document.getElementById("h"+l.id).value
                  })}><Save size={13}/>Save</button>
                  <button className="btn ghost" style={{padding:"6px 9px",marginLeft:5}} onClick={()=>setEditing(null)}>Cancel</button>
                </td>
              </tr>
            ) : (
              <tr key={l.id} style={{borderBottom:"1px solid var(--line)",background:l.areaSf==null?"#FFFBF2":"transparent"}}>
                <td style={{padding:"7px",fontWeight:600}}>{l.windowMark||"—"}</td>
                <td style={{padding:"7px"}}>{l.floor||"—"}</td>
                <td style={{padding:"7px"}} className="mono">{l.quantity??"—"}</td>
                <td style={{padding:"7px"}} className="mono">{l.widthFt??"—"}</td>
                <td style={{padding:"7px"}} className="mono">{l.heightFt??"—"}</td>
                <td style={{padding:"7px",fontWeight:700}} className="mono">
                  {l.areaSf!=null ? l.areaSf.toLocaleString() : <span style={{color:"var(--warn)"}}>Unknown</span>}
                </td>
                <td style={{padding:"7px"}}>
                  <span className="mono" style={{fontSize:11,color:"var(--azure)"}}>{l.sourceSheet||"—"}</span>
                  {l.estimatorOverride && <span className="tag" style={{background:"#EDF2F9",color:"var(--slate)",marginLeft:4,fontSize:10}}>edited</span>}
                </td>
                <td style={{padding:"5px",whiteSpace:"nowrap"}}>
                  <button className="btn ghost" style={{padding:"5px 7px"}} onClick={()=>setEditing(l.id)} aria-label="Edit line"><Pencil size={12}/></button>
                  <button className="btn ghost" style={{padding:"5px 7px",marginLeft:3}} onClick={()=>delLine(l.id)} aria-label="Delete line"><Trash2 size={12}/></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button className="btn ghost" onClick={addLine} disabled={busy}><Plus size={14}/>Add line</button>

      {Object.keys(s.byFloor).length>0 && (
        <div style={{marginTop:16}}>
          <h4 style={{fontSize:12,letterSpacing:".06em",textTransform:"uppercase",color:"var(--slate)",margin:"0 0 8px"}}>By floor</h4>
          {Object.entries(s.byFloor).map(([floor,sf])=>(
            <div key={floor} style={{display:"flex",justifyContent:"space-between",fontSize:13,padding:"5px 0",borderBottom:"1px solid var(--line)"}}>
              <span>{floor}</span><span className="mono" style={{fontWeight:600}}>{sf.toLocaleString()} SF</span>
            </div>
          ))}
        </div>
      )}

      {price && (
        <div style={{marginTop:16,background:"var(--navy)",color:"#fff",borderRadius:12,padding:"16px 18px"}}>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(120px,1fr))",gap:"12px 16px",fontSize:12.5}}>
            {[["Material",fmt$(price.pricing.materialCost)],
              ["Labor hours",Math.round(price.pricing.laborHours)],
              ["Labor",fmt$(price.pricing.laborCost)],
              ["Overhead",fmt$(price.pricing.overhead)],
              ["Total cost",fmt$(price.pricing.totalCost)],
              ["Gross profit",fmt$(price.pricing.grossProfit)],
              ["Margin",price.pricing.grossMargin+"%"],
              ["BID PRICE",fmt$(price.pricing.bidPrice)]].map(([k,v])=>(
              <div key={k}><div style={{opacity:.65,marginBottom:2}}>{k}</div>
                <div className="mono" style={{fontSize:16,fontWeight:600,color:k==="BID PRICE"?"var(--azure2)":"#fff"}}>{v}</div></div>
            ))}
          </div>
          <div style={{marginTop:12,paddingTop:12,borderTop:"1px solid rgba(255,255,255,.15)",fontSize:12,display:"flex",gap:16,flexWrap:"wrap"}}>
            <span style={{opacity:.8}}>Aggressive <b className="mono">{fmt$(price.scenarios.aggressive.bidPrice)}</b></span>
            <span style={{opacity:.8}}>Target <b className="mono">{fmt$(price.scenarios.target.bidPrice)}</b></span>
            <span style={{opacity:.8}}>Conservative <b className="mono">{fmt$(price.scenarios.conservative.bidPrice)}</b></span>
          </div>
        </div>
      )}

      <button className="btn pri" style={{marginTop:14}} disabled={genning||!s.totalSf} onClick={genProposal}>
        {genning ? <Loader2 size={15} style={{animation:"spin 1s linear infinite"}}/> : <FileText size={15}/>}
        Generate proposal from this takeoff
      </button>
    </div>
  );
}


/* ============ OPPORTUNITY DETAIL DRAWER ============ */
function OppDrawer({opp, onClose, onUpdate, onDelete, proposal, setProposal}){
  const [tab,setTab] = useState("overview");
  const [scoring,setScoring] = useState(false);
  const [scoreErr,setScoreErr] = useState("");
  const [editing,setEditing] = useState(false);
  const [genning,setGenning] = useState(false);
  const [copied,setCopied] = useState(false);

  const runScore = async ()=>{
    setScoring(true); setScoreErr("");
    try{ const s = await scoreOpportunity(opp); onUpdate({...opp, score:s}); }
    catch(e){ setScoreErr("Scoring failed: "+e.message); }
    setScoring(false);
  };

  const copyProposal = async ()=>{
    try{ await navigator.clipboard.writeText(proposal); setCopied(true); setTimeout(()=>setCopied(false),1600);}catch(e){}
  };
  const downloadProposal = ()=>{
    const blob = new Blob([proposal],{type:"text/markdown"});
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = opp.name.replace(/[^\w]+/g,"-").slice(0,50)+"-proposal.md";
    a.click(); URL.revokeObjectURL(a.href);
  };

  return (
    <div className="drawer" onClick={e=>{if(e.target.classList.contains("drawer")) onClose();}}>
      <div className="panel">
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:12}}>
          <div className="row">
            <TintPane score={opp.score?.total ?? null}/>
            <div>
              <h2 style={{margin:0,fontSize:19,lineHeight:1.25}}>{opp.name}</h2>
              <div style={{marginTop:6,display:"flex",gap:8,flexWrap:"wrap",alignItems:"center"}}>
                <StatusTag s={opp.status}/>
                {opp.bidDue && <span className="tag mono" style={{background:"#EAF3FE",color:"var(--azure)"}}>due {opp.bidDue}</span>}
              </div>
            </div>
          </div>
          <button className="btn ghost" onClick={onClose} aria-label="Close"><X size={16}/></button>
        </div>

        <div className="tabs" role="tablist">
          {[
            [["overview","Overview"],["score","AI Score"]],
            [["analyze","Analyze"],["addenda","Addenda"],["checklist","Checklist"]],
            [["takeoff","Takeoff"],["build","Build Bid"],["proposal","Proposal"]],
            [["ask","Ask"],["pursue","Pursue"],["win","Win It"]],
            [["cost","Job Cost"]],
          ].map((group,gi)=>(
            <span key={gi} style={{display:"contents"}}>
              {gi>0 && <span className="div" aria-hidden="true"/>}
              {group.map(([k,l])=>(
                <button key={k} className={tab===k?"on":""} onClick={()=>setTab(k)} role="tab" aria-selected={tab===k}>{l}</button>
              ))}
            </span>
          ))}
        </div>

        {tab==="overview" && (editing
          ? <OppForm initial={opp} onCancel={()=>setEditing(false)} onSave={f=>{onUpdate(f);setEditing(false);}}/>
          : <div className="card" style={{padding:18}}>
              <div className="kv">
                <b>Owner</b><span>{opp.owner||"—"}</span>
                <b>General contractor</b><span>{opp.gc||"—"}</span>
                <b>Architect</b><span>{opp.architect||"—"}</span>
                <b>Bid number</b><span className="mono">{opp.bidNumber||"—"}</span>
                <b>Bid due</b><span className="mono">{opp.bidDue||"—"}</span>
                <b>Pre-bid</b><span className="mono">{opp.preBid||"—"}</span>
                <b>Location</b><span>{[opp.city,opp.county&&opp.county+" Co.",opp.state].filter(Boolean).join(", ")||"—"}</span>
                <b>Est. value</b><span>{fmt$(opp.value)}</span>
                <b>Type</b><span>{opp.type||"—"}</span>
                <b>Source</b><span style={{overflowWrap:"anywhere"}}>{/^https?:/.test(opp.source||"")
                  ? <a href={opp.source} target="_blank" rel="noreferrer" style={{color:"var(--azure)",fontWeight:600}}>Open bid posting ↗</a>
                  : (opp.source||"—")}</span>
                <b>Discovered</b><span className="mono">{opp.discovered||"—"}</span>
                <b>Film types</b><span>{opp.filmTypes.join(", ")||"—"}</span>
              </div>
              {opp.notes && <p style={{marginTop:14,fontSize:13.5,background:"#F2F7FD",padding:"10px 12px",borderRadius:9}}>{opp.notes}</p>}
              <div style={{display:"flex",gap:8,marginTop:16,flexWrap:"wrap"}}>
                <button className="btn ghost" onClick={()=>setEditing(true)}><Pencil size={15}/>Edit</button>
                <Field label="">
                  <select value={opp.status} onChange={e=>onUpdate({...opp,status:e.target.value})} style={{width:"auto"}}>
                    {STATUSES.map(s=><option key={s}>{s}</option>)}
                  </select>
                </Field>
                <ConfirmBtn label="Delete" style={{marginLeft:"auto"}} onConfirm={()=>{onDelete(opp.id);onClose();}}/>
              </div>
              <RecordResult opp={opp} onSaved={r=>{
                const map={Won:"Awarded",Lost:"Lost",Cancelled:"Cancelled","No Decision":"No Decision","Scope Removed":"Cancelled"};
                if(map[r]) onUpdate({...opp,status:map[r]});
              }}/>
            </div>
        )}

        {tab==="analyze" && <AnalyzeTab opp={opp}/>}

        {tab==="build" && <BuildMyBid opp={opp}/>}

        {tab==="pursue" && <PursueTab opp={opp}/>}

        {tab==="cost" && <JobCostTab opp={opp}/>}

        {tab==="win" && <WinThisJob opp={opp}/>}

        {tab==="ask" && <ProjectCopilot opp={opp}/>}

        {tab==="checklist" && <BidChecklist opp={opp}/>}

        {tab==="addenda" && <AddendaTab opp={opp}/>}

        {tab==="score" && (
          <div className="card" style={{padding:18}}>
            {!opp.score && !scoring && (
              <Empty icon={Sparkles} title="Not scored yet" body="AI scoring weighs film likelihood, size, profitability, distance from Belton, competition, relationships, timeline, and strategic value — and explains its reasoning.">
                <button className="btn pri" onClick={runScore}><Sparkles size={15}/>Score this opportunity</button>
              </Empty>
            )}
            {scoring && <p style={{display:"flex",alignItems:"center",gap:8,color:"var(--slate)"}}><Loader2 size={16} className="spin" style={{animation:"spin 1s linear infinite"}}/>Analyzing opportunity…</p>}
            {scoreErr && <p style={{color:"var(--bad)",fontSize:13}}><AlertTriangle size={14} style={{verticalAlign:-2}}/> {scoreErr}</p>}
            {opp.score && !scoring && (
              <div>
                <div className="row" style={{marginBottom:16}}>
                  <TintPane score={opp.score.total}/>
                  <div>
                    <div className="disp" style={{fontSize:26,fontWeight:800}}>{opp.score.total}<span style={{fontSize:14,color:"var(--slate)",fontWeight:600}}> / 100</span></div>
                    <div style={{fontSize:12,color:"var(--slate)"}}>scored {opp.score.at}</div>
                  </div>
                  <button className="btn ghost" style={{marginLeft:"auto"}} onClick={runScore}><RefreshCw size={14}/>Re-score</button>
                </div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"10px 18px",marginBottom:16}}>
                  {SCORE_KEYS.map(([k,l])=>(
                    <div key={k}>
                      <div style={{display:"flex",justifyContent:"space-between",fontSize:12,marginBottom:3}}>
                        <span style={{fontWeight:600}}>{l}</span><span className="mono">{opp.score.breakdown[k] ?? "—"}/10</span>
                      </div>
                      <div className="bar"><i style={{width:`${(opp.score.breakdown[k]||0)*10}%`}}/></div>
                    </div>
                  ))}
                </div>
                <div style={{background:"#F2F7FD",borderRadius:10,padding:"12px 14px",fontSize:13.5,lineHeight:1.6}}>{opp.score.reasoning}</div>
              </div>
            )}
          </div>
        )}

        {tab==="takeoff" && <TakeoffWorkbench opp={opp} onProposal={p=>{setProposal(p);setTab("proposal");}}/>}

        {tab==="proposal" && (
          <div className="card" style={{padding:18}}>
            {!proposal && !genning && (
              <Empty icon={FileText} title="No proposal yet" body="Open the Takeoff tab and tap Generate proposal. It builds from your real quantities and pricing — scope, products, assumptions, exclusions, warranty, and terms.">
                <button className="btn pri" onClick={()=>setTab("takeoff")}>Go to takeoff</button>
              </Empty>
            )}
            {genning && <p style={{display:"flex",alignItems:"center",gap:8,color:"var(--slate)"}}><Loader2 size={16} style={{animation:"spin 1s linear infinite"}}/>Writing proposal…</p>}
            {proposal && !genning && (
              <div>
                <div style={{display:"flex",gap:8,marginBottom:12,flexWrap:"wrap"}}>
                  <button className="btn ghost" onClick={copyProposal}>{copied?<CheckCircle2 size={15} style={{color:"var(--good)"}}/>:<Copy size={15}/>}{copied?"Copied":"Copy"}</button>
                  <button className="btn ghost" onClick={downloadProposal}><Download size={15}/>Download .md</button>
                  <button className="btn ghost" onClick={()=>setTab("takeoff")}><RefreshCw size={15}/>Regenerate</button>
                </div>
                <textarea rows={22} value={proposal} onChange={e=>setProposal(e.target.value)} className="mono" style={{fontSize:12.5,lineHeight:1.6}}/>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ============ OPPORTUNITIES VIEW ============ */
function Opportunities({opps,addOpp,openOpp,adding,setAdding}){
  const [q,setQ] = useState("");
  const [fStatus,setFStatus] = useState("Active");
  const filtered = opps.filter(o=>{
    const okS = fStatus==="All" ? true : fStatus==="Active" ? !["Lost","Completed","Archived"].includes(o.status) : o.status===fStatus;
    const okQ = !q || (o.name+o.owner+o.gc+o.city+o.county).toLowerCase().includes(q.toLowerCase());
    return okS && okQ;
  }).sort((a,b)=>(a.bidDue||"9999").localeCompare(b.bidDue||"9999"));

  return (
    <div>
      <div className="pagehead">
        <div><h1>Opportunities</h1><p>Every project that may need film — tracked from discovery to award</p></div>
        <button className="btn pri" onClick={()=>setAdding(true)}><Plus size={16}/>Add opportunity</button>
      </div>
      {adding && <OppForm onCancel={()=>setAdding(false)} onSave={async f=>{await addOpp(f);setAdding(false);}}/>}
      <div style={{display:"flex",gap:10,marginBottom:14,flexWrap:"wrap"}}>
        <input placeholder="Search projects, owners, GCs, cities…" value={q} onChange={e=>setQ(e.target.value)} style={{maxWidth:340}}/>
        <select value={fStatus} onChange={e=>setFStatus(e.target.value)} style={{width:"auto"}}>
          <option>Active</option><option>All</option>
          {STATUSES.map(s=><option key={s}>{s}</option>)}
        </select>
      </div>
      <div className="card">
        {filtered.length===0 && <div style={{padding:30,textAlign:"center",color:"var(--slate)",fontSize:13.5}}>No opportunities match. Add one to start building the board.</div>}
        {filtered.map(o=>{
          const d = daysTo(o.bidDue);
          return (
            <div key={o.id} className="opp" onClick={()=>openOpp(o.id)}>
              <TintPane score={o.score?.total ?? null}/>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontWeight:700,fontSize:14.5,marginBottom:3}}>{o.name}</div>
                <div style={{fontSize:12.5,color:"var(--slate)",display:"flex",gap:12,flexWrap:"wrap"}}>
                  <span><MapPin size={12} style={{verticalAlign:-1.5}}/> {o.city}, {o.state}</span>
                  {o.owner && <span>{o.owner}</span>}
                  {o.gc && <span>GC: {o.gc}</span>}
                </div>
                <div style={{marginTop:6,display:"flex",gap:6,flexWrap:"wrap"}}>
                  <StatusTag s={o.status}/>
                  {o.filmTypes.slice(0,3).map(t=><span key={t} className="tag" style={{background:"#EDF2F9",color:"var(--slate)"}}>{t}</span>)}
                </div>
              </div>
              <div style={{textAlign:"right",flexShrink:0}}>
                {o.bidDue && <div className="mono" style={{fontSize:12.5,fontWeight:600,color:d!==null&&d<=7?"var(--bad)":"var(--navy)"}}>{d<0?"past due":d+"d left"}</div>}
                {o.value && <div style={{fontSize:12,color:"var(--slate)"}}>{fmt$(o.value)}</div>}
                <ChevronRight size={16} style={{color:"var(--slate)",marginTop:4}}/>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ============ BLUEPRINT COPILOT ============ */
const QUICK_PROMPTS = [
  "List every glazing type in the project",
  "Where is window film or security film specified?",
  "Estimate total glazing square footage with your math",
  "Show every sheet or spec section mentioning glazing or film",
  "Which elevations have the most glazing?",
  "Generate a takeoff summary with a 10% waste factor"
];

function Copilot(){
  const [doc,setDoc] = useState(null); // {name,size,base64,media}
  const [msgs,setMsgs] = useState([]);
  const [input,setInput] = useState("");
  const [busy,setBusy] = useState(false);
  const [uploading,setUploading] = useState(false);
  const [err,setErr] = useState("");
  const fileRef = useRef();
  const scrollRef = useRef();

  useEffect(()=>{
    const el = scrollRef.current;
    if(el && typeof el.scrollTo === "function") el.scrollTo({top:el.scrollHeight,behavior:"smooth"});
    else if(el) el.scrollTop = el.scrollHeight;
  },[msgs,busy]);

  const onFile = async e => {
    const f = e.target.files?.[0]; if(!f) return;
    setErr("");
    if(f.size > 28*1024*1024){ setErr("That file is over ~28 MB. Split the drawing set (most PDF tools can extract the architectural sheets) and upload the relevant portion."); return; }
    const isPdf = f.type==="application/pdf" || f.name.toLowerCase().endsWith(".pdf");
    const isImg = /^image\//.test(f.type);
    if(!isPdf && !isImg){ setErr("Upload a PDF drawing set / spec, or an image of a sheet."); return; }
    try{
      setUploading(true);
      const fd = new FormData(); fd.append("file", f);
      const res = await fetch("/api/blueprint/upload", {method:"POST", body:fd});
      const data = await res.json();
      if(!res.ok) throw new Error(data.error || "Upload failed");
      setDoc({name:f.name, size:f.size, docId:data.docId});
      setMsgs([]);
    }catch(ex){ setErr(ex.message); }
    setUploading(false);
    e.target.value = "";
  };

  const ask = async (question) => {
    if(!doc || !question.trim() || busy) return;
    setErr(""); setBusy(true);
    const newMsgs = [...msgs, {role:"user", text:question}];
    setMsgs(newMsgs); setInput("");
    try{
      const r = await api("/ai/blueprint", {method:"POST", body:{docId:doc.docId, messages:newMsgs.map(m=>({role:m.role, text:m.text}))}});
      setMsgs(p=>[...p,{role:"ai",text:r.text}]);
    }catch(e){
      setErr("Analysis failed: "+e.message);
      setMsgs(msgs);
    }
    setBusy(false);
  };

  return (
    <div style={{display:"flex",flexDirection:"column",height:"calc(100vh - 52px)",maxHeight:"calc(100vh - 52px)"}}>
      <div className="pagehead" style={{marginBottom:12}}>
        <div><h1>Blueprint Copilot</h1><p>Upload a drawing set or spec — ask anything, get cited answers</p></div>
        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          {doc && <span className="tag" style={{background:"#E7F5EE",color:"var(--good)",maxWidth:220,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}><CheckCircle2 size={12} style={{marginRight:5,flexShrink:0}}/>{doc.name}</span>}
          <button className="btn dark" disabled={uploading} onClick={()=>fileRef.current.click()}>{uploading?<Loader2 size={15} style={{animation:"spin 1s linear infinite"}}/>:<Upload size={15}/>}{uploading?"Uploading…":doc?"Replace file":"Upload plans"}</button>
          <input ref={fileRef} type="file" accept="application/pdf,image/*" onChange={onFile} style={{display:"none"}}/>
        </div>
      </div>
      {err && <p style={{color:"var(--bad)",fontSize:13,margin:"0 0 10px"}}><AlertTriangle size={14} style={{verticalAlign:-2}}/> {err}</p>}

      {!doc ? (
        <Empty icon={FileSearch} title="Drop in a drawing set" body="PDF drawing sets, project manuals, spec books, addenda, or a photo of a single sheet. The copilot finds glazing systems, film specs, and square footage — and cites the sheets behind every answer.">
          <button className="btn pri" onClick={()=>fileRef.current.click()}><Upload size={15}/>Upload plans</button>
          <p style={{fontSize:12,color:"var(--slate)",marginTop:12}}>Tip: for huge plan books, extract just the architectural (A-series) sheets and Division 08 specs first — faster and sharper answers.</p>
        </Empty>
      ) : (
        <>
          <div ref={scrollRef} className="card" style={{flex:1,overflowY:"auto",padding:16,display:"flex",flexDirection:"column",gap:12,background:"#EEF3FA"}}>
            {msgs.length===0 && (
              <div style={{textAlign:"center",margin:"auto",color:"var(--slate)"}}>
                <Sparkles size={22} style={{color:"var(--azure)"}}/>
                <p style={{fontSize:13.5}}>Plans loaded. Ask a question or pick a starting point below.</p>
              </div>
            )}
            {msgs.map((m,i)=><div key={i} className={"msg "+(m.role==="user"?"user":"ai")}>{m.text}</div>)}
            {busy && <div className="msg ai" style={{display:"flex",alignItems:"center",gap:8,color:"var(--slate)"}}><Loader2 size={15} style={{animation:"spin 1s linear infinite"}}/>Reading the drawings…</div>}
          </div>
          <div style={{display:"flex",gap:6,flexWrap:"wrap",margin:"10px 0"}}>
            {QUICK_PROMPTS.map(p=><button key={p} className="chip" disabled={busy} onClick={()=>ask(p)}>{p}</button>)}
          </div>
          <div style={{display:"flex",gap:8}}>
            <input value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>e.key==="Enter"&&ask(input)}
              placeholder='Ask the plans — "How many sq ft of glazing on Level 2?"'/>
            <button className="btn pri" disabled={busy||!input.trim()} onClick={()=>ask(input)} aria-label="Send"><Send size={16}/></button>
          </div>
        </>
      )}
    </div>
  );
}



function LeadTester(){
  const [text,setText] = useState("");
  const [r,setR] = useState(null);
  const [busy,setBusy] = useState(false);
  const [err,setErr] = useState("");

  const SAMPLES = [
    "Window Tinting Services for County Facilities",
    "Furnish and install security window film, Highway Patrol HQ",
    "IFB 26-14 Solar Control Film Installation, City Hall",
    "Decorative frosted film for conference room glass partitions",
    "Anti-graffiti film for transit shelters",
    "Replace Windows & Tuckpoint, Fletcher Daniels State Office Building",
    "Furnish and install window blinds, district office",
    "Annual window cleaning services",
    "Microsoft Windows Server license renewal"
  ];

  const check = async (t)=>{
    const v = (t ?? text).trim();
    if(!v){ setErr("Type or pick a bid title first."); return; }
    setBusy(true); setErr(""); setText(v);
    try{ setR(await api2("/relevance/check", {method:"POST", body:{text:v}})); }
    catch(e){ setErr(e.message); }
    setBusy(false);
  };

  const color = rel => rel==="high" ? "var(--good)" : rel==="medium" ? "var(--warn)" : "var(--bad)";

  return (
    <div className="card" style={{padding:18,marginBottom:14}}>
      <h3 style={{margin:"0 0 6px",fontSize:15}}>Test the lead filter</h3>
      <p style={{fontSize:12.5,color:"var(--slate)",margin:"0 0 12px"}}>
        Paste any bid title — real or made up — and see exactly how the scanner grades it and which tab it lands in.
        Use this to check the filter without waiting for a real film bid, or to find out why something didn't show up.
      </p>
      <div style={{display:"flex",gap:8,marginBottom:10}}>
        <input value={text} onChange={e=>setText(e.target.value)} onKeyDown={e=>e.key==="Enter"&&check()}
          placeholder="e.g. Window Tinting Services for County Facilities"/>
        <button className="btn pri" disabled={busy} onClick={()=>check()}>
          {busy ? <Loader2 size={16} style={{animation:"spin 1s linear infinite"}}/> : <Sparkles size={16}/>}
        </button>
      </div>
      <div style={{display:"flex",gap:5,flexWrap:"wrap",marginBottom:10}}>
        {SAMPLES.map(s=>(
          <button key={s} className="chip" style={{fontSize:11,padding:"5px 9px"}} onClick={()=>check(s)}>
            {s.length>34 ? s.slice(0,34)+"…" : s}
          </button>
        ))}
      </div>
      {err && <p style={{color:"var(--bad)",fontSize:13}}>{err}</p>}
      {r && (
        <div style={{border:"1px solid var(--line)",borderRadius:10,padding:13,marginTop:4}}>
          <div style={{fontSize:12.5,color:"var(--slate)",marginBottom:8,fontStyle:"italic"}}>"{r.input}"</div>
          <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap",marginBottom:8}}>
            <span className="tag" style={{background:color(r.relevance)+"1A",color:color(r.relevance)}}>
              {r.wouldAppear ? r.tab : "Filtered out"}
            </span>
            <span className="mono" style={{fontSize:12,color:"var(--slate)"}}>score {r.score}</span>
            {r.filmTypes?.map(t=><span key={t} className="tag" style={{background:"#E7F5EE",color:"var(--good)",fontSize:10}}>{t}</span>)}
          </div>
          <p style={{fontSize:13.5,margin:"0 0 6px"}}>{r.explanation}</p>
          {r.reasons?.length>0 && (
            <div style={{fontSize:12,color:"var(--azure)"}}>{r.reasons.join(" · ")}</div>
          )}
        </div>
      )}
    </div>
  );
}

/* ============ DISCOVERY ENGINE ============ */
function Discovery({onImported}){
  const [leads,setLeads] = useState(null);
  const [scanning,setScanning] = useState(false);
  const [msg,setMsg] = useState("");
  const [sources,setSources] = useState(null);
  const [filter,setFilter] = useState("high");   // film work first — glass is the upsell, not the job
  const [typeFilter,setTypeFilter] = useState(null);
  const [err,setErr] = useState("");

  const load = ()=>api("/discovery/leads")
    .then(r=>setLeads(Array.isArray(r)?r:[]))
    .catch(e=>{setErr(e.message);setLeads([]);});
  useEffect(()=>{ load(); },[]);

  const scan = async ()=>{
    setScanning(true); setErr(""); setMsg("");
    try{
      const r = await api("/discovery/run", {method:"POST"});
      setLeads(Array.isArray(r?.leads)?r.leads:[]);
      setSources(Array.isArray(r?.sources)?r.sources:null);
      const ok = r.sources.filter(s=>s.status==="ok").length;
      setMsg(`Scan complete — ${ok}/${r.sources.length} sources responded, ${r.new} new leads.`);
    }catch(e){ setErr("Scan failed: " + e.message); }
    setScanning(false);
  };

  const importLead = async (lead)=>{
    try{
      const opp = await api("/discovery/import/" + lead.id, {method:"POST"});
      setLeads(p=>p.filter(l=>l.id!==lead.id));
      onImported(opp);
    }catch(e){ setErr(e.message); }
  };
  const dismiss = async (lead)=>{
    try{ await api("/discovery/leads/" + lead.id, {method:"DELETE"}); setLeads(p=>p.filter(l=>l.id!==lead.id)); }
    catch(e){ setErr(e.message); }
  };

  return (
    <div>
      <div className="pagehead">
        <div><h1>Discovery Engine</h1><p>Scans public procurement sources for projects that may need film — runs automatically every morning at 6:30</p></div>
        <button className="btn pri" disabled={scanning} onClick={scan}>
          {scanning? <Loader2 size={15} style={{animation:"spin 1s linear infinite"}}/> : <Rss size={15}/>}
          {scanning? "Scanning…" : "Scan now"}
        </button>
      </div>
      {leads && (()=> {
        const filmLeads = leads.filter(l=>l.relevance==="high");
        const glassLeads = leads.filter(l=>l.relevance!=="high");
        const types = [...new Set(filmLeads.flatMap(l=>l.filmTypes||[]))].sort();
        return (
          <div style={{marginBottom:12}}>
            <div style={{display:"flex",gap:6,flexWrap:"wrap",alignItems:"center",marginBottom:types.length?8:0}}>
              <button className="chip" onClick={()=>{setFilter("high");setTypeFilter(null);}}
                style={filter==="high"?{background:"var(--good)",color:"#fff",borderColor:"var(--good)"}:{}}>
                Film &amp; tinting ({filmLeads.length})
              </button>
              <button className="chip" onClick={()=>{setFilter("glass");setTypeFilter(null);}}
                style={filter==="glass"?{background:"var(--warn)",color:"#fff",borderColor:"var(--warn)"}:{}}>
                Glazing upsell ({glassLeads.length})
              </button>
              <button className="chip" onClick={()=>{setFilter("all");setTypeFilter(null);}}
                style={filter==="all"?{background:"var(--azure)",color:"#fff",borderColor:"var(--azure)"}:{}}>
                All ({leads.length})
              </button>
            </div>
            {filter==="high" && types.length>0 && (
              <div style={{display:"flex",gap:5,flexWrap:"wrap",alignItems:"center"}}>
                <span style={{fontSize:11,fontWeight:700,letterSpacing:".06em",textTransform:"uppercase",color:"var(--slate)"}}>Scope</span>
                {types.map(t=>(
                  <button key={t} className="chip" style={{padding:"5px 10px",fontSize:11.5,
                    ...(typeFilter===t?{background:"var(--navy)",color:"#fff",borderColor:"var(--navy)"}:{})}}
                    onClick={()=>setTypeFilter(typeFilter===t?null:t)}>{t}</button>
                ))}
              </div>
            )}
          </div>
        );
      })()}
      {msg && <p style={{color:"var(--good)",fontSize:13.5,margin:"0 0 12px"}}><CheckCircle2 size={14} style={{verticalAlign:-2}}/> {msg}</p>}
      {err && <p style={{color:"var(--bad)",fontSize:13.5,margin:"0 0 12px"}}><AlertTriangle size={14} style={{verticalAlign:-2}}/> {err}</p>}
      {leads===null && <p style={{color:"var(--slate)",fontSize:13.5}}>Loading…</p>}
      {leads && leads.length>0 && filter==="high" && leads.filter(l=>l.relevance==="high").length===0 && (
        <div className="card" style={{padding:22,textAlign:"center"}}>
          <p style={{fontSize:13.5,margin:"0 0 6px"}}>No film or tinting jobs on the board right now.</p>
          <p style={{fontSize:12.5,color:"var(--slate)",margin:0}}>
            Film-specific bids are genuinely rare on public boards — most weeks there are none. The
            <b> Glazing upsell</b> tab has {leads.filter(l=>l.relevance!=="high").length} window and glazing job(s)
            where film can be pitched as an add-on or value-engineering alternative.
          </p>
        </div>
      )}
      {leads && leads.length===0 && (
        <Empty icon={Rss} title="No pending leads" body="Run a scan to pull the current Missouri FMDC bid board, filtered to window, glazing, and renovation projects. Imported leads move to Opportunities; dismissed ones stay hidden.">
          <button className="btn pri" disabled={scanning} onClick={scan}><Rss size={15}/>Scan now</button>
        </Empty>
      )}
      {leads && leads.length>0 && (
        <div className="card">
          {leads
            .filter(l => filter==="all" ? true : filter==="glass" ? l.relevance!=="high" : l.relevance==="high")
            .filter(l => !typeFilter || (l.filmTypes||[]).includes(typeFilter))
            .map(l=>(
            <div key={l.id} className="opp" style={{cursor:"default"}}>
              <span className="tag" style={{background:l.relevance==="high"?"#E7F5EE":"#FDF3E4",color:l.relevance==="high"?"var(--good)":"var(--warn)",flexShrink:0}}>{l.relevance}</span>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontWeight:700,fontSize:14}}>
                  {(l.links&&(l.links.page||l.links.ifb))
                    ? <a href={l.links.page||l.links.ifb} target="_blank" rel="noreferrer" style={{color:"var(--navy)",textDecoration:"underline",textDecorationColor:"var(--azure2)"}}>{l.title}</a>
                    : l.title}
                </div>
                <div style={{fontSize:12.5,color:"var(--slate)",marginTop:3,display:"flex",gap:12,flexWrap:"wrap"}}>
                  <span className="mono">{l.projectNo}</span>
                  {l.bidDate && <span className="mono">bids {l.bidDate}</span>}
                  <span>{l.source}</span>
                  {!l.stillOpen && <span style={{color:"var(--warn)"}}>likely awarded/closed</span>}
                </div>
                {l.filmTypes?.length>0 && (
                  <div style={{display:"flex",gap:4,flexWrap:"wrap",marginTop:5}}>
                    {l.filmTypes.map(t=><span key={t} className="tag" style={{background:"#E7F5EE",color:"var(--good)",fontSize:10}}>{t}</span>)}
                  </div>
                )}
                {l.matchReasons?.length>0 && (
                  <div style={{fontSize:11.5,color:"var(--azure)",marginTop:4}}>
                    {l.matchReasons.slice(0,2).join(" · ")}
                  </div>
                )}
              </div>
              <div style={{display:"flex",gap:6,flexShrink:0}}>
                <button className="btn pri" style={{padding:"8px 12px"}} onClick={()=>importLead(l)}><Plus size={14}/>Import</button>
                <button className="btn ghost" style={{padding:"8px 10px"}} onClick={()=>dismiss(l)} aria-label="Dismiss"><X size={14}/></button>
              </div>
            </div>
          ))}
        </div>
      )}

      <details className="disclose">
        <summary>How Discovery works, and test the filter</summary>
        <p style={{fontSize:12.5,color:"var(--slate)",margin:"6px 0 14px"}}>21 sources: SAM.gov federal API, Missouri FMDC + MissouriBUYS, Kansas state, Jackson/Johnson/Wyandotte counties, 16th Circuit, KCMO + Independence, Lee's Summit, Overland Park, Olathe, and Lenexa city halls, 4 school districts, KCI, KU Med, and KU. Graded for YOUR scope: "Film & tinting" means the posting actually names film or tinting work — those are your jobs. "Glazing upsell" is window and glass work where film can be pitched as an add-on. Blinds, shades, window cleaning, auto glass, and unrelated trades are filtered out automatically. Nothing bypasses logins or terms of service.</p>
        {sources && (
          <div className="card" style={{padding:14,marginBottom:14}}>
            <div style={{fontSize:12,fontWeight:700,letterSpacing:".07em",textTransform:"uppercase",color:"var(--slate)",marginBottom:8}}>Source status — last scan</div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(240px,1fr))",gap:"6px 14px"}}>
              {sources.map(s=>(
                <div key={s.id} style={{display:"flex",alignItems:"center",gap:7,fontSize:12.5}} title={s.error||""}>
                  <span style={{width:8,height:8,borderRadius:99,flexShrink:0,background:s.status==="ok"?"var(--good)":s.status==="skipped"?"#9AA7B8":s.status==="js-portal"?"var(--warn)":"var(--bad)"}}/>
                  <span style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{s.name}</span>
                  <span className="mono" style={{marginLeft:"auto",color:"var(--slate)"}}>{s.status==="ok"?s.found:s.status==="js-portal"?"JS":s.status==="skipped"?"–":"err"}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        <LeadTester/>
      </details>
    </div>
  );
}



/* ============ EARLY OPPORTUNITIES (V2 Phase 9) ============ */
function EarlyOpportunities({onTracked}){
  const [text,setText] = useState("");
  const [miles,setMiles] = useState("");
  const [a,setA] = useState(null);
  const [busy,setBusy] = useState(false);
  const [err,setErr] = useState("");
  const [tracked,setTracked] = useState(null);
  const [name,setName] = useState("");
  const [owner,setOwner] = useState("");
  const [architect,setArchitect] = useState("");
  const [list,setList] = useState([]);

  const load = ()=>api2("/early").then(r=>setList(Array.isArray(r?.projects)?r.projects:[])).catch(()=>setList([]));
  useEffect(()=>{ load(); },[]);

  const assess = async ()=>{
    if(text.trim().length<10){ setErr("Paste a bit more text — a sentence or two from the announcement."); return; }
    setBusy(true); setErr(""); setTracked(null);
    try{
      const r = await api2("/early/assess", {method:"POST", body:{
        text, distanceMiles: miles?Number(miles):null,
        hasArchitect: Boolean(architect), hasOwner: Boolean(owner)
      }});
      setA(r);
      if(!name) setName(text.split(/[.\n]/)[0].slice(0,90));
    }catch(e){ setErr(e.message); }
    setBusy(false);
  };

  const track = async ()=>{
    setBusy(true); setErr("");
    try{
      const r = await api2("/early/track", {method:"POST", body:{
        name, text, owner, architect, distanceMiles: miles?Number(miles):null
      }});
      setTracked(r); setA(null); setText(""); setName(""); setOwner(""); setArchitect("");
      load(); onTracked && onTracked();
    }catch(e){ setErr(e.message); }
    setBusy(false);
  };

  const stageColor = s => ({Planning:"#7A5FD0",Design:"var(--good)",Permitting:"var(--azure)",
    ["Pre-Bid"]:"var(--warn)",Bidding:"var(--slate)"}[s] || "var(--slate)");

  return (
    <div>
      <div className="pagehead">
        <div>
          <h1>Early Opportunities</h1>
          <p>Find projects while film can still be written into the spec — before they bid</p>
        </div>
      </div>

      <div className="card" style={{padding:18,marginBottom:14}}>
        <p style={{fontSize:13,color:"var(--slate)",margin:"0 0 12px"}}>
          Paste anything about an upcoming project — a planning commission agenda item, a permit record, a development
          announcement, a news story. It'll tell you how early it is, how much film might be involved, and who to call.
        </p>
        <Field label="Project announcement or agenda text">
          <textarea rows={4} value={text} onChange={e=>setText(e.target.value)}
            placeholder="e.g. Planning commission to review site plan for a proposed 240,000 square foot class A office tower in Overland Park"/>
        </Field>
        <div className="grid2" style={{gridTemplateColumns:"repeat(3,1fr)",gap:10,marginTop:10}}>
          <Field label="Miles from Belton"><input type="number" value={miles} onChange={e=>setMiles(e.target.value)}/></Field>
          <Field label="Owner / developer"><input value={owner} onChange={e=>setOwner(e.target.value)}/></Field>
          <Field label="Architect (if known)"><input value={architect} onChange={e=>setArchitect(e.target.value)}/></Field>
        </div>
        <button className="btn pri" style={{marginTop:12}} disabled={busy} onClick={assess}>
          {busy ? <Loader2 size={15} style={{animation:"spin 1s linear infinite"}}/> : <Sparkles size={15}/>}Assess it
        </button>
        {err && <p style={{color:"var(--bad)",fontSize:13,marginTop:8}}><AlertTriangle size={14} style={{verticalAlign:-2}}/> {err}</p>}
      </div>

      {tracked && (
        <p style={{fontSize:13,color:"var(--good)",marginBottom:14}}>
          <CheckCircle2 size={14} style={{verticalAlign:-2}}/> Tracking it — find it under Opportunities.
        </p>
      )}

      {a && (
        <div className="card" style={{padding:18,marginBottom:14}}>
          <div style={{display:"flex",gap:14,alignItems:"center",flexWrap:"wrap",marginBottom:14}}>
            <TintPane score={a.score}/>
            <div>
              <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
                <span className="tag" style={{background:stageColor(a.stage)+"1A",color:stageColor(a.stage)}}>{a.stage}</span>
                {a.early && <span className="tag" style={{background:"#E7F5EE",color:"var(--good)"}}>still influenceable</span>}
              </div>
              <div style={{fontSize:13,color:"var(--slate)",marginTop:5}}>
                {a.buildingType}{a.buildingSf ? ` · ${a.buildingSf.toLocaleString()} SF building` : " · size not stated"}
              </div>
            </div>
          </div>

          <div style={{background:"#F2F7FD",borderRadius:10,padding:"12px 14px",marginBottom:12}}>
            <div style={{fontSize:11,fontWeight:700,letterSpacing:".06em",textTransform:"uppercase",color:"var(--slate)",marginBottom:5}}>Film potential</div>
            {a.potential.valueLow!=null ? (
              <>
                <div className="mono" style={{fontSize:18,fontWeight:700}}>
                  {fmt$(a.potential.valueLow)} – {fmt$(a.potential.valueHigh)}
                </div>
                <div style={{fontSize:12,color:"var(--slate)",marginTop:3}}>
                  {a.potential.glazingSfLow.toLocaleString()}–{a.potential.glazingSfHigh.toLocaleString()} SF glazing
                </div>
              </>
            ) : <div style={{fontSize:13.5,fontWeight:600}}>Unknown</div>}
            <p style={{fontSize:11.5,color:"var(--slate)",margin:"6px 0 0"}}>{a.potential.note}</p>
          </div>

          <div style={{fontSize:13.5,lineHeight:1.6,marginBottom:12}}>
            <b>Next action:</b> {a.nextAction}
          </div>

          {a.unknowns?.length>0 && (
            <p style={{fontSize:12.5,color:"var(--warn)",background:"#FDF3E4",padding:"9px 12px",borderRadius:9}}>
              <AlertTriangle size={13} style={{verticalAlign:-2}}/> {a.unknowns.join(" ")}
            </p>
          )}

          <div style={{display:"flex",gap:8,alignItems:"flex-end",flexWrap:"wrap",marginTop:12}}>
            <div style={{flex:1,minWidth:200}}><Field label="Save as"><input value={name} onChange={e=>setName(e.target.value)}/></Field></div>
            <button className="btn pri" disabled={busy||!name.trim()} onClick={track}><Plus size={15}/>Track this project</button>
          </div>
        </div>
      )}

      {list.length>0 && (
        <>
          <h3 style={{fontSize:15,margin:"18px 0 10px"}}>Tracked early projects ({list.length})</h3>
          <div className="card">
            {list.map(p=>{
              let sc=null; try{ sc=JSON.parse(p.score_json||"{}").total; }catch{}
              return (
                <div key={p.id} className="opp" style={{cursor:"default"}}>
                  <TintPane score={sc ?? null}/>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontWeight:700,fontSize:14}}>{p.name}</div>
                    <div style={{fontSize:12.5,color:"var(--slate)",marginTop:3,display:"flex",gap:10,flexWrap:"wrap"}}>
                      <span className="tag" style={{background:stageColor(p.stage)+"1A",color:stageColor(p.stage)}}>{p.stage}</span>
                      {p.project_type && <span>{p.project_type}</span>}
                      {p.building_square_feet>0 && <span className="mono">{Number(p.building_square_feet).toLocaleString()} SF</span>}
                      {p.estimated_project_value>0 && <span>{fmt$(p.estimated_project_value)}+ potential</span>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

/* ============ GLOBAL SEARCH (V2 Phase 6) ============ */
function GlobalSearch({openOpp}){
  const [q,setQ] = useState("");
  const [res,setRes] = useState(null);
  const [busy,setBusy] = useState(false);
  const [err,setErr] = useState("");

  const run = async (term)=>{
    const t = (term ?? q).trim();
    if(t.length<2){ setErr("Type at least 2 characters."); return; }
    setBusy(true); setErr(""); 
    try{ setRes(await api2("/search?q=" + encodeURIComponent(t))); }
    catch(e){ setErr(e.message); }
    setBusy(false);
  };

  const COLORS = {Project:"var(--azure)",Company:"#7A5FD0",["Film scope"]:"var(--good)",
    Sheet:"var(--slate)",RFI:"var(--warn)",Contact:"var(--navy)"};

  return (
    <div>
      <div className="pagehead">
        <div><h1>Search</h1><p>Projects, companies, film scope, sheets, RFIs, and contacts</p></div>
      </div>
      <div style={{display:"flex",gap:8,marginBottom:14}}>
        <input value={q} onChange={e=>setQ(e.target.value)} onKeyDown={e=>e.key==="Enter"&&run()}
          placeholder='Try "08 87 13", "A-700", "JE Dunn", "security film", "Overland Park"'/>
        <button className="btn pri" onClick={()=>run()} disabled={busy}>
          {busy? <Loader2 size={16} style={{animation:"spin 1s linear infinite"}}/> : <FileSearch size={16}/>}
        </button>
      </div>
      <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:14}}>
        {["security film","08 87 13","curtain wall","JE Dunn"].map(s=>(
          <button key={s} className="chip" onClick={()=>{setQ(s);run(s);}}>{s}</button>
        ))}
      </div>
      {err && <p style={{color:"var(--bad)",fontSize:13}}><AlertTriangle size={14} style={{verticalAlign:-2}}/> {err}</p>}
      {res && res.count===0 && (
        <div className="card" style={{padding:24,textAlign:"center",color:"var(--slate)",fontSize:13.5}}>
          Nothing matched "{res.query}". Sheets only become searchable after you run Analyze on a document.
        </div>
      )}
      {res && res.count>0 && (
        <div className="card">
          <div style={{padding:"10px 16px",fontSize:12,color:"var(--slate)",borderBottom:"1px solid var(--line)"}}>
            {res.count} result{res.count===1?"":"s"} for "{res.query}"
          </div>
          {res.results.map((r,i)=>(
            <div key={i} className="opp" onClick={()=>r.projectId && openOpp(r.projectId)}
              style={{cursor:r.projectId?"pointer":"default",padding:"12px 16px"}}>
              <span className="tag" style={{background:(COLORS[r.typeLabel]||"var(--slate)")+"1A",color:COLORS[r.typeLabel]||"var(--slate)",flexShrink:0}}>{r.typeLabel}</span>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontWeight:600,fontSize:13.5}}>{r.title}</div>
                {r.subtitle && <div style={{fontSize:12,color:"var(--slate)",marginTop:2}}>{r.subtitle}</div>}
              </div>
              {r.projectId && <ChevronRight size={15} style={{color:"var(--slate)",flexShrink:0}}/>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}


function DigestPanel(){
  const [d,setD] = useState(null);
  const [err,setErr] = useState("");
  const [sending,setSending] = useState(false);
  const [sent,setSent] = useState(null);
  const [show,setShow] = useState(false);

  useEffect(()=>{ api2("/digest").then(setD).catch(e=>setErr(e.message)); },[]);

  const send = async ()=>{
    setSending(true); setSent(null); setErr("");
    try{
      const r = await api2("/digest/send", {method:"POST", body:{}});
      setSent(r);
    }catch(e){ setErr(e.message); }
    setSending(false);
  };

  return (
    <div className="card" style={{padding:18,marginBottom:14}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:8,flexWrap:"wrap",marginBottom:10}}>
        <h3 style={{margin:0,fontSize:15}}>Morning brief</h3>
        {d && (
          <span className="tag" style={{background:d.emailConfigured?"#E7F5EE":"#FDF3E4",color:d.emailConfigured?"var(--good)":"var(--warn)"}}>
            {d.emailConfigured ? "emailing " + d.to : "email not set up"}
          </span>
        )}
      </div>
      {err && <p style={{color:"var(--bad)",fontSize:13}}><AlertTriangle size={14} style={{verticalAlign:-2}}/> {err}</p>}
      {!d && !err && <p style={{fontSize:13,color:"var(--slate)"}}>Building preview…</p>}
      {d && !d.counts && (
        <p style={{fontSize:13,color:"var(--slate)"}}>Brief unavailable — deploy the latest version and refresh.</p>
      )}
      {d && d.counts && (
        <>
          <p style={{fontSize:13,margin:"0 0 10px"}}>
            <b>{d.subject}</b>
          </p>
          <div style={{display:"flex",gap:14,flexWrap:"wrap",fontSize:12.5,color:"var(--slate)",marginBottom:12}}>
            <span><b className="mono" style={{color:"var(--navy)"}}>{d.counts.newLeads}</b> new leads</span>
            <span><b className="mono" style={{color:"var(--navy)"}}>{d.counts.dueThisWeek}</b> due this week</span>
            <span><b className="mono" style={{color:"var(--navy)"}}>{d.counts.preBids}</b> pre-bids</span>
            <span><b className="mono" style={{color:"var(--navy)"}}>{d.counts.pastDue}</b> past due</span>
          </div>
          {d.actions?.length>0 && (
            <div style={{marginBottom:12}}>
              {d.actions.slice(0,4).map((a,i)=>(
                <div key={i} style={{fontSize:13,padding:"5px 0",color:a.urgency==="high"?"var(--bad)":"var(--navy)",fontWeight:a.urgency==="high"?600:400}}>
                  {a.urgency==="high" ? "! " : "· "}{a.text}
                </div>
              ))}
            </div>
          )}
          <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
            <button className="btn ghost" onClick={()=>setShow(s=>!s)}>
              <FileText size={15}/>{show?"Hide":"Preview"} full brief
            </button>
            <button className="btn pri" disabled={sending} onClick={send}>
              {sending ? <Loader2 size={15} style={{animation:"spin 1s linear infinite"}}/> : <Send size={15}/>}Send it to me now
            </button>
          </div>
          {sent && (
            <p style={{fontSize:12.5,marginTop:10,color:sent.sent?"var(--good)":"var(--warn)"}}>
              {sent.sent
                ? <><CheckCircle2 size={13} style={{verticalAlign:-2}}/> Sent to {sent.to}</>
                : <><AlertTriangle size={13} style={{verticalAlign:-2}}/> {sent.reason}</>}
            </p>
          )}
          {show && (
            <pre className="mono" style={{marginTop:12,background:"#F2F7FD",padding:"12px 14px",borderRadius:10,
              fontSize:11.5,lineHeight:1.6,whiteSpace:"pre-wrap",overflowWrap:"anywhere",maxHeight:340,overflowY:"auto"}}>{d.text}</pre>
          )}
          <p style={{fontSize:11.5,color:"var(--slate)",marginTop:10}}>
            Sent automatically at 6:30 AM Central after the nightly scan, once RESEND_API_KEY and DIGEST_TO are set.
          </p>
        </>
      )}
    </div>
  );
}

/* ============ SYSTEM HEALTH (V2 Phase 6) ============ */
function BuildingConnectedPanel({connected, onSynced}){
  const [busy,setBusy] = useState(false);
  const [msg,setMsg] = useState(null);
  const sync = async ()=>{
    setBusy(true); setMsg(null);
    try{ const r = await api2("/integrations/buildingconnected/sync",{method:"POST"}); setMsg({ok:true,text:`${r.found} project(s) checked, ${r.added} new lead(s) added.`}); onSynced?.(); }
    catch(e){ setMsg({ok:false,text:e.message}); }
    setBusy(false);
  };
  return (
    <div className="card" style={{padding:18,marginBottom:14}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:8,flexWrap:"wrap",marginBottom:8}}>
        <h3 style={{margin:0,fontSize:15}}>BuildingConnected</h3>
        <span className="tag" style={{background:connected?"#E7F5EE":"#FDF3E4",color:connected?"var(--good)":"var(--warn)"}}>
          {connected?"connected":"not connected"}
        </span>
      </div>
      <p style={{fontSize:12.5,color:"var(--slate)",margin:"0 0 12px"}}>
        {connected
          ? "Pull the bid invitations on your BuildingConnected account into Discovery."
          : "Connect your Autodesk / BuildingConnected account once — a real login, not an API key — to pull your bid invitations into Discovery."}
      </p>
      <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
        {!connected && <a className="btn pri" href="/api/integrations/buildingconnected/connect"><Globe size={15}/>Connect BuildingConnected</a>}
        {connected && <button className="btn pri" disabled={busy} onClick={sync}>
          {busy?<Loader2 size={15} style={{animation:"spin 1s linear infinite"}}/>:<RefreshCw size={15}/>}Sync now
        </button>}
      </div>
      {msg && <p style={{fontSize:12.5,marginTop:10,color:msg.ok?"var(--good)":"var(--bad)"}}>{msg.text}</p>}
    </div>
  );
}

function SystemHealth(){
  const [h,setH] = useState(null);
  const [err,setErr] = useState("");
  const load = ()=>api2("/health").then(setH).catch(e=>setErr(e.message));
  useEffect(()=>{ load(); },[]);

  const color = s => s==="Healthy"?"var(--good)":s==="Error"?"var(--bad)":"var(--warn)";
  const dl = (path,name)=>{ const a=document.createElement("a"); a.href="/api/v2/export/"+path; a.download=name; a.click(); };

  return (
    <div>
      <div className="pagehead">
        <div><h1>System Health</h1><p>What's connected, what needs attention</p></div>
        <button className="btn ghost" onClick={load}><RefreshCw size={15}/>Refresh</button>
      </div>
      {err && <p style={{color:"var(--bad)",fontSize:13}}>{err}</p>}
      {!h && !err && <p style={{color:"var(--slate)",fontSize:13.5}}>Checking…</p>}
      {h && !Array.isArray(h.items) && (
        <div className="card" style={{padding:18}}>
          <p style={{fontSize:13.5,color:"var(--warn)"}}>
            <AlertTriangle size={14} style={{verticalAlign:-2}}/> Health data came back in an unexpected shape. Try Refresh, or check that the latest version is deployed.
          </p>
        </div>
      )}
      {h && Array.isArray(h.items) && (
        <>
          <div className="card" style={{padding:18,marginBottom:14}}>
            <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:14}}>
              <span style={{width:12,height:12,borderRadius:99,background:color(h.overall)}}/>
              <b style={{fontSize:15}}>{h.overall==="Healthy"?"All systems healthy":h.overall==="Error"?"Needs attention":"Mostly healthy"}</b>
              <span style={{marginLeft:"auto",fontSize:12.5,color:"var(--slate)"}} className="mono">{h.healthy}/{h.total}</span>
            </div>
            {h.items.map((it,i)=>(
              <div key={i} style={{display:"flex",gap:10,alignItems:"flex-start",padding:"9px 0",borderTop:i?"1px solid var(--line)":"none"}}>
                <span style={{width:8,height:8,borderRadius:99,background:color(it.status),marginTop:6,flexShrink:0}}/>
                <div style={{flex:1}}>
                  <div style={{fontSize:13.5,fontWeight:600}}>{it.name}</div>
                  <div style={{fontSize:12.5,color:"var(--slate)",marginTop:2,overflowWrap:"anywhere"}}>{it.detail}</div>
                </div>
                <span className="tag" style={{background:color(it.status)+"1A",color:color(it.status),flexShrink:0}}>{it.status}</span>
              </div>
            ))}
          </div>
          <DigestPanel/>
          <div className="card" style={{padding:18}}>
            <h3 style={{margin:"0 0 10px",fontSize:15}}>Export your data</h3>
            <p style={{fontSize:12.5,color:"var(--slate)",margin:"0 0 12px"}}>
              CSV opens in Excel or Google Sheets. Your data is yours — export any time.
            </p>
            <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
              <button className="btn ghost" onClick={()=>dl("projects","projects.csv")}><Download size={15}/>All projects</button>
              <button className="btn ghost" onClick={()=>dl("results","bid-results.csv")}><Download size={15}/>Bid results</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/* ============ INTEGRATIONS (source registry) ============ */
const REG_STATUS_COLOR = {
  integrated: "var(--good)", docs_confirmed: "var(--good)", covered_indirectly: "var(--good)",
  public_known: "var(--azure)", commercial_required: "var(--warn)", unverified: "#7A5FD0"
};
const REG_PHASE_LABEL = {1:"Phase 1 — priority sources",2:"Phase 2 — public data & government portals",3:"Phase 3 — platform APIs & indirect coverage"};

function IntegrationsView(){
  const [items,setItems] = useState(null);
  const [err,setErr] = useState("");
  const load = ()=>api2("/integrations").then(r=>setItems(r.items)).catch(e=>setErr(e.message));
  useEffect(()=>{ load(); },[]);

  const groups = items ? [1,2,3].map(p=>[p, items.filter(i=>i.phase===p)]) : [];

  return (
    <div>
      <div className="pagehead">
        <div><h1>Integrations</h1><p>Every construction data source assessed for Bid Hunter — what's live, what's a business decision, what's still unverified</p></div>
        <button className="btn ghost" onClick={load}><RefreshCw size={15}/>Refresh</button>
      </div>
      {err && <p style={{color:"var(--bad)",fontSize:13}}>{err}</p>}
      {!items && !err && <p style={{fontSize:13.5,color:"var(--slate)"}}>Loading…</p>}
      {groups.map(([phase,rows])=>(
        <div key={phase} style={{marginBottom:26}}>
          <h2 style={{fontSize:14,margin:"0 0 12px",color:"var(--slate)",textTransform:"uppercase",letterSpacing:".05em",fontWeight:700}}>{REG_PHASE_LABEL[phase]}</h2>
          {rows.map(s=>{
            const c = REG_STATUS_COLOR[s.status];
            return (
              <div key={s.id} className="card" style={{padding:16,marginBottom:10}}>
                <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap",marginBottom:8}}>
                  <b style={{fontSize:14.5}}>{s.name}</b>
                  <span className="tag" style={{background:c+"1A",color:c}}>{s.statusLabel}</span>
                  {s.live && (
                    <span className="tag" style={{marginLeft:"auto",background:s.live.connected?"#E7F5EE":"#EDF2F9",color:s.live.connected?"var(--good)":"var(--slate)"}}>
                      {s.live.detail}
                    </span>
                  )}
                </div>
                <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(160px,1fr))",gap:"4px 18px",fontSize:12.5,marginBottom:8}}>
                  <div><b style={{color:"var(--slate)",fontWeight:600}}>Auth: </b>{s.auth}</div>
                  <div><b style={{color:"var(--slate)",fontWeight:600}}>Access: </b>{s.access}</div>
                </div>
                <p style={{fontSize:12.5,color:"var(--slate)",margin:0,borderTop:"1px solid var(--line)",paddingTop:8}}>{s.note}</p>
                {s.id==="buildingconnected" && <div style={{marginTop:12}}><BuildingConnectedPanel connected={Boolean(s.live?.connected)} onSynced={load}/></div>}
                {s.id==="bluebook" && !s.live?.connected && (
                  <p className="mono" style={{fontSize:11.5,color:"var(--azure)",marginTop:10,overflowWrap:"anywhere"}}>
                    Register as webhook callback: /api/ingest/bluebook?token=YOUR_APP_PASSWORD
                  </p>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

/* ============ CONTRACTORS ============ */
function Contractors({gcs,setGcs}){
  const [open,setOpen] = useState(null);
  const upd = (id,patch)=>setGcs(p=>p.map(g=>g.id===id?{...g,...patch}:g));
  return (
    <div>
      <div className="pagehead">
        <div><h1>Contractor Intelligence</h1><p>KC-metro GCs — portals, contacts, and relationship strength</p></div>
        <button className="btn pri" onClick={()=>setGcs(p=>[{id:uid(),name:"New contractor",hq:"",markets:"",portal:"",phone:"",email:"",rel:0,notes:"",contacts:[]},...p])}><Plus size={16}/>Add contractor</button>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(300px,1fr))",gap:12}}>
        {gcs.map(g=>(
          <div key={g.id} className="card" style={{padding:16}}>
            <div style={{display:"flex",justifyContent:"space-between",gap:8,alignItems:"flex-start"}}>
              <div>
                <div style={{fontFamily:"Archivo",fontWeight:700,fontSize:15}}>{g.name}</div>
                <div style={{fontSize:12,color:"var(--slate)",marginTop:2}}>{g.hq}</div>
              </div>
              <button className="btn ghost" style={{padding:"6px 9px"}} onClick={()=>setOpen(open===g.id?null:g.id)} aria-label="Edit contractor"><Pencil size={13}/></button>
            </div>
            <div style={{fontSize:12.5,color:"var(--slate)",margin:"8px 0"}}>{g.markets}</div>
            <div style={{display:"flex",gap:3,margin:"6px 0 10px"}} title="Relationship strength">
              {[1,2,3,4,5].map(n=>(
                <button key={n} onClick={()=>upd(g.id,{rel:n===g.rel?0:n})} aria-label={`Set relationship ${n} of 5`}
                  style={{width:22,height:8,borderRadius:4,border:0,cursor:"pointer",background:n<=g.rel?"var(--azure)":"#E2E9F3"}}/>
              ))}
              <span style={{fontSize:11,color:"var(--slate)",marginLeft:6}}>relationship</span>
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:4,fontSize:12.5}}>
              {g.phone && <span><Phone size={12} style={{verticalAlign:-1.5,color:"var(--azure)"}}/> {g.phone}</span>}
              {g.email && <span><Mail size={12} style={{verticalAlign:-1.5,color:"var(--azure)"}}/> {g.email}</span>}
              {g.portal && <a href={g.portal} target="_blank" rel="noreferrer" style={{color:"var(--azure)",fontWeight:600,textDecoration:"none"}}><Globe size={12} style={{verticalAlign:-1.5}}/> Sub portal</a>}
            </div>
            {g.notes && <p style={{fontSize:12.5,background:"#F2F7FD",borderRadius:8,padding:"8px 10px",margin:"10px 0 0"}}>{g.notes}</p>}
            {open===g.id && (
              <div style={{marginTop:12,display:"grid",gap:8,borderTop:"1px solid var(--line)",paddingTop:12}}>
                {[["name","Name"],["hq","HQ / office"],["markets","Markets"],["portal","Portal URL"],["phone","Phone"],["email","Email"]].map(([k,l])=>(
                  <Field key={k} label={l}><input value={g[k]} onChange={e=>upd(g.id,{[k]:e.target.value})}/></Field>
                ))}
                <Field label="Notes"><textarea rows={2} value={g.notes} onChange={e=>upd(g.id,{notes:e.target.value})}/></Field>
                <ConfirmBtn label="Remove" onConfirm={()=>setGcs(p=>p.filter(x=>x.id!==g.id))}/>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ============ APP SHELL ============ */
export default function BidHunter(){
  const [view,setView] = useState("dash");
  const [opps,setOpps] = useState(null);
  const [gcs,setGcs] = useState(null);
  const [takeoffs,setTakeoffs] = useState({});
  const [proposals,setProposals] = useState({});
  const [openId,setOpenId] = useState(null);
  const [adding,setAdding] = useState(false);
  const [loadErr,setLoadErr] = useState("");
  const [badges,setBadges] = useState({leads:0, followups:0});
  const timers = useRef({});

  const debouncedPut = (key, path, body) => {
    clearTimeout(timers.current[key]);
    timers.current[key] = setTimeout(()=>api(path,{method:"PUT",body}).catch(e=>console.error("save failed:",e.message)), 500);
  };

  // Sidebar badge counts — best-effort only, never blocks the app if they fail.
  const refreshBadges = ()=>{
    api("/discovery/leads").then(r=>{
      const n = (Array.isArray(r)?r:[]).filter(l=>l.relevance==="high").length;
      setBadges(b=>({...b, leads:n}));
    }).catch(()=>{});
    api2("/followups").then(g=>{
      const n = (g?.overdue?.length||0) + (g?.today?.length||0);
      setBadges(b=>({...b, followups:n}));
    }).catch(()=>{});
  };
  useEffect(()=>{ refreshBadges(); },[]);

  useEffect(()=>{(async()=>{
    try{
      const [o,g] = await Promise.all([api("/opportunities"), api("/contractors")]);
      setOpps(o); setGcs(g);
    }catch(e){ setLoadErr("Can't reach the backend ("+e.message+"). Is the server running? Start it with: npm start"); }
  })();},[]);

  if(loadErr){
    return <div className="tti" style={{alignItems:"center",justifyContent:"center",padding:30}}>
      <style>{CSS+"@keyframes spin{to{transform:rotate(360deg)}}"}</style>
      <div className="card" style={{padding:24,maxWidth:440,textAlign:"center"}}>
        <AlertTriangle size={26} style={{color:"var(--warn)",margin:"0 auto 10px"}}/>
        <p style={{fontSize:14,lineHeight:1.6}}>{loadErr}</p>
      </div>
    </div>;
  }
  if(opps===null || gcs===null){
    return <div className="tti" style={{alignItems:"center",justifyContent:"center"}}>
      <style>{CSS+"@keyframes spin{to{transform:rotate(360deg)}}"}</style>
      <Loader2 size={26} style={{color:"var(--azure)",animation:"spin 1s linear infinite"}}/>
    </div>;
  }

  const openOpp = async id => {
    setOpenId(id);
    try{
      const [t,p] = await Promise.all([api("/takeoffs/"+id), api("/proposals/"+id)]);
      setTakeoffs(x=>({...x,[id]: t || x[id]}));
      setProposals(x=>({...x,[id]: p.text}));
    }catch(e){ console.error(e); }
  };
  const current = opps.find(o=>o.id===openId);

  const updateOpp = o => { setOpps(p=>p.map(x=>x.id===o.id?o:x)); debouncedPut("opp:"+o.id, "/opportunities/"+o.id, o); };
  const addOpp = async o => { const saved = await api("/opportunities",{method:"POST",body:o}); setOpps(p=>[saved,...p]); return saved; };
  const deleteOpp = id => { setOpps(p=>p.filter(x=>x.id!==id)); api("/opportunities/"+id,{method:"DELETE"}).catch(console.error); };

  const updGcs = updater => setGcs(prev => {
    const next = typeof updater==="function" ? updater(prev) : updater;
    // persist adds/edits; deletions handled where triggered
    next.forEach(g=>{
      const before = prev.find(x=>x.id===g.id);
      if(!before) api("/contractors",{method:"POST",body:g}).catch(console.error);
      else if(before!==g) debouncedPut("gc:"+g.id, "/contractors/"+g.id, g);
    });
    prev.forEach(g=>{ if(!next.find(x=>x.id===g.id)) api("/contractors/"+g.id,{method:"DELETE"}).catch(console.error); });
    return next;
  });

  const NAV = [
    ["Find work", [
      ["dash","Dashboard",LayoutDashboard],
      ["discovery","Discovery",Rss,badges.leads],
      ["early","Early Leads",Radar],
    ]],
    ["Pipeline", [
      ["opps","Opportunities",Radar],
      ["followups","Follow-ups",Clock,badges.followups],
    ]],
    ["Win more", [
      ["spec","Spec Hunter",Sparkles],
      ["market","Market",Globe],
      ["search","Search",FileSearch],
    ]],
    ["Tools", [
      ["copilot","Blueprint Copilot",Sparkles],
    ]],
    ["Admin", [
      ["gcs","Contractors",Building2],
      ["integrations","Integrations",Link2],
      ["health","System Health",RefreshCw],
    ]],
  ];

  return (
    <div className="tti">
      <style>{CSS+"@keyframes spin{to{transform:rotate(360deg)}}"}</style>
      <aside className="side">
        <div className="brand">
          <div className="mark"><Rss size={17} color="#fff"/></div>
          <div>
            <span>Tint Tech KC</span>
            <b>Bid Hunter</b>
          </div>
        </div>
        <nav className="nav" aria-label="Main">
          {NAV.map(([group,items])=>(
            <div className="navgroup" key={group}>
              <div className="lbl2">{group}</div>
              {items.map(([k,l,I,badge])=>(
                <button key={k} className={view===k?"on":""} onClick={()=>{setView(k);setAdding(false);refreshBadges();}}>
                  <I size={17}/><span>{l}</span>
                  {!!badge && <span className="navbadge">{badge>99?"99+":badge}</span>}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div className="foot">Construction Intelligence OS<br/>Module 1 · KC Metro</div>
      </aside>
      <main className="main">
        {view==="dash" && <Dashboard opps={opps} setView={()=>{setView("opps");setAdding(true);}} openOpp={openOpp} goDiscovery={()=>setView("discovery")} pendingLeads={badges.leads}/>}
        {view==="discovery" && <Discovery onImported={opp=>{setOpps(p=>[opp,...p]);refreshBadges();}}/>}
        {view==="opps" && <Opportunities opps={opps} addOpp={addOpp} openOpp={openOpp} adding={adding} setAdding={setAdding}/>}
        {view==="copilot" && <Copilot/>}
        {view==="followups" && <FollowUps openOpp={openOpp}/>}
        {view==="spec" && <SpecHunter openOpp={openOpp}/>}
        {view==="market" && <MarketIntel openOpp={openOpp}/>}
        {view==="early" && <EarlyOpportunities onTracked={()=>api("/opportunities").then(setOpps).catch(()=>{})}/>}
        {view==="search" && <GlobalSearch openOpp={openOpp}/>}
        {view==="health" && <SystemHealth/>}
        {view==="integrations" && <IntegrationsView/>}
        {view==="gcs" && <Contractors gcs={gcs} setGcs={updGcs}/>}
      </main>
      {current && (
        <OppDrawer
          opp={current}
          onClose={()=>setOpenId(null)}
          onUpdate={updateOpp}
          onDelete={deleteOpp}
          proposal={proposals[current.id]||""}
          setProposal={t=>{ setProposals(p=>({...p,[current.id]:t})); debouncedPut("proposal:"+current.id, "/proposals/"+current.id, {text:t}); }}
        />
      )}
    </div>
  );
}

import { createRoot } from "react-dom/client";
const rootEl = document.getElementById("root");
if(rootEl) createRoot(rootEl).render(<BidHunter/>);
