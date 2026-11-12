"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const parser = require("../parser.js");
const headers = ["", "REF. NUMBER", "DATE & TIME OF USE", "BUILDING", "FACILITY", "BOOKED FOR", "USE TYPE", "CHARGES / CREDITS", "STATUS", ""];
const row = ["", "FIXTURE-BK-001", "16-Nov-2026 (Mon)\n14:00 - 17:00 (3hrs)", "Li Ka Shing Library", "LKSLIB Project Room 4-5", "Example User", "AdHoc", "15.75", "Confirmed", "VIEW EDIT CANCEL"];

test("parses the screenshot's semantic columns and preserves booking status", () => {
  const result = parser.parseBookingRows(headers, [row, [...row.slice(0, 1), "BK-PENDING", ...row.slice(2, 8), "Pending approval", row[9]]]);
  assert.equal(result.bookings.length, 2);
  assert.equal(result.warnings.length, 0);
  assert.equal(result.bookings[0].date, "2026-11-16");
  assert.equal(result.bookings[0].startTime, "14:00");
  assert.equal(result.bookings[0].room, "LKSLIB Project Room 4-5");
  assert.equal(result.bookings[1].status, "Pending approval");
});

test("supports reordered headers and a date/time split without positional assumptions", () => {
  const result = parser.parseBookingRows(["Status", "Room", "Booking date", "Reference number", "Booking time", "Building"], [
    ["Confirmed", "GSR 2-23", "18-Nov-2026", "BK-2", "13:00 – 17:00", "School of Business"]
  ]);
  assert.equal(result.bookings.length, 1);
  assert.equal(result.bookings[0].reference, "BK-2");
  assert.equal(result.bookings[0].endTime, "17:00");
});

test("reports malformed rows instead of silently creating a wrong event", () => {
  const invalid = [...row];
  invalid[2] = "31-Nov-2026 (Tue) 17:00 - 13:00";
  const result = parser.parseBookingRows(headers, [invalid]);
  assert.equal(result.bookings.length, 0);
  assert.equal(result.rowCount, 1);
  assert.match(result.warnings[0], /FIXTURE-BK-001.*date.*time range/);
});

test("ignores blank/repeated headers and deduplicates responsive copies by reference", () => {
  const result = parser.parseBookingRows(headers, [headers, [], row, row]);
  assert.equal(result.bookings.length, 1);
  assert.equal(result.rowCount, 2);
  assert.deepEqual(result.warnings, []);
});

test("does not misread an unrelated facility availability table as personal bookings", () => {
  assert.equal(parser.detectColumns(["Facility", "Date", "Available"]), null);
  assert.equal(parser.parseBookingRows(["Facility", "Date", "Available"], [["Room 1", "2026-11-16", "Yes"]]).bookings.length, 0);
});

test("preserves different slots with the same multi-booking reference", () => {
  const anotherDay = [...row];
  anotherDay[2] = "17-Nov-2026 (Tue) 14:00 - 17:00 (3hrs)";
  const anotherRoom = [...row];
  anotherRoom[4] = "LKSLIB Project Room 4-4";
  const result = parser.parseBookingRows(headers, [row, row, anotherDay, anotherRoom]);
  assert.equal(result.bookings.length, 3);
  assert.equal(new Set(result.bookings.map((booking) => booking.id)).size, 3);
});

test("semantic headers tolerate sorting glyphs on every column", () => {
  const sorted = headers.map((header) => header ? `${header} ▼` : "");
  assert.equal(parser.parseBookingRows(sorted, [row]).bookings.length, 1);
});

test("a normal empty booking message is not treated as a malformed booking", () => {
  const result = parser.parseBookingRows(headers, [["No records found"]]);
  assert.equal(result.bookings.length, 0);
  assert.equal(result.rowCount, 0);
  assert.deepEqual(result.warnings, []);
});

// Minimal structural DOM doubles exercise traversal/association without third-party DOM packages.
// Browser smoke tests separately run these paths against real nested iframe documents.
function fixtureDocument(origin = "https://fbs.intranet.smu.edu.sg") {
  const doc = { nodeType: 9, frames: [], tables: [], location: { origin }, defaultView: { origin,
    getComputedStyle: (element) => element.style || {} } };
  doc.documentElement = fixtureElement("html", doc);
  doc.querySelectorAll = (selector) => selector === "iframe, frame" ? doc.frames : doc.tables;
  return doc;
}

function fixtureElement(tag, doc, parent = null) {
  const element = { nodeType: 1, tagName: tag.toUpperCase(), ownerDocument: doc, parentElement: parent,
    children: [], style: {}, hidden: false, id: "", attributes: {}, getAttribute(name) { return this.attributes[name] || null; } };
  element.closest = function (selector) {
    if (!selector.startsWith("table,")) return null;
    let current = this;
    while (current) {
      if (current.tagName === "TABLE") return current;
      current = current.parentElement;
    }
    return null;
  };
  return element;
}

function fixtureTable(doc, id, rows) {
  const table = fixtureElement("table", doc, doc.documentElement);
  table.id = id;
  const elements = rows.map((values) => {
    const element = fixtureElement("tr", doc, table);
    element.children = values.map((text) => Object.assign(fixtureElement("td", doc, element), { innerText: text, textContent: text }));
    return element;
  });
  table.querySelectorAll = () => elements;
  doc.tables.push(table);
  return table;
}

function fixtureFrame(parent, child, { hidden = false, inaccessible = false } = {}) {
  const frame = fixtureElement("iframe", parent, parent.documentElement);
  frame.hidden = hidden;
  Object.defineProperty(frame, "contentDocument", { get() {
    if (inaccessible) throw new Error("Cross-origin frame access denied");
    return child;
  } });
  parent.frames.push(frame);
  return frame;
}

test("traverses visible nested documents of exactly the top document origin", () => {
  const top = fixtureDocument();
  const shell = fixtureDocument();
  const bookings = fixtureDocument();
  fixtureFrame(top, shell);
  fixtureFrame(shell, bookings);
  fixtureFrame(top, fixtureDocument(), { hidden: true });
  fixtureFrame(top, fixtureDocument("https://login.microsoftonline.com"));
  fixtureFrame(top, fixtureDocument("https://other.smu.edu.sg"));
  fixtureFrame(top, fixtureDocument("null"));
  fixtureFrame(top, null, { inaccessible: true });
  assert.deepEqual(parser.getAccessibleDocuments(top), [top, shell, bookings]);
});

test("does not combine opaque documents merely because their origin strings are null", () => {
  const top = fixtureDocument("null");
  fixtureFrame(top, fixtureDocument("null"));
  assert.deepEqual(parser.getAccessibleDocuments(top), [top]);
});

test("reads a header-only/data-only grid with matching IDs in a nested frame", () => {
  const top = fixtureDocument();
  const shell = fixtureDocument();
  const bookings = fixtureDocument();
  fixtureFrame(top, shell);
  fixtureFrame(shell, bookings);
  fixtureTable(bookings, "GridViewBooking_gv", [headers]);
  fixtureTable(bookings, "GridViewBooking_gv", [row]);
  const result = parser.extractBookings(top);
  assert.equal(result.bookings.length, 1);
  assert.equal(result.rowCount, 1);
  assert.equal(result.bookings[0].room, "LKSLIB Project Room 4-5");
  assert.deepEqual(result.warnings, []);
});

test("does not borrow a nearby table schema without matching explicit table IDs", () => {
  const doc = fixtureDocument();
  fixtureTable(doc, "booking-headers", [headers]);
  fixtureTable(doc, "unrelated-table", [row]);
  fixtureTable(doc, "", [row]);
  assert.equal(parser.extractBookings(doc).bookings.length, 0);
});

test("the native ASP.NET grid pager footer is not parsed as a malformed booking", () => {
  const doc = fixtureDocument();
  const table = fixtureTable(doc, "GridViewBooking_gv", [headers, row]);
  const originalRows = table.querySelectorAll();
  const footer = fixtureElement("tr", doc, table);
  footer.children = [Object.assign(fixtureElement("td", doc, footer), {innerText: "1 2", textContent: "1 2"})];
  footer.querySelectorAll = () => [{getAttribute: () => "javascript:__doPostBack('GridViewBooking$gv','Page$2')"}];
  table.querySelectorAll = () => [...originalRows, footer];
  const result = parser.extractBookings(doc);
  assert.equal(result.bookings.length, 1);
  assert.equal(result.rowCount, 1);
  assert.deepEqual(result.warnings, []);
});

test("matching split-grid IDs never associate across different frame documents", () => {
  const top = fixtureDocument();
  const child = fixtureDocument();
  fixtureFrame(top, child);
  fixtureTable(top, "GridViewBooking_gv", [headers]);
  fixtureTable(child, "GridViewBooking_gv", [row]);
  assert.equal(parser.extractBookings(top).bookings.length, 0);
});

test("conflicting schemas for a duplicate table ID cause a visible warning", () => {
  const doc = fixtureDocument();
  const swapped = [...headers];
  [swapped[1], swapped[4]] = [swapped[4], swapped[1]];
  fixtureTable(doc, "GridViewBooking_gv", [headers]);
  fixtureTable(doc, "GridViewBooking_gv", [swapped]);
  fixtureTable(doc, "GridViewBooking_gv", [row]);
  const result = parser.extractBookings(doc);
  assert.equal(result.bookings.length, 0);
  assert.match(result.warnings[0], /conflicting header layouts/);
});

test("deduplicates the same booking rendered across accessible documents", () => {
  const top = fixtureDocument();
  const child = fixtureDocument();
  fixtureFrame(top, child);
  fixtureTable(top, "normal-grid", [headers, row]);
  fixtureTable(child, "GridViewBooking_gv", [headers]);
  fixtureTable(child, "GridViewBooking_gv", [row, row]);
  const result = parser.extractBookings(top);
  assert.equal(result.bookings.length, 1);
  assert.equal(result.rowCount, 3);
});
