import { defineConfig } from "@playwright/test";

// e2e runs against its own production build on its own port, so a `next dev` on 3000 (which lacks the
// fixture AI env and serves no service worker) can never be picked up by mistake.
const PORT = Number(process.env.FOCUSGRID_E2E_PORT) || 3100;

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  use: { baseURL: `http://localhost:${PORT}` },
  webServer: {
    command: `npm run build && npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
    // Fixture AI so capture flows are testable without credentials (CFG-02).
    env: { FOCUSGRID_AI_MODE: "fixture", FOCUSGRID_DEPLOYMENT: "local" },
  },
});
