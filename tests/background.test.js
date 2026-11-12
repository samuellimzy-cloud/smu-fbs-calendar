"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createToolbarController, registerController, isFbsUrl, FBS_HOME, SCRIPTS, INTENT_TTL, PENDING_PREFIX } = require("../background.js");
const fbsTab = { id: 10, windowId: 1, url: FBS_HOME, status: "complete" };
const offsite = { id: 20, windowId: 1, url: "https://example.com/", status: "complete" };
const key = (id) => `${PENDING_PREFIX}${id}`;
const ready = { type: "FBS_CONTENT_READY" };
const senderFor = (tab = fbsTab) => ({ id: "test-extension-id", frameId: 0, url: tab.url, tab: { ...tab } });

function event() {
  return { listeners: [], addListener(listener) { this.listeners.push(listener); } };
}

function mockChrome(overrides = {}) {
  const calls = [];
  const stored = overrides.stored || {};
  const tabs = new Map([[10, { ...fbsTab }], [20, { ...offsite }]]);
  for (const tab of overrides.candidates || []) tabs.set(tab.id, { status: "complete", ...tab });
  let sends = 0;
  let clock = 100000;
  const api = {
    runtime: { id: "test-extension-id", onMessage: event() },
    action: {
      onClicked: event(),
      setBadgeText: async (args) => { calls.push(["badge", args]); },
      setBadgeBackgroundColor: async (args) => { calls.push(["color", args]); },
      setTitle: async (args) => { calls.push(["title", args]); }
    },
    storage: { session: {
      get: async (query) => {
        calls.push(["storage-get", query]);
        if (query === null) return { ...stored };
        return Object.hasOwn(stored, query) ? { [query]: stored[query] } : {};
      },
      set: async (value) => { calls.push(["storage-set", value]); if (overrides.beforeSet) await overrides.beforeSet(value); Object.assign(stored, value); },
      remove: async (query) => { calls.push(["storage-remove", query]); for (const entry of Array.isArray(query) ? query : [query]) delete stored[entry]; }
    } },
    tabs: {
      onUpdated: event(), onRemoved: event(),
      sendMessage: async (tabId, message) => {
        calls.push(["send", tabId, message]);
        sends += 1;
        return overrides.send ? overrides.send(sends, tabId, message) : { ok: true };
      },
      get: async (tabId) => {
        calls.push(["get", tabId]);
        if (overrides.get) return overrides.get(tabId);
        if (!tabs.has(tabId)) throw new Error(`No tab with id: ${tabId}.`);
        return { ...tabs.get(tabId) };
      },
      query: async (args) => { calls.push(["query", args]); return overrides.candidates || []; },
      create: async (args) => {
        calls.push(["create", args]);
        const created = { id: 11, windowId: 1, status: overrides.newTabStatus || "loading", ...args };
        tabs.set(created.id, created);
        if (overrides.onCreate) await overrides.onCreate(created);
        return { ...created };
      },
      update: async (tabId, args) => { calls.push(["update", tabId, args]); const tab = { ...tabs.get(tabId), ...args }; tabs.set(tabId, tab); return tab; }
    },
    scripting: { executeScript: async (args) => {
      calls.push(["inject", args]);
      if (overrides.injectionError) throw new Error(overrides.injectionError);
      return overrides.injectionResult;
    } },
    windows: { update: async (id, args) => { calls.push(["window", id, args]); } }
  };
  const options = { now: () => clock };
  return { api, calls, stored, tabs, controller: createToolbarController(api, options),
    recreate: () => createToolbarController(api, options), advance: (ms) => { clock += ms; } };
}

test("toolbar accepts only the exact HTTPS FBS origin", () => {
  assert.equal(isFbsUrl(FBS_HOME), true);
  for (const url of ["http://fbs.intranet.smu.edu.sg/home", "https://fbs.intranet.smu.edu.sg.example.com/home", "https://example.com/fbs.intranet.smu.edu.sg", "https://fbs.intranet.smu.edu.sg:444/home", "chrome://extensions", undefined]) assert.equal(isFbsUrl(url), false);
});

test("normal FBS click requests navigation and clears intent only after successful opening", async () => {
  const { controller, calls, stored } = mockChrome();
  assert.deepEqual(await controller.handleClick(fbsTab), { ok: true, action: "opened", tabId: 10 });
  assert.deepEqual(calls.find((call) => call[0] === "send"), ["send", 10, { type: "FBS_OPEN_CALENDAR", navigate: true }]);
  const intent = calls.find((call) => call[0] === "storage-set")[1][key(10)];
  assert.deepEqual(intent, { tabId: 10, deadline: 100000 + INTENT_TTL });
  assert.deepEqual(stored, {});
  assert.equal(calls.some((call) => call[0] === "inject"), false);
});

test("offsite click focuses an existing FBS shell and opens the calendar immediately", async () => {
  const candidates = [{ id: 21, windowId: 1, url: "https://fbs.intranet.smu.edu.sg/modules/view.aspx" },
    { id: 22, windowId: 1, url: "https://fbs.intranet.smu.edu.sg/HOME.aspx#" }];
  const { controller, calls } = mockChrome({ candidates });
  assert.deepEqual(await controller.handleClick(offsite), { ok: true, action: "opened", tabId: 22 });
  assert.deepEqual(calls.find((call) => call[0] === "update"), ["update", 22, { active: true }]);
  assert.ok(calls.some((call) => call[0] === "send" && call[1] === 22));
  assert.equal(calls.some((call) => call[0] === "create"), false);
});

test("offsite toolbar Tab without a visible URL still reuses and opens FBS", async () => {
  const { controller, calls } = mockChrome({ candidates: [fbsTab] });
  assert.equal((await controller.handleClick({ id: 20, windowId: 1 })).action, "opened");
  assert.ok(calls.some((call) => call[0] === "send" && call[1] === 10));
  assert.equal(calls.some((call) => call[0] === "create"), false);
});

test("a new FBS tab waits for content-ready, then opens without a second toolbar click", async () => {
  const { controller, calls, stored, tabs } = mockChrome();
  const first = await controller.handleClick(offsite);
  assert.equal(first.pending, true);
  assert.equal(first.action, "waiting-for-load");
  assert.ok(stored[key(11)]);
  assert.equal(calls.some((call) => call[0] === "send"), false);
  const tab = { ...tabs.get(11), status: "complete" };
  tabs.set(11, tab);
  assert.equal((await controller.handleContentReady(ready, senderFor(tab))).action, "opened");
  assert.deepEqual(stored, {});
  assert.deepEqual(calls.find((call) => call[0] === "create"), ["create", { url: FBS_HOME, active: true }]);
});

test("a new tab that finished before its pending intent was stored opens immediately", async () => {
  const { controller, calls } = mockChrome({ newTabStatus: "complete" });
  assert.equal((await controller.handleClick(offsite)).action, "opened");
  assert.ok(calls.some((call) => call[0] === "send" && call[1] === 11));
});

test("normal authentication redirect keeps intent across service-worker recreation", async () => {
  const testbed = mockChrome({ send: (attempt) => {
    if (attempt === 1) {
      testbed.tabs.set(10, { ...fbsTab, url: "https://login.microsoftonline.com/", status: "complete" });
      throw new Error("The message port closed before a response was received.");
    }
    return { ok: true };
  } });
  assert.equal((await testbed.controller.handleClick(fbsTab)).pending, true);
  assert.ok(testbed.stored[key(10)]);
  assert.equal(testbed.calls.some((call) => call[0] === "inject"), false);
  testbed.tabs.set(10, { ...fbsTab });
  assert.equal((await testbed.recreate().handleContentReady(ready, senderFor())).action, "opened");
  assert.deepEqual(testbed.stored, {});
});

test("a loaded tab missing its receiver gets scripts in dependency order then opens", async () => {
  const { controller, calls } = mockChrome({ send: (attempt) => {
    if (attempt === 1) throw new Error("Could not establish connection. Receiving end does not exist.");
    return { ok: true };
  } });
  assert.equal((await controller.handleClick(fbsTab)).ok, true);
  assert.deepEqual(calls.find((call) => call[0] === "inject"), ["inject", { target: { tabId: 10 }, files: SCRIPTS }]);
  assert.deepEqual(SCRIPTS, ["core.js", "parser.js", "styles.js", "navigation.js", "pagination.js", "calendar.js"]);
});

test("missing receiver followed by a sign-in redirect never injects offsite", async () => {
  const testbed = mockChrome({ send: () => {
    testbed.tabs.set(10, { ...fbsTab, url: "https://login.microsoftonline.com/" });
    throw new Error("Receiving end does not exist.");
  } });
  assert.equal((await testbed.controller.handleClick(fbsTab)).pending, true);
  assert.ok(testbed.stored[key(10)]);
  assert.equal(testbed.calls.some((call) => call[0] === "inject"), false);
});

test("unrelated, external, nested-frame and wrong-origin readiness messages are ignored", async () => {
  const { controller, calls, stored } = mockChrome();
  stored[key(10)] = { tabId: 10, deadline: 200000 };
  const valid = senderFor();
  for (const sender of [{ ...valid, id: "other-extension" }, { ...valid, frameId: 1 }, { ...valid, url: "https://example.com/" },
    { ...valid, tab: { ...fbsTab, url: "https://login.microsoftonline.com/" } }, { ...valid, tab: null }]) {
    assert.equal((await controller.handleContentReady(ready, sender)).ignored, true);
  }
  assert.equal((await controller.handleContentReady({ type: "OTHER" }, valid)).ignored, true);
  assert.ok(stored[key(10)]);
  assert.equal(calls.some((call) => call[0] === "send"), false);
});

test("expired intent is removed and never opens the calendar", async () => {
  const { controller, stored, calls, advance } = mockChrome();
  stored[key(10)] = { tabId: 10, deadline: 100001 };
  advance(2);
  assert.equal((await controller.handleContentReady(ready, senderFor())).action, "no-pending-intent");
  assert.deepEqual(stored, {});
  assert.equal(calls.some((call) => call[0] === "send"), false);
});

test("startup expiry cleanup and tab closure remove only relevant intent keys", async () => {
  const { controller, stored } = mockChrome();
  Object.assign(stored, { [key(10)]: { tabId: 10, deadline: 99999 }, [key(11)]: { tabId: 11, deadline: 200000 }, unrelated: "preserved" });
  assert.equal(await controller.cleanupExpiredIntents(), 1);
  assert.ok(stored[key(11)]);
  await controller.handleRemoved(11);
  assert.deepEqual(stored, { unrelated: "preserved" });
});

test("simultaneous ready and tab-complete events deduplicate one open attempt", async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const { controller, stored, calls } = mockChrome({ send: async () => { await gate; return { ok: true }; } });
  stored[key(10)] = { tabId: 10, deadline: 200000 };
  const first = controller.handleContentReady(ready, senderFor());
  const second = controller.handleUpdated(10, { status: "complete" }, fbsTab);
  release();
  await Promise.all([first, second]);
  assert.equal(calls.filter((call) => call[0] === "send").length, 1);
});

test("new-document readiness is retried after an older message channel closes", async () => {
  let rejectOldSend;
  let signalStarted;
  const started = new Promise((resolve) => { signalStarted = resolve; });
  const oldSend = new Promise((_, reject) => { rejectOldSend = reject; });
  const { controller, calls, stored } = mockChrome({ send: (attempt) => {
    if (attempt === 1) { signalStarted(); return oldSend; }
    return { ok: true };
  } });
  const click = controller.handleClick(fbsTab);
  await started;
  const contentReady = controller.handleContentReady(ready, senderFor());
  const completed = controller.handleUpdated(10, { status: "complete" }, fbsTab);
  rejectOldSend(new Error("The message port closed before a response was received."));
  const results = await Promise.all([click, contentReady, completed]);
  assert.ok(results.every((result) => result.action === "opened"));
  assert.equal(calls.filter((call) => call[0] === "send").length, 2);
  assert.deepEqual(stored, {});
});

test("fatal navigation failure clears intent and reports an actionable toolbar error", async () => {
  const { controller, stored, calls } = mockChrome({ send: () => ({ ok: false, error: "My Bookings navigation could not be found.", code: "NAVIGATION_FAILED", fatal: true }) });
  const result = await controller.handleClick(fbsTab);
  assert.equal(result.ok, false);
  assert.deepEqual(stored, {});
  assert.ok(calls.some((call) => call[0] === "badge" && call[1].text === "!"));
});

test("explicit auth-required response keeps intent for the next FBS-ready event", async () => {
  const { controller, stored, calls } = mockChrome({ send: () => ({ ok: false, code: "AUTH_REQUIRED", retry: true, error: "Sign-in required." }) });
  assert.equal((await controller.handleClick(fbsTab)).pending, true);
  assert.ok(stored[key(10)]);
  assert.ok(calls.some((call) => call[0] === "badge" && call[1].text === "LOGIN"));
});

test("double-clicking while fallback runs performs a single injection", async () => {
  const { controller, calls } = mockChrome({ send: (attempt) => {
    if (attempt === 1) throw new Error("Receiving end does not exist.");
    return { ok: true };
  } });
  const first = controller.handleClick(fbsTab);
  const second = controller.handleClick(fbsTab);
  assert.equal(first, second);
  await first;
  assert.equal(calls.filter((call) => call[0] === "inject").length, 1);
});

test("runtime listener keeps its channel open and asynchronously acknowledges readiness", async () => {
  const { api, controller } = mockChrome();
  registerController(api, controller);
  const listener = api.runtime.onMessage.listeners[0];
  assert.equal(listener({ type: "OTHER" }, senderFor(), () => {}), false);
  let acknowledgment;
  const complete = new Promise((resolve) => {
    assert.equal(listener(ready, senderFor(), (response) => { acknowledgment = response; resolve(); }), true);
  });
  await complete;
  assert.equal(acknowledgment.action, "no-pending-intent");
  assert.equal(api.tabs.onUpdated.listeners.length, 1);
  assert.equal(api.tabs.onRemoved.listeners.length, 1);
});

const pagerRequest = {gridId: "GridViewBooking_gv", href: "javascript:__doPostBack('GridViewBooking$gv','Page$2')",
  sourceUrl: "https://fbs.intranet.smu.edu.sg/modules/homenavigation/mybookingstab.aspx"};
const pagerMessage = {type: "FBS_ACTIVATE_PAGER", request: pagerRequest};
const pagerReply = [{frameId: 0, result: {ok: true, clicked: true, page: 2, command: "number"}}];

test("trusted paging requests use the fixed MAIN-world helper only in the top FBS frame", async () => {
  const {controller, calls} = mockChrome({injectionResult: pagerReply});
  assert.deepEqual(await controller.handlePagerActivation(pagerMessage, senderFor()), {ok: true, clicked: true, page: 2, command: "number"});
  assert.equal(calls[0][0], "get", "the destination origin is rechecked before injection");
  const injection = calls.find(call => call[0] === "inject")[1];
  assert.deepEqual(injection.target, {tabId: 10, frameIds: [0]});
  assert.equal(injection.world, "MAIN");
  assert.equal(injection.func, require("../pager-bridge.js").activatePager);
  assert.deepEqual(injection.args, [pagerRequest]);
  assert.equal(injection.files, undefined, "only the fixed paging function is injected");
  assert.equal(calls.some(call => /storage|send|create|update/.test(call[0])), false);
});

test("paging rejects foreign extensions, nested frames and non-FBS senders before reading tabs", async () => {
  const {controller, calls} = mockChrome({injectionResult: pagerReply});
  const valid = senderFor();
  for (const sender of [
    {}, {...valid, id: "other-extension"}, {...valid, frameId: 1}, {...valid, frameId: undefined},
    {...valid, url: "https://example.com/"}, {...valid, url: "http://fbs.intranet.smu.edu.sg/home"},
    {...valid, tab: null}, {...valid, tab: {...fbsTab, id: -1}},
    {...valid, tab: {...fbsTab, url: "https://fbs.intranet.smu.edu.sg.example.com/home"}},
  ]) assert.equal((await controller.handlePagerActivation(pagerMessage, sender)).ignored, true);
  assert.equal((await controller.handlePagerActivation({type: "OTHER", request: pagerRequest}, valid)).ignored, true);
  assert.deepEqual(calls, []);
});

test("paging validates the exact native command, source origin and bounded request strings", async () => {
  const {controller, calls} = mockChrome({injectionResult: pagerReply});
  for (const request of [null, [], "unexpected", {},
    {...pagerRequest, gridId: "OtherGrid"}, {...pagerRequest, gridId: "x".repeat(161)},
    {...pagerRequest, gridId: "prefix_GridViewBooking_gv"},
    {...pagerRequest, href: "javascript:__doPostBack('GridViewBooking$gv','Cancel$2')"},
    {...pagerRequest, href: "javascript:__doPostBack('GridViewBooking$gv','Page$2');leak()"},
    {...pagerRequest, href: "javascript:__doPostBack('OtherGrid$gv','Page$2')"},
    {...pagerRequest, href: "javascript:__doPostBack('GridViewBooking$gv','Page$0')"},
    {...pagerRequest, href: "javascript:__doPostBack('GridViewBooking$gv','Page$999999999999999999999')"},
    {...pagerRequest, href: "x".repeat(513)},
    {...pagerRequest, sourceUrl: "https://login.microsoftonline.com/"},
    {...pagerRequest, sourceUrl: "https://fbs.intranet.smu.edu.sg:444/home"},
    {...pagerRequest, sourceUrl: "https://someone:secret@fbs.intranet.smu.edu.sg/home"},
    {...pagerRequest, sourceUrl: "javascript:alert(1)"}, {...pagerRequest, sourceUrl: "x".repeat(2049)},
  ]) assert.equal((await controller.handlePagerActivation({type: "FBS_ACTIVATE_PAGER", request}, senderFor())).ok, false);
  assert.deepEqual(calls, []);
});

test("a sign-in redirect after the pager message never receives MAIN-world injection", async () => {
  const {controller, calls} = mockChrome({get: async () => ({...fbsTab, url: "https://login.microsoftonline.com/"})});
  assert.equal((await controller.handlePagerActivation(pagerMessage, senderFor())).ok, false);
  assert.equal(calls.some(call => call[0] === "inject"), false);
});

test("pager helper and Chrome failures return bounded errors without retrying or exposing exceptions", async () => {
  const thrown = mockChrome({injectionError: "private diagnostic should never be returned"});
  const failure = await thrown.controller.handlePagerActivation(pagerMessage, senderFor());
  assert.equal(failure.ok, false);
  assert.equal(failure.error.includes("private diagnostic"), false);
  assert.equal(thrown.calls.filter(call => call[0] === "inject").length, 1);
  const missing = mockChrome();
  assert.equal((await missing.controller.handlePagerActivation(pagerMessage, senderFor())).ok, false);
  const noMatch = mockChrome({injectionResult: [{frameId: 0, result: {ok: false, noMatch: true, error: "x".repeat(600)}}]});
  const reply = await noMatch.controller.handlePagerActivation(pagerMessage, senderFor());
  assert.equal(reply.ok, false);
  assert.equal(reply.noMatch, true);
  assert.equal(reply.error.length, 300);
});

test("the runtime listener asynchronously dispatches paging through its existing channel", async () => {
  const {api, controller} = mockChrome({injectionResult: pagerReply});
  registerController(api, controller);
  assert.equal(api.runtime.onMessage.listeners.length, 1);
  const reply = await new Promise(resolve => {
    assert.equal(api.runtime.onMessage.listeners[0](pagerMessage, senderFor(), resolve), true);
  });
  assert.deepEqual(reply, {ok: true, clicked: true, page: 2, command: "number"});
});
