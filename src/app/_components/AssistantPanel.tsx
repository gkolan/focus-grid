"use client";

import type Anthropic from "@anthropic-ai/sdk";
import { useEffect, useRef, useState } from "react";
import { type AgentEvent, runAgentTurn } from "@/application/agent";
import { useApp } from "./AppProvider";

type Line = { role: "user"; text: string } | ({ role: "assistant" } & AgentEvent);

/** Chat drawer for the assistant: talks to /api/ai/agent, acts on local data. */
export function AssistantPanel({ onClose }: { onClose: () => void }) {
  const { app, refresh } = useApp();
  const history = useRef<Anthropic.MessageParam[]>([]);
  const [lines, setLines] = useState<Line[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => bottom.current?.scrollIntoView({ block: "end" }), [lines]);

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    setBusy(true);
    history.current.push({ role: "user", content: text });
    setLines((l) => [...l, { role: "user", text }]);
    const { error } = await runAgentTurn(app, history.current, (e) => {
      setLines((l) => [...l, { role: "assistant", ...e }]);
      if (e.kind === "tool") refresh();
    });
    if (error) {
      history.current.pop(); // don't resend a turn the server rejected
      setLines((l) => [...l, { role: "assistant", kind: "tool", name: "error", summary: error, error: true }]);
    }
    setBusy(false);
  };

  return (
    <aside
      aria-label="Assistant"
      className="assistant"
    >
      <header className="flex items-center justify-between border-b px-4 py-2.5 text-sm" style={{ borderColor: "var(--line)" }}>
        <span className="font-medium">✦ Assistant</span>
        <div className="flex items-center gap-3">
          <button className="link" onClick={() => { history.current = []; setLines([]); }}>New chat</button>
          <button aria-label="Close assistant" className="grid h-7 w-7 place-items-center rounded-full hover:bg-[var(--field)]" onClick={onClose}>✕</button>
        </div>
      </header>
      <div className="flex-1 overflow-y-auto p-4 text-sm">
        {lines.length === 0 && (
          <p className="text-neutral-500">
            Try: “Add the Chelsea FC fixtures calendar”, “Dentist Tuesday 3pm for an hour”, “Mark the tax return done”.
          </p>
        )}
        <ul className="flex flex-col gap-2">
          {lines.map((l, i) => (
            <li key={i} className={l.role === "user" ? "max-w-[85%] self-end rounded-xl rounded-br-sm px-3 py-2" : ""} style={l.role === "user" ? { background: "var(--accent-soft)", color: "var(--accent)" } : undefined}>
              {l.role === "user" ? l.text : l.kind === "text" ? (
                <p className="whitespace-pre-wrap">{l.text}</p>
              ) : (
                <p className={`text-xs ${l.error ? "text-danger" : "text-neutral-500"}`}>{l.error ? "⚠ " : "✓ "}{l.summary}</p>
              )}
            </li>
          ))}
        </ul>
        {busy && <p className="mt-2 text-xs text-neutral-500">Working…</p>}
        <div ref={bottom} />
      </div>
      <form
        className="flex gap-2 border-t p-3"
        style={{ borderColor: "var(--line)" }}
        onSubmit={(e) => { e.preventDefault(); void send(); }}
      >
        <input
          aria-label="Message the assistant"
          autoFocus
          className="min-w-0 flex-1"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={busy}
          placeholder="Ask the assistant…"
        />
        <button type="submit" className="btn btn-primary" disabled={busy || !input.trim()}>Send</button>
      </form>
    </aside>
  );
}
