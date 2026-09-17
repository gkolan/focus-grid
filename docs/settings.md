# Settings

All settings are local to this browser profile. The server has no settings
for you; AI mode and deployment are server-side configuration described in
[AI capture](ai-capture.md).

## Backup

Export, import, and delete-all. See [Backup and import](backup-and-import.md).

## Display time zone

A drop-down of common time zones plus **Use device zone**. Changing it
**reformats times only**. A deadline keeps the zone it was created in; a
task due "Friday" in Chicago is still due Friday midnight Chicago time when
you view it from Tokyo.

## Grid side panel

**Pin the task list beside the field** — desktop (≥ 1024 px) only, off by
default. See [Grid](grid.md#side-panel).

## AI capture

Shows the current mode and offers **Clear AI interpretation history**, which
deletes stored rationales and confidences. Task values and pins are not
affected.

## Debug

**Show numeric priority factors, revision, and engine version** adds a raw
readout to the Grid details panel: deadline / effort / overdue pressure, the
24-hour trend delta, revision, engine version, and last calculation time.
Nothing is logged or sent anywhere.

## Notifications

See [Notifications](notifications.md).

## Contexts

Contexts are colour-coded life areas. A fresh database starts with seven:
**Work, Family, Home, Personal, Career, Health, Finance**. They are for
filtering and colour only — no context outranks another, and there is no
hierarchy.

| Action | How |
| --- | --- |
| Add | Type a name, pick a colour, **Add**. Names must be unique. |
| Rename / recolour | Edit the row inline. |
| Delete | **Delete** → choose where its tasks go (another context or **Uncategorized**) → **Delete and move tasks**. Tasks are moved, never deleted. |

The category filter in the header (**All categories** or one) applies to the
Grid, Focus, and Calendar together and is remembered per browser.

## Theme

The sun / moon buttons in the desktop header switch between light and dark.
Until you press one, the system preference applies. The choice is stored in
this browser only and is included in exports for reference.

## Everything else

Language, Priority curve, Webhook, Push reminders, Calendar & sharing, Public
calendars, Import from other apps, Task templates, and Activity are covered in
[More features](more-features.md).

## What can go wrong

| Problem | What it means | What to do |
| --- | --- | --- |
| "Use device zone" picks something odd | The OS zone is not in the common list; it is shown as a custom entry. | It still works; pick another if you prefer. |
| A context name is refused | Empty or already exists. | Choose a different name. |
| The side-panel checkbox does nothing on a laptop | Window is narrower than 1024 px. | Widen the window or ignore it. |
