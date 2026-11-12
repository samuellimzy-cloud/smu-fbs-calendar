# FBS Calendar

> **Unofficial extension:** This extension is independently developed and has not been explicitly authorized or endorsed by Singapore Management University (SMU). Use it responsibly and in accordance with SMU's code of conduct, IT policies and facility booking rules. Do not use it to bypass restrictions or access accounts or bookings you are not permitted to view. If you are unsure whether its use is allowed, check with SMU before using it.

A Chrome/Edge extension that turns your SMU Facilities Booking System results into a weekly calendar. Version **1.5.0** opens the current results page immediately. Choose **Load all pages** when you want to combine a longer booking list into one calendar and `.ics` file.

For a short installation guide, see [INSTALL.txt](INSTALL.txt).

The calendar includes week navigation, a date picker, an agenda view for narrow screens, room/person/reference search, status filters, overlapping booking columns and booking details. Opening and exporting use the loaded booking snapshot without visiting other FBS pages. **Load all pages** is an optional operation with progress; it returns to the results page where it started.

## Open in PyCharm

Open this `FBS` folder as a project in PyCharm. The project uses plain JavaScript, HTML and CSS because browser extensions run in the browser. Python and a Python virtual environment are not required. There is no build step and no dependency installation.

## Try the local demo

Open `demo/index.html` in Chrome or Edge. The demo uses fictional booking references and names, with four sample bookings in the week of **16–22 November 2026**. Use the **Calendar view** button added by the script. Navigate to that week if needed.

The demo works directly from the file, without installing the extension or starting a server. Its add, cancel and reset buttons only change the sample table on the local page. No real bookings are affected.

## Use on FBS

1. In Chrome, open `chrome://extensions`. In Edge, open `edge://extensions`.
2. Enable **Developer mode**.
3. Choose **Load unpacked** and select this `FBS` folder, the one containing `manifest.json`.
4. Open FBS at `https://fbs.intranet.smu.edu.sg/home` and log in normally.
5. Refresh the FBS tab if it was already open during installation.
6. Open Chrome's puzzle-piece **Extensions** menu and pin **FBS Room Calendar**. Click its toolbar icon from any tab. It opens or focuses FBS, switches to **My Bookings**, and opens your calendar. The page's **Calendar view** button also works.

Once installed, the extension uses your normal logged-in FBS tab. Clicking from a new tab or another site reuses an open FBS tab, or opens FBS if none exists. If your SMU session has expired, complete sign-in normally; the calendar request resumes when FBS returns. Pending requests expire after 15 minutes. It also handles FBS tabs that were open before installation.

Chrome documents the local installation process in its [Load an unpacked extension guide](https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world#load-unpacked).

After editing extension files, reload the extension on the extensions page and refresh the FBS tab.

## What it reads

The extension reads booking reference, date, start/end time, building, facility, booked-for name and status from the booking table. Bookings under another person's name appear if FBS already includes them in your visible list.

It reads accessible same-origin nested FBS frames and handles the separate heading and data tables used by the FBS booking grid. The default view contains the bookings on the current FBS results page. If My Bookings has more than one page, choose **Load all pages** to follow the booking grid's page controls and combine the rows. You can start from any results page. Collection preserves distinct slots that share a multi-booking reference and removes duplicate copies of the same slot.

Closing and reopening the calendar reuses the loaded snapshot while the displayed source, signed-in account and FBS filters remain unchanged. **Re-read page** replaces it with the current page's rows and resets the view to page scope. Choose **Load all pages** again when you want a fresh combined list. Changes to the displayed source, account or filters discard the previous combined snapshot.

FBS search and date filters determine the scope of the results. The extension uses your existing signed-in session and reads only bookings available in those results. If optional all-page collection stalls or fails, the current-page calendar and **Export this page** remain usable. An incomplete combined list is never presented as an all-page export.

Dates and times are interpreted in **Singapore time (UTC+08:00)**.

## Calendar export

**Export this page** includes confirmed bookings from the loaded current-page snapshot. After **Load all pages** completes successfully, **Export all pages** includes confirmed bookings from the combined snapshot. Exporting does not start another page scan. The button and page-scope notice identify which list will be exported.

Both exports include bookings matching the calendar search across all dates in that snapshot. Week navigation and the calendar status filter do not restrict export. FBS's own search and date filters still apply. Pending, withdrawn, cancelled and rejected bookings are excluded. To capture changes made since loading, refresh FBS, choose **Re-read page**, and optionally **Load all pages** again before exporting.

An export is a **snapshot**, not a subscription or live sync. Later FBS amendments and cancellations do not update previously imported events. Check FBS for the current booking status. Repeated imports may create duplicates depending on the calendar app; the exporter uses stable event identifiers, but import behavior belongs to that app.

## Privacy and scope

The loaded booking snapshot is held only in the FBS page's memory; bookings are not saved in extension storage or carried between accounts or results filters. Optional all-page navigation uses FBS's own controls and normal signed-in session. The calendar view and `.ics` generation process the bookings locally. The extension has no calendar API integration, OAuth connection, analytics or application server. It does not ask for your SMU password or upload bookings to cloud services or GitHub. Opening or importing an exported file in a calendar app is a separate action you control.

Browser host access is limited to the SMU FBS site. No Microsoft application registration or calendar permissions are required.

The toolbar service worker stores pending FBS-open requests containing a tab ID and 15-minute expiry in extension session storage, so normal FBS sign-in can resume an open request. It does not poll or synchronize bookings in the background. Exported `.ics` files include booked-for names; store them where you normally keep private calendar data.

Live checks covered the nested-frame booking grid, calendar display, search, booking details, agenda view, toolbar opening and reuse of an existing SMU session. Those checks used a single results page. Regression fixtures use fictional references and names; source amendments, cancellations and pagination are tested through those fixtures. Rows that cannot be understood are reported instead of turned into incorrect events. Multi-page collection on live FBS still needs separate verification.

## Checks

Node.js is optional for development checks. From this folder, run:

```text
node --test tests/*.test.js
```

Or use `npm test` with the included `package.json`. No `npm install` is required.

For the browser smoke test, use **Node.js 22 or newer** and an installed copy of Chrome or Edge:

```text
node tests/browser-smoke.cjs
```

The dependency-free test at `tests/browser-smoke.cjs` opens the local demo in an isolated temporary headless browser profile. It uses Node's built-in WebSocket support and does not use your normal browser profile or SMU login. If the browser is installed somewhere the script does not find automatically, set `CHROME_PATH` to the browser executable before running it.

For a browser check, open the demo, verify the four room/time entries, add the Thursday sample, cancel the Monday sample, and export. Confirm the cancelled booking is absent from the exported file and the remaining times are correct in Singapore time.

Pagination fixtures use synthetic results split into 10 rows on page 1 and 5 on page 2, including one withdrawn booking. A complete combined snapshot contains 15 rows and exports 14 confirmed events. The week of 23–29 November contains six confirmed bookings (24 hours), including the five from the second FBS page. Regression checks cover source-page restoration, duplicate prevention, cancellation changes, replaced frames and delayed page contents. Live multi-page use of version 1.4.0 reported a page-2 timeout despite passing the earlier fixture tests.

Version 1.4.0 started a blocking all-page scan on every open, refresh and export. A stalled page waited up to 15 seconds, delaying ordinary calendar use. Its isolated-world fixture also omitted extension Content Security Policy, so that check did not reproduce the actual extension environment. Version 1.5.0 keeps ordinary viewing and snapshot export independent of optional page scanning.

Version 1.5.0 passed 77 Node tests and 32 Chrome browser scenario groups. A local synthetic 10-row opening measured 12.2 ms and made zero paging requests. Page-only export, cached all-page export and reopening also made zero paging requests. Optional collection kept the chart and navigation usable; failed collection retained the explicitly page-only export. The cause of the live page-2 timeout is not yet confirmed. Extension CSP blocking a JavaScript paging URL remains a hypothesis; no native-form/CSP experiment result was obtained.

For optional paging, the worker invokes the narrow `pager-bridge.js` function in the page's MAIN execution world. The function validates the exact FBS origin, source document, booking grid and native page command before activating one control; it does not evaluate a supplied script. Existing FBS-only host access and scripting permission cover this operation. The bridge boundary has separate tests. Multi-page collection still needs a live check with version 1.5.0.

## Files

| File | Purpose |
| --- | --- |
| `manifest.json` | Local extension configuration and FBS page matching |
| `background.js` | Toolbar handling and validated MAIN-world paging requests |
| `pager-bridge.js` | Worker-injected activation of validated native FBS page controls |
| `navigation.js` | Switching to My Bookings and waiting for its nested frames |
| `core.js` | Date/time parsing and calendar export |
| `parser.js` | Booking-table extraction |
| `pagination.js` | Collecting and checking all FBS booking results pages |
| `styles.js` | Isolated calendar styles inside the shadow root |
| `calendar.js` | Calendar interface and page integration |
| `demo/index.html` | Standalone sample page |
| `demo/demo.js` | Local sample-table controls |
| `tests/` | Dependency-free development checks |
