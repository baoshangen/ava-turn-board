(() => {
  const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  const TURN_COUNT = 15;
  const STORAGE_KEY = "ava-turn-board-v1";
  const SAMPLE_SERVICES = ["Manicure", "Pedicure", "No Chip", "Dip Powder", "Acrylic Full Set", "Acrylic Fill", "Gel X", "French", "Nail Art"];

  const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const freshState = () => ({
    activeDay: "Monday",
    centerTurn: 2,
    services: [...SAMPLE_SERVICES],
    staffByDay: Object.fromEntries(DAYS.map(day => [day, ["Tyson", "TJ", "Ray"].map(name => ({ id: uid(), name }))])),
    orderByDay: Object.fromEntries(DAYS.map(day => [day, []])),
    entries: {}
  });

  const loadState = () => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (saved && saved.staffByDay && saved.services) return { ...freshState(), ...saved, orderByDay: saved.orderByDay || Object.fromEntries(DAYS.map(day => [day, (saved.staffByDay[day] || []).map(p => p.id)])) };
    } catch (_) {}
    return freshState();
  };

  let state = loadState();
  // Existing selected turns stay attached to their technician when arrival order changes.
  if (!state.orderByDay) state.orderByDay = Object.fromEntries(DAYS.map(day => [day, state.staffByDay[day].map(p => p.id)]));
  let baseState = null;
  let revision = 0, ready = false, saving = false, pending = false, failed = false;
  const shared = () => ({ services: state.services, staffByDay: state.staffByDay, orderByDay: state.orderByDay, entries: state.entries });
  const status = message => { document.querySelector('#sync-status').textContent = message; };
  async function sync() {
    if (saving || failed) return;
    saving = true;
    try {
      if (pending) {
        pending = false;
        const sent = JSON.parse(JSON.stringify(shared()));
        const response = await fetch('/api/board', { method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify({revision, data:sent}) });
        if (response.status === 409) {
          const latest = await fetch('/api/board', {cache:'no-store'});
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
        const response = await fetch('/api/board', {cache:'no-store'});
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
  const turnComplete = (day, turn) => {
    const assigned = (state.orderByDay[day] || []).filter(id => id);
    return assigned.length > 0 && assigned.every(id => state.entries[entryKey(day, id, turn)]);
  };
  const visibleTurns = () => expandedTurns ? Array.from({length:TURN_COUNT}, (_, i) => i + 1) : matchMedia('(max-width: 600px)').matches ? [state.centerTurn === 14 ? 14 : state.centerTurn-1, state.centerTurn === 14 ? 15 : state.centerTurn] : [state.centerTurn - 1, state.centerTurn, state.centerTurn + 1];

  function showToast(message) {
    const toast = $("#toast");
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("show"), 1500);
  }

  function renderTabs() {
    $("#day-tabs").innerHTML = DAYS.map(day => `
      <button class="day-tab" type="button" role="tab" data-day="${day}" aria-selected="${day === state.activeDay}">${day}</button>
    `).join("");
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
        const selected = state.entries[key] || '';
        const choices = [...new Set([...state.services, ...(selected ? [selected] : [])])];
        return `<td><select class="service-select ${selected ? 'has-service' : ''}" data-key="${escapeHtml(key)}" ${person && ready && !failed ? '' : 'disabled'} aria-label="${escapeHtml(person?.name || 'Unassigned')}, turn ${turn}"><option value=""></option>${choices.map(service => `<option value="${escapeHtml(service)}" ${selected === service ? 'selected' : ''}>${escapeHtml(service)}</option>`).join('')}</select></td>`;
      }).join('')}</tr>`;
    }).join('');
  }

  function renderSettings() {
    const settingsDay = $("#settings-day");
    if (!settingsDay.options.length) settingsDay.innerHTML = DAYS.map(day => `<option value="${day}">${day}</option>`).join("");
    settingsDay.value = settingsDay.value || state.activeDay;
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
    if (select.value) state.entries[select.dataset.key] = select.value;
    else delete state.entries[select.dataset.key];
    select.classList.toggle("has-service", Boolean(select.value));
    select.blur();
    save();
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
    if (!confirm("Reset all technicians, services, and turn selections to the sample board?")) return;
    state = freshState();
    save(); renderTabs(); renderBoard(); renderSettings(); showToast("Board reset");
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
  window.addEventListener('resize', renderBoard);
  setInterval(() => { if (ready && !pending && !saving && !failed && !document.querySelector('select:focus, input:focus')) sync(); }, 3000);
  sync();
})();
