(() => {
  const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  const TURN_COUNT = 15;
  const SPLIT = "␟"; // separator so one cell can hold two services (half turn)
  const STORAGE_PREFIX = "ava-turn-board-v1";
  const LOC_PARAM = new URLSearchParams(location.search).get("loc");
  const LOCKED = LOC_PARAM === "1" || LOC_PARAM === "2";
  let activeLoc = LOCKED ? Number(LOC_PARAM) : (Number(localStorage.getItem("ava-turn-board-loc")) === 2 ? 2 : 1);
  const storageKey = () => `${STORAGE_PREFIX}:loc${activeLoc}`;
  const SAMPLE_SERVICES = ["Manicure", "Pedicure", "No Chip", "Dip Powder", "Acrylic Full Set", "Acrylic Fill", "Gel X", "French", "Nail Art"];

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
        revision = (await response.json()).revision; baseState = sent; renderBoard();
        status('Synced across devices');
      } else {
        const response = await fetch('/api/board?loc='+activeLoc, {cache:'no-store'});
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
  let toastTimer;

  const $ = selector => document.querySelector(selector);
  const save = () => { pending = true; status('Saving…'); sync(); };
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
    if ((pending || saving || failed) && !confirm("Switch location? Unsaved changes on this device will be discarded.")) return;
    activeLoc = n;
    try { localStorage.setItem("ava-turn-board-loc", String(n)); } catch (_) {}
    revision = 0; baseState = null; ready = false; pending = false; saving = false; failed = false;
    $("#retry-sync").hidden = true; $("#sign-in-again").hidden = true;
    state = loadState();
    renderTabs(); renderBoard(); if ($("#settings-dialog").open) renderSettings();
    status("Connecting…"); sync();
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

  function renderBoard() {
    const turns = visibleTurns();
    $('.app-shell').classList.toggle('expanded-turns', expandedTurns);
    $('#toggle-turn-view').textContent = expandedTurns ? 'Collapse' : 'Expand';
    $('#toggle-turn-view').setAttribute('aria-pressed', String(expandedTurns));
    $('.turn-controls').hidden = expandedTurns;
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
        const raw = state.entries[key] || '';
        const isSplit = raw.includes(SPLIT);
        const dis = person && ready && !failed ? '' : 'disabled';
        const label = escapeHtml(person?.name || 'Unassigned');
        const opts = sel => `<option value=""></option>${[...new Set([...state.services, ...(sel ? [sel] : [])])].map(s => `<option value="${escapeHtml(s)}" ${sel === s ? 'selected' : ''}>${escapeHtml(s)}</option>`).join('')}`;
        const heart = person ? `<button type="button" class="split-toggle" data-split-key="${escapeHtml(key)}" ${dis} aria-label="Split into two services" aria-pressed="${isSplit}">♥</button>` : '';
        if (isSplit) {
          const [a = '', b = ''] = raw.split(SPLIT);
          const full = !!a && !!b;
          const cls = v => v ? (full ? 'has-service' : 'half-partial') : '';
          return `<td><div class="cell-wrap split"><select class="service-select half ${cls(a)}" data-key="${escapeHtml(key)}" data-slot="a" ${dis} aria-label="${label}, turn ${turn} top">${opts(a)}</select><select class="service-select half ${cls(b)}" data-key="${escapeHtml(key)}" data-slot="b" ${dis} aria-label="${label}, turn ${turn} bottom">${opts(b)}</select>${heart}</div></td>`;
        }
        return `<td><div class="cell-wrap"><select class="service-select ${raw ? 'has-service' : ''}" data-key="${escapeHtml(key)}" ${dis} aria-label="${label}, turn ${turn}">${opts(raw)}</select>${heart}</div></td>`;
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
    const heart = event.target.closest(".split-toggle");
    if (!heart || !ready || failed) return;
    const key = heart.dataset.splitKey;
    if (!key) return;
    const cur = state.entries[key] || '';
    if (cur.includes(SPLIT)) {
      const first = cur.split(SPLIT)[0];
      if (first) state.entries[key] = first; else delete state.entries[key];
    } else {
      state.entries[key] = cur + SPLIT;
    }
    save(); renderBoard();
  });

  $("#turn-body").addEventListener("change", event => {
    const select = event.target.closest(".service-select");
    if (!select) return;
    if (!ready || failed) return;
    if (select.matches('.tech-select')) {
      const order = state.orderByDay[state.activeDay] ||= [];
      const index = Number(select.dataset.arrival);
      const previous = order[index] || '';
      const other = select.value ? order.indexOf(select.value) : -1;
      if (other >= 0 && other !== index) order[other] = previous;
      order[index] = select.value;
      save(); renderBoard(); return;
    }
    const cellKey = select.dataset.key;
    const slot = select.dataset.slot;
    const cur = state.entries[cellKey] || '';
    const splitCell = slot || cur.includes(SPLIT);
    if (splitCell) {
      let [a = '', b = ''] = cur.includes(SPLIT) ? cur.split(SPLIT) : [cur, ''];
      if (slot === 'b') b = select.value; else a = select.value;
      state.entries[cellKey] = a + SPLIT + b; // keep the cell split even if one half is empty
    } else if (select.value) {
      state.entries[cellKey] = select.value;
    } else {
      delete state.entries[cellKey];
    }
    select.blur();
    save();
    if (splitCell) renderBoard(); // recompute red (one half filled) vs green (both filled)
    else select.classList.toggle("has-service", Boolean(select.value));
    // When the whole turn column is filled, jump to the next turn automatically.
    if (select.value && !expandedTurns) {
      const turn = Number(select.dataset.key.split("|")[2]);
      if (turnComplete(state.activeDay, turn) && turn >= state.centerTurn && state.centerTurn < TURN_COUNT - 1) {
        state.centerTurn = Math.min(TURN_COUNT - 1, turn + 1);
        renderBoard();
        showToast(`Turn ${turn} full → moving to turn ${turn + 1}`);
      }
    }
  });

  $('#toggle-turn-view').addEventListener('click', () => {
    expandedTurns = !expandedTurns;
    $('.table-wrap').scrollLeft = 0;
    renderBoard();
  });

  $("#turn-slider").addEventListener("input", event => { state.centerTurn = Number(event.target.value); renderBoard(); });
  $("#previous-turn").addEventListener("click", () => { state.centerTurn = Math.max(2, state.centerTurn - 1); renderBoard(); });
  $("#next-turn").addEventListener("click", () => { state.centerTurn = Math.min(TURN_COUNT - 1, state.centerTurn + 1); renderBoard(); });

  $("#open-settings").addEventListener("click", () => {
    renderSettings();
    $("#settings-day").value = state.activeDay;
    renderSettings();
    $("#settings-dialog").showModal();
  });
  $("#settings-day").addEventListener("change", renderSettings);
  $("#add-technician").addEventListener("click", addTechnician);
  $("#new-technician").addEventListener("keydown", event => { if (event.key === "Enter") { event.preventDefault(); addTechnician(); } });
  $("#add-service").addEventListener("click", addService);
  $("#new-service").addEventListener("keydown", event => { if (event.key === "Enter") { event.preventDefault(); addService(); } });
  $("#location-name").addEventListener("change", event => { if (!ready || failed) return; state.name = event.target.value.trim(); save(); renderLocation(); });

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
  window.addEventListener('beforeunload', event => { if (pending || saving || failed) { event.preventDefault(); event.returnValue = ''; } });
  window.addEventListener('resize', () => { renderBoard(); updateDayArrows(); });
  setInterval(() => { if (ready && !pending && !saving && !failed && !document.querySelector('select:focus, input:focus')) sync(); }, 3000);
  sync();
})();
