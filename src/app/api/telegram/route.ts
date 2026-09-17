import { NextResponse } from "next/server";
import { z } from "zod";
import { ensurePoller, sync, telegramConfig } from "@/telegram/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const noStore = { headers: { "Cache-Control": "no-store" } };
const body = z.object({ timeZone: z.string().max(80), contexts: z.array(z.string().max(100)).max(60), ack: z.array(z.string()).max(200) }).strict();

/** Browser ↔ bot sync: send environment + acks, receive queued task drafts. Starts the poller. */
export async function POST(request: Request) {
  if (!telegramConfig().enabled) return NextResponse.json({ error: { message: "Telegram is not configured." } }, { status: 503, ...noStore });
  const host = request.headers.get("host") ?? "";
  if (!/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host)) return NextResponse.json({ error: { message: "Local only." } }, { status: 403, ...noStore });
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: { message: "Invalid body." } }, { status: 400, ...noStore });
  ensurePoller();
  const { ack, ...profile } = parsed.data;
  return NextResponse.json({ drafts: await sync(profile, ack) }, noStore);
}
