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
- **2026-08-10 (round 4)**: User cut Counter (unneeded), asked for Timer presets
  (pre-set multiple named durations, start with one click), said the daily summary
  notification doesn't belong under Bid Setting and needs its own subtab with "a
  full report for all works" (not just bid goals), asked to move Daily Task Setting
  + Additional Task Management into a new Settings subtab called "Task Setting",
  and asked for a new daily-task type that tracks a percentage directly. Implemented
  and verified all of it directly — see "Round 4" below.
- **2026-08-10 (round 5)**: User said the task-management math was wrong and
  specified an explicit weighted model (HIGH/MIDDLE/LOW = 100/50/25, daily
  always HIGH, additional configurable), reversed round 4's move of Additional
  Task Management into Settings (it belongs back in Tasks), asked for the
  "Today's Total Task Management" name/title to be shortened, asked for a
  numeric input on percentage tasks and for that input to be removed from
  Settings entirely (Task Management only), asked for the Time Interval
  setting to support seconds, asked for a bigger searchable World Clock list,
  and asked to split Bids back into Bid + Bid Log sub-tabs with Bid Log
  carrying only the graph+calendar (no table) plus a new by-account/by-platform
  view. Implemented and verified all of it directly — see "Round 5" below.
- **2026-08-10 (round 6)**: User asked to move the KPI cards and the bid list
  from Bid Log to the Bid tab, and to turn the bid list from individual cards
  into an actual table — that table has to live in the Bid tab, not Bid Log
  (so Bid Log ends up holding only the Bid History graph+calendar). Pointed out
  percentage-type daily tasks showed two bars (progress bar + slider) and asked
  for one. Asked for the Bid Log chart (and, by the "TIME TAB GRAPH IS SAME"
  note, all line charts) to use a smooth curve instead of straight segments.
  Implemented and verified all of it directly — see "Round 6" below.

## Round 4 (2026-08-10): Timer presets, Task Setting, Daily Summary report, percentage task type

**Removed: Counter.** Deleted entirely — nav subitem, panel, all JS functions
(`setupCounterForm`, `adjustCounter`, `resetCounter`, `deleteCounter`,
`setupCounterCardEvents`, `renderCounters`), CSS, and `counters: []` from
`main.js` defaultData (replaced by `timerPresets: []`).

**New: Timer presets.** Timer subpanel now has a "Presets" section below the
manual H/M/S countdown — save a labeled duration once, then start it with one
click from a card (`state.timerPresets`, persisted). Refactored the countdown
start logic into `startTimerCountdown(ms)` / `resumeTimerInterval()` so both the
manual inputs and presets share the same countdown engine — pressing a preset's
Start button doesn't touch the manual H/M/S inputs at all, just runs the
countdown directly from the preset's duration.

**Sidebar re-shuffle**: Settings group is now four subtabs: **Time Interval**,
**Task Setting** (new — merged Daily Task Setting + Additional Task Management,
moved out of the Tasks group), **Bid Setting** (now *without* the daily summary
notification row), **Daily Summary** (new). Tasks group shrinks to just Today's
Total Task Management + Achievement. `goToSubTab('tasks', 'daily'/'additional')`
calls (from Today's Total Task Management's Edit buttons) updated to
`goToSubTab('settings', 'tasksetting')` since those panels moved.

**New: Daily Summary subtab** (Settings → Daily Summary) — holds the relocated
`#goal-summary-time` notification-time input, plus a genuine on-screen report:
three stat cards (Overall / Daily tasks / Additional tasks, reusing
`computeTodayTotalPercent()`), a "Bid Goals Today" table, and a live
"Notification Preview" that shows the *exact* text the OS notification will send
(`buildDailySummaryReportText()` — one shared function, no drift between what's
previewed and what's sent). `checkDailySummaryNotification()` now sends this full
multi-line report regardless of whether any bid goals exist (previously it
early-returned and skipped the notification entirely if there were zero bid
goals — that gate is gone, since the report covers all work now, not just bids).

**New daily task type: `percentage`.** Alongside Checklist (`manual`) and Bid
goal (`bidGoal`), a task can now be type `percentage` — the user drags a slider
(0–100) to set today's value directly, stored in `dt.percentages[dateKey]`
(mirrors `completions[dateKey]`'s per-day-map shape). `dailyTaskPercent()` and
`isDailyTaskAchieved()` (achieved at ≥100%) both got a branch for it; it slots
into the existing percentage-averaging machinery from Round 3 with no other
changes needed. Slider UI: `input` event live-updates the `%` label without a
full re-render (dragging would fight a re-render otherwise), `change` event
persists via `updateDailyTaskPercentage()` and triggers the normal
`refreshTasksExtras()` cascade. Wired into both places `dailyTaskItemHtml()`
renders (Task Setting's own list, and Today's Total Task Management's mirrored
list) via a shared `setupPercentageSliderEvents(listEl)` helper.

Verified via the Electron/Playwright driver: Counter fully gone from the sidebar;
saved a "Pomodoro" timer preset and confirmed pressing its Start button counted
down from the preset's duration (not the manual inputs); Task Setting shows
Daily Tasks + Additional Tasks merged correctly; created a percentage-type task
("Read a book"), dragged its slider to 65%, confirmed it persisted and fed into
the daily average correctly (hand-verified the math against real data each time);
Daily Summary tab's three stat cards, bid-goals table, and notification preview
all matched the live math; Bid Setting confirmed to no longer show the summary
notification row. Zero console errors. Test artifacts (Pomodoro preset) deleted
after verification — but notably, the real user edited my percentage-type test
task ("Read a book" → renamed to "Github Caller Contact", value pushed to 100%)
*during* this session, confirming they're using the app live in parallel; that
task was left as-is since it's now real user data, not test data.

## Round 5 (2026-08-10): weighted percentages, Bid tab un-merge, seconds interval, richer World Clock

The user pushed back on the round-3/4 "block average" methodology and several
placement decisions. All corrected and verified.

**Weighted percentage math (replaces the flat block average).** New concept:
HIGH/MIDDLE/LOW weight levels on a 100/50/25 ratio (`WEIGHT_VALUES` in app.js).
Daily tasks are **always** weighted HIGH (100) — they regenerate every day and
matter most. Additional tasks apply only to that one day and get a
user-configurable weight (`state.settings.additionalTaskWeight`, default
`middle`), set via a new select in Settings → Daily Summary. `computeTodayTotalPercent()`
now computes `(dailyPercent × 100 + additionalPercent × additionalWeight) /
(100 + additionalWeight)` — calculated collectively as one weighted number, not
two separate totals averaged flatly. Hand-verified against real data repeatedly
(e.g. daily 36%, additional 0%, weight=middle(50) → overall = (36×100+0×50)/150
= 24%; switching weight to High gave (36×100+0×100)/200 = 18% — both matched
the on-screen number exactly).

**Additional Task Management moved back to the Tasks tab** (was wrongly under
Settings → Task Setting as of round 4). Settings' subtab is now just **"Daily
Task Setting"** (renamed from "Task Setting", since it no longer merges
anything) — holds only the Daily Tasks form/list. The Tasks group is back to
three subtabs: Today's Tasks, Achievement, Additional Task Management.

**"Today's Total Task Management" shortened to "Today's Tasks"** everywhere
(nav label, title attribute, panel heading) — same `tasks-sub-today` /
`today-*` ids underneath, only the visible text changed.

**Percentage-type tasks now have a numeric input, not just a slider** — a
`<input type="number">` sits next to the `<input type="range">`, kept in sync
live (dragging updates the number, typing updates the slider position),
committed together on `change` via `updateDailyTaskPercentage()`.

**The percentage input only appears in Task Management, not Settings.**
`dailyTaskItemHtml(dt, interactive)` takes a second parameter now: Today's
Tasks' list renders it `interactive = true` (slider + number, live); Settings →
Daily Task Setting's list renders `interactive = false` (a plain read-only "67%
today · set in Today's Tasks" line, no controls). `setupPercentageSliderEvents`
is wired only to `#today-daily-list`, not `#daily-task-list` anymore.

**Time Interval now supports seconds.** `state.settings.trackingIntervalSec`
replaces `trackingIntervalMin` as the canonical value (Settings → Time Interval
has a value input + a Minutes/Seconds unit select, clamped 5–3600 seconds).
`migrateTrackingInterval()` runs once on render to convert any pre-existing
`trackingIntervalMin` into `trackingIntervalSec` (confirmed against the real
save: the user's existing "1 min" setting correctly showed as "60" seconds /
"1" minute depending on which unit was selected, and converting/restoring
round-tripped correctly).

**World Clock expanded and searchable.** `TIMEZONE_PRESETS` grew from ~22 to
~68 cities across every populated region. The old `<select>` was replaced with
a text input (`#worldclock-search`) backed by a `<datalist>` — type to filter,
`findTimezonePreset()` matches exact-then-partial on the label. Verified adding
"Ho Chi Minh" correctly matched "Ho Chi Minh City" and added it alongside the
user's existing real "Tokyo" clock (left untouched).

**Bids un-merged back into two sub-tabs** ("Bid" and "Bid Log" — this reverses
round 3's merge, which was itself explicitly requested at the time; the user
has now asked for the opposite). Bid Log's history section renamed "Bid
History" and **no longer includes the per-goal table** — only the graph and
the range-tabs/calendar controls, per explicit instruction ("import only the
graph and calendar"). New in its place: a **"View by" selector** (Overall /
Account / Platform). Overall still shows the existing bid-goal daily-percentage
average; Account/Platform show a raw daily bid-count chart
(`computeBidCountDailyPoints`) for the chosen account or platform — this works
even when no bid goal is scoped to that account/platform, since it reads
`state.bids` directly rather than going through goals. `goToTab('bids')` calls
reverted back to `goToSubTab('bids', 'bid')` (Bids is a nav-group again, not a
plain item) — the now-fully-unused `goToTab()` helper was deleted.

Verified end-to-end via the Electron/Playwright driver: sidebar structure
matches exactly; weighted math checked against real data at both weight
settings; percentage number input syncs with the slider and persists; Settings'
Daily Task Setting confirmed read-only for percentage tasks; Time Interval
seconds/minutes round-trips correctly; World Clock search adds the right
timezone; Bid Log's Account/Platform view populates real accounts/platforms and
renders a distinct count-based chart. Zero console errors. Every real-data
value I touched for testing (percentage task value, tracking interval, world
clock list) was restored to what the live user had set before closing.

## Round 6 (2026-08-10): Bid tab gets the KPIs/table, one bar per % task, smooth charts

**Bid tab now owns the KPIs and the full bid history — as a table.** Bid
(`bids-sub-bid`) is now: record form → today-bid-hint → stats-cards (Positions
applied / Approved) → filters (Account/Status) → a real `<table>`
(`#bid-list-body`, columns: approve checkbox, Company, Account, Status, Date,
Link, Edit/Delete) — replacing the old `<ul>` of `.task-item` cards.
`renderBidList()` and `setupBidListEvents()` rewritten for `<tr>` rows instead
of `<li>` cards (event delegation now looks for `tr[data-id]` via
`closest('tr[data-id]')`, everything else — toggle/edit/delete/open-link —
unchanged). Bid Log (`bids-sub-log`) is now *only* the "Bid History" block
(chart, range-tabs, View-by selector, calendar) — no KPIs, no table.

**Percentage tasks show exactly one bar.** The separate `.daily-progress-bar`
div was removed from the interactive rendering path — the range slider itself
is now painted as the bar via an inline `background: linear-gradient(...)`
split at the current value (`percentageSliderFillStyle()`), updated live on
both drag (`input` on `.percentage-slider`) and typing
(`input` on `.percentage-number`). Needed real CSS (`-webkit-appearance: none`
+ a custom `::-webkit-slider-thumb`) since Chromium doesn't let you background
the track fill on a native-styled range input. Non-interactive percentage
rendering (Settings → Daily Task Setting) already only had one bar — untouched.

**All line charts are now smooth curves — one shared function, so they're
automatically consistent everywhere.** Added `buildSmoothLinePath(coords)`
(Catmull-Rom → cubic Bezier, tension 1/6) and swapped it in for the old
straight-segment `M`/`L` join inside `buildLineChartSvg()`. Since Time → Log,
Achievement, and Bid Log's Bid History chart all call the same
`buildLineChartSvg()`, this one change made all three smooth and visually
identical in style — which is what "TIME TAB GRAPH IS SAME" was asking for
(confirmation that Time's chart matches the others, not a request to change it
differently).

Verified via the Electron/Playwright driver against real, live-changing user
data (26 real bids by this point, growing during the session): Bid tab shows
form→KPIs→filters→table in the right order; Bid Log confirmed to hold only the
graph/calendar; the percentage slider now visibly renders as a single filled
bar; the Time Log chart and Bid History chart both showed a visibly curved
(not angular) line through the same kind of dip-then-plateau data shape,
confirming the shared smoothing. Zero console errors.
