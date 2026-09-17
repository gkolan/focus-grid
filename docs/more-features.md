# More features

Everything below is additive: old data loads unchanged, the priority
engine is unchanged unless you tune it, and nothing leaves the browser unless
you turn it on.

## Tasks

| Feature | Where | Notes |
| --- | --- | --- |
| **Start date** | Task editor → *More* | The task stays on the Grid and in the Inbox but leaves Focus until then. |
| **Recurrence** | Task editor → *More* → Repeats | Every N days / weeks / months. Completing creates the next occurrence with the deadline advanced past today (missed periods are skipped). Month ends clamp (Jan 31 → Feb 28). |
| **Subtasks / projects** | Task editor → *Part of*, or *+ Subtask* | A project with no deadline of its own takes the urgency of its most urgent open subtask. Inbox shows `done/total`. |
| **Dependencies** | Task editor → *Waiting on* | A task with an unfinished blocker is shown with a *Waiting on N* chip and is never the Focus pick. |
| **Delegation** | Task editor → *Delegated to* | Free text (name or email). Delegated tasks stay on the field, leave Focus, and show `→ name`. Search with `@name`. |
| **Tags** | Task editor → *Tags* | Comma-separated. Inbox shows the most-used tags as chips; search with `#tag`. |
| **Templates** | Task editor → *Save as template*; *From template* when adding | Stored in Settings; delete them under *Task templates*. |
| **Markdown notes** | Focus view and the editor's *Notes preview* | Paragraphs, `- ` lists, **bold**, *italic*, `code`, links. |
| **Bulk add** | Inbox → *Bulk add* | One task per line. With AI on, each line is interpreted separately (deadline, estimate, context). |

## Views

- **Calendar** tab — day / week / month grid of unfinished tasks by deadline
  day. See [Calendar](calendar.md).
- **Focus stats** — Inbox → *Completed*: streak, completions per day, time focused.
- **Activity** — Settings → *Activity*: the newest history snapshots across every task.
- **Undo last change** — Inbox link or `Ctrl/⌘+Z` outside a text field. Reverts the previous task mutation in this tab (session-only stack of 20).
- **Saved filters** — Inbox: with a search or non-default tab active, *Save filter* pins it as a ★ chip (this browser only).
- **Keyboard placement** — focus a pill on the Grid, arrow keys nudge 0.05 (Shift: 0.2) and pin.
- **Group drag** — Shift-click pills to select several; drag any of them to move the group.
- **Language** — Settings: English, Español, Deutsch, Français for the shell chrome. Task text is never translated.

## Priority curve

Settings → *Priority curve*. Weights for deadline pressure, remaining effort
and overdue time (scaled to add up to 1), the overdue saturation hours and
the needs-review days. **Save** recalculates every task; **Reset to defaults**
restores the original values.

## Integrations

| Integration | How it works | What leaves the browser |
| --- | --- | --- |
| **ICS export** | Settings → *Export deadlines (.ics)*. Import into Google / Outlook / Apple Calendar. | Nothing — a file download. |
| **Google Calendar** | *Add to Google Calendar* in the task editor opens a prefilled event form. No account link is needed. | Title, notes and time, in the URL you open. |
| **Read-only snapshot** | Settings → *Export read-only snapshot (.html)*. A script-free page grouped by quadrant. | Nothing — a file download. |
| **Webhook** | Settings → *Webhook*. POSTs `{source, at, events, task}` on created / completed / blocked / unblocked / reopened / archived / restored / deadline changed. Sent once, no retry, no reply expected. | The task fields listed, to the URL you set. |
| **Push reminders** | Settings → *Push reminders*. Needs push keys on the server (see `.env.example`). The browser plans reminders (a day before, an hour before timed deadlines, at the deadline) for the next 7 days and posts them with its push subscription to `/api/push`; the server sends each one on time, tab open or closed. | Reminder text and times. Titles only if *show titles* is on under Notifications. Never the task database. |
| **Import: CSV** | Settings → *Import from other apps*. Header names: `title`, `notes`, `due`, `estimate`, `context`, `tags`, `importance`, `done`. Unparsed dates are kept in notes. | Nothing. |
| **Import: Todoist** | The CSV template export. Indent → subtask, `@label` → tag, priority 4 → high, DURATION → estimate. | Nothing. |
| **Calendar feeds** | Settings → *Public calendars*. Subscribe to any public `.ics` (holidays, fixtures, local events). Read-only overlays on the Calendar view; cached one day. | The feed URL, to this app's server, which fetches the file and forwards it. |
| **Chat assistant** | The ✦ button in the header, shown when any LLM key in `.env.example` is set. Ask in plain language to list, create, update, or complete tasks, or to add a calendar feed. The model runs on the server with web search; every data tool runs in the browser against local data. Model output is validated before it touches a task. | Your messages and the task fields the assistant reads or writes for that conversation. Never the task database. |
| **Telegram capture bot** | `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID`. Message the bot; it asks until it has a title and deadline, then queues a draft. The next open tab drains drafts into local tasks. Voice notes need `OPENAI_API_KEY`. | Your messages, to Telegram and the model. Drafts wait in `.data/` on the server until a browser collects them. |
| **Import: Google Tasks** | Takeout `Tasks.json`. Lists → contexts, `due` → date, `parent` → subtask, completed status kept. | Nothing. |

Push reminders and Telegram drafts are stored on the server under `.data/`.
This is designed for one server process; running several copies would need a
shared store.

## Not included

- **Cross-device sync and accounts** — one browser profile is the only place
  tasks live.
- **Calendar or working-hours awareness** — effort pressure treats every
  remaining minute as available. See [Priority engine](priority-engine.md).
