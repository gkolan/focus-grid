import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Contract 48.1 — pure domain modules must not import frameworks, browser
  // globals, storage, Next.js, AI SDKs, or environment access.
  {
    files: ["src/domain/**/*.{ts,tsx}"],
    ignores: ["src/domain/**/*.test.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            "react",
            "react-dom",
            "next",
            "next/*",
            "server-only",
            "**/persistence/*",
            "**/ai/*",
            "**/app/*",
            "idb",
            "openai",
            "@ai-sdk/*",
          ],
        },
      ],
      "no-restricted-globals": [
        "error",
        "window",
        "document",
        "localStorage",
        "indexedDB",
        "process",
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
