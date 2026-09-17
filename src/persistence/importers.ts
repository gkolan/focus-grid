/**
 * Third-party importers — pure parsers from CSV / Todoist CSV / Google
 * Tasks Takeout JSON into plain task rows. Context and parent names are
 * resolved by the application layer; nothing here touches storage.
 */
import { type Result, err, ok } from "@/domain/errors";
import { type Deadline, isRealCalendarDate } from "@/domain/task";
import { zonedToInstant } from "@/domain/ics";
export { zonedToInstant };

export interface ImportRow {
  title: string;
  notes: string;
  deadline: Deadline | null;
  estimatedMinutes: number | null;
  contextName: string | null;
  tags: string[];
  importance: number | null; // [-1, 1]
  completed: boolean;
  parentTitle: string | null;
}

export type ImportSource = "csv" | "todoist" | "google-tasks";

/** Minimal RFC 4180 parser: quotes, escaped quotes, CRLF. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let q = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (q) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else q = false;
      } else cell += c;
    } else if (c === '"') q = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((x) => x.trim() !== ""));
}

const ISO_DATE = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;

/** ISO date or datetime → Deadline; anything else → null (kept in notes by the caller). */
export function parseDeadline(raw: string | undefined, zone: string): Deadline | null {
  const s = (raw ?? "").trim();
  const m = ISO_DATE.exec(s);
  if (!m) return null;
  if (!isRealCalendarDate(m[1])) return null;
  if (m[2] == null) return { kind: "date", date: m[1], timeZone: zone };
  // a naive datetime is read in the chosen zone, not UTC
  const at = m[4] ? new Date(s.replace(" ", "T")) : zonedToInstant(m[1], Number(m[2]), Number(m[3]), zone);
  return Number.isNaN(at.getTime()) ? null : { kind: "instant", at: at.toISOString(), timeZone: zone };
}

const num = (s: string | undefined): number | null => {
  const n = Number((s ?? "").trim());
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
};

const clip = (s: string, n: number) => [...s].slice(0, n).join("");

/** Generic CSV: header names title, notes, deadline|due, estimate|minutes, context, tags, importance, done. */
export function parseGenericCsv(text: string, zone: string): Result<ImportRow[]> {
  const rows = parseCsv(text);
  if (rows.length < 2) return err("VALIDATION", "The CSV needs a header row and at least one task.");
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const col = (...names: string[]) => header.findIndex((h) => names.includes(h));
  const iTitle = col("title", "task", "name", "content");
  if (iTitle < 0) return err("VALIDATION", "The CSV needs a “title” column.");
  const iNotes = col("notes", "description", "note");
  const iDue = col("deadline", "due", "due date", "date");
  const iEst = col("estimate", "estimated_minutes", "minutes", "estimate (minutes)");
  const iCtx = col("context", "project", "list", "category");
  const iTags = col("tags", "labels");
  const iImp = col("importance", "priority");
  const iDone = col("done", "completed", "status");
  const out: ImportRow[] = [];
  for (const r of rows.slice(1)) {
    const title = (r[iTitle] ?? "").trim();
    if (!title) continue;
    const dueRaw = iDue >= 0 ? r[iDue] : "";
    const deadline = parseDeadline(dueRaw, zone);
    let notes = iNotes >= 0 ? (r[iNotes] ?? "") : "";
    if (dueRaw?.trim() && !deadline) notes = [notes, `Due (unparsed): ${dueRaw.trim()}`].filter(Boolean).join("\n");
    const impRaw = iImp >= 0 ? (r[iImp] ?? "").trim().toLowerCase() : "";
    const importance =
      impRaw === "high"
        ? 0.6
        : impRaw === "low"
          ? -0.6
          : impRaw === "medium"
            ? 0
            : impRaw !== "" && Number.isFinite(Number(impRaw))
              ? Math.max(-1, Math.min(1, Number(impRaw)))
              : null;
    const doneRaw = iDone >= 0 ? (r[iDone] ?? "").trim().toLowerCase() : "";
    out.push({
      title: clip(title, 200),
      notes: clip(notes, 10_000),
      deadline,
      estimatedMinutes: iEst >= 0 ? num(r[iEst]) : null,
      contextName: iCtx >= 0 && r[iCtx]?.trim() ? r[iCtx].trim() : null,
      tags: iTags >= 0 ? (r[iTags] ?? "").split(/[,;]/).map((t) => t.trim()).filter(Boolean).slice(0, 20) : [],
      importance,
      completed: ["true", "yes", "1", "done", "completed"].includes(doneRaw),
      parentTitle: null,
    });
  }
  return out.length ? ok(out) : err("VALIDATION", "No task rows found.");
}

/** Todoist CSV template export: TYPE,CONTENT,DESCRIPTION,PRIORITY,INDENT,…,DATE,…,DURATION. */
export function parseTodoistCsv(text: string, zone: string): Result<ImportRow[]> {
  const rows = parseCsv(text);
  const header = rows[0]?.map((h) => h.trim().toUpperCase()) ?? [];
  const i = (n: string) => header.indexOf(n);
  if (i("TYPE") < 0 || i("CONTENT") < 0) return err("VALIDATION", "This does not look like a Todoist CSV export.");
  const out: ImportRow[] = [];
  const stack: string[] = []; // title per indent level
  for (const r of rows.slice(1)) {
    if ((r[i("TYPE")] ?? "").trim().toLowerCase() !== "task") continue;
    const content = (r[i("CONTENT")] ?? "").trim();
    if (!content) continue;
    const indent = Math.max(1, Number(r[i("INDENT")] ?? 1) || 1);
    stack.length = indent - 1;
    const cleanTitle = clip(content.replace(/(?:^|\s)@[\w-]+/g, "").trim() || content, 200);
    const parentTitle = indent > 1 ? (stack[indent - 2] ?? null) : null;
    stack[indent - 1] = cleanTitle;
    const dateRaw = i("DATE") >= 0 ? r[i("DATE")] : "";
    const deadline = parseDeadline(dateRaw, zone);
    let notes = i("DESCRIPTION") >= 0 ? (r[i("DESCRIPTION")] ?? "") : "";
    if (dateRaw?.trim() && !deadline) notes = [notes, `Todoist date: ${dateRaw.trim()}`].filter(Boolean).join("\n");
    // ponytail: Todoist template docs say 4 = highest; verify against a real export if it looks inverted.
    const p = Number(r[i("PRIORITY")] ?? 1);
    const importance = p >= 4 ? 0.8 : p === 3 ? 0.4 : p === 2 ? 0 : null;
    const dur = i("DURATION") >= 0 ? num(r[i("DURATION")]) : null;
    const unit = i("DURATION_UNIT") >= 0 ? (r[i("DURATION_UNIT")] ?? "").trim().toLowerCase() : "minute";
    const labels = [...content.matchAll(/(?:^|\s)@([\w-]+)/g)].map((m) => m[1]);
    out.push({
      title: cleanTitle,
      notes: clip(notes, 10_000),
      deadline,
      estimatedMinutes: dur == null ? null : unit.startsWith("hour") ? dur * 60 : unit.startsWith("day") ? dur * 480 : dur,
      contextName: null,
      tags: labels.slice(0, 20),
      importance,
      completed: false,
      parentTitle,
    });
  }
  return out.length ? ok(out) : err("VALIDATION", "No tasks found in the Todoist export.");
}

/** Google Tasks (Takeout Tasks.json): task lists → contexts, due → date deadline, parent → subtask. */
export function parseGoogleTasks(text: string, zone: string): Result<ImportRow[]> {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return err("VALIDATION", "That file is not valid JSON.");
  }
  const lists = (json as { items?: unknown[] })?.items;
  if (!Array.isArray(lists)) return err("VALIDATION", "This does not look like a Google Tasks export (no task lists).");
  const out: ImportRow[] = [];
  for (const list of lists as Array<{ title?: string; items?: unknown[] }>) {
    const items = Array.isArray(list.items) ? (list.items as Array<Record<string, unknown>>) : [];
    const byId = new Map(items.map((t) => [String(t.id ?? ""), String(t.title ?? "")]));
    for (const t of items) {
      const title = String(t.title ?? "").trim();
      if (!title) continue;
      const due = typeof t.due === "string" ? t.due.slice(0, 10) : "";
      out.push({
        title: clip(title, 200),
        notes: clip(String(t.notes ?? ""), 10_000),
        deadline: due && isRealCalendarDate(due) ? { kind: "date", date: due, timeZone: zone } : null,
        estimatedMinutes: null,
        contextName: typeof list.title === "string" && list.title.trim() ? list.title.trim() : null,
        tags: [],
        importance: null,
        completed: t.status === "completed",
        parentTitle: typeof t.parent === "string" ? byId.get(t.parent) || null : null,
      });
    }
  }
  return out.length ? ok(out) : err("VALIDATION", "No tasks found in the Google Tasks export.");
}

export function parseImport(source: ImportSource, text: string, zone: string): Result<ImportRow[]> {
  if (new TextEncoder().encode(text).length > 25 * 1024 * 1024) return err("VALIDATION", "File is larger than 25 MiB.");
  if (source === "todoist") return parseTodoistCsv(text, zone);
  if (source === "google-tasks") return parseGoogleTasks(text, zone);
  return parseGenericCsv(text, zone);
}
