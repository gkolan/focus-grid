import { NextResponse } from "next/server";
import { currentAiCapability } from "@/ai/config";
import { interpret } from "@/ai/adapter";
import { interpretRequestSchema, MAX_REQUEST_BYTES } from "@/ai/schema";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function envelope(code: string, message: string, status: number) {
  return NextResponse.json(
    { error: { code, message, diagnosticId: crypto.randomUUID() } },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request) {
  // CFG-03 — local mode is loopback-only defence in depth.
  const cap = currentAiCapability();
  if (cap.mode === "provider" && (process.env.FOCUSGRID_DEPLOYMENT ?? "local") === "local") {
    const host = request.headers.get("host") ?? "";
    const loopback = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host);
    if (!loopback) return envelope("AI_UNAVAILABLE", "AI capture is unavailable.", 403);
  }

  if (!request.headers.get("content-type")?.includes("application/json")) {
    return envelope("VALIDATION", "Expected application/json.", 400);
  }

  const text = await request.text();
  if (new TextEncoder().encode(text).length > MAX_REQUEST_BYTES) {
    return envelope("VALIDATION", "Request body too large.", 413);
  }

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return envelope("VALIDATION", "Invalid JSON.", 400);
  }

  const parsed = interpretRequestSchema.safeParse(json);
  if (!parsed.success) {
    return envelope("VALIDATION", parsed.error.issues[0]?.message ?? "Invalid request.", 400);
  }

  if (!cap.available) {
    const status = cap.reason === "deployment_blocked" ? 403 : 503;
    return envelope("AI_UNAVAILABLE", "AI capture is unavailable.", status);
  }

  const result = await interpret(parsed.data, cap);
  if (!result.ok) {
    return envelope(result.code, result.message, result.status);
  }
  return NextResponse.json(result.response, { headers: { "Cache-Control": "no-store" } });
}

export function GET() {
  return envelope("VALIDATION", "Use POST.", 405);
}
