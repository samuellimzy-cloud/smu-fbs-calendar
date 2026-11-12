"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const {activatePager} = require("../pager-bridge.js");
const FBS = "https://fbs.intranet.smu.edu.sg";
const sourceURL = FBS + "/modules/homenavigation/mybookingstab.aspx";
const href = "javascript:__doPostBack('GridViewBooking$gv','Page$2')";
const request = {gridId: "GridViewBooking_gv", href, sourceUrl: sourceURL};

function element(doc, attributes = {}, parent = null) {
  return {nodeType: 1, ownerDocument: doc, parentElement: parent, style: {}, hidden: false, isConnected: true,
    className: "", id: attributes.id || "", attributes,
    getAttribute(name) { return this.attributes[name] ?? null; }, closest() { return null; }};
}

function document(url = sourceURL) {
  const doc = {URL: url, readyState: "complete", location: {href: url}, frames: [], tables: [], anchors: [],
    defaultView: {getComputedStyle: node => node.style},
    querySelectorAll(selector) {
      if (selector === "iframe, frame") return this.frames;
      if (selector === "a[href]") return this.anchors;
      return this.tables;
    }};
  doc.documentElement = element(doc);
  return doc;
}

function fixture() {
  const top = document(FBS + "/home");
  const shell = document(FBS + "/home.aspx#");
  const bookings = document();
  const frame = element(top);
  frame.contentDocument = shell;
  top.frames.push(frame);
  const nested = element(shell);
  nested.contentDocument = bookings;
  shell.frames.push(nested);
  bookings.tables.push(element(bookings, {id: "GridViewBooking_gv"}), element(bookings, {id: "GridViewBooking_gv"}));
  let clicks = 0;
  const anchor = element(bookings, {href});
  anchor.click = () => {clicks += 1;};
  bookings.anchors.push(anchor);
  return {top, shell, bookings, frame, nested, anchor, clicks: () => clicks};
}

function invoke(root, input = request) {
  // Serialize exactly as Chrome executeScript does: no module closure is present.
  return vm.runInNewContext(`(${activatePager.toString()})(request)`, {document: root, request: input, URL});
}

test("serialized MAIN-world pager activation traverses visible nested FBS documents and clicks once", () => {
  const setup = fixture();
  const result = invoke(setup.top);
  assert.equal(result.ok, true);
  assert.equal(result.clicked, true);
  assert.equal(result.page, 2);
  assert.equal(result.command, "number");
  assert.equal(setup.clicks(), 1);
});

test("foreign top pages or source URLs and non-paging actions are rejected", () => {
  const setup = fixture();
  assert.equal(invoke(document("https://example.invalid/home")).ok, false);
  for (const input of [
    {...request, sourceUrl: "https://example.invalid/mybookingstab.aspx"},
    {...request, sourceUrl: "https://fbs.intranet.smu.edu.sg.example.invalid/"},
    {...request, gridId: "OtherGrid"},
    {...request, href: "javascript:__doPostBack('GridViewBooking$gv','Cancel$2')"},
    {...request, href: href + ";cancelBooking()"},
    {...request, href: "javascript:__doPostBack('Another$GridViewBooking$gv','Page$2')"},
    {...request, href: "javascript:__doPostBack('GridViewBooking$gv','Page$0')"},
    {...request, href: "javascript:__doPostBack('GridViewBooking$gv','Page$9007199254740992')"}
  ]) assert.equal(invoke(setup.top, input).ok, false);
  assert.equal(setup.clicks(), 0);
});

test("hidden, foreign, inaccessible and replaced source documents cannot receive a click", () => {
  for (const mode of ["hidden", "foreign", "inaccessible", "replaced", "loading"]) {
    const setup = fixture();
    if (mode === "hidden") setup.nested.hidden = true;
    if (mode === "foreign") setup.bookings.URL = "https://other.smu.edu.sg/bookings";
    if (mode === "inaccessible") Object.defineProperty(setup.nested, "contentDocument", {get() {throw new Error("Denied");}});
    if (mode === "replaced") setup.bookings.URL = sourceURL + "?filter=changed";
    if (mode === "loading") setup.bookings.readyState = "loading";
    assert.equal(invoke(setup.top).ok, false, mode);
    assert.equal(setup.clicks(), 0, mode);
  }
});

test("unsafe, disabled, hidden, detached or stale native anchors are never activated", () => {
  for (const mode of ["onclick", "disabled", "aria", "class", "hidden", "detached", "href"]) {
    const setup = fixture();
    if (mode === "onclick") setup.anchor.attributes.onclick = "cancelBooking()";
    if (mode === "disabled") setup.anchor.disabled = true;
    if (mode === "aria") setup.anchor.attributes["aria-disabled"] = "true";
    if (mode === "class") setup.anchor.className = "aspNetDisabled";
    if (mode === "hidden") setup.anchor.style.display = "none";
    if (mode === "detached") setup.anchor.isConnected = false;
    if (mode === "href") setup.anchor.attributes.href = "javascript:__doPostBack('GridViewBooking$gv','Page$3')";
    assert.equal(invoke(setup.top).ok, false, mode);
    assert.equal(setup.clicks(), 0, mode);
  }
});

test("equivalent top and bottom pager controls activate only the first matching anchor", () => {
  const setup = fixture();
  const duplicate = element(setup.bookings, {href});
  let extraClicks = 0;
  duplicate.click = () => {extraClicks += 1;};
  setup.bookings.anchors.push(duplicate);
  assert.equal(invoke(setup.top).ok, true);
  assert.equal(setup.clicks(), 1);
  assert.equal(extraClicks, 0);
});

test("multiple matching documents or grid identities and an absent grid are rejected before any click", () => {
  for (const mode of ["documents", "grids", "absent"]) {
    const setup = fixture();
    if (mode === "documents") {
      const duplicate = element(setup.shell);
      duplicate.contentDocument = document();
      setup.shell.frames.push(duplicate);
    }
    if (mode === "grids") setup.bookings.tables.push(element(setup.bookings, {id: "prefix_GridViewBooking_gv"}));
    if (mode === "absent") setup.bookings.tables = [];
    assert.equal(invoke(setup.top).ok, false, mode);
    assert.equal(setup.clicks(), 0, mode);
  }
});

test("a bounded native activation failure returns an error without a second click", () => {
  const setup = fixture();
  let attempts = 0;
  setup.anchor.click = () => {attempts += 1; throw new Error("Page rejected activation");};
  const result = invoke(setup.top);
  assert.equal(result.ok, false);
  assert.equal(attempts, 1);
});
