import { test } from "node:test";
import assert from "node:assert/strict";
import { bcProjectToLead, buildAuthorizeUrl, buildProjectsUrl, redirectUri } from "../src/buildingconnected.js";
import { leadToOpportunity } from "../src/discovery.js";

// The confirmed example response from Autodesk's docs page for
// GET /construction/buildingconnected/v2/projects, adapted with film-relevant
// text so it exercises relevance grading too.
const SAMPLE_RESPONSE = {
  pagination: {
    limit: 100,
    cursorState: "eyJsaW1pdCI6MjUsIm9mZnNldCI6MjV9",
    nextUrl: "https://developer.api.autodesk.com/construction/buildingconnected/v2/projects?cursorState=eyJsaW1pdCI6MjUsIm9mZnNldCI6MjV9"
  },
  results: [
    {
      id: "59d2bd7440b36a0da258f24d",
      name: "Office Renovation",
      number: "12345",
      company: { id: "51bea397f5846f95994b1da7", name: "Gr8 Builders", businessType: ["Subcontractor"] },
      client: "Wells Fargo",
      description: "This is an <em>important</em> window film project.",
      notes: "<div>Security film at the lobby storefront.</div>",
      value: 1000000,
      projectSize: 2000,
      projectSizeUnits: "SQUARE_FEET",
      awarded: "WON",
      state: "PUBLISHED",
      isPublic: false,
      createdAt: "2014-09-22T16:27:37.437Z",
      updatedAt: "2014-09-23T16:28:37.437Z",
      bidsDueAt: "2014-09-22T16:27:37.437Z",
      dueAt: "2014-09-03T08:00:00.000Z",
      closedAt: "2014-09-03T08:00:00.000Z",
      location: {
        country: "US", state: "CA", city: "San Francisco", zip: "94108",
        complete: "600 California St., 6th Floor, San Francisco, CA 94108"
      },
      architect: "Browning Day Mullins Dierdorf Architects",
      marketSector: "Sports Stadium Construction",
      jobWalkAt: "2015-03-31T07:00:00.000Z"
    }
  ]
};

test("maps the real confirmed response shape to the standard lead shape", () => {
  const [lead] = SAMPLE_RESPONSE.results.map(bcProjectToLead);
  assert.equal(lead.title, "Office Renovation");
  assert.equal(lead.projectNo, "12345");
  assert.equal(lead.bidDate, "9/22/2014");
  assert.equal(lead.links.page, "https://app.buildingconnected.com/projects/59d2bd7440b36a0da258f24d");
  assert.equal(lead.city, "San Francisco");
  assert.equal(lead.state, "CA");
  assert.equal(lead.owner, "Wells Fargo");
  assert.equal(lead.gc, "Gr8 Builders");
  assert.equal(lead.architect, "Browning Day Mullins Dierdorf Architects");
  assert.equal(lead.value, 1000000);
  assert.equal(lead.projectType, "Private");
  assert.equal(lead.source, "BuildingConnected");
  // closedAt is set -> no longer an open bid
  assert.equal(lead.stillOpen, false);
  assert.equal(lead.preBidDate, "3/31/2015");
});

test("jobWalkAt flows through leadToOpportunity as the pre-bid meeting date", () => {
  const [lead] = SAMPLE_RESPONSE.results.map(bcProjectToLead);
  const opp = leadToOpportunity(lead);
  assert.equal(opp.preBid, "2015-03-31");
  assert.equal(opp.bidDue, "2014-09-22");
  assert.equal(opp.architect, "Browning Day Mullins Dierdorf Architects");
  assert.equal(opp.value, 1000000);
  assert.equal(opp.type, "Private");
});

test("strips HTML from description/notes before relevance classification", () => {
  const [lead] = SAMPLE_RESPONSE.results.map(bcProjectToLead);
  assert.equal(lead.relevance, "high");
  assert.ok(lead.filmTypes.includes("Security"));
});

test("a project with no closedAt is still open", () => {
  const lead = bcProjectToLead({ id: "x1", name: "Curtain wall glazing package", description: "storefront glazing" });
  assert.equal(lead.stillOpen, true);
});

test("isPublic true maps to a Public project type", () => {
  const lead = bcProjectToLead({ id: "x2", name: "City Annex", isPublic: true });
  assert.equal(lead.projectType, "Public");
});

test("falls back gracefully on an empty/unrecognized payload", () => {
  const lead = bcProjectToLead({});
  assert.equal(lead.title, "Untitled BuildingConnected project");
  assert.equal(lead.projectNo, "-");
  assert.equal(lead.relevance, "excluded");
  assert.deepEqual(lead.links, {});
});

test("excludes projects with no film or glazing language", () => {
  const lead = bcProjectToLead({ name: "Annual Roof Maintenance Contract", description: "Roof inspection and repair" });
  assert.equal(lead.relevance, "excluded");
});

test("buildAuthorizeUrl requests the confirmed data:read scope and three-legged params", () => {
  const env = { BC_CLIENT_ID: "abc123", APP_URL: "https://bidhunter.example.workers.dev" };
  const authUrl = new URL(buildAuthorizeUrl(env));
  assert.equal(authUrl.origin + authUrl.pathname, "https://developer.api.autodesk.com/authentication/v2/authorize");
  assert.equal(authUrl.searchParams.get("response_type"), "code");
  assert.equal(authUrl.searchParams.get("client_id"), "abc123");
  assert.equal(authUrl.searchParams.get("scope"), "data:read");
  assert.equal(authUrl.searchParams.get("redirect_uri"), "https://bidhunter.example.workers.dev/api/integrations/buildingconnected/callback");
});

test("redirectUri strips a trailing slash from APP_URL", () => {
  assert.equal(redirectUri({ APP_URL: "https://x.workers.dev/" }), "https://x.workers.dev/api/integrations/buildingconnected/callback");
});

test("buildProjectsUrl adds the confirmed filter[updatedAt] range syntax", () => {
  const url = buildProjectsUrl("https://developer.api.autodesk.com/construction/buildingconnected/v2/projects", { updatedSince: "2026-08-01T00:00:00.000Z" });
  assert.equal(url, "https://developer.api.autodesk.com/construction/buildingconnected/v2/projects?filter[updatedAt]=2026-08-01T00%3A00%3A00.000Z..");
});

test("buildProjectsUrl leaves the base URL untouched with no updatedSince", () => {
  const base = "https://developer.api.autodesk.com/construction/buildingconnected/v2/projects";
  assert.equal(buildProjectsUrl(base, {}), base);
});
