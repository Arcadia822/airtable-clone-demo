#!/usr/bin/env node

import { createClerkClient } from "@clerk/backend"
import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import process from "node:process"
import { createInterface } from "node:readline/promises"

const HELP = `
Seed a realistic Basecraft workspace into a Convex deployment.

Usage:
  pnpm seed:demo
  pnpm seed:demo -- --organization "Acme Studio"

Options:
  --organization <name> Choose a Clerk organization by its visible name
  --creator-email <email>
                        Optionally record an organization member as creator
  --local              Target the linked local Convex deployment
  --prod               Target the project's production deployment
  --confirm-production Required together with --prod
  --help               Show this help

Without --organization, an interactive terminal shows a numbered list of
organizations. CLERK_SECRET_KEY is read from the environment or .env.local.
The command invokes the same admin-only mutation used by the app. It is
idempotent per organization: rerunning it never creates a duplicate workspace.
It is a privileged deployment-admin convenience and always applies Free-plan
limits; normal users should use the signed-in dashboard action.
`.trim()

const VALUE_OPTIONS = new Set(["--organization", "--creator-email"])
const BOOLEAN_OPTIONS = new Set([
  "--local",
  "--prod",
  "--confirm-production",
  "--help",
  "-h",
])

function validateArguments() {
  const args = process.argv.slice(2).filter((argument) => argument !== "--")
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (VALUE_OPTIONS.has(argument)) {
      const value = args[index + 1]
      if (!value || value.startsWith("--")) {
        throw new Error(`${argument} requires a value.`)
      }
      index += 1
      continue
    }
    if (!BOOLEAN_OPTIONS.has(argument)) {
      throw new Error(`Unknown option: ${argument}`)
    }
  }
}

function option(name) {
  const index = process.argv.indexOf(name)
  if (index === -1) return undefined
  const value = process.argv[index + 1]
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a value.`)
  }
  return value
}

function hasFlag(name) {
  return process.argv.includes(name)
}

function loadLocalEnvironment() {
  if (typeof process.loadEnvFile !== "function") return
  for (const path of [".env.local", ".env"]) {
    if (!existsSync(path)) continue
    process.loadEnvFile(path)
  }
}

function organizationLabel(organization) {
  const members =
    typeof organization.membersCount === "number"
      ? ` · ${organization.membersCount} member${organization.membersCount === 1 ? "" : "s"}`
      : ""
  return `${organization.name}${members}`
}

async function chooseFromList(items, prompt) {
  if (items.length === 0) {
    throw new Error("No Clerk organizations are available.")
  }
  if (!process.stdin.isTTY) {
    throw new Error(
      "Choose an organization by name with --organization.",
    )
  }

  const readline = createInterface({
    input: process.stdin,
    output: process.stdout,
  })
  try {
    console.log("\nAvailable organizations:")
    items.forEach((item, index) => {
      console.log(`  ${index + 1}. ${organizationLabel(item)}`)
    })
    const answer = await readline.question(`\n${prompt}: `)
    const selectedIndex = Number.parseInt(answer.trim(), 10) - 1
    if (
      !Number.isInteger(selectedIndex) ||
      selectedIndex < 0 ||
      selectedIndex >= items.length
    ) {
      throw new Error(`Choose a number between 1 and ${items.length}.`)
    }
    return items[selectedIndex]
  } finally {
    readline.close()
  }
}

async function resolveOrganization(clerk) {
  const requestedName =
    option("--organization") ??
    process.env.DEMO_ORGANIZATION?.trim()
  const response = await clerk.organizations.getOrganizationList({
    includeMembersCount: true,
    limit: 100,
    orderBy: "+name",
    ...(requestedName ? { query: requestedName } : {}),
  })
  const organizations = response.data

  if (!requestedName) {
    return chooseFromList(organizations, "Choose an organization")
  }

  const normalizedName = requestedName.trim().toLocaleLowerCase()
  const exactMatches = organizations.filter(
    (organization) =>
      organization.name.trim().toLocaleLowerCase() === normalizedName,
  )
  if (exactMatches.length === 1) return exactMatches[0]
  if (exactMatches.length > 1) {
    return chooseFromList(
      exactMatches,
      `Choose the ${requestedName} organization`,
    )
  }
  if (organizations.length === 1) return organizations[0]
  if (organizations.length > 1) {
    return chooseFromList(
      organizations,
      `Choose the organization matching ${requestedName}`,
    )
  }
  throw new Error(
    `No Clerk organization named “${requestedName}” was found.`,
  )
}

async function resolveCreatorUserId(clerk, organizationId) {
  const email = option("--creator-email")?.trim()
  if (!email) return "basecraft-demo-seed-cli"
  const response = await clerk.users.getUserList({
    emailAddress: [email],
    limit: 10,
    organizationId: [organizationId],
  })
  const matchingUsers = response.data.filter((user) =>
    user.emailAddresses.some(
      (address) =>
        address.emailAddress.toLocaleLowerCase() ===
        email.toLocaleLowerCase(),
    ),
  )
  if (matchingUsers.length !== 1) {
    throw new Error(
      matchingUsers.length === 0
        ? `No member of this organization uses ${email}.`
        : `More than one member uses ${email}; omit --creator-email and use the in-app action instead.`,
    )
  }
  return matchingUsers[0].id
}

async function main() {
  validateArguments()
  if (hasFlag("--help") || hasFlag("-h")) {
    console.log(HELP)
    return
  }

  const production = hasFlag("--prod")
  const local = hasFlag("--local")
  if (hasFlag("--confirm-production") && !production) {
    throw new Error("--confirm-production can only be used with --prod.")
  }
  if (production && local) {
    throw new Error("Use either --local or --prod, not both.")
  }
  if (production && !hasFlag("--confirm-production")) {
    throw new Error(
      "Production seeding requires both --prod and --confirm-production.",
    )
  }
  loadLocalEnvironment()
  const secretKey = process.env.CLERK_SECRET_KEY?.trim()
  if (!secretKey) {
    throw new Error(
      "Add CLERK_SECRET_KEY to .env.local so the seed command can show your organizations.",
    )
  }
  const clerk = createClerkClient({ secretKey })
  const organization = await resolveOrganization(clerk)
  const orgId = organization.id
  const userId = await resolveCreatorUserId(clerk, orgId)

  const identity = JSON.stringify({
    subject: userId,
    tokenIdentifier: `basecraft-demo-seed:${userId}`,
    org_id: orgId,
    org_role: "org:admin",
    pla: "o:free",
  })
  const command = [
    "exec",
    "convex",
    "run",
    "demoSeed:install",
    "{}",
    "--identity",
    identity,
    "--typecheck",
    "disable",
    "--codegen",
    "disable",
  ]
  const deployment = production
    ? "production"
    : local
      ? "the linked local deployment"
      : "the linked development deployment"
  if (production) command.push("--prod")
  if (local) command.push("--deployment", "local")

  console.log(
    "Deployment-admin seed: choose the in-app action when membership verification is required.",
  )
  console.log(
    `Loading demo data for ${organization.name} into ${deployment}…`,
  )
  const result = spawnSync(
    process.platform === "win32" ? "pnpm.cmd" : "pnpm",
    command,
    {
      encoding: "utf8",
      stdio: ["inherit", "pipe", "pipe"],
    },
  )
  if (result.error) throw result.error
  if (result.status !== 0) {
    console.error(
      "Convex could not load the demo workspace. Check the linked deployment and try again.",
    )
    process.exitCode = result.status ?? 1
    return
  }
  let summary
  try {
    summary = JSON.parse(result.stdout.trim())
  } catch {
    summary = undefined
  }
  const counts = summary?.counts
  if (
    counts &&
    typeof counts.tables === "number" &&
    typeof counts.fields === "number" &&
    typeof counts.records === "number" &&
    typeof counts.forms === "number"
  ) {
    const stateCopy =
      summary.state === "created"
        ? "Demo workspace created"
        : summary.state === "existing"
          ? "Demo workspace already loaded"
          : summary.state === "deleted"
            ? "Demo workspace is in the trash"
            : "Demo workspace needs deployment-admin repair"
    console.log(
      `${stateCopy}: ${counts.tables} tables, ${counts.fields} columns, ${counts.records} records, and ${counts.forms} ${counts.forms === 1 ? "form" : "forms"}.`,
    )
  } else {
    console.log("Demo workspace command completed.")
  }
  console.log(
    'Demo seed command complete. Restore a "deleted" result in the dashboard; a "missing" result needs deployment-admin repair.',
  )
}

main().catch((error) => {
  const clerkMessage =
    error !== null &&
    typeof error === "object" &&
    Array.isArray(error.errors) &&
    typeof error.errors[0]?.message === "string"
      ? error.errors[0].message
      : undefined
  const message =
    (error instanceof Error && error.message.trim()) ||
    clerkMessage ||
    "The demo seed command failed."
  console.error(
    message === "fetch failed"
      ? "Clerk could not be reached. Check your connection and try again."
      : message,
  )
  process.exitCode = 1
})
