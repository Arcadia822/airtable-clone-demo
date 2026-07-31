import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

const WRITE_TOOLS = [
  "create_field.ts",
  "create_form.ts",
  "create_record.ts",
  "delete_field.ts",
  "delete_record.ts",
  "update_form_settings.ts",
  "update_record.ts",
]

describe("assistant tool safety contracts", () => {
  const toolsDirectory = join(process.cwd(), "agent", "tools")

  it.each(WRITE_TOOLS)("%s requires explicit user approval", (filename) => {
    const source = readFileSync(join(toolsDirectory, filename), "utf8")

    expect(source).toMatch(
      /approval:\s*\(ctx\)\s*=>\s*requireEveryWriteApproval\(ctx\)/,
    )
  })

  it("does not disable EVE default tools with local wrappers", () => {
    const authoredTools = readdirSync(toolsDirectory)
      .filter((filename) => filename.endsWith(".ts"))
      .map((filename) => readFileSync(join(toolsDirectory, filename), "utf8"))
      .join("\n")

    expect(authoredTools).not.toMatch(/\bdisableTool\s*\(/)
  })
})
