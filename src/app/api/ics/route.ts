import { NextResponse } from "next/server";
import { normalizeFeedUrl } from "@/domain/feeds";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BYTES = 2_000_000;

/** CORS proxy for public iCal feeds: GET /api/ics?url=… → text/calendar. */
export async function GET(request: Request) {
  const raw = new URL(request.url).searchParams.get("url") ?? "";
  const url = normalizeFeedUrl(raw);
  if (!url) return NextResponse.json({ error: { message: "Not a public http(s)/webcal calendar URL." } }, { status: 400 });
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000), headers: { accept: "text/calendar, */*" }, redirect: "follow" });
    if (!res.ok) return NextResponse.json({ error: { message: `Feed responded ${res.status}.` } }, { status: 502 });
    const text = await res.text();
    if (text.length > MAX_BYTES) return NextResponse.json({ error: { message: "Feed is too large." } }, { status: 413 });
    if (!/BEGIN:VCALENDAR/i.test(text)) return NextResponse.json({ error: { message: "That URL is not an iCalendar feed." } }, { status: 415 });
    return new NextResponse(text, { headers: { "content-type": "text/calendar; charset=utf-8", "cache-control": "no-store" } });
  } catch {
    return NextResponse.json({ error: { message: "Could not reach the feed." } }, { status: 502 });
  }
}
