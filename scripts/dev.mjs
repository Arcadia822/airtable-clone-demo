import { spawn, spawnSync } from "node:child_process"
import { existsSync } from "node:fs"

for (const file of [".env.local", ".env.development.local"]) {
  if (existsSync(file)) process.loadEnvFile(file)
}

const env = { ...process.env }
const convexSiteUrl = requiredUrl(
  env.NEXT_PUBLIC_CONVEX_SITE_URL,
  "NEXT_PUBLIC_CONVEX_SITE_URL",
)

env.EVE_CONVEX_BRIDGE_URL ||= new URL(
  "/eve/assistant",
  convexSiteUrl,
).toString()
env.EVE_SESSION_OWNERSHIP_URL ||= new URL(
  "/eve/session-ownership",
  convexSiteUrl,
).toString()
env.EVE_CONVEX_HMAC_KEY_ID ||= "primary"
env.EVE_ALLOWED_ORIGINS ||=
  "http://localhost:3000,http://127.0.0.1:3000"
env.NEXT_PUBLIC_APP_URL ||= "http://localhost:3000"
env.EVE_CONVEX_HMAC_SECRET ||= readConvexEnvironment(
  "EVE_CONVEX_HMAC_SECRET",
  env,
)

console.log(
  `[dev] EVE is connected to ${new URL(convexSiteUrl).hostname} with session ownership enabled.`,
)

const command = process.platform === "win32" ? "pnpm.cmd" : "pnpm"
const child = spawn(
  command,
  ["exec", "convex", "dev", "--start", "next dev"],
  {
    env,
    stdio: "inherit",
  },
)

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal))
}

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
    return
  }
  process.exitCode = code ?? 1
})

function readConvexEnvironment(name, inheritedEnvironment) {
  const command = process.platform === "win32" ? "pnpm.cmd" : "pnpm"
  const result = spawnSync(
    command,
    ["exec", "convex", "env", "get", name],
    {
      encoding: "utf8",
      env: inheritedEnvironment,
      stdio: ["ignore", "pipe", "pipe"],
    },
  )
  const value = result.stdout?.trim()
  if (result.status !== 0 || !value) {
    const detail = result.stderr?.trim()
    throw new Error(
      `Unable to load ${name} from the linked Convex development deployment.${
        detail ? ` ${detail}` : ""
      }`,
    )
  }
  return value
}

function requiredUrl(value, name) {
  if (!value) {
    throw new Error(`${name} is required before starting development.`)
  }
  try {
    return new URL(value).toString()
  } catch {
    throw new Error(`${name} must be a valid absolute URL.`)
  }
}
