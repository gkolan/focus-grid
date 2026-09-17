# Focus

## What it does

Focus answers "what should I do right now?" with one task. It shows the task,
a short list of reasons, and five actions. It is the default view on phones
and the second tab on desktop.

## How it chooses

1. **Only actionable tasks qualify.** A task is excluded if it is blocked,
   completed, archived, deferred (start date in the future), flagged *needs
   review* (overdue by more than a week), skipped this session, or outside the
   current context filter.
2. **The rest are ranked by score** — a fixed calculation from the same
   urgency and importance the Grid shows, with the earlier deadline, then the
   older task, then the task ID breaking ties. Same tasks, same clock, same
   order, every time.
3. **The top one is recommended** and marked **Up next** in the task list.

The score is *only* a ranking. Focus never claims there is enough time to
finish the task.

## The screen

Left (or top, on a phone): every actionable task grouped by quadrant — Do now,
Schedule, Delegate, Ignore — with context, remaining effort, deadline, and time
spent. Click any row to look at it instead of the recommendation.

Right: the selected task with

- a mini-grid showing where it sits,
- deadline and time spent,
- a **Why now** list — for example *High importance · Critical urgency · The
  deadline has passed. · About 15 minute(s) of work remain.* — built from the
  same numbers as the position,
- **Why here?**, which expands the exact urgency and importance values.

## Actions

| Button | What happens |
| --- | --- |
| **Start** / **Resume** / **Pause** | Runs a timer on this task. Starting one task pauses any other. Paused minutes are saved on the task as *time spent*. |
| **Complete** | Marks the task done (progress 100 %) and moves to the next recommendation. |
| **Skip** | Hides the task from Focus for this browser session only. It stays on the Grid and in the Inbox. Reload and it is back. |
| **Blocked** | Sets the task's status to Blocked. It leaves Focus until you unblock it from the Inbox or task dialog. |
| **Reschedule** | Opens the task dialog so you can change the deadline. |

When you have started a task, Focus keeps showing it even if a different
task's score overtakes it. A banner says *Recommendations updated* with a
**Show the new top task** link — the choice to switch is yours.

## Empty states

| Message | Why | Button |
| --- | --- | --- |
| Nothing actionable right now. | No tasks, or every task is blocked, deferred, or needs review. | **Review tasks** → Inbox |
| You've reviewed every available task for this session. | Everything was skipped. | **Reset skipped tasks** |
| No tasks match this focus grid. | The context filter excludes everything. | **Review tasks** |

## Worked example

In demo mode (`/?demo=1`) Focus recommends *Refill prescription*: high
importance, an hour overdue, 20 minutes of work — small enough to finish now,
which the score rewards slightly. *Fix checkout outage* (due in an hour, 90
minutes of work) ranks just below it. Press **Skip** and the recommendation
moves to the next score. Press **Reset skipped tasks** when the list runs
out, or reload the page, and *Refill prescription* returns.

Press **Start**; the clock icon appears on the row and time spent counts up.
Switch to the Grid and back — the timer is still running. **Pause** banks the
minutes on the task; you can see them in the Inbox and the task's History.

## What can go wrong

| Problem | What it means | What to do |
| --- | --- | --- |
| The task I expected is not in the list | It is blocked, deferred, overdue > 7 days, skipped, or in another context. | Check the Inbox's **Review** tab and the context filter; unblock or reschedule. |
| The recommendation changed while I was working | Time passed or another task's deadline got closer. | Ignore the banner or click **Show the new top task**. Your started task is never dropped silently. |
| Timer minutes are missing | The tab was closed while the timer was running. | Minutes are banked on **Pause**, **Complete**, **Skip**, or when another task is started. Pause before closing. |

## Limits

- Skips and the running timer live in memory for one tab. A second tab has its
  own Focus session.
- There is no "snooze until"; use **Reschedule** to set a real deadline.
