import { describe, expect, it } from "vitest";
import { normalizeFeedUrl } from "./feeds";
import { parseIcs } from "./ics";

describe("public calendar feeds", () => {
  it("normalizes webcal and rejects private/odd URLs", () => {
    expect(normalizeFeedUrl("webcal://example.com/a.ics")).toBe("https://example.com/a.ics");
    expect(normalizeFeedUrl("http://localhost:3000/x")).toBeNull();
    expect(normalizeFeedUrl("http://192.168.1.4/x")).toBeNull();
    expect(normalizeFeedUrl("file:///etc/passwd")).toBeNull();
    expect(normalizeFeedUrl("nope")).toBeNull();
  });

  it("parses all-day, TZID, UTC, folded lines and drops cancelled events", () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "UID:h1",
      "DTSTART;VALUE=DATE:20261225",
      "DTEND;VALUE=DATE:20261226",
      "SUMMARY:Christmas\\, Day",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "UID:m1",
      "DTSTART;TZID=Europe/London:20261003T150000",
      "DTEND;TZID=Europe/London:20261003T170000",
      "SUMMARY:Arsenal v",
      "  Spurs",
      "LOCATION:Emirates",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "UID:u1",
      "DTSTART:20261110T200000Z",
      "SUMMARY:No end given",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "UID:c1",
      "DTSTART:20261111T200000Z",
      "STATUS:CANCELLED",
      "SUMMARY:Gone",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    const ev = parseIcs(ics);
    expect(ev.map((e) => e.uid)).toEqual(["h1", "m1", "u1"]);
    expect(ev[0]).toMatchObject({ title: "Christmas, Day", start: "2026-12-25", end: "2026-12-26", allDay: true });
    expect(ev[1]).toMatchObject({ title: "Arsenal v Spurs", start: "2026-10-03T14:00:00.000Z", end: "2026-10-03T16:00:00.000Z", location: "Emirates", allDay: false }); // BST = UTC+1
    expect(ev[2].end).toBe("2026-11-10T21:00:00.000Z");
  });
});
