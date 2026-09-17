import { describe, expect, it } from "vitest";
import { missingProviderVar, resolveAiCapability } from "./config";

const provider = {
  FOCUSGRID_AI_PROVIDER: "openai",
  FOCUSGRID_AI_MODEL: "gpt-x",
  OPENAI_API_KEY: "sk-test",
};

describe("resolveAiCapability (CFG-01..04)", () => {
  it("default env is off / unavailable / disabled", () => {
    expect(resolveAiCapability({})).toEqual({
      mode: "off",
      available: false,
      reason: "disabled",
    });
  });

  it("fixture mode is available without any key", () => {
    expect(resolveAiCapability({ FOCUSGRID_AI_MODE: "fixture" })).toEqual({
      mode: "fixture",
      available: true,
      reason: null,
    });
  });

  it("provider + local + full config is available", () => {
    expect(
      resolveAiCapability({ FOCUSGRID_AI_MODE: "provider", ...provider }),
    ).toEqual({ mode: "provider", available: true, reason: null });
  });

  it("provider missing key fails closed with config_invalid", () => {
    const env = {
      FOCUSGRID_AI_MODE: "provider",
      FOCUSGRID_AI_PROVIDER: "openai",
      FOCUSGRID_AI_MODEL: "gpt-x",
    };
    expect(resolveAiCapability(env).available).toBe(false);
    expect(resolveAiCapability(env).reason).toBe("config_invalid");
    expect(missingProviderVar(env)).toBe("OPENAI_API_KEY");
  });

  it("provider in public-demo is deployment_blocked, no call possible", () => {
    expect(
      resolveAiCapability({
        FOCUSGRID_AI_MODE: "provider",
        FOCUSGRID_DEPLOYMENT: "public-demo",
        ...provider,
      }),
    ).toEqual({
      mode: "provider",
      available: false,
      reason: "deployment_blocked",
    });
  });

  it("protected deployment stays disabled until a real decision", () => {
    expect(
      resolveAiCapability({
        FOCUSGRID_AI_MODE: "provider",
        FOCUSGRID_DEPLOYMENT: "protected",
        ...provider,
      }).available,
    ).toBe(false);
  });

  it("unknown mode/deployment fails closed", () => {
    expect(resolveAiCapability({ FOCUSGRID_AI_MODE: "magic" }).reason).toBe(
      "config_invalid",
    );
    expect(
      resolveAiCapability({ FOCUSGRID_DEPLOYMENT: "prod" }).reason,
    ).toBe("config_invalid");
  });
});
