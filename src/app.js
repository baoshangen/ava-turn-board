(() => {
  const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  const TURN_COUNT = 15;
  const SPLIT = "␟"; // separator so one cell can hold two services (half turn)
  const STORAGE_PREFIX = "ava-turn-board-v1";
  const LOC_PARAM = new URLSearchParams(location.search).get("loc");
  const LOCKED = LOC_PARAM === "1" || LOC_PARAM === "2";
  let activeLoc = LOCKED ? Number(LOC_PARAM) : (Number(localStorage.getItem("ava-turn-board-loc")) === 2 ? 2 : 1);
  const storageKey = () => `${STORAGE_PREFIX}:loc${activeLoc}`;

  const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const freshState = () => ({
    activeDay: "Monday",
    centerTurn: 2,
    services: [],
    staffByDay: Object.fromEntries(DAYS.map(day => [day, []])),
    orderByDay: Object.fromEntries(DAYS.map(day => [day, []])),
    entries: {}
  });

  const loadState = () => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey()) || (activeLoc === 1 ? localStorage.getItem(STORAGE_PREFIX) : "null"));
      if (saved && saved.staffByDay && saved.services) return { ...freshState(), ...saved, orderByDay: saved.orderByDay || Object.fromEntries(DAYS.map(day => [day, (saved.staffByDay[day] || []).map(p => p.id)])) };
    } catch (_) {}
    return freshState();
  };

  let state = loadState();
  // Existing selected turns stay attached to their technician when arrival order changes.
  if (!state.orderByDay) state.orderByDay = Object.fromEntries(DAYS.map(day => [day, state.staffByDay[day].map(p => p.id)]));
  let baseState = null;
  let revision = 0, ready = false, saving = false, pending = false, failed = false;
  const shared = () => ({ services: state.services, staffByDay: state.staffByDay, orderByDay: state.orderByDay, entries: state.entries, name: state.name });
  const status = message => { document.querySelector('#sync-status').textContent = message; };
  async function sync() {
    if (saving || failed) return;
    saving = true;
    try {
      if (pending) {
        pending = false;
        const sent = JSON.parse(JSON.stringify(shared()));
        const response = await fetch('/api/board?loc='+activeLoc, { method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify({revision, data:sent}) });
        if (response.status === 403 && (await response.json().catch(()=>({}))).pinRequired) { pending = true; lockForPin(); return; }
        if (response.status === 409) {
          const latest = await fetch('/api/board?loc='+activeLoc, {cache:'no-store'});
          if (!latest.ok) throw new Error('Could not connect. Keep this page open and tap Retry.');
          const remote = await latest.json();
          if (!baseState) throw new Error('Another device initialized the board. Tap Retry to load it.');
          const merged = mergeBoard(baseState, shared(), remote.data);
          Object.assign(state, merged); baseState = structuredClone(remote.data); revision = remote.revision;
          pending = true; status('Combining changes…'); return;
        }
        if (response.status === 401) { $('#sign-in-again').hidden = false; throw new Error('Your session expired. Unsaved changes are still here. Tap Sign in again.'); }
        if (!response.ok) throw new Error('Could not save. Keep this page open and tap Retry.');
        revision = (await response.json()).revision; baseState = sent; dirty = false; renderBoard();
        status('Synced across devices');
      } else {
        const response = await fetch('/api/board?loc='+activeLoc, {cache:'no-store'});
        if (response.status === 403 && (await response.json().catch(()=>({}))).pinRequired) { lockForPin(); return; }
        if (response.status === 401) { $('#sign-in-again').hidden = false; throw new Error('Your session expired. Tap Sign in again.'); }
        if (!response.ok) throw new Error('Could not connect. Tap Retry.');
        const remote = await response.json();
        if (!ready && !remote.data) { ready = true; pending = true; }
        else if (!pending && remote.data && (!ready || remote.revision !== revision)) {
          revision = remote.revision; baseState = structuredClone(remote.data); Object.assign(state, remote.data); ready = true;
          renderTabs(); renderBoard(); if ($('#settings-dialog').open) renderSettings();
        }
        status('Synced across devices');
      }
    } catch (error) {
      failed = true; status(error.message); $('#retry-sync').hidden = false;
    } finally {
      saving = false;
      document.querySelectorAll('#turn-body select, #add-technician, #add-service, .remove-button, #reset-board, #reset-day').forEach(el => el.disabled = !ready || failed || (el.matches('[data-key]') && !el.dataset.key));
      if (pending && !failed) sync();
    }
  }
  let expandedTurns = false;
  let pinLocked = false;
  let dirty = false; // true only after a real user edit that isn't saved yet
  let toastTimer;

  const $ = selector => document.querySelector(selector);
  const save = () => { pending = true; dirty = true; status('Saving…'); sync(); };
  const escapeHtml = value => String(value).replace(/[&<>"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[char]));
  const entryKey = (day, staffId, turn) => `${day}|${staffId}|${turn}`;
  // A turn column is "done" when every assigned technician has a service for it.
  const hasService = v => typeof v === "string" && v.split(SPLIT).some(Boolean);
  const turnComplete = (day, turn) => {
    const assigned = (state.orderByDay[day] || []).filter(id => id);
    return assigned.length > 0 && assigned.every(id => hasService(state.entries[entryKey(day, id, turn)] || ""));
  };
  const visibleTurns = () => expandedTurns ? Array.from({length:TURN_COUNT}, (_, i) => i + 1) : matchMedia('(max-width: 600px)').matches ? [state.centerTurn === 14 ? 14 : state.centerTurn-1, state.centerTurn === 14 ? 15 : state.centerTurn] : [state.centerTurn - 1, state.centerTurn, state.centerTurn + 1];

  function showToast(message) {
    const toast = $("#toast");
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("show"), 1500);
  }

  function cacheLocName() { try { if (state.name) localStorage.setItem("ava-turn-board-name:loc" + activeLoc, state.name); } catch (_) {} }
  function locLabel(n) { try { return localStorage.getItem("ava-turn-board-name:loc" + n) || ("Location " + n); } catch (_) { return "Location " + n; } }
  function renderLocation() {
    const row = $("#location-row"); if (!row) return;
    cacheLocName();
    $("#loc-1").hidden = $("#loc-2").hidden = LOCKED;
    const lockedEl = $("#loc-locked"); lockedEl.hidden = !LOCKED;
    if (LOCKED) { lockedEl.textContent = state.name || ("Location " + activeLoc); return; }
    [1, 2].forEach(n => {
      const btn = $("#loc-" + n);
      btn.textContent = n === activeLoc ? (state.name || locLabel(n)) : locLabel(n);
      btn.classList.toggle("active", n === activeLoc);
      btn.setAttribute("aria-pressed", String(n === activeLoc));
    });
  }
  function switchLocation(n) {
    if (n === activeLoc || LOCKED) return;
    if (dirty && !confirm("Switch location? Unsaved changes on this device will be discarded.")) return;
    activeLoc = n;
    try { localStorage.setItem("ava-turn-board-loc", String(n)); } catch (_) {}
    revision = 0; baseState = null; ready = false; pending = false; saving = false; failed = false; dirty = false;
    $("#retry-sync").hidden = true; $("#sign-in-again").hidden = true;
    unlockUI();
    state = loadState();
    renderTabs(); renderBoard(); if ($("#settings-dialog").open) renderSettings();
    status("Connecting…"); sync();
  }

  function lockForPin() {
    pinLocked = true;
    ready = false;
    status("Locked");
    const label = $("#pin-loc-name"); if (label) label.textContent = state.name || locLabel(activeLoc);
    const err = $("#pin-error"); if (err) err.textContent = "";
    const input = $("#pin-input"); if (input) input.value = "";
    document.querySelector(".app-shell").classList.add("pin-locked");
    if ($("#settings-dialog").open) $("#settings-dialog").close();
    if (input) input.focus();
  }
  function unlockUI() {
    pinLocked = false;
    document.querySelector(".app-shell").classList.remove("pin-locked");
  }

  function updateDayArrows() {
    const tabs = $("#day-tabs"), left = $("#day-scroll-left"), right = $("#day-scroll-right");
    if (!tabs || !left || !right) return;
    const overflow = tabs.scrollWidth - tabs.clientWidth;
    const canScroll = overflow > 2;
    left.hidden = right.hidden = !canScroll;
    left.disabled = tabs.scrollLeft <= 1;
    right.disabled = tabs.scrollLeft >= overflow - 1;
  }

  function renderTabs() {
    $("#day-tabs").innerHTML = DAYS.map(day => `
      <button class="day-tab" type="button" role="tab" data-day="${day}" aria-selected="${day === state.activeDay}">${day}</button>
    `).join("");
    updateDayArrows();
    renderLocation();
  }

  const TECH_COL = 118; // keep in sync with .turn-table thead th:first-child width in styles.css
  function renderBoard() {
    const turns = visibleTurns();
    $('.app-shell').classList.toggle('expanded-turns', expandedTurns);
    $('#toggle-turn-view').textContent = expandedTurns ? 'Collapse' : 'Expand';
    $('#toggle-turn-view').setAttribute('aria-pressed', String(expandedTurns));
    $('.turn-controls').hidden = expandedTurns;
    // Collapse keeps 2–3 turns but stretches those cells to fill the width (no
    // blank on the right); the tech column stays fixed. Expand keeps 56px squares.
    const table = $('.turn-table');
    if (expandedTurns) table.style.removeProperty('--tw');
    else {
      const wrapW = ($('.table-wrap')?.clientWidth) || window.innerWidth;
      table.style.setProperty('--tw', Math.max(56, Math.floor((wrapW - TECH_COL) / turns.length)) + 'px');
    }
    const staff = state.staffByDay[state.activeDay] || [];
    $("#active-day-title").textContent = state.activeDay;
    $("#reset-day").disabled = !ready || failed;
    $("#range-badge").textContent = `Turns ${turns[0]}–${turns[turns.length - 1]} of ${TURN_COUNT}`;
    $("#turn-slider").value = String(state.centerTurn);
    $("#previous-turn").disabled = state.centerTurn <= 2;
    $("#next-turn").disabled = state.centerTurn >= TURN_COUNT - 1;
    $("#turn-head").innerHTML = `<tr><th scope="col">Tech · Arrival</th>${turns.map(turn => `<th scope="col">Turn ${turn}</th>`).join("")}</tr>`;

    const staffIds = staff.map(p => p.id);
    // Progressive rows: keep only technicians already placed (compacted), then show
    // ONE extra empty "Choose tech" row to add the next one — keeps 20-30 techs tidy.
    const order = (state.orderByDay[state.activeDay] || []).filter(id => staffIds.includes(id));
    state.orderByDay[state.activeDay] = order;
    if (!staff.length) {
      $("#turn-body").innerHTML = `<tr><td class="empty-board" colspan="${turns.length + 1}">No technicians for ${escapeHtml(state.activeDay)} — open Settings to add today’s technicians.</td></tr>`;
      return;
    }
    const rows = order.length + (order.length < staff.length ? 1 : 0);
    $("#turn-body").innerHTML = Array.from({length:rows}, (_, index) => {
      const person = staff.find(p => p.id === order[index]);
      return `<tr><th scope="row"><div class="tech-cell"><span class="arrival-number">${index+1}</span><select class="service-select tech-select ${person ? 'has-service' : ''}" data-arrival="${index}" ${ready && !failed ? "" : "disabled"} aria-label="Technician arrival ${index+1}"><option value="">Choose tech</option>${staff.filter(p => p.id === person?.id || !order.includes(p.id)).map(p => `<option value="${escapeHtml(p.id)}" ${person?.id === p.id ? 'selected' : ''}>${escapeHtml(p.name)}</option>`).join('')}</select></div></th>${turns.map(turn => {
        const key = person ? entryKey(state.activeDay, person.id, turn) : '';
        if (!person) return `<td></td>`;
        const raw = state.entries[key] || '';
        const dis = ready && !failed ? '' : 'disabled';
        const label = escapeHtml(person.name || '');
        // Two services show on one line as "A/B" (a slash), not stacked halves.
        const disp = raw.includes(SPLIT) ? raw.split(SPLIT).filter(Boolean).join('/') : raw;
        const inner = disp ? `<span class="txt">${escapeHtml(disp)}</span>` : '<span class="txt add">＋</span>';
        return `<td><div class="cell-wrap"><button type="button" class="pick ${hasService(raw) ? 'has-service' : ''}" data-key="${escapeHtml(key)}" ${dis} aria-label="${label}, turn ${turn} — choose service">${inner}</button></div></td>`;
      }).join('')}</tr>`;
    }).join('');
  }

  function renderSettings() {
    const settingsDay = $("#settings-day");
    if (!settingsDay.options.length) settingsDay.innerHTML = DAYS.map(day => `<option value="${day}">${day}</option>`).join("");
    settingsDay.value = settingsDay.value || state.activeDay;
    const locInput = $("#location-name"); if (locInput) locInput.value = state.name || "";
    const staff = state.staffByDay[settingsDay.value] || [];
    $("#technician-list").innerHTML = staff.length ? staff.map(person => `
      <div class="list-item"><span>${escapeHtml(person.name)}</span><button class="remove-button" type="button" data-remove-tech="${escapeHtml(person.id)}" aria-label="Remove ${escapeHtml(person.name)}">Remove</button></div>
    `).join("") : `<p class="empty-list">No technicians for this day.</p>`;
    $("#service-list").innerHTML = state.services.length ? state.services.map((service, index) => `
      <div class="list-item"><span>${escapeHtml(service)}</span><button class="remove-button" type="button" data-remove-service="${index}" aria-label="Remove ${escapeHtml(service)}">Remove</button></div>
    `).join("") : `<p class="empty-list">No services yet.</p>`;
  }

  function addTechnician() {
    if (!ready || failed) return;
    const input = $("#new-technician");
    const name = input.value.trim();
    const day = $("#settings-day").value;
    if (!name) return input.focus();
    if ((state.staffByDay[day] || []).some(person => person.name.toLowerCase() === name.toLowerCase())) return showToast("That technician is already listed");
    state.staffByDay[day] ||= [];
    state.staffByDay[day].push({ id: uid(), name });
    input.value = "";
    save(); renderSettings(); renderBoard(); showToast(`${name} added to ${day}`);
  }

  function addService() {
    if (!ready || failed) return;
    const input = $("#new-service");
    const service = input.value.trim();
    if (!service) return input.focus();
    if (state.services.some(item => item.toLowerCase() === service.toLowerCase())) return showToast("That service is already listed");
    state.services.push(service);
    input.value = "";
    save(); renderSettings(); renderBoard(); showToast(`${service} added`);
  }

  $("#day-tabs").addEventListener("click", event => {
    const button = event.target.closest("[data-day]");
    if (!button) return;
    state.activeDay = button.dataset.day;
    renderTabs(); renderBoard();
  });
  $("#day-tabs").addEventListener("scroll", updateDayArrows, { passive: true });
  $("#day-scroll-left").addEventListener("click", () => $("#day-tabs").scrollBy({ left: -$("#day-tabs").clientWidth * 0.7, behavior: "smooth" }));
  $("#day-scroll-right").addEventListener("click", () => $("#day-tabs").scrollBy({ left: $("#day-tabs").clientWidth * 0.7, behavior: "smooth" }));
  $("#loc-1").addEventListener("click", () => switchLocation(1));
  $("#loc-2").addEventListener("click", () => switchLocation(2));

  $("#turn-body").addEventListener("click", event => {
    if (!ready || failed) return;
    const cell = event.target.closest(".pick");
    if (cell && !cell.disabled) openPicker(cell.dataset.key);
  });

  // Choosing a technician for an arrival slot (still a native dropdown).
  $("#turn-body").addEventListener("change", event => {
    const select = event.target.closest(".tech-select");
    if (!select || !ready || failed) return;
    const order = state.orderByDay[state.activeDay] ||= [];
    const index = Number(select.dataset.arrival);
    const previous = order[index] || '';
    const other = select.value ? order.indexOf(select.value) : -1;
    if (other >= 0 && other !== index) order[other] = previous;
    order[index] = select.value;
    save(); renderBoard();
  });

  // Service picker: tap a cell to open, then tap service names. The first tap
  // fills the whole cell; a second (different) service joins as "A/B" — a half
  // turn (like the Numbers sheet's "Pe/ma"). Tapping a selected service again
  // removes it, so the same service twice clears it (never "Pe/Pe"). Picking a
  // second service auto-closes; for a single service tap Done (or outside).
  const servicePicker = $("#service-picker");
  let pickKey = null;
  const curParts = () => {
    const raw = state.entries[pickKey] || '';
    return raw.includes(SPLIT) ? raw.split(SPLIT).filter(Boolean) : (raw ? [raw] : []);
  };
  function refreshPicker() {
    const parts = curParts();
    const [day, staffId, turn] = pickKey.split('|');
    const person = (state.staffByDay[day] || []).find(p => p.id === staffId);
    const preview = parts.join('/');
    $("#picker-sub").textContent = `${person ? person.name : ''} · Turn ${turn}${preview ? ' · ' + preview : ''}`;
    $("#opt-grid").innerHTML = state.services.length
      ? state.services.map(s => `<button type="button" class="opt ${parts.includes(s) ? 'cur' : ''}" data-svc="${escapeHtml(s)}">${escapeHtml(s)}${parts.includes(s) ? ' ✓' : ''}</button>`).join('')
      : `<p class="picker-empty">No services yet — add them in Settings.</p>`;
    $("#picker-clear").hidden = parts.length === 0;
  }
  function openPicker(key) {
    if (!key || !ready || failed) return;
    pickKey = key;
    refreshPicker();
    servicePicker.hidden = false;
  }
  const closePicker = () => { servicePicker.hidden = true; };
  function toggleSvc(s) {
    if (!pickKey || !s) return;
    let parts = curParts();
    if (parts.includes(s)) parts = parts.filter(x => x !== s); // tapped again → remove
    else if (parts.length < 2) parts.push(s);                  // add (2nd = half turn)
    else parts = [parts[0], s];                                // already a pair → replace 2nd half
    if (parts.length) state.entries[pickKey] = parts.join(SPLIT); else delete state.entries[pickKey];
    save(); renderBoard();
    if (parts.length === 2) finishPicker(); else refreshPicker();
  }
  function finishPicker() {
    const key = pickKey;
    closePicker();
    if (!key || !hasService(state.entries[key] || '')) return;
    const turn = Number(key.split('|')[2]);
    if (turnComplete(state.activeDay, turn) && turn < TURN_COUNT) {
      if (expandedTurns) {
        // Expand shows all 15 turns and scrolls sideways — scroll the next turn into view.
        const nextTh = $('#turn-head').querySelectorAll('th')[turn + 1];
        if (nextTh) nextTh.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
        showToast(`Turn ${turn} full → turn ${turn + 1}`);
      } else if (turn >= state.centerTurn && state.centerTurn < TURN_COUNT - 1) {
        state.centerTurn = Math.min(TURN_COUNT - 1, turn + 1);
        renderBoard();
        showToast(`Turn ${turn} full → moving to turn ${turn + 1}`);
      }
    }
  }
  $("#opt-grid").addEventListener("click", event => {
    const o = event.target.closest(".opt");
    if (o) toggleSvc(o.dataset.svc);
  });
  $("#picker-clear").addEventListener("click", () => { if (pickKey) { delete state.entries[pickKey]; save(); renderBoard(); } finishPicker(); });
  $("#picker-done").addEventListener("click", finishPicker);
  $("#picker-x").addEventListener("click", finishPicker);
  servicePicker.addEventListener("click", event => { if (event.target === servicePicker) finishPicker(); });
  document.addEventListener("keydown", event => { if (event.key === "Escape" && !servicePicker.hidden) finishPicker(); });

  $('#toggle-turn-view').addEventListener('click', () => {
    expandedTurns = !expandedTurns;
    $('.table-wrap').scrollLeft = 0;
    renderBoard();
  });
  // Recompute the collapse cell width when the window is resized/rotated.
  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { if (ready) renderBoard(); }, 150);
  });

  // Full-screen focus: only hide the top chrome; keep the current view unchanged.
  let focusMode = false;
  function setFocus(on) {
    focusMode = on;
    $('.app-shell').classList.toggle('focus-mode', on);
    window.scrollTo(0, 0);
  }
  $('#active-day-title').addEventListener('click', () => setFocus(!focusMode));
  $('#focus-exit').addEventListener('click', () => setFocus(false));

  // Belt-and-suspenders against accidental double-tap zoom: cancel only a
  // second tap at (almost) the same spot within 300ms (that IS the zoom
  // gesture). Two quick taps on different controls, and pinch zoom, still work.
  let lastTapEnd = 0, lastTapX = 0, lastTapY = 0;
  document.addEventListener('touchend', event => {
    const t = event.changedTouches && event.changedTouches[0];
    const now = Date.now();
    if (t && now - lastTapEnd <= 300 && Math.abs(t.clientX - lastTapX) < 24 && Math.abs(t.clientY - lastTapY) < 24) event.preventDefault();
    lastTapEnd = now;
    if (t) { lastTapX = t.clientX; lastTapY = t.clientY; }
  }, { passive: false });

  $("#turn-slider").addEventListener("input", event => { state.centerTurn = Number(event.target.value); renderBoard(); });
  $("#previous-turn").addEventListener("click", () => { state.centerTurn = Math.max(2, state.centerTurn - 1); renderBoard(); });
  $("#next-turn").addEventListener("click", () => { state.centerTurn = Math.min(TURN_COUNT - 1, state.centerTurn + 1); renderBoard(); });

  $("#open-settings").addEventListener("click", () => {
    renderSettings();
    $("#settings-day").value = state.activeDay;
    renderSettings();
    refreshPinSettings();
    $("#settings-dialog").showModal();
  });
  $("#settings-day").addEventListener("change", renderSettings);
  $("#add-technician").addEventListener("click", addTechnician);
  $("#new-technician").addEventListener("keydown", event => { if (event.key === "Enter") { event.preventDefault(); addTechnician(); } });
  $("#add-service").addEventListener("click", addService);
  $("#new-service").addEventListener("keydown", event => { if (event.key === "Enter") { event.preventDefault(); addService(); } });
  $("#location-name").addEventListener("change", event => { if (!ready || failed) return; state.name = event.target.value.trim(); save(); renderLocation(); });

  async function refreshPinSettings() {
    const stateEl = $("#pin-state"); if (!stateEl) return;
    $("#pin-settings-msg").textContent = "";
    $("#pin-new").value = ""; $("#pin-current").value = "";
    try {
      const r = await fetch('/api/pin/status?loc=' + activeLoc, {cache:'no-store'});
      const j = await r.json();
      stateEl.textContent = j.pinSet ? "ON" : "OFF";
      $("#pin-current").hidden = !j.pinSet;
      $("#pin-off").hidden = !j.pinSet;
      $("#pin-lock").hidden = !(j.pinSet && j.unlocked);
    } catch (_) { stateEl.textContent = ""; }
  }
  $("#pin-save").addEventListener("click", async () => {
    const msg = $("#pin-settings-msg"); msg.textContent = "";
    const pin = $("#pin-new").value.trim(), current = $("#pin-current").value.trim();
    if (!/^\d{4,10}$/.test(pin)) { msg.textContent = "PIN must be 4-10 digits."; return; }
    try {
      const r = await fetch('/api/pin/set?loc=' + activeLoc, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({pin, current})});
      const j = await r.json().catch(()=>({}));
      if (!r.ok) throw new Error(j.error || "Could not save PIN.");
      msg.textContent = "PIN saved for " + (state.name || ("Location " + activeLoc)) + ".";
      refreshPinSettings();
    } catch (err) { msg.textContent = err.message; }
  });
  $("#pin-off").addEventListener("click", async () => {
    const msg = $("#pin-settings-msg"); msg.textContent = "";
    if (!confirm("Turn off the PIN for this location? Anyone signed in can then view it.")) return;
    const current = $("#pin-current").value.trim();
    try {
      const r = await fetch('/api/pin/remove?loc=' + activeLoc, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({current})});
      const j = await r.json().catch(()=>({}));
      if (!r.ok) throw new Error(j.error || "Could not turn off PIN.");
      msg.textContent = "PIN turned off.";
      refreshPinSettings();
    } catch (err) { msg.textContent = err.message; }
  });
  $("#pin-lock").addEventListener("click", async () => {
    if (!confirm("Lock this location on this device? You'll need the PIN to view it again.")) return;
    try {
      const r = await fetch('/api/pin/lock?loc=' + activeLoc, {method:'POST', headers:{'Content-Type':'application/json'}, body:'{}'});
      if (!r.ok) throw new Error("Could not lock.");
      $("#settings-dialog").close();
      lockForPin();
    } catch (err) { $("#pin-settings-msg").textContent = err.message; }
  });
  $("#pin-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const err = $("#pin-error"); err.textContent = "";
    const pin = $("#pin-input").value.trim();
    try {
      const r = await fetch('/api/pin/unlock?loc=' + activeLoc, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({pin})});
      const j = await r.json().catch(()=>({}));
      if (!r.ok) throw new Error(j.error || "Wrong PIN.");
      unlockUI(); ready = false; failed = false; status("Connecting…"); sync();
    } catch (e) { err.textContent = e.message; }
  });

  $("#technician-list").addEventListener("click", event => {
    const button = event.target.closest("[data-remove-tech]");
    if (!button || !ready || failed) return;
    const day = $("#settings-day").value;
    const person = state.staffByDay[day].find(item => item.id === button.dataset.removeTech);
    if (!person || !confirm(`Remove ${person.name} from ${day}?`)) return;
    state.staffByDay[day] = state.staffByDay[day].filter(item => item.id !== person.id);
    // Remove their arrival slot (row count shrinks) and clear their turns for the day.
    state.orderByDay[day] = (state.orderByDay[day] || []).filter(id => id !== person.id);
    Object.keys(state.entries).filter(key => key.startsWith(`${day}|${person.id}|`)).forEach(key => delete state.entries[key]);
    save(); renderSettings(); renderBoard();
  });

  $("#service-list").addEventListener("click", event => {
    const button = event.target.closest("[data-remove-service]");
    if (!button || !ready || failed) return;
    const service = state.services[Number(button.dataset.removeService)];
    if (!service || !confirm(`Remove ${service} from the service list?`)) return;
    state.services = state.services.filter(item => item !== service);

    save(); renderSettings(); renderBoard();
  });

  $("#reset-day").addEventListener("click", () => {
    if (!ready || failed) return;
    const day = state.activeDay;
    if (!confirm(`Reset ${day}? This clears the tech order and all 15 turns for this day on every device. Technicians, services in Settings, and other days stay the same.`)) return;
    state.orderByDay[day] = [];
    Object.keys(state.entries).filter(key => key.startsWith(`${day}|`)).forEach(key => delete state.entries[key]);
    state.centerTurn = 2;
    save(); renderBoard();
  });

  $("#reset-board").addEventListener("click", () => {
    if (!ready || failed) return;
    if (!confirm("Clear this location? This removes all technicians, services, and turns for the current location on every device. The other location is not affected.")) return;
    state = freshState();
    save(); renderTabs(); renderBoard(); renderSettings(); showToast("Location cleared");
  });


  renderTabs();
  renderBoard();
  // Keep all edit paths gated until shared state is loaded.
  $('#retry-sync').addEventListener('click', () => {
    if (!confirm('Load the latest shared board? Unsaved changes on this page will be discarded.')) return;
    failed = false; pending = false; ready = false; $('#retry-sync').hidden = true; sync();
  });
  $('#logout-button').addEventListener('click', async () => {
    if ((pending || saving || failed) && !confirm('There are unsaved or unverified changes. Signing out will discard unsaved changes. Continue?')) return;
    try {
      const response = await fetch('/api/auth/logout',{method:'POST'});
      if (!response.ok) throw new Error('Could not sign out. Try again.');
      pending = false; saving = false; failed = false; location.replace('/login');
    } catch(error) { showToast(error.message); }
  });
  fetch('/api/account', {cache:'no-store'}).then(r => r.ok ? r.json() : null).then(account => {
    if (account?.email) $('#account-label').textContent = 'Account: ' + account.email;
  }).catch(() => {});
  window.addEventListener('focus', () => { if (!failed) sync(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && !failed) sync(); });
  window.addEventListener('beforeunload', event => { if (dirty) { event.preventDefault(); event.returnValue = ''; } });
  window.addEventListener('resize', () => { renderBoard(); updateDayArrows(); });
  setInterval(() => { if (ready && !pending && !saving && !failed && !document.querySelector('select:focus, input:focus')) sync(); }, 3000);
  sync();
})();
