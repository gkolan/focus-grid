# FocusGrid documentation

Start with the question you have. You do not need to read every guide.

**Just want to see it?** Run `npm ci && npm run dev`, open
[localhost:3000](http://localhost:3000) and choose **Explore the demo**.

## I want to understand the idea

1. [Priority engine](priority-engine.md) — how a task's position is computed,
   in plain language, with the numbers.
2. [Grid](grid.md) — what the field shows and what dragging does.
3. [Focus](focus.md) — how one task gets recommended and why.
4. [Calendar](calendar.md) — deadlines by day, week, or month, with optional
   public-calendar overlays.

Screenshots of all three views in light and dark themes are in
[`screenshots/`](screenshots/) and in the [README](../README.md#see-it-in-action).

## I want to use a feature

- [Tasks and Inbox](tasks-and-inbox.md) — creating, editing, blocking,
  completing, archiving, searching, history.
- [Backup and import](backup-and-import.md) — export, import copies, delete all.
- [Notifications](notifications.md) — opt-in alerts, quiet hours, what is never sent.
- [Offline and mobile](offline-and-mobile.md) — offline use, install, phone layout.
- [AI capture](ai-capture.md) — optional natural-language capture and how to enable it.
- [Settings](settings.md) — contexts, time zone, theme, side panel, debug.
- [Demo mode](demo-mode.md) — the isolated sample database.

## Everything else

- [More features](more-features.md) — recurrence, subtasks, dependencies, delegation, tags,
  stats, undo, tuning, calendar feeds, push reminders, webhooks, importers,
  the chat assistant, and the Telegram capture bot.

## Words used in these guides

| Term | Meaning here |
| --- | --- |
| **Urgency** | Horizontal position. How time-sensitive a task is, from −1 (left) to +1 (right). |
| **Importance** | Vertical position. How much the outcome matters, from −1 (bottom) to +1 (top). |
| **Automatic value** | The urgency or importance the engine computes from deadline, estimate, and progress. |
| **Pin / override** | A value you set by dragging or choosing. It replaces the automatic value until you reset it. |
| **Quadrant** | One of four regions: Do now (top-right), Schedule (top-left), Delegate (bottom-right), Ignore (bottom-left). Labels only — nothing is assigned or sent. |
| **Deadline** | Either a day (due at the next midnight in its time zone) or a day and time. |
| **Estimate** | Optional minutes of effort. Combined with progress to give *remaining* effort. |
| **Overdue** | Now is past the deadline. Derived, not a status you set. |
| **Needs review** | Overdue for more than seven days. The task is hidden from Focus until you reschedule or resolve it. |
| **Deferred** | The task has a start date in the future (editor → *More*, AI capture, or import). Hidden from Focus until then. |
| **Waiting** | Delegated to someone, or depends on an unfinished task. Stays on the Grid, never the Focus pick. |
| **Blocked** | A status you set when you cannot act. Hidden from Focus, still in the Inbox. |
| **Context** | A colour-coded life area (Work, Home, …). Used for filtering; never a hierarchy. |
| **Inbox** | The list of every unfinished task. Not an AI processing queue. |
| **Focus** | The view that recommends one actionable task at a time. |
| **Heartbeat** | The 15-minute recalculation that moves tasks as time passes. |
| **History** | Per-task record of meaningful changes: who changed what, when. |
| **Demo mode** | **Explore the demo** on the welcome screen. A separate database seeded with sample tasks. |

Button and menu labels in these guides are written exactly as they appear in the app.
