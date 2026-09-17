# Offline and mobile

## Offline

After the first successful load, the browser keeps a copy of the app itself
(the page and icons). Reopening the site with no network still lets you
view, create, edit, complete, archive, export, import, use Focus, and get
priority recalculation — everything that does not need a server.

Only the app itself is kept; AI responses and task data are never cached
that way. An online reload always gets the latest version.

With [AI capture](ai-capture.md) enabled, the dialog says *AI capture is
unavailable offline. You can still save tasks.*

## Updates

When a new build is deployed, the next load installs it in the background and
shows a bar: *An update is ready. Save your draft before reloading.* with
**Reload to update** and **Not now**. The app **never reloads on its own** — an
open task dialog is never lost to an update.

## Install as an app

Browsers that support it offer "Install" or "Add to Home Screen". Installed, FocusGrid opens in its own
window at `/`. The installed app shares the same local storage as the browser tab
on the same profile.

## Layout by width

| Width | Layout |
| --- | --- |
| < 768 px (phone) | Opens on **Focus**. Header has a ☰ menu, a **+** add button, the context filter, and the bell. Focus stacks the task list above the detail panel. |
| 768–1023 px (tablet) | Opens on **Grid**. Navigation is still the ☰ overlay. |
| ≥ 1024 px (desktop) | Opens on **Grid**. Tabs in the header; Inbox and Settings as icons; theme picker visible; the optional pinned side panel is available. |

Resizing never resets the view you are on. No width produces horizontal
page scrolling.

## Touch

The Grid supports one-finger drag on a task to pin it, one-finger drag on
empty field to pan, and two-finger pinch to zoom. These have been tested with
simulated touches, not yet on a real phone.

## What can go wrong

| Problem | What it means | What to do |
| --- | --- | --- |
| Offline reload shows the browser's "no internet" page | The offline copy was never saved (first visit was offline, or private mode blocks it). | Load once online. |
| "An update is ready" keeps appearing | You chose **Not now**; the new version waits until you reload. | **Reload to update** when convenient. |
| The installed app and the browser tab show different tasks | Different browser profiles (for example, the app was installed from a different profile). | Export from one and import into the other. |
| Phone opens on Focus but I want the Grid | Default for narrow screens. | ☰ → **Grid**. The choice persists while the tab lives. |

## Limits

- The app does nothing while closed, except the optional push reminders
  described in [More features](more-features.md).
- No offline access to AI capture.
