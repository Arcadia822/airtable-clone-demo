import { defineConfig, devices } from "@playwright/test"

/**
 * End-to-end suite for the shipped product surface.
 *
 * The suite runs against `next start` (run `pnpm build` first) with a throwaway
 * PGlite database so every run starts from the seeded workspace. A dedicated
 * port keeps a local `next dev` on 3000 untouched.
 */
const PORT = Number(process.env.E2E_PORT ?? 3100)
const DATABASE_URL = "pglite:.data/e2e"

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  // The suite is stateful (one seeded database, serial ordering); a retry would
  // replay tests against already-mutated data, so failures stay failures.
  retries: 0,
  workers: 1,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    // Fresh database per run: the first request seeds the workspace.
    command: `rm -rf ${DATABASE_URL.slice("pglite:".length)} && pnpm start --port ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 180_000,
    gracefulShutdown: { signal: "SIGTERM", timeout: 10_000 },
    env: {
      DATABASE_URL,
      PORT: String(PORT),
      NEXT_TELEMETRY_DISABLED: "1",
      // Local single-tenant mode: no Factory visitor auth, no Factory AI.
      FACTORY_VISITOR_AUTH_URL: "",
      FACTORY_VISITOR_AUTH_TOKEN: "",
      FACTORY_APP_AI_URL: "",
      FACTORY_APP_AI_TOKEN: "",
    },
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
})
