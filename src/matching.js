// Lead routing: which customers should receive a project, ranked, and why.
//
// Deterministic and pure, like engines.js. No DB, no network, no AI, so the
// routing can be tested exhaustively and, more importantly, explained to a
// customer who asks why they did or did not get a lead.
//
// The schema has carried service_states, max_distance_miles and film_types
// since 0007_accounts.sql, under the comment 'used to decide who gets which
// lead'. Nothing read them until now; delivery took an explicit list of
// customer ids, which works at three customers and collapses at thirty.

// Weights. Explicit territory is the strongest signal, because a contractor
// who named their states is telling us exactly where they work. Serving
// anywhere scores lower on purpose: it usually means nobody set a territory,
// not that they truly cover the country.
export const MATCH_WEIGHTS = Object.freeze({
  stateExplicit: 45,
  stateUnrestricted: 20,
  filmOverlap: 25,
  filmPrimary: 10
});

// Distance deliberately carries no weight. Scoring it rewarded customers who
// set a limit over those who did not, which is backwards: no limit means they
// will travel anywhere. It is a constraint, so it only ever blocks.

// Accepts a JSON string (how D1 stores it) or a real array (how tests and
// callers pass it). Never throws: malformed settings must not break routing.
function parseList(value) {
  if (Array.isArray(value)) return value.map(v => String(v || "").trim()).filter(Boolean);
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(v => String(v || "").trim()).filter(Boolean) : [];
  } catch {
    // Tolerate a plain comma-separated list, which is what someone types by hand.
    return value.split(",").map(v => v.trim()).filter(Boolean);
  }
}

const upper = list => list.map(s => s.toUpperCase());

/** Rank every customer for one project. Ineligible ones are returned too, with
 *  their blockers, so the operator can see WHY someone was excluded rather
 *  than wondering where they went. */
export function matchCustomers(project = {}, customers = [], { alreadyDelivered = [] } = {}) {
// A default parameter only covers undefined, not null. Routing is called from
// delivery paths where a missing project is a real possibility, so guard it.
  const p = project && typeof project === "object" ? project : {};
  const projectState = String(p.state || "").trim().toUpperCase();
  const projectFilms = parseList(p.filmTypes);
  const delivered = new Set(parseList(alreadyDelivered).map(id => String(id)));

  const rows = (Array.isArray(customers) ? customers : []).map(customer => {
    const reasons = [];
    const blockers = [];
    let score = 0;

    if (customer.active === 0 || customer.active === false || customer.disabled) {
      blockers.push("Account is not active");
    }
    if (delivered.has(String(customer.id))) {
      // The database enforces this too, via the unique index on
      // (project_id, customer_id). Surfacing it here keeps the operator from
      // picking someone whose delivery would simply fail.
      blockers.push("Already has this project");
    }

    const states = upper(parseList(customer.service_states));
    if (!states.length) {
      score += MATCH_WEIGHTS.stateUnrestricted;
      reasons.push("No territory set, so treated as serving anywhere");
    } else if (!projectState) {
      reasons.push("Project has no state on record, so territory could not be checked");
    } else if (states.includes(projectState)) {
      score += MATCH_WEIGHTS.stateExplicit;
      reasons.push(`Serves ${projectState}`);
    } else {
      blockers.push(`Does not serve ${projectState} (covers ${states.join(", ")})`);
    }

    const films = parseList(customer.film_types);
    if (!films.length) {
      reasons.push("No film types set, so scope was not used to rank");
    } else if (projectFilms.length) {
      const overlap = films.filter(f => projectFilms.some(p => p.toLowerCase() === f.toLowerCase()));
      if (overlap.length) {
        score += MATCH_WEIGHTS.filmOverlap;
        reasons.push(`Sells ${overlap.join(", ")}`);
        if (projectFilms[0] && overlap.some(o => o.toLowerCase() === projectFilms[0].toLowerCase())) {
          score += MATCH_WEIGHTS.filmPrimary;
          reasons.push(`Primary scope on this project is ${projectFilms[0]}`);
        }
      } else {
        reasons.push(`Does not list ${projectFilms.join(" or ")}, but is not excluded for it`);
      }
    }

    // Distance is only scored when it is actually known. Guessing it would be
    // inventing a number, which this codebase does not do: an unknown stays
    // unknown and simply earns nothing either way.
    const limit = Number(customer.max_distance_miles);
    const miles = Number(p.distance_miles);
    if (Number.isFinite(limit) && limit > 0) {
      if (Number.isFinite(miles)) {
        if (miles <= limit) {
          reasons.push(`${Math.round(miles)} miles out, inside their ${limit} mile limit`);
        } else {
          blockers.push(`${Math.round(miles)} miles out, beyond their ${limit} mile limit`);
        }
      } else {
        reasons.push(`Distance unknown, so their ${limit} mile limit could not be applied`);
      }
    }

    return {
      customerId: customer.id,
      company: customer.company_name || customer.name || String(customer.id || ""),
      score: Math.min(100, score),
      eligible: blockers.length === 0,
      reasons, blockers
    };
  });

  // Eligible first, then score, then company name so the order is stable and
  // two runs over the same data never disagree.
  rows.sort((a, b) =>
    (b.eligible === true) - (a.eligible === true) ||
    b.score - a.score ||
    a.company.localeCompare(b.company));

  let rank = 0;
  for (const row of rows) row.rank = row.eligible ? ++rank : null;
  return rows;
}

/** The single best fit, or null when nothing is eligible. */
export function bestMatch(project, customers, opts) {
  const ranked = matchCustomers(project, customers, opts);
  return ranked.find(r => r.eligible) || null;
}
