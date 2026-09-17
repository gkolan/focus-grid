# Backup and import

## Why this matters

FocusGrid has no server. Your tasks exist in **one browser profile on one
website address**, in the browser's own storage. Private windows, "clear site data", a reinstalled
browser, or a different device all mean an empty field. **The export file is
the only backup.**

## Export

Settings → **Backup** → **Export backup (.json)** downloads
`focusgrid-backup-<timestamp>.json` containing, from a single consistent
read:

- every task in every status, with a record of who set each value,
- contexts,
- history snapshots,
- AI interpretation records, if any,
- settings: time zone, theme, quiet hours, notifications toggle.

The file is plain JSON. Nothing is encrypted; store it somewhere you trust.

## Import

Settings → **Backup** → **Import copies from a backup…** → choose a file.

1. The file is validated and a **preview** appears: how many tasks and
   contexts will be added, plus any warnings. Nothing has changed yet.
2. Press **Import** to add them, or **Cancel**.

Import is **additive and copying**:

- Every imported task gets a **new ID**. Importing the same file twice gives
  you two copies of each task; it never overwrites or merges.
- A context with the **same name** as an existing one is reused; otherwise a
  new context is created.
- Your current tasks and settings are untouched. The file's settings are
  ignored (the preview says so).
- Each task's history comes along, re-pointed at the new ID.

The import either adds everything or nothing.

### Rejected files

| Message | Why |
| --- | --- |
| This is not a FocusGrid backup file. | The file is not a FocusGrid export. |
| This backup is from a newer version of FocusGrid. | The file was made by a newer FocusGrid than this one. |
| That file is not valid JSON. / Backup file is larger than 25 MiB. | Not parseable. |
| Task row *n* is invalid… / points at a context that is not in the file. | A row fails the checks. Nothing is imported. |
| Importing would exceed the 10,000-task limit. Nothing was imported. | Cap on the local store. |

## Delete all local data

Settings → **Backup** → **Delete all local data…** → type `DELETE ALL` →
**Delete everything**. This wipes tasks, contexts, history, AI records,
settings, and unsaved drafts for this browser. Exported files on your disk are
not touched. There is no undo other than importing a backup.

Per-task permanent deletion is in each task's **Danger zone** and asks for
confirmation.

## Worked example

1. Add two tasks. Export; note the filename.
2. Delete all local data. The field is empty.
3. Import the file. Preview says *This will add 2 task(s) and up to 1
   context(s) as new copies.* Press **Import**. Both tasks are back, with
   their History intact.
4. Import the same file again. Now there are four tasks — two pairs of
   copies. Delete the extras from their Danger zones.

## What can go wrong

| Problem | What it means | What to do |
| --- | --- | --- |
| The download did not start | The browser blocked a script-initiated download. | Allow downloads for this site, or check the downloads bar. |
| Import preview never appears | The file was rejected; the reason is shown in red under the button. | Fix or re-export the file. |
| Duplicate tasks after import | Expected: import always copies. | Delete the copies, or import only once. |
| Deleted a task, but an AI provider still has it | Deleting locally cannot recall text already sent to a third-party model. | Only relevant with provider-mode [AI capture](ai-capture.md). |

## Limits

- No automatic or scheduled backup; export by hand.
- No merge or "restore over" mode; import is copy-only by design so a bad
  file can never destroy what you have.
