"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

test("the packaged local-only worker loads its paging helper with FBS-only permissions and no network access", async () => {
  const listeners = [], actions = [], updates = [], removed = [];
  let networkCalls = 0;
  const data = {};
  const store = {
    setAccessLevel: async () => {},
    get: async key => key === null ? {...data} : {[key]: data[key]},
    set: async values => Object.assign(data, values),
    remove: async keys => { for (const key of Array.isArray(keys) ? keys : [keys]) delete data[key]; }
  };
  const id = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const chrome = {
    runtime: {id, getURL: file => `chrome-extension://${id}/${file}`, onMessage: {addListener: callback => listeners.push(callback)}},
    storage: {local: store, session: store},
    action: {onClicked: {addListener: callback => actions.push(callback)}, setTitle: async () => {}, setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {}},
    tabs: {onUpdated: {addListener: callback => updates.push(callback)}, onRemoved: {addListener: callback => removed.push(callback)}}
  };
  const context = vm.createContext({chrome, URL, setTimeout, clearTimeout,
    fetch: async () => {networkCalls += 1; throw new Error("Unexpected network request");}});
  const root = path.resolve(__dirname, "..");
  const imports = [];
  context.importScripts = (...files) => {
    imports.push(...files);
    for (const file of files) vm.runInContext(fs.readFileSync(path.join(root, file), "utf8"), context, {filename: file});
  };
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
  assert.deepEqual(manifest.permissions, ["scripting", "storage"]);
  assert.deepEqual(manifest.host_permissions, ["https://fbs.intranet.smu.edu.sg/*"]);
  assert.equal(manifest.options_page, undefined);
  assert.equal(manifest.background.service_worker, "background.js");
  vm.runInContext(fs.readFileSync(path.join(root, "background.js"), "utf8"), context, {filename: "background.js"});
  assert.deepEqual(imports, ["pager-bridge.js"]);
  assert.equal(typeof context.FBSPagerBridge.activatePager, "function");
  assert.equal(actions.length, 1);
  assert.equal(updates.length, 1);
  assert.equal(removed.length, 1);
  assert.equal(listeners.length, 1);
  assert.equal(networkCalls, 0);
});
