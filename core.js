/* Shared, dependency-free booking and calendar helpers. */
(function (global) {
  "use strict";

  const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
    jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  const pad = (value) => String(value).padStart(2, "0");

  function validDate(year, month, day) {
    if (year < 1900 || year > 9999 || month < 1 || month > 12 || day < 1) return null;
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
    return `${year}-${pad(month)}-${pad(day)}`;
  }

  function parseBookingDate(text) {
    const value = String(text || "").replace(/\u00a0/g, " ").trim();
    let match = value.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/);
    if (match) return validDate(Number(match[1]), Number(match[2]), Number(match[3]));
    match = value.match(/\b(\d{1,2})[\s-]+([a-z]{3,9})[\s-]+(\d{4})\b/i);
    if (match) return validDate(Number(match[3]), MONTHS[match[2].slice(0, 3).toLowerCase()] || 0, Number(match[1]));
    match = value.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);
    return match ? validDate(Number(match[3]), Number(match[2]), Number(match[1])) : null;
  }

  function parseClock(hours, minutes, meridiem) {
    let hour = Number(hours);
    const minute = Number(minutes);
    if (minute > 59 || hour > 23) return null;
    if (meridiem) {
      if (hour < 1 || hour > 12) return null;
      hour = hour % 12 + (/pm/i.test(meridiem) ? 12 : 0);
    }
    return `${pad(hour)}:${pad(minute)}`;
  }

  function timeToMinutes(time) {
    const match = String(time || "").match(/^(\d{2}):(\d{2})$/);
    if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) return NaN;
    return Number(match[1]) * 60 + Number(match[2]);
  }

  function parseTimeRange(text) {
    const match = String(text || "").replace(/\u00a0/g, " ").match(
      /\b(\d{1,2}):(\d{2})\s*(am|pm)?\s*(?:[-\u2013\u2014]|to)\s*(\d{1,2}):(\d{2})\s*(am|pm)?\b/i
    );
    if (!match) return null;
    // An isolated AM/PM suffix is ambiguous; do not guess and silently move a booking.
    if (Boolean(match[3]) !== Boolean(match[6])) return null;
    const startTime = parseClock(match[1], match[2], match[3]);
    const endTime = parseClock(match[4], match[5], match[6]);
    if (!startTime || !endTime || timeToMinutes(endTime) <= timeToMinutes(startTime)) return null;
    return { startTime, endTime };
  }

  function addDays(dateISO, days) {
    const checked = parseBookingDate(dateISO);
    if (!checked || !Number.isInteger(days)) throw new TypeError("Expected an ISO date and an integer day offset.");
    const date = new Date(`${checked}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
  }

  function startOfWeek(dateISO) {
    const checked = parseBookingDate(dateISO);
    if (!checked) throw new TypeError("Expected an ISO date.");
    const day = new Date(`${checked}T12:00:00Z`).getUTCDay();
    return addDays(checked, -((day + 6) % 7));
  }

  function singaporeToday(now = new Date()) {
    return new Date(new Date(now).getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
  }

  function formatDate(dateISO, options = { day: "numeric", month: "short", year: "numeric" }) {
    const checked = parseBookingDate(dateISO);
    if (!checked) return "";
    return new Intl.DateTimeFormat("en-SG", { ...options, timeZone: "Asia/Singapore" })
      .format(new Date(`${checked}T12:00:00+08:00`));
  }

  function isConfirmed(bookingOrStatus) {
    const status = typeof bookingOrStatus === "object" && bookingOrStatus !== null ? bookingOrStatus.status : bookingOrStatus;
    return String(status || "").trim().toLowerCase() === "confirmed";
  }

  function escapeICS(value) {
    return String(value || "").replace(/\\/g, "\\\\").replace(/\r\n|\r|\n/g, "\\n")
      .replace(/;/g, "\\;").replace(/,/g, "\\,");
  }

  // RFC 5545 limits physical content lines to 75 octets, including a continuation's leading space.
  function foldICS(line) {
    const encoder = new TextEncoder();
    const lines = [];
    let current = "";
    let bytes = 0;
    for (const character of line) {
      const length = encoder.encode(character).length;
      if (bytes + length > 75) {
        lines.push(current);
        current = " ";
        bytes = 1;
      }
      current += character;
      bytes += length;
    }
    lines.push(current);
    return lines.join("\r\n");
  }

  function utcTimestamp(dateISO, time) {
    if (!parseBookingDate(dateISO) || !Number.isFinite(timeToMinutes(time))) throw new TypeError("Invalid booking date or time.");
    return new Date(`${dateISO}T${time}:00+08:00`).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  }

  function stableId(booking) {
    // A multi-booking reference can be reused for several distinct room/time slots.
    return [booking.reference || booking.id || "booking", booking.date, booking.startTime, booking.endTime, booking.room].join("|");
  }

  function toICS(bookings, options = {}) {
    const now = options.now ? new Date(options.now) : new Date();
    const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
    const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//FBS Calendar//Room Bookings//EN", "CALSCALE:GREGORIAN", "X-WR-CALNAME:SMU FBS bookings"];
    const seen = new Set();
    for (const booking of bookings) {
      if (!isConfirmed(booking)) continue;
      if (!parseBookingDate(booking.date) || !booking.room || !Number.isFinite(timeToMinutes(booking.startTime)) ||
        !Number.isFinite(timeToMinutes(booking.endTime)) || timeToMinutes(booking.endTime) <= timeToMinutes(booking.startTime)) {
        throw new TypeError(`Cannot export invalid booking ${stableId(booking)}.`);
      }
      const id = stableId(booking);
      if (seen.has(id)) continue;
      seen.add(id);
      const description = [`Booking reference: ${booking.reference || booking.id || "Not provided"}`,
        booking.bookedFor ? `Booked for: ${booking.bookedFor}` : "", "Status: Confirmed",
        "Exported from the currently loaded FBS bookings. Re-export after changes; this file does not automatically sync."].filter(Boolean).join("\n");
      lines.push("BEGIN:VEVENT", `UID:${encodeURIComponent(id)}@smu-fbs-calendar.local`, `DTSTAMP:${stamp}`,
        `DTSTART:${utcTimestamp(booking.date, booking.startTime)}`, `DTEND:${utcTimestamp(booking.date, booking.endTime)}`,
        `SUMMARY:${escapeICS(booking.room)}`, `LOCATION:${escapeICS([booking.building, booking.room].filter(Boolean).join(" — "))}`,
        `DESCRIPTION:${escapeICS(description)}`, "STATUS:CONFIRMED", "END:VEVENT");
    }
    lines.push("END:VCALENDAR");
    return lines.map(foldICS).join("\r\n") + "\r\n";
  }

  const api = { parseBookingDate, parseTimeRange, timeToMinutes, addDays, startOfWeek, singaporeToday, formatDate, isConfirmed, toICS };
  global.FBSCore = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(globalThis);
