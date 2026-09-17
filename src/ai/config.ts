/**
 * AI runtime configuration — CONFIGURATION.md CFG-01..04. Server-only.
 * The core local application never depends on this; a failed/absent config
 * disables AI capture and nothing else.
 */
if (typeof window !== "undefined") {
  throw new Error("src/ai/config.ts is server-only and must not reach the browser");
}

import { llmConfig } from "./llm";

export type AiMode = "off" | "fixture" | "provider";
export type AiCapabilityReason =
  | "disabled"
  | "config_invalid"
  | "deployment_blocked"
  | null;

/** The only shape allowed to cross to the client (CFG-04). No secrets. */
export interface AiCapability {
  mode: AiMode;
  available: boolean;
  reason: AiCapabilityReason;
}

type Env = Record<string, string | undefined>;

function nonempty(v: string | undefined): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

/** Pure: resolve capability from an environment snapshot. Tested directly. */
export function resolveAiCapability(env: Env): AiCapability {
  const rawMode = env.FOCUSGRID_AI_MODE ?? "off";
  const rawDeployment = env.FOCUSGRID_DEPLOYMENT ?? "local";

  const deploymentKnown = ["local", "public-demo", "protected"].includes(
    rawDeployment,
  );
  if (!deploymentKnown) {
    return { mode: "off", available: false, reason: "config_invalid" };
  }
  if (!["off", "fixture", "provider"].includes(rawMode)) {
    return { mode: "off", available: false, reason: "config_invalid" };
  }
  const mode = rawMode as AiMode;
  const deployment = rawDeployment as "local" | "public-demo" | "protected";

  if (mode === "off") {
    return { mode, available: false, reason: "disabled" };
  }
  if (mode === "fixture") {
    return { mode, available: true, reason: null };
  }

  // provider mode
  if (deployment === "public-demo") {
    return { mode, available: false, reason: "deployment_blocked" };
  }
  if (deployment === "protected") {
    // Reserved until a real auth + abuse-limit deployment decision (CFG-03).
    return { mode, available: false, reason: "deployment_blocked" };
  }
  // deployment === "local"
  const providerOk = env.FOCUSGRID_AI_PROVIDER === "openai";
  const modelOk = nonempty(env.FOCUSGRID_AI_MODEL);
  const keyOk = nonempty(env.OPENAI_API_KEY);
  if (!providerOk || !modelOk || !keyOk) {
    return { mode, available: false, reason: "config_invalid" };
  }
  return { mode, available: true, reason: null };
}

/** Name of the first missing/invalid provider variable — dev diagnostic only,
 * never its value (CFG-02). */
export function missingProviderVar(env: Env): string | null {
  if (env.FOCUSGRID_AI_PROVIDER !== "openai") return "FOCUSGRID_AI_PROVIDER";
  if (!nonempty(env.FOCUSGRID_AI_MODEL)) return "FOCUSGRID_AI_MODEL";
  if (!nonempty(env.OPENAI_API_KEY)) return "OPENAI_API_KEY";
  return null;
}

export function currentAiCapability(): AiCapability {
  return resolveAiCapability(process.env as Env);
}

/** assistant agent (any configured LLM + web search). Local deployments only, like provider capture. */
export function agentAvailable(env: Env = process.env as Env): boolean {
  return llmConfig(env) !== null && (env.FOCUSGRID_DEPLOYMENT ?? "local") === "local";
}
