# Security

## Report a security concern

Do not open a public GitHub issue for a possible security problem.

Use GitHub's private security reporting for this repository if it is enabled.
If it is not, contact the repository owner privately through their GitHub
profile and ask for a secure reporting method. Do not include API keys, push
subscriptions, exported task data, or Telegram identifiers in the first message.

Include:

- A short description of the concern.
- The affected file or feature.
- Steps that show the problem using demo-mode or made-up data.
- The possible effect: task data leaving the browser, a server-side secret
  exposed, a request to an unintended host, or data loss.
- A safe way to contact you.

## What the design promises

- Task data lives in IndexedDB in the browser. No API route reads or stores it.
- Every optional server feature (AI capture, chat assistant, Telegram bot, push
  reminders, `.ics` proxy) is off until an environment variable enables it, and
  each one is documented with exactly what it sends.
- Model output is validated with Zod before it can create or change a task.
- The `.ics` proxy rejects non-HTTP schemes and private or loopback hosts.

A change that weakens any of these is a security concern, not a feature.

## Keep local information private

- Never commit `.env` files, VAPID keys, bot tokens, or the `.data/` directory.
- Use demo mode or made-up tasks in examples, screenshots, and issues.
- Remove real task titles, notes, and chat identifiers from anything you share.
