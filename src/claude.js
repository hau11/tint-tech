// Server-side Claude API client. Requires ANTHROPIC_API_KEY in .env
const API = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-sonnet-4-6";

export async function callClaude(env, { system, messages, maxTokens = 2000 }) {
  const key = env.ANTHROPIC_API_KEY;
  if (!key) {
    const err = new Error("No ANTHROPIC_API_KEY set. Run: npx wrangler secret put ANTHROPIC_API_KEY — and add your key from https://console.anthropic.com");
    err.status = 400;
    throw err;
  }
  const res = await fetch(API, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({ model: MODEL, max_tokens: maxTokens, system, messages })
  });
  const data = await res.json();
  if (data.error) {
    const err = new Error(data.error.message || "Claude API error");
    err.status = res.status;
    throw err;
  }
  return (data.content || []).filter(b => b.type === "text").map(b => b.text).join("\n");
}

export function parseJSON(text) {
  const clean = text.replace(/```json|```/g, "").trim();
  const start = clean.indexOf("{");
  const end = clean.lastIndexOf("}");
  return JSON.parse(clean.slice(start, end + 1));
}

const COMPANY = "Tint Tech KC, a commercial window film contractor based in Belton, MO serving the Kansas City metro (MO and KS). Films installed: solar control, safety, security, decorative, privacy, frosted, bird strike, blast mitigation, anti-graffiti, exterior, and energy retrofit film. Phone (913) 703-6442, email info@tinttechkc.com.";

export async function scoreOpportunity(env, opp) {
  const system = `You are the opportunity-scoring engine inside a construction intelligence platform used by ${COMPANY} Respond ONLY with raw JSON, no markdown fences, no preamble.`;
  const user = `Score this opportunity. Return JSON exactly in this shape:
{"total": <0-100 overall win-probability-weighted attractiveness>, "breakdown": {"filmLikelihood":<0-10>,"size":<0-10>,"profitability":<0-10>,"distance":<0-10>,"competition":<0-10>,"relationship":<0-10>,"timeline":<0-10>,"strategic":<0-10>}, "reasoning": "<4-6 sentences explaining the score and the single best next action>"}

Opportunity data:
${JSON.stringify({ ...opp, today: new Date().toISOString().slice(0, 10) })}`;
  const text = await callClaude(env, { system, messages: [{ role: "user", content: user }], maxTokens: 1200 });
  const j = parseJSON(text);
  return { total: Math.round(j.total), breakdown: j.breakdown || {}, reasoning: j.reasoning || "", at: new Date().toISOString().slice(0, 10) };
}

const COPILOT_SYS = `You are the Blueprint Intelligence Copilot inside Bid Hunter, used by ${COMPANY}

The user uploads construction documents (drawings, specs, project manuals, addenda). Your job:
- Find and analyze all glazing: storefronts, curtain walls, window schedules, glass types, dimensions, and quantities.
- Identify where window film is specified or where it is a strong opportunity (security, decorative, privacy, solar, energy retrofit).
- Estimate glazing square footage when dimensions or schedules allow; show your math and state a confidence level (high / medium / low).
- ALWAYS cite the exact sheet numbers (e.g. A-201), schedule names, or spec sections (e.g. 08 87 13) that support each finding so the user can verify.
- If the documents don't contain the answer, say so plainly — never invent sheet numbers or quantities.
Keep answers tight and skimmable. You are talking to a contractor, not an architect.`;

export async function blueprintChat(env, { doc, messages }) {
  // Attach the document to the first user turn on every call (the API is stateless)
  let attached = false;
  const apiMessages = messages.map(m => {
    if (m.role === "user" && !attached) {
      attached = true;
      const block = doc.kind === "document"
        ? { type: "document", source: { type: "base64", media_type: doc.media, data: doc.base64 } }
        : { type: "image", source: { type: "base64", media_type: doc.media, data: doc.base64 } };
      return { role: "user", content: [block, { type: "text", text: m.text }] };
    }
    return { role: m.role === "ai" ? "assistant" : "user", content: m.text };
  });
  return callClaude(env, { system: COPILOT_SYS, messages: apiMessages, maxTokens: 3000 });
}

export async function generateProposal(env, { opp, takeoff, computed }) {
  const system = `You write professional commercial window film proposals for ${COMPANY} Write in clean plain-text/markdown suitable for pasting into a Word doc. Be concrete and professional. No preamble — output the proposal only.`;
  const user = `Write a complete proposal for this project. Include: header with company info and date, scope of work, recommended film products (match to film types), estimated quantities, pricing table, labor and schedule estimate, assumptions, exclusions, warranty (manufacturer film warranty + workmanship), optional alternates, and terms & conditions.

Project: ${JSON.stringify(opp)}
Takeoff inputs: ${JSON.stringify(takeoff)}
Computed: ${JSON.stringify(computed)}`;
  return callClaude(env, { system, messages: [{ role: "user", content: user }], maxTokens: 3000 });
}

/* ============================================================
   V2 — structured analysis functions (spec §47)
   Every one returns validated JSON or a structured error.
   Never silently corrupts data.
   ============================================================ */
export const PROMPT_VERSIONS = {
  film: "film-v2.1", glazing: "glazing-v2.1", risk: "risk-v2.1",
  rfi: "rfi-v2.1", answer: "answer-v2.1"
};

const NEVER_INVENT = `ABSOLUTE RULES — violating these makes your output worthless:
- NEVER invent square footage, sheet numbers, window quantities, dimensions, manufacturers, products, specifications, dates, names, or values.
- If something is not in the supplied excerpts, the value is null and you say so. Do not infer a manufacturer from common industry practice.
- Every finding MUST cite the page number (and sheet when shown) from the supplied evidence. Findings without a citation will be discarded.
- Any quantity MUST include the arithmetic that produced it, e.g. "42 x 4' x 7' = 1176 SF".
- Distinguish SPECIFIED (the documents say it) from RECOMMENDED (your professional suggestion). Set isRecommendation true for the latter.
Respond ONLY with raw JSON. No markdown fences, no preamble.`;

/** Call Claude and parse strict JSON, retrying once on malformed output. */
export async function callClaudeJSON(env, { system, user, maxTokens = 3000 }) {
  const attempt = async (extraNudge) => {
    // `user` may be a string or an array of content blocks (vision calls)
    let content;
    if (Array.isArray(user)) {
      content = extraNudge ? [...user, { type: "text", text: extraNudge }] : user;
    } else {
      content = extraNudge ? user + "\n\n" + extraNudge : user;
    }
    const text = await callClaude(env, { system, messages: [{ role: "user", content }], maxTokens });
    return { text, json: parseJSON(text) };
  };
  try {
    return { ok: true, ...(await attempt()) };
  } catch (e1) {
    try {
      const r = await attempt("Your previous response could not be parsed. Return ONLY valid raw JSON, starting with { and ending with }.");
      return { ok: true, ...r, retried: true };
    } catch (e2) {
      return { ok: false, error: "AI returned unparseable output after a retry: " + e2.message };
    }
  }
}

export async function extractFilmScope(env, { project, evidence }) {
  const system = `You are the film-scope extraction engine for Tint Tech KC, a commercial window film contractor. You read construction document excerpts and report where window film is specified or clearly needed.\n\n${NEVER_INVENT}`;
  const user = `Project: ${JSON.stringify({ name: project.name, number: project.project_number, owner: project.owner })}

Evidence (each item is one page we extracted from the uploaded documents):
${JSON.stringify(evidence)}

Return JSON:
{"filmOpportunities":[{"type":"<one of: Solar Control|Security|Safety|Decorative|Privacy|Frosted|Bird Strike|Blast Mitigation|Anti-Graffiti|Exterior|Energy Retrofit|Switchable|Projection|Whiteboard|Other>","manufacturer":"<or null>","product":"<or null>","quantitySF":<number or null>,"calculation":"<arithmetic, or null if no quantity>","location":"<or null>","floor":"<or null>","sheet":"<sheet number from evidence>","page":<page number from evidence>,"specSection":"<e.g. 08 87 13, or null>","vlt":"<or null>","interiorExterior":"<Interior|Exterior|null>","attachmentRequired":<true|false|null>,"confidence":<0-100>,"excerpt":"<short supporting quote from the evidence>","isSpecified":<true|false>,"isRecommendation":<true|false>}],
"summary":"<2-3 sentences for a contractor>",
"missingInformation":["<what a bidder still needs to confirm>"]}

If no film evidence exists, return an empty filmOpportunities array and explain in summary.`;
  return callClaudeJSON(env, { system, user });
}

export async function extractGlazing(env, { project, evidence }) {
  const system = `You are the glazing take-off extraction engine for a commercial window film contractor. You read window schedules, elevations, and glazing schedules and report countable glazing.\n\n${NEVER_INVENT}`;
  const user = `Project: ${JSON.stringify({ name: project.name, number: project.project_number })}

Evidence:
${JSON.stringify(evidence)}

Return JSON:
{"glazingItems":[{"windowMark":"<e.g. W-101 or null>","windowType":"<storefront|curtain wall|punched window|glass door|skylight|other|null>","floor":"<or null>","elevation":"<or null>","quantity":<number or null>,"widthFt":<number or null>,"heightFt":<number or null>,"glassType":"<or null>","frameType":"<or null>","sheet":"<from evidence>","page":<from evidence>,"confidence":<0-100>}],
"summary":"<2-3 sentences>",
"missingInformation":["<dimensions or schedules not found>"]}

Report dimensions in decimal feet. If a schedule shows 3'-6", report 3.5. If a dimension is not shown, use null — do not estimate it.`;
  return callClaudeJSON(env, { system, user });
}

export async function analyzeRisks(env, { project, evidence, filmScope, glazing }) {
  const system = `You are the bid-risk engine for a commercial window film contractor. You flag what could hurt this bid.\n\n${NEVER_INVENT}`;
  const user = `Project: ${JSON.stringify({ name: project.name, city: project.city, state: project.state })}
Film scope found: ${JSON.stringify(filmScope || [])}
Glazing found: ${JSON.stringify(glazing || [])}
Evidence: ${JSON.stringify(evidence)}

Identify bid risks: missing dimensions, conflicting documents (drawings vs specs), unclear specifications, missing addenda, ambiguous scope, access/lift/scaffold requirements, security attachment systems, exterior installation, removal of existing film.

Return JSON:
{"risks":[{"severity":"HIGH|MEDIUM|LOW","title":"<short>","reason":"<why it matters>","source":"<sheet/page/spec from evidence, or 'no source'>","recommendedAction":"<what to do>"}],
"scopeConflicts":[{"description":"<what conflicts>","sourceA":"<sheet/spec>","sourceB":"<sheet/spec>","suggestedRFI":"<one-sentence question for the GC>"}]}`;
  return callClaudeJSON(env, { system, user, maxTokens: 2000 });
}

export async function generateRFI(env, { project, conflict }) {
  const system = `You write professional construction RFIs for Tint Tech KC. Base the RFI ONLY on the supplied verified information. Never invent sheet numbers or specification sections.\n\n${NEVER_INVENT}`;
  const user = `Project: ${JSON.stringify({ name: project.name, number: project.project_number, gc: project.general_contractor })}
Issue: ${JSON.stringify(conflict)}

Return JSON:
{"subject":"<short subject line>","reference":"<sheets and spec sections involved>","question":"<the professional RFI question, 2-4 sentences>"}`;
  return callClaudeJSON(env, { system, user, maxTokens: 1200 });
}

/** Project Copilot — answers from indexed evidence, not the whole PDF. */
export async function answerFromEvidence(env, { project, question, evidence, filmScope, glazing, history = [] }) {
  const system = `You are the Project AI Copilot inside Bid Hunter, used by Tint Tech KC (commercial window film, Kansas City metro). You answer questions about a specific construction project using ONLY the evidence supplied.

${NEVER_INVENT.replace("Respond ONLY with raw JSON. No markdown fences, no preamble.", "")}

Format your answer for a contractor on a job site:
ANSWER
<direct answer, 1-4 sentences>

EVIDENCE
<sheet numbers / spec sections / page numbers you used>

CONFIDENCE
<HIGH | MEDIUM | LOW>

ACTION
<the single most useful next step, if any>

If the evidence does not contain the answer, say "Not found in available documents" under ANSWER and say what document would answer it.`;
  const messages = [
    ...history.slice(-6).map(m => ({ role: m.role === "ai" ? "assistant" : "user", content: m.text })),
    {
      role: "user",
      content: `Project: ${JSON.stringify({ name: project.name, number: project.project_number, gc: project.general_contractor, bidDue: project.bid_due })}
Film scope on record: ${JSON.stringify(filmScope || [])}
Glazing on record: ${JSON.stringify(glazing || [])}
Document evidence: ${JSON.stringify(evidence)}

Question: ${question}`
    }
  ];
  return callClaude(env, { system, messages, maxTokens: 2000 });
}


/** Proposal assembled from real project data only. Unselected products are
 *  reported as "To be confirmed" — never invented (spec §41, §79). */
export async function generateProposalV2(env, { project, filmScope, takeoff, pricing, rollPlan }) {
  const system = `You write professional commercial window film proposals for Tint Tech KC (Belton, MO; serving the Kansas City metro; (913) 703-6442; info@tinttechkc.com).

${NEVER_INVENT.replace("Respond ONLY with raw JSON. No markdown fences, no preamble.", "")}

Additional proposal rules:
- Use ONLY the quantities and prices supplied. Do not recalculate or adjust them.
- If a film product or manufacturer is "Not specified", write "To be confirmed" in the proposal. Never substitute a real product name.
- Where a quantity is Unknown, state it as an exclusion or an allowance to be verified — do not fill in a number.
- Write clean markdown suitable for pasting into Word. Output the proposal only.`;

  const user = `Write a complete proposal. Sections: header with company info and today's date, project identification, scope of work, film products and quantities, pricing table, labor and schedule, assumptions, exclusions, warranty (manufacturer film warranty plus workmanship), optional alternates, terms and conditions, and a signature block.

Project: ${JSON.stringify({
    name: project.name, number: project.project_number, owner: project.owner,
    gc: project.general_contractor, architect: project.architect,
    location: [project.city, project.state].filter(Boolean).join(", "),
    bidDue: project.bid_due
  })}
Film scope (verified findings): ${JSON.stringify(filmScope)}
Takeoff: ${JSON.stringify(takeoff)}
Material plan: ${JSON.stringify(rollPlan)}
Pricing (final — use exactly these figures): ${JSON.stringify({
    bidPrice: pricing.bidPrice, materialCost: pricing.materialCost,
    laborHours: pricing.laborHours, laborCost: pricing.laborCost,
    equipment: pricing.equipmentCost, mobilization: pricing.mobilizationCost
  })}`;
  return callClaude(env, { system, messages: [{ role: "user", content: user }], maxTokens: 3500 });
}

/**
 * Read a scanned/image-only sheet with vision. Used only for pages that had no
 * extractable text — normal pages never take this path, because vision costs
 * far more per page than text does.
 */
export async function readScannedPage(env, { images, project, pageNumbers = [] }) {
  const system = `You transcribe construction drawing sheets for a commercial window film contractor.

${NEVER_INVENT}

For each image, report what is actually legible. Focus on: the sheet number in the title block, the sheet title, any window/glazing schedule rows (mark, quantity, width, height, glass type), and any note mentioning film, glazing, storefront, or curtain wall.
If a value is not legible, use null. Do not infer dimensions from drawing proportions — only report dimensions that are written on the sheet.`;

  const content = [];
  images.forEach((img, i) => {
    content.push({ type: "image", source: { type: "base64", media_type: img.mediaType || "image/png", data: img.base64 } });
    content.push({ type: "text", text: `Above is page ${pageNumbers[i] ?? i + 1}.` });
  });
  content.push({
    type: "text",
    text: `Project: ${project?.name || "unknown"}

Return JSON:
{"pages":[{"page":<number>,"sheetNumber":"<from title block, or null>","sheetTitle":"<or null>","classification":"<Window Schedule|Elevation|Floor Plan|Specification|Architectural|Other>","legibleText":"<the text you can actually read, especially schedule rows and notes — keep it under 800 characters>","filmMentioned":<true|false>,"glazingMentioned":<true|false>,"confidence":<0-100>}]}

If a page is too blurry or low-resolution to read, set legibleText to "" and confidence to a low number. Do not guess.`
  });

  return callClaudeJSON(env, {
    system,
    user: content,           // array form is passed through as message content
    maxTokens: 3000
  });
}

/** Outreach copy built from verified project facts only. Never auto-sent. */
export async function generateOutreach(env, { project, contact, purpose, filmScope, hidden, channel = "email" }) {
  const system = `You write short, professional B2B outreach for Tint Tech KC, a commercial window film contractor in Belton, MO serving the Kansas City metro. Phone (913) 703-6442, email info@tinttechkc.com. The owner signs as "Hunter".

${NEVER_INVENT.replace("Respond ONLY with raw JSON. No markdown fences, no preamble.", "")}

Outreach rules:
- Use ONLY the project facts supplied. If you don't have a fact, leave it out — never pad with invented detail.
- No superlatives, no "industry-leading", no invented credentials, no fake urgency.
- Contractors are busy: 120 words maximum for an email, 90 for a call script.
- Make one clear ask.
- If the film scope is only a possibility rather than a specification, say so honestly ("if film is in the scope") rather than asserting it.

Respond ONLY with raw JSON.`;

  const user = `Write ${channel === "call" ? "a call script" : "an outreach email"} for this purpose: ${purpose}

Project (verified facts): ${JSON.stringify({
    name: project.name, number: project.project_number, city: project.city, state: project.state,
    gc: project.general_contractor, architect: project.architect, owner: project.owner,
    bidDue: project.bid_due, stage: project.stage
  })}
Contact: ${JSON.stringify(contact || { name: null, role: null })}
Film scope on record: ${JSON.stringify(filmScope || [])}
Hidden film opportunity: ${JSON.stringify(hidden ? { confidence: hidden.confidence, films: hidden.recommendedFilms, reason: hidden.reason } : null)}

Return JSON:
{"subject":"<email subject, or null for a call script>","body":"<the message>","talkingPoints":["<2-4 short points to have ready>"],"ask":"<the single specific ask>"}`;
  return callClaudeJSON(env, { system, user, maxTokens: 1500 });
}

/** Pursuit strategy for a specific project, grounded in stored evidence. */
export async function winThisJob(env, { project, bid, filmScope, risks, contacts, gcHistory, hidden }) {
  const system = `You are a pursuit strategist for Tint Tech KC, a commercial window film contractor in the Kansas City metro. You advise a one-person estimating operation, so your advice must be practical for someone with limited time.

${NEVER_INVENT.replace("Respond ONLY with raw JSON. No markdown fences, no preamble.", "")}

Additional rules:
- Do NOT invent competitor names, competitor pricing, or relationships that are not in the supplied data.
- If the win/loss history is thin, say the strategy is based on judgement rather than the contractor's own record.
- Do not recommend a specific bid number. Pricing is calculated elsewhere; you explain strategy only.

Respond ONLY with raw JSON.`;

  const user = `Build a pursuit strategy for this project.

Project: ${JSON.stringify({
    name: project.name, number: project.project_number, type: project.project_type,
    city: project.city, state: project.state, stage: project.stage,
    gc: project.general_contractor, architect: project.architect, owner: project.owner,
    bidDue: project.bid_due, preBid: project.prebid_date, status: project.status
  })}
Calculated bid (do not change these numbers): ${JSON.stringify(bid || null)}
Film scope on record: ${JSON.stringify(filmScope || [])}
Known risks: ${JSON.stringify(risks || [])}
Contacts on record: ${JSON.stringify(contacts || [])}
Our history with this GC: ${JSON.stringify(gcHistory || null)}
Hidden film opportunity: ${JSON.stringify(hidden || null)}

Return JSON:
{"strategy":"<3-5 sentences: how to win this specific job>",
 "pricingPosture":"<aggressive|target|premium> — <one sentence why, referring to the supplied data only>",
 "talkingPoints":["<3-5 things to say that are true of THIS project>"],
 "questionsToAsk":["<2-4 questions for the GC or architect>"],
 "differentiators":["<2-3 reasons a GC would pick a specialist film contractor here>"],
 "risksToRaise":["<risks worth flagging to the GC rather than absorbing>"],
 "postBid":"<what to do after submitting>",
 "confidenceNote":"<state plainly what this advice is based on, and what is missing>"}`;
  return callClaudeJSON(env, { system, user, maxTokens: 2500 });
}
