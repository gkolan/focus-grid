import { NextResponse } from "next/server";
import { z } from "zod";
import { ensureScheduler, pushConfig, removeSubscription, reminderSchema, subscriptionSchema, upsertSubscription } from "@/push/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const noStore = { headers: { "Cache-Control": "no-store" } };
const bad = (message: string, status = 400) => NextResponse.json({ error: { message } }, { status, ...noStore });

/** Capability probe: whether VAPID keys are configured, and the public key to subscribe with. */
export function GET() {
  ensureScheduler();
  return NextResponse.json(pushConfig(), noStore);
}

const upsertBody = z.object({ subscription: subscriptionSchema, reminders: z.array(reminderSchema).max(200) }).strict();

/** Replace this subscription's scheduled reminders. */
export async function POST(request: Request) {
  if (!pushConfig().enabled) return bad("Push is not configured on this server.", 503);
  ensureScheduler();
  const parsed = upsertBody.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return bad(parsed.error.issues[0]?.message ?? "Invalid body.");
  const stored = await upsertSubscription(parsed.data.subscription, parsed.data.reminders);
  if (!stored) return bad("This server is not accepting more push subscriptions.", 507);
  return NextResponse.json({ ok: true, reminders: parsed.data.reminders.length }, noStore);
}

export async function DELETE(request: Request) {
  const parsed = z.object({ endpoint: z.string().url() }).strict().safeParse(await request.json().catch(() => null));
  if (!parsed.success) return bad("Invalid body.");
  await removeSubscription(parsed.data.endpoint);
  return NextResponse.json({ ok: true }, noStore);
}
