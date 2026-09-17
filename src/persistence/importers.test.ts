import { describe, expect, it } from "vitest";
import { unwrap } from "@/test/unwrap";
import { parseCsv, parseGenericCsv, parseGoogleTasks, parseTodoistCsv } from "./importers";

describe("importers", () => {
  it("parses quoted CSV with escaped quotes and CRLF", () => {
    expect(parseCsv('a,"b, ""c""",d\r\n1,2,3\n')).toEqual([["a", 'b, "c"', "d"], ["1", "2", "3"]]);
  });

  it("generic CSV maps columns case-insensitively and keeps unparsed dates in notes", () => {
    const rows = unwrap(parseGenericCsv("Title,Due,Estimate,Context,Tags,Importance,Done\nRent,2026-10-01,15,Finance,\"money, home\",high,no\nCall,next tuesday,,,,,\n", "UTC"));
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ title: "Rent", deadline: { kind: "date", date: "2026-10-01" }, estimatedMinutes: 15, contextName: "Finance", tags: ["money", "home"], importance: 0.6 });
    expect(rows[1].deadline).toBeNull();
    expect(rows[1].notes).toContain("next tuesday");
    expect(parseGenericCsv("nope\nx", "UTC").ok).toBe(false);
  });

  it("Todoist CSV: indent → parent, @labels → tags, priority → importance", () => {
    const csv = "TYPE,CONTENT,DESCRIPTION,PRIORITY,INDENT,AUTHOR,RESPONSIBLE,DATE,DATE_LANG,TIMEZONE,DURATION,DURATION_UNIT\n" +
      "task,Plan trip @travel,notes here,4,1,,,2026-12-01,en,UTC,90,minute\n" +
      "task,Book flights,,1,2,,,,en,UTC,,\n" +
      "note,ignored,,,,,,,,,,\n";
    const rows = unwrap(parseTodoistCsv(csv, "UTC"));
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ title: "Plan trip", tags: ["travel"], importance: 0.8, estimatedMinutes: 90, deadline: { date: "2026-12-01" } });
    expect(rows[1]).toMatchObject({ title: "Book flights", parentTitle: "Plan trip", importance: null });
  });

  it("Google Tasks JSON: lists → contexts, due → date, parent → subtask", () => {
    const json = JSON.stringify({ items: [{ title: "Home", items: [{ id: "a", title: "Fix tap", due: "2026-09-20T00:00:00.000Z", status: "needsAction" }, { id: "b", title: "Buy washer", parent: "a", status: "completed" }] }] });
    const rows = unwrap(parseGoogleTasks(json, "UTC"));
    expect(rows[0]).toMatchObject({ title: "Fix tap", contextName: "Home", deadline: { date: "2026-09-20" }, completed: false });
    expect(rows[1]).toMatchObject({ parentTitle: "Fix tap", completed: true });
    expect(parseGoogleTasks("{}", "UTC").ok).toBe(false);
  });
});
