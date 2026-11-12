/* Open the local calendar in the user's FBS tab. */
if (typeof importScripts === "function") importScripts("pager-bridge.js");
(function (global) {
  "use strict";

  const FBS_ORIGIN = "https://fbs.intranet.smu.edu.sg";
  const FBS_HOME = `${FBS_ORIGIN}/home`;
  const SCRIPTS = ["core.js", "parser.js", "styles.js", "navigation.js", "pagination.js", "calendar.js"];
  const MESSAGE = { type: "FBS_OPEN_CALENDAR", navigate: true };
  const PENDING_PREFIX = "fbsPendingOpen:";
  const INTENT_TTL = 15 * 60 * 1000;
  const DEFAULT_TITLE = "Open your FBS room calendar";
  const LOGIN_TITLE = "Finish signing in to SMU. Your requested room calendar will open when FBS is ready.";
  const pagerBridge = global.FBSPagerBridge || (typeof require === "function" ? require("./pager-bridge.js") : null);

  function validPagerRequest(value) {
    if (!value || typeof value !== "object" || Array.isArray(value) ||
        typeof value.gridId !== "string" || value.gridId.length > 160 || !/^(?:[A-Za-z0-9_]+_)?GridViewBooking_gv$/.test(value.gridId) ||
        typeof value.href !== "string" || value.href.length > 512 ||
        typeof value.sourceUrl !== "string" || value.sourceUrl.length > 2048) return false;
    const command = /^javascript:\s*__doPostBack\(\s*(['"])([^'"]+)\1\s*,\s*(['"])Page\$(\d+|Next|Prev|Previous|First|Last)\3\s*\)\s*;?\s*$/i.exec(value.href);
    if (!command || command[2].replace(/\$/g, "_") !== value.gridId ||
        /^\d+$/.test(command[4]) && (!Number.isSafeInteger(Number(command[4])) || Number(command[4]) < 1)) return false;
    try {
      const source = new URL(value.sourceUrl);
      return source.origin === FBS_ORIGIN && !source.username && !source.password;
    } catch (_) { return false; }
  }

  function isFbsUrl(value) {
    try { return new URL(value).origin === FBS_ORIGIN; }
    catch (_) { return false; }
  }

  function isMissingReceiver(error) {
    return /receiving end does not exist|could not establish connection/i.test(String(error && error.message || error));
  }

  function isTransient(error) {
    return isMissingReceiver(error) || /message (?:port|channel) closed|port closed|frame (?:was )?removed|frame (?:was )?navigat|document (?:was )?unloaded|context invalidated|asynchronous response.*message channel closed/i
      .test(String(error && error.message || error));
  }

  function isClosedTab(error) {
    return /no tab with id|invalid tab id|tab (?:was |is )?closed/i.test(String(error && error.message || error));
  }

  function createToolbarController(api, options = {}) {
    const now = options.now || Date.now;
    const activeClicks = new Map();
    const activeAttempts = new Map();
    const queuedAttempts = new Map();
    const injectingTabs = new Set();
    const keyFor = (tabId) => `${PENDING_PREFIX}${tabId}`;

    async function showState(tabId, badge, title, color = "#245da9") {
      const target = Number.isInteger(tabId) ? { tabId } : {};
      await Promise.all([
        api.action.setBadgeText({ ...target, text: badge }),
        api.action.setBadgeBackgroundColor({ ...target, color }),
        api.action.setTitle({ ...target, title })
      ]);
    }

    async function showStateSafely(tabId, badge, title, color) {
      try { await showState(tabId, badge, title, color); }
      catch (_) { /* A closed/navigating tab cannot always receive toolbar state. */ }
    }

    async function clearIntent(tabId) {
      await api.storage.session.remove(keyFor(tabId));
    }

    async function readIntent(tabId) {
      const key = keyFor(tabId);
      const value = (await api.storage.session.get(key))[key];
      if (!value) return null;
      if (value.tabId !== tabId || !Number.isFinite(value.deadline) || value.deadline <= now()) {
        await clearIntent(tabId);
        await showStateSafely(tabId, "", DEFAULT_TITLE);
        return null;
      }
      return value;
    }

    async function markIntent(tabId) {
      if (!Number.isInteger(tabId)) throw new Error("FBS did not provide a valid destination tab.");
      await api.storage.session.set({ [keyFor(tabId)]: { tabId, deadline: now() + INTENT_TTL } });
    }

    async function waiting(tabId, error) {
      await showStateSafely(tabId, "LOGIN", LOGIN_TITLE);
      return { ok: true, pending: true, action: "waiting-for-fbs", tabId, ...(error ? { detail: error } : {}) };
    }

    async function sendOpen(tabId) {
      const response = await api.tabs.sendMessage(tabId, { ...MESSAGE });
      if (response && response.ok === true) return response;
      if (!response) throw new Error("Receiving end does not exist.");
      const error = new Error(response.error || "FBS is not ready to open the calendar yet.");
      error.fatal = response.fatal === true || response.code === "NAVIGATION_FAILED";
      error.retry = response.retry === true || response.code === "AUTH_REQUIRED";
      throw error;
    }

    async function runAttempt(tabId, reason) {
      if (!await readIntent(tabId)) return { ok: true, ignored: true, action: "no-pending-intent", tabId };
      try {
        let current = await api.tabs.get(tabId);
        if (!isFbsUrl(current.url)) return await waiting(tabId);
        if (reason === "new-tab" && current.status !== "complete") {
          await showStateSafely(tabId, "...", "Opening FBS. Finish signing in if SMU asks; the calendar will follow.");
          return { ok: true, pending: true, action: "waiting-for-load", tabId };
        }
        await showStateSafely(tabId, "...", "Opening My Bookings and your room calendar…");
        try {
          await sendOpen(tabId);
        } catch (error) {
          if (!isMissingReceiver(error)) throw error;
          // Already-open tabs may predate installation. Recheck origin after each navigation boundary.
          current = await api.tabs.get(tabId);
          if (!isFbsUrl(current.url) || current.status === "loading") return await waiting(tabId);
          injectingTabs.add(tabId);
          try { await api.scripting.executeScript({ target: { tabId }, files: [...SCRIPTS] }); }
          finally { injectingTabs.delete(tabId); }
          await sendOpen(tabId);
        }
        await clearIntent(tabId);
        await showStateSafely(tabId, "", DEFAULT_TITLE);
        return { ok: true, action: "opened", tabId };
      } catch (error) {
        const reasonText = String(error && error.message || "Please try opening FBS again.");
        if (isClosedTab(error)) {
          await clearIntent(tabId);
          return { ok: false, action: "tab-closed", error: reasonText, tabId };
        }
        if (error.fatal !== true) {
          // Auth redirects and content-script navigation can close the message channel mid-request.
          // Never inject into the sign-in site, and retain the intent for the next FBS-ready event.
          let current;
          try { current = await api.tabs.get(tabId); }
          catch (lookupError) {
            if (isClosedTab(lookupError)) {
              await clearIntent(tabId);
              return { ok: false, action: "tab-closed", error: reasonText, tabId };
            }
          }
          if (isTransient(error) || error.retry || !current || !isFbsUrl(current.url)) return await waiting(tabId, reasonText);
        }
        await clearIntent(tabId);
        await showStateSafely(tabId, "!", `Could not open FBS calendar: ${reasonText}`.slice(0, 250), "#b42336");
        return { ok: false, error: reasonText, tabId };
      }
    }

    function attempt(tabId, reason) {
      if (activeAttempts.has(tabId)) {
        // A new document can announce ready before the old document's message channel closes.
        // Its event must survive the old attempt. Ignore our own fallback-injection ready signal:
        // that path already sends its open message immediately after executeScript returns.
        if ((reason === "content-ready" || reason === "tab-complete") && !injectingTabs.has(tabId)) queuedAttempts.set(tabId, reason);
        return activeAttempts.get(tabId);
      }
      const promise = (async () => {
        let nextReason = reason;
        let result;
        do {
          queuedAttempts.delete(tabId);
          result = await runAttempt(tabId, nextReason);
          nextReason = queuedAttempts.get(tabId);
        } while (nextReason && await readIntent(tabId));
        return result;
      })().finally(() => {
        activeAttempts.delete(tabId);
        queuedAttempts.delete(tabId);
      });
      activeAttempts.set(tabId, promise);
      return promise;
    }

    async function selectDestination(tab) {
      if (isFbsUrl(tab.url) && Number.isInteger(tab.id)) return { tab, created: false };
      const candidates = await api.tabs.query({ url: `${FBS_ORIGIN}/*` });
      const matching = candidates.filter((candidate) => isFbsUrl(candidate.url));
      const isShell = (candidate) => /^\/(?:home|home\.aspx)\/?$/i.test(new URL(candidate.url).pathname);
      const existing = matching.find((candidate) => candidate.windowId === tab.windowId && isShell(candidate)) ||
        matching.find((candidate) => candidate.windowId === tab.windowId) || matching.find(isShell) || matching[0];
      if (existing) {
        await api.tabs.update(existing.id, { active: true });
        if (existing.windowId !== tab.windowId && api.windows && api.windows.update) {
          await api.windows.update(existing.windowId, { focused: true });
        }
        return { tab: existing, created: false };
      }
      return { tab: await api.tabs.create({ url: FBS_HOME, active: true }), created: true };
    }

    async function runClick(tab = {}) {
      let tabId = tab.id;
      try {
        const destination = await selectDestination(tab);
        tabId = destination.tab.id;
        await markIntent(tabId);
        // A fast tab can announce ready before storage.set finishes. Reading its current status
        // here closes that race; later complete/ready events cover tabs that are still loading.
        const reason = destination.created ? "new-tab" : "click";
        const result = await attempt(tabId, reason);
        // A simultaneous ready event may have checked storage just before markIntent completed.
        if (result.action === "no-pending-intent" && await readIntent(tabId)) return attempt(tabId, reason);
        return result;
      } catch (error) {
        const reasonText = String(error && error.message || "Please try again.");
        await showStateSafely(tabId, "!", `Could not open FBS calendar: ${reasonText}`.slice(0, 250), "#b42336");
        return { ok: false, error: reasonText, tabId };
      }
    }

    function handleClick(tab = {}) {
      const key = Number.isInteger(tab.id) ? tab.id : "unknown-tab";
      if (activeClicks.has(key)) return activeClicks.get(key);
      const promise = runClick(tab).finally(() => activeClicks.delete(key));
      activeClicks.set(key, promise);
      return promise;
    }

    async function handleContentReady(message, sender = {}) {
      if (!message || message.type !== "FBS_CONTENT_READY" || sender.id !== api.runtime.id || sender.frameId !== 0 ||
          !sender.tab || !Number.isInteger(sender.tab.id) || !isFbsUrl(sender.url) || !isFbsUrl(sender.tab.url)) {
        return { ok: false, ignored: true, error: "Untrusted or unrelated content-ready message." };
      }
      return attempt(sender.tab.id, "content-ready");
    }

    async function handlePagerActivation(message, sender = {}) {
      if (message?.type !== "FBS_ACTIVATE_PAGER" || sender.id !== api.runtime.id || sender.frameId !== 0 ||
          !sender.tab || !Number.isInteger(sender.tab.id) || sender.tab.id < 0 || !isFbsUrl(sender.url) || !isFbsUrl(sender.tab.url)) {
        return {ok: false, ignored: true, error: "Untrusted or unrelated FBS paging request."};
      }
      if (!validPagerRequest(message.request)) return {ok: false, error: "The FBS paging request was invalid. Refresh My Bookings and try again."};
      if (typeof pagerBridge?.activatePager !== "function") return {ok: false, error: "The FBS paging helper is unavailable. Reload the extension and FBS tab."};
      try {
        const current = await api.tabs.get(sender.tab.id);
        if (!isFbsUrl(current.url)) return {ok: false, error: "FBS navigated away before paging could start. Open My Bookings and try again."};
        const request = {gridId: message.request.gridId, href: message.request.href, sourceUrl: message.request.sourceUrl};
        const results = await api.scripting.executeScript({target: {tabId: sender.tab.id, frameIds: [0]}, world: "MAIN", func: pagerBridge.activatePager, args: [request]});
        const reply = results?.find(item => item.frameId === 0)?.result;
        if (!reply || typeof reply.ok !== "boolean") return {ok: false, error: "FBS did not confirm the paging request. Refresh My Bookings and try again."};
        if (!reply.ok) return {ok: false, ...(reply.noMatch === true ? {noMatch: true} : {}),
          error: typeof reply.error === "string" ? reply.error.slice(0, 300) : "The FBS paging control could not be opened. Refresh My Bookings and try again."};
        return {ok: true, clicked: reply.clicked === true,
          page: Number.isSafeInteger(reply.page) && reply.page > 0 ? reply.page : null,
          command: ["number", "next", "prev", "previous", "first", "last"].includes(reply.command) ? reply.command : null};
      } catch (_) {
        return {ok: false, error: "FBS paging could not start. Refresh My Bookings and try again."};
      }
    }

    async function handleUpdated(tabId, changeInfo = {}, tab = {}) {
      if (changeInfo.status !== "complete") return { ok: true, ignored: true };
      if (!isFbsUrl(tab.url)) {
        if (await readIntent(tabId)) return waiting(tabId);
        return { ok: true, ignored: true };
      }
      return attempt(tabId, "tab-complete");
    }

    async function handleRemoved(tabId) {
      await clearIntent(tabId);
      return { ok: true };
    }

    async function cleanupExpiredIntents() {
      const stored = await api.storage.session.get(null);
      const expired = Object.entries(stored).filter(([key, value]) => key.startsWith(PENDING_PREFIX) &&
        (!value || !Number.isInteger(value.tabId) || key !== keyFor(value.tabId) || !Number.isFinite(value.deadline) || value.deadline <= now()));
      if (expired.length) await api.storage.session.remove(expired.map(([key]) => key));
      for (const [, value] of expired) {
        if (value && Number.isInteger(value.tabId)) await showStateSafely(value.tabId, "", DEFAULT_TITLE);
      }
      return expired.length;
    }

    return { handleClick, handleContentReady, handlePagerActivation, handleUpdated, handleRemoved, cleanupExpiredIntents };
  }

  function registerController(api, controller) {
    api.action.onClicked.addListener((tab) => { void controller.handleClick(tab).catch(() => {}); });
    api.tabs.onUpdated.addListener((tabId, changeInfo, tab) => { void controller.handleUpdated(tabId, changeInfo, tab).catch(() => {}); });
    api.tabs.onRemoved.addListener((tabId) => { void controller.handleRemoved(tabId).catch(() => {}); });
    api.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (!message || !["FBS_CONTENT_READY", "FBS_ACTIVATE_PAGER"].includes(message.type)) return false;
      const handle = message.type === "FBS_ACTIVATE_PAGER" ? controller.handlePagerActivation : controller.handleContentReady;
      handle(message, sender).then(sendResponse,
        (error) => sendResponse({ ok: false, error: message.type === "FBS_ACTIVATE_PAGER"
          ? "FBS paging could not start. Refresh My Bookings and try again." : String(error && error.message || error) }));
      return true;
    });
    void controller.cleanupExpiredIntents().catch(() => {});
  }

  const exported = { createToolbarController, registerController, isFbsUrl, FBS_HOME, SCRIPTS, INTENT_TTL, PENDING_PREFIX };
  if (typeof module !== "undefined" && module.exports) module.exports = exported;
  if (global.chrome && global.chrome.action && global.chrome.action.onClicked) {
    registerController(global.chrome, createToolbarController(global.chrome));
  }
})(globalThis);
