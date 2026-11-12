/* Open the existing My Bookings tab through FBS's own navigation. */
(function (global) {
  "use strict";
  const pending = new WeakMap();

  function isVisible(element) {
    for (let node = element; node && node.nodeType === 1; node = node.parentElement) {
      if (node.hidden || node.getAttribute("aria-hidden") === "true") return false;
      const style = node.ownerDocument.defaultView.getComputedStyle(node);
      if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse") return false;
    }
    return true;
  }

  function ensureMyBookings(options = {}) {
    const root = options.root || global.document;
    const parser = options.parser || global.FBSParser;
    const rootDocument = root?.nodeType === 9 ? root : root?.ownerDocument;
    if (!rootDocument || !parser) return Promise.resolve({ok: false, code: "NAVIGATION_FAILED", fatal: true, error: "FBS navigation is unavailable. Refresh the FBS tab and click the extension again."});
    if (pending.has(rootDocument)) return pending.get(rootDocument);
    const timeoutMs = options.timeoutMs ?? 20000;
    const pollMs = options.pollMs ?? 120;
    const request = navigate(root, parser, timeoutMs, pollMs).finally(() => pending.delete(rootDocument));
    pending.set(rootDocument, request);
    return request;
  }

  async function navigate(root, parser, timeoutMs, pollMs) {
    const deadline = Date.now() + Math.max(0, timeoutMs);
    let clicked = false;
    do {
      try {
        const result = parser.extractBookings(root);
        // A recognized heading with zero rows is also a valid empty booking list.
        if (result.tableCount > 0) return {ok: true, tableCount: result.tableCount, bookings: result.bookings.length};
        const docs = parser.getAccessibleDocuments(root);
        for (const doc of docs) {
          if ([...doc.querySelectorAll('input[type="password"]')].some(isVisible)) {
            return {ok: false, code: "AUTH_REQUIRED", retry: true, error: "Log into SMU normally. Your calendar will open after FBS returns."};
          }
        }
        if (!clicked) {
          for (const doc of docs) {
            // FBS attaches its tab handlers during the frame's load sequence.
            if (doc.readyState !== "complete") continue;
            const link = doc.getElementById("mybookings_anchor");
            if (!link || !isVisible(link) || typeof link.click !== "function") continue;
            // This known FBS control only switches its navigation frame. Never
            // search for booking action buttons or submit a booking form.
            const href = link.getAttribute("href");
            if (href && !/^javascript:\s*v\(\)\s*;?$/i.test(href)) {
              const target = new URL(href, doc.baseURI);
              if (target.origin !== doc.defaultView.location.origin) continue;
            }
            // The live FBS click handler belongs to the tab inside the anchor.
            // Clicking the anchor itself never reaches handlers on its children.
            const tab = link.querySelector("#MyBookingsTab") || link;
            const target = [...tab.querySelectorAll("img")].find(isVisible) || tab;
            target.click();
            clicked = true;
            break;
          }
        }
      } catch (_) {
        // FBS can replace a same-origin frame between these reads. Check its
        // new document on the next pass instead of using a detached element.
      }
      if (Date.now() >= deadline) break;
      await new Promise(resolve => setTimeout(resolve, Math.min(Math.max(10, pollMs), Math.max(1, deadline - Date.now()))));
    } while (Date.now() <= deadline);
    return {ok: false, code: "NAVIGATION_FAILED", fatal: true, error: clicked
      ? "My Bookings is taking too long to load. Refresh FBS and click the extension again."
      : "Could not find My Bookings. Finish signing in to FBS, then click the extension again."};
  }

  const api = {ensureMyBookings};
  global.FBSNavigation = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(globalThis);
