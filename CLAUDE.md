# Task Management App

Electron app (main.js + renderer/) for time tracking, daily tasks/achievements, and bid management.

## Conventions
- Sidebar tab/sub-tab groups are always vertical (stacked), never horizontal.

## Spec status (as of 2026-08-10)

All 9 numbered requirements below are now implemented in the (still uncommitted)
working tree. Run `git status` / `git diff` to see exact current code state.

**Sidebar**
1. ✅ Accordion sidebar — only the active section's nav-group expands; the other two
   collapse to just their header row. (This was already working before this round —
   `expandNavGroup()` in `renderer/app.js` handled it.)

**Daily bid goals (Bid Management -> Daily Plan)**
2. ✅ Goals scoped to Overall / a specific Account / a specific Platform, shown as
   cards (title, scope badge, "3 / 5" fraction, green/amber/red left-border state).
   `dt.scope = { type: 'overall' | 'account' | 'platform', refId }` on the daily-task
   record; `bidCountForGoal()` filters bids by that scope.
3. ✅ Per-goal deadline notification — unchanged, still works (now scope-aware via
   `bidCountForGoal`).
4. ✅ Daily summary notification at a settable time-of-day (`#goal-summary-time` in
   Daily Plan, `state.settings.dailySummaryTime`), checked every 30s by
   `checkDailySummaryNotification()`.
5. ✅ Goal-achievement history report in Bid Log ("Goal Achievement History" section,
   now at the **top** of the tab — chart first, table below) — vertical range tabs +
   calendar (same pattern as Log/Achievement) + a daily-rate line chart + a per-goal
   table.

**Account Management**
6. ✅ Country field added (`#account-country`), shown as a badge on account cards.
   (Superseded 2026-08-10: Platform removed from Account entirely — see round 2 below.)

**Bid recording**
7. ✅ Recording a bid no longer resets the Account select — only Company/Link are
   cleared (`resetBidForm()` no longer calls `form.reset()`).

**Achievement tab (Tasks)**
8. ✅ Rebuilt to match the Log tab's pattern exactly: vertical range tabs (Today/
   Yesterday/This Week/Last Week/This Month/Last Month/This Year) + calendar, same
   linking behavior.
9. ✅ Daily achievement-rate chart added, same style as Log; hidden on single-day
   views (only stat cards + table show), shown for multi-day ranges.

Assumptions made when implementing (no answer was given, proceeded per stated
defaults since user said "continue implementation"):
- **#5's "graphical" requirement**: implemented as a daily rate/% line chart, styled
  like the Log/Achievement charts.
- **Log tab's range list**: left as-is (no "This Month" added), since Achievement's
  extra preset was scoped to Achievement only.

Also fixed in passing: **`init()` was crashing on boot** — it called an undefined
`renderAchievements()` (typo/stub from earlier WIP), which silently aborted
everything after it (bids, time tracking, reminders never initialized). Fixed to
call `refreshTasksExtras()`. This was a real, verified bug in the working tree, not
just a design gap — confirmed by launching the app under Electron/Playwright and
watching init() run to completion.

Verified end-to-end via the `run` skill (Electron + Playwright, screenshots) on
2026-08-10: app boots cleanly, Achievement tab range tabs/calendar/chart work,
Daily Plan goal cards + scope selection work, Bid Log's Goal Achievement History
renders, Account Management country badge renders, and bid recording keeps the
Account selected. No console/page errors during the session. Test data created
during verification was deleted afterward — no pollution of the real data.json.

## Round 2 (2026-08-10): platform decoupling, Today's Total Task Management, Alarms

Follow-up requirements from the user, all implemented and verified:

1. ✅ **Bid Log graph moved to the top** — "Goal Achievement History" is now the
   first thing in the Bid Log tab, chart full-width on top, table below it, then
   range-tabs/calendar, then the existing stats/filters/bid-list.
2. ✅ **Platform decoupled from Account** — Account Management no longer has a
   Platform field (`accountLabel()` now returns just the member name). An account is
   just member name + country + notes.
3. ✅ **Platform moved to the Bid form** — recording a bid now has two independent
   selects, Account and Platform (`#bid-platform`, populated by
   `populateBidPlatformSelect()`). `bid.platform` is set directly from that select,
   no longer derived from `account.platform`. Both Account and Platform persist
   across submits (only Company/Link clear) — same behavior as the earlier
   Account-only fix, now covering both fields naturally since `resetBidForm()`
   never touches either select.
4. ✅ **Bid-goal achievement tied visibly to real bid data** — this was already
   correct under the hood (`isDailyTaskAchieved` → `bidCountForGoal` → `state.bids`),
   but the user's complaint ("goal shows 1, achievement 0%") was really about it not
   being *visible* that the numbers come from real bids. Confirmed via the real
   data.json: all existing bids were dated 2026-08-09, so on 2026-08-10 the "0%" was
   mathematically correct (zero bids recorded *today*), just not obviously so. Fixed
   by surfacing the live `count / target` text (e.g. "7 / 200 bids today") directly
   in the new Today's Total Task Management view (see #7), same text the Bid tab's
   own hint uses — no separate/parallel calculation exists anywhere.
5. New feature: **"Today's Total Task Management"** — new Tasks sub-tab, first in
   the group. Shows one combined performance % (`#today-total-rate` /
   `#today-total-fraction`) across Daily Tasks (all of them, via the existing
   `isDailyTaskAchieved`) + Additional Tasks due today (`additionalTasksDueToday()`,
   matched by `dueDate` falling on today's `dayKey`). An additional task counts as
   achieved if completed **by its set due time**
   (`isAdditionalTaskAchievedToday()` — `completed && completedAt <= dueDate`); no
   changes were made to the Additional Task form itself (user said keep it as-is).
   Tasks sub-tab order is now: **Today's Total Task Management → Achievement →
   Additional Task Management → Daily Task Setting** (Daily Task Setting explicitly
   moved to the bottom).
6. New feature: **Alarm tab** — new top-level sidebar entry (plain `.nav-item`, not
   a group, since it's a single view), modeled on Windows 10's Alarms: time, label,
   repeat-by-weekday day-picker (no days = fires once then auto-disables), on/off
   switch, edit/delete. `state.alarms` in `main.js` defaults. Checked every 30s by
   `checkAlarms()` (added to `startReminderLoop`), fires via the existing
   `window.api.notify` — no audio, OS notification only (this app has no bundled
   audio asset; flagged but not blocking).

Verified via the same Electron/Playwright driver: graph-at-top layout, Account form
with no Platform field, Bid form with independent Account+Platform selects (tested
recording a bid — both fields saved correctly and persisted after submit), Today's
Total Task Management showing live bid counts, Tasks sub-tab order, and both
one-time and repeating alarms (confirmed one-time auto-disables after firing,
repeating stays enabled). Zero console errors. All test data (1 test bid, 2 test
alarms) deleted after verification.

Note: while testing, found the real `data.json` now has only 1 account (previously
4) — not caused by this session's code; the user evidently cleaned up duplicate
member/platform account pairs themselves between sessions, which the new model
makes redundant anyway (platform is per-bid now, not per-account).

## Round 3 (2026-08-10): sidebar consolidation, percentage-based achievement, Alarm & Clock suite, Settings tab

Major restructuring, all implemented and verified via the Electron/Playwright driver.

**Sidebar re-shuffle** (final structure, top to bottom):
- **Time** (group): Dashboard, Log. (Settings sub-tab removed — moved out, see below.)
- **Tasks** (group): Today's Total Task Management, Achievement, Additional Task
  Management, Daily Task Setting.
- **Bids** (plain nav-item, no longer a group) — merged Bid + Bid Log into one view:
  record form → today-bid-hint → Goal Achievement History (graph on top, table
  below) → stats/filters/bid-list.
- **Alarm & Clock** (group, was a plain item) — Alarms, Timer, Stopwatch, World
  Clock, Counter.
- **Settings** (new group, at the very bottom, above the pin button) — Time
  Interval (the tracking-interval control, moved out of Time), Bid Setting (merged
  Platforms + Daily Plan + Account Management, moved out of Bid Management).

`goToSubTab(tab, subtab)` clicks a `.nav-subitem`; added a parallel `goToTab(tab)`
that clicks a plain `.nav-item`, since "Bids" no longer has sub-tabs (both
`beginEditBid` and the account card's "+ Add Bid" quick-jump now use `goToTab`).

**Percentage-based achievement math** — replaced binary achieved/due counting with
per-task percentage averaging everywhere daily-task performance is computed:
- `dailyTaskPercent(dt, dateKey)`: bid goals = exact `(bidsToday / target) * 100`,
  uncapped (can exceed 100% on over-performance); checklist tasks = 100 or 0.
- `computeDailyAveragePercent(dateKey)`: averages `dailyTaskPercent` across all due
  daily tasks for that day — this is what makes bid-goal progress (e.g. 7/100 bids)
  show as **7%**, not a flat "not achieved" 0%, which was the user's core complaint.
- `isDailyTaskAchieved` (binary, `count >= target`) is **unchanged** and still used
  for its original threshold-based purposes (deadline-missed notifications, daily
  summary notification, the "completed" checkbox/strikethrough styling) — the new
  percent function is additive, not a replacement of that logic.
- **Today's Total Task Management**: combined % is `average(dailyBlock%,
  additionalBlock%)` — block-level, not item-level — so daily tasks (usually 1-2)
  keep high weight against however many additional tasks are due today. Stat cards
  are now three percentages: Today's overall performance, Daily tasks, Additional
  tasks (the old raw "Achieved / due" fraction card is gone).
- **Achievement tab**: `achv-rate` is now `average of each day's
  computeDailyAveragePercent` across the selected range; the "Achieved / due"
  fraction stat card was removed (didn't map cleanly to the percentage model); the
  per-task report table's "Rate" column is now an average of that task's own daily
  percentages, "Achieved/Due" column renamed to "Days tracked". The chart
  (`achv-line-chart`) is now **always shown**, including single-day ranges (used to
  hide there) — this was an explicit new ask ("add a graph to the achievement tab").
- **Bids tab's Goal Achievement History**: same treatment, scoped to bid goals only
  (`computeBidGoalDailyPoints`, `computeBidGoalReport`).
- Goal cards (Bid Setting → Daily Plan) now show the exact percentage as the big
  number (was the raw fraction); the `count / target` fraction moved to a small
  badge underneath. Traffic-light border color logic unchanged (green ≥100%, amber
  0–100%, red 0).

**New: Timer** (Alarm & Clock → Timer) — H/M/S inputs, Start/Pause/Reset, big
countdown display, fires `window.api.notify` at zero and auto-resets the UI.
Ephemeral (not persisted to disk) — resets on app restart, by design.

**New: Stopwatch** (Alarm & Clock → Stopwatch) — Start/Pause/Lap/Reset, tenths-of-a-
second display, lap list. Also ephemeral.

**New: World Clock** (Alarm & Clock → World Clock) — pick from a curated list of ~22
IANA timezones (`TIMEZONE_PRESETS` in app.js), add/delete clock cards; all cards
re-render every second via a single `setInterval(renderWorldClocks, 1000)` started
in `init()`. Persisted in `state.worldClocks`.

**New: Counter** (Alarm & Clock → Counter) — named tally counters with +/-/reset/
delete. Persisted in `state.counters`.

Both `worldClocks: []` and `counters: []` added to `main.js`'s `defaultData`.

Verified: sidebar structure matches spec exactly (screenshotted every new/moved
tab); Bids merge shows form→hint→graph→table→stats→list in the right order;
Settings→Bid Setting correctly renders Platforms/Daily Plan/Account Management
together (confirmed against real user data — daily summary notification time was
already set to 11:00 PM by the user, 2 real accounts with country badges showed
correctly); percentage math hand-verified against real data (7 bids / target 100 =
7%, averaged with a 0% checklist task = 4% daily, further averaged with 0%
additional = 2% overall — matched exactly on screen); Timer counted down and fired
completion correctly; Stopwatch + lap worked; World Clock showed correct UTC/Tokyo
offset; Counter increment persisted. Zero console/page errors the whole session.
All test data (2 world clocks, 1 counter) deleted after verification — the app's
real data (26 bids, 1 alarm, 2 accounts) was left untouched.

## Session log

Chronological record of what happened, kept here (inside the project folder, not just
in `~/.claude`) so progress isn't lost even if session history elsewhere is gone.

- **2026-08-09**: Resumed a session with no prior context (bare "continue", nothing
  carried over). Reconstructed intent from the uncommitted `git diff` (sidebar nav
  groups, dashboard timeline zoom, configurable tracking interval, lock-screen idle
  fix, new accounts array — see diff for exact code). User then pasted back a prior
  consolidated requirements list (items 1-10 above) plus one new item: the goal-
  achievement history report (#5) must also be viewable graphically. No code changed
  this session — only this file and `~/.claude` memory were created/updated.
- **2026-08-10**: User said "continue implementation" — proceeded without waiting for
  answers to the open questions (per stated defaults/assumptions, logged above).
  Implemented all 9 spec items across `main.js`, `renderer/index.html`,
  `renderer/app.js`, `renderer/styles.css`. Found and fixed a real boot-crash bug in
  `init()` along the way (see "Spec status" above). Verified everything by actually
  launching the Electron app (Playwright driver under xvfb) and clicking through
  Achievement, Daily Plan, Bid Log, and Account Management — all working, zero
  console errors. Everything is still **uncommitted** — nothing has been committed to
  git yet.
- **2026-08-10 (round 2)**: User asked for a list first (no code), gave 8 more
  requirements, then confirmed the ambiguous ones (whole graph section moves to top
  of Bid Log; platform genuinely moves off Account onto the Bid form; "achievement
  in task management" was the real complaint, not the Bid Log report; Today's Total
  Task Management is a brand-new first tab; additional-task achievement = completed
  by its set time, no other field changes; Alarm is a new top-level tab, full
  Windows-10-alarm parity) and said "Now go." Implemented and verified all of it —
  see "Round 2" above. Still uncommitted.
- **2026-08-10 (round 3)**: User asked to merge Bid+Bid Log and Platforms+Daily
  Plan+Account Management into two tabs (naming the merged Bid+Log tab was left to
  me — went with "Bids"; the other was explicitly named "Bid Setting" by the user),
  switch achievement tracking to percentage-based math with daily tasks weighted
  high via per-task-percentage averaging, add a graph to the Achievement tab, turn
  the Alarm tab into a full Alarm & Clock suite (alarms + timer + stopwatch + world
  clock + counter), and add a new bottom-level Settings tab holding the tracking
  interval and Bid Setting. Implemented and verified all of it directly (no
  clarifying questions asked this round) — see "Round 3" above. Still uncommitted;
  the user is actively using the real running app in parallel with these sessions
  (their live data.json keeps changing between turns — bids, accounts, goal
  targets, notification settings), so always treat data.json contents as current
  reality, not something set by prior test sessions.
