"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const parser = require("../parser.js");
const {createCollector, pagerCommand} = require("../pagination.js");
const headers = ["", "REF. NUMBER", "DATE & TIME OF USE", "BUILDING", "FACILITY", "BOOKED FOR", "USE TYPE", "CHARGES / CREDITS", "STATUS", ""];

// Small structural doubles keep unit checks dependency-free. Browser scenarios
// separately exercise real DOM, nested frames, postback handlers and navigation.
function element(tag, doc, text = "", attrs = {}) {
  const node = {nodeType: 1, tagName: tag.toUpperCase(), ownerDocument: doc, parentElement: null, children: [], style: {}, hidden: false, attributes: attrs,
    id: attrs.id || "", className: attrs.class || "", getAttribute(name) { return this.attributes[name] ?? null; },
    append(child) { child.parentElement = this; this.children.push(child); return child; },
    querySelectorAll(selector) { return descendants(this).filter(child => matches(child, selector)); },
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; },
    closest(selector) { for (let item = this; item; item = item.parentElement) if (matches(item, selector)) return item; return null; }
  };
  Object.defineProperty(node, "textContent", {get() { return [text, ...this.children.map(child => child.textContent)].filter(Boolean).join(" "); }});
  Object.defineProperty(node, "innerText", {get() { return this.textContent; }});
  return node;
}
function descendants(node) { return node.children.flatMap(child => [child, ...descendants(child)]); }
function matches(node, selectors) {
  return selectors.split(",").some(value => {
    const selector = value.trim();
    if (selector === "[data-fbs-calendar]" || selector === "#smu-fbs-calendar-extension") return false;
    if (selector.startsWith("[role=")) return node.getAttribute("role") === /['"]([^'"]+)['"]/.exec(selector)?.[1] && (!selector.endsWith("[id]") || !!node.id);
    const match = /^(\w+)(?:\[(\w+)\])?$/.exec(selector);
    return !!match && node.tagName === match[1].toUpperCase() && (!match[2] || match[2] === "id" ? !!node.id || !match[2] : node.getAttribute(match[2]) !== null);
  });
}
function document(url) {
  const doc = {nodeType: 9, URL: url, readyState: "complete", defaultView: {origin: new URL(url).origin, getComputedStyle: node => node.style},
    location: {href: url, origin: new URL(url).origin}, querySelectorAll(selector) { return descendants(this.documentElement).filter(node => matches(node, selector)); },
    getElementById(id) { return descendants(this.documentElement).find(node => node.id === id) || null; }};
  doc.documentElement = element("html", doc);
  doc.body = doc.documentElement.append(element("body", doc));
  return doc;
}
function record(index, changes = {}) {
  return {reference: `TEST-${index}`, dateTime: "16-Nov-2026 (Mon) 11:00 - 12:00 (1hr)", room: `Room ${index}`, status: "Confirmed", ...changes};
}
function fixture(options = {}) {
  const records = options.records || Array.from({length: 15}, (_, index) => record(index + 1));
  const size = options.pageSize || 10;
  const state = {page: options.startPage || 1, rowsPage: options.startPage || 1, clock: 0, total: options.total ?? records.length, filter: "", account: "Synthetic Student", visits: [], clicks: [], scheduled: [], ready: true};
  const top = document("https://fbs.intranet.smu.edu.sg/home");
  function build() {
    top.body.children = [];
    top.body.append(element("a", top, state.account, {id: "menu_linkName"}));
    const doc = document(`https://fbs.intranet.smu.edu.sg/modules/homenavigation/mybookingstab.aspx?page=${state.page}`);
    doc.readyState = state.ready ? "complete" : "loading";
    const form = doc.body.append(element("form", doc));
    const layout = form.append(element("table", doc));
    const layoutRow = layout.append(element("tr", doc));
    const filter = layoutRow.append(element("td", doc)).append(element("input", doc, "", {id: "search-filter"}));
    filter.type = "text"; filter.value = state.filter;
    const grid = form.append(element("div", doc));
    const heading = grid.append(element("table", doc, "", {id: "GridViewBooking_gv"}));
    const headingRow = heading.append(element("tr", doc));
    headers.forEach(text => headingRow.append(element("th", doc, text)));
    const table = grid.append(element("table", doc, "", {id: "GridViewBooking_gv"}));
    let rows = records.slice((state.rowsPage - 1) * size, state.rowsPage * size);
    if (options.rowsForPage) rows = options.rowsForPage(state.rowsPage, rows);
    for (const item of rows) {
      const row = table.append(element("tr", doc));
      ["", item.reference, item.dateTime, "Synthetic Building", item.room, "Demo Person", "AdHoc", "0", item.status, "VIEW CANCEL"].forEach(text => row.append(element("td", doc, text)));
    }
    let pager = form.append(element("div", doc, "", {class: "pager"}));
    if (options.nestedFooter) pager = table.append(element("tr", doc)).append(element("td", doc));
    const count = options.hidePagerWhileLoading && !state.ready ? 0 : Math.ceil(records.length / size);
    for (let page = 1; page <= count; page += 1) {
      if (page === state.page) pager.append(element("span", doc, String(page)));
      else {
        const link = pager.append(element("a", doc, options.wrappedLabels ? "" : String(page), {href: `javascript:__doPostBack('GridViewBooking$gv','Page$${page}')`}));
        if (options.wrappedLabels) link.append(element("span", doc, String(page)));
        if (options.onclick) link.attributes.onclick = options.onclick;
        link.click = () => {
          state.visits.push(page);
          state.clicks.push(link.getAttribute("href"));
          if (options.onClick?.(page, state) === false) return;
          if (options.markerFirst) {
            state.page = page;
            build();
            state.scheduled.push({at: state.clock + (options.delay || 40), action: () => {state.rowsPage = page; build();}});
          } else { state.page = state.rowsPage = page; build(); }
        };
      }
    }
    if (options.extraControls) options.extraControls(doc, form, state, element);
    if (!options.omitTotal) form.append(element("span", doc, `${state.total} ITEM(S) TOTAL`));
    state.doc = doc;
  }
  build();
  const api = {...parser, getAccessibleDocuments: () => {options.onDocuments?.(state); return [top, state.doc];}};
  const collector = createCollector({root: top, parser: api, timeoutMs: options.timeoutMs || 120, pollMs: 10,
    activatePager: options.activatePager ? request => options.activatePager(request, state, build) : undefined,
    maxDurationMs: options.maxDurationMs || 1200, maxPages: options.maxPages || 200,
    now: () => state.clock, sleep: async ms => {
      state.clock += ms;
      options.onSleep?.(state);
      const ready = state.scheduled.filter(job => job.at <= state.clock);
      state.scheduled = state.scheduled.filter(job => job.at > state.clock);
      ready.forEach(job => job.action());
      if (options.rebuildOnSleep) build();
    }});
  return {state, collector, build};
}

test("only exact recognized native grid paging commands can be activated", () => {
  assert.deepEqual(pagerCommand("javascript:__doPostBack('GridViewBooking$gv','Page$2')"), {gridId: "GridViewBooking_gv", page: 2, command: "number"});
  assert.equal(pagerCommand('javascript:__doPostBack("prefix$GridViewBooking$gv", "Page$Next");').command, "next");
  for (const value of ["javascript:__doPostBack('GridViewBooking$gv','Cancel$2')", "javascript:__doPostBack('OtherGrid','Page$2')", "javascript:__doPostBack('GridViewBooking$gv','Page$0')", "javascript:__doPostBack('GridViewBooking$gv','Page$2');steal()", "https://example.invalid/Page$2"]) assert.equal(pagerCommand(value), null);
});

test("collects ten plus five rows and restores page one", async () => {
  const {state, collector} = fixture();
  assert.equal(collector.inspect().currentPage, 1);
  assert.equal(collector.inspect().totalItems, 15);
  const progress = [];
  const result = await collector.collect({onProgress: value => progress.push(value)});
  assert.equal(result.pagination.complete, true);
  assert.equal(result.pagination.pagesRead, 2);
  assert.equal(result.pagination.totalPages, 2);
  assert.equal(result.pagination.restored, true);
  assert.equal(result.bookings.length, 15);
  assert.equal(result.rowCount, 15);
  assert.deepEqual(state.visits, [2, 1]);
  assert.deepEqual(progress.map(value => value.page), [1, 2]);
  assert.equal(state.page, 1);
});

test("opening from page two includes page one and restores the starting page", async () => {
  const {state, collector} = fixture({startPage: 2});
  const result = await collector.collect();
  assert.equal(result.pagination.complete, true);
  assert.equal(result.bookings.length, 15);
  assert.equal(result.pagination.restored, true);
  assert.deepEqual(state.visits, [1, 2]);
  assert.equal(state.page, 2);
});

test("the worker bridge receives exact pager requests without invoking native element clicks", async () => {
  const requests = [];
  const {state, collector} = fixture({activatePager: async (request, source, build) => {
    requests.push({...request});
    const command = pagerCommand(request.href);
    assert.equal(command.gridId, request.gridId);
    source.page = source.rowsPage = command.page;
    build();
  }});
  const result = await collector.collect();
  assert.equal(result.pagination.complete, true);
  assert.equal(result.pagination.restored, true);
  assert.equal(result.bookings.length, 15);
  assert.equal(state.page, 1);
  assert.deepEqual(state.visits, [], "native element.click must not run when the bridge is configured");
  assert.deepEqual(state.clicks, []);
  assert.deepEqual(requests, [
    {gridId: "GridViewBooking_gv", href: "javascript:__doPostBack('GridViewBooking$gv','Page$2')", sourceUrl: "https://fbs.intranet.smu.edu.sg/modules/homenavigation/mybookingstab.aspx?page=1"},
    {gridId: "GridViewBooking_gv", href: "javascript:__doPostBack('GridViewBooking$gv','Page$1')", sourceUrl: "https://fbs.intranet.smu.edu.sg/modules/homenavigation/mybookingstab.aspx?page=2"}
  ]);
});

test("a rejected worker bridge aborts promptly and leaves the result incomplete", async () => {
  const requests = [];
  const {state, collector} = fixture({activatePager: async request => {
    requests.push(request);
    throw new Error("The paging bridge is unavailable. Reload the extension and FBS tab.");
  }});
  const result = await collector.collect();
  assert.equal(result.pagination.complete, false);
  assert.match(result.pagination.error, /paging bridge is unavailable/);
  assert.equal(result.pagination.pagesRead, 1);
  assert.equal(result.pagination.restored, true);
  assert.equal(requests.length, 1);
  assert.deepEqual(state.visits, []);
  assert.deepEqual(state.clicks, []);
  assert.equal(state.page, 1);
  assert.ok(state.clock < 120, "bridge rejection must not wait for the page-load timeout");
});

test("single-page and empty recognized grids need no paging clicks", async () => {
  for (const count of [0, 4]) {
    const {state, collector} = fixture({records: Array.from({length: count}, (_, index) => record(index))});
    const result = await collector.collect();
    assert.equal(result.pagination.complete, true);
    assert.equal(result.pagination.paged, false);
    assert.equal(result.bookings.length, count);
    assert.deepEqual(state.visits, []);
  }
});

test("waits for rows after the marker changes, including original-page restoration", async () => {
  const {state, collector} = fixture({markerFirst: true, delay: 50});
  const result = await collector.collect();
  assert.equal(result.pagination.complete, true);
  assert.equal(result.pagination.restored, true);
  assert.equal(result.bookings.length, 15);
  assert.equal(state.rowsPage, 1);
  assert.equal(state.scheduled.length, 0);
});

test("ignores matching pager rows nested inside the booking table", async () => {
  const {collector} = fixture({nestedFooter: true});
  const result = await collector.collect();
  assert.equal(result.pagination.complete, true);
  assert.equal(result.rowCount, 15);
  assert.deepEqual(result.warnings, []);
});

test("numeric labels wrapped inside anchors are not confused with the current-page span", async () => {
  const {collector} = fixture({startPage: 2, wrappedLabels: true});
  assert.equal(collector.inspect().currentPage, 2);
  assert.equal((await collector.collect()).pagination.complete, true);
});

test("hidden or unrelated grid controls cannot be clicked during collection", async () => {
  const {collector, state} = fixture({extraControls(doc, form, fixtureState, make) {
    const hidden = form.append(make("a", doc, "99", {href: "javascript:__doPostBack('GridViewBooking$gv','Page$99')"}));
    hidden.hidden = true;
    hidden.click = () => {throw new Error("Hidden pager clicked");};
    const other = form.append(make("a", doc, "99", {href: "javascript:__doPostBack('AnotherGrid','Page$99')"}));
    other.click = () => {throw new Error("Other grid clicked");};
    const cancel = form.append(make("a", doc, "Cancel", {href: "javascript:__doPostBack('GridViewBooking$gv','Cancel$1')"}));
    cancel.click = () => {throw new Error("Cancellation clicked");};
  }});
  assert.equal((await collector.collect()).pagination.complete, true);
  assert.deepEqual(state.visits, [2, 1]);
});

test("same multi-booking reference keeps distinct slots", async () => {
  const records = Array.from({length: 15}, (_, index) => record(index + 1, {reference: index < 2 ? "MULTI-SLOT" : `TEST-${index + 1}`}));
  const {collector} = fixture({records});
  const result = await collector.collect();
  assert.equal(result.pagination.complete, true);
  assert.equal(result.bookings.filter(item => item.reference === "MULTI-SLOT").length, 2);
});

test("stalled native pager cannot produce an apparently complete export", async () => {
  const {state, collector} = fixture({onClick: page => page === 2 ? false : undefined});
  const result = await collector.collect();
  assert.equal(result.pagination.complete, false);
  assert.match(result.pagination.error, /did not finish loading/);
  assert.equal(result.pagination.restored, true);
  assert.equal(state.page, 1);
});

test("repeated or truncated page data is marked incomplete", async () => {
  for (const kind of ["repeat", "truncate"]) {
    const original = Array.from({length: 15}, (_, index) => record(index + 1));
    const {collector} = fixture({records: original, rowsForPage: (page, rows) => page === 2 ? kind === "repeat" ? original.slice(0, 10) : rows.slice(0, 4) : rows});
    const result = await collector.collect();
    assert.equal(result.pagination.complete, false, kind);
    assert.match(result.pagination.error, /incomplete|do not match/);
  }
});

test("changed account, filter inside a layout table, or total discards collected rows", async () => {
  for (const field of ["account", "filter", "total"]) {
    const {collector} = fixture({onClick(page, state) { if (page === 2) state[field] = field === "total" ? 16 : "changed"; }});
    const result = await collector.collect();
    assert.equal(result.pagination.complete, false, field);
    assert.equal(result.bookings.length, 0, field);
    assert.match(result.pagination.error, /account, search or booking total changed/);
  }
});

test("inline side effects make a pager link ineligible", async () => {
  const {state, collector} = fixture({onclick: "cancelBooking();"});
  const result = await collector.collect();
  assert.equal(result.pagination.complete, false);
  assert.deepEqual(state.visits, []);
});

test("unparsed rows do not satisfy the advertised source total", async () => {
  const records = Array.from({length: 15}, (_, index) => record(index + 1));
  records[12].dateTime = "not a date";
  const {collector} = fixture({records});
  const result = await collector.collect();
  assert.equal(result.pagination.complete, false);
  assert.match(result.warnings.join(" "), /Page 2.*date/);
});

test("concurrent collection is single-flight and no old rows leak into the next read", async () => {
  const records = Array.from({length: 15}, (_, index) => record(index + 1));
  const {collector, state, build} = fixture({records});
  const first = collector.collect();
  const second = collector.collect();
  assert.equal(first, second);
  assert.equal((await first).bookings.length, 15);
  state.filter = "a new filter";
  build();
  assert.equal((await collector.collect()).pagination.complete, true);
  assert.deepEqual(state.visits, [2, 1, 2, 1]);
  records.splice(4);
  state.total = 4;
  build();
  const changed = await collector.collect();
  assert.equal(changed.pagination.complete, true);
  assert.equal(changed.bookings.length, 4);
});

test("initial loading waits for the document and pager instead of accepting the first ten rows", async () => {
  const setup = fixture({hidePagerWhileLoading: true, rebuildOnSleep: true,
    onSleep(state) { if (state.clock >= 30) state.ready = true; },
    onClick(page, state) { assert.ok(state.clock >= 40); }});
  setup.state.ready = false;
  setup.build();
  const result = await setup.collector.collect();
  assert.equal(result.pagination.complete, true);
  assert.equal(result.bookings.length, 15);
});

test("transient initial header/document replacement is retried", async () => {
  const {collector} = fixture({onDocuments(state) { if (state.clock < 20) throw new Error("Grid is being replaced"); }});
  const result = await collector.collect();
  assert.equal(result.pagination.complete, true);
  assert.equal(result.bookings.length, 15);
});

test("an unrecognized empty source cannot be marked complete", async () => {
  let clock = 0;
  const collector = createCollector({root: {}, parser: {getAccessibleDocuments: () => [], extractBookings: () => ({bookings: [], warnings: [], rowCount: 0, tableCount: 0})},
    now: () => clock, sleep: async ms => {clock += ms;}, timeoutMs: 30, pollMs: 10});
  const result = await collector.collect();
  assert.equal(result.pagination.complete, false);
  assert.match(result.pagination.error, /did not finish loading/);
});

test("single-page malformed rows remain incomplete with or without an advertised total", async () => {
  for (const omitTotal of [false, true]) {
    const {collector} = fixture({records: [record(1), record(2, {dateTime: "invalid"})], omitTotal});
    const result = await collector.collect();
    assert.equal(result.pagination.complete, false);
    assert.match(result.pagination.error, /could not be read/);
  }
});

test("collection has a whole-operation time limit and restores when possible", async () => {
  const {collector, state} = fixture({records: Array.from({length: 35}, (_, index) => record(index + 1)), pageSize: 1, maxDurationMs: 100});
  const result = await collector.collect();
  assert.equal(result.pagination.complete, false);
  assert.equal(state.page, 1);
  assert.ok(state.clock <= 120);
});
