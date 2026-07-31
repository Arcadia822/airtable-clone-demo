import { spawnSync } from "node:child_process"

import { describe, expect, it } from "vitest"

const projectRoot = process.cwd()

function runSeedScript(...args: string[]) {
  return spawnSync(
    process.execPath,
    ["scripts/seed-demo.mjs", ...args],
    {
      cwd: projectRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        CLERK_SECRET_KEY: "",
      },
    },
  )
}

describe("demo seed command", () => {
  it("guides admins with organization names instead of internal identifiers", () => {
    const result = runSeedScript("--help")

    expect(result.status).toBe(0)
    expect(result.stdout).toContain(
      'pnpm seed:demo -- --organization "Acme Studio"',
    )
    expect(result.stdout).toContain("numbered list of")
    expect(result.stdout).not.toMatch(/--org-id|--user-id|org_[a-z0-9]/i)
  })

  it("rejects the old raw-identifier option", () => {
    const result = runSeedScript(
      "--org-id",
      "org_should_not_be_customer_input",
    )

    expect(result.status).toBe(1)
    expect(result.stderr).toContain("Unknown option: --org-id")
  })

  it("keeps production seeding behind explicit confirmation", () => {
    const result = runSeedScript("--prod")

    expect(result.status).toBe(1)
    expect(result.stderr).toContain(
      "Production seeding requires both --prod and --confirm-production.",
    )
  })
})
