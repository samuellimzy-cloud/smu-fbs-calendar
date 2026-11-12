/* Calendar UI. Reads booking rows and uses only FBS's booking-list page controls. */
(() => {
  "use strict";
  const HOST_ID = "smu-fbs-calendar-extension";
  if (globalThis.__smuFbsCalendarInstalled) return;
  const core = globalThis.FBSCore;
  const parser = globalThis.FBSParser;
  const pagination = globalThis.FBSPagination;
  if (!core || !parser || !pagination || !globalThis.FBSStyles) return;
  // Chrome leaves DOM nodes behind when an extension is reloaded. A new
  // isolated context must replace that orphaned UI before registering again.
  document.getElementById(HOST_ID)?.remove();
  globalThis.__smuFbsCalendarInstalled = true;

  const host = document.createElement("div");
  host.id = HOST_ID;
  host.setAttribute("data-fbs-calendar", "");
  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = globalThis.FBSStyles;
  shadow.append(style);
  const calendarIcon = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M16 3v4M8 3v4M3 11h18M8 15h2M14 15h2"/></svg>';
  // Only static, authored markup goes through innerHTML. Booking values use textContent.
  const template = document.createElement("template");
  template.innerHTML = `
    <button id="fbs-launcher" type="button" aria-haspopup="dialog">${calendarIcon} Calendar view <span class="launcher-count">0</span></button>
    <dialog id="fbs-dialog" aria-labelledby="fbs-title" aria-describedby="fbs-description">
      <div class="shell">
        <header class="heading">
          <div><div class="eyebrow"><span class="brand-dot"></span> FBS Room Calendar</div>
            <h1 id="fbs-title" tabindex="-1">Your room bookings</h1>
            <p class="subtitle" id="fbs-description">A little more room to plan. All times in Singapore (UTC+8).</p>
          </div>
          <div class="heading-actions">
            <button class="button" id="fbs-refresh" type="button" title="Read the current FBS results page"><span aria-hidden="true">↻</span><span class="refresh-text">Re-read page</span></button>
            <button class="button" id="fbs-load-all" type="button" title="Read and combine every page of the current FBS results">Load all pages</button>
            <button class="button primary" id="fbs-export" type="button" title="Export confirmed bookings from this FBS page">↓ Export this page</button>
            <button class="button close icon" id="fbs-close" type="button" aria-label="Close calendar">×</button>
          </div>
        </header>
        <div class="controls">
          <div class="navigation">
            <button class="button icon" id="fbs-prev" type="button" aria-label="Previous week">‹</button>
            <div id="fbs-range" aria-live="polite"></div>
            <button class="button icon" id="fbs-next" type="button" aria-label="Next week">›</button>
          </div>
          <button class="button" id="fbs-today" type="button">This week</button>
          <button class="button" id="fbs-next-booking" type="button">Next booking</button>
          <div class="spacer"></div>
          <label class="date-jump">Go to <input type="date" id="fbs-date" aria-label="Go to the week containing this date"></label>
          <div class="view-toggle" aria-label="Calendar view">
            <button id="fbs-view-week" type="button" aria-pressed="true">Week</button>
            <button id="fbs-view-agenda" type="button" aria-pressed="false">Agenda</button>
          </div>
        </div>
        <div class="filters">
          <label class="search"><span class="sr-only">Search bookings</span><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/></svg><input id="fbs-search" type="search" placeholder="Search room, person or reference…"></label>
          <label><span class="sr-only">Booking status</span><select id="fbs-status"><option value="confirmed">Confirmed</option><option value="all">All statuses</option></select></label>
          <div id="fbs-count" role="status"></div>
        </div>
        <details id="fbs-warnings" hidden><summary></summary><ul></ul></details>
        <div id="fbs-announcement" role="status" aria-live="polite"></div>
        <main class="content-wrap">
          <div id="fbs-content" tabindex="0" aria-label="Bookings calendar"></div>
          <section id="fbs-details" aria-label="Booking details" hidden></section>
        </main>
        <footer class="footer"><span id="fbs-source-scope">Current FBS page · Load all pages to combine results.</span><span>Exports are snapshots; re-read FBS after changes.</span><span id="fbs-updated"></span></footer>
      </div>
    </dialog>`;
  shadow.append(template.content.cloneNode(true));
  document.body.append(host);
  const $ = (selector) => shadow.querySelector(selector);
  const state = {
    bookings: [], warnings: [], tableCount: 0, rowCount: 0,
    week: core.startOfWeek(core.singaporeToday()),
    view: window.innerWidth < 650 ? "agenda" : "week",
    sourceFingerprint: "", firstOpen: true, query: "", status: "confirmed",
    loading: false, scope: "page", currentReadable: false,
    pagination: {complete: false, pagesRead: 0}
  };
  const collector = pagination.createCollector({root: document, parser,
    ...(globalThis.chrome?.runtime?.id ? {activatePager: async request => {
      const reply = await chrome.runtime.sendMessage({type: "FBS_ACTIVATE_PAGER", request});
      if (!reply?.ok) throw new Error(reply?.error || "The FBS page control could not open. Reload the extension and refresh FBS.");
    }} : {})});
  let sourceRequest = null;
  let exportInProgress = false;
  let refreshTimer;
  const palette = [
    ["#eaf1ff", "#c9d9f7", "#426bb0", "#28467d"],
    ["#e6f4ef", "#c2e2d7", "#388779", "#236859"],
    ["#f2edfc", "#ded0f3", "#8563b0", "#63418f"],
    ["#fff1e5", "#f1d8bf", "#b58145", "#8c5c2b"],
    ["#e8f3f8", "#c7e0ed", "#3983a2", "#276980"]
  ];
  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const minutes = (time) => core.timeToMinutes(time);
  const weekEnd = () => core.addDays(state.week, 6);
  const sameWeek = (booking) => booking.date >= state.week && booking.date <= weekEnd();
  const duration = (booking) => (minutes(booking.endTime) - minutes(booking.startTime)) / 60;
  const searchMatches = (booking) => !state.query || [booking.room, booking.building, booking.bookedFor, booking.reference, booking.status].join(" ").toLocaleLowerCase().includes(state.query);
  const statusMatches = (booking) => state.status === "all" || (state.status === "confirmed" ? core.isConfirmed(booking) : booking.status.toLowerCase() === state.status);
  const sorted = (bookings) => [...bookings].sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime) || a.room.localeCompare(b.room));

  function colorize(node, booking) {
    let hash = 0;
    for (const char of booking.room) hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0;
    const colors = palette[Math.abs(hash) % palette.length];
    ["bg", "border", "accent", "text"].forEach((key, index) => node.style.setProperty(`--event-${key}`, colors[index]));
  }

  function announce(message) { $("#fbs-announcement").textContent = message; }

  function currentSource() {
    let result;
    try { result = parser.extractBookings(document); }
    catch (error) { result = {bookings: [], warnings: ["The booking table could not be read. Reopen My Bookings and try again."], tableCount: 0, rowCount: 0}; console.warn("FBS Room Calendar: table reading failed", error); }
    let info = {};
    try { info = collector.inspect(); } catch (_) { /* A source frame may be navigating. */ }
    const fingerprint = JSON.stringify([result, info.scopeKey, info.currentPage, info.totalItems, info.paged]);
    return {result, info, fingerprint};
  }

  function applySource(result) {
    Object.assign(state, result);
    $(".launcher-count").textContent = String(state.bookings.filter(core.isConfirmed).length);
    $("#fbs-updated").textContent = `Read ${new Intl.DateTimeFormat("en-SG", {timeZone: "Asia/Singapore", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false}).format(new Date())} SGT`;
    const statusSelect = $("#fbs-status");
    const statuses = [...new Set(state.bookings.map(booking => booking.status))].filter(status => status.toLowerCase() !== "confirmed").sort();
    statusSelect.replaceChildren(new Option("Confirmed", "confirmed"), new Option("All statuses", "all"), ...statuses.map(status => new Option(status, status.toLowerCase())));
    if (![...statusSelect.options].some(option => option.value === state.status)) state.status = "confirmed";
    statusSelect.value = state.status;
    const warnings = $("#fbs-warnings");
    warnings.hidden = !state.warnings.length;
    warnings.querySelector("summary").textContent = `${state.warnings.length} booking data notice${state.warnings.length === 1 ? "" : "s"}`;
    warnings.querySelector("ul").replaceChildren(...state.warnings.map(message => el("li", "", message)));
    $("#fbs-details").hidden = true;
    if ($("#fbs-dialog").open) render();
  }

  function refreshSource(force = false) {
    if (state.loading) return false;
    syncSourceObservers();
    const {result, info, fingerprint} = currentSource();
    if (!force && fingerprint === state.sourceFingerprint) return false;
    state.sourceFingerprint = fingerprint;
    const currentReadable = result.tableCount > 0 && !result.warnings.length;
    const complete = currentReadable && !info.paged && (info.totalItems == null || result.bookings.length === info.totalItems);
    applySource({...result, scope: "page", currentReadable, pagination: {complete, paged: !!info.paged,
      currentPage: info.currentPage, pagesRead: 1, totalPages: info.totalPages, totalItems: info.totalItems}});
    return true;
  }

  function collectSource() {
    if (sourceRequest) return sourceRequest;
    const initialScope = currentSource().info;
    clearTimeout(refreshTimer);
    state.loading = true;
    announce("Reading all FBS booking pages…");
    render();
    sourceRequest = (async () => {
      let result;
      try {
        result = await collector.collect({onProgress: progress => {
          const count = progress.pagesRead ?? 0;
          announce(`Reading FBS booking pages… ${count} page${count === 1 ? "" : "s"} read${progress.totalPages ? ` of ${progress.totalPages}` : ""}.`);
        }});
      } catch (error) {
        const current = currentSource().result;
        result = {...current, warnings: [...current.warnings, "Could not combine every FBS booking page. Use Export this page for the current rows, or retry Load all pages."], pagination: {complete: false, pagesRead: 0}};
        console.warn("FBS Room Calendar: booking pages could not be read", error);
      }
      state.loading = false;
      clearTimeout(refreshTimer);
      syncSourceObservers();
      const current = currentSource();
      state.sourceFingerprint = current.fingerprint;
      if (result.pagination?.complete && (current.info.scopeKey !== initialScope.scopeKey || current.info.totalItems !== initialScope.totalItems)) {
        result = {...result, warnings: ["The FBS account or results changed while pages were loading. Showing the current page; load all pages again for a combined export."], pagination: {...result.pagination, complete: false}};
      }
      if (result.pagination?.complete) {
        applySource({...result, scope: "all", currentReadable: false});
      } else {
        // Keep the ordinary page view usable when optional all-page collection fails.
        const currentReadable = current.result.tableCount > 0 && !current.result.warnings.length;
        applySource({...current.result, warnings: [...new Set([...current.result.warnings, ...result.warnings])],
          scope: "page", currentReadable,
          pagination: {complete: false, paged: !!current.info.paged, currentPage: current.info.currentPage,
            pagesRead: 1, totalPages: current.info.totalPages, totalItems: current.info.totalItems}});
      }
      const pages = result.pagination?.pagesRead || 1;
      announce(result.pagination?.complete
        ? `Read ${result.bookings.length} booking(s) across ${pages} FBS page${pages === 1 ? "" : "s"}.`
        : "Could not combine all FBS pages. Showing the current page; Export this page includes only these rows. You can retry Load all pages.");
      return result;
    })().finally(() => {sourceRequest = null;});
    return sourceRequest;
  }

  function nextBookingDate() {
    const today = core.singaporeToday();
    const candidates = sorted(state.bookings.filter(booking => searchMatches(booking) && statusMatches(booking)));
    const nowTime = new Intl.DateTimeFormat("en-GB", {timeZone: "Asia/Singapore", hour: "2-digit", minute: "2-digit", hour12: false}).format(new Date());
    return (candidates.find(booking => booking.date > today || (booking.date === today && booking.endTime > nowTime)) || candidates[0])?.date;
  }

  function open() {
    if (!host.isConnected) document.body.append(host);
    // Opening never requests another FBS page. An unchanged all-page snapshot is reusable.
    refreshSource();
    $("#fbs-launcher").hidden = true;
    if (!$("#fbs-dialog").open) $("#fbs-dialog").showModal();
    $("#fbs-title").focus();
    if (state.firstOpen) {
      const today = core.singaporeToday();
      state.week = core.startOfWeek(today);
      const date = nextBookingDate();
      if (!state.bookings.some(booking => sameWeek(booking) && core.isConfirmed(booking) && booking.date >= today) && date) state.week = core.startOfWeek(date);
      state.firstOpen = false;
    }
    render();
  }

  function close() {
    $("#fbs-dialog").close();
    $("#fbs-launcher").hidden = false;
    $("#fbs-launcher").focus();
  }

  function emptyView(title, message, showNext) {
    const container = el("div", "empty");
    const icon = el("span");
    icon.innerHTML = calendarIcon;
    container.append(icon, el("strong", "", title), el("p", "", message));
    if (showNext) {
      const button = el("button", "button", "Go to next booking");
      button.type = "button";
      button.addEventListener("click", jumpToBooking);
      container.append(button);
    }
    return container;
  }

  function render() {
    const allMatches = state.bookings.filter(booking => searchMatches(booking) && statusMatches(booking));
    const visible = sorted(allMatches.filter(sameWeek));
    const startOptions = {day: "numeric", month: "short"};
    $("#fbs-range").textContent = `${core.formatDate(state.week, startOptions)} – ${core.formatDate(weekEnd(), {day: "numeric", month: "short", year: "numeric"})}`;
    $("#fbs-date").value = state.week;
    $("#fbs-count").textContent = `${visible.length} booking${visible.length === 1 ? "" : "s"} this week · ${visible.reduce((sum, booking) => sum + duration(booking), 0).toLocaleString("en-SG", {maximumFractionDigits: 1})} hrs · ${state.bookings.length} loaded`;
    $("#fbs-view-week").setAttribute("aria-pressed", String(state.view === "week"));
    $("#fbs-view-agenda").setAttribute("aria-pressed", String(state.view === "agenda"));
    $("#fbs-next-booking").disabled = !allMatches.length;
    const exportable = state.bookings.filter(booking => searchMatches(booking) && core.isConfirmed(booking));
    const allPages = state.scope === "all" && state.pagination.complete;
    $("#fbs-export").disabled = state.loading || !(allPages || state.currentReadable) || exportable.length === 0;
    $("#fbs-export").textContent = allPages ? "↓ Export all pages" : "↓ Export this page";
    $("#fbs-export").title = state.loading ? "Reading all FBS booking pages…"
      : `Export ${exportable.length} confirmed booking(s) matching search from ${allPages ? "all collected FBS pages" : "this FBS results page only"}. The displayed week does not restrict export.`;
    $("#fbs-refresh").disabled = state.loading;
    $("#fbs-load-all").disabled = state.loading || !state.tableCount;
    $("#fbs-load-all").textContent = state.loading ? "Loading pages…" : allPages ? "Reload all pages" : "Load all pages";
    $("#fbs-load-all").hidden = !state.pagination.paged && !allPages;
    $("#fbs-load-all").setAttribute("aria-busy", String(state.loading));
    const pages = state.pagination.pagesRead || 1;
    $("#fbs-source-scope").textContent = state.loading ? "Showing your snapshot · Loading other FBS pages…" : allPages
      ? `All ${pages} FBS page${pages === 1 ? "" : "s"} read · Re-read after changes.`
      : `Current FBS page${state.pagination.currentPage ? ` ${state.pagination.currentPage}` : ""}${state.pagination.totalItems != null ? ` · ${state.bookings.length} of ${state.pagination.totalItems} rows` : ""}${state.pagination.paged ? " · Load all pages to combine results." : "."}`;
    const content = $("#fbs-content");
    const previousTop = content.scrollTop;
    const previousLeft = content.scrollLeft;
    content.replaceChildren();
    if (!state.tableCount) {
      content.append(emptyView("Open My Bookings first", "Close this calendar, open My Bookings in FBS and let the booking list load. Then open Calendar view again.", false));
    } else if (!state.bookings.length) {
      content.append(emptyView("No readable bookings loaded", state.warnings.length ? "Some rows could not be read. Check the data notices above." : "There are no bookings in the current FBS results. Check the page filters and try again.", false));
    } else if (!visible.length) {
      content.append(emptyView("A little room in your week", allMatches.length ? "There are no matching bookings in this week. Jump to a booking or choose another week." : "No bookings match these filters. Try another search or status.", !!allMatches.length));
    } else if (state.view === "agenda") {
      content.append(renderAgenda(visible));
    } else {
      content.append(renderWeek(visible));
    }
    content.scrollTop = previousTop;
    content.scrollLeft = previousLeft;
  }

  function renderWeek(bookings) {
    const calendar = el("div", "calendar");
    const header = el("div", "calendar-header");
    const zone = el("div", "zone", "SGT\nUTC+8");
    zone.style.whiteSpace = "pre-line";
    header.append(zone);
    const today = core.singaporeToday();
    const days = Array.from({length: 7}, (_, index) => core.addDays(state.week, index));
    for (const day of days) {
      const cell = el("div", `day-heading${day === today ? " is-today" : ""}`);
      cell.append(el("span", "day-name", core.formatDate(day, {weekday: "short"})), el("span", "day-number", core.formatDate(day, {day: "numeric"})));
      header.append(cell);
    }
    // Frame this week's bookings with an hour of space on either side.
    const startHour = Math.max(0, Math.min(...bookings.map(booking => Math.floor(minutes(booking.startTime) / 60))) - 1);
    const endHour = Math.min(24, Math.max(...bookings.map(booking => Math.ceil(minutes(booking.endTime) / 60))) + 1);
    const hourHeight = 62;
    const height = (endHour - startHour) * hourHeight;
    const timeline = el("div", "timeline");
    const labels = el("div", "time-labels");
    labels.style.height = `${height}px`;
    for (let hour = startHour; hour <= endHour; hour++) {
      const label = el("span", "time-label", `${String(hour).padStart(2, "0")}:00`);
      label.style.top = `${(hour - startHour) * hourHeight}px`;
      labels.append(label);
    }
    timeline.append(labels);
    for (const day of days) {
      const column = el("div", `day-column${day === today ? " is-today" : ""}`);
      column.style.height = `${height}px`;
      column.setAttribute("aria-label", core.formatDate(day, {weekday: "long", day: "numeric", month: "long"}));
      const dayBookings = bookings.filter(booking => booking.date === day);
      for (const cluster of overlapClusters(dayBookings)) {
        const lanes = [];
        const positioned = cluster.map(booking => {
          let lane = lanes.findIndex(end => end <= minutes(booking.startTime));
          if (lane === -1) lane = lanes.length;
          lanes[lane] = minutes(booking.endTime);
          return {booking, lane};
        });
        for (const {booking, lane} of positioned) {
          const button = el("button", "booking-event");
          button.type = "button";
          colorize(button, booking);
          button.style.top = `${(minutes(booking.startTime) - startHour * 60) / 60 * hourHeight + 2}px`;
          button.style.height = `${Math.max(25, duration(booking) * hourHeight - 4)}px`;
          button.style.left = `calc(${lane / lanes.length * 100}% + 3px)`;
          button.style.width = `calc(${100 / lanes.length}% - 6px)`;
          button.append(el("span", "event-time", `${booking.startTime}–${booking.endTime}`), el("span", "event-room", booking.room), el("span", "event-person", booking.bookedFor));
          if (!core.isConfirmed(booking)) button.append(el("span", "event-status", booking.status));
          button.title = `${booking.room}\n${booking.startTime}–${booking.endTime}\n${booking.bookedFor}\n${booking.status}`;
          button.setAttribute("aria-label", `${booking.room}, ${booking.date}, ${booking.startTime} to ${booking.endTime}, ${booking.status}. Show details`);
          button.addEventListener("click", () => showDetails(booking));
          column.append(button);
        }
      }
      timeline.append(column);
    }
    calendar.append(header, timeline);
    return calendar;
  }

  function overlapClusters(bookings) {
    const clusters = [];
    let cluster = [], end = -1;
    for (const booking of bookings) {
      const start = minutes(booking.startTime);
      if (cluster.length && start >= end) { clusters.push(cluster); cluster = []; end = -1; }
      cluster.push(booking);
      end = Math.max(end, minutes(booking.endTime));
    }
    if (cluster.length) clusters.push(cluster);
    return clusters;
  }

  function renderAgenda(bookings) {
    const agenda = el("div", "agenda");
    for (const date of [...new Set(bookings.map(booking => booking.date))]) {
      const section = el("section", "agenda-day");
      section.append(el("h2", "", core.formatDate(date, {weekday: "long", day: "numeric", month: "long"})));
      for (const booking of bookings.filter(item => item.date === date)) {
        const button = el("button", "agenda-booking");
        button.type = "button";
        colorize(button, booking);
        const description = el("div");
        description.append(el("div", "agenda-room", booking.room), el("div", "agenda-meta", `${booking.building} · ${booking.bookedFor}`));
        button.append(el("span", "agenda-time", `${booking.startTime}–${booking.endTime}`), description, el("span", "agenda-status", booking.status));
        button.addEventListener("click", () => showDetails(booking));
        section.append(button);
      }
      agenda.append(section);
    }
    return agenda;
  }

  function showDetails(booking) {
    const panel = $("#fbs-details");
    const closeButton = el("button", "button icon details-close", "×");
    closeButton.type = "button";
    closeButton.setAttribute("aria-label", "Close booking details");
    closeButton.addEventListener("click", () => { panel.hidden = true; $("#fbs-content").focus(); });
    const grid = el("div", "detail-grid");
    for (const [label, value] of [
      ["When", `${core.formatDate(booking.date)} · ${booking.startTime}–${booking.endTime} SGT`],
      ["Building", booking.building || "—"], ["Booked for", booking.bookedFor || "—"],
      ["Reference", booking.reference], ["Status", booking.status], ["Duration", `${duration(booking)} hours`]
    ]) {
      const cell = el("div");
      cell.append(el("div", "detail-label", label), el("div", "detail-value", value));
      grid.append(cell);
    }
    panel.replaceChildren(el("h2", "", booking.room), closeButton, grid);
    panel.hidden = false;
    closeButton.focus();
  }

  function changeWeek(offset) {
    state.week = core.addDays(state.week, offset * 7);
    $("#fbs-details").hidden = true;
    announce("");
    render();
  }

  function jumpToBooking() {
    const date = nextBookingDate();
    if (date) state.week = core.startOfWeek(date);
    $("#fbs-details").hidden = true;
    announce("");
    render();
  }

  $("#fbs-launcher").addEventListener("click", open);
  $("#fbs-close").addEventListener("click", close);
  $("#fbs-dialog").addEventListener("cancel", event => { event.preventDefault(); close(); });
  $("#fbs-prev").addEventListener("click", () => changeWeek(-1));
  $("#fbs-next").addEventListener("click", () => changeWeek(1));
  $("#fbs-today").addEventListener("click", () => {state.week = core.startOfWeek(core.singaporeToday()); $("#fbs-details").hidden = true; render();});
  $("#fbs-next-booking").addEventListener("click", jumpToBooking);
  $("#fbs-date").addEventListener("change", event => {
    const date = core.parseBookingDate(event.target.value);
    if (date) { state.week = core.startOfWeek(date); $("#fbs-details").hidden = true; render(); }
  });
  $("#fbs-search").addEventListener("input", event => {state.query = event.target.value.trim().toLocaleLowerCase(); $("#fbs-details").hidden = true; announce(""); render();});
  $("#fbs-status").addEventListener("change", event => {state.status = event.target.value; $("#fbs-details").hidden = true; announce(""); render();});
  for (const view of ["week", "agenda"]) $("#fbs-view-" + view).addEventListener("click", () => {state.view = view; $("#fbs-details").hidden = true; render();});
  $("#fbs-refresh").addEventListener("click", () => {refreshSource(true); announce("Read the current FBS results page. Use Load all pages to combine every page.");});
  $("#fbs-load-all").addEventListener("click", () => {void collectSource();});
  $("#fbs-export").addEventListener("click", () => {
    if (state.loading || exportInProgress) return;
    exportInProgress = true;
    try {
      const wasAllPages = state.scope === "all";
      const changed = refreshSource();
      if (wasAllPages && changed) {
        announce("The FBS results changed. Choose Load all pages to update the combined export, or Export this page for only the current rows.");
        return;
      }
      const allPages = state.scope === "all" && state.pagination.complete;
      if (!(allPages || state.currentReadable)) return;
      const bookings = state.bookings.filter(booking => searchMatches(booking) && core.isConfirmed(booking));
      if (!bookings.length) return;
      const blob = new Blob([core.toICS(bookings)], {type: "text/calendar;charset=utf-8"});
      const url = URL.createObjectURL(blob);
      const link = el("a");
      link.href = url;
      link.download = `fbs-bookings-${core.singaporeToday()}.ics`;
      shadow.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      announce(`Exported ${bookings.length} confirmed booking(s) matching your search from ${allPages ? "all collected FBS pages" : "this FBS page only"}, across all dates. Import the .ics file into your calendar.`);
    } catch (error) { announce("Export failed. Re-read the page and check the booking data notices."); console.warn("FBS Room Calendar: export failed", error); }
    finally {exportInProgress = false;}
  });

  const observedDocuments = new Map();

  function scheduleSourceRefresh() {
    if (state.loading) return;
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      refreshSource();
    }, 180);
  }

  function syncSourceObservers() {
    const sourceDocuments = new Set(parser.getAccessibleDocuments ? parser.getAccessibleDocuments(document) : [document]);
    // Each FBS iframe has its own DOM. Observe every accessible source document,
    // and discard observers when FBS navigates or replaces an iframe.
    for (const [sourceDocument, subscription] of observedDocuments) {
      if (sourceDocuments.has(sourceDocument)) continue;
      subscription.observer.disconnect();
      sourceDocument.removeEventListener("load", subscription.onLoad, true);
      observedDocuments.delete(sourceDocument);
    }
    for (const sourceDocument of sourceDocuments) {
      if (observedDocuments.has(sourceDocument)) continue;
      const observer = new MutationObserver(mutations => {
        if (mutations.some(mutation => mutation.target !== host && !host.contains(mutation.target))) scheduleSourceRefresh();
      });
      const onLoad = event => {
        if (/^(IFRAME|FRAME)$/.test(event.target?.tagName || "")) scheduleSourceRefresh();
      };
      observer.observe(sourceDocument, {
        subtree: true, childList: true, characterData: true, attributes: true,
        attributeFilter: ["hidden", "style", "class", "aria-hidden", "src", "srcdoc"]
      });
      sourceDocument.addEventListener("load", onLoad, true);
      observedDocuments.set(sourceDocument, {observer, onLoad});
    }
  }
  // The extension toolbar opens the same calendar in the logged-in FBS tab.
  // Demo pages do not expose the extension runtime, so they keep using the page button.
  if (globalThis.chrome?.runtime?.id && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (sender.id !== chrome.runtime.id) return;
      if (message?.type !== "FBS_OPEN_CALENDAR") return;
      const respond = async () => {
        try {
          if (message.navigate) {
            const result = await globalThis.FBSNavigation.ensureMyBookings();
            if (!result.ok) { sendResponse(result); return; }
          }
          await open();
          sendResponse({ok: true, bookings: state.bookings.length, tableFound: state.tableCount > 0});
        } catch (error) {
          sendResponse({ok: false, code: "NAVIGATION_FAILED", fatal: true, error: "Open My Bookings in FBS and click the extension again."});
          console.warn("FBS Room Calendar: could not open calendar", error);
        }
      };
      void respond();
      return true;
    });
    // Wake a pending toolbar request after FBS finishes loading or the user
    // completes normal SMU sign-in. The worker stores only the request's tab ID.
    chrome.runtime.sendMessage({type: "FBS_CONTENT_READY"}).catch(() => {});
  }
  refreshSource(true);
})();
