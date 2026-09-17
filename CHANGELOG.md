# Changelog

This file records user-visible changes. The project is under active
development and has no tagged releases yet; entries under **Unreleased** are on
`master` and may change.

## Unreleased

### Added

- Chat assistant (header ✦ button) that lists, creates, updates, and completes
  tasks and manages calendar feeds. Runs against any supported LLM provider;
  data tools execute in the browser.
- Telegram capture bot that turns a short conversation into a task draft the
  next open tab collects.
- Public calendar feeds: subscribe to `.ics` links or preset holiday calendars
  and see them as read-only overlays on the Calendar view.
- Calendar view now has Day and Week ranges in addition to Month, driven by the
  shared time-range bar.
- Model-agnostic LLM layer (Anthropic, OpenAI, xAI, Groq, OpenRouter, Ollama,
  custom base URL) with a shared web-search tool surface.
- Repository documentation: screenshots, Calendar guide, contributing, support,
  security, CI workflow, and issue templates.

### Changed

- Header, toolbar, and view layouts reworked around a single time-range bar
  and category filter shared by Grid, Focus, and Calendar.
- Light and dark themes retuned for contrast; theme picker moved to the header.
- Importers, push scheduler, and deadline helpers refactored; behaviour is
  covered by `src/application/fixes.test.ts`.

## 2026-09-11

Task fields (start date, recurrence, subtasks, dependencies, delegation, tags,
templates, Markdown notes), Calendar and stats views, global undo, saved
filters, keyboard and group placement on the Grid, priority-curve tuning, four
UI languages, and integrations (ICS export, Google Calendar link, read-only
snapshot, webhooks, push reminders, CSV / Todoist / Google Tasks import). See
[docs/more-features.md](docs/more-features.md).

## 2026-09

Grid, priority engine, Focus, Tasks and Inbox, backup and import,
notifications, offline use and install, optional AI capture, settings.
