// Bid checklist (spec §81). Deterministic.
// Items auto-tick from real project data where the app can verify them; the rest
// are manual, because only the estimator knows if they walked the site. An item
// that says "done" when it isn't is worse than no checklist at all.
import { num } from "./engines.js";

export const CHECKLIST_ITEMS = [
  { key: "plans",        label: "Download all plans",              auto: true },
  { key: "specs",        label: "Download specifications",         auto: true },
  { key: "addenda",      label: "Review all addenda",              auto: true },
  { key: "filmScope",    label: "Verify film scope",               auto: true },
  { key: "glazingQty",   label: "Verify glazing quantities",       auto: true },
  { key: "glassType",    label: "Verify glass type",               auto: true },
  { key: "access",       label: "Verify access (lift / scaffold)", auto: false },
  { key: "removal",      label: "Verify removal of existing film", auto: false },
  { key: "attachment",   label: "Verify security attachment",      auto: true },
  { key: "manufacturer", label: "Confirm manufacturer / product",  auto: true },
  { key: "material",     label: "Calculate material",              auto: true },
  { key: "labor",        label: "Calculate labor",                 auto: true },
  { key: "equipment",    label: "Calculate equipment",             auto: false },
  { key: "margin",       label: "Calculate margin",                auto: true },
  { key: "exclusions",   label: "Review exclusions",               auto: false },
  { key: "proposal",     label: "Generate proposal",               auto: true },
  { key: "submit",       label: "Submit bid",                      auto: false }
];

/**
 * Derive checklist state from what the project actually contains.
 * @param manual {object} user-ticked keys, which override nothing that is auto-false
 */
export function buildChecklist(project = {}, manual = {}) {
  const docs = project.documents || [];
  const film = project.filmScope || [];
  const glazing = project.glazing || [];
  const takeoffs = project.takeoffs || [];
  const bids = project.bids || [];
  const addenda = project.addenda || [];
  const hasProposal = Boolean(project.hasProposal);

  const auto = {
    plans:        docs.some(d => d.document_type === "plans"),
    specs:        docs.some(d => d.document_type === "specifications"),
    addenda:      addenda.length > 0 || docs.some(d => d.document_type === "addendum"),
    filmScope:    film.length > 0,
    glazingQty:   glazing.some(g => num(g.area_sf) > 0),
    glassType:    glazing.some(g => g.glass_type),
    attachment:   film.some(f => f.attachment_required != null && f.attachment_required !== ""),
    manufacturer: film.some(f => f.manufacturer && !/^not specified$/i.test(f.manufacturer)),
    material:     takeoffs.some(t => num(t.total_material_sf) > 0),
    labor:        bids.some(b => num(b.labor_cost) > 0),
    margin:       bids.some(b => num(b.gross_margin) > 0),
    proposal:     hasProposal
  };

  const items = CHECKLIST_ITEMS.map(item => {
    const autoDone = item.auto ? Boolean(auto[item.key]) : false;
    const manualDone = Boolean(manual[item.key]);
    return {
      ...item,
      done: autoDone || manualDone,
      source: autoDone ? "verified" : manualDone ? "checked by you" : null,
      // an auto item the app can't verify still lets the user tick it manually
      canTick: !autoDone
    };
  });

  const done = items.filter(i => i.done).length;
  const blockers = items.filter(i => !i.done && ["filmScope", "glazingQty", "material", "labor", "margin"].includes(i.key));

  return {
    items, done, total: items.length,
    percent: Math.round(done / items.length * 100),
    readyToBid: blockers.length === 0,
    blockers: blockers.map(b => b.label),
    note: blockers.length
      ? `Not ready to bid — ${blockers.length} core item(s) outstanding.`
      : done === items.length ? "Everything checked." : "Core items covered; the rest are your call."
  };
}
