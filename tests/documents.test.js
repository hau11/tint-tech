import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyDocumentLink, findDocumentLinks, analyzableDocuments, describeDocumentSet } from "../src/documents.js";

test("classifies document links by text and filename", () => {
  assert.equal(classifyDocumentLink("Final Specifications").type, "specifications");
  assert.equal(classifyDocumentLink("Final Plans").type, "plans");
  assert.equal(classifyDocumentLink("Invitation for Bid").type, "solicitation");
  assert.equal(classifyDocumentLink("Addendum No. 2").type, "addendum");
  assert.equal(classifyDocumentLink("Bid Form").type, "bid_form");
  assert.equal(classifyDocumentLink("Download", "_O2512-01 - Final Specs.pdf").type, "specifications");
  assert.equal(classifyDocumentLink("Download", "project-manual.pdf").type, "specifications");
  assert.equal(classifyDocumentLink("Pre-bid sign in sheet").type, "other");
});

// Mirrors the real Missouri OA-FMDC markup
const FMDC = `<table><tr>
<td>O2512-01</td>
<td>Replace Windows &amp; Tuckpoint Fletcher Daniels</td>
<td>8/27/2026
  <a href="/sites/default/files/bid-opportunities/_O2512-01%20-%20IFB.pdf">Invitation for Bid</a>
  <a href="/sites/default/files/bid-opportunities/_O2512-01%20-%20Final%20Plans.pdf">Plans</a>
  <a href="/sites/default/files/bid-opportunities/_O2512-01%20-%20Final%20Specs.pdf">Specifications</a>
  <a href="/sites/default/files/bid-opportunities/_O2512-01%20-%20Addendum%201.pdf">Addendum No. 1</a>
  <a href="/info">More info</a>
</td></tr></table>`;

test("finds every PDF on a real bid row and resolves relative URLs", () => {
  const docs = findDocumentLinks(FMDC, "https://oa.mo.gov/facilities/bid-opportunities/bid-listing");
  assert.equal(docs.length, 4, "4 PDFs, the HTML page link excluded");
  assert.ok(docs.every(d => d.url.startsWith("https://oa.mo.gov/")));
  const types = docs.map(d => d.type);
  assert.ok(types.includes("specifications"));
  assert.ok(types.includes("plans"));
  assert.ok(types.includes("addendum"));
  assert.ok(types.includes("solicitation"));
});
test("specs and plans sort ahead of paperwork", () => {
  const docs = findDocumentLinks(FMDC, "https://oa.mo.gov/x");
  assert.equal(docs[0].type, "specifications");
  assert.equal(docs[1].type, "plans");
});
test("filenames are decoded for display", () => {
  const docs = findDocumentLinks(FMDC, "https://oa.mo.gov/x");
  assert.ok(docs.some(d => d.filename.includes("Final Specs.pdf")));
});
test("duplicate links appear once", () => {
  const html = `<a href="/a.pdf">Plans</a><a href="/a.pdf">Plans</a>`;
  assert.equal(findDocumentLinks(html, "https://x.com").length, 1);
});
test("pages with no documents return an empty list, not an error", () => {
  assert.deepEqual(findDocumentLinks("<p>No files here</p>", "https://x.com"), []);
  assert.deepEqual(findDocumentLinks("", "https://x.com"), []);
});
test("analyzable set skips bid forms and supporting paperwork", () => {
  const docs = [
    { ext: "pdf", type: "specifications" }, { ext: "pdf", type: "plans" },
    { ext: "pdf", type: "bid_form" }, { ext: "pdf", type: "other" },
    { ext: "zip", type: "plans" }
  ];
  const a = analyzableDocuments(docs);
  assert.equal(a.length, 2);
  assert.ok(a.every(d => ["specifications", "plans"].includes(d.type)));
});
test("document set is described in plain language", () => {
  const docs = findDocumentLinks(FMDC, "https://oa.mo.gov/x");
  const desc = describeDocumentSet(docs);
  assert.match(desc, /Specification/);
  assert.equal(describeDocumentSet([]), "No downloadable documents found on the source page.");
});
