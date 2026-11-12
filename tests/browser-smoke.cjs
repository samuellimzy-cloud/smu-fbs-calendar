/* Dependency-free browser smoke tests. Requires Node 22+ and Chrome or Edge. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const http = require('node:http');

const root = path.resolve(__dirname, '..');
const screenshotFlag = process.argv.indexOf('--screenshot');
const screenshotPath = screenshotFlag >= 0 ? process.argv[screenshotFlag + 1] : process.env.FBS_SCREENSHOT_PATH;
if (screenshotFlag >= 0 && (!screenshotPath || screenshotPath.startsWith('--'))) {
  throw new Error('Provide a PNG path after --screenshot.');
}
const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
].filter(Boolean);
const executable = candidates.find((file) => fs.existsSync(file));
if (!executable) {
  console.error('Chrome/Edge was not found. Set CHROME_PATH to the browser executable.');
  process.exit(1);
}

let child;
let socket;
let profile;
let fixtureServer;
let sequence = 0;
const pending = new Map();
const pageErrors = [];

function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    const timeout = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`CDP request timed out: ${method}`));
    }, 15000);
    pending.set(id, { resolve, reject, timeout });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression, contextId) {
  const result = await send('Runtime.evaluate', {
    expression, awaitPromise: true, returnByValue: true,
    ...(contextId === undefined ? {} : {contextId}),
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  }
  return result.result.value;
}

async function waitFor(expression, message) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (await evaluate(expression)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out: ${message}`);
}

const shadow = `document.querySelector('#smu-fbs-calendar-extension').shadowRoot`;
const query = (selector) => `${shadow}.querySelector(${JSON.stringify(selector)})`;
const click = (selector) => evaluate(`${query(selector)}.click()`);
const count = () => evaluate(`${shadow}.querySelectorAll('.booking-event').length`);

async function input(value) {
  await evaluate(`(() => { const input = ${query('#fbs-search')}; input.value = ${JSON.stringify(value)}; input.dispatchEvent(new Event('input', {bubbles:true})); })()`);
}

async function status(value) {
  await evaluate(`(() => { const select = ${query('#fbs-status')}; select.value = ${JSON.stringify(value)}; select.dispatchEvent(new Event('change', {bubbles:true})); })()`);
}

async function serveFixtures() {
  if (fixtureServer?.listening) return `http://127.0.0.1:${fixtureServer.address().port}`;
  fixtureServer = http.createServer((request, response) => {
    let filename;
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
      if (pathname === '/tests/fixtures/navigation-load-delay.js') {
        setTimeout(() => {
          response.writeHead(200, {'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store'});
          response.end('window.__fixtureDelayedResourceLoaded = true;');
        }, 800);
        return;
      }
      filename = path.resolve(root, `.${pathname}`);
      const relative = path.relative(root, filename);
      if (relative.startsWith('..') || path.isAbsolute(relative) || !/\.(html|js|css)$/.test(filename)) {
        response.writeHead(404).end();
        return;
      }
    } catch (_) {
      response.writeHead(400).end();
      return;
    }
    fs.readFile(filename, (error, contents) => {
      if (error) { response.writeHead(404).end(); return; }
      const type = filename.endsWith('.html') ? 'text/html' : filename.endsWith('.js') ? 'text/javascript' : 'text/css';
      response.writeHead(200, { 'Content-Type': `${type}; charset=utf-8`, 'Cache-Control': 'no-store' });
      response.end(contents);
    });
  });
  await new Promise((resolve, reject) => {
    fixtureServer.once('error', reject);
    fixtureServer.listen(0, '127.0.0.1', resolve);
  });
  return `http://127.0.0.1:${fixtureServer.address().port}`;
}

async function frameScenarios() {
  const origin = await serveFixtures();
  const sourceDocument = `document.querySelector('#home-frame').contentDocument.querySelector('#bookings-frame').contentDocument`;
  await send('Page.navigate', { url: `${origin}/tests/fixtures/live-layout.html` });
  await waitFor(`!!document.querySelector('#home-frame')?.contentDocument?.querySelector('#bookings-frame')?.contentDocument?.querySelector('#live-bookings')`, 'nested booking iframe loads');
  await waitFor(`!!document.querySelector('#smu-fbs-calendar-extension')?.shadowRoot?.querySelector('#fbs-launcher')`, 'top-page frame calendar launcher');
  const initial = await evaluate(`FBSParser.extractBookings(document)`);
  assert.equal(initial.bookings.length, 4, 'split header and data tables in a nested frame produce four bookings');
  assert.deepEqual(initial.warnings, []);
  await click('#fbs-launcher');
  await waitFor(`!${query('#fbs-refresh')}.disabled`, 'nested source collection finishes');
  await click('#fbs-next-booking');
  await waitFor(`${shadow}.querySelectorAll('.booking-event').length === 4`, 'nested source bookings appear in the top overlay');
  console.log('PASS: nested same-origin split-header grid becomes four top-page calendar bookings');

  // Add valid-looking data to an unrelated table: only the matching split grid should be paired.
  const contamination = await evaluate(`(() => {
    const source = ${sourceDocument};
    const dataTable = source.querySelector('#live-bookings').closest('table');
    const unrelated = dataTable.cloneNode(true);
    unrelated.id = 'unrelated-availability-grid';
    unrelated.querySelector('tbody').removeAttribute('id');
    [...unrelated.rows].forEach((row, index) => { row.cells[1].textContent = 'UNRELATED-' + index; });
    source.body.appendChild(unrelated);
    const result = FBSParser.extractBookings(document);
    return { count: result.bookings.length, references: result.bookings.map(booking => booking.reference) };
  })()`);
  assert.equal(contamination.count, 4, 'unrelated data-only table is not assigned the booking grid header');
  assert.equal(contamination.references.some((reference) => reference.startsWith('UNRELATED-')), false);
  console.log('PASS: split grid headers do not contaminate unrelated tables');

  // Hidden same-origin frames and sandboxed opaque-origin frames must be skipped, not read.
  await evaluate(`(async () => {
    const hidden = document.createElement('iframe');
    hidden.id = 'hidden-source';
    hidden.hidden = true;
    hidden.src = '${origin}/tests/fixtures/live-bookings.html';
    const hiddenLoaded = new Promise(resolve => hidden.addEventListener('load', resolve, {once:true}));
    document.body.appendChild(hidden);
    await hiddenLoaded;
    [...hidden.contentDocument.querySelector('#live-bookings').rows].forEach((row, index) => { row.cells[1].textContent = 'HIDDEN-' + index; });
    const opaque = document.createElement('iframe');
    opaque.id = 'opaque-source';
    opaque.setAttribute('sandbox', '');
    opaque.style.cssText = 'width:500px;height:100px';
    opaque.srcdoc = hidden.contentDocument.documentElement.outerHTML.replaceAll('HIDDEN-', 'OPAQUE-');
    const opaqueLoaded = new Promise(resolve => opaque.addEventListener('load', resolve, {once:true}));
    document.body.appendChild(opaque);
    await opaqueLoaded;
  })()`);
  assert.equal(await evaluate(`document.querySelector('#opaque-source').contentDocument === null`), true, 'sandbox fixture really has an inaccessible opaque origin');
  const protectedFrames = await evaluate(`FBSParser.extractBookings(document)`);
  assert.equal(protectedFrames.bookings.length, 4);
  assert.equal(protectedFrames.bookings.some((booking) => /^(HIDDEN|OPAQUE)-/.test(booking.reference)), false);
  console.log('PASS: hidden and inaccessible cross-origin frames are safely skipped');

  await evaluate(`(() => {
    const rows = ${sourceDocument}.querySelector('#live-bookings').rows;
    rows[rows.length - 1].cells[8].textContent = 'Cancelled';
    rows[0].cells[4].textContent = 'Frame refreshed room';
  })()`);
  await waitFor(`${shadow}.querySelectorAll('.booking-event').length === 3 && ${query('#fbs-content')}.textContent.includes('Frame refreshed room')`, 'nested document mutations update the top calendar');
  console.log('PASS: nested row cancellation and room changes refresh automatically');

  await evaluate(`(async () => {
    const shell = document.querySelector('#home-frame').contentDocument;
    const previous = shell.querySelector('#bookings-frame');
    const replacement = previous.cloneNode(false);
    replacement.dataset.testReplacement = 'true';
    const loaded = new Promise(resolve => replacement.addEventListener('load', resolve, {once:true}));
    previous.replaceWith(replacement);
    await loaded;
  })()`);
  await waitFor(`${shadow}.querySelectorAll('.booking-event').length === 4 && !${query('#fbs-content')}.textContent.includes('Frame refreshed room')`, 'replacement iframe loads fresh bookings');
  await evaluate(`(() => { ${sourceDocument}.querySelector('#live-bookings').rows[0].cells[8].textContent = 'Cancelled'; })()`);
  await waitFor(`${shadow}.querySelectorAll('.booking-event').length === 3`, 'replacement iframe remains observed');
  assert.equal(await evaluate(`document.querySelectorAll('#smu-fbs-calendar-extension').length`), 1);
  console.log('PASS: replaced nested iframe reloads and later changes remain observed');
}

async function navigationScenarios() {
  const origin = await serveFixtures();
  async function load(mode, extra = '') {
    await send('Page.navigate', { url: `${origin}/tests/fixtures/navigation-layout.html?mode=${mode}${extra}` });
    await waitFor(`!!globalThis.FBSNavigation?.ensureMyBookings`, 'navigation helper loads');
  }
  const ensure = (timeoutMs = 2000) => evaluate(`FBSNavigation.ensureMyBookings({timeoutMs:${timeoutMs},pollMs:20})`);

  await load('delayed', '&shellDelay=160&runtime=1');
  await waitFor('typeof window.__runtimeListener === "function"', 'content message listener is registered');
  const delayed = await evaluate(`(() => {
    window.__untrustedResponse = false;
    window.__runtimeListener({type:'FBS_OPEN_CALENDAR',navigate:true}, {id:'another-extension'}, () => {window.__untrustedResponse = true;});
    const first = FBSNavigation.ensureMyBookings({timeoutMs:2500,pollMs:20});
    const second = FBSNavigation.ensureMyBookings({timeoutMs:2500,pollMs:20});
    const message = new Promise(resolve => {
      window.__messageChannelKeptOpen = window.__runtimeListener(
        {type:'FBS_OPEN_CALENDAR',navigate:true},
        {id:'fictional-fbs-extension'},
        resolve
      );
    });
    return Promise.all([first, second, message]);
  })()`);
  assert.equal(delayed.length, 3);
  assert.ok(delayed.every(result => result.ok === true), JSON.stringify(delayed));
  assert.equal(await evaluate('window.__navigationClicks'), 1, 'concurrent navigation requests click My Bookings only once');
  assert.equal(await evaluate('window.__unsafeClicks'), 0, 'VIEW, EDIT, CANCEL, Booking and decoy links are untouched');
  assert.equal(await evaluate('window.__untrustedResponse'), false, 'other extension senders are ignored');
  assert.equal(await evaluate('window.__messageChannelKeptOpen'), true, 'async content reply keeps the Chrome message channel open');
  assert.equal(await evaluate('window.__readyMessage.type'), 'FBS_CONTENT_READY');
  assert.equal(await evaluate('FBSParser.extractBookings(document).bookings.length'), 4);
  assert.equal(await evaluate(`${query('#fbs-dialog')}.open`), true, 'runtime message opens the calendar without a launcher click');
  await click('#fbs-next-booking');
  await waitFor(`${shadow}.querySelectorAll('.booking-event').length === 4`, 'calendar opens after navigating from Booking');
  assert.equal((await ensure()).ok, true);
  assert.equal(await evaluate('window.__navigationClicks'), 1, 'repeated navigation after success does not click again');
  console.log('PASS: delayed shell navigation is idempotent, opens My Bookings and displays four calendar bookings');

  await load('child-events');
  await waitFor(`!!document.querySelector('#home-frame')?.contentDocument?.querySelector('#MyBookingsTab img')`, 'actual FBS nested navigation shape loads');
  await evaluate(`document.querySelector('#home-frame').contentDocument.querySelector('#mybookings_anchor').click()`);
  assert.equal(await evaluate('window.__navigationClicks'), 0, 'anchor-only click does not reach the child DIV handler');
  assert.equal(await evaluate('FBSParser.extractBookings(document).tableCount'), 0, 'anchor-only legacy behavior leaves Booking selected');
  assert.equal((await ensure()).ok, true);
  assert.equal(await evaluate('window.__navigationClicks'), 1, 'clicking a visible child reaches FBS navigation');
  assert.equal(await evaluate('window.__unsafeClicks'), 0);
  console.log('PASS: child-bound FBS navigation works where an anchor-only click does not');

  await load('late-binding');
  await waitFor(`!!document.querySelector('#home-frame')?.contentDocument?.querySelector('#mybookings_anchor') && document.querySelector('#home-frame').contentDocument.readyState !== 'complete'`, 'visible navigation exists before its iframe finishes loading');
  assert.equal((await ensure(2500)).ok, true);
  assert.equal(await evaluate('window.__earlyAnchorClicks'), 0, 'navigation waits until load-time initialization and binding finish');
  assert.equal(await evaluate('window.__navigationClicks'), 1);
  assert.equal(await evaluate('window.__unsafeClicks'), 0);
  assert.equal(await evaluate('FBSParser.extractBookings(document).bookings.length'), 4);
  console.log('PASS: cold-start navigation waits for iframe initialization and late child-event binding');

  await load('already');
  await waitFor('FBSParser.extractBookings(document).tableCount > 0', 'fixture starts on My Bookings');
  assert.equal((await ensure()).ok, true);
  assert.equal(await evaluate('window.__navigationClicks'), 0, 'already-loaded My Bookings is reused');
  assert.equal(await evaluate('window.__unsafeClicks'), 0);
  console.log('PASS: already-loaded My Bookings does not receive an extra navigation click');

  await load('empty');
  const empty = await ensure();
  assert.equal(empty.ok, true, JSON.stringify(empty));
  const emptySource = await evaluate('FBSParser.extractBookings(document)');
  assert.ok(emptySource.tableCount > 0, 'empty result still has a semantic booking header');
  assert.equal(emptySource.bookings.length, 0);
  assert.equal(await evaluate('window.__navigationClicks'), 1);
  await click('#fbs-launcher');
  await waitFor(`${query('#fbs-dialog')}.open`, 'empty-bookings calendar opens');
  await waitFor(`!${query('#fbs-refresh')}.disabled`, 'empty-bookings collection finishes');
  assert.ok(await evaluate(`${query('#fbs-content')}.textContent.includes('No readable bookings loaded')`));
  console.log('PASS: empty My Bookings is a successful navigation result');

  await load('stuck');
  const timeout = await ensure(350);
  assert.equal(timeout.ok, false);
  assert.equal(timeout.code, 'NAVIGATION_FAILED');
  assert.equal(timeout.fatal, true);
  assert.match(timeout.error, /My Bookings|FBS|log|sign|time|load/i);
  assert.equal(await evaluate('window.__navigationClicks'), 1);
  assert.equal(await evaluate('window.__unsafeClicks'), 0);
  console.log('PASS: a booking navigation timeout reports a clear failure without touching reservation actions');

  await load('missing');
  const missing = await ensure(250);
  assert.equal(missing.ok, false);
  assert.equal(await evaluate('window.__navigationClicks'), 0);
  assert.equal(await evaluate('window.__unsafeClicks'), 0, 'similar labels do not substitute for the exact My Bookings anchor');
  console.log('PASS: similar link labels never substitute for the exact My Bookings navigation');

  await load('unsafe');
  const unsafe = await ensure(250);
  assert.equal(unsafe.ok, false);
  assert.equal(await evaluate('window.__navigationClicks'), 0, 'off-origin My Bookings destination is rejected before clicking');
  assert.equal(await evaluate('window.__unsafeClicks'), 0);
  console.log('PASS: off-origin navigation destinations are rejected');

  await load('password');
  await waitFor(`!!document.querySelector('#home-frame')?.contentDocument?.querySelector('input[type="password"]')`, 'fictional manual sign-in field loads');
  const signIn = await ensure();
  assert.equal(signIn.ok, false);
  assert.equal(signIn.code, 'AUTH_REQUIRED');
  assert.equal(signIn.retry, true);
  assert.equal(await evaluate('window.__navigationClicks'), 0);
  assert.equal(await evaluate('window.__unsafeClicks'), 0);
  console.log('PASS: sign-in is left to the user and navigation returns a resumable status');
}

async function paginationScenarios() {
  const origin = await serveFixtures();
  const sourceWindow = `document.querySelector('#home-frame').contentDocument.querySelector('#bookings-frame').contentWindow`;
  const sourceDocument = `${sourceWindow}.document`;
  async function load(extra = '') {
    await send('Page.navigate', {url: `${origin}/tests/fixtures/pagination-layout.html?${extra}`});
    await waitFor(`!!globalThis.FBSPagination?.createCollector && !!document.querySelector('#home-frame')?.contentDocument?.querySelector('#bookings-frame')?.contentDocument?.querySelector('#pagination-rows')`, 'paginated nested fixture and collector load');
    await waitFor(`!!document.querySelector('#smu-fbs-calendar-extension')?.shadowRoot?.querySelector('#fbs-launcher')`, 'paginated calendar launcher loads');
  }
  async function complete(label = '') {
    try {
      await waitFor(`!${query('#fbs-refresh')}.disabled && !${query('#fbs-export')}.disabled && /15\\b/.test(${query('#fbs-count')}.textContent)`, 'all 15 paginated rows finish collecting ' + label);
    } catch (error) {
      console.error('Pagination failure details:', await evaluate(`({mode:window.__paginationFixture.mode,visits:window.__paginationFixture.visits,unsafeClicks:window.__paginationFixture.unsafeClicks,count:${query('#fbs-count')}.textContent,warnings:${query('#fbs-warnings')}.textContent,busy:${query('#fbs-load-all')}.getAttribute('aria-busy'),source:FBSParser.extractBookings(document),inspection:FBSPagination.createCollector().inspect()})`));
      throw error;
    }
  }
  async function captureExports() {
    await evaluate(`(() => {
      window.__fbsExport = null;
      window.__fbsExportCount = 0;
      const originalURL = URL.createObjectURL;
      URL.createObjectURL = function(blob) { window.__fbsExportCount += 1; window.__fbsExport = blob.text(); return originalURL.call(this, blob); };
      const originalClick = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function() { if (!this.download) return originalClick.call(this); };
    })()`);
  }
  async function exportText() {
    await evaluate('window.__fbsExport = null');
    await click('#fbs-export');
    await waitFor('window.__fbsExport !== null', 'paginated ICS generation finishes');
    return (await evaluate('window.__fbsExport')).replace(/\r\n[ \t]/g, '');
  }
  async function jump(date) {
    await evaluate(`(() => { const input = ${query('#fbs-date')}; input.value = ${JSON.stringify(date)}; input.dispatchEvent(new Event('change', {bubbles:true})); })()`);
  }

  await load();
  assert.equal(await evaluate('FBSParser.extractBookings(document).bookings.length'), 10, 'first FBS page really contains only ten rows');
  const openMs = await evaluate(`(() => { const started=performance.now(); ${query('#fbs-launcher')}.click(); return performance.now()-started; })()`);
  assert.ok(openMs < 1000, `current-page calendar renders synchronously, measured ${openMs.toFixed(1)} ms`);
  assert.deepEqual(await evaluate('window.__paginationFixture.visits'), [], 'opening makes no paging requests');
  assert.match(await evaluate(`${query('#fbs-count')}.textContent`), /10 loaded$/);
  assert.equal(await evaluate(`${query('#fbs-export')}.textContent`), '↓ Export this page');
  await captureExports();
  const pageOnly = await exportText();
  assert.equal((pageOnly.match(/BEGIN:VEVENT/g) || []).length, 9, 'page-only export explicitly contains its nine confirmed rows');
  assert.equal(pageOnly.includes('SUMMARY:Fixture Room 015'), false);
  assert.deepEqual(await evaluate('window.__paginationFixture.visits'), [], 'current-page export makes no paging requests');
  console.log(`PASS: current-page calendar opens in ${openMs.toFixed(1)} ms and exports without paging requests`);

  await jump('2026-11-23');
  assert.equal(await count(), 1, 'current-page view contains only the one loaded booking in the later week');
  await evaluate('window.__paginationFixture.delay = 350');
  await click('#fbs-load-all');
  assert.equal(await count(), 1, 'the existing calendar remains visible during optional collection');
  assert.equal(await evaluate(`${query('#fbs-next')}.disabled`), false, 'week navigation stays usable while pages load');
  await click('#fbs-next');
  await click('#fbs-prev');
  await complete();
  // A restore-related iframe mutation must not replace the aggregate after debounce.
  await new Promise(resolve => setTimeout(resolve, 500));
  assert.match(await evaluate(`${query('#fbs-count')}.textContent`), /15\b/);
  assert.equal(await evaluate(`${sourceWindow}.__fixturePage`), 1, 'collection restores the original FBS page');
  assert.equal(await evaluate('window.__paginationFixture.unsafeClicks'), 0, 'other grid pagers and reservation actions remain untouched');
  await jump('2026-11-23');
  await waitFor(`${shadow}.querySelectorAll('.booking-event').length === 6`, 'week contains one first-page and five second-page bookings');
  assert.equal(await evaluate(`${query('#fbs-count')}.textContent`), '6 bookings this week · 24 hrs · 15 loaded', 'the reported week combines all six slots and 24 hours across both FBS pages');
  if (screenshotPath) {
    const screenshot = await send('Page.captureScreenshot', {format: 'png', captureBeyondViewport: false});
    const requested = path.resolve(screenshotPath);
    const output = path.join(path.dirname(requested), path.basename(requested, path.extname(requested)) + '-pagination.png');
    fs.mkdirSync(path.dirname(output), {recursive: true});
    fs.writeFileSync(output, Buffer.from(screenshot.data, 'base64'));
    console.log(`Pagination screenshot: ${output}`);
  }
  console.log('PASS: a ten-plus-five-row FBS list becomes one calendar and restores page one');

  const collectedVisits = await evaluate('window.__paginationFixture.visits.slice()');
  await click('#fbs-next');
  await waitFor(`${shadow}.querySelectorAll('.booking-event').length === 0`, 'empty displayed week');
  const combined = await exportText();
  assert.equal((combined.match(/BEGIN:VEVENT/g) || []).length, 14, 'all confirmed rows across both pages export from an empty displayed week');
  assert.equal(new Set([...combined.matchAll(/^UID:(.+)$/gm)].map(match => match[1])).size, 14, 'each exported event has a unique identifier');
  assert.ok(combined.includes('SUMMARY:Fixture Room 001'));
  assert.ok(combined.includes('SUMMARY:Fixture Room 015'));
  assert.equal(combined.includes('SUMMARY:Fixture Room 008'), false, 'withdrawn row is excluded');
  assert.ok(combined.includes('DTSTART:20261126T093000Z'), 'second-page Singapore 17:30 exports as UTC 09:30');
  assert.equal(await evaluate(`${sourceWindow}.__fixturePage`), 1);
  assert.deepEqual(await evaluate('window.__paginationFixture.visits'), collectedVisits, 'combined export reuses the verified snapshot without paging');
  await click('#fbs-close');
  await click('#fbs-launcher');
  assert.match(await evaluate(`${query('#fbs-count')}.textContent`), /15 loaded$/);
  assert.equal(((await exportText()).match(/BEGIN:VEVENT/g) || []).length, 14);
  assert.deepEqual(await evaluate('window.__paginationFixture.visits'), collectedVisits, 'reopening and repeated export do not rescan pages');
  console.log('PASS: one ICS contains all fourteen confirmed bookings across FBS pages and displayed weeks');

  await click('#fbs-refresh');
  assert.match(await evaluate(`${query('#fbs-count')}.textContent`), /10 loaded$/);
  assert.equal(await evaluate(`${query('#fbs-export')}.textContent`), '↓ Export this page');
  assert.deepEqual(await evaluate('window.__paginationFixture.visits'), collectedVisits, 'Re-read page does not request other pages');
  await click('#fbs-load-all');
  await complete();
  const repeated = await exportText();
  assert.equal((repeated.match(/BEGIN:VEVENT/g) || []).length, 14, 'refresh and repeated export do not accumulate duplicates');
  await evaluate(`window.__paginationFixture.records[14].status = 'Cancelled'`);
  await click('#fbs-load-all');
  await complete();
  const amended = await exportText();
  assert.equal((amended.match(/BEGIN:VEVENT/g) || []).length, 13, 'a cancellation on another page replaces the previous aggregate');
  assert.equal(amended.includes('SUMMARY:Fixture Room 015'), false);
  assert.equal(await evaluate('window.__paginationFixture.unsafeClicks'), 0);
  console.log('PASS: rereading all pages avoids duplicates and removes stale confirmed cancellations');

  await load('page=2');
  assert.equal(await evaluate('FBSParser.extractBookings(document).bookings.length'), 5, 'fixture starts with just the final five rows');
  await click('#fbs-launcher');
  assert.match(await evaluate(`${query('#fbs-count')}.textContent`), /5 loaded$/);
  assert.deepEqual(await evaluate('window.__paginationFixture.visits'), [], 'opening on page two is also immediate');
  await click('#fbs-load-all');
  await complete();
  await new Promise(resolve => setTimeout(resolve, 500));
  assert.equal(await evaluate(`${sourceWindow}.__fixturePage`), 2, 'opening from page two restores page two');
  assert.match(await evaluate(`${query('#fbs-count')}.textContent`), /15\b/);
  await captureExports();
  assert.equal(((await exportText()).match(/BEGIN:VEVENT/g) || []).length, 14);
  console.log('PASS: opening from the final FBS page still collects the complete list and restores that page');

  for (const mode of ['reload', 'replace', 'marker-first', 'nested-markers']) {
    await load(`mode=${mode}`);
    if (mode === 'marker-first') await evaluate('window.__paginationFixture.delay = 350');
    await click('#fbs-launcher');
    await click('#fbs-load-all');
    await complete(mode);
    await new Promise(resolve => setTimeout(resolve, 500));
    assert.equal(await evaluate(`${sourceWindow}.__fixturePage`), 1, `${mode}: original page restored`);
    assert.match(await evaluate(`${query('#fbs-count')}.textContent`), /15\b/, `${mode}: aggregate remains intact after source observation`);
    assert.equal(await evaluate('window.__paginationFixture.unsafeClicks'), 0);
    await captureExports();
    const exported = await exportText();
    assert.equal((exported.match(/BEGIN:VEVENT/g) || []).length, 14, `${mode}: all confirmed rows export`);
    assert.ok(exported.includes('SUMMARY:Fixture Room 015'), `${mode}: delayed last-page data is not skipped`);
  }
  console.log('PASS: paginated collection survives iframe reloads, iframe replacement, early page markers and nested pager captions');

  // Chrome content scripts run in an isolated world. The pager's JavaScript
  // belongs to FBS's page world, so test native link activation across that boundary.
  await load('mode=reload');
  const frameTree = await send('Page.getFrameTree');
  const isolated = await send('Page.createIsolatedWorld', {frameId: frameTree.frameTree.frame.id, worldName: 'fbs-pagination-isolated-test'});
  const collectorSources = ['core.js', 'parser.js', 'pagination.js'].map(file => fs.readFileSync(path.join(root, file), 'utf8')).join('\n');
  await evaluate(collectorSources, isolated.executionContextId);
  const isolatedResult = await evaluate(`FBSPagination.createCollector({root:document,parser:FBSParser,timeoutMs:2500,pollMs:30}).collect()`, isolated.executionContextId);
  assert.equal(isolatedResult.pagination.complete, true, JSON.stringify(isolatedResult.pagination));
  assert.equal(isolatedResult.bookings.length, 15, 'an isolated-world collector reaches FBS main-world pager handlers');
  assert.equal(await evaluate(`${sourceWindow}.__fixturePage`), 1);
  assert.equal(await evaluate('window.__paginationFixture.unsafeClicks'), 0);
  console.log('PASS: explicit CDP-isolated collector can traverse the synthetic pager');

  await load('timeout=450');
  await evaluate('window.__paginationFixture.failPage = 2');
  await captureExports();
  await click('#fbs-launcher');
  assert.deepEqual(await evaluate('window.__paginationFixture.visits'), [], 'a broken next page cannot delay opening');
  await click('#fbs-load-all');
  await waitFor(`!${query('#fbs-refresh')}.disabled && !${query('#fbs-export')}.disabled && !${query('#fbs-warnings')}.hidden`, 'failed optional collection leaves the current-page export available');
  assert.match(await evaluate(`${query('#fbs-warnings')}.textContent`), /page|load|complete|collect/i);
  assert.equal(await evaluate(`${query('#fbs-export')}.textContent`), '↓ Export this page');
  const failedPageExport = await exportText();
  assert.equal((failedPageExport.match(/BEGIN:VEVENT/g) || []).length, 9, 'the explicitly page-only export contains current rows, not a purported combined result');
  assert.equal(failedPageExport.includes('SUMMARY:Fixture Room 015'), false);
  assert.match(await evaluate(`${query('#fbs-announcement')}.textContent`), /this FBS page only/);
  assert.equal(await evaluate('window.__paginationFixture.unsafeClicks'), 0);
  console.log('PASS: failed optional paging preserves the calendar and labels its page-only export clearly');

  await load();
  await evaluate(`(() => { const identity=document.createElement('a'); identity.id='menu_linkName'; identity.textContent='Fictional Account A'; document.body.appendChild(identity); })()`);
  await click('#fbs-launcher');
  await click('#fbs-load-all');
  await complete();
  await captureExports();
  const beforeScopeVisits = await evaluate('window.__paginationFixture.visits.slice()');
  await evaluate(`document.querySelector('#menu_linkName').textContent='Fictional Account B'`);
  await waitFor(`${query('#fbs-export')}.textContent === '↓ Export this page' && /10 loaded$/.test(${query('#fbs-count')}.textContent)`, 'an account change invalidates the combined snapshot');
  assert.equal(((await exportText()).match(/BEGIN:VEVENT/g) || []).length, 9);
  assert.deepEqual(await evaluate('window.__paginationFixture.visits'), beforeScopeVisits, 'account invalidation does not trigger a rescan');
  await click('#fbs-load-all');
  await complete();
  const priorExports = await evaluate('window.__fbsExportCount');
  await evaluate(`${sourceDocument}.querySelector('#ViewBooking_Search_textSearch').value='different filter'`);
  await click('#fbs-export');
  assert.equal(await evaluate('window.__fbsExportCount'), priorExports, 'a changed filter cannot silently export the prior combined snapshot');
  assert.equal(await evaluate(`${query('#fbs-export')}.textContent`), '↓ Export this page');
  assert.match(await evaluate(`${query('#fbs-announcement')}.textContent`), /results changed/);
  assert.equal(((await exportText()).match(/BEGIN:VEVENT/g) || []).length, 9);
  console.log('PASS: account and filter changes invalidate cached all-page exports without automatic paging');

  for (const field of ['account', 'filter']) {
    await load();
    await evaluate(`(() => {
      const identity=document.createElement('a'); identity.id='menu_linkName'; identity.textContent='Fictional Account A'; document.body.appendChild(identity);
      window.__paginationFixture.afterCollect = () => {
        window.__paginationFixture.afterCollect = null;
        ${field === 'account' ? "identity.textContent='Fictional Account B';" : `${sourceDocument}.querySelector('#ViewBooking_Search_textSearch').value='changed after collection';`}
      };
    })()`);
    await click('#fbs-launcher');
    await captureExports();
    await click('#fbs-load-all');
    await waitFor(`!${query('#fbs-refresh')}.disabled && !${query('#fbs-warnings')}.hidden`, 'a scope change in the collection handoff is rejected');
    assert.equal(await evaluate(`${query('#fbs-export')}.textContent`), '↓ Export this page');
    assert.match(await evaluate(`${query('#fbs-count')}.textContent`), /10 loaded$/);
    assert.equal(((await exportText()).match(/BEGIN:VEVENT/g) || []).length, 9, `${field}: old off-page results are discarded`);
  }
  console.log('PASS: scope changes during the collection handoff cannot attach an old aggregate to new results');
}

async function main() {
  profile = fs.mkdtempSync(path.join(os.tmpdir(), 'fbs-calendar-test-'));
  const endpoint = await new Promise((resolve, reject) => {
    child = spawn(executable, [
      '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
      '--disable-background-networking', '--disable-sync', '--disable-component-update',
      '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank',
    ], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    const timeout = setTimeout(() => reject(new Error(`Chrome did not start: ${stderr.slice(-2000)}`)), 20000);
    child.once('error', (error) => { clearTimeout(timeout); reject(error); });
    child.stderr.on('data', (data) => {
      stderr += data;
      const match = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) { clearTimeout(timeout); resolve(match[1]); }
    });
    child.once('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(`Chrome exited (${code}): ${stderr.slice(-2000)}`));
    });
  });
  const base = new URL(endpoint);
  const targets = await fetch(`http://${base.host}/json/list`).then((response) => response.json());
  const target = targets.find((item) => item.type === 'page');
  assert.ok(target, 'Chrome exposes a page target');
  socket = new WebSocket(target.webSocketDebuggerUrl);
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.method === 'Runtime.exceptionThrown') {
      pageErrors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
    }
    const request = pending.get(message.id);
    if (!request) return;
    clearTimeout(request.timeout);
    pending.delete(message.id);
    if (message.error) request.reject(new Error(message.error.message));
    else request.resolve(message.result);
  });
  socket.addEventListener('close', () => {
    for (const request of pending.values()) {
      clearTimeout(request.timeout);
      request.reject(new Error('Browser connection closed'));
    }
    pending.clear();
  });
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: pathToFileURL(path.join(root, 'demo', 'index.html')).href });
  await waitFor(`!!document.querySelector('#smu-fbs-calendar-extension')?.shadowRoot?.querySelector('#fbs-launcher')`, 'calendar launcher');
  await click('#fbs-launcher');
  await waitFor(`${query('#fbs-dialog')}.open`, 'calendar opens');
  await waitFor(`!${query('#fbs-refresh')}.disabled`, 'initial calendar source collection finishes');
  assert.equal(await evaluate(`!!${query('#fbs-outlook')}`), false, 'direct Outlook sync is absent');
  await click('#fbs-next-booking');
  await waitFor(`${shadow}.querySelectorAll('.booking-event').length === 4`, 'four demo bookings');
  console.log('PASS: demo rows become four calendar bookings');
  if (screenshotPath) {
    const screenshot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    const output = path.resolve(screenshotPath);
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, Buffer.from(screenshot.data, 'base64'));
    console.log(`Screenshot: ${output}`);
  }

  const originalRange = await evaluate(`${query('#fbs-range')}.textContent`);
  await click('#fbs-prev');
  assert.notEqual(await evaluate(`${query('#fbs-range')}.textContent`), originalRange);
  await click('#fbs-next');
  assert.equal(await evaluate(`${query('#fbs-range')}.textContent`), originalRange);
  await input('4-4');
  await waitFor(`${shadow}.querySelectorAll('.booking-event').length === 1`, 'room search');
  await input('');
  await waitFor(`${shadow}.querySelectorAll('.booking-event').length === 4`, 'cleared room search');
  console.log('PASS: week navigation and room search');

  await evaluate(`(() => {
    window.__fbsExport = null;
    const original = URL.createObjectURL;
    URL.createObjectURL = function(blob) { window.__fbsExport = blob.text(); return original.call(this, blob); };
    const originalClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function() { if (!this.download) return originalClick.call(this); };
  })()`);
  await waitFor(`!${query('#fbs-export')}.disabled`, 'initial calendar collection finishes before export');
  await click('#fbs-export');
  await waitFor('window.__fbsExport !== null', 'initial ICS export completes');
  const exported = await evaluate('window.__fbsExport');
  assert.equal((exported.match(/BEGIN:VEVENT/g) || []).length, 4);
  assert.ok(exported.includes('DTSTART:20261116T060000Z'), 'Singapore 14:00 converts to UTC 06:00');
  console.log('PASS: calendar export contains confirmed bookings with Singapore times');

  await click('.booking-event');
  assert.ok(await evaluate(`${query('#fbs-details')}.textContent.length > 0`), 'booking detail is available');
  await click('#fbs-view-agenda');
  assert.equal(await evaluate(`${shadow}.querySelectorAll('.agenda-booking').length`), 4);
  await click('#fbs-view-week');
  console.log('PASS: booking details and agenda view');

  await evaluate(`(() => { const rows = [...document.querySelector('table').rows]; const row = rows[rows.length - 1]; row.cells[8].textContent = 'Cancelled'; })()`);
  await waitFor(`${shadow}.querySelectorAll('.booking-event').length === 3`, 'cancellation detected');
  await status('all');
  await waitFor(`${shadow}.querySelectorAll('.booking-event').length === 4`, 'all statuses includes cancellation');
  await waitFor(`!${query('#fbs-export')}.disabled`, 'updated calendar collection finishes before export');
  await evaluate('window.__fbsExport = null');
  await click('#fbs-export');
  await waitFor('window.__fbsExport !== null', 'amended ICS export completes');
  const afterCancellation = await evaluate('window.__fbsExport');
  assert.equal((afterCancellation.match(/BEGIN:VEVENT/g) || []).length, 3, 'cancelled bookings are never exported');
  console.log('PASS: live cancellation updates calendar and export');

  await evaluate(`(() => {
    const table = document.querySelector('table'); const rows = [...table.rows];
    const row = rows[rows.length - 1].cloneNode(true);
    row.cells[1].textContent = 'DEMO-INJECTION-CHECK';
    row.cells[4].textContent = '<img src=x onerror="window.__fbsUnsafe = true">';
    row.cells[8].textContent = 'Pending';
    table.tBodies[0].appendChild(row);
  })()`);
  await waitFor(`${shadow}.querySelectorAll('.booking-event').length === 5`, 'new row detected');
  assert.equal(await evaluate(`!!window.__fbsUnsafe`), false);
  assert.equal(await evaluate(`${shadow}.querySelectorAll('.booking-event img').length`), 0);
  await status('confirmed');
  await waitFor(`${shadow}.querySelectorAll('.booking-event').length === 3`, 'confirmed filter excludes pending');
  console.log('PASS: inserted rows update safely and pending bookings stay separate');

  const malformed = await evaluate(`(() => {
    const body = document.querySelector('table').tBodies[0];
    const hidden = body.rows[0].cloneNode(true);
    hidden.hidden = true;
    hidden.cells[1].textContent = 'DEMO-HIDDEN';
    body.appendChild(hidden);
    const invalid = body.rows[0].cloneNode(true);
    invalid.cells[1].textContent = 'DEMO-INVALID-DATE';
    invalid.cells[2].textContent = '31-Nov-2026 14:00 - 17:00';
    body.appendChild(invalid);
    const result = FBSParser.extractBookings(document);
    return { count: result.bookings.length, warnings: result.warnings };
  })()`);
  assert.equal(malformed.count, 5, 'hidden and malformed rows are excluded');
  assert.equal(malformed.warnings.length, 1);
  assert.match(malformed.warnings[0], /DEMO-INVALID-DATE/);
  await waitFor(`!${query('#fbs-warnings')}.hidden`, 'malformed booking is reported visibly');
  console.log('PASS: hidden rows are excluded and malformed dates produce visible warnings');

  const source = fs.readFileSync(path.join(root, 'calendar.js'), 'utf8');
  await evaluate(source);
  assert.equal(await evaluate(`document.querySelectorAll('#smu-fbs-calendar-extension').length`), 1);
  console.log('PASS: reinjection does not duplicate the extension');
  await frameScenarios();
  await navigationScenarios();
  await paginationScenarios();
  assert.deepEqual(pageErrors, [], 'no uncaught browser errors');

  console.log('Browser smoke checks passed.');
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
}).finally(async () => {
  if (socket?.readyState === WebSocket.OPEN) {
    try { await send('Browser.close'); } catch (_) { /* Process may have exited first. */ }
    socket.close();
  }
  if (child && child.exitCode === null) child.kill();
  if (fixtureServer) {
    fixtureServer.closeAllConnections();
    await new Promise((resolve) => fixtureServer.close(resolve));
  }
  for (const request of pending.values()) clearTimeout(request.timeout);
  // Only remove the unique temporary profile created by this test.
  if (profile && path.dirname(path.resolve(profile)) === path.resolve(os.tmpdir()) && path.basename(profile).startsWith('fbs-calendar-test-')) {
    try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 8, retryDelay: 200 }); } catch (_) { /* Chrome can retain a short-lived lock. */ }
  }
});
