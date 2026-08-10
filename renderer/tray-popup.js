/* Standalone flyout window (separate BrowserWindow from the main app) — no
   access to app.js's state/helpers, so today's Active/Idle/Locked/Untracked
   totals are recomputed here from the same raw activityLog data via
   window.api.loadData(). Kept intentionally small/self-contained. */

function pad(n) {
  return String(n).padStart(2, '0');
}

function dayKey(d) {
  const x = new Date(d);
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
}

function formatHMS(totalSeconds) {
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${pad(h)}:${pad(m)}:${pad(sec)}`;
}

async function render() {
  const state = await window.api.loadData();
  const now = new Date();
  const todayKey = dayKey(now);
  document.getElementById('tp-date').textContent = now.toLocaleDateString([], {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  });

  const dayStart = new Date(`${todayKey}T00:00:00`).getTime();
  const dayEnd = dayStart + 24 * 3600 * 1000;
  const elapsedMs = Math.min(Date.now(), dayEnd) - dayStart;

  const totals = { active: 0, idle: 0, locked: 0 };
  (state.activityLog || []).forEach((e) => {
    const es = Math.max(new Date(e.start).getTime(), dayStart);
    const ee = Math.min(new Date(e.end).getTime(), dayEnd);
    if (ee > es && e.state in totals) totals[e.state] += (ee - es) / 1000;
  });
  const trackedSum = totals.active + totals.idle + totals.locked;
  const untracked = Math.max(0, elapsedMs / 1000 - trackedSum);

  document.getElementById('tp-active').textContent = formatHMS(totals.active);
  document.getElementById('tp-idle').textContent = formatHMS(totals.idle);
  document.getElementById('tp-locked').textContent = formatHMS(totals.locked);
  document.getElementById('tp-untracked').textContent = formatHMS(untracked);
}

document.getElementById('tp-open-btn').addEventListener('click', () => {
  window.api.showWindow();
});

window.api.onTrayPopupRefresh(render);
render();
