"use client";

import { Fragment, type ReactNode } from "react";

/**
 * Tiny Markdown for task notes: paragraphs, `- ` lists, `**bold**`,
 * `*italic*`, `` `code` ``, [links](url) and bare URLs. Output is React nodes,
 * never innerHTML. ponytail: no headings/tables/nesting; add a real parser if asked.
 */
const INLINE = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[[^\]]+\]\((?:https?:\/\/)[^)\s]+\)|https?:\/\/[^\s<>)]+)/g;

function inline(text: string): ReactNode[] {
  return text.split(INLINE).map((part, i) => {
    if (!part) return null;
    if (i % 2 === 0) return <Fragment key={i}>{part}</Fragment>;
    if (part.startsWith("**")) return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("`")) return <code key={i} className="rounded px-1" style={{ background: "var(--field)", border: "1px solid var(--line)" }}>{part.slice(1, -1)}</code>;
    if (part.startsWith("*")) return <em key={i}>{part.slice(1, -1)}</em>;
    if (part.startsWith("[")) {
      const m = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(part)!;
      return <a key={i} href={m[2]} target="_blank" rel="noopener noreferrer" className="underline">{m[1]}</a>;
    }
    return <a key={i} href={part} target="_blank" rel="noopener noreferrer" className="underline">{part}</a>;
  });
}

export function Markdown({ text, className }: { text: string; className?: string }) {
  const blocks: ReactNode[] = [];
  let list: string[] = [];
  const flush = (k: number) => {
    if (list.length) blocks.push(<ul key={`l${k}`} className="list-disc pl-5">{list.map((l, i) => <li key={i}>{inline(l)}</li>)}</ul>);
    list = [];
  };
  text.split(/\r?\n/).forEach((line, i) => {
    const m = /^\s*[-*]\s+(.*)$/.exec(line);
    if (m) list.push(m[1]);
    else {
      flush(i);
      if (line.trim()) blocks.push(<p key={i}>{inline(line)}</p>);
    }
  });
  flush(-1);
  return <div className={`flex flex-col gap-1 ${className ?? ""}`}>{blocks}</div>;
}
