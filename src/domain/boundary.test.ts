import { describe, expect, it } from "vitest";
import { Linter } from "eslint";

// WAR-00-02 / contract 48.1 — a domain module importing UI / storage / env, or
// touching a browser global, must be flagged. Uses a standalone Linter (no Next
// preset) so the check is fast; `npm run lint` applies the same rule in CI.
const DOMAIN_RULES = {
  "no-restricted-imports": [
    "error",
    { patterns: ["react", "next", "next/*", "**/persistence/*", "**/ai/*", "idb", "openai"] },
  ],
  "no-restricted-globals": ["error", "window", "document", "localStorage", "indexedDB", "process"],
} as const;

describe("domain boundary rules (48.1)", () => {
  const linter = new Linter({ configType: "flat" });

  it("flags a forbidden import and a forbidden global", () => {
    const messages = linter.verify(
      `import React from "react";\nconst x = window.location.href;\nexport { React, x };\n`,
      { rules: DOMAIN_RULES as never },
    );
    const rules = messages.map((m) => m.ruleId);
    expect(rules).toContain("no-restricted-imports");
    expect(rules).toContain("no-restricted-globals");
  });

  it("passes a clean domain file", () => {
    const messages = linter.verify(`export const a = 1;\n`, { rules: DOMAIN_RULES as never });
    expect(messages).toHaveLength(0);
  });
});
