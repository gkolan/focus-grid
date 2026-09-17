# Priority engine

## What it does

Turns a task's deadline, estimate, and progress into two numbers between −1 and
+1 — **urgency** and **importance** — and a quadrant label. The same inputs at
the same moment always give the same result. Nothing is random or learned;
the only knobs are the ones you set under Settings → Priority curve.

## Urgency

### With a deadline

Three pressures are combined:

| Pressure | What drives it | Range |
| --- | --- | --- |
| Deadline | Minutes until the deadline. 0 at 14 days out, 0.25 at 7 days, 0.5 at 3 days, 0.8 at 1 day, 1 at the deadline. Smooth between those points. | 0–1 |
| Effort | Remaining estimate (estimate × (1 − progress)) divided by minutes left. A 3-hour task due in 3 hours has effort pressure 1. No estimate means 0. | 0–1 |
| Overdue | Minutes past the deadline, saturating at 24 hours. | 0–1 |

```text
automaticUrgency = 2 × (0.55·deadline + 0.25·effort + 0.20·overdue) − 1
```

So a task nobody has started, with no estimate, sits at −1 when it is two weeks
away, crosses into the right half (urgency ≥ 0) about 11 hours before its
deadline, and reaches +0.5 a day after it is missed.

Properties the tests enforce:

- With fixed inputs, urgency never decreases as time passes.
- Recording progress never *raises* urgency.
- Urgency is capped at +1; there is no "infinite" urgency.

### Without a deadline

Urgency is a fixed base value (−0.6 by default). **An undated task does not
become urgent just by getting old.** If it matters, give it a deadline or pin
its urgency.

## Importance

Importance is whatever you set: Low, Medium (default, 0), or High at creation,
or any value by dragging on the Grid. **Time, deadlines, and progress never
change importance.** Being overdue does not make a task important.

## Pins (overrides)

Dragging a point on the Grid, or choosing an importance at creation, stores a
per-axis override. The effective coordinate is then:

```text
urgency    = urgencyOverride    ?? automaticUrgency
importance = importanceOverride ?? baseImportance
```

Each axis is independent. Pin urgency and importance still follows its base;
pin importance and urgency still evolves with the deadline. **Reset to
automatic** in the task details clears one axis only.

## Quadrants and labels

| Region | Name |
| --- | --- |
| urgency ≥ 0, importance ≥ 0 | **Do now** |
| urgency < 0, importance ≥ 0 | **Schedule** |
| urgency ≥ 0, importance < 0 | **Delegate** |
| urgency < 0, importance < 0 | **Ignore** |

A task exactly at (0, 0) is Do now. The names are descriptive labels for the
region; Delegate does not assign the task to anyone.

Text labels shown next to tasks:

- **Importance:** Low below −⅓, Medium up to ⅓, High from ⅓.
- **Urgency:** Critical at ≥ 0.8, High at ≥ 0.4, otherwise *Rising* if the
  task's urgency has grown by at least 0.05 over the last 24 hours under its
  current settings, otherwise Stable.

Before its deadline a dated task cannot exceed urgency 0.6, so **Critical is
an overdue label** for dated tasks. Due-date text is shown separately and is
the thing to read for "how soon".

## When it recalculates

- On every load and on returning to the tab.
- Every 15 minutes while the app is open (one schedule shared across tabs).
- Immediately when you change a deadline, estimate, progress, or pin.

Returning after a long absence catches up in one pass; a task does not need
to "replay" the days it was closed.

## Derived flags

| Flag | Rule | Effect |
| --- | --- | --- |
| Overdue | now ≥ deadline | Overdue pressure starts rising; shown in the task's date text. |
| Needs review | overdue by more than 7 days | Excluded from Focus; listed under **Review** in the Inbox; nothing is archived for you. |
| Deferred | start date in the future | Excluded from Focus until then; still on the Grid and in the Inbox. |

## What it cannot know

Effort pressure treats every remaining minute as a working minute. The engine
has no calendar, no working hours, and no knowledge of how many tasks you can
actually do today. It is a consistent way to *order* work, not a promise about
whether there is enough time. That limit is deliberate.

## Where the numbers live

Weights (0.55 / 0.25 / 0.20), the 14-day horizon, the 24-hour overdue
saturation, and the 7-day review threshold are the defaults. Settings →
**Priority curve** lets you change the three weights, the overdue saturation
hours, and the needs-review days; **Reset to defaults** restores them.
