/* Reads every My Bookings page through the grid's own paging controls. */
(function (global) {
  "use strict";
  const GRID = /(?:^|_)GridViewBooking_gv$/;
  const TABLES = "table, [role='table'], [role='grid']";
  const clean = value => String(value || "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
  const number = value => /^\d+$/.test(String(value)) && Number(value) > 0 && Number.isSafeInteger(Number(value)) ? Number(value) : null;

  function visible(element) {
    for (let node = element; node?.nodeType === 1; node = node.parentElement) {
      if (node.hidden || node.getAttribute("aria-hidden") === "true") return false;
      if (node.closest?.("[data-fbs-calendar], #smu-fbs-calendar-extension")) return false;
      const style = node.ownerDocument?.defaultView?.getComputedStyle?.(node) || node.style;
      if (style && ["none", "hidden", "collapse"].includes(style.display === "none" ? "none" : style.visibility)) return false;
    }
    return true;
  }

  function pagerCommand(value) {
    // Never evaluate hrefs, call __doPostBack ourselves, or submit arbitrary forms.
    const match = /^javascript:\s*__doPostBack\(\s*(['"])([^'"]+)\1\s*,\s*(['"])Page\$(\d+|Next|Prev|Previous|First|Last)\3\s*\)\s*;?\s*$/i.exec(String(value || ""));
    if (!match) return null;
    const gridId = match[2].replace(/\$/g, "_");
    if (!GRID.test(gridId)) return null;
    const page = number(match[4]);
    if (!page && /^\d+$/.test(match[4])) return null;
    return {gridId, page, command: page ? "number" : match[4].toLowerCase()};
  }

  function rowCells(table) {
    return [...table.querySelectorAll("tr, [role='row']")]
      .filter(row => row.closest(TABLES) === table && visible(row) && ![...row.querySelectorAll("a[href]")].some(link => pagerCommand(link.getAttribute("href"))?.gridId === table.id))
      .map(row => [...row.children]
        .filter(cell => /^(TH|TD)$/.test(cell.tagName) || /^(cell|columnheader|gridcell|rowheader)$/.test(cell.getAttribute("role") || ""))
        .map(cell => clean(cell.innerText || cell.textContent)));
  }

  function gridRows(tables, parser) {
    const descriptors = tables.map(table => { const rows = rowCells(table); return {rows, header: rows.findIndex(cells => parser.detectColumns(cells))}; });
    const schemas = new Map();
    for (const descriptor of descriptors) {
      if (descriptor.header < 0) continue;
      const headers = descriptor.rows[descriptor.header];
      schemas.set(JSON.stringify(parser.detectColumns(headers)), headers);
    }
    if (schemas.size !== 1) throw new Error("The FBS booking grid has missing or conflicting headings. Refresh My Bookings and try again.");
    const headers = [...schemas.values()][0];
    const result = {bookings: [], warnings: [], tableCount: tables.length, rowCount: 0};
    const seen = new Set();
    for (const descriptor of descriptors) {
      const parsed = parser.parseBookingRows(headers, descriptor.header >= 0 ? descriptor.rows.slice(descriptor.header + 1) : descriptor.rows);
      result.rowCount += parsed.rowCount;
      result.warnings.push(...parsed.warnings);
      for (const booking of parsed.bookings) {
        if (seen.has(booking.id)) continue;
        seen.add(booking.id);
        result.bookings.push(booking);
      }
    }
    return result;
  }

  function currentPage(links) {
    const values = new Set();
    for (const link of links) {
      for (let container = link.element.parentElement, depth = 0; container && depth < 6; container = container.parentElement, depth += 1) {
        if (clean(container.innerText || container.textContent).length > 400) break;
        const candidates = [];
        for (const node of container.querySelectorAll("span, strong, b, button, a, li, td")) {
          if (!visible(node) || !number(clean(node.innerText || node.textContent))) continue;
          if (node.querySelector?.("a, button")) continue;
          const anchor = node.closest("a");
          if (anchor && !/\b(active|selected|current)\b/i.test(anchor.className || "") && anchor.getAttribute("aria-current") !== "page") continue;
          candidates.push(number(clean(node.innerText || node.textContent)));
        }
        if (candidates.length) { candidates.forEach(value => values.add(value)); break; }
      }
    }
    return values.size === 1 ? [...values][0] : null;
  }

  function sourceURL(doc) {
    try {
      const url = new URL(doc.URL || doc.location.href);
      // Native paging normally posts to the same URL. Some FBS layouts expose
      // a page query argument; all other arguments still identify the filter.
      for (const name of [...url.searchParams.keys()]) if (/^page$/i.test(name)) url.searchParams.delete(name);
      return url.origin + url.pathname + url.search;
    } catch (_) { return String(doc.URL || ""); }
  }

  function scopeFor(doc, docs, gridId) {
    const identities = docs.map(item => clean(item.getElementById?.("menu_linkName")?.textContent || item.getElementById?.("menu_userprofilemenu")?.textContent)).filter(Boolean);
    const filters = [...doc.querySelectorAll("input, select, textarea")].filter(control => {
      const type = String(control.type || "text").toLowerCase();
      const container = control.closest(TABLES);
      return visible(control) && !/^(hidden|password|checkbox|radio|submit|button|image|reset|file)$/.test(type) && !GRID.test(container?.id || "");
    }).map(control => [control.name || control.id || control.tagName, String(control.value || "")]);
    return JSON.stringify([sourceURL(doc), gridId, identities, filters]);
  }

  function createCollector(options = {}) {
    const root = options.root || global.document;
    const parser = options.parser || global.FBSParser;
    const timeoutMs = options.timeoutMs ?? 15000;
    const pollMs = Math.max(10, options.pollMs ?? 150);
    const maxPages = options.maxPages ?? 200;
    const maxDurationMs = options.maxDurationMs ?? 120000;
    const sleep = options.sleep || (ms => new Promise(resolve => setTimeout(resolve, ms)));
    const now = options.now || Date.now;
    let pending = null;

    function read() {
      const docs = parser.getAccessibleDocuments(root);
      const candidates = docs.map(doc => ({doc, tables: [...doc.querySelectorAll("table[id], [role='grid'][id]")].filter(table => GRID.test(table.id) && visible(table))})).filter(item => item.tables.length);
      if (candidates.length > 1) throw new Error("More than one FBS booking grid is visible. Open a single My Bookings list and try again.");
      if (!candidates.length) {
        const result = parser.extractBookings(root);
        return {result, doc: null, links: [], paged: false, currentPage: 1, totalItems: null, totalPages: 1,
          scopeKey: JSON.stringify(docs.map(sourceURL)), fingerprint: JSON.stringify(result), ready: docs.every(doc => !doc.readyState || doc.readyState === "complete")};
      }
      const {doc, tables} = candidates[0];
      const gridIds = new Set(tables.map(table => table.id));
      if (gridIds.size !== 1) throw new Error("The FBS booking grid is ambiguous. Refresh My Bookings and try again.");
      const gridId = tables[0].id;
      const result = gridRows(tables, parser);
      const links = [...doc.querySelectorAll("a[href]")].map(element => ({element, ...pagerCommand(element.getAttribute("href"))}))
        .filter(link => link.gridId === gridId && visible(link.element) && !clean(link.element.getAttribute("onclick")) && !link.element.disabled && link.element.getAttribute("aria-disabled") !== "true" && !/\bdisabled\b/i.test(link.element.className || ""));
      const totals = new Set([...clean(doc.body?.innerText || doc.body?.textContent).matchAll(/\b([\d,]+)\s*ITEM(?:\(S\)|S)?\s*TOTAL\b/gi)].map(match => Number(match[1].replace(/,/g, ""))));
      if (totals.size > 1) throw new Error("FBS displayed conflicting booking totals. Refresh My Bookings and try again.");
      const totalItems = totals.size ? [...totals][0] : null;
      const paged = links.length > 0 || totalItems !== null && totalItems > result.rowCount;
      const page = links.length ? currentPage(links) : paged ? null : 1;
      return {result, doc, links, paged, currentPage: page, totalItems,
        totalPages: paged ? Math.max(page || 1, ...links.map(link => link.page || 1)) : 1,
        scopeKey: scopeFor(doc, docs, gridId), fingerprint: JSON.stringify(result), ready: doc.readyState === "complete"};
    }

    function inspect() {
      try {
        const value = read();
        return {paged: value.paged, currentPage: value.currentPage, totalItems: value.totalItems, totalPages: value.totalPages, scopeKey: value.scopeKey};
      } catch (error) { return {paged: true, currentPage: null, totalItems: null, totalPages: null, scopeKey: "", error: error.message}; }
    }

    function sameScope(value, original) {
      if (value.scopeKey !== original.scopeKey || value.totalItems !== original.totalItems) {
        const error = new Error("Your FBS account, search or booking total changed while pages were loading. Load the list again before exporting.");
        error.code = "SOURCE_CHANGED";
        throw error;
      }
    }

    function route(value, target) {
      const exact = value.links.find(link => link.page === target);
      if (exact) return {link: exact, expected: target};
      if (target === 1) {
        const first = value.links.find(link => link.command === "first");
        if (first) return {link: first, expected: 1};
      }
      const forward = target > value.currentPage;
      const relative = value.links.find(link => forward ? link.command === "next" : ["prev", "previous"].includes(link.command));
      if (relative) return {link: relative, expected: value.currentPage + (forward ? 1 : -1)};
      if (!forward) {
        const previous = value.links.filter(link => link.page && link.page < value.currentPage).sort((a, b) => a.page - b.page)[0];
        if (previous) return {link: previous, expected: previous.page};
      }
      return null;
    }

    async function move(before, target, original, restoring = false, limit = Infinity, knownPages = null) {
      sameScope(before, original);
      if (now() >= limit) throw new Error("Loading all FBS pages took too long. Refresh My Bookings and retry before exporting.");
      const action = route(before, target);
      if (!action) throw new Error(`FBS did not expose a safe paging control for page ${target}.`);
      if (typeof action.link.element.click !== "function") throw new Error("The FBS paging control cannot be opened. Refresh My Bookings and try again.");
      if (options.activatePager) {
        await options.activatePager({gridId: action.link.gridId, href: action.link.element.getAttribute("href"), sourceUrl: before.doc.URL || before.doc.location.href});
      } else {
        action.link.element.click();
      }
      const expectedFingerprint = restoring ? knownPages?.get(action.expected) || (action.expected === original.currentPage ? original.fingerprint : null) : null;
      const deadline = Math.min(now() + timeoutMs, limit);
      let stable = null;
      while (now() <= deadline) {
        await sleep(pollMs);
        let value;
        try { value = read(); }
        catch (error) {
          // Full iframe navigation briefly removes the grid. Stable replacement
          // errors are surfaced by the timeout instead of reading detached rows.
          stable = null;
          continue;
        }
        if (!value.doc || !value.ready) { stable = null; continue; }
        sameScope(value, original);
        if (value.currentPage !== action.expected || (expectedFingerprint ? value.fingerprint !== expectedFingerprint : value.fingerprint === before.fingerprint)) { stable = null; continue; }
        if (stable === value.fingerprint) return value;
        stable = value.fingerprint;
      }
      throw new Error(`FBS page ${action.expected} did not finish loading. The full booking list is incomplete; retry before exporting.`);
    }

    async function run({onProgress} = {}) {
      const finalDeadline = now() + maxDurationMs;
      const mainDeadline = finalDeadline - Math.min(15000, timeoutMs * 2, maxDurationMs / 5);
      let original;
      let current;
      let complete = false;
      let restored = true;
      let error = null;
      let sourceChanged = false;
      let rowCount = 0;
      let totalPages = null;
      const pages = new Map();
      const bookings = new Map();
      const warnings = new Set();
      let baseline = {bookings: [], warnings: [], tableCount: 0, rowCount: 0};
      const progress = page => { if (typeof onProgress === "function") onProgress({pagesRead: pages.size, page, totalPages, totalItems: original?.totalItems ?? null}); };
      try {
        const initialDeadline = Math.min(now() + timeoutMs, mainDeadline);
        let stable = null;
        let initialError = null;
        do {
          let value;
          try { value = read(); }
          catch (failure) {
            initialError = failure;
            stable = null;
            await sleep(pollMs);
            continue;
          }
          baseline = value.result;
          const key = JSON.stringify([value.fingerprint, value.paged, value.currentPage, value.totalItems, value.scopeKey]);
          if (value.result.tableCount > 0 && value.ready && stable === key) { original = current = value; break; }
          stable = value.ready ? key : null;
          await sleep(pollMs);
        } while (now() <= initialDeadline);
        if (!original) throw initialError || new Error("The FBS booking grid did not finish loading. Open My Bookings and retry loading all pages.");
        baseline = original.result;
        if (!original.paged) {
          if (original.result.warnings.length) throw new Error("Some FBS booking rows could not be read. Resolve the booking data notices before exporting the full list.");
          if (original.totalItems !== null && (original.result.rowCount !== original.totalItems || original.result.bookings.length !== original.totalItems)) throw new Error("The FBS booking count does not match the displayed total. Refresh My Bookings and try again.");
          return {...original.result, pagination: {complete: true, paged: false, pagesRead: 1, totalPages: 1, totalItems: original.totalItems, restored: true}};
        }
        if (!original.currentPage) throw new Error("The current FBS page could not be identified safely. Open My Bookings and retry loading all pages.");
        let steps = 0;
        while (current.currentPage !== 1) {
          if (++steps > maxPages) throw new Error("The FBS pager exceeded the page limit while returning to page 1.");
          current = await move(current, 1, original, false, mainDeadline);
        }
        if (original.totalItems !== null) {
          if (current.result.rowCount < 1) throw new Error("FBS returned an empty first page for a non-empty booking list.");
          totalPages = Math.ceil(original.totalItems / current.result.rowCount);
          if (totalPages > maxPages) throw new Error(`The booking list exceeds the supported limit of ${maxPages} pages.`);
        }
        while (true) {
          if (now() >= mainDeadline) throw new Error("Loading all FBS pages took too long. Refresh My Bookings and try again before exporting.");
          sameScope(current, original);
          if (pages.has(current.currentPage) || [...pages.values()].includes(current.fingerprint)) throw new Error("FBS repeated a booking page. The full list could not be verified; retry before exporting.");
          pages.set(current.currentPage, current.fingerprint);
          rowCount += current.result.rowCount;
          for (const warning of current.result.warnings) warnings.add(`Page ${current.currentPage}: ${warning}`);
          for (const booking of current.result.bookings) {
            const prior = bookings.get(booking.id);
            if (prior && JSON.stringify(prior) !== JSON.stringify(booking)) throw new Error("A booking changed between FBS pages. Refresh the list and load all pages again.");
            bookings.set(booking.id, booking);
          }
          progress(current.currentPage);
          if (totalPages !== null && current.currentPage >= totalPages) break;
          const next = route(current, current.currentPage + 1);
          if (!next) {
            if (totalPages !== null || current.links.some(link => link.command === "last" || link.page > current.currentPage)) throw new Error("FBS is missing a page from its paging controls. Load all pages again before exporting.");
            totalPages = pages.size;
            break;
          }
          if (pages.size >= maxPages) throw new Error(`The booking list exceeds the supported limit of ${maxPages} pages.`);
          current = await move(current, current.currentPage + 1, original, false, mainDeadline);
        }
        if (warnings.size || original.totalItems !== null && (rowCount !== original.totalItems || bookings.size !== original.totalItems)) throw new Error("The collected bookings do not match FBS's total or contain unreadable rows. Some rows may have changed, repeated or failed to parse; refresh and retry before exporting.");
        complete = true;
      } catch (failure) {
        sourceChanged = failure.code === "SOURCE_CHANGED";
        error = failure.message || "The full FBS booking list could not be loaded.";
        warnings.add(error);
      } finally {
        if (original?.paged && original.currentPage) {
          try {
            current = read();
            sameScope(current, original);
            let steps = 0;
            while (current.currentPage !== original.currentPage) {
              if (!current.currentPage || ++steps > maxPages) throw new Error("The original FBS page could not be restored.");
              if (now() >= finalDeadline) throw new Error("The original FBS page could not be restored within the time limit.");
              current = await move(current, original.currentPage, original, true, finalDeadline, pages);
            }
            if (complete && pages.get(original.currentPage) !== current.fingerprint) {
              complete = false;
              error = "The original FBS page changed while bookings were loading. Refresh the list and load all pages again before exporting.";
              warnings.add(error);
            }
          } catch (failure) {
            restored = false;
            if (complete) {
              complete = false;
              error = "The original FBS page could not be verified after loading all pages. Refresh the list and retry before exporting.";
              warnings.add(error);
            }
            if (failure.code === "SOURCE_CHANGED") {
              sourceChanged = true;
              complete = false;
              error = failure.message;
              warnings.add(error);
            }
            warnings.add("The original FBS results page could not be restored. Choose the desired page in FBS after closing the calendar.");
          }
        }
      }
      if (sourceChanged) {
        bookings.clear();
        warnings.clear();
        warnings.add(error);
        baseline = {...baseline, bookings: [], warnings: [], rowCount: 0};
        rowCount = 0;
      }
      if (!pages.size) {
        baseline.bookings.forEach(booking => bookings.set(booking.id, booking));
        baseline.warnings.forEach(warning => warnings.add(warning));
        rowCount = baseline.rowCount;
      }
      return {bookings: [...bookings.values()].sort((a, b) => `${a.date} ${a.startTime}`.localeCompare(`${b.date} ${b.startTime}`) || a.reference.localeCompare(b.reference)),
        warnings: [...warnings], tableCount: baseline.tableCount, rowCount,
        pagination: {complete, paged: !!original?.paged, pagesRead: pages.size, totalPages, totalItems: original?.totalItems ?? null, restored, ...(error ? {error} : {})}};
    }

    function collect(options = {}) {
      if (!pending) pending = run(options).finally(() => { pending = null; });
      return pending;
    }
    return {inspect, collect};
  }

  const api = {createCollector, pagerCommand};
  global.FBSPagination = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(globalThis);
