import { defineConfig, devices } from "@playwright/test"

const connectedE2E = process.env.BASECRAFT_CONNECTED_E2E === "1"

if (connectedE2E && typeof process.loadEnvFile === "function") {
  try {
    process.loadEnvFile(".env.local")
  } catch {
    // Connected CI can supply its own environment without a local file.
  }
}
if (connectedE2E) {
  process.env.CLERK_PUBLISHABLE_KEY ??=
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
}

const connectedAuthState = "playwright/.clerk/user.json"

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : 2,
  reporter: "html",
  use: {
    // Clerk treats localhost as its supported local-HTTP development origin.
    // Using 127.0.0.1 can make handshake cookies cross-site and unusable.
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
  },
  webServer: {
    command: connectedE2E ? "pnpm dev" : "pnpm dev:next",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: connectedE2E
    ? [
        {
          name: "setup",
          testMatch: /connected-auth\.setup\.ts/,
        },
        {
          name: "connected",
          dependencies: ["setup"],
          testMatch: /connected-(?:experience|ai)\.spec\.ts/,
          use: {
            ...devices["Desktop Chrome"],
            storageState: connectedAuthState,
          },
        },
      ]
    : [
        {
          name: "chromium",
          use: { ...devices["Desktop Chrome"] },
          testIgnore: /connected-(?:experience|ai)\.spec\.ts/,
        },
        {
          name: "mobile",
          use: { ...devices["iPhone 14"] },
          testIgnore: /connected-(?:experience|ai)\.spec\.ts/,
        },
      ],
})
