# Notifications

## What it does

While the app is open, each 15-minute recalculation checks whether any task
crossed one of three lines. If so, a short, generic message goes to the
in-app feed (the bell in the header) and — only if you granted permission —
to the operating system.

It is **off by default**, never asks for system permission on its own, and
never nags: one notification per event, ever.

## Events

| Event | Fires when |
| --- | --- |
| Deadline passed | A task's deadline went from future to past during this pass. |
| Deadline approaching | Time to deadline crossed from more than 24 hours to 24 hours or less. |
| Moved into Do now | A task's effective position entered the top-right quadrant. |

Each event is remembered per task, deadline, and type. A task that leaves Do now and re-enters does not alert again;
changing the deadline starts a fresh set of keys. When several events are
eligible at once they are ordered deadline-passed, then approaching, then
Do now, then by Focus score.

## Messages

Default text is generic:

- *A task's deadline has passed. Want to review it?*
- *A task is becoming time-sensitive.*
- *A task moved into Do Now.*

Turn on **Include the task title** to append the title. Notes are never
included anywhere.

## Settings

Settings → **Notifications**:

| Control | Effect |
| --- | --- |
| **Show in-app notifications when a task becomes time-sensitive** | Master switch. Off = nothing is recorded or shown. |
| **Enable system notifications** | Asks the browser for permission once, on your click. If denied or unsupported, in-app notifications keep working and the app says so. |
| **Include the task title** | Adds the title to the message. Default off. |
| **Quiet hours** (default 21:00–08:00 in your display zone) | Events inside the window are recorded as suppressed and skipped. They are **never replayed as a burst** afterwards. |

## Coming back after a long absence

If more than four events are eligible in one pass (typical after days away),
you get **one summary** instead of a pile of individual alerts, and the
individual events are marked suppressed.

## The feed

The bell shows a count and opens the last 30 delivered entries, newest first.
Delivery is best effort: a closed browser gets nothing, and there is no promise
about background reminders.

## Worked example

1. Turn on in-app notifications. Add a task due **A day & time** five minutes
   from now.
2. Wait for the deadline to pass and for the next heartbeat (up to 15 minutes;
   switching tabs away and back triggers a pass sooner).
3. The bell shows **1**; the feed reads *A task's deadline has passed. Want to
   review it?*
4. Change the deadline to yesterday. Nothing new fires — the *deadline passed*
   event for the new deadline only fires on a future-to-past
   crossing observed by a pass, and this one was already past when saved.

## What can go wrong

| Problem | What it means | What to do |
| --- | --- | --- |
| No system banner appears | Permission not granted, the OS blocks them, or the browser was closed. | Check the Notifications section: it states the permission state. In-app feed still works. |
| "System notifications are blocked in your browser settings." | You or the browser denied permission earlier. | Re-enable in the browser's site settings; the app cannot ask again. |
| Nothing fires during the evening | Quiet hours. | Adjust or disable quiet hours. |
| I expected an alert for a task that was already overdue when I added it | Only crossings observed by a pass fire. | Expected. |

## Limits

- Nothing here is delivered while the browser is closed. For that, see
  push reminders in [More features](more-features.md).
- No per-task or per-context muting; the master switch and quiet hours are the
  only controls.
