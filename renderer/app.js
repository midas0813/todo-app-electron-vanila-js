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

function formatDuration(totalSeconds) {
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${pad(m)}m`;
  if (m > 0) return `${m}m ${pad(sec)}s`;
  return `${sec}s`;
}

function formatMinutesShort(totalSeconds) {
  const m = Math.round(totalSeconds / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem ? `${h}h ${rem}m` : `${h}h`;
}

function formatStopwatch(totalSeconds) {
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${pad(h)}:${pad(m)}:${pad(sec)}`;
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
  document.querySelectorAll('.nav-item').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.nav-item').forEach((b) => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');

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
        totalTimeSeconds: 0,
        reminded: false,
      });
    }

    resetTaskForm();
    persist();
    refreshCategoryOptions();
    renderTasks();
    renderTrackerTaskOptions();
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
  if (state.activeTracking && state.activeTracking.taskId === id) {
    stopTracking();
  }
  state.tasks = state.tasks.filter((t) => t.id !== id);
  persist();
  refreshCategoryOptions();
  renderTasks();
  renderTrackerTaskOptions();
  refreshTasksExtras();
}

function toggleTaskComplete(id) {
  const task = state.tasks.find((t) => t.id === id);
  if (!task) return;
  task.completed = !task.completed;
  task.completedAt = task.completed ? new Date().toISOString() : null;
  if (task.completed && state.activeTracking && state.activeTracking.taskId === id) {
    stopTracking();
  }
  persist();
  renderTasks();
  renderTrackerTaskOptions();
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
      const isTracking = !!(state.activeTracking && state.activeTracking.taskId === t.id);
      const isOverdue = !t.completed && t.dueDate && new Date(t.dueDate).getTime() < now;
      const isDueSoon =
        !t.completed && !isOverdue && t.dueDate && new Date(t.dueDate).getTime() - now < 24 * 3600 * 1000;

      let liveSeconds = t.totalTimeSeconds;
      if (isTracking) {
        liveSeconds += (now - new Date(state.activeTracking.startTime).getTime()) / 1000;
      }

      const classes = ['task-item'];
      if (t.completed) classes.push('completed');
      if (isOverdue) classes.push('overdue');
      if (isTracking) classes.push('tracking');

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
              <span class="badge tracked-time">${formatDuration(liveSeconds)}</span>
            </div>
          </div>
          <div class="task-actions">
            <button class="small track-btn ${isTracking ? 'secondary' : ''}" ${t.completed ? 'disabled' : ''}>${
        isTracking ? 'Stop' : 'Track'
      }</button>
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
    } else if (e.target.classList.contains('track-btn')) {
      if (state.activeTracking && state.activeTracking.taskId === id) {
        stopTracking();
      } else {
        startTracking(id);
      }
    }
  });
}

/* ---------- time tracking (manual) ---------- */

let trackingRenderInterval = null;

function startTracking(taskId) {
  if (state.activeTracking) stopTracking();
  state.activeTracking = { taskId: taskId || null, startTime: new Date().toISOString() };
  persist();
  renderTasks();
  updateTrackerButton();
  ensureTrackingTicker();
}

function stopTracking() {
  if (!state.activeTracking) return;
  const { taskId, startTime } = state.activeTracking;
  const durationSeconds = (Date.now() - new Date(startTime).getTime()) / 1000;
  if (durationSeconds > 0) {
    state.sessions.push({
      id: uid(),
      taskId: taskId || null,
      type: 'tracking',
      start: startTime,
      end: new Date().toISOString(),
      durationSeconds,
    });
    if (taskId) {
      const task = state.tasks.find((t) => t.id === taskId);
      if (task) task.totalTimeSeconds += durationSeconds;
    }
  }
  state.activeTracking = null;
  persist();
  renderTasks();
  updateTrackerButton();
  updateTrackerDisplay();
  renderTimeSection();
  clearTrackingTicker();
}

function ensureTrackingTicker() {
  clearTrackingTicker();
  if (state.activeTracking) {
    trackingRenderInterval = setInterval(() => {
      const activeTab = document.querySelector('.tab-panel.active');
      if (activeTab && activeTab.id === 'tab-tasks') renderTasks();
      if (activeTab && activeTab.id === 'tab-time') updateTrackerDisplay();
    }, 1000);
  }
}

function clearTrackingTicker() {
  if (trackingRenderInterval) {
    clearInterval(trackingRenderInterval);
    trackingRenderInterval = null;
  }
}

/* ---------- work session tracker (simple start/stop stopwatch) ---------- */

function setupTracker() {
  document.getElementById('tracker-toggle-btn').addEventListener('click', () => {
    if (state.activeTracking) {
      stopTracking();
    } else {
      const taskId = document.getElementById('tracker-task').value || null;
      startTracking(taskId);
    }
  });

  document.getElementById('setting-idle').addEventListener('change', onSettingsChanged);
}

function onSettingsChanged() {
  state.settings.idleThresholdMin = clampInt(document.getElementById('setting-idle').value, 1, 60, 5);
  persist();
}

function renderTimerSettings() {
  document.getElementById('setting-idle').value = state.settings.idleThresholdMin;
}

function renderTrackerTaskOptions() {
  const select = document.getElementById('tracker-task');
  const prev = select.value;
  const incomplete = state.tasks.filter((t) => !t.completed);
  select.innerHTML =
    '<option value="">No task (general work)</option>' +
    incomplete.map((t) => `<option value="${t.id}">${escapeHtml(t.title)}</option>`).join('');
  if (incomplete.some((t) => t.id === prev)) select.value = prev;
}

function updateTrackerButton() {
  const btn = document.getElementById('tracker-toggle-btn');
  if (state.activeTracking) {
    btn.textContent = 'Stop Tracking';
    btn.classList.add('secondary');
  } else {
    btn.textContent = 'Start Tracking';
    btn.classList.remove('secondary');
  }
}

function updateTrackerDisplay() {
  const display = document.getElementById('tracker-display');
  if (state.activeTracking) {
    const elapsed = (Date.now() - new Date(state.activeTracking.startTime).getTime()) / 1000;
    display.textContent = formatStopwatch(elapsed);
  } else {
    display.textContent = '00:00:00';
  }
}

/* ---------- activity tracking (always-on: active / idle / locked) ---------- */

const ACTIVITY_TICK_MS = 20000;
let activityInterval = null;

function setStatusPill(kind) {
  const pill = document.getElementById('status-pill');
  const text = document.getElementById('status-text');
  const hint = document.getElementById('status-hint');
  pill.classList.remove('active', 'idle', 'locked');
  if (kind === 'active') {
    pill.classList.add('active');
    text.textContent = 'Active';
    hint.textContent = 'Keyboard/mouse activity detected.';
  } else if (kind === 'idle') {
    pill.classList.add('idle');
    text.textContent = 'Idle';
    hint.textContent = `No input for ${state.settings.idleThresholdMin}+ min.`;
  } else if (kind === 'locked') {
    pill.classList.add('locked');
    text.textContent = 'Locked';
    hint.textContent = 'PC is locked.';
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
  const cutoff = Date.now() - 2 * 24 * 3600 * 1000;
  state.activityLog = state.activityLog.filter((e) => new Date(e.end).getTime() >= cutoff);
}

async function activityTick() {
  const thresholdSeconds = (state.settings.idleThresholdMin || 5) * 60;
  const result = await window.api.getIdleState(thresholdSeconds);

  let sampleState;
  if (result.state === 'locked') sampleState = 'locked';
  else if (result.idleSeconds >= thresholdSeconds) sampleState = 'idle';
  else sampleState = 'active';

  setStatusPill(sampleState);
  recordActivitySample(sampleState);
  persist();

  const activePanel = document.querySelector('.tab-panel.active');
  if (activePanel && activePanel.id === 'tab-time') {
    renderTimeline();
    renderDailyChart();
    renderActiveTodayStat();
  }
}

/* ---------- timeline (day view) ---------- */

const TIMELINE_SLOTS = 48; // 30-minute slots across 24h

function renderTimelineRuler() {
  const labels = [];
  for (let h = 0; h <= 24; h += 3) {
    labels.push(`<span>${pad(h % 24)}:00</span>`);
  }
  document.getElementById('timeline-ruler').innerHTML = labels.join('');
}

function renderTimeline() {
  const today = startOfDay(new Date()).getTime();
  const slotMs = (24 * 3600 * 1000) / TIMELINE_SLOTS;
  const now = Date.now();

  const html = [];
  for (let i = 0; i < TIMELINE_SLOTS; i++) {
    const slotStart = today + i * slotMs;
    const slotEnd = slotStart + slotMs;
    let cls = '';
    if (slotStart < now) {
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
      if (hasActive) cls = 'active';
      else if (hasLocked) cls = 'locked';
      else if (hasIdle) cls = 'idle';
    }
    const label = new Date(slotStart).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    html.push(`<div class="timeline-slot ${cls}" title="${label}"></div>`);
  }
  document.getElementById('timeline').innerHTML = html.join('');
}

function renderActiveTodayStat() {
  const todayStart = startOfDay(new Date()).getTime();
  let activeSeconds = 0;
  state.activityLog.forEach((e) => {
    if (e.state !== 'active') return;
    const es = Math.max(new Date(e.start).getTime(), todayStart);
    const ee = new Date(e.end).getTime();
    if (ee > es) activeSeconds += (ee - es) / 1000;
  });
  document.getElementById('stat-active-today').textContent = formatMinutesShort(activeSeconds);
}

/* ---------- stats & charts ---------- */

function renderStatCards() {
  const now = new Date();
  const todayStart = startOfDay(now).getTime();
  const weekStart = todayStart - 6 * 24 * 3600 * 1000;

  let todaySeconds = 0;
  let weekSeconds = 0;

  state.sessions.forEach((s) => {
    const t = new Date(s.start).getTime();
    if (t >= weekStart) weekSeconds += s.durationSeconds;
    if (t >= todayStart) todaySeconds += s.durationSeconds;
  });

  const completedThisWeek = state.tasks.filter(
    (t) => t.completed && t.completedAt && new Date(t.completedAt).getTime() >= weekStart
  ).length;

  document.getElementById('stat-today').textContent = formatMinutesShort(todaySeconds);
  document.getElementById('stat-week').textContent = formatMinutesShort(weekSeconds);
  document.getElementById('stat-completed').textContent = String(completedThisWeek);
}

function renderDailyChart() {
  const todayStart = startOfDay(new Date()).getTime();
  const buckets = new Array(24).fill(0);
  state.sessions.forEach((s) => {
    const t = new Date(s.start).getTime();
    if (t >= todayStart) {
      const hour = new Date(s.start).getHours();
      buckets[hour] += s.durationSeconds;
    }
  });
  const max = Math.max(1, ...buckets);

  const chart = document.getElementById('chart-daily');
  chart.innerHTML = buckets
    .map((secs, h) => {
      const heightPct = secs > 0 ? Math.max(4, Math.round((secs / max) * 100)) : 2;
      return `
        <div class="chart-col">
          <div class="chart-bar" style="height: ${heightPct}%"></div>
          <div class="chart-label">${h % 3 === 0 ? h : ''}</div>
        </div>`;
    })
    .join('');
}

function renderWeeklyChart() {
  const todayStart = startOfDay(new Date()).getTime();
  const perDaySeconds = {};
  const weekStart = todayStart - 6 * 24 * 3600 * 1000;

  state.sessions.forEach((s) => {
    const t = new Date(s.start).getTime();
    if (t >= weekStart) {
      const key = dayKey(s.start);
      perDaySeconds[key] = (perDaySeconds[key] || 0) + s.durationSeconds;
    }
  });

  const days = [];
  for (let i = 6; i >= 0; i--) {
    days.push(new Date(todayStart - i * 24 * 3600 * 1000));
  }
  const maxSeconds = Math.max(1, ...days.map((d) => perDaySeconds[dayKey(d)] || 0));

  const chart = document.getElementById('chart-weekly');
  chart.innerHTML = days
    .map((d) => {
      const secs = perDaySeconds[dayKey(d)] || 0;
      const heightPct = Math.max(2, Math.round((secs / maxSeconds) * 100));
      const label = d.toLocaleDateString([], { weekday: 'short' });
      return `
        <div class="chart-col">
          <div class="chart-value">${secs > 0 ? formatMinutesShort(secs) : ''}</div>
          <div class="chart-bar" style="height: ${heightPct}%"></div>
          <div class="chart-label">${label}</div>
        </div>`;
    })
    .join('');
}

function renderTimeSection() {
  renderStatCards();
  renderActiveTodayStat();
  renderTimeline();
  renderDailyChart();
  renderWeeklyChart();
  renderTrackerTaskOptions();
  updateTrackerButton();
  updateTrackerDisplay();
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
  setupTracker();
  setupDailyTaskForm();
  setupDailyTaskListEvents();
  setupAchievements();
  setupBidSubTabs();
  setupPlatformForm();
  setupPlatformCardEvents();
  setupBidForm();
  setupBidListEvents();

  renderTimerSettings();
  renderTimelineRuler();

  refreshCategoryOptions();
  renderTasks();
  renderAchievements();
  renderBids();
  renderTimeSection();

  if (state.activeTracking) {
    ensureTrackingTicker();
  }

  setStatusPill(null);
  activityInterval = setInterval(activityTick, ACTIVITY_TICK_MS);
  activityTick();

  startReminderLoop();
}

document.addEventListener('DOMContentLoaded', init);
