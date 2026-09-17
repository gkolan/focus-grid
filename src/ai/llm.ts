/**
 * Model-agnostic chat turn for the assistant + Telegram bot. Server-only.
 * Anthropic goes through its SDK (native web search). Everything else speaks the
 * OpenAI chat-completions dialect — OpenAI, xAI Grok, Groq, OpenRouter, Ollama,
 * or any custom base URL — with web_search / web_fetch run here on the server
 * so every provider gets the same tool surface. Messages stay in Anthropic's
 * block shape end-to-end; the OpenAI path converts at the wire.
 */
if (typeof window !== "undefined") throw new Error("src/ai/llm.ts is server-only");
import Anthropic from "@anthropic-ai/sdk";
import { normalizeFeedUrl } from "@/domain/feeds";

export type Provider = "anthropic" | "openai" | "xai" | "groq" | "openrouter" | "ollama" | "custom";
export interface LlmConfig {
  provider: Provider;
  model: string;
  apiKey: string;
  baseUrl: string;
}

const PRESETS: Record<Exclude<Provider, "anthropic" | "custom">, { baseUrl: string; model: string; keyVar: string }> = {
  openai: { baseUrl: "https://api.openai.com/v1", model: "gpt-5", keyVar: "OPENAI_API_KEY" },
  xai: { baseUrl: "https://api.x.ai/v1", model: "grok-4", keyVar: "XAI_API_KEY" },
  groq: { baseUrl: "https://api.groq.com/openai/v1", model: "llama-3.3-70b-versatile", keyVar: "GROQ_API_KEY" },
  openrouter: { baseUrl: "https://openrouter.ai/api/v1", model: "anthropic/claude-sonnet-4.5", keyVar: "OPENROUTER_API_KEY" },
  ollama: { baseUrl: "http://localhost:11434/v1", model: "llama3.1", keyVar: "" },
};

/** Resolve provider from env. `FOCUSGRID_LLM_PROVIDER` wins; otherwise the first key found. */
export function llmConfig(env: Record<string, string | undefined> = process.env): LlmConfig | null {
  const v = (k: string) => env[k]?.trim() || "";
  let provider = v("FOCUSGRID_LLM_PROVIDER") as Provider | "";
  if (!provider) {
    provider = v("ANTHROPIC_API_KEY") ? "anthropic" : v("OPENAI_API_KEY") ? "openai" : v("XAI_API_KEY") ? "xai" : v("GROQ_API_KEY") ? "groq" : v("OPENROUTER_API_KEY") ? "openrouter" : "";
    if (!provider) return null;
  }
  const model = v("FOCUSGRID_LLM_MODEL");
  const key = v("FOCUSGRID_LLM_API_KEY");
  if (provider === "anthropic") {
    const apiKey = key || v("ANTHROPIC_API_KEY");
    return apiKey ? { provider, model: model || "claude-opus-5", apiKey, baseUrl: "" } : null;
  }
  if (provider === "custom") {
    const baseUrl = v("FOCUSGRID_LLM_BASE_URL");
    return baseUrl && model ? { provider, model, apiKey: key, baseUrl } : null;
  }
  const p = PRESETS[provider];
  if (!p) return null;
  const apiKey = key || (p.keyVar ? v(p.keyVar) : "");
  if (p.keyVar && !apiKey) return null;
  return { provider, model: model || p.model, apiKey, baseUrl: v("FOCUSGRID_LLM_BASE_URL") || p.baseUrl };
}

export interface TurnInput {
  system: string;
  /** volatile context appended after the cached system prefix */
  context: string;
  messages: Anthropic.MessageParam[];
  tools: Anthropic.Tool[];
  web: boolean;
  effort: "low" | "medium" | "high";
  maxTokens: number;
}
/** Messages to append to the caller's history (assistant turn, plus any server-tool round trips). */
export type Turn = { append: Anthropic.MessageParam[]; stop_reason: string };

export async function completeTurn(cfg: LlmConfig, input: TurnInput): Promise<Turn> {
  return cfg.provider === "anthropic" ? anthropicTurn(cfg, input) : openaiTurn(cfg, input);
}

// ── Anthropic ────────────────────────────────────────────────────────────────
async function anthropicTurn(cfg: LlmConfig, input: TurnInput): Promise<Turn> {
  const client = new Anthropic({ apiKey: cfg.apiKey });
  const messages = [...input.messages];
  const append: Anthropic.MessageParam[] = [];
  // ponytail: pause_turn resumes capped at 4 so a runaway search can't hold the request
  for (let i = 0; i < 4; i++) {
    const res = await client.messages.create({
      model: cfg.model,
      max_tokens: input.maxTokens,
      output_config: { effort: input.effort },
      system: [
        { type: "text", text: input.system, cache_control: { type: "ephemeral" } },
        { type: "text", text: input.context },
      ],
      tools: [
        ...(input.web
          ? [
              { type: "web_search_20260209" as const, name: "web_search" as const, max_uses: 5 },
              { type: "web_fetch_20260209" as const, name: "web_fetch" as const, max_uses: 3, max_content_tokens: 20_000 },
            ]
          : []),
        ...input.tools,
      ],
      messages,
    });
    const turn: Anthropic.MessageParam = { role: "assistant", content: res.content };
    append.push(turn);
    messages.push(turn);
    if (res.stop_reason !== "pause_turn") return { append, stop_reason: res.stop_reason ?? "end_turn" };
  }
  return { append, stop_reason: "end_turn" };
}

// ── OpenAI-compatible ────────────────────────────────────────────────────────
type OaiMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: OaiToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };
type OaiToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };

const WEB_TOOLS: Anthropic.Tool[] = [
  { name: "web_search", description: "Search the web. Returns titles, URLs and snippets.", input_schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"], additionalProperties: false } },
  { name: "web_fetch", description: "Fetch a public URL and return its text (HTML stripped, truncated).", input_schema: { type: "object", properties: { url: { type: "string" } }, required: ["url"], additionalProperties: false } },
];

function toOai(system: string, messages: Anthropic.MessageParam[]): OaiMessage[] {
  const out: OaiMessage[] = [{ role: "system", content: system }];
  for (const m of messages) {
    if (typeof m.content === "string") {
      out.push({ role: m.role, content: m.content });
      continue;
    }
    if (m.role === "assistant") {
      const text = m.content.filter((b): b is Anthropic.TextBlockParam => b.type === "text").map((b) => b.text).join("\n");
      const calls = m.content
        .filter((b): b is Anthropic.ToolUseBlockParam => b.type === "tool_use")
        .map((b): OaiToolCall => ({ id: b.id, type: "function", function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) } }));
      out.push({ role: "assistant", content: text || null, ...(calls.length && { tool_calls: calls }) });
      continue;
    }
    for (const b of m.content) {
      if (b.type === "tool_result") {
        const c = typeof b.content === "string" ? b.content : (b.content ?? []).map((x) => (x.type === "text" ? x.text : "")).join("\n");
        out.push({ role: "tool", tool_call_id: b.tool_use_id, content: b.is_error ? `ERROR: ${c}` : c });
      } else if (b.type === "text") out.push({ role: "user", content: b.text });
    }
  }
  return out;
}

async function openaiTurn(cfg: LlmConfig, input: TurnInput): Promise<Turn> {
  const tools = [...(input.web ? WEB_TOOLS : []), ...input.tools].map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.input_schema } }));
  const messages = [...input.messages];
  const append: Anthropic.MessageParam[] = [];
  // ponytail: server-tool rounds capped at 6; each web call is one round trip to the model
  for (let i = 0; i < 6; i++) {
    const r = await fetch(`${cfg.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(cfg.apiKey && { authorization: `Bearer ${cfg.apiKey}` }) },
      body: JSON.stringify({ model: cfg.model, max_tokens: input.maxTokens, messages: toOai(`${input.system}\n\n${input.context}`, messages), tools, tool_choice: "auto" }),
      signal: AbortSignal.timeout(90_000),
    });
    if (!r.ok) throw new Error(`${cfg.provider} responded ${r.status}: ${(await r.text()).slice(0, 300)}`);
    const j = (await r.json()) as { choices?: Array<{ message?: { content?: string | null; tool_calls?: OaiToolCall[] }; finish_reason?: string }> };
    const msg = j.choices?.[0]?.message ?? {};
    const content: Anthropic.ContentBlock[] = [];
    if (msg.content) content.push({ type: "text", text: msg.content, citations: null });
    for (const c of msg.tool_calls ?? []) {
      let parsed: unknown = {};
      try {
        parsed = JSON.parse(c.function.arguments || "{}");
      } catch {
        /* model emitted bad JSON; the tool will reject it */
      }
      content.push({ type: "tool_use", id: c.id, name: c.function.name, input: parsed, caller: { type: "direct" } });
    }
    const turn: Anthropic.MessageParam = { role: "assistant", content };
    append.push(turn);
    messages.push(turn);
    const calls = content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    if (!calls.length) return { append, stop_reason: "end_turn" };
    const webCalls = calls.filter((c) => c.name === "web_search" || c.name === "web_fetch");
    if (webCalls.length !== calls.length) return { append, stop_reason: "tool_use" }; // client tools: hand back
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const c of webCalls) {
      const inp = c.input as { query?: string; url?: string };
      const out = c.name === "web_search" ? await webSearch(inp.query ?? "") : await webFetch(inp.url ?? "");
      results.push({ type: "tool_result", tool_use_id: c.id, content: out.text, is_error: !out.ok });
    }
    const user: Anthropic.MessageParam = { role: "user", content: results };
    append.push(user);
    messages.push(user);
  }
  return { append, stop_reason: "end_turn" };
}

// ── Server-side web tools (for providers without native search) ──────────────
const UA = "Mozilla/5.0 (compatible; FocusGrid/2.0)";
const strip = (html: string) =>
  html
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();

/** ponytail: scrapes DuckDuckGo's lite page — no key, best effort. Swap for Brave/Tavily when it flakes. */
export async function webSearch(query: string): Promise<{ ok: boolean; text: string }> {
  if (!query.trim()) return { ok: false, text: "empty query" };
  try {
    const r = await fetch(`https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`, { headers: { "user-agent": UA, accept: "text/html" }, signal: AbortSignal.timeout(15_000) });
    const html = await r.text();
    const rows: string[] = [];
    const re = /<a[^>]+rel="nofollow"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:<td class="result-snippet">([\s\S]*?)<\/td>)?/gi;
    for (const m of html.matchAll(re)) {
      let href = m[1];
      const uddg = /[?&]uddg=([^&]+)/.exec(href);
      if (uddg) href = decodeURIComponent(uddg[1]);
      if (!/^https?:\/\//.test(href)) continue;
      rows.push(`${strip(m[2])}\n${href}\n${strip(m[3] ?? "")}`);
      if (rows.length >= 8) break;
    }
    return rows.length ? { ok: true, text: rows.join("\n\n") } : { ok: false, text: "no results" };
  } catch {
    return { ok: false, text: "search failed" };
  }
}

export async function webFetch(url: string): Promise<{ ok: boolean; text: string }> {
  const safe = normalizeFeedUrl(url); // same public-host rule as the ICS proxy: never fetch private ranges
  if (!safe) return { ok: false, text: "not a public http(s) URL" };
  try {
    const r = await fetch(safe, { headers: { "user-agent": UA }, redirect: "follow", signal: AbortSignal.timeout(15_000) });
    if (!r.ok) return { ok: false, text: `responded ${r.status}` };
    const body = (await r.text()).slice(0, 400_000);
    const type = r.headers.get("content-type") ?? "";
    return { ok: true, text: (type.includes("html") ? strip(body) : body).slice(0, 20_000) };
  } catch {
    return { ok: false, text: "fetch failed" };
  }
}
