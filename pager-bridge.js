/* Native FBS paging activation for Chrome's MAIN execution world. */
(function (global) {
  "use strict";

  // Chrome serializes this function for executeScript. Keep every dependency
  // inside it; never evaluate a supplied href or call a supplied function name.
  function activatePager(request) {
    "use strict";
    const origin = "https://fbs.intranet.smu.edu.sg";
    const gridPattern = /(?:^|_)GridViewBooking_gv$/;
    const clean = value => String(value || "").replace(/\s+/g, " ").trim();
    const failure = (error, noMatch = false) => ({ok: false, ...(noMatch ? {noMatch: true} : {}), error});

    function allowedURL(value) {
      try {
        const url = new URL(value);
        return url.origin === origin && !url.username && !url.password;
      } catch (_) { return false; }
    }

    function command(value) {
      const match = /^javascript:\s*__doPostBack\(\s*(['"])([^'"]+)\1\s*,\s*(['"])Page\$(\d+|Next|Prev|Previous|First|Last)\3\s*\)\s*;?\s*$/i.exec(value);
      if (!match || !gridPattern.test(match[2].replace(/\$/g, "_"))) return null;
      const numeric = /^\d+$/.test(match[4]);
      const page = numeric ? Number(match[4]) : null;
      if (numeric && (!Number.isSafeInteger(page) || page < 1)) return null;
      return {gridId: match[2].replace(/\$/g, "_"), page, command: numeric ? "number" : match[4].toLowerCase()};
    }

    function visible(element) {
      try {
        if (element.isConnected === false) return false;
        for (let node = element; node?.nodeType === 1; node = node.parentElement) {
          if (node.hidden || node.getAttribute("aria-hidden") === "true") return false;
          if (node.closest?.("[data-fbs-calendar], #smu-fbs-calendar-extension")) return false;
          const style = node.ownerDocument?.defaultView?.getComputedStyle?.(node) || node.style;
          if (style && (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse")) return false;
        }
        return true;
      } catch (_) { return false; }
    }

    const doc = globalThis.document;
    if (!doc || !allowedURL(doc.URL || doc.location?.href)) return failure("Open My Bookings on the SMU FBS site before reading other pages.");
    if (!request || typeof request.gridId !== "string" || request.gridId.length > 256 || !gridPattern.test(request.gridId) ||
        typeof request.href !== "string" || request.href.length > 1024 ||
        typeof request.sourceUrl !== "string" || request.sourceUrl.length > 4096 || !allowedURL(request.sourceUrl)) {
      return failure("The FBS paging request was invalid.");
    }
    const expected = command(request.href);
    if (!expected || expected.gridId !== request.gridId) return failure("Only the FBS booking grid's page controls can be used.");

    const documents = [];
    const visited = new Set();
    function visit(current) {
      if (!current || visited.has(current) || !allowedURL(current.URL || current.location?.href)) return;
      visited.add(current);
      documents.push(current);
      for (const frame of current.querySelectorAll("iframe, frame")) {
        if (!visible(frame)) continue;
        try {
          const child = frame.contentDocument;
          if (child?.documentElement) visit(child);
        } catch (_) { /* Other origins and inaccessible frames are outside FBS. */ }
      }
    }
    visit(doc);

    const matchingDocuments = documents.filter(source => String(source.URL || source.location?.href) === request.sourceUrl && source.readyState === "complete");
    if (matchingDocuments.length !== 1) return failure("The requested FBS booking document changed or is ambiguous. Re-read bookings and try again.", true);
    const candidates = [];
    for (const source of matchingDocuments) {
      const grids = [...source.querySelectorAll("table[id], [role='grid'][id]")]
        .filter(table => gridPattern.test(table.id) && visible(table));
      if (!grids.length || new Set(grids.map(table => table.id)).size !== 1 || grids[0].id !== request.gridId) continue;
      for (const anchor of source.querySelectorAll("a[href]")) {
        if (anchor.getAttribute("href") !== request.href || !visible(anchor) || anchor.disabled ||
            anchor.getAttribute("aria-disabled") === "true" || /\b(?:disabled|aspNetDisabled)\b/i.test(anchor.className || "") ||
            clean(anchor.getAttribute("onclick")) || typeof anchor.click !== "function") continue;
        // Matching the original href and the normalized grid target prevents a
        // page change or DOM replacement from redirecting this request elsewhere.
        const parsed = command(anchor.getAttribute("href"));
        if (parsed?.gridId === request.gridId) candidates.push({anchor, source});
      }
    }
    if (!candidates.length) return failure("The requested FBS page control changed or is ambiguous. Re-read bookings and try again.", true);
    try {
      // Some grids repeat the same pager above and below their rows. All
      // candidates are equivalent controls in one verified document; click once.
      candidates[0].anchor.click();
      return {ok: true, clicked: true, page: expected.page, command: expected.command};
    } catch (_) {
      return failure("FBS could not activate its page control. Re-read bookings and try again.");
    }
  }

  const api = {activatePager};
  global.FBSPagerBridge = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(globalThis);
