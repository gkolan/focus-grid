# Grid

## What it shows

A square field. Left to right is urgency (−1 to +1); bottom to top is
importance (−1 to +1). Two axis lines cross at (0, 0) and divide it into four
quadrants, labelled **Schedule** (top-left), **Do now** (top-right), **Ignore**
(bottom-left), and **Delegate** (bottom-right).

Each task is a label pill; the dot inside it is the marker, coloured by
context and filled as a pie to show progress. Positions come from the
[priority engine](priority-engine.md) — the Grid never computes them itself.

The bar above the field has a time range (**Today** / **Week** / **Month**)
and a category filter (**All categories** or one) shared by the Grid, Focus,
and Calendar. When the field is capped the header says *Showing n of m*.

## How to use it

| Action | Mouse / trackpad | Touch | Keyboard |
| --- | --- | --- | --- |
| Select a task (open details) | Click the point or label | Tap | Tab to the label, Enter or Space |
| Edit a task | Double-click, or **Edit task** in the details panel | Tap, then **Edit task** | Enter on the label, then Tab to **Edit task** |
| Pin urgency and importance | Drag the point and release | Press and drag | Arrow keys nudge a focused pill (Shift for bigger steps) and pin it |
| Move several at once | Shift-click to build a group, then drag any member | — | — |
| Cancel a drag | Escape while dragging | Add a second finger (becomes a pinch) | Escape |
| Zoom | Wheel / trackpad scroll, around the pointer | Pinch | — |
| Pan | Drag on empty field | One-finger drag on empty field | — |

Zoom ranges from 1 (the whole field) to 8. Panning is bounded so the field can
never be scrolled out of reach.

### Details panel

Selecting a task opens a panel showing the title, context, quadrant, urgency
and importance labels, deadline, remaining effort, time spent, and — for each
pinned axis — a **Reset to automatic** button that clears that one pin. With
**Debug** on in Settings the panel also prints the raw pressures, revision, and
engine version.

### Dragging pins *both* axes

A drop saves exactly one urgency override and one importance override at the
release position. The app announces "Urgency and importance pinned." From then
on the point stays where you put it until you reset an axis. If the task was
changed elsewhere while you were dragging (another tab, for example), the drag
is discarded with the message *"This task changed elsewhere — your drag wasn't
saved."*

## Crowded fields

Labels are laid out so they never overlap a point or each other; when a
quadrant runs out of room, labels spill across the divider rather than hide.
Beyond 250 visible tasks the Grid keeps the highest-scoring ones
plus anything selected or recommended, and the header count tells you how many
are shown. **Every task is always reachable** in the Inbox and in the Grid's
accessible list — a crowded field never hides work.

### Side panel

On screens 1024 px and wider, Settings → **Grid side panel** pins a plain
list of the same tasks beside the field. It is off by default so the field gets
the full width. Screen readers get the list regardless of the setting.

## Worked example

Open <http://localhost:3000/?demo=1>. *Fix checkout outage* (due in an hour,
90 minutes of work) sits far right in **Do now**. *Build emergency fund plan*
is the highest point on the field but three days out, so it sits left of the
axis in **Schedule**. *RSVP to team dinner* is due in 30 minutes but marked
unimportant: right of the axis, near the bottom, in **Delegate**. *Try a new playlist*
has no deadline at all and rests in **Ignore** at the default undated urgency.

Drag *RSVP to team dinner* up into the top half and release. It is now pinned;
open its details and you will see **Reset to automatic** on both axes. Reset
importance only, and it drops back to its original height while staying
exactly as far right as you left it.

## What can go wrong

| Problem | What it means | What to do |
| --- | --- | --- |
| A point moved on its own | The heartbeat recalculated urgency as time passed. | Expected. Pin the axis if you disagree with the engine. |
| Drag ends but the point snaps back | The task was modified in another tab during the drag. | Reload the view and drag again. |
| "No tasks on the field." | The category filter or time range excludes everything, or there are no unfinished tasks. | Set the filter to **All categories** or add a task. |
| Labels sit slightly off where you expect | Labels are nudged to avoid overlapping; the dot inside the pill is the true position. | Zoom in. |

## Limits

- Dragging on a real touch device has been verified with synthetic pointer
  events only.
