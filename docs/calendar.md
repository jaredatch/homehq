# The calendar UI

How the calendar area works and why it's built the way it is. Read this before touching anything under `components/calendar/`.

## Two rules everything else leans on

**The wall never sticks.** The display is always on and nobody is there to put it back, so every transient state (month view, the expand toggle, the per-person filter, an open event form) is never persisted and reverts on its own after idle. Each feature has a `display.*ResetSeconds` key (`0` disables). Timers restart on any interaction, so they never fire mid-task. The one thing that does persist is the legend's collapsed/expanded state, in `localStorage`, because that's a layout preference rather than a peek.

**The default wall render is byte-for-byte stable.** A new feature must leave the default week grid pixel-identical for data that doesn't use it. The proof is a normalised 4K DOM diff of the week grid against a database with none of the feature's data. That rule is why month view is a separate component instead of a mode on `CalendarGrid`, and why the filter's "show all" state returns the same `events` array reference rather than a copy. A feature that intentionally changes the default (shared events collapsing two chips into one) names that delta and stays identical everywhere else.

## Week view (`CalendarGrid`, `WeekRow`, `EventItem`)

One `WeekRow` per week, `display.calendarWeeks` of them.

**The band.** Multi-day events lay out as horizontal spanning bars in a band at the top of each week, packed into lanes Google-Calendar style by `computeWeekSegments` in `calendar-utils.ts`. What goes in it is `bandEvents()`: every all-day event, plus any **timed** event that runs past midnight — a bar across the columns is the only thing a week grid can draw that covers two days, so an overnight event has to leave the timed stack to be shown honestly (see [Multi-day timed events](#multi-day-timed-events)). The band is an absolutely positioned overlay across the week. Each day column reserves only the lanes that actually pass through it (`laneByColumn`), using invisible self-sizing spacer bars that the overlay's real bars line up against. A day no bar covers reserves nothing and starts its timed events at the top, so there's no per-week placeholder gap. Timed events render per day below the band. Past events dim to `--cal-past-opacity` (40%) — a whole day once it is behind us, an all-day bar once its entire span is, and, on **today only**, each timed event that has already finished, so the first bright chip in the column is what is next. Today's dimming is per event and restricted to today on purpose: a past day already dims its whole cell, and both together would compound to 16%. It runs off `useMinuteTick` — the same store as the clock, so an event greys out on the tick the clock moves — and off `isFinished()` in `calendar-utils.ts`, shared with the personal board's agenda. All-day events never dim on their own day: a birthday is still true at bedtime. Opacity only, never height: the measurement layer depends on those rows being the size they claim.

**`+N more` cropping.** Rather than assume every event is one row tall, `CalendarGrid` renders a hidden measurement layer (`.cal-measure`) with every day's full, uncropped stack at the real column width and reads each event's actual height. It then greedy-packs each cell, so a cell shows exactly as many events as truly fit. Each cell's available height subtracts only its own column's band reservation, so days under no all-day bar spend the reclaimed room on extra events.

The measuring and the packing arithmetic live in `week-metrics.ts` (`useWeekGridMetrics`, `fitCount`, `bandHeightFor`, `stackHeight`), because a personal board's full-screen week needs exactly the same numbers. What is **not** shared is how the measured height gets spent: the anchor-week policy below is the wall's, and a personal board simply fills one row. Month view's equivalents are in `month-metrics.ts`. Both are unit-tested in `__tests__/grid-metrics.test.ts` — the failure mode is silent and only visible on a real panel.

The measurement layer must stay `overflow: hidden`. Its uncropped stacks are taller than the grid; with overflow visible that spill became scrollable overflow that a focus nudge could scroll the whole grid into, clipping the header. `getBoundingClientRect` is unaffected by clipping. `.app-main` is `overflow: clip` as a backstop.

**Anchor week.** Track heights and cropping follow a strict priority around an anchor week (the current week by default):

1. The anchor week's days on or after today show every event and set the anchor week's track height.
2. Every other week gets an even share of what's left.
3. The anchor week's past days crop last.

Every de-prioritized week keeps a floor of about two rows, so none of them collapses to a sliver. When the anchor wants more height than that leaves, it is capped, and its protected days crop behind `+N more` like any other day rather than being silently clipped by `.cal-week`'s overflow.

This whole policy is `planWallWeeks` in `wall-layout.ts` — a pure function over the measured metrics, unit-tested in `__tests__/wall-layout.test.ts`. It is the wall's alone; sharing it with a personal board is exactly the second set of constraints CLAUDE.md rule 12 warns about.

**Collapsing to one week.** A capped anchor means today and tomorrow are hiding events while a later week holds height it can barely use — at this household's volume that trailing week sits pinned at its two-row floor showing almost nothing. So in the default view the grid drops trailing weeks, from the far end, one at a time, and only while the anchor is still capped. The current week is never the row that goes. With one week left it takes the whole grid rather than a track sized to its content, which would leave dead grid painted underneath.

It is a pure function of the measured metrics and the data, recomputed every render — nothing to persist and nothing to revert, and it un-collapses on its own as soon as the week thins out. This is a deliberate, named change to the default render for data that triggers it; a week that already fits is untouched, which is what the byte-for-byte diff proves.

**Expand next week.** A footer toggle and any `+N more` button in next week move the anchor to next week: it then shows everything while the current week takes the remaining share and crops. Because all of next week is in the future, the same `date >= today` predicate protects the whole row, so the default render is unchanged. A `+N more` in the current week (or the toggle) returns to normal. Reverts after `display.expandResetSeconds`.

The toggle is also the escape hatch when the grid has collapsed: the button stays in the footer whenever `calendarWeeks > 1`, so next week is always one click away even when it is not on screen, and the same timer puts the board back. It reads **Next week ›** then rather than **Expand next week ›** — "expand" is the wrong verb for a week that isn't drawn at all.

## Multi-day timed events

An event running 8pm Tuesday to 4:30am Wednesday used to draw once, on Tuesday, as a chip reading "8pm – 4:30am" — with nothing to say the 4:30am was tomorrow, and nothing at all on Wednesday. `assignEventsToDays` keyed every timed event by its start date alone.

It now draws the way an all-day event does: one bar spanning the days it covers, in the band. The bar carries the times a chip would — the start inline before the title, the end pinned to the far edge, so it sits over the day the event actually finishes on. Drawing a chip on each day instead was rejected: it reads as two separate events and counts twice against `+N more`.

`eventDaySpan()` is the single definition of which days an event touches, and every grid goes through it. An all-day event passes straight through on Google's exclusive end. A timed event's exclusive end is the day _after_ the one it finishes on — unless it finishes at exactly midnight, which keeps 11pm–12am a one-day event. An all-day event outranks a timed one starting the same day for the top lane, since it genuinely is the whole day.

**The trap.** `computeWeekSegments` finds a bar's columns by string-comparing week dates against the event's bounds. All-day events are stored as bare `YYYY-MM-DD`, but a timed event is a full ISO string, and `"2026-09-01" < "2026-09-01T20:00:00-05:00"` is **true** — the date is a prefix of the timestamp. Feed a timed event in raw and the scan walks one column too far, drawing the bar on the wrong day entirely. That is why everything is normalised to date-only bounds before the scan, and why `__tests__/multi-day-events.test.ts` pins it.

**The other trap.** A band bar's height must stay exactly equal to its invisible `.cal-band-spacer`, or the whole absolute overlay drifts off the lanes each day reserved. So a timed bar's extra content is scoped to `--timed` and the end time is absolutely positioned: out-of-flow content and horizontal padding cannot move that height, but a flex row or an inline-block could. Verify by measuring both, not by looking.

## Month view (`CalendarView`, `MonthGrid`, `MonthWeek`, `MonthDayPopover`)

A sit-down view for scrubbing months ahead, e.g. a school email in spring listing fall-break dates. `CalendarView` owns an ephemeral `viewMode` (`week` by default). The footer's **View Month / View Upcoming** buttons switch; only one grid is mounted at a time, so month view always re-enters on the current month. Esc exits. Reverts after `display.monthViewResetSeconds`.

Month view reuses `computeWeekSegments`, `assignEventsToDays`, the colour map, and `EventModal`, but has **no measurement layer by design**: chips are uniform single lines, so `+N more` capacity is arithmetic over a few unit heights read from three hidden sample boxes (`.mon-sample`), in `month-metrics.ts`. If it ever seems to need per-event measuring, the design has drifted. Rows are dynamic (4 to 6, `monthRowCount` in `month-utils.ts`).

**Scale.** `.mon-calendar` sets `font-size: clamp(12px, 1vh, 22px)` and everything inside is in `em`. It is the only opt-out from root `rem` scaling in the app. The month header stays `rem`-based like the rest of the chrome.

**Interactions.** "N more" opens a floating day popover, rendered outside `.mon-grid` so the capacity samples never see it (a long day scrolls inside the popover; the page never scrolls). Clicking any event opens `EventModal` in edit mode. Create via a hover-revealed per-day "+" (a deliberate target, so full days stay addable and nothing opens by accident) or the footer's **+ Add event**, which pre-fills today when viewing the current month and the 1st otherwise. ←/→ page months, T jumps to today. Esc peels one layer at a time: modal, then popover, then the view. An open modal does not hold the auto-revert; its own shorter idle timer closes abandoned forms first.

Writes are gated on `isCalendarWriteEnabled` exactly as in week view. Read-only deployments get an inert month view with a working popover.

## What a personal board borrows (`PersonalWeek`, `PersonalMonth`)

A personal board's **View Week** and **View Month** are full-screen overlays that render `WeekRow` and `MonthWeek` **unchanged**, so there is one definition of what a week and a month look like across every screen in the house. They also share the measuring modules above.

What they do not share is the chrome or the forms. Each owns its own header, paging, and footer, and a tap opens `PersonalEventSheet` rather than `EventModal` — the wall's form assumes a keyboard and a mouse at 27", and a bedroom panel has neither (CLAUDE.md rule 12). "+N more" opens a day list in the board's own row format instead of the wall's floating popover, which is a poor target for a finger at 180px wide. Both views inherit the Upcoming column's person selection, scope writes to her own calendars, and revert to the three columns after `display.viewResetSeconds`.

Sizing overrides live under `.pb-view` in `personal.css`; `calendar.css` and `month.css` are untouched, which is what keeps the wall unmoved by construction.

## Footer (`CalendarFooter`)

One shared component renders the bottom bar in both views so the controls hold identical positions. Its top rule is an inset box-shadow rather than a `border-top`, because a border is part of the box: it would take a pixel off `.cal-weeks` and shift every week track, which is exactly what used to make month view's grid 1px shorter than the wall's back when only it drew the rule. Week view never had a real rule at all — what looked like one was the fractional remainder of `.cal-weeks` showing under the last row, a 0.06 device-pixel hairline that came and went with the viewport height. Left to right: the legend (which is also the filter, with a chevron to collapse it), the view switcher, **+ Add event** (read-write only), and view-specific extras (week view's expand toggle). On the right: the sync indicator and a reload button that calls `window.location.reload()`. The reload button is a no-confirm escape hatch for when the long-lived page gets weird and nobody's on site; it also picks up the latest deploy.

## Per-person filter

Click a name in the legend to isolate that person. The first click solos; further clicks add. Struck-through means hidden. **✕ Show all** clears. State lives in a tiny in-memory store (`calendar-filter.ts`, `useSyncExternalStore`) shared by the footer, both grids, and `CalendarView`, so it carries across the week/month switch but is never persisted. `filterEvents()` returns the same `events` reference when the filter is empty. Selecting every calendar collapses back to "show all". Reverts after `display.filterResetSeconds`. `nextFilter` and `filterEvents` are pure and unit-tested.

## Shared events on the board

Two copies of one event (see [architecture.md](architecture.md#shared-events-and-one-event-shown-twice) for how they're linked) collapse into one chip carrying `groupCalendarIds`. `mergeGroups()` runs after `filterEvents`, which is why filtering to one person renders a shared event in that person's colour for free. Both return the same array reference when there's nothing to do, so an unshared board is byte-identical. Copies edited apart outside HomeHQ simply render separately again.

Paint lives in `event-paint.ts` with every knob a CSS variable in `styles/calendar.css`:

- All-day bar: forward-slash stripes of the two colours. `--cal-stripe` is the period in `em` so it scales; `--cal-stripe-angle` is **135deg** because a gradient angle names the gradient line and the bands run perpendicular to it (45deg draws a backslash).
- Timed event: a tighter banding (`--cal-stripe-accent`) on the ~1px accent sliver. A 50/50 split there reads as one colour.
- Month chip: two whole dots rather than one split circle. A split circle is a muddy blob when the two hues are close.

The all-day fill is the only surface where text sits on the colour, so it gets `.cal-band-label`, a dark scrim, which frees the fill from having to pick one contrast colour for two hues. The scrim must stay `display: inline`: `inline-block` sizes the line box from its own padded height, makes a shared bar taller than its invisible spacer, and drifts the whole band overlay off the lanes each day reserved. Its vertical padding must stay symmetric; re-measure if the band's font-size or line-height changes.

## Event modal (`EventModal`, `CalendarPicker`)

One component for create and edit (`mode`). Fields: title, calendars, date, start/end time or all-day, location, notes. Delete is a named confirm step showing the title and when. The modal closes itself after `display.createFormResetSeconds` idle.

**Calendars.** `CalendarPicker` is a collapsed field showing the chosen calendars as tokens with a ✕, opening into a checkbox list capped at two (`MAX_GROUP_CALENDARS`). It replaced a grid of always-visible pills that grew a row for every calendar added (at eight calendars it was 22% of the modal). Reaching the cap auto-closes the list. The list is portalled to `<body>` as `position: fixed` because `.cal-modal` is `overflow-y: auto`, which clips both axes; it flips above the field when there's no room below. Open state lives in `EventModal`, not the picker, because Esc, a backdrop click, and Enter all have to close the list before doing their usual job. Focus moves to the first row via a callback ref, since the portal mounts one commit after the open flip. An event linked through a Google invite shows a locked picker (a readout with no controls).

**Dates.** All-day events carry a start and an end date so a multi-day span can be set or resized. The end date shown is the inclusive last day; Google's `end.date` is exclusive, so the UI subtracts a day on read and adds one on write. Skip that and every multi-day event silently shifts. One rule governs the pair: if the end equals the start, the end follows the start; otherwise the edges move independently. That's read live off the field values, so a new or single-day event tracks and a multi-day one grows or shrinks. An inverted range blocks Save. A timed event may cross midnight; the grid draws it as a band bar rather than a chip on its start day.

**Width.** The date/start/end row holds three native controls whose widths the browser dictates (about 23.7rem between them), which is why `.cal-modal` is 27rem and nothing in that row may shrink. A squeezed `input[type=date]` doesn't ellipsize, it clips its own value, and `08/12/202` reads as a date but isn't one. Measure before narrowing anything there.

Shared validation for both routes and the form lives in `lib/calendar/event-timing.ts` (`parseTiming`).

## Auto-revert timers at a glance

| State                                      | Key                              | Default |
| ------------------------------------------ | -------------------------------- | ------- |
| Expand next week                           | `display.expandResetSeconds`     | 300 s   |
| Event form open                            | `display.createFormResetSeconds` | 120 s   |
| Month view                                 | `display.monthViewResetSeconds`  | 180 s   |
| Per-person filter                          | `display.filterResetSeconds`     | 300 s   |
| Personal board's full-screen week or month | `display.viewResetSeconds`       | 120 s   |

## Checking a layout change

The wall is a 27" 4K panel driven at device scale factor 2, so a 1920×1080 viewport is the real layout. For anything touching the week grid: take a DOM geometry dump of `.cal-weeks` before and after (every node's `getBoundingClientRect`, normalised), against a database that has no data for the feature you're adding, and diff. Zero differences is the bar. Use screenshots as a sanity check; the diff is the proof.
