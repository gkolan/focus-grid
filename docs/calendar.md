# Calendar

The **Calendar** tab shows unfinished tasks by deadline day. It answers "what
is due when?" — the Grid answers "what matters most?" and Focus answers "what
now?". The same task appears in all three; nothing is duplicated or moved.

![Calendar view, week range, light theme](screenshots/calendar-light.png)

## What you see

| Element | Meaning |
| --- | --- |
| **Day / Week / Month** | The time-range bar in the toolbar. Week starts on Sunday. Month shows six rows; days outside the month are dimmed. |
| **Today** | Highlighted column (day and week ranges) or the filled day number (month). |
| **Task pill** | Title, context colour dot, and due time. Click to open the editor. |
| **Red title** | The deadline has passed. |
| **`N undated tasks not shown`** | Tasks with no deadline are counted here and never placed on a day. They stay in the Inbox and on the Grid. |
| **`+N more`** | In month range each day shows four tasks; click to expand the day. |
| **Coloured bars above the tasks** | Events from a subscribed public calendar, in the feed's colour. Read-only; they are not tasks. |

Times are shown in the display time zone chosen in Settings. Date-only
deadlines are due at the next midnight in their own zone and are listed without
a time.

## Category filter

The **All categories** control in the toolbar limits the Calendar to one
context. It never hides a task from the Inbox.

## Public calendar feeds

Settings → **Public calendars**. Paste any iCal link (`webcal://` or
`https://…ics`) or pick a public-holiday calendar from the list. Events overlay
the Calendar in the feed's colour for the day, week, or month you are looking
at.

- Feeds are fetched through the app server because browsers block direct
  downloads from other sites. The server only forwards the file; it does
  not store it. Private and loopback addresses are rejected.
- Events are cached in this browser for one day. **Refresh** in Settings
  fetches again.
- Events never become tasks and never affect priority. Removing a feed removes
  its overlay and cache.

## What the Calendar does not do

- It does not create tasks by clicking a day, and it does not drag tasks
  between days. Change a deadline in the task editor or with **Reschedule**
  in Focus.
- It does not show completed or archived tasks.
- It does not export. Use Settings → **Export deadlines (.ics)** to put
  deadlines into another calendar; see [More features](more-features.md#integrations).
