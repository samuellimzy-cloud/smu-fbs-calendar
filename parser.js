/* Reads booking tables without clicking, navigating, or changing any FBS booking. */
(function (global) {
  "use strict";
  const core = global.FBSCore || (typeof require === "function" ? require("./core.js") : null);
  const clean = (value) => String(value || "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
  const TABLE_SELECTOR = "table, [role='table'], [role='grid']";

  function detectColumns(headers) {
    const columns = {};
    headers.forEach((header, index) => {
      const name = clean(header).toLowerCase().replace(/[.\u2019'\u2191\u2193\u2195\u25b2\u25bc\u25b4\u25be]/g, "").trim();
      if (/^(?:ref(?:erence)?\s*(?:number|no|#)|booking\s*(?:reference|ref|number|id))\b/.test(name)) columns.reference = index;
      else if (/date/.test(name) && /time/.test(name)) columns.dateTime = index;
      else if (/^(?:date(?: of use)?|booking date)$/.test(name)) columns.date = index;
      else if (/^(?:time(?: of use)?|booking time)$/.test(name)) columns.time = index;
      else if (/^(?:facility|room|facility name|room name)$/.test(name)) columns.room = index;
      else if (/^(?:building|building name)$/.test(name)) columns.building = index;
      else if (/^(?:booked for|booked by|booker)$/.test(name)) columns.bookedFor = index;
      else if (/^(?:status|booking status)$/.test(name)) columns.status = index;
    });
    return columns.reference !== undefined && columns.room !== undefined && columns.status !== undefined &&
      (columns.dateTime !== undefined || (columns.date !== undefined && columns.time !== undefined)) ? columns : null;
  }

  function parseBookingRows(headers, rows) {
    const columns = detectColumns(headers);
    const result = { bookings: [], warnings: [], rowCount: 0 };
    if (!columns) return result;
    const seen = new Set();
    for (const cells of rows) {
      if (!cells.some((cell) => clean(cell))) continue;
      const nonempty = cells.map(clean).filter(Boolean);
      if (nonempty.length === 1 && /^(?:no (?:records|bookings|items|data)|no matching|nothing found)\b/i.test(nonempty[0])) continue;
      // Repeated header rows are common in responsive tables.
      if (detectColumns(cells)) continue;
      result.rowCount += 1;
      const get = (key) => columns[key] === undefined ? "" : clean(cells[columns[key]]);
      const reference = get("reference");
      const dateText = columns.dateTime !== undefined ? get("dateTime") : get("date");
      const timeText = columns.dateTime !== undefined ? get("dateTime") : get("time");
      const date = core.parseBookingDate(dateText);
      const range = core.parseTimeRange(timeText);
      const room = get("room");
      const status = get("status");
      const problems = [];
      if (!reference) problems.push("missing booking reference");
      if (!date) problems.push("unrecognised date");
      if (!range) problems.push("unrecognised or invalid time range");
      if (!room) problems.push("missing facility");
      if (!status) problems.push("missing booking status");
      if (problems.length) {
        result.warnings.push(`${reference || `Row ${result.rowCount}`}: ${problems.join(", ")}.`);
        continue;
      }
      // Responsive copies can repeat a row; multi-booking references can also contain distinct slots.
      const id = [reference, date, range.startTime, range.endTime, room].join("|");
      if (seen.has(id)) continue;
      seen.add(id);
      result.bookings.push({ id, reference, date, ...range, building: get("building"), room,
        bookedFor: get("bookedFor"), status });
    }
    return result;
  }

  function isVisible(element) {
    let current = element;
    while (current && current.nodeType === 1) {
      if (current.hidden || current.getAttribute("aria-hidden") === "true") return false;
      if (current.closest && current.closest("[data-fbs-calendar-root], [data-fbs-calendar], #fbs-calendar-host, #smu-fbs-calendar-extension")) return false;
      const view = current.ownerDocument && current.ownerDocument.defaultView;
      const style = view && typeof view.getComputedStyle === "function" ? view.getComputedStyle(current) : current.style;
      if (style && (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse")) return false;
      current = current.parentElement;
    }
    return true;
  }

  function documentOrigin(doc) {
    try {
      // Window.origin reports an about:blank/srcdoc document's inherited security origin.
      // Location.origin alone serializes those URLs as "null" even when they inherit the parent.
      const view = doc.defaultView;
      if (view && typeof view.origin === "string") return view.origin;
      if (doc.location && typeof doc.location.origin === "string") return doc.location.origin;
      return doc.URL ? new URL(doc.URL).origin : null;
    } catch (_) {
      return null;
    }
  }

  function getAccessibleDocuments(root = document) {
    const rootDocument = root.nodeType === 9 ? root : root.ownerDocument;
    if (!rootDocument) return [];
    const documents = [rootDocument];
    const seen = new Set(documents);
    const origin = documentOrigin(rootDocument);
    // Keep single-document local demos working, but do not treat all opaque/file origins as one origin.
    if (!origin || origin === "null") return documents;
    function visit(scope) {
      for (const frame of scope.querySelectorAll("iframe, frame")) {
        if (!isVisible(frame)) continue;
        try {
          const child = frame.contentDocument;
          if (!child || seen.has(child) || documentOrigin(child) !== origin) continue;
          // Access can fail while a frame is navigating or is sandboxed/cross-origin.
          if (!child.documentElement) continue;
          seen.add(child);
          documents.push(child);
          visit(child);
        } catch (_) {
          // Cross-origin/sandboxed frames are outside the current user's visible FBS document scope.
        }
      }
    }
    visit(root);
    return documents;
  }

  function describeTables(scope) {
    const tables = Array.from(scope.querySelectorAll(TABLE_SELECTOR));
    if (scope.matches && scope.matches(TABLE_SELECTOR)) tables.unshift(scope);
    return tables.filter(isVisible).map((table) => {
      const rows = Array.from(table.querySelectorAll("tr, [role='row']"))
        .filter((row) => row.closest(TABLE_SELECTOR) === table && isVisible(row))
        .filter((row) => {
          // ASP.NET can put the numbered pager inside a spanning grid footer cell.
          // It is navigation, not an incomplete booking row.
          if (table.id !== "GridViewBooking_gv" || row.children.length !== 1 || !row.querySelectorAll) return true;
          return ![...row.querySelectorAll("a[href]")].some(link =>
            /^javascript:\s*__doPostBack\(\s*(['"])GridViewBooking\$gv\1\s*,\s*(['"])Page\$(?:\d+|First|Last|Next|Prev(?:ious)?)\2\s*\)\s*;?$/i.test(link.getAttribute("href") || ""));
        });
      const rowCells = rows.map((row) => Array.from(row.children)
        .filter((cell) => /^(TH|TD)$/.test(cell.tagName) || /^(cell|columnheader|gridcell|rowheader)$/.test(cell.getAttribute("role") || ""))
        .map((cell) => clean(cell.innerText || cell.textContent)));
      const headerIndex = rowCells.findIndex((cells) => detectColumns(cells));
      return { table, id: clean(table.id), rowCells, headerIndex };
    });
  }

  function sharedHeaders(descriptor, descriptors) {
    if (!descriptor.id) return { headers: null, ambiguous: false };
    // FBS's scrolling grid renders a header-only table and a data-only table with the same ID.
    // Never borrow a nearby table's schema merely because it appears before this table.
    const candidates = descriptors.filter((candidate) => candidate !== descriptor && candidate.id === descriptor.id && candidate.headerIndex >= 0);
    const schemas = new Map();
    for (const candidate of candidates) {
      const headers = candidate.rowCells[candidate.headerIndex];
      const columns = detectColumns(headers);
      const signature = JSON.stringify([headers.length, ...Object.keys(columns).sort().map((key) => [key, columns[key]])]);
      schemas.set(signature, headers);
    }
    return { headers: schemas.size === 1 ? schemas.values().next().value : null, ambiguous: schemas.size > 1 };
  }

  function extractBookings(root = document) {
    const result = { bookings: [], warnings: [], tableCount: 0, rowCount: 0 };
    const seen = new Set();
    for (const doc of getAccessibleDocuments(root)) {
      const scope = doc === (root.nodeType === 9 ? root : root.ownerDocument) ? root : doc;
      const descriptors = describeTables(scope);
      for (const descriptor of descriptors) {
        let headers;
        let dataRows;
        if (descriptor.headerIndex >= 0) {
          headers = descriptor.rowCells[descriptor.headerIndex];
          dataRows = descriptor.rowCells.slice(descriptor.headerIndex + 1);
        } else {
          const shared = sharedHeaders(descriptor, descriptors);
          if (shared.ambiguous) result.warnings.push(`Booking table ${descriptor.id} has conflicting header layouts; its rows were skipped.`);
          if (!shared.headers) continue;
          headers = shared.headers;
          dataRows = descriptor.rowCells;
        }
        result.tableCount += 1;
        const parsed = parseBookingRows(headers, dataRows);
        result.rowCount += parsed.rowCount;
        result.warnings.push(...parsed.warnings);
        for (const booking of parsed.bookings) {
          if (seen.has(booking.id)) continue;
          seen.add(booking.id);
          result.bookings.push(booking);
        }
      }
    }
    result.bookings.sort((a, b) => `${a.date} ${a.startTime}`.localeCompare(`${b.date} ${b.startTime}`) || a.reference.localeCompare(b.reference));
    return result;
  }

  const api = { extractBookings, getAccessibleDocuments, parseBookingRows, detectColumns };
  global.FBSParser = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(globalThis);
