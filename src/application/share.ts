/**
 * Read-only snapshot: a self-contained HTML page of the current field,
 * grouped by quadrant. No script, no external assets — safe to send anywhere.
 */
import type { TaskView } from "./service";

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const QUADRANTS: Array<[TaskView["priority"]["quadrant"], string]> = [
  ["do_now", "Do now"],
  ["schedule", "Schedule"],
  ["delegate", "Delegate"],
  ["ignore", "Ignore"],
];

export function snapshotHtml(views: TaskView[], now: Date): string {
  const sections = QUADRANTS.map(([q, name]) => {
    const rows = views
      .filter((v) => v.priority.quadrant === q)
      .sort((a, b) => b.score - a.score)
      .map((v) => {
        const t = v.record.task;
        const due = t.deadline ? (t.deadline.kind === "date" ? t.deadline.date : t.deadline.at.slice(0, 16).replace("T", " ") + " UTC") : "—";
        return `<tr><td>${esc(t.title)}</td><td>${esc(v.contextName)}</td><td>${esc(due)}</td><td>${Math.round(t.progress * 100)}%</td><td>${esc((t.tags ?? []).join(", "))}</td></tr>`;
      })
      .join("");
    return `<h2>${name} <small>(${views.filter((v) => v.priority.quadrant === q).length})</small></h2>
<table><thead><tr><th>Task</th><th>Context</th><th>Due</th><th>Done</th><th>Tags</th></tr></thead><tbody>${rows || '<tr><td colspan="5">—</td></tr>'}</tbody></table>`;
  }).join("\n");
  return `<!doctype html><meta charset="utf-8"><title>FocusGrid snapshot</title>
<style>body{font:14px system-ui;margin:2rem;max-width:60rem;color:#111}table{border-collapse:collapse;width:100%;margin-bottom:1.5rem}th,td{text-align:left;padding:.3rem .5rem;border-bottom:1px solid #ddd}h2 small{color:#777;font-weight:normal}</style>
<h1>FocusGrid snapshot</h1><p>${views.length} unfinished task(s) as of ${esc(now.toISOString().slice(0, 16).replace("T", " "))} UTC. Read-only.</p>
${sections}`;
}
