#!/usr/bin/env node

import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"

const argumentsFromCli = process.argv.slice(2)
const connected = argumentsFromCli.includes("--connected")
const forwardedArguments = argumentsFromCli.filter(
  (argument) => argument !== "--connected" && argument !== "--",
)

if (connected) {
  if (
    typeof process.loadEnvFile === "function" &&
    existsSync(".env.local")
  ) {
    process.loadEnvFile(".env.local")
  }

  if (!process.env.E2E_CLERK_ORGANIZATION_NAME?.trim()) {
    console.error(
      [
        "Connected browser tests can create and update real development data.",
        "Set E2E_CLERK_ORGANIZATION_NAME to a dedicated disposable Clerk development organization before running them.",
      ].join(" "),
    )
    process.exitCode = 1
  } else {
    runPlaywright()
  }
} else {
  runPlaywright()
}

function runPlaywright() {
  const command = process.platform === "win32" ? "pnpm.cmd" : "pnpm"
  const projects = connected
    ? ["--project=connected"]
    : ["--project=chromium", "--project=mobile"]
  const result = spawnSync(
    command,
    ["exec", "playwright", "test", ...projects, ...forwardedArguments],
    {
      env: {
        ...process.env,
        BASECRAFT_CONNECTED_E2E: connected ? "1" : "0",
      },
      stdio: "inherit",
    },
  )

  if (result.error) {
    throw result.error
  }
  process.exitCode = result.status ?? 1
}
