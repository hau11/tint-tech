import { test } from "node:test";
import assert from "node:assert/strict";
import { bcProjectToLead, buildAuthorizeUrl, redirectUri } from "../src/buildingconnected.js";

test("maps a plain BuildingConnected project to the standard lead shape", () => {
  const lead = bcProjectToLead({
    name: "Kansas City Airport Expansion — Window Film Package",
    description: "Security window film at first-floor storefront, solar control film on the tower curtain wall.",
    projectNumber: "KCI-2201",
    bidDate: "2026-09-17",
    url: "https://app.buildingconnected.com/projects/kci-2201",
    city: "Kansas City", state: "MO",
    owner: "Kansas City Aviation Department", generalContractor: "Burns & McDonnell"
  });
  assert.equal(lead.projectNo, "KCI-2201");
  assert.equal(lead.bidDate, "9/17/2026");
  assert.equal(lead.links.page, "https://app.buildingconnected.com/projects/kci-2201");
  assert.equal(lead.city, "Kansas City");
  assert.equal(lead.state, "MO");
  assert.equal(lead.owner, "Kansas City Aviation Department");
  assert.equal(lead.gc, "Burns & McDonnell");
  assert.equal(lead.source, "BuildingConnected");
  assert.equal(lead.relevance, "high");
  assert.ok(lead.filmTypes.includes("Security"));
});

test("unwraps a {project: {...}} envelope", () => {
  const lead = bcProjectToLead({ project: { name: "Curtain Wall Glazing Replacement", description: "Storefront and curtain wall glazing scope" } });
  assert.equal(lead.title, "Curtain Wall Glazing Replacement");
  assert.notEqual(lead.relevance, "excluded");
});

test("falls back gracefully on an empty/unrecognized payload", () => {
  const lead = bcProjectToLead({});
  assert.equal(lead.title, "Untitled BuildingConnected project");
  assert.equal(lead.projectNo, "-");
  assert.equal(lead.relevance, "excluded");
  assert.deepEqual(lead.links, {});
});

test("excludes leads with no film or glazing language", () => {
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
