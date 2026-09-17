# AI capture

## What it does

Type a sentence such as *Prepare interview by Friday, 3 hours* and press
**Interpret with AI**. The server asks a model to propose a title, deadline,
estimate, context, and importance/urgency, **with a confidence and a rationale
for each**. The app validates the proposal, creates the task with the safe
fields, and opens it for you to **Accept** or adjust anything the model was
unsure about. The full text you typed is kept in Notes.

The model proposes; the app owns every write. AI never completes, deletes,
moves, or re-prioritises an existing task, and it never runs on typing,
startup, or the heartbeat — only on your click.

## Modes

Set on the server via `.env.local` (copy from `.env.example`). Nothing here
is exposed to the browser.

| `FOCUSGRID_AI_MODE` | Behaviour | Settings shows |
| --- | --- | --- |
| `off` (default) | No AI code runs. The dialog has a single **Save** button. | *AI capture is off. You can still add tasks manually.* |
| `fixture` | Fixed, offline interpretations for demos and tests. No network request. | *Demo interpretation — no AI request is sent.* |
| `provider` | Real model call. Needs `FOCUSGRID_AI_PROVIDER=openai`, `FOCUSGRID_AI_MODEL`, and `OPENAI_API_KEY`. Local development only: it works only when you open the app from the same computer it runs on. | Provider name |

If provider mode is configured incompletely, the app still starts; AI capture
is simply reported unavailable. There is never a silent fallback to a paid
call or to a fake success.

### Try fixture mode

```bash
echo FOCUSGRID_AI_MODE=fixture >> .env.local
npm run dev
```

Then **Add task** and type:

| Input | What the fixture does |
| --- | --- |
| `Prepare interview by Friday, 3 hours` | Proposes title, a Friday deadline in your zone, 180 minutes, with rationales. |
| `Call the bank right now` | Undated task with high proposed urgency. |
| `Renew licence 3/4` | Flags the date as ambiguous (month/day or day/month) and asks you to confirm. |
| anything containing `fixture:timeout` | Simulates a provider timeout: the draft is kept and you can **Save without AI**. |
| `fixture:ratelimit`, `fixture:badjson`, `fixture:unsafe`, `fixture:context`, `fixture:dated-urgent` | Rate limit, malformed JSON, an unsafe proposal, an unknown context, and a proposal that contradicts itself — each is rejected, never applied. |

## What is checked

- Every proposed field must be the right kind of value and within bounds;
  anything unexpected is dropped.
- A proposal cannot set both a deadline and an urgency; a context must already
  exist; dates must be real.
- A request gives up after 15 seconds. Error messages never include your
  text, and your text is never written to the server log.

## Correcting the proposal

Fields the model was unsure about are listed under **Capture interpretation**
with the rationale and an **Accept** button; you can also just edit the field.
Accepted values are recorded as *AI, accepted at <time>*. Settings
→ **Clear AI interpretation history** removes stored rationales and
confidences without touching task values.

## Privacy

In provider mode your capture text is sent to the configured model. Deleting
the task locally does not recall that text — Settings says so next to the
export button. Fixture and off modes send nothing anywhere.

## What can go wrong

| Message | Meaning | What to do |
| --- | --- | --- |
| AI capture is unavailable offline. You can still save tasks. | No network. | **Save without AI**. |
| … (You can still Save without AI.) | Timeout, rate limit, or an invalid proposal. Your draft is intact. | Retry or save manually. |
| **Interpret with AI** is missing | Mode is `off`, or provider config is invalid. | Check `.env.local`; restart `npm run dev`. |
| 403 in the server log | The app was opened from another machine while in provider mode. | Provider mode is local-only by design. |

## Limits

- Capture works with OpenAI models only (the chat assistant supports more).
  Check that your chosen model can return structured JSON.
- One task per capture. A paragraph with three tasks becomes one task with the
  paragraph in Notes.
