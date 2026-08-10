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

function goToSubTab(tab, subtab) {
  document.querySelector(`.nav-subitem[data-tab="${tab}"][data-subtab="${subtab}"]`).click();
}

function expandNavGroup(tab) {
  document.querySelectorAll('.nav-group').forEach((g) => {
    g.classList.toggle('expanded', g.dataset.tab === tab);
  });
}

function setupSidebar() {
  document.querySelectorAll('.nav-group-label').forEach((label) => {
    label.addEventListener('click', () => expandNavGroup(label.dataset.tab));
  });

  document.querySelectorAll('.nav-item, .nav-subitem').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.nav-item, .nav-subitem').forEach((b) => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
      expandNavGroup(btn.dataset.tab);

      if (btn.dataset.subtab) {
        document.querySelectorAll('.subpanel').forEach((p) => p.classList.remove('active'));
        document.getElementById(`${btn.dataset.tab}-sub-${btn.dataset.subtab}`).classList.add('active');
      }

      if (btn.dataset.tab === 'tasks') {
        refreshTasksExtras();
        renderTasks();
      }
      if (btn.dataset.tab === 'bids') renderBids();
      if (btn.dataset.tab === 'alarm') {
        renderTimeSection();
        renderAlarms();
        renderWorldClocks();
        renderTimerPresets();
      }
      if (btn.dataset.tab === 'settings') {
        renderBids();
        refreshTasksExtras();
        renderDailySummaryReport();
      }
    });
  });

  const sidebar = document.getElementById('sidebar');
  const pinBtn = document.getElementById('sidebar-pin');
  const applySidebarPinState = (pinned) => {
    sidebar.classList.toggle('pinned', pinned);
    pinBtn.innerHTML = pinned ? '&#171;' : '&#187;';
  };
  applySidebarPinState(state.settings.sidebarPinned !== false);
  pinBtn.addEventListener('click', () => {
    const pinned = !sidebar.classList.contains('pinned');
    applySidebarPinState(pinned);
    state.settings.sidebarPinned = pinned;
    persist();
  });
}

/* ---------- additional tasks ---------- */

/* Pre-migration tasks have no .type — treat those as 'manual' (the old, only, behavior). */
function migrateTaskTypes() {
  state.tasks.forEach((t) => {
    if (!t.type) t.type = 'manual';
  });
}

/* Exact percentage for a single additional task — mirrors dailyTaskPercent(), but
   additional tasks aren't daily-recurring so there's no per-day map: a bid-goal
   task counts bids on its own due date, a percentage task is a single manually-set
   value, a checklist task is binary 0/100. */
function additionalTaskPercent(t) {
  if (t.type === 'bidGoal') {
    const dateKeyStr = dayKey(new Date(t.dueDate));
    const count = bidCountForGoal(t, dateKeyStr);
    const target = t.targetCount || 1;
    return (count / target) * 100;
  }
  if (t.type === 'percentage') {
    return t.percentValue || 0;
  }
  return t.completed ? 100 : 0;
}

function isAdditionalTaskAchieved(t) {
  if (t.type === 'bidGoal' || t.type === 'percentage') {
    return additionalTaskPercent(t) >= 100;
  }
  return !!t.completed && !!t.completedAt && new Date(t.completedAt).getTime() <= new Date(t.dueDate).getTime();
}

function populateTaskScopeRefSelect() {
  const typeSelect = document.getElementById('task-scope-type');
  const refSelect = document.getElementById('task-scope-ref');
  const refField = document.querySelector('.task-scope-ref-field');
  const type = typeSelect.value;
  refField.classList.toggle('hidden', type === 'overall');

  const prev = refSelect.value;
  if (type === 'account') {
    refSelect.innerHTML = state.accounts.map((a) => `<option value="${a.id}">${escapeHtml(accountLabel(a))}</option>`).join('');
  } else if (type === 'platform') {
    refSelect.innerHTML = state.platforms.map((p) => `<option value="${escapeHtml(p.name)}">${escapeHtml(p.name)}</option>`).join('');
  } else {
    refSelect.innerHTML = '';
  }
  if ([...refSelect.options].some((o) => o.value === prev)) refSelect.value = prev;
}

function updateTaskTypeFieldVisibility() {
  const type = document.getElementById('task-type').value;
  document.querySelectorAll('.task-bidgoal-field').forEach((el) => el.classList.toggle('hidden', type !== 'bidGoal'));
  if (type === 'bidGoal') populateTaskScopeRefSelect();
  else document.querySelector('.task-scope-ref-field').classList.add('hidden');
}

function setupTaskForm() {
  const form = document.getElementById('task-form');

  document.getElementById('task-type').addEventListener('change', updateTaskTypeFieldVisibility);
  document.getElementById('task-scope-type').addEventListener('change', populateTaskScopeRefSelect);

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const title = document.getElementById('task-title').value.trim();
    if (!title) return;
    const notes = document.getElementById('task-notes').value.trim();
    const dueRaw = document.getElementById('task-due').value;
    const dueDate = dueRaw ? new Date(dueRaw).toISOString() : null;
    const priority = document.getElementById('task-priority').value;
    const type = document.getElementById('task-type').value;
    const targetCount = type === 'bidGoal' ? clampInt(document.getElementById('task-target').value, 1, 999, 1) : null;
    const scopeType = document.getElementById('task-scope-type').value;
    const scopeRef = document.getElementById('task-scope-ref').value;
    const scope = type === 'bidGoal' ? (scopeType === 'overall' || !scopeRef ? { type: 'overall' } : { type: scopeType, refId: scopeRef }) : null;
    const editingId = document.getElementById('task-editing-id').value;

    if (editingId) {
      const task = state.tasks.find((t) => t.id === editingId);
      if (task) {
        const dueDateChanged = task.dueDate !== dueDate;
        task.title = title;
        task.notes = notes;
        task.dueDate = dueDate;
        task.priority = priority;
        task.type = type;
        task.targetCount = targetCount;
        task.scope = scope;
        if (task.percentValue === undefined) task.percentValue = 0;
        if (dueDateChanged) task.reminded = false;
      }
    } else {
      state.tasks.push({
        id: uid(),
        title,
        notes,
        dueDate,
        priority,
        type,
        targetCount,
        scope,
        percentValue: 0,
        completed: false,
        completedAt: null,
        createdAt: new Date().toISOString(),
        reminded: false,
      });
    }

    resetTaskForm();
    persist();
    renderTasks();
    refreshTasksExtras();
  });

  document.getElementById('task-cancel-edit').addEventListener('click', resetTaskForm);

  document.getElementById('filter-type').addEventListener('change', renderTasks);
  document.getElementById('filter-show-completed').addEventListener('change', renderTasks);
}

function resetTaskForm() {
  document.getElementById('task-form').reset();
  document.getElementById('task-editing-id').value = '';
  document.getElementById('task-priority').value = 'medium';
  document.getElementById('task-type').value = 'manual';
  document.getElementById('task-scope-type').value = 'overall';
  updateTaskTypeFieldVisibility();
  document.getElementById('task-submit-btn').textContent = 'Add Task';
  document.getElementById('task-cancel-edit').classList.add('hidden');
}

function beginEditTask(id) {
  const task = state.tasks.find((t) => t.id === id);
  if (!task) return;
  const scope = task.scope || { type: 'overall' };
  document.getElementById('task-editing-id').value = task.id;
  document.getElementById('task-title').value = task.title;
  document.getElementById('task-notes').value = task.notes || '';
  document.getElementById('task-due').value = task.dueDate ? toLocalInputValue(task.dueDate) : '';
  document.getElementById('task-priority').value = task.priority;
  document.getElementById('task-type').value = task.type || 'manual';
  document.getElementById('task-target').value = task.targetCount || '';
  document.getElementById('task-scope-type').value = scope.type;
  updateTaskTypeFieldVisibility();
  document.getElementById('task-scope-ref').value = scope.refId || '';
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
  renderTasks();
  refreshTasksExtras();
}

function toggleTaskComplete(id) {
  const task = state.tasks.find((t) => t.id === id);
  if (!task || task.type !== 'manual') return;
  task.completed = !task.completed;
  task.completedAt = task.completed ? new Date().toISOString() : null;
  persist();
  renderTasks();
  refreshTasksExtras();
}

function updateAdditionalTaskPercentage(id, value) {
  const t = state.tasks.find((x) => x.id === id);
  if (!t || t.type !== 'percentage') return;
  t.percentValue = clampInt(value, 0, 100, 0);
  t.completed = t.percentValue >= 100;
  t.completedAt = t.completed ? new Date().toISOString() : null;
  persist();
  renderTasks();
  refreshTasksExtras();
}

/* interactive controls whether bidGoal/percentage additional tasks get an editable
   slider/number — same pattern as dailyTaskItemHtml's interactive flag. */
function additionalTaskProgressHtml(t, interactive) {
  if (t.type === 'bidGoal') {
    const dateKeyStr = dayKey(new Date(t.dueDate));
    const count = bidCountForGoal(t, dateKeyStr);
    const exactPct = additionalTaskPercent(t);
    const barPct = Math.min(100, Math.round(exactPct));
    return `
      <div class="daily-progress-bar"><div class="daily-progress-fill ${exactPct >= 100 ? 'achieved' : ''}" style="width:${barPct}%"></div></div>
      <div class="task-notes">${count} / ${t.targetCount} bids &middot; ${Math.round(exactPct)}%</div>`;
  }
  if (t.type === 'percentage') {
    const pct = Math.round(t.percentValue || 0);
    if (interactive) {
      return `
        <div class="task-notes percentage-row">
          <input type="range" class="percentage-slider additional-percentage-slider" min="0" max="100" value="${pct}" data-id="${t.id}" style="${percentageSliderFillStyle(pct)}" />
          <input type="number" class="percentage-number additional-percentage-number" min="0" max="100" value="${pct}" data-id="${t.id}" />
          <span>%</span>
        </div>`;
    }
    return `
      <div class="daily-progress-bar"><div class="daily-progress-fill ${pct >= 100 ? 'achieved' : ''}" style="width:${pct}%"></div></div>
      <div class="task-notes">${pct}%</div>`;
  }
  return '';
}

function sortedFilteredTasks() {
  const typeFilter = document.getElementById('filter-type').value;
  const showCompleted = document.getElementById('filter-show-completed').checked;

  let tasks = state.tasks.slice();
  if (typeFilter) tasks = tasks.filter((t) => t.type === typeFilter);
  if (!showCompleted) tasks = tasks.filter((t) => !isAdditionalTaskAchieved(t));

  tasks.sort((a, b) => {
    const aDone = isAdditionalTaskAchieved(a);
    const bDone = isAdditionalTaskAchieved(b);
    if (aDone !== bDone) return aDone ? 1 : -1;
    if (a.dueDate && b.dueDate) return new Date(a.dueDate) - new Date(b.dueDate);
    if (a.dueDate) return -1;
    if (b.dueDate) return 1;
    return new Date(a.createdAt) - new Date(b.createdAt);
  });

  return tasks;
}

function renderTasks() {
  migrateTaskTypes();
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
      const achieved = isAdditionalTaskAchieved(t);
      const isOverdue = !achieved && t.dueDate && new Date(t.dueDate).getTime() < now;
      const isDueSoon = !achieved && !isOverdue && t.dueDate && new Date(t.dueDate).getTime() - now < 24 * 3600 * 1000;

      const classes = ['task-item'];
      if (achieved) classes.push('completed');
      if (isOverdue) classes.push('overdue');

      const dueBadge = t.dueDate
        ? `<span class="badge ${isOverdue ? 'due-overdue' : isDueSoon ? 'due-soon' : ''}">${
            isOverdue ? 'Overdue: ' : 'Due: '
          }${new Date(t.dueDate).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>`
        : '';

      const typeLabel = t.type === 'bidGoal' ? 'Bid goal' : t.type === 'percentage' ? 'Percentage' : 'Checklist';
      const checkboxHtml = t.type === 'manual' ? `<input type="checkbox" class="task-toggle" ${t.completed ? 'checked' : ''} />` : '';

      return `
        <li class="${classes.join(' ')}" data-id="${t.id}">
          ${checkboxHtml}
          <div class="task-main">
            <div class="task-title">${escapeHtml(t.title)}</div>
            ${t.notes ? `<div class="task-notes">${escapeHtml(t.notes)}</div>` : ''}
            ${additionalTaskProgressHtml(t, true)}
            <div class="task-meta">
              <span class="badge priority-${t.priority}">${t.priority}</span>
              <span class="badge">${typeLabel}</span>
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
  setupPercentageSliderEvents(list, 'additional-percentage-slider', 'additional-percentage-number', updateAdditionalTaskPercentage);
}

/* ---------- activity tracking (automatic: active / idle / locked, manual start/stop) ---------- */

let activityIntervalMs = 60000;
let activityInterval = null;
let trackingStartMs = null;

function startTrackingLoop() {
  if (activityInterval) return;
  trackingStartMs = Date.now();
  activityInterval = setInterval(activityTick, activityIntervalMs);
  activityTick();
}

function stopTrackingLoop() {
  if (activityInterval) {
    clearInterval(activityInterval);
    activityInterval = null;
  }
  /* Close the open segments off at the actual stop moment (before clearing
     trackingStartMs) so Untracked starts exactly here, not up to one interval
     early. */
  const now = new Date().toISOString();
  const lastActivity = state.activityLog[state.activityLog.length - 1];
  if (isContinuingTrackingSession(lastActivity)) lastActivity.end = now;
  const lastApp = state.appLog[state.appLog.length - 1];
  if (isContinuingTrackingSession(lastApp)) lastApp.end = now;
  persist();

  trackingStartMs = null;
  setStatusPill('stopped');
}

function applyTrackingInterval() {
  if (activityInterval) {
    clearInterval(activityInterval);
    activityInterval = setInterval(activityTick, activityIntervalMs);
  }
}

/* Lock/unlock are real OS events (pushed from main.js the instant they fire),
   not something we should only discover at the next poll tick — which, while
   the screen is locked, can be delayed well past activityIntervalMs. Locking
   is unambiguous, so record it immediately; unlocking needs a fresh idle-time
   read to tell active from idle, so it just triggers an immediate tick instead
   of assuming a state. */
function setupLockStateListener() {
  window.api.onLockStateChanged((locked) => {
    if (!activityInterval) return;
    if (locked) {
      setStatusPill('locked');
      recordActivitySample('locked');
      persist();
      const activePanel = document.querySelector('.tab-panel.active');
      if (activePanel && activePanel.id === 'tab-alarm') {
        renderDashboardDay();
        renderWorkRecordChart();
      }
    } else {
      activityTick();
    }
  });
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

/* True if `last` belongs to the tracking session currently running — i.e. it's
   safe to chain a new sample onto it with zero gap. A `last` entry left over
   from a PRIOR Start/Stop window (its end predates this session's start) must
   never be bridged across the stopped gap — that gap is genuinely Untracked. */
function isContinuingTrackingSession(last) {
  return !!last && trackingStartMs !== null && new Date(last.end).getTime() >= trackingStartMs;
}

/* Where a brand-new segment should start: right where the previous one left off
   (zero gap, however late this sample arrives — no blind "now minus one
   interval" backdating), or at the moment tracking started if there's nothing
   to chain onto. */
function chainedStartMs(last, now) {
  if (isContinuingTrackingSession(last)) return new Date(last.end).getTime();
  return trackingStartMs !== null ? trackingStartMs : now.getTime();
}

function recordActivitySample(sampleState) {
  const now = new Date();
  const last = state.activityLog[state.activityLog.length - 1];
  if (isContinuingTrackingSession(last) && last.state === sampleState) {
    last.end = now.toISOString();
  } else {
    state.activityLog.push({
      start: new Date(chainedStartMs(last, now)).toISOString(),
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
  if (isContinuingTrackingSession(last) && last.appName === appName) {
    last.end = now.toISOString();
  } else {
    state.appLog.push({
      start: new Date(chainedStartMs(last, now)).toISOString(),
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
  const thresholdSeconds = Math.max(1, Math.round(activityIntervalMs / 1000));
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
  if (activePanel && activePanel.id === 'tab-alarm') {
    renderDashboardDay();
    renderWorkRecordChart();
  }
}

/* ---------- dashboard day view (Computer Usage + Applications, ManicTime-style) ---------- */

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

/* Zoom: how much of the day is currently visible on the timeline bars. */
const DAY_MS = 24 * 3600 * 1000;
const MIN_ZOOM_MS = 15 * 60 * 1000; // 15 minutes
let timelineZoomMs = DAY_MS;

function getTimelineViewRange(dateKey) {
  const dayStart = new Date(`${dateKey}T00:00:00`).getTime();
  const dayEnd = dayStart + DAY_MS;
  if (timelineZoomMs >= DAY_MS) return { viewStart: dayStart, viewEnd: dayEnd };

  const now = Date.now();
  const center = dateKey === dayKey(new Date()) && now >= dayStart && now <= dayEnd ? now : dayStart + DAY_MS / 2;

  let viewStart = center - timelineZoomMs / 2;
  let viewEnd = center + timelineZoomMs / 2;
  if (viewStart < dayStart) {
    viewEnd += dayStart - viewStart;
    viewStart = dayStart;
  }
  if (viewEnd > dayEnd) {
    viewStart -= viewEnd - dayEnd;
    viewEnd = dayEnd;
  }
  return { viewStart: Math.max(dayStart, viewStart), viewEnd: Math.min(dayEnd, viewEnd) };
}

function setupTimelineZoom() {
  const wrap = document.querySelector('.timeline-wrap');
  wrap.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const zoomFactor = e.deltaY < 0 ? 0.75 : 1 / 0.75;
      timelineZoomMs = Math.min(DAY_MS, Math.max(MIN_ZOOM_MS, timelineZoomMs * zoomFactor));
      renderTimeline();
      renderAppTimeline();
      renderNowMarker();
      renderTimelineRuler();
    },
    { passive: false }
  );
}

/* "Nice" tick steps (ms) to choose from when drawing the ruler at any zoom level. */
const RULER_NICE_STEPS_MIN = [5, 10, 15, 30, 60, 120, 180, 360, 720, 1440];

function renderTimelineRuler() {
  const { viewStart, viewEnd } = getTimelineViewRange(dashboardDateKey);
  const rangeMs = viewEnd - viewStart;
  const rawStepMin = rangeMs / 1000 / 60 / 8;
  const stepMin = RULER_NICE_STEPS_MIN.find((m) => m >= rawStepMin) || RULER_NICE_STEPS_MIN[RULER_NICE_STEPS_MIN.length - 1];
  const stepMs = stepMin * 60000;

  const labels = [];
  for (let t = Math.ceil(viewStart / stepMs) * stepMs; t <= viewEnd; t += stepMs) {
    const pct = ((t - viewStart) / rangeMs) * 100;
    labels.push(`<span style="left:${pct.toFixed(2)}%">${fmtTime(t)}</span>`);
  }
  document.getElementById('timeline-ruler').innerHTML = labels.join('');
}

function dominantKeyInRange(log, keyField, rangeStart, rangeEnd) {
  const durByKey = {};
  for (const entry of log) {
    const es = new Date(entry.start).getTime();
    const ee = new Date(entry.end).getTime();
    const overlapStart = Math.max(es, rangeStart);
    const overlapEnd = Math.min(ee, rangeEnd);
    if (overlapEnd > overlapStart) {
      durByKey[entry[keyField]] = (durByKey[entry[keyField]] || 0) + (overlapEnd - overlapStart);
    }
  }
  const entries = Object.entries(durByKey);
  if (!entries.length) return null;
  entries.sort((a, b) => b[1] - a[1]);
  return entries[0][0];
}

function slotTooltip(rangeStart, rangeEnd, status, appName) {
  const timeLabel = `${fmtTime(rangeStart)}–${fmtTime(rangeEnd)}`;
  const statusLabel = status ? capitalize(status) : 'Untracked';
  const appLabel = appName || 'No app data';
  return `${timeLabel} · ${statusLabel} · ${appLabel}`;
}

/* Build the real, variable-width segments covering [viewStart, viewEnd) — no fixed
   buckets. Gaps with no log entry (or time not yet reached) become "untracked" (key=null). */
function buildViewSegments(log, keyField, viewStart, viewEnd) {
  const now = Date.now();
  const visibleEnd = Math.min(viewEnd, now);
  if (visibleEnd <= viewStart) return [{ start: viewStart, end: viewEnd, key: null }];

  const entries = log
    .map((e) => ({ start: new Date(e.start).getTime(), end: new Date(e.end).getTime(), key: e[keyField] }))
    .filter((e) => e.end > viewStart && e.start < visibleEnd)
    .map((e) => ({ start: Math.max(e.start, viewStart), end: Math.min(e.end, visibleEnd), key: e.key }))
    .sort((a, b) => a.start - b.start);

  const segments = [];
  let cursor = viewStart;
  for (const e of entries) {
    if (e.start > cursor) segments.push({ start: cursor, end: e.start, key: null });
    if (e.end > cursor) {
      segments.push({ start: Math.max(e.start, cursor), end: e.end, key: e.key });
      cursor = e.end;
    }
  }
  if (cursor < viewEnd) segments.push({ start: cursor, end: viewEnd, key: null });
  return segments;
}

function renderTimeline() {
  const { viewStart, viewEnd } = getTimelineViewRange(dashboardDateKey);
  const rangeMs = viewEnd - viewStart;
  const segments = buildViewSegments(state.activityLog, 'state', viewStart, viewEnd);

  const html = segments
    .map((seg) => {
      const widthPct = ((seg.end - seg.start) / rangeMs) * 100;
      const cls = seg.key || '';
      const appName = seg.key ? dominantKeyInRange(state.appLog, 'appName', seg.start, seg.end) : null;
      const tooltip = escapeHtml(slotTooltip(seg.start, seg.end, seg.key, appName));
      return `<div class="timeline-slot ${cls}" style="width:${widthPct}%" data-tooltip="${tooltip}"></div>`;
    })
    .join('');
  document.getElementById('timeline').innerHTML = html;
}

function renderAppTimeline() {
  const { viewStart, viewEnd } = getTimelineViewRange(dashboardDateKey);
  const rangeMs = viewEnd - viewStart;
  const segments = buildViewSegments(state.appLog, 'appName', viewStart, viewEnd);

  const html = segments
    .map((seg) => {
      const widthPct = ((seg.end - seg.start) / rangeMs) * 100;
      const style = seg.key ? `background:${colorForApp(seg.key)};` : '';
      const status = seg.key ? dominantKeyInRange(state.activityLog, 'state', seg.start, seg.end) : null;
      const tooltip = escapeHtml(slotTooltip(seg.start, seg.end, status, seg.key));
      return `<div class="timeline-slot" style="${style}width:${widthPct}%" data-tooltip="${tooltip}"></div>`;
    })
    .join('');
  document.getElementById('app-timeline').innerHTML = html;
}

function renderNowMarker() {
  const marker = document.getElementById('timeline-now-marker');
  const now = Date.now();
  const { viewStart, viewEnd } = getTimelineViewRange(dashboardDateKey);
  if (dashboardDateKey !== dayKey(new Date()) || now < viewStart || now > viewEnd) {
    marker.classList.add('hidden');
    return;
  }
  marker.classList.remove('hidden');
  const pct = ((now - viewStart) / (viewEnd - viewStart)) * 100;
  marker.style.left = `${pct}%`;
}

function setupChartTooltip() {
  const tooltip = document.getElementById('chart-tooltip');
  const rows = document.querySelector('.timeline-rows');

  rows.addEventListener('mousemove', (e) => {
    const slot = e.target.closest('.timeline-slot');
    if (!slot || !slot.dataset.tooltip) {
      tooltip.classList.add('hidden');
      return;
    }
    tooltip.textContent = slot.dataset.tooltip;
    tooltip.classList.remove('hidden');

    const margin = 14;
    let left = e.clientX + margin;
    let top = e.clientY + margin;
    const rect = tooltip.getBoundingClientRect();
    if (left + rect.width > window.innerWidth) left = e.clientX - rect.width - margin;
    if (top + rect.height > window.innerHeight) top = e.clientY - rect.height - margin;
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
  });

  rows.addEventListener('mouseleave', () => tooltip.classList.add('hidden'));
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
  renderTimelineRuler();
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

function getWorkRecordPoints() {
  if (logRangeFrom === logRangeTo) {
    const dayStart = new Date(`${logRangeFrom}T00:00:00`).getTime();
    const points = [];
    for (let h = 0; h < 24; h++) {
      const hourStart = dayStart + h * 3600 * 1000;
      points.push({ label: `${h}:00`, value: activeSecondsInRange(hourStart, hourStart + 3600 * 1000) });
    }
    return points;
  }

  const points = [];
  const cursor = new Date(`${logRangeFrom}T00:00:00`);
  const end = new Date(`${logRangeTo}T00:00:00`);
  while (cursor <= end) {
    const dayStartMs = startOfDay(cursor).getTime();
    points.push({
      label: cursor.toLocaleDateString([], { month: 'short', day: 'numeric' }),
      value: activeSecondsInRange(dayStartMs, dayStartMs + 24 * 3600 * 1000),
    });
    cursor.setDate(cursor.getDate() + 1);
  }
  return points;
}

/* Smooth (Catmull-Rom → cubic Bezier) path through every point, instead of
   straight segments — used for all line charts (Time Log, Achievement, Bid Log)
   so they render consistently. */
function buildSmoothLinePath(coords) {
  if (coords.length === 0) return '';
  if (coords.length === 1) return `M ${coords[0].x.toFixed(1)} ${coords[0].y.toFixed(1)}`;

  let d = `M ${coords[0].x.toFixed(1)} ${coords[0].y.toFixed(1)}`;
  for (let i = 0; i < coords.length - 1; i++) {
    const p0 = coords[i === 0 ? 0 : i - 1];
    const p1 = coords[i];
    const p2 = coords[i + 1];
    const p3 = coords[i + 2 < coords.length ? i + 2 : i + 1];

    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;

    d += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }
  return d;
}

function buildLineChartSvg(points, formatValue = formatMinutesShort, maxHint = 60) {
  const width = 640;
  const height = 180;
  const padLeft = 8;
  const padRight = 8;
  const padTop = 12;
  const padBottom = 22;
  const plotWidth = width - padLeft - padRight;
  const plotHeight = height - padTop - padBottom;

  const maxVal = Math.max(maxHint, ...points.map((p) => p.value));
  const stepX = points.length > 1 ? plotWidth / (points.length - 1) : 0;

  const coords = points.map((p, i) => ({
    x: padLeft + stepX * i,
    y: padTop + plotHeight - (p.value / maxVal) * plotHeight,
    p,
  }));

  if (coords.length === 0) return '<p class="empty-state">No data yet.</p>';

  const pathD = buildSmoothLinePath(coords);
  const floorY = padTop + plotHeight;
  const areaD = `${pathD} L ${coords[coords.length - 1].x.toFixed(1)} ${floorY} L ${coords[0].x.toFixed(1)} ${floorY} Z`;

  const circles = coords
    .map(
      (c) =>
        `<circle cx="${c.x.toFixed(1)}" cy="${c.y.toFixed(1)}" r="3" class="line-point"><title>${escapeHtml(
          c.p.label
        )}: ${formatValue(c.p.value)}</title></circle>`
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

let logRangeFrom = dayKey(new Date());
let logRangeTo = dayKey(new Date());

function startOfWeekMonday(d) {
  const x = startOfDay(d);
  const dow = (x.getDay() + 6) % 7; // 0 = Monday
  x.setDate(x.getDate() - dow);
  return x;
}

function formatDateLabel(key) {
  return new Date(`${key}T00:00:00`).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

/* Shared by any "Today/Yesterday/This Week/.../This Year" range-tab UI (Log, Achievement). */
function computePresetRange(preset, today) {
  const todayKey = dayKey(today);

  if (preset === 'today') return { from: todayKey, to: todayKey };

  if (preset === 'yesterday') {
    const y = new Date(today);
    y.setDate(y.getDate() - 1);
    return { from: dayKey(y), to: dayKey(y) };
  }

  if (preset === 'thisWeek') {
    const start = startOfWeekMonday(today);
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    return { from: dayKey(start), to: dayKey(end) };
  }

  if (preset === 'lastWeek') {
    const start = startOfWeekMonday(today);
    start.setDate(start.getDate() - 7);
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    return { from: dayKey(start), to: dayKey(end) };
  }

  if (preset === 'thisMonth') {
    const start = new Date(today.getFullYear(), today.getMonth(), 1);
    const end = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    return { from: dayKey(start), to: dayKey(end) };
  }

  if (preset === 'lastMonth') {
    const firstThisMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    const lastMonthEnd = new Date(firstThisMonth.getTime() - 24 * 3600 * 1000);
    const lastMonthStart = new Date(lastMonthEnd.getFullYear(), lastMonthEnd.getMonth(), 1);
    return { from: dayKey(lastMonthStart), to: dayKey(lastMonthEnd) };
  }

  if (preset === 'thisYear') {
    return { from: `${today.getFullYear()}-01-01`, to: `${today.getFullYear()}-12-31` };
  }

  return { from: todayKey, to: todayKey };
}

/* Reusable calendar widget: a month grid with click-to-select single day or drag-free
   two-click range, used by both the Log tab and the Achievement tab. */
function createCalendarWidget(opts) {
  let viewMonth = new Date();
  let selectStart = null;

  function render() {
    const from = opts.getFrom();
    const to = opts.getTo();
    const year = viewMonth.getFullYear();
    const month = viewMonth.getMonth();
    document.getElementById(opts.monthLabelId).textContent = viewMonth.toLocaleDateString([], {
      month: 'long',
      year: 'numeric',
    });

    const firstOfMonth = new Date(year, month, 1);
    const startOffset = (firstOfMonth.getDay() + 6) % 7; // Monday-start offset
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const todayKey = dayKey(new Date());

    const cells = [];
    for (let i = 0; i < startOffset; i++) cells.push('<span class="cal-cell empty"></span>');
    for (let d = 1; d <= daysInMonth; d++) {
      const key = dayKey(new Date(year, month, d));
      const classes = ['cal-cell'];
      if (key >= from && key <= to) classes.push('in-range');
      if (key === from) classes.push('range-start');
      if (key === to) classes.push('range-end');
      if (key === todayKey) classes.push('is-today');
      cells.push(`<button type="button" class="${classes.join(' ')}" data-date="${key}">${d}</button>`);
    }

    document.getElementById(opts.gridId).innerHTML = cells.join('');
    document.getElementById(opts.rangeLabelId).textContent =
      from === to ? formatDateLabel(from) : `${formatDateLabel(from)} – ${formatDateLabel(to)}`;
  }

  function setup() {
    document.getElementById(opts.prevBtnId).addEventListener('click', () => {
      viewMonth.setMonth(viewMonth.getMonth() - 1);
      render();
    });
    document.getElementById(opts.nextBtnId).addEventListener('click', () => {
      viewMonth.setMonth(viewMonth.getMonth() + 1);
      render();
    });
    document.getElementById(opts.gridId).addEventListener('click', (e) => {
      const cell = e.target.closest('.cal-cell[data-date]');
      if (!cell) return;
      const key = cell.dataset.date;

      if (selectStart === null) {
        selectStart = key;
        opts.setRange(key, key);
      } else {
        opts.setRange(selectStart < key ? selectStart : key, selectStart < key ? key : selectStart);
        selectStart = null;
      }

      opts.clearPreset();
      render();
      opts.onChange();
    });
  }

  function goToMonth(dateKey) {
    viewMonth = new Date(`${dateKey}T00:00:00`);
  }

  return { render, setup, goToMonth };
}

const logCalendar = createCalendarWidget({
  prevBtnId: 'cal-prev-btn',
  nextBtnId: 'cal-next-btn',
  monthLabelId: 'cal-month-label',
  gridId: 'calendar-grid',
  rangeLabelId: 'calendar-range-label',
  getFrom: () => logRangeFrom,
  getTo: () => logRangeTo,
  setRange: (from, to) => {
    logRangeFrom = from;
    logRangeTo = to;
  },
  clearPreset: () => clearActiveLogPreset(),
  onChange: () => renderWorkRecordChart(),
});

function applyLogPreset(preset) {
  const range = computePresetRange(preset, new Date());
  logRangeFrom = range.from;
  logRangeTo = range.to;

  logCalendar.goToMonth(logRangeFrom);
  logCalendar.render();
  renderWorkRecordChart();
}

function clearActiveLogPreset() {
  document.querySelectorAll('.log-range-btn').forEach((b) => b.classList.remove('active'));
}

function setupLogRangeTabs() {
  document.querySelectorAll('.log-range-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      clearActiveLogPreset();
      btn.classList.add('active');
      applyLogPreset(btn.dataset.preset);
    });
  });
}

function setupCalendar() {
  logCalendar.setup();
}

function renderWorkRecordChart() {
  const points = getWorkRecordPoints();
  document.getElementById('time-line-chart').innerHTML = buildLineChartSvg(points);
}

function onSettingsChanged() {
  const unit = document.getElementById('setting-interval-unit').value;
  const raw = clampInt(document.getElementById('setting-interval').value, 1, unit === 'sec' ? 3600 : 60, 1);
  const sec = unit === 'sec' ? raw : raw * 60;
  state.settings.trackingIntervalSec = Math.max(5, Math.min(3600, sec));
  persist();
  activityIntervalMs = state.settings.trackingIntervalSec * 1000;
  applyTrackingInterval();
}

function setupTimeSettingsForm() {
  document.getElementById('setting-interval').addEventListener('change', onSettingsChanged);
  document.getElementById('setting-interval-unit').addEventListener('change', () => {
    const unit = document.getElementById('setting-interval-unit').value;
    const sec = state.settings.trackingIntervalSec || 60;
    document.getElementById('setting-interval').value = unit === 'sec' ? sec : Math.max(1, Math.round(sec / 60));
  });
}

function setupTrayPopupToggle() {
  document.getElementById('tray-popup-toggle').addEventListener('change', (e) => {
    state.settings.trayClickShowsTimePopup = e.target.checked;
    persist();
  });
}

/* Duration/Interval/Repeat count/Sound/Volume apply to every ringing notification,
   not just Alarms-tab alarms — see ringNotification()/fireRingBurst(). */
function setupAlarmSettingsForm() {
  document.getElementById('alarm-setting-duration').addEventListener('change', (e) => {
    state.settings.alarmDurationMin = clampInt(e.target.value, 1, 60, 5);
    e.target.value = state.settings.alarmDurationMin;
    persist();
  });
  document.getElementById('alarm-setting-interval').addEventListener('change', (e) => {
    state.settings.alarmIntervalMin = clampInt(e.target.value, 1, 60, 1);
    e.target.value = state.settings.alarmIntervalMin;
    persist();
  });
  document.getElementById('alarm-setting-repeat').addEventListener('change', (e) => {
    state.settings.alarmRepeatCount = clampInt(e.target.value, 1, 20, 3);
    e.target.value = state.settings.alarmRepeatCount;
    persist();
  });
  document.getElementById('alarm-setting-sound').addEventListener('change', (e) => {
    state.settings.alarmSound = e.target.value;
    persist();
  });

  const volumeInput = document.getElementById('alarm-setting-volume');
  volumeInput.addEventListener('input', () => {
    document.getElementById('alarm-setting-volume-label').textContent = `${volumeInput.value}%`;
  });
  volumeInput.addEventListener('change', (e) => {
    state.settings.alarmVolume = clampInt(e.target.value, 0, 100, 80);
    persist();
  });

  document.getElementById('alarm-setting-test-btn').addEventListener('click', () => {
    const sound = document.getElementById('alarm-sound');
    sound.src = `sounds/${state.settings.alarmSound || 'alarm.wav'}`;
    sound.volume = Math.max(0, Math.min(1, (state.settings.alarmVolume ?? 80) / 100));
    sound.loop = false;
    sound.currentTime = 0;
    sound.play().catch(() => {});
  });
}

/* Every field in this panel already auto-saves on its own 'change' event —
   this button doesn't change that. It exists purely so there's an explicit
   action with visible confirmation, since auto-save alone gives no feedback
   that an edit actually took. Clicking it also forces any focused input to
   blur first (and thus fire its own 'change'), so it can't miss an in-progress
   edit that hasn't committed yet. */
function setupTimeSettingSaveButton() {
  document.getElementById('time-setting-save-btn').addEventListener('click', () => {
    persist();
    document.getElementById('time-setting-save-status').textContent = `Saved at ${new Date().toLocaleTimeString()}`;
  });
}

function renderAlarmSettings() {
  document.getElementById('alarm-setting-duration').value = state.settings.alarmDurationMin || 5;
  document.getElementById('alarm-setting-interval').value = state.settings.alarmIntervalMin || 1;
  document.getElementById('alarm-setting-repeat').value = state.settings.alarmRepeatCount || 3;
  document.getElementById('alarm-setting-sound').value = state.settings.alarmSound || 'alarm.wav';
  const vol = state.settings.alarmVolume ?? 80;
  document.getElementById('alarm-setting-volume').value = vol;
  document.getElementById('alarm-setting-volume-label').textContent = `${vol}%`;
}

/* Older saves only have trackingIntervalMin — migrate it to trackingIntervalSec once. */
function migrateTrackingInterval() {
  if (state.settings.trackingIntervalSec) return;
  const legacyMin = state.settings.trackingIntervalMin || 1;
  state.settings.trackingIntervalSec = legacyMin * 60;
}

function renderTimerSettings() {
  migrateTrackingInterval();
  const sec = state.settings.trackingIntervalSec || 60;
  const useSeconds = sec < 60 || sec % 60 !== 0;
  document.getElementById('setting-interval-unit').value = useSeconds ? 'sec' : 'min';
  document.getElementById('setting-interval').value = useSeconds ? sec : sec / 60;
  activityIntervalMs = sec * 1000;
  document.getElementById('tray-popup-toggle').checked = state.settings.trayClickShowsTimePopup !== false;
}

function renderTimeSection() {
  renderDashboardDay();
  logCalendar.render();
  renderWorkRecordChart();
}

/* ---------- reminders & deadline notifications ---------- */

function checkReminders() {
  const now = Date.now();
  let changed = false;
  state.tasks.forEach((t) => {
    if (!t.completed && t.dueDate && !t.reminded && new Date(t.dueDate).getTime() <= now) {
      ringNotification('Task due', t.title);
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
        dt.type === 'bidGoal' ? `${bidCountForGoal(dt, todayKey)}/${dt.targetCount} bids submitted` : 'not completed';
      ringNotification('Daily goal missed', `${dt.title}: ${status}`);
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

/* Full report across daily tasks, additional tasks, and bids — shared by the
   notification body and the on-screen "Daily Summary" preview, so what you see is
   exactly what gets sent. */
function buildDailySummaryReportText() {
  const todayKey = dayKey(new Date());
  const { overall, dailyPercent, additionalPercent } = computeTodayTotalPercent();

  const lines = [
    `Overall: ${Math.round(overall)}%`,
    `Daily tasks: ${dailyPercent === null ? 'none today' : Math.round(dailyPercent) + '%'}`,
    `Additional tasks: ${additionalPercent === null ? 'none due today' : Math.round(additionalPercent) + '%'}`,
  ];

  const goals = bidGoalsList();
  if (goals.length > 0) {
    const goalText = goals.map((dt) => `${dt.title} ${bidCountForGoal(dt, todayKey)}/${dt.targetCount}`).join(', ');
    lines.push(`Bids: ${goalText}`);
  }

  return lines.join('\n');
}

function renderDailySummaryReport() {
  const todayKey = dayKey(new Date());
  const { overall, dailyPercent, additionalPercent } = computeTodayTotalPercent();

  document.getElementById('summary-overall-rate').textContent = `${Math.round(overall)}%`;
  document.getElementById('summary-daily-rate').textContent = dailyPercent === null ? '—' : `${Math.round(dailyPercent)}%`;
  document.getElementById('summary-additional-rate').textContent =
    additionalPercent === null ? '—' : `${Math.round(additionalPercent)}%`;

  const goals = bidGoalsList();
  const tbody = document.getElementById('summary-goals-body');
  const empty = document.getElementById('summary-goals-empty');
  if (goals.length === 0) {
    tbody.innerHTML = '';
    empty.classList.remove('hidden');
  } else {
    empty.classList.add('hidden');
    tbody.innerHTML = goals
      .map((dt) => {
        const count = bidCountForGoal(dt, todayKey);
        return `
          <tr>
            <td>${escapeHtml(dt.title)}</td>
            <td>${escapeHtml(goalScopeLabel(dt))}</td>
            <td>${count} / ${dt.targetCount}</td>
            <td>${Math.round(dailyTaskPercent(dt, todayKey))}%</td>
          </tr>`;
      })
      .join('');
  }

  document.getElementById('summary-preview-text').textContent = buildDailySummaryReportText();
}

function checkDailySummaryNotification() {
  const time = state.settings.dailySummaryTime;
  if (!time) return;
  const todayKey = dayKey(new Date());
  if (state.settings.dailySummaryNotifiedDate === todayKey) return;
  if (timeStringNow() < time) return;

  ringNotification('Daily summary', buildDailySummaryReportText());
  state.settings.dailySummaryNotifiedDate = todayKey;
  persist();
}

function startReminderLoop() {
  checkReminders();
  checkDailyDeadlines();
  checkDailySummaryNotification();
  checkAlarms();
  setInterval(() => {
    checkReminders();
    checkDailyDeadlines();
    checkDailySummaryNotification();
    checkAlarms();
  }, 30000);
}

/* ---------- daily tasks ---------- */

function bidCountForDate(dateKeyStr) {
  return state.bids.filter((b) => b.date === dateKeyStr).length;
}

function bidCountForGoal(dt, dateKeyStr) {
  const scope = dt.scope || { type: 'overall' };
  return state.bids.filter((b) => {
    if (b.date !== dateKeyStr) return false;
    if (scope.type === 'account') return b.accountId === scope.refId;
    if (scope.type === 'platform') return b.platform === scope.refId;
    return true;
  }).length;
}

function isDailyTaskAchieved(dt, dateKeyStr) {
  if (dt.type === 'bidGoal') {
    return bidCountForGoal(dt, dateKeyStr) >= (dt.targetCount || 0);
  }
  if (dt.type === 'percentage') {
    return dailyTaskPercent(dt, dateKeyStr) >= 100;
  }
  return !!dt.completions[dateKeyStr];
}

/* Exact percentage for a single daily task on a single day — bid goals are the
   real bids-made-today divided by target (uncapped, so over-target shows >100%);
   percentage tasks are a manually-set slider value; checklist tasks are binary
   0/100. Used to average daily-task performance instead of a blunt
   achieved/not-achieved count. */
function dailyTaskPercent(dt, dateKeyStr) {
  if (dt.type === 'bidGoal') {
    const count = bidCountForGoal(dt, dateKeyStr);
    const target = dt.targetCount || 1;
    return (count / target) * 100;
  }
  if (dt.type === 'percentage') {
    return (dt.percentages && dt.percentages[dateKeyStr]) || 0;
  }
  return dt.completions[dateKeyStr] ? 100 : 0;
}

function dueDailyTasks(dateKeyStr) {
  const dayEnd = endOfDay(new Date(`${dateKeyStr}T00:00:00`)).getTime();
  return state.dailyTasks.filter((dt) => new Date(dt.createdAt).getTime() <= dayEnd);
}

/* The averaged daily-task percentage for one day — daily tasks carry high weight,
   so each task's exact percentage (not a binary achieved flag) counts equally into
   the average, giving partial credit for partial progress. */
function computeDailyAveragePercent(dateKeyStr) {
  const due = dueDailyTasks(dateKeyStr);
  if (due.length === 0) return { percent: 0, due: 0 };
  const total = due.reduce((sum, dt) => sum + dailyTaskPercent(dt, dateKeyStr), 0);
  return { percent: total / due.length, due: due.length };
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
        percentages: {},
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

function updateDailyTaskPercentage(id, value) {
  const dt = state.dailyTasks.find((d) => d.id === id);
  if (!dt || dt.type !== 'percentage') return;
  const today = dayKey(new Date());
  if (!dt.percentages) dt.percentages = {};
  dt.percentages[today] = clampInt(value, 0, 100, 0);
  persist();
  refreshTasksExtras();
}

/* interactive controls whether percentage-type tasks get an editable slider/number
   input — that's only appropriate in Task Management (Today's Tasks), not in
   Settings' Daily Task Setting, which just defines the task. */
/* Paints the slider's own track as the fill bar (gradient split at the value) so
   it visually doubles as the progress indicator — no second bar needed. */
function percentageSliderFillStyle(pct) {
  return `background: linear-gradient(to right, var(--accent) ${pct}%, var(--bg-elevated-2) ${pct}%);`;
}

function dailyTaskItemHtml(dt, interactive = true) {
  const today = dayKey(new Date());
  const achieved = isDailyTaskAchieved(dt, today);
  let progressHtml = '';
  let checkboxHtml = '';

  if (dt.type === 'bidGoal') {
    const count = bidCountForGoal(dt, today);
    const exactPct = dailyTaskPercent(dt, today);
    const barPct = Math.min(100, Math.round(exactPct));
    progressHtml = `
      <div class="daily-progress-bar"><div class="daily-progress-fill ${achieved ? 'achieved' : ''}" style="width:${barPct}%"></div></div>
      <div class="task-notes">${count} / ${dt.targetCount} bids today &middot; ${Math.round(exactPct)}%</div>`;
  } else if (dt.type === 'percentage') {
    const pct = Math.round(dailyTaskPercent(dt, today));
    if (interactive) {
      /* The slider itself is the bar — no separate daily-progress-bar here, so
         there's only ever one bar on screen for a percentage task. */
      progressHtml = `
        <div class="task-notes percentage-row">
          <input type="range" class="percentage-slider" min="0" max="100" value="${pct}" data-id="${dt.id}" style="${percentageSliderFillStyle(pct)}" />
          <input type="number" class="percentage-number" min="0" max="100" value="${pct}" data-id="${dt.id}" />
          <span>%</span>
        </div>`;
    } else {
      progressHtml = `
        <div class="daily-progress-bar"><div class="daily-progress-fill ${achieved ? 'achieved' : ''}" style="width:${pct}%"></div></div>
        <div class="task-notes">${pct}% today &middot; set in Today's Tasks</div>`;
    }
  } else {
    checkboxHtml = `<input type="checkbox" class="daily-toggle" ${achieved ? 'checked' : ''} />`;
  }

  const missedDeadline = dt.deadlineTime && !achieved && timeStringNow() >= dt.deadlineTime;
  const deadlineBadge = dt.deadlineTime
    ? `<span class="badge ${missedDeadline ? 'due-overdue' : ''}">Deadline ${dt.deadlineTime}</span>`
    : '';
  const typeLabel = dt.type === 'bidGoal' ? 'Bid goal' : dt.type === 'percentage' ? 'Percentage' : 'Checklist';

  return `
    <li class="task-item ${achieved ? 'completed' : ''}" data-id="${dt.id}">
      ${checkboxHtml}
      <div class="task-main">
        <div class="task-title">${escapeHtml(dt.title)}</div>
        ${progressHtml}
        <div class="task-meta">
          <span class="badge">${typeLabel}</span>
          ${deadlineBadge}
        </div>
      </div>
      <div class="task-actions">
        <button class="small secondary edit-btn">Edit</button>
        <button class="small danger delete-btn">Delete</button>
      </div>
    </li>`;
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
  list.innerHTML = state.dailyTasks.map((dt) => dailyTaskItemHtml(dt, false)).join('');
}

/* Only wired to Today's Tasks' daily list (and the additional-task lists) —
   Settings' Daily Task Setting list renders percentage tasks non-interactively
   (no slider/number to sync). Keeps the range slider and the typed number in
   sync live, persists on commit. sliderClass/numberClass/updateFn let daily and
   additional percentage tasks share this without colliding with each other. */
function setupPercentageSliderEvents(listEl, sliderClass = 'percentage-slider', numberClass = 'percentage-number', updateFn = updateDailyTaskPercentage) {
  listEl.addEventListener('input', (e) => {
    if (e.target.classList.contains(sliderClass)) {
      e.target.setAttribute('style', percentageSliderFillStyle(e.target.value));
      const numberEl = e.target.parentElement.querySelector(`.${numberClass}`);
      if (numberEl) numberEl.value = e.target.value;
    } else if (e.target.classList.contains(numberClass)) {
      const sliderEl = e.target.parentElement.querySelector(`.${sliderClass}`);
      if (sliderEl) {
        sliderEl.value = e.target.value;
        sliderEl.setAttribute('style', percentageSliderFillStyle(e.target.value));
      }
    }
  });
  listEl.addEventListener('change', (e) => {
    if (!e.target.classList.contains(sliderClass) && !e.target.classList.contains(numberClass)) return;
    updateFn(e.target.dataset.id, e.target.value);
  });
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

/* ---------- today's total task management (daily tasks + additional tasks due today, combined) ---------- */

function additionalTasksDueToday() {
  const todayKey = dayKey(new Date());
  return state.tasks.filter((t) => t.dueDate && dayKey(new Date(t.dueDate)) === todayKey);
}

function todayAdditionalItemHtml(t) {
  const achieved = isAdditionalTaskAchieved(t);
  const overdue = !achieved && new Date(t.dueDate).getTime() < Date.now();
  const classes = ['task-item'];
  if (achieved) classes.push('completed');
  if (overdue) classes.push('overdue');
  const timeLabel = new Date(t.dueDate).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const checkboxHtml = t.type === 'manual' ? `<input type="checkbox" class="task-toggle" ${t.completed ? 'checked' : ''} />` : '';

  return `
    <li class="${classes.join(' ')}" data-id="${t.id}">
      ${checkboxHtml}
      <div class="task-main">
        <div class="task-title">${escapeHtml(t.title)}</div>
        ${additionalTaskProgressHtml(t, true)}
        <div class="task-meta">
          <span class="badge ${overdue ? 'due-overdue' : ''}">By ${timeLabel}</span>
          ${achieved ? '<span class="badge status-won">Achieved</span>' : ''}
        </div>
      </div>
      <div class="task-actions">
        <button class="small secondary edit-btn">Edit</button>
        <button class="small danger delete-btn">Delete</button>
      </div>
    </li>`;
}

function renderTodayDailyList() {
  const list = document.getElementById('today-daily-list');
  const empty = document.getElementById('today-daily-empty');
  if (state.dailyTasks.length === 0) {
    list.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');
  list.innerHTML = state.dailyTasks.map((dt) => dailyTaskItemHtml(dt, true)).join('');
}

function renderTodayAdditionalList() {
  const list = document.getElementById('today-additional-list');
  const empty = document.getElementById('today-additional-empty');
  const items = additionalTasksDueToday();
  if (items.length === 0) {
    list.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');
  list.innerHTML = items.map(todayAdditionalItemHtml).join('');
}

/* HIGH/MIDDLE/LOW weight levels, as a 100/50/25 ratio. Daily tasks are always
   weighted HIGH; additional tasks' weight is user-configurable (defaults MIDDLE). */
const WEIGHT_VALUES = { high: 100, middle: 50, low: 25 };

/* Combined today percentage is a WEIGHTED average of two block percentages —
   daily tasks' own average and additional tasks' completion rate — not a flat
   per-item average. Daily tasks generate fresh every day and are always weighted
   High; additional tasks apply only to that day and carry a configurable weight.
   Calculated collectively (one combined number), never as two separate totals. */
function computeTodayTotalPercent() {
  const todayKey = dayKey(new Date());
  const daily = computeDailyAveragePercent(todayKey);

  const additionalDue = additionalTasksDueToday();
  const additionalPercent =
    additionalDue.length > 0 ? additionalDue.reduce((sum, t) => sum + additionalTaskPercent(t), 0) / additionalDue.length : null;

  const dailyWeight = WEIGHT_VALUES.high;
  const additionalWeight = WEIGHT_VALUES[state.settings.additionalTaskWeight || 'middle'];

  let weightedSum = 0;
  let weightTotal = 0;
  if (daily.due > 0) {
    weightedSum += daily.percent * dailyWeight;
    weightTotal += dailyWeight;
  }
  if (additionalPercent !== null) {
    weightedSum += additionalPercent * additionalWeight;
    weightTotal += additionalWeight;
  }
  const overall = weightTotal > 0 ? weightedSum / weightTotal : 0;

  return {
    overall,
    dailyPercent: daily.due > 0 ? daily.percent : null,
    additionalPercent,
  };
}

function renderTodayTotalTaskManagement() {
  renderTodayDailyList();
  renderTodayAdditionalList();

  const { overall, dailyPercent, additionalPercent } = computeTodayTotalPercent();
  document.getElementById('today-total-rate').textContent = `${Math.round(overall)}%`;
  document.getElementById('today-daily-rate').textContent = dailyPercent === null ? '—' : `${Math.round(dailyPercent)}%`;
  document.getElementById('today-additional-rate').textContent =
    additionalPercent === null ? '—' : `${Math.round(additionalPercent)}%`;
}

function setupTodayTaskListEvents() {
  const dailyList = document.getElementById('today-daily-list');
  dailyList.addEventListener('click', (e) => {
    const li = e.target.closest('.task-item');
    if (!li) return;
    const id = li.dataset.id;
    if (e.target.classList.contains('daily-toggle')) {
      toggleDailyCompletion(id);
    } else if (e.target.classList.contains('edit-btn')) {
      goToSubTab('settings', 'tasksetting');
      beginEditDailyTask(id);
    } else if (e.target.classList.contains('delete-btn')) {
      if (confirm('Delete this daily task?')) deleteDailyTask(id);
    }
  });
  setupPercentageSliderEvents(dailyList);

  const todayAdditionalList = document.getElementById('today-additional-list');
  todayAdditionalList.addEventListener('click', (e) => {
    const li = e.target.closest('.task-item');
    if (!li) return;
    const id = li.dataset.id;
    if (e.target.classList.contains('task-toggle')) {
      toggleTaskComplete(id);
    } else if (e.target.classList.contains('edit-btn')) {
      goToSubTab('tasks', 'additional');
      beginEditTask(id);
    } else if (e.target.classList.contains('delete-btn')) {
      if (confirm('Delete this task? This cannot be undone.')) deleteTask(id);
    }
  });
  setupPercentageSliderEvents(todayAdditionalList, 'additional-percentage-slider', 'additional-percentage-number', updateAdditionalTaskPercentage);
}

/* ---------- achievements ---------- */

let achvRangeFrom = dayKey(new Date());
let achvRangeTo = dayKey(new Date());

const achvCalendar = createCalendarWidget({
  prevBtnId: 'achv-cal-prev-btn',
  nextBtnId: 'achv-cal-next-btn',
  monthLabelId: 'achv-cal-month-label',
  gridId: 'achv-calendar-grid',
  rangeLabelId: 'achv-calendar-range-label',
  getFrom: () => achvRangeFrom,
  getTo: () => achvRangeTo,
  setRange: (from, to) => {
    achvRangeFrom = from;
    achvRangeTo = to;
  },
  clearPreset: () => clearActiveAchvPreset(),
  onChange: () => renderAchievementView(),
});

function clearActiveAchvPreset() {
  document.querySelectorAll('.achv-range-btn').forEach((b) => b.classList.remove('active'));
}

function applyAchievementPreset(preset) {
  const range = computePresetRange(preset, new Date());
  achvRangeFrom = range.from;
  achvRangeTo = range.to;

  achvCalendar.goToMonth(achvRangeFrom);
  achvCalendar.render();
  renderAchievementView();
}

function setupAchievements() {
  document.querySelectorAll('.achv-range-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      clearActiveAchvPreset();
      btn.classList.add('active');
      applyAchievementPreset(btn.dataset.preset);
    });
  });
}

function setupAchievementCalendar() {
  achvCalendar.setup();
}

/* Achievement rate over a range = average of each day's averaged daily-task
   percentage (an average of averages), consistent with the per-day methodology
   used everywhere else — not a binary achieved/due count. */
function computeAchievement(fromKey, toKey) {
  const cursor = new Date(`${fromKey}T00:00:00`);
  const end = new Date(`${toKey}T00:00:00`);
  let percentSum = 0;
  let dayCount = 0;
  let totalDue = 0;

  while (cursor <= end) {
    const { percent, due } = computeDailyAveragePercent(dayKey(cursor));
    if (due > 0) {
      percentSum += percent;
      dayCount += 1;
      totalDue += due;
    }
    cursor.setDate(cursor.getDate() + 1);
  }

  const rate = dayCount > 0 ? Math.round(percentSum / dayCount) : 0;

  const fromTime = new Date(`${fromKey}T00:00:00`).getTime();
  const toTime = endOfDay(new Date(`${toKey}T00:00:00`)).getTime();
  const additionalCompleted = state.tasks.filter((t) => {
    if (!t.completed || !t.completedAt) return false;
    const ct = new Date(t.completedAt).getTime();
    return ct >= fromTime && ct <= toTime;
  }).length;

  return { due: totalDue, rate, additionalCompleted };
}

function computeAchievementDailyPoints(fromKey, toKey) {
  const points = [];
  const cursor = new Date(`${fromKey}T00:00:00`);
  const end = new Date(`${toKey}T00:00:00`);

  while (cursor <= end) {
    const { percent } = computeDailyAveragePercent(dayKey(cursor));
    points.push({ label: cursor.toLocaleDateString([], { month: 'short', day: 'numeric' }), value: Math.round(percent) });
    cursor.setDate(cursor.getDate() + 1);
  }
  return points;
}

function computeGoalReport(fromKey, toKey) {
  const rangeEnd = new Date(`${toKey}T00:00:00`);

  return state.dailyTasks.map((dt) => {
    let due = 0;
    let percentSum = 0;
    const cursor = new Date(`${fromKey}T00:00:00`);
    while (cursor <= rangeEnd) {
      const dayEnd = endOfDay(cursor).getTime();
      if (new Date(dt.createdAt).getTime() <= dayEnd) {
        due += 1;
        percentSum += dailyTaskPercent(dt, dayKey(cursor));
      }
      cursor.setDate(cursor.getDate() + 1);
    }
    const rate = due > 0 ? Math.round(percentSum / due) : 0;
    return { dt, due, rate };
  });
}

function renderGoalReport() {
  const rows = computeGoalReport(achvRangeFrom, achvRangeTo);
  const tbody = document.getElementById('achv-goal-report-body');
  const empty = document.getElementById('achv-goal-report-empty');

  if (rows.length === 0) {
    tbody.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  tbody.innerHTML = rows
    .map(
      ({ dt, due, rate }) => `
        <tr>
          <td>${escapeHtml(dt.title)}</td>
          <td>${dt.type === 'bidGoal' ? 'Bid goal' : dt.type === 'percentage' ? 'Percentage' : 'Checklist'}</td>
          <td>${due}</td>
          <td>${rate}%</td>
        </tr>`
    )
    .join('');
}

function renderAchievementView() {
  const result = computeAchievement(achvRangeFrom, achvRangeTo);
  document.getElementById('achv-rate').textContent = `${result.rate}%`;
  document.getElementById('achv-additional').textContent = String(result.additionalCompleted);

  const points = computeAchievementDailyPoints(achvRangeFrom, achvRangeTo);
  document.getElementById('achv-line-chart').innerHTML = buildLineChartSvg(points, (v) => `${v}%`, 100);

  renderGoalReport();
}

function refreshTasksExtras() {
  renderDailyTasks();
  achvCalendar.render();
  renderAchievementView();
  renderTodayTotalTaskManagement();
  renderDailySummaryReport();
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
    if (e.target.classList.contains('platform-delete-btn')) {
      if (confirm(`Remove platform "${platform ? platform.name : ''}"? Existing accounts keep their recorded platform.`)) {
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
}

/* ---------- accounts (members you bid as; platform is chosen per-bid, not per-account) ---------- */

function accountLabel(account) {
  return account.memberName;
}

function setupAccountForm() {
  const form = document.getElementById('account-form');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const memberName = document.getElementById('account-member').value.trim();
    if (!memberName) return;
    const country = document.getElementById('account-country').value.trim();
    const notes = document.getElementById('account-notes').value.trim();
    const editingId = document.getElementById('account-editing-id').value;

    if (editingId) {
      const account = state.accounts.find((a) => a.id === editingId);
      if (account) {
        account.memberName = memberName;
        account.country = country;
        account.notes = notes;
      }
    } else {
      state.accounts.push({ id: uid(), memberName, country, notes, createdAt: new Date().toISOString() });
    }

    resetAccountForm();
    persist();
    renderAccounts();
    populateBidAccountSelect();
  });

  document.getElementById('account-cancel-edit').addEventListener('click', resetAccountForm);
}

function resetAccountForm() {
  document.getElementById('account-form').reset();
  document.getElementById('account-editing-id').value = '';
  document.getElementById('account-submit-btn').textContent = 'Add Account';
  document.getElementById('account-cancel-edit').classList.add('hidden');
}

function beginEditAccount(id) {
  const account = state.accounts.find((a) => a.id === id);
  if (!account) return;
  document.getElementById('account-editing-id').value = account.id;
  document.getElementById('account-member').value = account.memberName;
  document.getElementById('account-country').value = account.country || '';
  document.getElementById('account-notes').value = account.notes || '';
  document.getElementById('account-submit-btn').textContent = 'Save Changes';
  document.getElementById('account-cancel-edit').classList.remove('hidden');
  document.getElementById('account-member').focus();
}

function deleteAccount(id) {
  state.accounts = state.accounts.filter((a) => a.id !== id);
  persist();
  renderAccounts();
  populateBidAccountSelect();
}

function renderAccounts() {
  const container = document.getElementById('account-cards');
  const empty = document.getElementById('account-empty');
  if (state.accounts.length === 0) {
    container.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');
  container.innerHTML = state.accounts
    .map(
      (a) => `
        <div class="platform-card" data-id="${a.id}">
          <span class="platform-card-name">${escapeHtml(accountLabel(a))}</span>
          ${a.country ? `<span class="badge">${escapeHtml(a.country)}</span>` : ''}
          <button type="button" class="small quick-add-btn">+ Add Bid</button>
          <button type="button" class="small secondary account-edit-btn">Edit</button>
          <button type="button" class="small danger account-delete-btn">&times;</button>
        </div>`
    )
    .join('');
}

function setupAccountCardEvents() {
  document.getElementById('account-cards').addEventListener('click', (e) => {
    const card = e.target.closest('.platform-card');
    if (!card) return;
    const id = card.dataset.id;
    const account = state.accounts.find((a) => a.id === id);
    if (e.target.classList.contains('quick-add-btn') && account) {
      resetBidForm();
      document.getElementById('bid-account').value = account.id;
      goToSubTab('bids', 'bid');
      document.getElementById('bid-company').focus();
    } else if (e.target.classList.contains('account-edit-btn')) {
      beginEditAccount(id);
    } else if (e.target.classList.contains('account-delete-btn')) {
      if (confirm(`Remove account "${account ? accountLabel(account) : ''}"? Existing bids keep their recorded account info.`)) {
        deleteAccount(id);
      }
    }
  });
}

function populateBidAccountSelect() {
  const select = document.getElementById('bid-account');
  const prev = select.value;
  select.innerHTML =
    '<option value="">Select account</option>' +
    state.accounts.map((a) => `<option value="${a.id}">${escapeHtml(accountLabel(a))}</option>`).join('');
  if (state.accounts.some((a) => a.id === prev)) select.value = prev;

  const filterSelect = document.getElementById('bid-filter-account');
  const prevFilter = filterSelect.value;
  filterSelect.innerHTML =
    '<option value="">All</option>' +
    state.accounts.map((a) => `<option value="${a.id}">${escapeHtml(accountLabel(a))}</option>`).join('');
  if (state.accounts.some((a) => a.id === prevFilter)) filterSelect.value = prevFilter;
}

/* ---------- bid management ---------- */

function setupBidForm() {
  const form = document.getElementById('bid-form');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const company = document.getElementById('bid-company').value.trim();
    if (!company) return;
    const accountId = document.getElementById('bid-account').value || null;
    const account = accountId ? state.accounts.find((a) => a.id === accountId) : null;
    const platform = document.getElementById('bid-platform').value || null;
    let link = document.getElementById('bid-link').value.trim();
    if (link && !/^https?:\/\//i.test(link)) link = 'https://' + link;
    const editingId = document.getElementById('bid-editing-id').value;

    if (editingId) {
      const bid = state.bids.find((b) => b.id === editingId);
      if (bid) {
        bid.company = company;
        bid.accountId = accountId;
        bid.platform = platform;
        bid.memberName = account ? account.memberName : null;
        bid.link = link;
      }
    } else {
      const now = new Date();
      state.bids.push({
        id: uid(),
        company,
        accountId,
        platform,
        memberName: account ? account.memberName : null,
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
  document.getElementById('bid-filter-account').addEventListener('change', renderBidList);
  document.getElementById('bid-filter-status').addEventListener('change', renderBidList);
}

function resetBidForm() {
  document.getElementById('bid-company').value = '';
  document.getElementById('bid-link').value = '';
  document.getElementById('bid-editing-id').value = '';
  document.getElementById('bid-submit-btn').textContent = 'Record Bid';
  document.getElementById('bid-cancel-edit').classList.add('hidden');
}

function beginEditBid(id) {
  const bid = state.bids.find((b) => b.id === id);
  if (!bid) return;
  goToSubTab('bids', 'bid');
  document.getElementById('bid-editing-id').value = bid.id;
  document.getElementById('bid-company').value = bid.company;
  document.getElementById('bid-account').value = bid.accountId || '';
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
  const accountFilter = document.getElementById('bid-filter-account').value;
  const statusFilter = document.getElementById('bid-filter-status').value;

  let bids = state.bids.slice();
  if (accountFilter) bids = bids.filter((b) => b.accountId === accountFilter);
  if (statusFilter === 'approved') bids = bids.filter((b) => b.approved);
  else if (statusFilter === 'pending') bids = bids.filter((b) => !b.approved);

  bids.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return bids;
}

function renderBidList() {
  const tbody = document.getElementById('bid-list-body');
  const empty = document.getElementById('bid-empty');
  const bids = sortedFilteredBids();

  document.getElementById('bid-count').textContent = `${bids.length} shown / ${state.bids.length} total`;

  if (bids.length === 0) {
    tbody.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  tbody.innerHTML = bids
    .map((b) => {
      const timeLabel = new Date(b.createdAt).toLocaleString([], {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
      const linkBtn = b.link
        ? `<button type="button" class="small secondary open-link-btn" data-link="${escapeHtml(b.link)}">Open</button>`
        : '';
      const accountText = [b.memberName, b.platform].filter(Boolean).join(' — ');
      return `
        <tr data-id="${b.id}">
          <td><input type="checkbox" class="bid-approve-toggle" ${b.approved ? 'checked' : ''} title="Approved" /></td>
          <td>${escapeHtml(b.company)}</td>
          <td>${accountText ? escapeHtml(accountText) : '—'}</td>
          <td><span class="badge ${b.approved ? 'status-won' : ''}">${b.approved ? 'Approved' : 'Pending'}</span></td>
          <td>${timeLabel}</td>
          <td>${linkBtn}</td>
          <td class="task-actions">
            <button class="small secondary edit-btn">Edit</button>
            <button class="small danger delete-btn">Delete</button>
          </td>
        </tr>`;
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
  renderAccounts();
  populateBidPlatformSelect();
  populateBidAccountSelect();
  renderBidStats();
  renderBidList();
  renderTodayBidHint();
  populateBidGoalScopeRefSelect();
  renderBidGoalCards();
  document.getElementById('goal-summary-time').value = state.settings.dailySummaryTime || '';
  document.getElementById('additional-weight-select').value = state.settings.additionalTaskWeight || 'middle';
  goalHistCalendar.render();
  populateGoalHistViewRefSelect();
  renderGoalHistory();
  renderDailySummaryReport();
}

function setupBidListEvents() {
  const tbody = document.getElementById('bid-list-body');
  tbody.addEventListener('click', (e) => {
    const row = e.target.closest('tr[data-id]');
    if (!row) return;
    const id = row.dataset.id;
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

/* ---------- daily bid plan (bidGoal daily tasks, surfaced within Bid Management) ---------- */

function bidGoalsList() {
  return state.dailyTasks.filter((d) => d.type === 'bidGoal');
}

function goalScopeLabel(dt) {
  const scope = dt.scope || { type: 'overall' };
  if (scope.type === 'account') {
    const account = state.accounts.find((a) => a.id === scope.refId);
    return account ? accountLabel(account) : 'Account (removed)';
  }
  if (scope.type === 'platform') return scope.refId || 'Platform';
  return 'Overall';
}

function goalCardState(dt, count) {
  const target = dt.targetCount || 1;
  if (count >= target) return 'green';
  if (count > 0) return 'amber';
  return 'red';
}

function populateBidGoalScopeRefSelect() {
  const typeSelect = document.getElementById('bid-goal-scope-type');
  const refSelect = document.getElementById('bid-goal-scope-ref');
  const refField = document.querySelector('.bid-goal-scope-ref-field');
  const type = typeSelect.value;
  refField.classList.toggle('hidden', type === 'overall');

  const prev = refSelect.value;
  if (type === 'account') {
    refSelect.innerHTML = state.accounts.map((a) => `<option value="${a.id}">${escapeHtml(accountLabel(a))}</option>`).join('');
  } else if (type === 'platform') {
    refSelect.innerHTML = state.platforms.map((p) => `<option value="${escapeHtml(p.name)}">${escapeHtml(p.name)}</option>`).join('');
  } else {
    refSelect.innerHTML = '';
  }
  if ([...refSelect.options].some((o) => o.value === prev)) refSelect.value = prev;
}

function setupBidGoalForm() {
  const form = document.getElementById('bid-goal-form');

  document.getElementById('bid-goal-scope-type').addEventListener('change', populateBidGoalScopeRefSelect);

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const title = document.getElementById('bid-goal-title').value.trim();
    if (!title) return;
    const targetCount = clampInt(document.getElementById('bid-goal-target').value, 1, 999, 1);
    const deadlineTime = document.getElementById('bid-goal-deadline').value || null;
    const scopeType = document.getElementById('bid-goal-scope-type').value;
    const scopeRef = document.getElementById('bid-goal-scope-ref').value;
    const scope = scopeType === 'overall' || !scopeRef ? { type: 'overall' } : { type: scopeType, refId: scopeRef };
    const editingId = document.getElementById('bid-goal-editing-id').value;

    if (editingId) {
      const dt = state.dailyTasks.find((d) => d.id === editingId);
      if (dt) {
        dt.title = title;
        dt.targetCount = targetCount;
        dt.deadlineTime = deadlineTime;
        dt.scope = scope;
      }
    } else {
      state.dailyTasks.push({
        id: uid(),
        title,
        type: 'bidGoal',
        targetCount,
        deadlineTime,
        scope,
        createdAt: new Date().toISOString(),
        completions: {},
        notifiedDates: [],
      });
    }

    resetBidGoalForm();
    persist();
    renderBidGoalCards();
    refreshTasksExtras();
  });

  document.getElementById('bid-goal-cancel-edit').addEventListener('click', resetBidGoalForm);
}

function resetBidGoalForm() {
  document.getElementById('bid-goal-form').reset();
  document.getElementById('bid-goal-editing-id').value = '';
  document.getElementById('bid-goal-scope-type').value = 'overall';
  populateBidGoalScopeRefSelect();
  document.getElementById('bid-goal-submit-btn').textContent = 'Add Goal';
  document.getElementById('bid-goal-cancel-edit').classList.add('hidden');
}

function beginEditBidGoal(id) {
  const dt = state.dailyTasks.find((d) => d.id === id);
  if (!dt) return;
  const scope = dt.scope || { type: 'overall' };
  document.getElementById('bid-goal-editing-id').value = dt.id;
  document.getElementById('bid-goal-title').value = dt.title;
  document.getElementById('bid-goal-target').value = dt.targetCount || '';
  document.getElementById('bid-goal-deadline').value = dt.deadlineTime || '';
  document.getElementById('bid-goal-scope-type').value = scope.type;
  populateBidGoalScopeRefSelect();
  document.getElementById('bid-goal-scope-ref').value = scope.refId || '';
  document.getElementById('bid-goal-submit-btn').textContent = 'Save Changes';
  document.getElementById('bid-goal-cancel-edit').classList.remove('hidden');
  document.getElementById('bid-goal-title').focus();
}

function renderBidGoalCards() {
  const container = document.getElementById('bid-goal-cards');
  const empty = document.getElementById('bid-goal-empty');
  const goals = bidGoalsList();

  if (goals.length === 0) {
    container.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  const today = dayKey(new Date());
  container.innerHTML = goals
    .map((dt) => {
      const count = bidCountForGoal(dt, today);
      const exactPct = dailyTaskPercent(dt, today);
      const cardState = goalCardState(dt, count);
      const missedDeadline = dt.deadlineTime && count < (dt.targetCount || 0) && timeStringNow() >= dt.deadlineTime;
      const deadlineBadge = dt.deadlineTime
        ? `<span class="badge ${missedDeadline ? 'due-overdue' : ''}">Deadline ${dt.deadlineTime}</span>`
        : '';
      return `
        <div class="goal-card state-${cardState}" data-id="${dt.id}">
          <div class="goal-card-title">${escapeHtml(dt.title)}</div>
          <span class="badge">${escapeHtml(goalScopeLabel(dt))}</span>
          <div class="goal-card-fraction state-${cardState}">${Math.round(exactPct)}%</div>
          <div class="goal-card-meta"><span class="badge">${count} / ${dt.targetCount} bids today</span>${deadlineBadge}</div>
          <div class="goal-card-actions">
            <button type="button" class="small secondary edit-btn">Edit</button>
            <button type="button" class="small danger delete-btn">Delete</button>
          </div>
        </div>`;
    })
    .join('');
}

function setupBidGoalListEvents() {
  const list = document.getElementById('bid-goal-cards');
  list.addEventListener('click', (e) => {
    const card = e.target.closest('.goal-card');
    if (!card) return;
    const id = card.dataset.id;
    if (e.target.classList.contains('edit-btn')) {
      beginEditBidGoal(id);
    } else if (e.target.classList.contains('delete-btn')) {
      if (confirm('Delete this daily bid goal?')) {
        deleteDailyTask(id);
        renderBidGoalCards();
      }
    }
  });
}

function setupGoalSummarySetting() {
  document.getElementById('goal-summary-time').addEventListener('change', (e) => {
    state.settings.dailySummaryTime = e.target.value || null;
    persist();
  });
}

function setupAdditionalWeightSetting() {
  document.getElementById('additional-weight-select').addEventListener('change', (e) => {
    state.settings.additionalTaskWeight = e.target.value;
    persist();
    refreshTasksExtras();
  });
}

/* ---------- goal achievement history (Bid Log) ---------- */

let goalHistRangeFrom = dayKey(new Date());
let goalHistRangeTo = dayKey(new Date());

const goalHistCalendar = createCalendarWidget({
  prevBtnId: 'goalhist-cal-prev-btn',
  nextBtnId: 'goalhist-cal-next-btn',
  monthLabelId: 'goalhist-cal-month-label',
  gridId: 'goalhist-calendar-grid',
  rangeLabelId: 'goalhist-calendar-range-label',
  getFrom: () => goalHistRangeFrom,
  getTo: () => goalHistRangeTo,
  setRange: (from, to) => {
    goalHistRangeFrom = from;
    goalHistRangeTo = to;
  },
  clearPreset: () => clearActiveGoalHistPreset(),
  onChange: () => renderGoalHistory(),
});

function clearActiveGoalHistPreset() {
  document.querySelectorAll('.goalhist-range-btn').forEach((b) => b.classList.remove('active'));
}

function applyGoalHistPreset(preset) {
  const range = computePresetRange(preset, new Date());
  goalHistRangeFrom = range.from;
  goalHistRangeTo = range.to;

  goalHistCalendar.goToMonth(goalHistRangeFrom);
  goalHistCalendar.render();
  renderGoalHistory();
}

function setupGoalHistRangeTabs() {
  document.querySelectorAll('.goalhist-range-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      clearActiveGoalHistPreset();
      btn.classList.add('active');
      applyGoalHistPreset(btn.dataset.preset);
    });
  });
}

function setupGoalHistCalendar() {
  goalHistCalendar.setup();
}

function computeBidGoalDailyPoints(fromKey, toKey) {
  const points = [];
  const cursor = new Date(`${fromKey}T00:00:00`);
  const end = new Date(`${toKey}T00:00:00`);
  const goals = bidGoalsList();

  while (cursor <= end) {
    const key = dayKey(cursor);
    const dayEnd = endOfDay(cursor).getTime();
    const due = goals.filter((dt) => new Date(dt.createdAt).getTime() <= dayEnd);
    const percent = due.length > 0 ? due.reduce((sum, dt) => sum + dailyTaskPercent(dt, key), 0) / due.length : 0;
    points.push({ label: cursor.toLocaleDateString([], { month: 'short', day: 'numeric' }), value: Math.round(percent) });
    cursor.setDate(cursor.getDate() + 1);
  }
  return points;
}

/* Raw bid count per day for a specific account or platform — used by the "View by"
   selector so Bid History is viewable per account/platform even when no bid goal
   is scoped to it. */
function computeBidCountDailyPoints(fromKey, toKey, viewType, viewRef) {
  const points = [];
  const cursor = new Date(`${fromKey}T00:00:00`);
  const end = new Date(`${toKey}T00:00:00`);

  while (cursor <= end) {
    const key = dayKey(cursor);
    const count = state.bids.filter((b) => {
      if (b.date !== key) return false;
      if (viewType === 'account') return b.accountId === viewRef;
      if (viewType === 'platform') return b.platform === viewRef;
      return true;
    }).length;
    points.push({ label: cursor.toLocaleDateString([], { month: 'short', day: 'numeric' }), value: count });
    cursor.setDate(cursor.getDate() + 1);
  }
  return points;
}

function populateGoalHistViewRefSelect() {
  const typeSelect = document.getElementById('goalhist-view-type');
  const refSelect = document.getElementById('goalhist-view-ref');
  const refField = document.querySelector('.goalhist-view-ref-field');
  const type = typeSelect.value;
  refField.classList.toggle('hidden', type === 'overall');

  const prev = refSelect.value;
  if (type === 'account') {
    refSelect.innerHTML = state.accounts.map((a) => `<option value="${a.id}">${escapeHtml(accountLabel(a))}</option>`).join('');
  } else if (type === 'platform') {
    refSelect.innerHTML = state.platforms.map((p) => `<option value="${escapeHtml(p.name)}">${escapeHtml(p.name)}</option>`).join('');
  } else {
    refSelect.innerHTML = '';
  }
  if ([...refSelect.options].some((o) => o.value === prev)) refSelect.value = prev;
}

function setupGoalHistViewSelect() {
  document.getElementById('goalhist-view-type').addEventListener('change', () => {
    populateGoalHistViewRefSelect();
    renderGoalHistory();
  });
  document.getElementById('goalhist-view-ref').addEventListener('change', renderGoalHistory);
}

function renderGoalHistory() {
  const viewType = document.getElementById('goalhist-view-type').value;
  const viewRef = document.getElementById('goalhist-view-ref').value;

  let points;
  if (viewType === 'overall') {
    points = computeBidGoalDailyPoints(goalHistRangeFrom, goalHistRangeTo);
    document.getElementById('goalhist-line-chart').innerHTML = buildLineChartSvg(points, (v) => `${v}%`, 100);
  } else if (viewRef) {
    points = computeBidCountDailyPoints(goalHistRangeFrom, goalHistRangeTo, viewType, viewRef);
    document.getElementById('goalhist-line-chart').innerHTML = buildLineChartSvg(points, (v) => `${v}`, 5);
  } else {
    document.getElementById('goalhist-line-chart').innerHTML = '<p class="empty-state">Select an account or platform.</p>';
  }
}

/* ---------- alarms (Windows-10-alarm-style: time + label + repeat days) ---------- */

const WEEKDAY_LABELS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

function alarmRepeatLabel(alarm) {
  if (!alarm.days || alarm.days.length === 0) return 'Once';
  if (alarm.days.length === 7) return 'Every day';
  return alarm.days
    .slice()
    .sort((a, b) => a - b)
    .map((d) => WEEKDAY_LABELS[d])
    .join(', ');
}

function formatAlarmTime(time) {
  const [h, m] = time.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${pad(m)} ${period}`;
}

let selectedAlarmDays = [];

function setupAlarmDayPicker() {
  document.getElementById('alarm-day-picker').addEventListener('click', (e) => {
    const btn = e.target.closest('.day-toggle');
    if (!btn) return;
    const day = Number(btn.dataset.day);
    btn.classList.toggle('active');
    if (selectedAlarmDays.includes(day)) {
      selectedAlarmDays = selectedAlarmDays.filter((d) => d !== day);
    } else {
      selectedAlarmDays.push(day);
    }
  });
}

function setupAlarmForm() {
  const form = document.getElementById('alarm-form');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const time = document.getElementById('alarm-time').value;
    if (!time) return;
    const label = document.getElementById('alarm-label').value.trim();
    const editingId = document.getElementById('alarm-editing-id').value;
    const days = selectedAlarmDays.slice();

    if (editingId) {
      const alarm = state.alarms.find((a) => a.id === editingId);
      if (alarm) {
        alarm.time = time;
        alarm.label = label;
        alarm.days = days;
      }
    } else {
      state.alarms.push({ id: uid(), time, label, days, enabled: true, lastFiredKey: null });
    }

    resetAlarmForm();
    persist();
    renderAlarms();
  });

  document.getElementById('alarm-cancel-edit').addEventListener('click', resetAlarmForm);
}

function resetAlarmForm() {
  document.getElementById('alarm-form').reset();
  document.getElementById('alarm-editing-id').value = '';
  document.getElementById('alarm-submit-btn').textContent = 'Add Alarm';
  document.getElementById('alarm-cancel-edit').classList.add('hidden');
  selectedAlarmDays = [];
  document.querySelectorAll('.day-toggle').forEach((b) => b.classList.remove('active'));
}

function beginEditAlarm(id) {
  const alarm = state.alarms.find((a) => a.id === id);
  if (!alarm) return;
  document.getElementById('alarm-editing-id').value = alarm.id;
  document.getElementById('alarm-time').value = alarm.time;
  document.getElementById('alarm-label').value = alarm.label || '';
  selectedAlarmDays = (alarm.days || []).slice();
  document.querySelectorAll('.day-toggle').forEach((b) => {
    b.classList.toggle('active', selectedAlarmDays.includes(Number(b.dataset.day)));
  });
  document.getElementById('alarm-submit-btn').textContent = 'Save Changes';
  document.getElementById('alarm-cancel-edit').classList.remove('hidden');
  document.getElementById('alarm-time').focus();
}

function deleteAlarm(id) {
  state.alarms = state.alarms.filter((a) => a.id !== id);
  persist();
  renderAlarms();
}

function toggleAlarmEnabled(id) {
  const alarm = state.alarms.find((a) => a.id === id);
  if (!alarm) return;
  alarm.enabled = !alarm.enabled;
  persist();
  renderAlarms();
}

function renderAlarms() {
  const container = document.getElementById('alarm-cards');
  const empty = document.getElementById('alarm-empty');
  if (state.alarms.length === 0) {
    container.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  const sorted = state.alarms.slice().sort((a, b) => a.time.localeCompare(b.time));
  container.innerHTML = sorted
    .map(
      (a) => `
        <div class="alarm-card ${a.enabled ? '' : 'disabled'}" data-id="${a.id}">
          <div class="alarm-card-top">
            <div>
              <div class="alarm-card-time">${formatAlarmTime(a.time)}</div>
              ${a.label ? `<div class="alarm-card-label">${escapeHtml(a.label)}</div>` : ''}
            </div>
            <label class="switch">
              <input type="checkbox" class="alarm-toggle" ${a.enabled ? 'checked' : ''} />
              <span class="switch-track"></span>
            </label>
          </div>
          <div class="alarm-card-repeat">${escapeHtml(alarmRepeatLabel(a))}</div>
          <div class="alarm-card-actions">
            <button type="button" class="small secondary edit-btn">Edit</button>
            <button type="button" class="small danger delete-btn">Delete</button>
          </div>
        </div>`
    )
    .join('');
}

function setupAlarmCardEvents() {
  document.getElementById('alarm-cards').addEventListener('click', (e) => {
    const card = e.target.closest('.alarm-card');
    if (!card) return;
    const id = card.dataset.id;
    if (e.target.classList.contains('alarm-toggle')) {
      toggleAlarmEnabled(id);
    } else if (e.target.classList.contains('edit-btn')) {
      beginEditAlarm(id);
    } else if (e.target.classList.contains('delete-btn')) {
      if (confirm('Delete this alarm?')) deleteAlarm(id);
    }
  });
}

function checkAlarms() {
  const now = new Date();
  const hhmm = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  const todayKey = dayKey(now);
  const weekday = now.getDay();
  let changed = false;

  state.alarms.forEach((alarm) => {
    if (!alarm.enabled) return;
    if (alarm.time !== hhmm) return;
    const fireKey = `${todayKey}T${hhmm}`;
    if (alarm.lastFiredKey === fireKey) return;
    if (alarm.days && alarm.days.length > 0 && !alarm.days.includes(weekday)) return;

    alarm.lastFiredKey = fireKey;
    changed = true;
    startAlarmRinging(alarm.id);
  });

  if (changed) persist();
}

/* ---------- ringing (shared by real alarms AND every other notification) ----------
   Every notification — alarm, task-due reminder, goal-deadline-missed, daily
   summary, timer-done — rings the same way: ring for Duration, go quiet for
   Interval, ring again, up to Repeat count times, until the user dismisses it.
   A real alarm additionally auto-disables itself on dismiss if it's one-time
   (no repeat days); other notification kinds have no such side effect. */

let ringingItems = []; // { big, small, alarmId }
let ringTimeoutId = null;
let ringBurstsFired = 0;

function playAlarmSound() {
  const sound = document.getElementById('alarm-sound');
  sound.src = `sounds/${state.settings.alarmSound || 'alarm.wav'}`;
  sound.volume = Math.max(0, Math.min(1, (state.settings.alarmVolume ?? 80) / 100));
  sound.loop = true;
  sound.currentTime = 0;
  sound.play().catch(() => {
    /* Autoplay can be blocked before the first user interaction with the page;
       the window is still brought forward and the overlay still shows. */
  });
}

function stopAlarmSound() {
  const sound = document.getElementById('alarm-sound');
  sound.pause();
  sound.currentTime = 0;
}

function fireRingBurst() {
  if (ringingItems.length === 0) return;
  ringBurstsFired += 1;
  playAlarmSound();

  const durationMs = Math.max(1, state.settings.alarmDurationMin || 5) * 60000;
  ringTimeoutId = setTimeout(() => {
    stopAlarmSound();
    if (ringingItems.length === 0) return; // dismissed during the burst

    const repeatCount = Math.max(1, state.settings.alarmRepeatCount || 3);
    if (ringBurstsFired >= repeatCount) {
      // Gave the full repeat cycle a chance without being dismissed — go quiet
      // for this item (overlay/toast/native notification already happened) and
      // move on to the next queued item, if any.
      ringingItems.shift();
      ringBurstsFired = 0;
      renderRingingOverlay();
      if (ringingItems.length > 0) fireRingBurst();
      return;
    }

    const intervalMs = Math.max(1, state.settings.alarmIntervalMin || 1) * 60000;
    ringTimeoutId = setTimeout(fireRingBurst, intervalMs);
  }, durationMs);
}

function pushRingItem(big, small, alarmId) {
  ringingItems.push({ big, small, alarmId: alarmId || null });
  window.api.showWindow();
  renderRingingOverlay();
  if (ringingItems.length === 1) fireRingBurst();
}

function startAlarmRinging(alarmId) {
  const alarm = state.alarms.find((a) => a.id === alarmId);
  if (!alarm) return;
  window.api.notify(alarm.label || 'Alarm', formatAlarmTime(alarm.time));
  pushRingItem(formatAlarmTime(alarm.time), alarm.label || 'Alarm', alarmId);
}

/* Shared by every non-alarm notification source — same ring-until-dismissed
   behavior as a real alarm, plus the existing native OS notification + toast. */
function ringNotification(title, body) {
  window.api.notify(title, body);
  pushRingItem(title, body, null);
}

function renderRingingOverlay() {
  const overlay = document.getElementById('alarm-ringing-overlay');
  if (ringingItems.length === 0) {
    overlay.classList.add('hidden');
    return;
  }
  const item = ringingItems[0];
  overlay.classList.remove('hidden');
  document.getElementById('alarm-ringing-time').textContent = item.big;
  document.getElementById('alarm-ringing-label').textContent = item.small;
  const more = ringingItems.length - 1;
  document.getElementById('alarm-ringing-more').textContent = more > 0 ? `+${more} more waiting` : '';
}

function dismissRinging() {
  const item = ringingItems.shift();
  if (item && item.alarmId) {
    const alarm = state.alarms.find((a) => a.id === item.alarmId);
    if (alarm && (!alarm.days || alarm.days.length === 0)) {
      alarm.enabled = false;
    }
    persist();
    renderAlarms();
  }

  clearTimeout(ringTimeoutId);
  ringBurstsFired = 0;
  stopAlarmSound();
  renderRingingOverlay();
  if (ringingItems.length > 0) fireRingBurst();
}

function setupAlarmRinging() {
  document.getElementById('alarm-dismiss-btn').addEventListener('click', dismissRinging);
}

/* ---------- timer (countdown) ---------- */

let timerRemainingMs = 0;
let timerIntervalId = null;

function formatHMSDisplay(totalMs) {
  const totalSeconds = Math.max(0, Math.round(totalMs / 1000));
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

function renderTimerDisplay() {
  document.getElementById('timer-display').textContent = formatHMSDisplay(timerRemainingMs);
}

function tickTimer() {
  timerRemainingMs -= 250;
  if (timerRemainingMs <= 0) {
    timerRemainingMs = 0;
    renderTimerDisplay();
    stopTimerInterval();
    ringNotification('Timer done', "Time's up.");
    document.getElementById('timer-start-btn').classList.remove('hidden');
    document.getElementById('timer-pause-btn').classList.add('hidden');
    document.getElementById('timer-inputs').classList.remove('hidden');
    return;
  }
  renderTimerDisplay();
}

function stopTimerInterval() {
  if (timerIntervalId) {
    clearInterval(timerIntervalId);
    timerIntervalId = null;
  }
}

function resumeTimerInterval() {
  document.getElementById('timer-inputs').classList.add('hidden');
  document.getElementById('timer-start-btn').classList.add('hidden');
  document.getElementById('timer-pause-btn').classList.remove('hidden');
  stopTimerInterval();
  timerIntervalId = setInterval(tickTimer, 250);
}

function startTimerCountdown(ms) {
  if (ms <= 0) return;
  timerRemainingMs = ms;
  renderTimerDisplay();
  resumeTimerInterval();
}

function setupTimer() {
  document.getElementById('timer-start-btn').addEventListener('click', () => {
    if (timerRemainingMs <= 0) {
      const h = clampInt(document.getElementById('timer-input-h').value, 0, 23, 0);
      const m = clampInt(document.getElementById('timer-input-m').value, 0, 59, 0);
      const s = clampInt(document.getElementById('timer-input-s').value, 0, 59, 0);
      startTimerCountdown((h * 3600 + m * 60 + s) * 1000);
    } else {
      resumeTimerInterval();
    }
  });

  document.getElementById('timer-pause-btn').addEventListener('click', () => {
    stopTimerInterval();
    document.getElementById('timer-start-btn').classList.remove('hidden');
    document.getElementById('timer-pause-btn').classList.add('hidden');
  });

  document.getElementById('timer-reset-btn').addEventListener('click', () => {
    stopTimerInterval();
    timerRemainingMs = 0;
    renderTimerDisplay();
    document.getElementById('timer-inputs').classList.remove('hidden');
    document.getElementById('timer-start-btn').classList.remove('hidden');
    document.getElementById('timer-pause-btn').classList.add('hidden');
  });
}

/* ---------- timer presets (save a duration, start it with one click) ---------- */

function setupTimerPresetForm() {
  document.getElementById('timer-preset-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const labelInput = document.getElementById('timer-preset-label');
    const label = labelInput.value.trim();
    if (!label) return;
    const h = clampInt(document.getElementById('timer-preset-h').value, 0, 23, 0);
    const m = clampInt(document.getElementById('timer-preset-m').value, 0, 59, 0);
    const s = clampInt(document.getElementById('timer-preset-s').value, 0, 59, 0);
    if (h === 0 && m === 0 && s === 0) return;

    state.timerPresets.push({ id: uid(), label, h, m, s });
    persist();
    renderTimerPresets();
    labelInput.value = '';
  });
}

function deleteTimerPreset(id) {
  state.timerPresets = state.timerPresets.filter((p) => p.id !== id);
  persist();
  renderTimerPresets();
}

function setupTimerPresetCardEvents() {
  document.getElementById('timer-preset-cards').addEventListener('click', (e) => {
    const card = e.target.closest('.alarm-card');
    if (!card) return;
    const id = card.dataset.id;
    if (e.target.classList.contains('start-preset-btn')) {
      const preset = state.timerPresets.find((p) => p.id === id);
      if (!preset) return;
      startTimerCountdown((preset.h * 3600 + preset.m * 60 + preset.s) * 1000);
    } else if (e.target.classList.contains('delete-btn')) {
      deleteTimerPreset(id);
    }
  });
}

function renderTimerPresets() {
  const container = document.getElementById('timer-preset-cards');
  const empty = document.getElementById('timer-preset-empty');
  if (state.timerPresets.length === 0) {
    container.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  container.innerHTML = state.timerPresets
    .map((p) => {
      const ms = (p.h * 3600 + p.m * 60 + p.s) * 1000;
      return `
        <div class="alarm-card" data-id="${p.id}">
          <div class="alarm-card-top">
            <div>
              <div class="alarm-card-time">${formatHMSDisplay(ms)}</div>
              <div class="alarm-card-label">${escapeHtml(p.label)}</div>
            </div>
          </div>
          <div class="alarm-card-actions">
            <button type="button" class="small start-preset-btn">Start</button>
            <button type="button" class="small danger delete-btn">Delete</button>
          </div>
        </div>`;
    })
    .join('');
}

/* ---------- stopwatch ---------- */

let stopwatchElapsedMs = 0;
let stopwatchStartTs = null;
let stopwatchIntervalId = null;
let stopwatchLaps = [];

function formatStopwatchDisplay(totalMs) {
  const ms = Math.max(0, totalMs);
  const totalSeconds = Math.floor(ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const tenths = Math.floor((ms % 1000) / 100);
  return `${pad(h)}:${pad(m)}:${pad(s)}.${tenths}`;
}

function currentStopwatchElapsed() {
  return stopwatchStartTs !== null ? stopwatchElapsedMs + (Date.now() - stopwatchStartTs) : stopwatchElapsedMs;
}

function renderStopwatchDisplay() {
  document.getElementById('stopwatch-display').textContent = formatStopwatchDisplay(currentStopwatchElapsed());
}

function renderStopwatchLaps() {
  document.getElementById('stopwatch-laps').innerHTML = stopwatchLaps
    .map(
      (lap, i) => `
        <li class="task-item">
          <div class="task-main"><div class="task-title">Lap ${i + 1}</div></div>
          <div class="task-notes">${formatStopwatchDisplay(lap)}</div>
        </li>`
    )
    .join('');
}

function setupStopwatch() {
  document.getElementById('stopwatch-start-btn').addEventListener('click', () => {
    stopwatchStartTs = Date.now();
    stopwatchIntervalId = setInterval(renderStopwatchDisplay, 100);
    document.getElementById('stopwatch-start-btn').classList.add('hidden');
    document.getElementById('stopwatch-pause-btn').classList.remove('hidden');
  });

  document.getElementById('stopwatch-pause-btn').addEventListener('click', () => {
    stopwatchElapsedMs = currentStopwatchElapsed();
    stopwatchStartTs = null;
    if (stopwatchIntervalId) {
      clearInterval(stopwatchIntervalId);
      stopwatchIntervalId = null;
    }
    renderStopwatchDisplay();
    document.getElementById('stopwatch-start-btn').classList.remove('hidden');
    document.getElementById('stopwatch-pause-btn').classList.add('hidden');
  });

  document.getElementById('stopwatch-lap-btn').addEventListener('click', () => {
    stopwatchLaps.push(currentStopwatchElapsed());
    renderStopwatchLaps();
  });

  document.getElementById('stopwatch-reset-btn').addEventListener('click', () => {
    if (stopwatchIntervalId) {
      clearInterval(stopwatchIntervalId);
      stopwatchIntervalId = null;
    }
    stopwatchElapsedMs = 0;
    stopwatchStartTs = null;
    stopwatchLaps = [];
    renderStopwatchDisplay();
    renderStopwatchLaps();
    document.getElementById('stopwatch-start-btn').classList.remove('hidden');
    document.getElementById('stopwatch-pause-btn').classList.add('hidden');
  });
}

/* ---------- world clock ---------- */

const TIMEZONE_PRESETS = [
  { tz: 'UTC', label: 'UTC' },
  { tz: 'Pacific/Honolulu', label: 'Honolulu' },
  { tz: 'Pacific/Midway', label: 'Midway' },
  { tz: 'America/Anchorage', label: 'Anchorage' },
  { tz: 'America/Los_Angeles', label: 'Los Angeles' },
  { tz: 'America/Vancouver', label: 'Vancouver' },
  { tz: 'America/Tijuana', label: 'Tijuana' },
  { tz: 'America/Phoenix', label: 'Phoenix' },
  { tz: 'America/Denver', label: 'Denver' },
  { tz: 'America/Chicago', label: 'Chicago' },
  { tz: 'America/Mexico_City', label: 'Mexico City' },
  { tz: 'America/Winnipeg', label: 'Winnipeg' },
  { tz: 'America/New_York', label: 'New York' },
  { tz: 'America/Toronto', label: 'Toronto' },
  { tz: 'America/Detroit', label: 'Detroit' },
  { tz: 'America/Bogota', label: 'Bogota' },
  { tz: 'America/Lima', label: 'Lima' },
  { tz: 'America/Halifax', label: 'Halifax' },
  { tz: 'America/Santiago', label: 'Santiago' },
  { tz: 'America/Sao_Paulo', label: 'Sao Paulo' },
  { tz: 'America/Argentina/Buenos_Aires', label: 'Buenos Aires' },
  { tz: 'Atlantic/Azores', label: 'Azores' },
  { tz: 'Europe/London', label: 'London' },
  { tz: 'Europe/Dublin', label: 'Dublin' },
  { tz: 'Europe/Lisbon', label: 'Lisbon' },
  { tz: 'Europe/Paris', label: 'Paris' },
  { tz: 'Europe/Madrid', label: 'Madrid' },
  { tz: 'Europe/Amsterdam', label: 'Amsterdam' },
  { tz: 'Europe/Berlin', label: 'Berlin' },
  { tz: 'Europe/Rome', label: 'Rome' },
  { tz: 'Europe/Zurich', label: 'Zurich' },
  { tz: 'Europe/Stockholm', label: 'Stockholm' },
  { tz: 'Europe/Warsaw', label: 'Warsaw' },
  { tz: 'Europe/Athens', label: 'Athens' },
  { tz: 'Europe/Helsinki', label: 'Helsinki' },
  { tz: 'Europe/Istanbul', label: 'Istanbul' },
  { tz: 'Europe/Moscow', label: 'Moscow' },
  { tz: 'Africa/Casablanca', label: 'Casablanca' },
  { tz: 'Africa/Lagos', label: 'Lagos' },
  { tz: 'Africa/Cairo', label: 'Cairo' },
  { tz: 'Africa/Johannesburg', label: 'Johannesburg' },
  { tz: 'Africa/Nairobi', label: 'Nairobi' },
  { tz: 'Asia/Jerusalem', label: 'Jerusalem' },
  { tz: 'Asia/Riyadh', label: 'Riyadh' },
  { tz: 'Asia/Dubai', label: 'Dubai' },
  { tz: 'Asia/Tehran', label: 'Tehran' },
  { tz: 'Asia/Kabul', label: 'Kabul' },
  { tz: 'Asia/Karachi', label: 'Karachi' },
  { tz: 'Asia/Kolkata', label: 'Mumbai / New Delhi' },
  { tz: 'Asia/Colombo', label: 'Colombo' },
  { tz: 'Asia/Kathmandu', label: 'Kathmandu' },
  { tz: 'Asia/Dhaka', label: 'Dhaka' },
  { tz: 'Asia/Yangon', label: 'Yangon' },
  { tz: 'Asia/Bangkok', label: 'Bangkok' },
  { tz: 'Asia/Jakarta', label: 'Jakarta' },
  { tz: 'Asia/Ho_Chi_Minh', label: 'Ho Chi Minh City' },
  { tz: 'Asia/Singapore', label: 'Singapore' },
  { tz: 'Asia/Kuala_Lumpur', label: 'Kuala Lumpur' },
  { tz: 'Asia/Manila', label: 'Manila' },
  { tz: 'Asia/Shanghai', label: 'Beijing / Shanghai' },
  { tz: 'Asia/Hong_Kong', label: 'Hong Kong' },
  { tz: 'Asia/Taipei', label: 'Taipei' },
  { tz: 'Asia/Tokyo', label: 'Tokyo' },
  { tz: 'Asia/Seoul', label: 'Seoul' },
  { tz: 'Australia/Perth', label: 'Perth' },
  { tz: 'Australia/Adelaide', label: 'Adelaide' },
  { tz: 'Australia/Brisbane', label: 'Brisbane' },
  { tz: 'Australia/Sydney', label: 'Sydney' },
  { tz: 'Australia/Melbourne', label: 'Melbourne' },
  { tz: 'Pacific/Guam', label: 'Guam' },
  { tz: 'Pacific/Auckland', label: 'Auckland' },
  { tz: 'Pacific/Fiji', label: 'Fiji' },
];

function populateWorldClockTzSelect() {
  const datalist = document.getElementById('worldclock-tz-datalist');
  datalist.innerHTML = TIMEZONE_PRESETS.map((p) => `<option value="${escapeHtml(p.label)}"></option>`).join('');
}

function findTimezonePreset(query) {
  const q = query.trim().toLowerCase();
  if (!q) return null;
  return (
    TIMEZONE_PRESETS.find((p) => p.label.toLowerCase() === q) ||
    TIMEZONE_PRESETS.find((p) => p.label.toLowerCase().includes(q)) ||
    null
  );
}

function setupWorldClockForm() {
  document.getElementById('worldclock-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = document.getElementById('worldclock-search');
    const preset = findTimezonePreset(input.value);
    if (!preset) return;
    if (state.worldClocks.some((c) => c.tz === preset.tz)) return;
    state.worldClocks.push({ id: uid(), tz: preset.tz, label: preset.label });
    persist();
    renderWorldClocks();
    input.value = '';
  });
}

function deleteWorldClock(id) {
  state.worldClocks = state.worldClocks.filter((c) => c.id !== id);
  persist();
  renderWorldClocks();
}

function setupWorldClockCardEvents() {
  document.getElementById('worldclock-cards').addEventListener('click', (e) => {
    const card = e.target.closest('.alarm-card');
    if (!card) return;
    if (e.target.classList.contains('delete-btn')) deleteWorldClock(card.dataset.id);
  });
}

function renderWorldClocks() {
  const container = document.getElementById('worldclock-cards');
  const empty = document.getElementById('worldclock-empty');
  if (state.worldClocks.length === 0) {
    container.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  const now = new Date();
  container.innerHTML = state.worldClocks
    .map((c) => {
      let time = '—';
      let dateLabel = '';
      try {
        time = now.toLocaleTimeString([], { timeZone: c.tz, hour: '2-digit', minute: '2-digit', second: '2-digit' });
        dateLabel = now.toLocaleDateString([], { timeZone: c.tz, weekday: 'short', month: 'short', day: 'numeric' });
      } catch (err) {
        /* invalid tz, leave placeholder */
      }
      return `
        <div class="alarm-card" data-id="${c.id}">
          <div class="alarm-card-top">
            <div>
              <div class="alarm-card-time">${time}</div>
              <div class="worldclock-card-tz">${escapeHtml(c.label)}</div>
              <div class="worldclock-card-date">${escapeHtml(dateLabel)}</div>
            </div>
          </div>
          <div class="alarm-card-actions">
            <button type="button" class="small danger delete-btn">Delete</button>
          </div>
        </div>`;
    })
    .join('');
}


/* ---------- init ---------- */

async function init() {
  state = await window.api.loadData();

  setupSidebar();
  setupTaskForm();
  setupTaskListEvents();
  setupDateNav();
  setupTimelineRowSelection();
  setupTimelineZoom();
  setupChartTooltip();
  setupLogRangeTabs();
  setupCalendar();
  setupTimeSettingsForm();
  setupTrayPopupToggle();
  setupAlarmSettingsForm();
  setupTimeSettingSaveButton();
  setupTrackingToggle();
  setupLockStateListener();
  setupDailyTaskForm();
  setupDailyTaskListEvents();
  setupTodayTaskListEvents();
  setupAchievements();
  setupAchievementCalendar();
  setupPlatformForm();
  setupPlatformCardEvents();
  setupAccountForm();
  setupAccountCardEvents();
  setupBidForm();
  setupBidListEvents();
  setupBidGoalForm();
  setupBidGoalListEvents();
  setupGoalSummarySetting();
  setupAdditionalWeightSetting();
  setupGoalHistRangeTabs();
  setupGoalHistCalendar();
  setupGoalHistViewSelect();
  setupAlarmDayPicker();
  setupAlarmForm();
  setupAlarmCardEvents();
  setupAlarmRinging();
  setupTimer();
  setupTimerPresetForm();
  setupTimerPresetCardEvents();
  setupStopwatch();
  populateWorldClockTzSelect();
  setupWorldClockForm();
  setupWorldClockCardEvents();

  renderTimerSettings();
  renderAlarmSettings();

  renderTasks();
  refreshTasksExtras();
  renderBids();
  renderTimeSection();
  renderAlarms();
  renderWorldClocks();
  renderTimerPresets();
  renderDailySummaryReport();
  setInterval(renderWorldClocks, 1000);

  updateTrackingToggleButton();
  if (state.trackingEnabled) {
    startTrackingLoop();
  } else {
    setStatusPill('stopped');
  }

  startReminderLoop();
}

document.addEventListener('DOMContentLoaded', init);
