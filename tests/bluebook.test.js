import { test } from "node:test";
import assert from "node:assert/strict";
import { bluebookToLead } from "../src/bluebook.js";

test("maps a plain camelCase notification to the standard lead shape", () => {
  const lead = bluebookToLead({
    title: "Window Film Installation — City Annex",
    description: "Furnish and install security window film on Levels 1-3.",
    projectNumber: "BB-1029",
    bidDate: "2026-09-15",
    url: "https://www.thebluebook.com/projects/1029",
    city: "Kansas City", state: "MO",
    owner: "City of Kansas City", generalContractor: "Turner Construction"
  });
  assert.equal(lead.projectNo, "BB-1029");
  assert.equal(lead.title, "Window Film Installation — City Annex");
  assert.equal(lead.bidDate, "9/15/2026");
  assert.equal(lead.links.page, "https://www.thebluebook.com/projects/1029");
  assert.equal(lead.city, "Kansas City");
  assert.equal(lead.state, "MO");
  assert.equal(lead.owner, "City of Kansas City");
  assert.equal(lead.gc, "Turner Construction");
  assert.equal(lead.source, "Blue Book (webhook)");
  assert.equal(lead.relevance, "high");
  assert.ok(lead.filmTypes.includes("Security"));
});

test("unwraps a {data: {...}} webhook envelope", () => {
  const lead = bluebookToLead({ event: "project.updated", data: { Title: "Curtain Wall Package", Description: "Glazing scope, storefront replacement" } });
  assert.equal(lead.title, "Curtain Wall Package");
  assert.notEqual(lead.relevance, "excluded");
});

test("unwraps a PascalCase {Payload: {...}} envelope", () => {
  const lead = bluebookToLead({ Payload: { ProjectName: "Solar Control Film — HQ Tower", ProjectId: "77-B" } });
  assert.equal(lead.title, "Solar Control Film — HQ Tower");
  assert.equal(lead.projectNo, "77-B");
  assert.equal(lead.relevance, "high");
});

test("falls back gracefully on an unrecognized/empty payload", () => {
  const lead = bluebookToLead({});
  assert.equal(lead.title, "Untitled Blue Book notification");
  assert.equal(lead.projectNo, "-");
  assert.equal(lead.relevance, "excluded");
  assert.deepEqual(lead.links, {});
});

test("excludes leads with no film or glazing language, same as scanned sources", () => {
  const lead = bluebookToLead({ title: "Annual Window Cleaning Services", description: "Janitorial window washing contract" });
  assert.equal(lead.relevance, "excluded");
});

test("bid date passes through unparsed if it isn't a valid date", () => {
  const lead = bluebookToLead({ title: "Window film RFP", dueDate: "TBD" });
  assert.equal(lead.bidDate, "TBD");
});
