import { describe, expect, it } from "vitest"

import { resolveEveHost } from "./host"

describe("resolveEveHost", () => {
  it("uses an explicit or configured agent origin", () => {
    expect(
      resolveEveHost({
        configuredHost: "https://agent.example.com/eve",
        explicitHost: "https://override.example.com/path",
        nodeEnv: "production",
      }),
    ).toBe("https://override.example.com")
  })

  it("uses a cookie-free loopback origin during local development", () => {
    expect(
      resolveEveHost({
        currentUrl: "http://localhost:3000/bases/example",
        nodeEnv: "development",
      }),
    ).toBe("http://127.0.0.1:3000")

    expect(
      resolveEveHost({
        currentUrl: "http://127.0.0.1:3000/bases/example",
        nodeEnv: "development",
      }),
    ).toBe("http://localhost:3000")

    expect(
      resolveEveHost({
        configuredHost: "http://localhost:3000",
        currentUrl: "http://localhost:3000/bases/example",
        nodeEnv: "development",
      }),
    ).toBe("http://127.0.0.1:3000")
  })

  it("does not invent a production host", () => {
    expect(
      resolveEveHost({
        currentUrl: "https://app.example.com",
        nodeEnv: "production",
      }),
    ).toBeUndefined()
  })
})
