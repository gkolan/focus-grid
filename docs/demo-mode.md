# Demo mode

## What it is

Choose **Explore the demo** on the welcome screen (or open
<http://localhost:3000/?demo=1>) and the app runs against a **separate local
database** seeded with over a hundred sample tasks across seven contexts,
arranged so every quadrant has occupants: overdue chores, in-progress client
work, a certification weeks away, undated low-value tidying.

An **Exit demo** button in the header wipes the demo database and returns you
to your own tasks. Opening the demo again starts from a fresh copy.

Deadlines are seeded relative to *now* ("in 1 hour", "8 hours ago"), so the
picture looks the same whenever you open it. The heartbeat still runs, so
points drift right the longer you keep the tab open.

## Guarantees

- The live database is never read, written, or seeded from demo mode.
- Demo data is never copied into the live store, even if it is empty.
- Export in demo mode exports the demo database; import adds to it.

Cross-tab refresh uses a separate channel, so a demo tab and a live tab open
side by side do not disturb each other.

## Use it for

- Showing the Grid, Focus, and Inbox with realistic density in under a
  minute.
- Trying drags, resets, skips, and notifications without risking your own
  tasks.
- Screenshots.

## What can go wrong

| Problem | What it means | What to do |
| --- | --- | --- |
| The demo looks different from the description | You changed things; demo data persists while you stay in the demo. | **Exit demo**, then open it again. |
| My real tasks vanished | You are in demo mode — check for the **Exit demo** button. | **Exit demo**. |
