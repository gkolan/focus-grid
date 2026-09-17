import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { type Complete, type Store, converse, telegramConfig } from "./server";

type Msg = { content: Anthropic.ContentBlock[]; stop_reason: string };
/** Scripted model: each call pops the next canned response. */
function fakeClient(script: Msg[]): Complete {
  return async () => {
    const m = script.shift()!;
    return { append: [{ role: "assistant", content: m.content }], stop_reason: m.stop_reason };
  };
}
const store = (): Store => ({ offset: 0, chats: {}, outbox: [], profile: { timeZone: "Europe/London", contexts: [] } });

describe("telegram converse", () => {
  it("asks for missing timing, then queues once submit_task is called", async () => {
    const s = store();
    const ask = fakeClient([{ content: [{ type: "text", text: "When is it due?", citations: null }], stop_reason: "end_turn" }]);
    expect(await converse(ask, s, 1, "renew passport")).toBe("When is it due?");
    expect(s.outbox).toHaveLength(0);

    const submit = fakeClient([
      { content: [{ type: "tool_use", id: "t1", name: "submit_task", input: { title: "Renew passport", deadlineDate: "2026-10-20" }, caller: { type: "direct" } }], stop_reason: "tool_use" },
      { content: [{ type: "text", text: "Added: Renew passport, due 20 Oct.", citations: null }], stop_reason: "end_turn" },
    ]);
    expect(await converse(submit, s, 1, "20 October")).toBe("Added: Renew passport, due 20 Oct.");
    expect(s.outbox).toMatchObject([{ chatId: 1, input: { title: "Renew passport", deadlineDate: "2026-10-20" } }]);
    expect(s.chats[1]).toHaveLength(6); // user, assistant, user, assistant(tool), user(result), assistant
  });

  it("rejects a malformed submit without queuing", async () => {
    const s = store();
    const bad = fakeClient([
      { content: [{ type: "tool_use", id: "t1", name: "submit_task", input: { title: "", deadlineAt: "tomorrow" }, caller: { type: "direct" } }], stop_reason: "tool_use" },
      { content: [{ type: "text", text: "Let me retry.", citations: null }], stop_reason: "end_turn" },
    ]);
    await converse(bad, s, 1, "x");
    expect(s.outbox).toHaveLength(0);
  });

  it("/new clears the chat", async () => {
    const s = store();
    s.chats[1] = [{ role: "user", content: "old" }];
    await converse(fakeClient([]), s, 1, "/new");
    expect(s.chats[1]).toBeUndefined();
  });

  it("is disabled without an allowlisted chat id", () => {
    expect(telegramConfig().enabled).toBe(false);
  });
});
