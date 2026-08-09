let state = null;

/* ---------- utils ---------- */

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function persist() {
  window.api.saveData(state);
}

function pad(n) {
  return String(n).padStart(2, '0');
}

function formatMinutesShort(totalSeconds) {
  const m = Math.round(totalSeconds / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem ? `${h}h ${rem}m` : `${h}h`;
}

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function endOfDay(d) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

function dayKey(d) {
  const x = new Date(d);
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
}

function timeStringNow() {
  const d = new Date();
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function clampInt(val, min, max, fallback) {
  const n = parseInt(val, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* ---------- sidebar navigation ---------- */

function setupSidebar() {
  document.querySelectorAll('.nav-item, .nav-subitem').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.nav-item, .nav-subitem').forEach((b) => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');

      if (btn.dataset.subtab) {
        document.querySelectorAll('.time-subpanel').forEach((p) => p.classList.remove('active'));
        document.getElementById(`time-sub-${btn.dataset.subtab}`).classList.add('active');
      }

      if (btn.dataset.tab === 'time') renderTimeSection();
      if (btn.dataset.tab === 'tasks') refreshTasksExtras();
      if (btn.dataset.tab === 'bids') renderBids();
    });
  });

  const sidebar = document.getElementById('sidebar');
  const pinBtn = document.getElementById('sidebar-pin');
  pinBtn.addEventListener('click', () => {
    sidebar.classList.toggle('pinned');
    pinBtn.innerHTML = sidebar.classList.contains('pinned') ? '&#171;' : '&#187;';
  });
}

/* ---------- additional tasks ---------- */

function getCategories() {
  const set = new Set();
  state.tasks.forEach((t) => {
    if (t.category) set.add(t.category);
  });
  return [...set].sort();
}

function refreshCategoryOptions() {
  const cats = getCategories();

  const datalist = document.getElementById('category-list');
  datalist.innerHTML = cats.map((c) => `<option value="${escapeHtml(c)}"></option>`).join('');

  const filterSelect = document.getElementById('filter-category');
  const prev = filterSelect.value;
  filterSelect.innerHTML =
    '<option value="">All</option>' + cats.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
  if (cats.includes(prev)) filterSelect.value = prev;
}

function setupTaskForm() {
  const form = document.getElementById('task-form');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const title = document.getElementById('task-title').value.trim();
    if (!title) return;
    const notes = document.getElementById('task-notes').value.trim();
    const dueRaw = document.getElementById('task-due').value;
    const dueDate = dueRaw ? new Date(dueRaw).toISOString() : null;
    const priority = document.getElementById('task-priority').value;
    const category = document.getElementById('task-category').value.trim();
    const editingId = document.getElementById('task-editing-id').value;

    if (editingId) {
      const task = state.tasks.find((t) => t.id === editingId);
      if (task) {
        const dueDateChanged = task.dueDate !== dueDate;
        task.title = title;
        task.notes = notes;
        task.dueDate = dueDate;
        task.priority = priority;
        task.category = category;
        if (dueDateChanged) task.reminded = false;
      }
    } else {
      state.tasks.push({
        id: uid(),
        title,
        notes,
        dueDate,
        priority,
        category,
        completed: false,
        completedAt: null,
        createdAt: new Date().toISOString(),
        reminded: false,
      });
    }

    resetTaskForm();
    persist();
    refreshCategoryOptions();
    renderTasks();
    refreshTasksExtras();
  });

  document.getElementById('task-cancel-edit').addEventListener('click', resetTaskForm);

  document.getElementById('filter-category').addEventListener('change', renderTasks);
  document.getElementById('filter-show-completed').addEventListener('change', renderTasks);
}

function resetTaskForm() {
  document.getElementById('task-form').reset();
  document.getElementById('task-editing-id').value = '';
  document.getElementById('task-priority').value = 'medium';
  document.getElementById('task-submit-btn').textContent = 'Add Task';
  document.getElementById('task-cancel-edit').classList.add('hidden');
}

function beginEditTask(id) {
  const task = state.tasks.find((t) => t.id === id);
  if (!task) return;
  document.getElementById('task-editing-id').value = task.id;
  document.getElementById('task-title').value = task.title;
  document.getElementById('task-notes').value = task.notes || '';
  document.getElementById('task-due').value = task.dueDate ? toLocalInputValue(task.dueDate) : '';
  document.getElementById('task-priority').value = task.priority;
  document.getElementById('task-category').value = task.category || '';
  document.getElementById('task-submit-btn').textContent = 'Save Changes';
  document.getElementById('task-cancel-edit').classList.remove('hidden');
  document.getElementById('task-title').focus();
}

function toLocalInputValue(isoString) {
  const d = new Date(isoString);
  const off = d.getTimezoneOffset();
  const local = new Date(d.getTime() - off * 60000);
  return local.toISOString().slice(0, 16);
}

function deleteTask(id) {
  state.tasks = state.tasks.filter((t) => t.id !== id);
  persist();
  refreshCategoryOptions();
  renderTasks();
  refreshTasksExtras();
}

function toggleTaskComplete(id) {
  const task = state.tasks.find((t) => t.id === id);
  if (!task) return;
  task.completed = !task.completed;
  task.completedAt = task.completed ? new Date().toISOString() : null;
  persist();
  renderTasks();
  refreshTasksExtras();
}

function sortedFilteredTasks() {
  const categoryFilter = document.getElementById('filter-category').value;
  const showCompleted = document.getElementById('filter-show-completed').checked;

  let tasks = state.tasks.slice();
  if (categoryFilter) tasks = tasks.filter((t) => t.category === categoryFilter);
  if (!showCompleted) tasks = tasks.filter((t) => !t.completed);

  tasks.sort((a, b) => {
    if (a.completed !== b.completed) return a.completed ? 1 : -1;
    if (a.dueDate && b.dueDate) return new Date(a.dueDate) - new Date(b.dueDate);
    if (a.dueDate) return -1;
    if (b.dueDate) return 1;
    return new Date(a.createdAt) - new Date(b.createdAt);
  });

  return tasks;
}

function renderTasks() {
  refreshCategoryOptions();
  const list = document.getElementById('task-list');
  const empty = document.getElementById('task-empty');
  const tasks = sortedFilteredTasks();

  document.getElementById('task-count').textContent = `${tasks.length} shown / ${state.tasks.length} total`;

  if (tasks.length === 0) {
    list.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  const now = Date.now();

  list.innerHTML = tasks
    .map((t) => {
      const isOverdue = !t.completed && t.dueDate && new Date(t.dueDate).getTime() < now;
      const isDueSoon =
        !t.completed && !isOverdue && t.dueDate && new Date(t.dueDate).getTime() - now < 24 * 3600 * 1000;

      const classes = ['task-item'];
      if (t.completed) classes.push('completed');
      if (isOverdue) classes.push('overdue');

      const dueBadge = t.dueDate
        ? `<span class="badge ${isOverdue ? 'due-overdue' : isDueSoon ? 'due-soon' : ''}">${
            isOverdue ? 'Overdue: ' : 'Due: '
          }${new Date(t.dueDate).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>`
        : '';

      const categoryBadge = t.category ? `<span class="badge">${escapeHtml(t.category)}</span>` : '';

      return `
        <li class="${classes.join(' ')}" data-id="${t.id}">
          <input type="checkbox" class="task-toggle" ${t.completed ? 'checked' : ''} />
          <div class="task-main">
            <div class="task-title">${escapeHtml(t.title)}</div>
            ${t.notes ? `<div class="task-notes">${escapeHtml(t.notes)}</div>` : ''}
            <div class="task-meta">
              <span class="badge priority-${t.priority}">${t.priority}</span>
              ${categoryBadge}
              ${dueBadge}
            </div>
          </div>
          <div class="task-actions">
            <button class="small secondary edit-btn">Edit</button>
            <button class="small danger delete-btn">Delete</button>
          </div>
        </li>`;
    })
    .join('');
}

function setupTaskListEvents() {
  const list = document.getElementById('task-list');
  list.addEventListener('click', (e) => {
    const li = e.target.closest('.task-item');
    if (!li) return;
    const id = li.dataset.id;

    if (e.target.classList.contains('task-toggle')) {
      toggleTaskComplete(id);
    } else if (e.target.classList.contains('edit-btn')) {
      beginEditTask(id);
    } else if (e.target.classList.contains('delete-btn')) {
      if (confirm('Delete this task? This cannot be undone.')) deleteTask(id);
    }
  });
}

/* ---------- activity tracking (automatic: active / idle / locked, manual start/stop) ---------- */

const ACTIVITY_TICK_MS = 60000;
let activityInterval = null;

function startTrackingLoop() {
  if (activityInterval) return;
  activityInterval = setInterval(activityTick, ACTIVITY_TICK_MS);
  activityTick();
}

function stopTrackingLoop() {
  if (activityInterval) {
    clearInterval(activityInterval);
    activityInterval = null;
  }
  setStatusPill('stopped');
}

function setupTrackingToggle() {
  document.getElementById('tracking-toggle-btn').addEventListener('click', () => {
    state.trackingEnabled = !state.trackingEnabled;
    persist();
    updateTrackingToggleButton();
    if (state.trackingEnabled) startTrackingLoop();
    else stopTrackingLoop();
  });
}

function updateTrackingToggleButton() {
  const btn = document.getElementById('tracking-toggle-btn');
  btn.textContent = state.trackingEnabled ? 'Stop Tracking' : 'Start Tracking';
  btn.classList.toggle('secondary', state.trackingEnabled);
}

function setStatusPill(kind) {
  const pill = document.getElementById('status-pill');
  const text = document.getElementById('status-text');
  const hint = document.getElementById('status-hint');
  pill.classList.remove('active', 'idle', 'locked');
  if (kind === 'active') {
    pill.classList.add('active');
    text.textContent = 'Active';
    hint.textContent = '';
  } else if (kind === 'idle') {
    pill.classList.add('idle');
    text.textContent = 'Idle';
    hint.textContent = 'No keyboard/mouse input in the last check.';
  } else if (kind === 'locked') {
    pill.classList.add('locked');
    text.textContent = 'Locked';
    hint.textContent = 'PC is locked.';
  } else if (kind === 'stopped') {
    text.textContent = 'Stopped';
    hint.textContent = 'Tracking is stopped. Press Start to resume.';
  } else {
    text.textContent = '—';
    hint.textContent = 'Checking activity...';
  }
}

function recordActivitySample(sampleState) {
  const now = new Date();
  const last = state.activityLog[state.activityLog.length - 1];
  if (last && last.state === sampleState && now.getTime() - new Date(last.end).getTime() < ACTIVITY_TICK_MS * 3) {
    last.end = now.toISOString();
  } else {
    state.activityLog.push({
      start: new Date(now.getTime() - ACTIVITY_TICK_MS).toISOString(),
      end: now.toISOString(),
      state: sampleState,
    });
  }
  pruneActivityLog();
}

function pruneActivityLog() {
  const cutoff = Date.now() - 400 * 24 * 3600 * 1000;
  state.activityLog = state.activityLog.filter((e) => new Date(e.end).getTime() >= cutoff);
}

function recordAppSample(appName) {
  const now = new Date();
  const last = state.appLog[state.appLog.length - 1];
  if (last && last.appName === appName && now.getTime() - new Date(last.end).getTime() < ACTIVITY_TICK_MS * 3) {
    last.end = now.toISOString();
  } else {
    state.appLog.push({
      start: new Date(now.getTime() - ACTIVITY_TICK_MS).toISOString(),
      end: now.toISOString(),
      appName,
    });
  }
  pruneAppLog();
}

function pruneAppLog() {
  const cutoff = Date.now() - 400 * 24 * 3600 * 1000;
  state.appLog = state.appLog.filter((e) => new Date(e.end).getTime() >= cutoff);
}

async function activityTick() {
  const thresholdSeconds = Math.max(1, Math.round(ACTIVITY_TICK_MS / 1000));
  const result = await window.api.getIdleState(thresholdSeconds);

  let sampleState;
  if (result.state === 'locked') sampleState = 'locked';
  else if (result.idleSeconds >= thresholdSeconds) sampleState = 'idle';
  else sampleState = 'active';

  setStatusPill(sampleState);
  recordActivitySample(sampleState);

  if (sampleState !== 'locked') {
    const win = await window.api.getActiveWindow();
    if (win && win.appName) recordAppSample(win.appName);
  }

  persist();

  const activePanel = document.querySelector('.tab-panel.active');
  if (activePanel && activePanel.id === 'tab-time') {
    renderDashboardDay();
    renderWorkRecordChart();
  }
}

/* ---------- dashboard day view (Computer Usage + Applications, ManicTime-style) ---------- */

const TIMELINE_SLOTS = 48; // 30-minute slots across 24h

const STATUS_COLORS = { active: '#57c785', idle: '#ffb84d', locked: '#a389f4' };
function statusColor(s) {
  return STATUS_COLORS[s] || '#3a3f4b';
}

const APP_COLOR_PALETTE = ['#f0ad4e', '#5bc0de', '#9b59b6', '#e67e22', '#1abc9c', '#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#c0392b'];
const appColorCache = {};
function colorForApp(appName) {
  if (!appName) return '#3a3f4b';
  if (appColorCache[appName]) return appColorCache[appName];
  let hash = 0;
  for (let i = 0; i < appName.length; i++) hash = (hash * 31 + appName.charCodeAt(i)) >>> 0;
  const color = APP_COLOR_PALETTE[hash % APP_COLOR_PALETTE.length];
  appColorCache[appName] = color;
  return color;
}

function capitalize(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

function fmtTime(ms) {
  return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatHMS(totalSeconds) {
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${pad(h)}:${pad(m)}:${pad(sec)}`;
}

let dashboardDateKey = dayKey(new Date());

function setupDateNav() {
  const dateInput = document.getElementById('dashboard-date');
  dateInput.value = dashboardDateKey;

  dateInput.addEventListener('change', () => {
    dashboardDateKey = dateInput.value || dayKey(new Date());
    renderDashboardDay();
  });

  const shiftDay = (delta) => {
    const d = new Date(`${dashboardDateKey}T00:00:00`);
    d.setDate(d.getDate() + delta);
    dashboardDateKey = dayKey(d);
    dateInput.value = dashboardDateKey;
    renderDashboardDay();
  };

  document.getElementById('date-prev-btn').addEventListener('click', () => shiftDay(-1));
  document.getElementById('date-next-btn').addEventListener('click', () => shiftDay(1));
  document.getElementById('date-today-btn').addEventListener('click', () => {
    dashboardDateKey = dayKey(new Date());
    dateInput.value = dashboardDateKey;
    renderDashboardDay();
  });
}

function renderTimelineRuler() {
  const labels = [];
  for (let h = 0; h <= 24; h += 3) {
    labels.push(`<span>${pad(h % 24)}:00</span>`);
  }
  document.getElementById('timeline-ruler').innerHTML = labels.join('');
}

function computeSlotStatus(slotStart, slotEnd) {
  let hasActive = false;
  let hasIdle = false;
  let hasLocked = false;
  for (const entry of state.activityLog) {
    const es = new Date(entry.start).getTime();
    const ee = new Date(entry.end).getTime();
    if (es < slotEnd && ee > slotStart) {
      if (entry.state === 'active') hasActive = true;
      else if (entry.state === 'idle') hasIdle = true;
      else if (entry.state === 'locked') hasLocked = true;
    }
  }
  if (hasActive) return 'active';
  if (hasLocked) return 'locked';
  if (hasIdle) return 'idle';
  return null;
}

function computeSlotApp(slotStart, slotEnd) {
  const durByApp = {};
  for (const entry of state.appLog) {
    const es = new Date(entry.start).getTime();
    const ee = new Date(entry.end).getTime();
    const overlapStart = Math.max(es, slotStart);
    const overlapEnd = Math.min(ee, slotEnd);
    if (overlapEnd > overlapStart) {
      durByApp[entry.appName] = (durByApp[entry.appName] || 0) + (overlapEnd - overlapStart);
    }
  }
  const entries = Object.entries(durByApp);
  if (!entries.length) return null;
  entries.sort((a, b) => b[1] - a[1]);
  return entries[0][0];
}

function slotTooltip(slotStart, slotEnd, status, appName) {
  const timeLabel = `${fmtTime(slotStart)}–${fmtTime(slotEnd)}`;
  const statusLabel = status ? capitalize(status) : 'Untracked';
  const appLabel = appName || 'No app data';
  return `${timeLabel} · ${statusLabel} · ${appLabel}`;
}

function renderTimeline() {
  const dayStart = new Date(`${dashboardDateKey}T00:00:00`).getTime();
  const slotMs = (24 * 3600 * 1000) / TIMELINE_SLOTS;
  const now = Date.now();

  const html = [];
  for (let i = 0; i < TIMELINE_SLOTS; i++) {
    const slotStart = dayStart + i * slotMs;
    const slotEnd = slotStart + slotMs;
    let status = null;
    let appName = null;
    if (slotStart < now) {
      status = computeSlotStatus(slotStart, slotEnd);
      appName = computeSlotApp(slotStart, slotEnd);
    }
    const cls = status || '';
    const tooltip = escapeHtml(slotTooltip(slotStart, slotEnd, status, appName));
    html.push(`<div class="timeline-slot ${cls}" title="${tooltip}"></div>`);
  }
  document.getElementById('timeline').innerHTML = html.join('');
}

function renderAppTimeline() {
  const dayStart = new Date(`${dashboardDateKey}T00:00:00`).getTime();
  const slotMs = (24 * 3600 * 1000) / TIMELINE_SLOTS;
  const now = Date.now();

  const html = [];
  for (let i = 0; i < TIMELINE_SLOTS; i++) {
    const slotStart = dayStart + i * slotMs;
    const slotEnd = slotStart + slotMs;
    let status = null;
    let appName = null;
    let style = '';
    if (slotStart < now) {
      status = computeSlotStatus(slotStart, slotEnd);
      appName = computeSlotApp(slotStart, slotEnd);
      if (appName) style = `background:${colorForApp(appName)}`;
    }
    const tooltip = escapeHtml(slotTooltip(slotStart, slotEnd, status, appName));
    html.push(`<div class="timeline-slot" style="${style}" title="${tooltip}"></div>`);
  }
  document.getElementById('app-timeline').innerHTML = html.join('');
}

function renderNowMarker() {
  const marker = document.getElementById('timeline-now-marker');
  if (dashboardDateKey !== dayKey(new Date())) {
    marker.classList.add('hidden');
    return;
  }
  marker.classList.remove('hidden');
  const dayStart = startOfDay(new Date()).getTime();
  const pct = ((Date.now() - dayStart) / (24 * 3600 * 1000)) * 100;
  marker.style.left = `${pct}%`;
}

function segmentsForDate(log, dateKey) {
  const dayStart = new Date(`${dateKey}T00:00:00`).getTime();
  const dayEnd = dayStart + 24 * 3600 * 1000;
  return log
    .map((e) => ({ ...e, es: new Date(e.start).getTime(), ee: new Date(e.end).getTime() }))
    .filter((e) => e.ee > dayStart && e.es < dayEnd)
    .map((e) => ({ ...e, es: Math.max(e.es, dayStart), ee: Math.min(e.ee, dayEnd) }))
    .sort((a, b) => a.es - b.es);
}

let segmentView = 'status';

function setupTimelineRowSelection() {
  document.querySelectorAll('.timeline-row').forEach((row) => {
    row.addEventListener('click', () => {
      segmentView = row.dataset.view;
      updateTimelineRowSelection();
      renderSegmentTable();
      renderBreakdownPanel();
    });
  });
}

function updateTimelineRowSelection() {
  document.querySelectorAll('.timeline-row').forEach((row) => {
    row.classList.toggle('selected', row.dataset.view === segmentView);
  });
  document.getElementById('segment-table-heading').textContent = segmentView === 'status' ? 'Computer Usage' : 'Applications';
}

function renderSegmentTable() {
  const log = segmentView === 'status' ? state.activityLog : state.appLog;
  const segs = segmentsForDate(log, dashboardDateKey);
  const tbody = document.getElementById('segment-table-body');
  const empty = document.getElementById('segment-table-empty');

  if (segs.length === 0) {
    tbody.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  tbody.innerHTML = segs
    .map((seg) => {
      const title = segmentView === 'status' ? capitalize(seg.state) : seg.appName;
      const color = segmentView === 'status' ? statusColor(seg.state) : colorForApp(seg.appName);
      const durationSec = (seg.ee - seg.es) / 1000;
      return `
        <tr>
          <td><span class="seg-color-dot" style="background:${color}"></span></td>
          <td>${escapeHtml(title)}</td>
          <td>${new Date(seg.es).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</td>
          <td>${new Date(seg.ee).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</td>
          <td>${formatHMS(durationSec)}</td>
        </tr>`;
    })
    .join('');
}

function renderBreakdownPanel() {
  const dayStart = new Date(`${dashboardDateKey}T00:00:00`).getTime();
  const dayEnd = dayStart + 24 * 3600 * 1000;

  const totals = {};
  if (segmentView === 'status') {
    ['active', 'idle', 'locked'].forEach((s) => {
      totals[s] = 0;
    });
    state.activityLog.forEach((e) => {
      const es = Math.max(new Date(e.start).getTime(), dayStart);
      const ee = Math.min(new Date(e.end).getTime(), dayEnd);
      if (ee > es && e.state in totals) totals[e.state] += (ee - es) / 1000;
    });
  } else {
    state.appLog.forEach((e) => {
      const es = Math.max(new Date(e.start).getTime(), dayStart);
      const ee = Math.min(new Date(e.end).getTime(), dayEnd);
      if (ee > es) totals[e.appName] = (totals[e.appName] || 0) + (ee - es) / 1000;
    });
  }

  const entries = Object.entries(totals)
    .filter(([, secs]) => secs > 0)
    .sort((a, b) => b[1] - a[1]);
  const grandTotal = entries.reduce((sum, [, secs]) => sum + secs, 0);

  const list = document.getElementById('breakdown-panel-list');
  list.innerHTML =
    entries.length === 0
      ? '<li class="empty-state">No data for this day.</li>'
      : entries
          .map(([key, secs]) => {
            const pct = grandTotal > 0 ? Math.round((secs / grandTotal) * 1000) / 10 : 0;
            const color = segmentView === 'status' ? statusColor(key) : colorForApp(key);
            const label = segmentView === 'status' ? capitalize(key) : key;
            return `
              <li class="breakdown-item">
                <span class="breakdown-item-name"><i class="dot" style="background:${color}"></i>${escapeHtml(label)}</span>
                <span><span class="breakdown-item-pct">${pct}%</span><span class="breakdown-item-value">${formatHMS(
              secs
            )}</span></span>
              </li>`;
          })
          .join('');

  document.getElementById('breakdown-total').innerHTML = `<span>Total</span><span>${formatHMS(grandTotal)}</span>`;
}

function renderDashboardDay() {
  renderTimeline();
  renderAppTimeline();
  renderNowMarker();
  updateTimelineRowSelection();
  renderSegmentTable();
  renderBreakdownPanel();
}

/* ---------- work record (line chart, driven by the automatic activity log) ---------- */

function activeSecondsInRange(rangeStartMs, rangeEndMs) {
  let seconds = 0;
  state.activityLog.forEach((e) => {
    if (e.state !== 'active') return;
    const es = Math.max(new Date(e.start).getTime(), rangeStartMs);
    const ee = Math.min(new Date(e.end).getTime(), rangeEndMs);
    if (ee > es) seconds += (ee - es) / 1000;
  });
  return seconds;
}

function getWorkRecordPoints(range) {
  const now = new Date();
  const todayStart = startOfDay(now).getTime();

  if (range === 'daily') {
    const points = [];
    for (let h = 0; h < 24; h++) {
      const hourStart = todayStart + h * 3600 * 1000;
      points.push({ label: `${h}:00`, seconds: activeSecondsInRange(hourStart, hourStart + 3600 * 1000) });
    }
    return points;
  }

  let fromKey;
  let toKey = dayKey(now);

  if (range === 'weekly') {
    fromKey = dayKey(new Date(todayStart - 6 * 24 * 3600 * 1000));
  } else if (range === 'monthly') {
    fromKey = dayKey(new Date(todayStart - 29 * 24 * 3600 * 1000));
  } else {
    fromKey = document.getElementById('time-from').value || toKey;
    toKey = document.getElementById('time-to').value || toKey;
    if (fromKey > toKey) {
      const tmp = fromKey;
      fromKey = toKey;
      toKey = tmp;
    }
  }

  const points = [];
  const cursor = new Date(`${fromKey}T00:00:00`);
  const end = new Date(`${toKey}T00:00:00`);
  while (cursor <= end) {
    const dayStartMs = startOfDay(cursor).getTime();
    points.push({
      label: cursor.toLocaleDateString([], { month: 'short', day: 'numeric' }),
      seconds: activeSecondsInRange(dayStartMs, dayStartMs + 24 * 3600 * 1000),
    });
    cursor.setDate(cursor.getDate() + 1);
  }
  return points;
}

function buildLineChartSvg(points) {
  const width = 640;
  const height = 180;
  const padLeft = 8;
  const padRight = 8;
  const padTop = 12;
  const padBottom = 22;
  const plotWidth = width - padLeft - padRight;
  const plotHeight = height - padTop - padBottom;

  const maxVal = Math.max(60, ...points.map((p) => p.seconds));
  const stepX = points.length > 1 ? plotWidth / (points.length - 1) : 0;

  const coords = points.map((p, i) => ({
    x: padLeft + stepX * i,
    y: padTop + plotHeight - (p.seconds / maxVal) * plotHeight,
    p,
  }));

  if (coords.length === 0) return '<p class="empty-state">No data yet.</p>';

  const pathD = coords.map((c, i) => `${i === 0 ? 'M' : 'L'} ${c.x.toFixed(1)} ${c.y.toFixed(1)}`).join(' ');
  const floorY = padTop + plotHeight;
  const areaD = `${pathD} L ${coords[coords.length - 1].x.toFixed(1)} ${floorY} L ${coords[0].x.toFixed(1)} ${floorY} Z`;

  const circles = coords
    .map(
      (c) =>
        `<circle cx="${c.x.toFixed(1)}" cy="${c.y.toFixed(1)}" r="3" class="line-point"><title>${escapeHtml(
          c.p.label
        )}: ${formatMinutesShort(c.p.seconds)}</title></circle>`
    )
    .join('');

  const showEvery = Math.max(1, Math.ceil(points.length / 10));
  const labels = coords
    .map((c, i) => {
      if (i % showEvery !== 0 && i !== points.length - 1) return '';
      return `<text x="${c.x.toFixed(1)}" y="${height - 4}" class="line-chart-label" text-anchor="middle">${escapeHtml(
        c.p.label
      )}</text>`;
    })
    .join('');

  return `
    <svg viewBox="0 0 ${width} ${height}" class="line-chart-svg" preserveAspectRatio="none">
      <path d="${areaD}" class="line-chart-area"></path>
      <path d="${pathD}" class="line-chart-line"></path>
      ${circles}
      ${labels}
    </svg>`;
}

let workRecordRange = 'daily';

function setupTimeRangeButtons() {
  document.querySelectorAll('.time-range-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.time-range-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      workRecordRange = btn.dataset.range;
      document.getElementById('time-custom-dates').classList.toggle('hidden', workRecordRange !== 'custom');
      if (workRecordRange !== 'custom') renderWorkRecordChart();
    });
  });

  document.getElementById('time-calc-btn').addEventListener('click', renderWorkRecordChart);

  const today = dayKey(new Date());
  document.getElementById('time-from').value = today;
  document.getElementById('time-to').value = today;
}

function renderWorkRecordChart() {
  const points = getWorkRecordPoints(workRecordRange);
  document.getElementById('time-line-chart').innerHTML = buildLineChartSvg(points);
}


function renderTimeSection() {
  renderDashboardDay();
  renderWorkRecordChart();
}

/* ---------- reminders & deadline notifications ---------- */

function checkReminders() {
  const now = Date.now();
  let changed = false;
  state.tasks.forEach((t) => {
    if (!t.completed && t.dueDate && !t.reminded && new Date(t.dueDate).getTime() <= now) {
      window.api.notify('Task due', t.title);
      t.reminded = true;
      changed = true;
    }
  });
  if (changed) {
    persist();
    renderTasks();
  }
}

function checkDailyDeadlines() {
  const todayKey = dayKey(new Date());
  const nowHHMM = timeStringNow();
  let changed = false;

  state.dailyTasks.forEach((dt) => {
    if (!dt.deadlineTime) return;
    if (dt.notifiedDates.includes(todayKey)) return;
    if (nowHHMM < dt.deadlineTime) return;

    const achieved = isDailyTaskAchieved(dt, todayKey);
    if (!achieved) {
      const status =
        dt.type === 'bidGoal' ? `${bidCountForDate(todayKey)}/${dt.targetCount} bids submitted` : 'not completed';
      window.api.notify('Daily goal missed', `${dt.title}: ${status}`);
    }
    dt.notifiedDates.push(todayKey);
    dt.notifiedDates = dt.notifiedDates.filter((k) => new Date(k).getTime() >= Date.now() - 30 * 24 * 3600 * 1000);
    changed = true;
  });

  if (changed) {
    persist();
    renderDailyTasks();
  }
}

function startReminderLoop() {
  checkReminders();
  checkDailyDeadlines();
  setInterval(() => {
    checkReminders();
    checkDailyDeadlines();
  }, 30000);
}

/* ---------- daily tasks ---------- */

function bidCountForDate(dateKeyStr) {
  return state.bids.filter((b) => b.date === dateKeyStr).length;
}

function isDailyTaskAchieved(dt, dateKeyStr) {
  if (dt.type === 'bidGoal') {
    return bidCountForDate(dateKeyStr) >= (dt.targetCount || 0);
  }
  return !!dt.completions[dateKeyStr];
}

function setupDailyTaskForm() {
  const form = document.getElementById('daily-task-form');
  const typeSelect = document.getElementById('daily-type');
  const targetField = document.querySelector('.daily-target-field');

  typeSelect.addEventListener('change', () => {
    targetField.classList.toggle('hidden', typeSelect.value !== 'bidGoal');
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const title = document.getElementById('daily-title').value.trim();
    if (!title) return;
    const type = typeSelect.value;
    const targetCount = type === 'bidGoal' ? clampInt(document.getElementById('daily-target').value, 1, 999, 1) : null;
    const deadlineTime = document.getElementById('daily-deadline').value || null;
    const editingId = document.getElementById('daily-editing-id').value;

    if (editingId) {
      const dt = state.dailyTasks.find((d) => d.id === editingId);
      if (dt) {
        dt.title = title;
        dt.type = type;
        dt.targetCount = targetCount;
        dt.deadlineTime = deadlineTime;
      }
    } else {
      state.dailyTasks.push({
        id: uid(),
        title,
        type,
        targetCount,
        deadlineTime,
        createdAt: new Date().toISOString(),
        completions: {},
        notifiedDates: [],
      });
    }

    resetDailyTaskForm();
    persist();
    refreshTasksExtras();
  });

  document.getElementById('daily-cancel-edit').addEventListener('click', resetDailyTaskForm);
}

function resetDailyTaskForm() {
  document.getElementById('daily-task-form').reset();
  document.getElementById('daily-editing-id').value = '';
  document.getElementById('daily-type').value = 'manual';
  document.querySelector('.daily-target-field').classList.add('hidden');
  document.getElementById('daily-submit-btn').textContent = 'Add Daily Task';
  document.getElementById('daily-cancel-edit').classList.add('hidden');
}

function beginEditDailyTask(id) {
  const dt = state.dailyTasks.find((d) => d.id === id);
  if (!dt) return;
  document.getElementById('daily-editing-id').value = dt.id;
  document.getElementById('daily-title').value = dt.title;
  document.getElementById('daily-type').value = dt.type;
  document.querySelector('.daily-target-field').classList.toggle('hidden', dt.type !== 'bidGoal');
  document.getElementById('daily-target').value = dt.targetCount || '';
  document.getElementById('daily-deadline').value = dt.deadlineTime || '';
  document.getElementById('daily-submit-btn').textContent = 'Save Changes';
  document.getElementById('daily-cancel-edit').classList.remove('hidden');
  document.getElementById('daily-title').focus();
}

function deleteDailyTask(id) {
  state.dailyTasks = state.dailyTasks.filter((d) => d.id !== id);
  persist();
  refreshTasksExtras();
}

function toggleDailyCompletion(id) {
  const dt = state.dailyTasks.find((d) => d.id === id);
  if (!dt || dt.type !== 'manual') return;
  const today = dayKey(new Date());
  dt.completions[today] = !dt.completions[today];
  persist();
  refreshTasksExtras();
}

function renderDailyTasks() {
  const list = document.getElementById('daily-task-list');
  const empty = document.getElementById('daily-task-empty');

  if (state.dailyTasks.length === 0) {
    list.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  const today = dayKey(new Date());

  list.innerHTML = state.dailyTasks
    .map((dt) => {
      const achieved = isDailyTaskAchieved(dt, today);
      let progressHtml = '';
      let checkboxHtml = '';

      if (dt.type === 'bidGoal') {
        const count = bidCountForDate(today);
        const pct = Math.min(100, Math.round((count / (dt.targetCount || 1)) * 100));
        progressHtml = `
          <div class="daily-progress-bar"><div class="daily-progress-fill ${achieved ? 'achieved' : ''}" style="width:${pct}%"></div></div>
          <div class="task-notes">${count} / ${dt.targetCount} bids today</div>`;
      } else {
        checkboxHtml = `<input type="checkbox" class="daily-toggle" ${achieved ? 'checked' : ''} />`;
      }

      const missedDeadline = dt.deadlineTime && !achieved && timeStringNow() >= dt.deadlineTime;
      const deadlineBadge = dt.deadlineTime
        ? `<span class="badge ${missedDeadline ? 'due-overdue' : ''}">Deadline ${dt.deadlineTime}</span>`
        : '';

      return `
        <li class="task-item ${achieved ? 'completed' : ''}" data-id="${dt.id}">
          ${checkboxHtml}
          <div class="task-main">
            <div class="task-title">${escapeHtml(dt.title)}</div>
            ${progressHtml}
            <div class="task-meta">
              <span class="badge">${dt.type === 'bidGoal' ? 'Bid goal' : 'Checklist'}</span>
              ${deadlineBadge}
            </div>
          </div>
          <div class="task-actions">
            <button class="small secondary edit-btn">Edit</button>
            <button class="small danger delete-btn">Delete</button>
          </div>
        </li>`;
    })
    .join('');
}

function setupDailyTaskListEvents() {
  const list = document.getElementById('daily-task-list');
  list.addEventListener('click', (e) => {
    const li = e.target.closest('.task-item');
    if (!li) return;
    const id = li.dataset.id;
    if (e.target.classList.contains('daily-toggle')) {
      toggleDailyCompletion(id);
    } else if (e.target.classList.contains('edit-btn')) {
      beginEditDailyTask(id);
    } else if (e.target.classList.contains('delete-btn')) {
      if (confirm('Delete this daily task?')) deleteDailyTask(id);
    }
  });
}

/* ---------- achievements ---------- */

let achievementRange = 'daily';

function setupAchievements() {
  document.querySelectorAll('.achv-range-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.achv-range-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      achievementRange = btn.dataset.range;
      document.getElementById('achievement-custom-dates').classList.toggle('hidden', achievementRange !== 'custom');
      if (achievementRange !== 'custom') renderAchievements();
    });
  });

  document.getElementById('achv-calc-btn').addEventListener('click', renderAchievements);

  const today = dayKey(new Date());
  document.getElementById('achv-from').value = today;
  document.getElementById('achv-to').value = today;
}

function computeAchievement(fromKey, toKey) {
  let due = 0;
  let achieved = 0;
  const cursor = new Date(`${fromKey}T00:00:00`);
  const end = new Date(`${toKey}T00:00:00`);

  while (cursor <= end) {
    const key = dayKey(cursor);
    const dayEnd = endOfDay(cursor).getTime();
    state.dailyTasks.forEach((dt) => {
      if (new Date(dt.createdAt).getTime() <= dayEnd) {
        due += 1;
        if (isDailyTaskAchieved(dt, key)) achieved += 1;
      }
    });
    cursor.setDate(cursor.getDate() + 1);
  }

  const rate = due > 0 ? Math.round((achieved / due) * 100) : 0;

  const fromTime = new Date(`${fromKey}T00:00:00`).getTime();
  const toTime = endOfDay(new Date(`${toKey}T00:00:00`)).getTime();
  const additionalCompleted = state.tasks.filter((t) => {
    if (!t.completed || !t.completedAt) return false;
    const ct = new Date(t.completedAt).getTime();
    return ct >= fromTime && ct <= toTime;
  }).length;

  return { due, achieved, rate, additionalCompleted };
}

function renderAchievements() {
  renderDailyTasks();

  const today = new Date();
  const todayKey = dayKey(today);
  let fromKey = todayKey;
  let toKey = todayKey;

  if (achievementRange === 'weekly') {
    fromKey = dayKey(new Date(today.getTime() - 6 * 24 * 3600 * 1000));
  } else if (achievementRange === 'yearly') {
    fromKey = dayKey(new Date(today.getTime() - 364 * 24 * 3600 * 1000));
  } else if (achievementRange === 'custom') {
    fromKey = document.getElementById('achv-from').value || todayKey;
    toKey = document.getElementById('achv-to').value || todayKey;
    if (fromKey > toKey) {
      const tmp = fromKey;
      fromKey = toKey;
      toKey = tmp;
    }
  }

  const result = computeAchievement(fromKey, toKey);
  document.getElementById('achv-rate').textContent = `${result.rate}%`;
  document.getElementById('achv-fraction').textContent = `${result.achieved} / ${result.due}`;
  document.getElementById('achv-additional').textContent = String(result.additionalCompleted);
}

function refreshTasksExtras() {
  renderAchievements();
}

/* ---------- platforms ---------- */

function setupPlatformForm() {
  document.getElementById('platform-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = document.getElementById('platform-name');
    const name = input.value.trim();
    if (!name) return;
    const exists = state.platforms.some((p) => p.name.toLowerCase() === name.toLowerCase());
    if (!exists) {
      state.platforms.push({ id: uid(), name });
      persist();
      renderPlatforms();
      populateBidPlatformSelect();
    }
    input.value = '';
  });
}

function deletePlatform(id) {
  state.platforms = state.platforms.filter((p) => p.id !== id);
  persist();
  renderPlatforms();
  populateBidPlatformSelect();
}

function renderPlatforms() {
  const container = document.getElementById('platform-cards');
  const empty = document.getElementById('platform-empty');
  if (state.platforms.length === 0) {
    container.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');
  container.innerHTML = state.platforms
    .map(
      (p) => `
        <div class="platform-card" data-id="${p.id}">
          <span class="platform-card-name">${escapeHtml(p.name)}</span>
          <button type="button" class="small quick-add-btn">+ Add Bid</button>
          <button type="button" class="small danger platform-delete-btn">&times;</button>
        </div>`
    )
    .join('');
}

function setupPlatformCardEvents() {
  document.getElementById('platform-cards').addEventListener('click', (e) => {
    const card = e.target.closest('.platform-card');
    if (!card) return;
    const id = card.dataset.id;
    const platform = state.platforms.find((p) => p.id === id);
    if (e.target.classList.contains('quick-add-btn') && platform) {
      resetBidForm();
      document.getElementById('bid-platform').value = platform.name;
      document.getElementById('bid-form').scrollIntoView({ behavior: 'smooth' });
      document.getElementById('bid-company').focus();
    } else if (e.target.classList.contains('platform-delete-btn')) {
      if (confirm(`Remove platform "${platform ? platform.name : ''}"? Existing bids keep their recorded platform.`)) {
        deletePlatform(id);
      }
    }
  });
}

function populateBidPlatformSelect() {
  const select = document.getElementById('bid-platform');
  const prev = select.value;
  select.innerHTML =
    '<option value="">Select platform</option>' +
    state.platforms.map((p) => `<option value="${escapeHtml(p.name)}">${escapeHtml(p.name)}</option>`).join('');
  if (state.platforms.some((p) => p.name === prev)) select.value = prev;

  const filterSelect = document.getElementById('bid-filter-platform');
  const prevFilter = filterSelect.value;
  filterSelect.innerHTML =
    '<option value="">All</option>' +
    state.platforms.map((p) => `<option value="${escapeHtml(p.name)}">${escapeHtml(p.name)}</option>`).join('');
  if (state.platforms.some((p) => p.name === prevFilter)) filterSelect.value = prevFilter;
}

/* ---------- bid management ---------- */

function setupBidSubTabs() {
  document.querySelectorAll('.bid-subtab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.bid-subtab-btn').forEach((b) => b.classList.remove('active'));
      document.querySelectorAll('.bid-subpanel').forEach((p) => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(`bid-sub-${btn.dataset.subtab}`).classList.add('active');
    });
  });
}

function goToBidSubTab(name) {
  document.querySelector(`.bid-subtab-btn[data-subtab="${name}"]`).click();
}

function setupBidForm() {
  const form = document.getElementById('bid-form');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const company = document.getElementById('bid-company').value.trim();
    if (!company) return;
    const platform = document.getElementById('bid-platform').value;
    let link = document.getElementById('bid-link').value.trim();
    if (link && !/^https?:\/\//i.test(link)) link = 'https://' + link;
    const editingId = document.getElementById('bid-editing-id').value;

    if (editingId) {
      const bid = state.bids.find((b) => b.id === editingId);
      if (bid) {
        bid.company = company;
        bid.platform = platform;
        bid.link = link;
      }
    } else {
      const now = new Date();
      state.bids.push({
        id: uid(),
        company,
        platform,
        link,
        approved: false,
        date: dayKey(now),
        createdAt: now.toISOString(),
      });
    }

    resetBidForm();
    persist();
    renderBids();
    refreshTasksExtras();
  });

  document.getElementById('bid-cancel-edit').addEventListener('click', resetBidForm);
  document.getElementById('bid-filter-platform').addEventListener('change', renderBidList);
  document.getElementById('bid-filter-status').addEventListener('change', renderBidList);
}

function resetBidForm() {
  document.getElementById('bid-form').reset();
  document.getElementById('bid-editing-id').value = '';
  document.getElementById('bid-submit-btn').textContent = 'Record Bid';
  document.getElementById('bid-cancel-edit').classList.add('hidden');
}

function beginEditBid(id) {
  const bid = state.bids.find((b) => b.id === id);
  if (!bid) return;
  goToBidSubTab('bid');
  document.getElementById('bid-editing-id').value = bid.id;
  document.getElementById('bid-company').value = bid.company;
  document.getElementById('bid-platform').value = bid.platform || '';
  document.getElementById('bid-link').value = bid.link || '';
  document.getElementById('bid-submit-btn').textContent = 'Save Changes';
  document.getElementById('bid-cancel-edit').classList.remove('hidden');
  document.getElementById('bid-company').focus();
}

function deleteBid(id) {
  state.bids = state.bids.filter((b) => b.id !== id);
  persist();
  renderBids();
  refreshTasksExtras();
}

function toggleBidApproved(id) {
  const bid = state.bids.find((b) => b.id === id);
  if (!bid) return;
  bid.approved = !bid.approved;
  persist();
  renderBids();
}

function sortedFilteredBids() {
  const platformFilter = document.getElementById('bid-filter-platform').value;
  const statusFilter = document.getElementById('bid-filter-status').value;

  let bids = state.bids.slice();
  if (platformFilter) bids = bids.filter((b) => b.platform === platformFilter);
  if (statusFilter === 'approved') bids = bids.filter((b) => b.approved);
  else if (statusFilter === 'pending') bids = bids.filter((b) => !b.approved);

  bids.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return bids;
}

function renderBidList() {
  const list = document.getElementById('bid-list');
  const empty = document.getElementById('bid-empty');
  const bids = sortedFilteredBids();

  document.getElementById('bid-count').textContent = `${bids.length} shown / ${state.bids.length} total`;

  if (bids.length === 0) {
    list.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  list.innerHTML = bids
    .map((b) => {
      const timeLabel = new Date(b.createdAt).toLocaleString([], {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
      const linkBtn = b.link
        ? `<button type="button" class="small secondary open-link-btn" data-link="${escapeHtml(b.link)}">Open link</button>`
        : '';
      return `
        <li class="task-item ${b.approved ? 'completed' : ''}" data-id="${b.id}">
          <input type="checkbox" class="bid-approve-toggle" ${b.approved ? 'checked' : ''} title="Approved" />
          <div class="task-main">
            <div class="task-title">${escapeHtml(b.company)}</div>
            <div class="task-meta">
              ${b.platform ? `<span class="badge">${escapeHtml(b.platform)}</span>` : ''}
              <span class="badge ${b.approved ? 'status-won' : ''}">${b.approved ? 'Approved' : 'Pending'}</span>
              <span class="badge">${timeLabel}</span>
            </div>
          </div>
          <div class="task-actions">
            ${linkBtn}
            <button class="small secondary edit-btn">Edit</button>
            <button class="small danger delete-btn">Delete</button>
          </div>
        </li>`;
    })
    .join('');
}

function renderBidStats() {
  const total = state.bids.length;
  const approved = state.bids.filter((b) => b.approved).length;

  document.getElementById('bid-stat-count').textContent = String(total);
  document.getElementById('bid-stat-approved').textContent = String(approved);
}

function renderTodayBidHint() {
  const count = bidCountForDate(dayKey(new Date()));
  document.getElementById('today-bid-hint').textContent = `Applied to ${count} position${count === 1 ? '' : 's'} today.`;
}

function renderBids() {
  renderPlatforms();
  populateBidPlatformSelect();
  renderBidStats();
  renderBidList();
  renderTodayBidHint();
}

function setupBidListEvents() {
  const list = document.getElementById('bid-list');
  list.addEventListener('click', (e) => {
    const li = e.target.closest('.task-item');
    if (!li) return;
    const id = li.dataset.id;
    if (e.target.classList.contains('bid-approve-toggle')) {
      toggleBidApproved(id);
    } else if (e.target.classList.contains('edit-btn')) {
      beginEditBid(id);
    } else if (e.target.classList.contains('delete-btn')) {
      if (confirm('Delete this bid entry?')) deleteBid(id);
    } else if (e.target.classList.contains('open-link-btn')) {
      const link = e.target.dataset.link;
      if (link) window.api.openExternal(link);
    }
  });
}

/* ---------- init ---------- */

async function init() {
  state = await window.api.loadData();

  setupSidebar();
  setupTaskForm();
  setupTaskListEvents();
  setupDateNav();
  setupTimelineRowSelection();
  setupTimeRangeButtons();
  setupTrackingToggle();
  setupDailyTaskForm();
  setupDailyTaskListEvents();
  setupAchievements();
  setupBidSubTabs();
  setupPlatformForm();
  setupPlatformCardEvents();
  setupBidForm();
  setupBidListEvents();

  renderTimelineRuler();

  refreshCategoryOptions();
  renderTasks();
  renderAchievements();
  renderBids();
  renderTimeSection();

  updateTrackingToggleButton();
  if (state.trackingEnabled) {
    startTrackingLoop();
  } else {
    setStatusPill('stopped');
  }

  startReminderLoop();
}

document.addEventListener('DOMContentLoaded', init);
