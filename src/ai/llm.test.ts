import { afterEach, describe, expect, it, vi } from "vitest";
import { completeTurn, llmConfig } from "./llm";

describe("llmConfig", () => {
  it("picks the first key found, or the explicit provider", () => {
    expect(llmConfig({})).toBeNull();
    expect(llmConfig({ ANTHROPIC_API_KEY: "a" })).toMatchObject({ provider: "anthropic", model: "claude-opus-5" });
    expect(llmConfig({ XAI_API_KEY: "x" })).toMatchObject({ provider: "xai", model: "grok-4", baseUrl: "https://api.x.ai/v1" });
    expect(llmConfig({ ANTHROPIC_API_KEY: "a", OPENAI_API_KEY: "o", FOCUSGRID_LLM_PROVIDER: "openai", FOCUSGRID_LLM_MODEL: "gpt-5-mini" })).toMatchObject({ provider: "openai", model: "gpt-5-mini", apiKey: "o" });
    expect(llmConfig({ FOCUSGRID_LLM_PROVIDER: "ollama" })).toMatchObject({ provider: "ollama", apiKey: "" });
    expect(llmConfig({ FOCUSGRID_LLM_PROVIDER: "custom", FOCUSGRID_LLM_BASE_URL: "http://gpu:8000/v1" })).toBeNull(); // model required
  });
});

describe("openai-compatible turn", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("converts history to chat-completions and tool_calls back to tool_use", async () => {
    const seen: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: { body: string }) => {
        seen.push(JSON.parse(init.body));
        return new Response(JSON.stringify({ choices: [{ message: { content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "create_task", arguments: '{"title":"Dentist"}' } }] }, finish_reason: "tool_calls" }] }));
      }),
    );
    const turn = await completeTurn(
      { provider: "xai", model: "grok-4", apiKey: "k", baseUrl: "https://api.x.ai/v1" },
      {
        system: "sys",
        context: "now: t",
        messages: [
          { role: "user", content: "dentist" },
          { role: "assistant", content: [{ type: "tool_use", id: "c0", name: "list_tasks", input: {} }] },
          { role: "user", content: [{ type: "tool_result", tool_use_id: "c0", content: "[]" }] },
        ],
        tools: [{ name: "create_task", description: "d", input_schema: { type: "object" } }],
        web: false,
        effort: "low",
        maxTokens: 100,
      },
    );
    const body = seen[0] as { messages: Array<Record<string, unknown>>; tools: unknown[] };
    expect(body.messages.map((m) => m.role)).toEqual(["system", "user", "assistant", "tool"]);
    expect(body.messages[3]).toMatchObject({ tool_call_id: "c0", content: "[]" });
    expect(body.tools).toHaveLength(1);
    expect(turn.stop_reason).toBe("tool_use");
    expect(turn.append).toEqual([{ role: "assistant", content: [{ type: "tool_use", id: "c1", name: "create_task", input: { title: "Dentist" }, caller: { type: "direct" } }] }]);
  });
});
