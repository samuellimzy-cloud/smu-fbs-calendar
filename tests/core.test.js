"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../core.js");

const booking = { id: "FIXTURE-BK-001", reference: "FIXTURE-BK-001", date: "2026-11-16", startTime: "14:00", endTime: "17:00",
  room: "LKSLIB Project Room 4-5", building: "Li Ka Shing Library", bookedFor: "Example User", status: "Confirmed" };

test("parses FBS English dates, numeric dates and leap dates without rollover", () => {
  assert.equal(core.parseBookingDate("16-Nov-2026 (Mon) 14:00 - 17:00 (3hrs)"), "2026-11-16");
  assert.equal(core.parseBookingDate("29 February 2024 (Thu)"), "2024-02-29");
  assert.equal(core.parseBookingDate("29-Feb-2025"), null);
  assert.equal(core.parseBookingDate("31/04/2026"), null);
  assert.equal(core.parseBookingDate("2026-11-17"), "2026-11-17");
  assert.equal(core.parseBookingDate("16-Not-2026"), null);
});

test("parses actual 24-hour rows, en dashes and 12-hour ranges; rejects invalid ranges", () => {
  assert.deepEqual(core.parseTimeRange("16-Nov-2026 (Mon) 14:00 - 17:00 (3hrs)"), { startTime: "14:00", endTime: "17:00" });
  assert.deepEqual(core.parseTimeRange("08:30–10:00"), { startTime: "08:30", endTime: "10:00" });
  assert.deepEqual(core.parseTimeRange("11:00 AM to 2:00 PM"), { startTime: "11:00", endTime: "14:00" });
  assert.equal(core.parseTimeRange("14:00-14:00"), null);
  assert.equal(core.parseTimeRange("17:00-14:00"), null);
  assert.equal(core.parseTimeRange("08:60-10:00"), null);
  assert.equal(core.parseTimeRange("24:00-25:00"), null);
  assert.equal(core.parseTimeRange("2:00 - 5:00 PM"), null);
});

test("week arithmetic crosses year boundaries and uses Singapore date", () => {
  assert.equal(core.startOfWeek("2027-01-01"), "2026-12-28");
  assert.equal(core.addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(core.addDays("2024-03-01", -1), "2024-02-29");
  assert.equal(core.singaporeToday(new Date("2026-11-12T16:30:00Z")), "2026-11-13");
});

test("ICS exports only confirmed bookings with correct UTC times and stable IDs", () => {
  const ics = core.toICS([booking, booking, { ...booking, reference: "CANCELLED", status: "Cancelled" }, { ...booking, reference: "PENDING", status: "Pending" }], { now: "2026-11-12T00:00:00Z" });
  assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, 1);
  assert.match(ics.replace(/\r\n /g, ""), /UID:FIXTURE-BK-001%7C2026-11-16%7C14%3A00%7C17%3A00%7CLKSLIB%20Project%20Room%204-5@smu-fbs-calendar\.local\r\n/);
  assert.match(ics, /DTSTART:20261116T060000Z\r\n/);
  assert.match(ics, /DTEND:20261116T090000Z\r\n/);
  assert.match(ics, /DTSTAMP:20261112T000000Z\r\n/);
  assert.equal(ics.includes("CANCELLED"), false);
  assert.equal(ics.replace(/\r\n/g, "").includes("\n"), false);
});

test("ICS preserves distinct slots sharing a multi-booking reference", () => {
  const ics = core.toICS([booking, { ...booking, date: "2026-11-17" }, { ...booking, room: "Another room" }]);
  assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, 3);
  const uids = ics.replace(/\r\n /g, "").match(/^UID:.+$/gm);
  assert.equal(new Set(uids).size, 3);
});

test("ICS escapes unsafe content, folds by UTF-8 octets and preserves Unicode", () => {
  const room = "Project, room; \\ " + "图书馆😀".repeat(18) + "\nSecond line";
  const ics = core.toICS([{ ...booking, room }]);
  for (const line of ics.split("\r\n")) assert.ok(Buffer.byteLength(line, "utf8") <= 75);
  const unfolded = ics.replace(/\r\n /g, "");
  assert.ok(unfolded.includes("SUMMARY:Project\\, room\\; \\\\ "));
  assert.ok(unfolded.includes("图书馆😀".repeat(18)));
  assert.ok(unfolded.includes("\\nSecond line"));
  assert.equal(unfolded.includes("\uFFFD"), false);
});

test("ICS handles a booking just after Singapore midnight and rejects invalid confirmed data", () => {
  const ics = core.toICS([{ ...booking, startTime: "00:30", endTime: "01:00" }]);
  assert.match(ics, /DTSTART:20261115T163000Z/);
  assert.throws(() => core.toICS([{ ...booking, date: "2026-02-30" }]), /invalid booking/);
});
