/**
 * Assistant agent client. Drives the tool loop: POST /api/ai/agent, run
 * any client tool_use blocks against the local app, append results, repeat.
 * All task/feed data stays in the browser.
 */
import type Anthropic from "@anthropic-ai/sdk";
import { type AgentContext, type ToolName, toolInputSchemas } from "@/ai/agent-tools";
import type { Deadline } from "@/domain/task";
import { forgetFeedCache, loadFeedEvents } from "./feeds";
import type { FocusGridApp, ImportanceChoice } from "./service";

export type AgentEvent = { kind: "text"; text: string } | { kind: "tool"; name: string; summary: string; error?: boolean };

const MAX_ROUNDS = 12;
const isWebTool = (name: string) => name === "web_search" || name === "web_fetch";

export async function runAgentTurn(
  app: FocusGridApp,
  history: Anthropic.MessageParam[],
  onEvent: (e: AgentEvent) => void,
): Promise<{ error: string | null }> {
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const feeds = await app.calendarFeeds();
    const context: AgentContext = {
      now: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      contexts: (await app.contexts()).map((c) => c.name),
      feeds: feeds.map((f) => ({ name: f.name, url: f.url })),
    };
    const res = await fetch("/api/ai/agent", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ messages: history, context }) });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      return { error: body?.error?.message ?? `Assistant responded ${res.status}.` };
    }
    const { append, stop_reason } = (await res.json()) as { append: Anthropic.MessageParam[]; stop_reason: string };
    history.push(...append);
    for (const m of append) {
      if (m.role !== "assistant" || typeof m.content === "string") continue;
      for (const b of m.content) {
        if (b.type === "text" && b.text.trim()) onEvent({ kind: "text", text: b.text });
        // native (Anthropic) or server-executed (other providers) web tools — already done, show as activity
        if (b.type === "server_tool_use" || (b.type === "tool_use" && isWebTool(b.name)))
          onEvent({ kind: "tool", name: b.name, summary: b.name === "web_search" ? `Searching: ${(b.input as { query?: string }).query ?? ""}` : `Reading ${(b.input as { url?: string }).url ?? ""}` });
      }
    }
    const last = append.at(-1);
    const uses = last?.role === "assistant" && typeof last.content !== "string" ? last.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use" && !isWebTool(b.name)) : [];
    if (stop_reason !== "tool_use" || uses.length === 0) return { error: stop_reason === "refusal" ? "The assistant declined that request." : null };

    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const u of uses) {
      const r = await execute(app, u.name, u.input);
      onEvent({ kind: "tool", name: u.name, summary: r.summary, error: !r.ok });
      results.push({ type: "tool_result", tool_use_id: u.id, content: r.content, is_error: !r.ok });
    }
    history.push({ role: "user", content: results });
  }
  return { error: "The assistant made too many steps — try a smaller request." };
}

/** Text the user sees for a tool call: what the model asked for, then the outcome. */
export async function execute(app: FocusGridApp, name: string, raw: unknown): Promise<{ ok: boolean; content: string; summary: string }> {
  const schema = toolInputSchemas[name as ToolName];
  if (!schema) return { ok: false, content: `Unknown tool ${name}.`, summary: `Unknown tool ${name}` };
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return { ok: false, content: `Invalid input: ${parsed.error.issues[0]?.message}`, summary: `${name}: invalid input` };
  const input = parsed.data as never;
  try {
    return await handlers[name as ToolName](app, input);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "failed";
    return { ok: false, content: msg, summary: `${name}: ${msg}` };
  }
}

type Out = { ok: boolean; content: string; summary: string };
type In<K extends ToolName> = (typeof toolInputSchemas)[K]["_output"];

const zone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

function deadlineOf(i: { deadlineDate?: string; deadlineAt?: string }): Deadline | undefined {
  if (i.deadlineAt) return { kind: "instant", at: i.deadlineAt, timeZone: zone() };
  if (i.deadlineDate) return { kind: "date", date: i.deadlineDate, timeZone: zone() };
  return undefined;
}

async function contextIdOf(app: FocusGridApp, name: string | null | undefined): Promise<string | null | undefined> {
  if (name === undefined) return undefined;
  if (name === null) return null;
  const c = (await app.contexts()).find((x) => x.name.toLowerCase() === name.toLowerCase());
  if (!c) throw new Error(`No context named "${name}".`);
  return c.id;
}

const handlers: { [K in ToolName]: (app: FocusGridApp, input: In<K>) => Promise<Out> } = {
  async list_tasks(app, { status, search }) {
    const views = status === "completed" ? await app.completed(search) : status === "all" ? await app.allViews() : await app.inbox(search);
    const rows = views.slice(0, 200).map(({ record: { task }, contextName }) => ({
      id: task.id,
      title: task.title,
      status: task.status,
      deadline: task.deadline ? (task.deadline.kind === "date" ? task.deadline.date : task.deadline.at) : null,
      startAt: task.startAt ?? null,
      estimatedMinutes: task.estimatedMinutes ?? null,
      context: contextName || null,
      tags: task.tags ?? [],
    }));
    return { ok: true, content: JSON.stringify(rows), summary: `Listed ${rows.length} tasks` };
  },
  async create_task(app, i) {
    const res = await app.createManualTask({
      title: i.title,
      notes: i.notes,
      deadline: deadlineOf(i),
      startAt: i.startAt,
      estimatedMinutes: i.estimatedMinutes,
      contextId: await contextIdOf(app, i.contextName),
      importance: (i.importance ?? "untouched") as ImportanceChoice,
      tags: i.tags,
    });
    if (!res.ok) return { ok: false, content: res.error.message, summary: `Create failed: ${res.error.message}` };
    return { ok: true, content: JSON.stringify({ id: res.value.id }), summary: `Created "${i.title}"` };
  },
  async update_task(app, { id, ...i }) {
    const v = (await app.allViews()).find((x) => x.record.task.id === id);
    if (!v) return { ok: false, content: "No such task.", summary: "Update failed: no such task" };
    const res = await app.edit(id, v.record.task.revision, {
      ...(i.title !== undefined && { title: i.title }),
      ...(i.notes !== undefined && { notes: i.notes }),
      ...(deadlineOf(i) && { deadline: deadlineOf(i) }),
      ...(i.startAt !== undefined && { startAt: i.startAt }),
      ...(i.estimatedMinutes !== undefined && { estimatedMinutes: i.estimatedMinutes }),
      ...(i.contextName !== undefined && { contextId: await contextIdOf(app, i.contextName) }),
      ...(i.importance && { baseImportance: { low: -0.6, medium: 0, high: 0.6 }[i.importance] }),
      ...(i.tags && { tags: i.tags }),
    });
    if (!res.ok) return { ok: false, content: res.error.message, summary: `Update failed: ${res.error.message}` };
    return { ok: true, content: "ok", summary: `Updated "${v.record.task.title}"` };
  },
  async complete_task(app, { id }) {
    const v = (await app.allViews()).find((x) => x.record.task.id === id);
    if (!v) return { ok: false, content: "No such task.", summary: "Complete failed: no such task" };
    const res = await app.complete(id, v.record.task.revision);
    if (!res.ok) return { ok: false, content: res.error.message, summary: `Complete failed: ${res.error.message}` };
    return { ok: true, content: "ok", summary: `Completed "${v.record.task.title}"` };
  },
  async list_calendar_feeds(app) {
    const feeds = await app.calendarFeeds();
    return { ok: true, content: JSON.stringify(feeds.map(({ id, name, url }) => ({ id, name, url }))), summary: `Listed ${feeds.length} feeds` };
  },
  async add_calendar_feed(app, { name, url }) {
    const before = new Set((await app.calendarFeeds()).map((f) => f.id));
    const res = await app.addCalendarFeed(name, url);
    if (!res.ok) return { ok: false, content: res.error.message, summary: `Feed rejected: ${res.error.message}` };
    // verify it actually serves a calendar; roll back a dead link so the model tries another
    const { events, error } = await loadFeedEvents(res.value, true);
    if (error) {
      if (!before.has(res.value.id)) await app.removeCalendarFeed(res.value.id);
      return { ok: false, content: `Feed did not verify: ${error}`, summary: `Feed failed: ${error}` };
    }
    return { ok: true, content: JSON.stringify({ id: res.value.id, events: events.length }), summary: `Added feed "${res.value.name}" (${events.length} events)` };
  },
  async remove_calendar_feed(app, { id }) {
    const f = (await app.calendarFeeds()).find((x) => x.id === id);
    if (!f) return { ok: false, content: "No such feed.", summary: "Remove failed: no such feed" };
    await app.removeCalendarFeed(id);
    forgetFeedCache(f.url);
    return { ok: true, content: "ok", summary: `Removed feed "${f.name}"` };
  },
};
