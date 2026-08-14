// V2 data access layer over normalized D1 tables.
// Legacy KV-style collections in the `kv` table are left untouched.
import { uid } from "./store.js";
import { dedupeKey, normalizeSolicitation, toISODate, computeBidScore, daysUntil } from "./engines.js";

const now = () => new Date().toISOString();

/* ---------- generic helpers ---------- */
function cols(obj) {
  const keys = Object.keys(obj).filter(k => obj[k] !== undefined);
  return {
    keys,
    placeholders: keys.map(() => "?").join(","),
    values: keys.map(k => {
      const v = obj[k];
      if (v === null) return null;
      if (typeof v === "object") return JSON.stringify(v);
      if (typeof v === "boolean") return v ? 1 : 0;
      return v;
    })
  };
}

export function makeDb(env) {
  const D1 = env.DB;

  async function all(sql, ...binds) {
    const { results } = await D1.prepare(sql).bind(...binds).all();
    return results || [];
  }
  async function first(sql, ...binds) {
    return await D1.prepare(sql).bind(...binds).first();
  }
  async function run(sql, ...binds) {
    return await D1.prepare(sql).bind(...binds).run();
  }
  // Every V2 table carries created_at and updated_at (0001_initial_v2.sql) so
  // timestamps stamp uniformly — no per-table special cases to drift out of sync.
  async function insert(table, obj) {
    const row = { id: obj.id || uid(), ...obj };
    if (!row.created_at) row.created_at = now();
    const { keys, placeholders, values } = cols(row);
    await D1.prepare(`INSERT OR REPLACE INTO ${table} (${keys.join(",")}) VALUES (${placeholders})`)
      .bind(...values).run();
    return row;
  }
  async function update(table, id, patch) {
    const clean = { ...patch };
    delete clean.id;
    clean.updated_at = now();
    const keys = Object.keys(clean).filter(k => clean[k] !== undefined);
    if (!keys.length) return null;
    const sets = keys.map(k => `${k} = ?`).join(", ");
    const values = keys.map(k => {
      const v = clean[k];
      if (v === null) return null;
      if (typeof v === "object") return JSON.stringify(v);
      if (typeof v === "boolean") return v ? 1 : 0;
      return v;
    });
    await D1.prepare(`UPDATE ${table} SET ${sets} WHERE id = ?`).bind(...values, id).run();
    return await first(`SELECT * FROM ${table} WHERE id = ?`, id);
  }
  async function remove(table, id) {
    await run(`DELETE FROM ${table} WHERE id = ?`, id);
    return { ok: true };
  }

  /* ---------- projects ---------- */
  async function listProjects({ status, state, limit = 200 } = {}) {
    let sql = "SELECT * FROM projects";
    const binds = [], where = [];
    if (status) { where.push("status = ?"); binds.push(status); }
    if (state) { where.push("state = ?"); binds.push(state); }
    if (where.length) sql += " WHERE " + where.join(" AND ");
    sql += " ORDER BY (bid_due IS NULL), bid_due ASC LIMIT ?";
    binds.push(limit);
    return all(sql, ...binds);
  }

  async function getProject(id) {
    const project = await first("SELECT * FROM projects WHERE id = ?", id);
    if (!project) return null;
    const [documents, filmScope, glazing, takeoffsRows, contacts, rfis, addendaRows, risks, bidsRows, results, checklist] =
      await Promise.all([
        all("SELECT * FROM project_documents WHERE project_id = ? ORDER BY uploaded_at DESC", id),
        all("SELECT * FROM film_scope WHERE project_id = ?", id),
        all("SELECT * FROM glazing_items WHERE project_id = ?", id),
        all("SELECT * FROM takeoffs WHERE project_id = ? ORDER BY created_at DESC", id),
        all("SELECT * FROM project_contacts WHERE project_id = ?", id),
        all("SELECT * FROM rfis WHERE project_id = ? ORDER BY created_at DESC", id),
        all("SELECT * FROM addenda WHERE project_id = ? ORDER BY addendum_number", id),
        all("SELECT * FROM project_risks WHERE project_id = ?", id),
        all("SELECT * FROM bids WHERE project_id = ? ORDER BY created_at DESC", id),
        all("SELECT * FROM bid_results WHERE project_id = ? ORDER BY created_at DESC", id),
        all("SELECT * FROM bid_checklist WHERE project_id = ?", id)
      ]);
    return {
      ...project,
      score: safeJson(project.score_json),
      documents, filmScope, glazing, takeoffs: takeoffsRows, contacts, rfis,
      addenda: addendaRows, risks, bids: bidsRows, results, checklist
    };
  }

  /** Insert a project unless an existing one matches its dedupe key. */
  async function upsertProject(input) {
    const p = { ...input };
    p.project_number = p.project_number || "";
    p.bid_due = toISODate(p.bid_due) || p.bid_due || null;
    p.dedupe_key = dedupeKey(p);
    const sol = normalizeSolicitation(p.project_number);

    let existing = await first("SELECT * FROM projects WHERE dedupe_key = ?", p.dedupe_key);
    if (!existing && sol) {
      const rows = await all("SELECT * FROM projects WHERE project_number != '' LIMIT 500");
      existing = rows.find(r => normalizeSolicitation(r.project_number) === sol) || null;
    }
    if (existing) {
      // Merge: only fill blanks, never overwrite estimator-entered data
      const patch = {};
      for (const [k, v] of Object.entries(p)) {
        if (v === null || v === undefined || v === "") continue;
        if (["id", "created_at", "discovered_at"].includes(k)) continue;
        if (existing[k] === null || existing[k] === undefined || existing[k] === "") patch[k] = v;
      }
      const updated = Object.keys(patch).length ? await update("projects", existing.id, patch) : existing;
      return { project: updated, created: false };
    }
    const row = await insert("projects", {
      status: "New",
      discovered_at: p.discovered_at || now().slice(0, 10),
      updated_at: now(),
      ...p
    });
    return { project: row, created: true };
  }

  /** Deterministic score, persisted. AI explanation is attached separately. */
  async function scoreProject(id, extra = {}) {
    const p = await getProject(id);
    if (!p) return null;
    const filmSf = (p.filmScope || []).reduce((s, f) => s + (Number(f.quantity_sf) || 0), 0);
    const latestBid = (p.bids || [])[0];
    let gcRelationshipScore = null;
    if (p.general_contractor) {
      const co = await first("SELECT relationship_score FROM companies WHERE name = ?", p.general_contractor);
      if (co) gcRelationshipScore = co.relationship_score;
    }
    const score = computeBidScore({
      filmExplicitlySpecified: (p.filmScope || []).some(f => f.spec_section),
      filmEvidenceCount: (p.filmScope || []).length,
      glazingEvidenceCount: (p.glazing || []).length,
      estimatedRevenue: latestBid?.bid_amount ?? extra.estimatedRevenue ?? p.estimated_project_value ?? null,
      estimatedGrossProfit: latestBid?.gross_profit ?? extra.estimatedGrossProfit ?? null,
      distanceMiles: p.distance_miles ?? extra.distanceMiles ?? null,
      daysUntilBid: daysUntil(p.bid_due),
      gcRelationshipScore,
      competition: extra.competition || null,
      strategicValue: extra.strategicValue || null,
      filmSf
    });
    await update("projects", id, { score_json: JSON.stringify(score) });
    return score;
  }

  return {
    all, first, run, insert, update, remove,
    listProjects, getProject, upsertProject, scoreProject
  };
}

function safeJson(s) { try { return s ? JSON.parse(s) : null; } catch { return null; } }

/* ============================================================
   MIGRATION: legacy KV collections -> V2 tables
   Non-destructive. Safe to run more than once (dedupes).
   ============================================================ */
export async function migrateKvToV2(env, store) {
  const db = makeDb(env);
  const stats = {
    projectsCreated: 0, projectsMerged: 0,
    companiesCreated: 0, companiesSkipped: 0,
    takeoffsMigrated: 0, proposalsPreserved: 0,
    discoveredPreserved: 0, errors: []
  };

  const opportunities = (await store.get("opportunities")) || [];
  const contractors = (await store.get("contractors")) || [];
  const takeoffs = (await store.get("takeoffs")) || {};
  const proposals = (await store.get("proposals")) || {};
  const discovered = (await store.get("discovered")) || [];

  // opportunities -> projects
  const idMap = {};
  for (const o of opportunities) {
    try {
      const { project, created } = await db.upsertProject({
        id: o.id,
        name: o.name,
        project_number: o.bidNumber || "",
        owner: o.owner || null,
        architect: o.architect || null,
        general_contractor: o.gc || null,
        city: o.city || null, county: o.county || null, state: o.state || null,
        estimated_project_value: o.value ? Number(o.value) : null,
        bid_due: o.bidDue || null, prebid_date: o.preBid || null,
        project_type: o.type || null,
        status: o.status || "New",
        source: o.source || null,
        source_url: /^https?:/.test(o.source || "") ? o.source : null,
        notes: o.notes || null,
        discovered_at: o.discovered || null,
        score_json: o.score ? JSON.stringify(o.score) : null
      });
      idMap[o.id] = project.id;
      created ? stats.projectsCreated++ : stats.projectsMerged++;

      // film types recorded on the opportunity become film_scope rows with
      // explicitly unknown quantities — never invented numbers.
      for (const ft of o.filmTypes || []) {
        const dup = await db.first(
          "SELECT id FROM film_scope WHERE project_id = ? AND film_type = ? AND source_excerpt = ?",
          project.id, ft, "Estimator tag from legacy opportunity record");
        if (dup) continue;
        await db.insert("film_scope", {
          project_id: project.id, film_type: ft,
          manufacturer: null, product: null, quantity_sf: null,
          confidence: null,
          source_excerpt: "Estimator tag from legacy opportunity record"
        });
      }
    } catch (e) { stats.errors.push(`opportunity ${o.id}: ${e.message}`); }
  }

  // contractors -> companies
  for (const c of contractors) {
    try {
      const exists = await db.first("SELECT id FROM companies WHERE name = ?", c.name);
      if (exists) { stats.companiesSkipped++; continue; }
      await db.insert("companies", {
        id: c.id, name: c.name, company_type: "GC",
        hq: c.hq || null, website: c.portal || null,
        phone: c.phone || null, email: c.email || null,
        markets: c.markets || null, notes: c.notes || null,
        relationship_score: (Number(c.rel) || 0) * 20,   // 0-5 stars -> 0-100
        updated_at: now()
      });
      stats.companiesCreated++;
    } catch (e) { stats.errors.push(`contractor ${c.name}: ${e.message}`); }
  }

  // takeoffs -> takeoffs table (inputs preserved verbatim)
  for (const [oppId, t] of Object.entries(takeoffs)) {
    try {
      const projectId = idMap[oppId] || oppId;
      const exists = await db.first("SELECT id FROM takeoffs WHERE project_id = ? AND name = ?", projectId, "Migrated from V1");
      if (exists) continue;
      const glazing = Number(t.glazingSqft) || null;
      const waste = Number(t.waste) || 0;
      const filmSf = glazing != null ? glazing * (Number(t.coverage) || 100) / 100 : null;
      await db.insert("takeoffs", {
        project_id: projectId, name: "Migrated from V1",
        total_glazing_sf: glazing,
        total_film_sf: filmSf,
        waste_percent: waste,
        waste_sf: filmSf != null ? filmSf * waste / 100 : null,
        total_material_sf: filmSf != null ? filmSf * (1 + waste / 100) : null,
        confidence: null, status: "migrated",
        inputs_json: JSON.stringify(t),
        updated_at: now()
      });
      stats.takeoffsMigrated++;
    } catch (e) { stats.errors.push(`takeoff ${oppId}: ${e.message}`); }
  }

  // proposals + discovered leads stay in KV (still read by legacy routes)
  stats.proposalsPreserved = Object.keys(proposals).length;
  stats.discoveredPreserved = discovered.length;

  await store.set("meta", { ...((await store.get("meta")) || {}), migratedV2At: now() });
  return stats;
}
