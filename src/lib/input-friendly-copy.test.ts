import { readdirSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

function findCustomerTsxFiles(directory: string): string[] {
  return readdirSync(resolve(process.cwd(), directory), {
    withFileTypes: true,
  }).flatMap((entry) => {
    const file = `${directory}/${entry.name}`

    if (entry.isDirectory()) {
      return findCustomerTsxFiles(file)
    }

    if (!entry.name.endsWith(".tsx") || entry.name.endsWith(".test.tsx")) {
      return []
    }

    return [file]
  })
}

const EDITABLE_CONTROL_SURFACES = [
  ...findCustomerTsxFiles("src/app"),
  ...findCustomerTsxFiles("src/components").filter(
    (file) => !file.startsWith("src/components/ui/"),
  ),
].sort()

const CUSTOMER_SURFACES = [
  "src/components/currency-select.tsx",
  "src/components/searchable-select.tsx",
  "src/components/component-error-boundary.tsx",
  "src/components/assistant/assistant-panel.tsx",
  "src/components/connected/form-editor.tsx",
  "src/components/connected/field-conversion-dialog.tsx",
  "src/components/connected/form-analytics.tsx",
  "src/components/connected/form-submissions.tsx",
  "src/components/connected/forms-list.tsx",
  "src/components/connected/app-navigation.tsx",
  "src/components/connected/base-overview.tsx",
  "src/components/connected/connection-status.tsx",
  "src/components/connected/dashboard.tsx",
  "src/components/connected/global-search.tsx",
  "src/components/connected/connection-required.tsx",
  "src/components/connected/organization-auth-gate.tsx",
  "src/components/connected/org-states.tsx",
  "src/components/connected/view-controls.tsx",
  "src/components/connected/view-switcher.tsx",
  "src/components/connected/workspace.tsx",
  "src/components/app-command-palette.tsx",
  "src/components/billing/organization-pricing-table.tsx",
  "src/components/forms/conditional-logic-editor.tsx",
  "src/components/forms/form-builder.tsx",
  "src/components/forms/connected-public-form.tsx",
  "src/components/forms/public-form.tsx",
  "src/components/grid/data-grid.tsx",
  "src/components/views/calendar-view.tsx",
  "src/components/views/gallery-view.tsx",
  "src/components/views/kanban-view.tsx",
  "src/components/views/record-drawer.tsx",
  "src/components/workspace/workspace-shell.tsx",
  "src/app/(clerk)/page.tsx",
  "src/lib/plans.ts",
]

const RETIRED_COPY = [
  "Maps to table field",
  "Maps to field",
  "Field ID",
  "Record ID",
  "Internal key",
  "Raw map",
  "destination table",
  "Draft revision",
  "Raw events stored",
  "Convex storage",
  "pagination boundaries",
  "Currency code",
  "Customize new field",
  "Field type",
  "Organization context required",
  "this environment yet",
  "Loading Clerk plan",
  "record or schema updates",
  "Clerk stays authoritative",
  "checked with Clerk has()",
  "Column ID",
  "Table ID",
  "Base ID",
  "View ID",
  "Form ID",
  "Organization ID",
  "Mapping key",
  "Submission ID",
  "Storage ID",
  "Public slug",
  "Opaque reference",
  "Field map",
  "Idempotency key",
  "API key",
  "URL slug",
  "Paste an ID",
  "Enter an ID",
  "Enter a key",
]

const PLAIN_LANGUAGE_SURFACES = [
  "src/app/(clerk)/page.tsx",
  "src/components/component-error-boundary.tsx",
  "src/components/analytics/form-analytics.tsx",
  "src/components/assistant/assistant-panel.tsx",
  "src/components/auth/auth-shell.tsx",
  "src/components/auth/organization-onboarding.tsx",
  "src/components/billing/organization-pricing-table.tsx",
  "src/components/connected/assistant-sheet.tsx",
  "src/components/connected/base-overview.tsx",
  "src/components/connected/dashboard.tsx",
  "src/components/connected/form-analytics.tsx",
  "src/components/connected/connection-status.tsx",
  "src/components/connected/global-search.tsx",
  "src/components/connected/org-states.tsx",
  "src/components/forms/conditional-logic-editor.tsx",
  "src/components/forms/public-form.tsx",
  "src/components/workspace/demo-workspace.tsx",
  "src/components/workspace/workspace-shell.tsx",
  "src/lib/plans.ts",
]

const PLAIN_LANGUAGE_RETIRED_COPY = [
  "map every question to a field",
  "approve the exact diff",
  "EVE can inspect bounded data",
  "isolated to a Clerk organization",
  "Clerk is the source of truth",
  "powered by Clerk",
  "EVE-powered assistant",
  "authenticated EVE session",
  "Read tools are bounded",
  "synchronize through Convex",
  "Plan not configured",
  "Billing entitlements",
  "committed submissions",
  "committed records",
  "primary text field",
  "primary field",
  "finish field setup",
  "field added",
  "field removed",
  "required fields",
  "answer field unavailable",
  "ai field insights",
  "response must include this field",
  "typed fields",
  "Ask about records, fields",
  "AI assistant turns",
  "organization seats",
  "active data structures",
  "structural change",
  "workspace index",
  "data connection",
  "full workspace control",
  "realtime grids and their current structure",
]

describe("input-friendly customer copy", () => {
  it.each(CUSTOMER_SURFACES)("%s does not contain retired technical copy", (file) => {
    const source = readFileSync(resolve(process.cwd(), file), "utf8")

    for (const phrase of RETIRED_COPY) {
      expect(source).not.toContain(phrase)
    }
  })

  it("uses customer language for column and form destinations", () => {
    const grid = readFileSync(
      resolve(process.cwd(), "src/components/grid/data-grid.tsx"),
      "utf8",
    )
    const editor = readFileSync(
      resolve(process.cwd(), "src/components/connected/form-editor.tsx"),
      "utf8",
    )

    expect(grid).toContain("Customize new column")
    expect(editor).toContain("Save answers in")
  })

  it.each(PLAIN_LANGUAGE_SURFACES)(
    "%s avoids implementation language in customer-facing copy",
    (file) => {
      const source = readFileSync(resolve(process.cwd(), file), "utf8").toLowerCase()

      for (const phrase of PLAIN_LANGUAGE_RETIRED_COPY) {
        expect(source).not.toContain(phrase.toLowerCase())
      }
    },
  )

  it("keeps destination and currency inputs name-based", () => {
    const formsList = readFileSync(
      resolve(process.cwd(), "src/components/connected/forms-list.tsx"),
      "utf8",
    )
    const currencySelect = readFileSync(
      resolve(process.cwd(), "src/components/currency-select.tsx"),
      "utf8",
    )

    expect(formsList).toContain("<SearchableSelect")
    expect(formsList).toContain("label: table.name")
    expect(formsList).toContain("Save responses in")
    expect(currencySelect).toContain("currencyOptionLabel(option)")
    expect(currencySelect).toContain("Unavailable currency")
    expect(currencySelect).not.toContain("{value} currency")
  })

  it.each(EDITABLE_CONTROL_SURFACES)(
    "%s supplies readable selected text instead of exposing stored select values",
    (file) => {
      const source = readFileSync(resolve(process.cwd(), file), "utf8")

      expect(source).not.toMatch(/<SelectValue(?:\s+[^>]*)?\s*\/>/)
    },
  )

  it.each(EDITABLE_CONTROL_SURFACES)(
    "%s gives every editable control a programmatic name",
    (file) => {
      const source = readFileSync(resolve(process.cwd(), file), "utf8")
      const controlTags = [
        "CommandInput",
        "Input",
        "Textarea",
        "SearchableSelect",
        "SelectTrigger",
        "Switch",
        "Checkbox",
        "input",
        "textarea",
        "select",
      ]

      for (const tag of controlTags) {
        const selfClosing = [
          "CommandInput",
          "Input",
          "Textarea",
          "SearchableSelect",
          "Switch",
          "Checkbox",
          "input",
          "textarea",
        ].includes(tag)
        const openingTags =
          source.match(
            new RegExp(
              selfClosing
                ? `<${tag}\\b[\\s\\S]*?\\/>`
                : `<${tag}\\b[^>]*>`,
              "g",
            ),
          ) ?? []
        for (const openingTag of openingTags) {
          if (
            tag.toLowerCase() === "input" &&
            /type=["']hidden["']/.test(openingTag)
          ) {
            continue
          }
          expect(openingTag).toMatch(/\b(?:aria-label|id)=/)
        }
      }
    },
  )

  it("routes column type changes through a named review before applying them", () => {
    const workspace = readFileSync(
      resolve(process.cwd(), "src/components/connected/workspace.tsx"),
      "utf8",
    )
    const dialog = readFileSync(
      resolve(
        process.cwd(),
        "src/components/connected/field-conversion-dialog.tsx",
      ),
      "utf8",
    )

    expect(workspace).toContain("api.fields.previewTypeConversion")
    expect(workspace).toContain("api.fields.applyTypeConversion")
    expect(workspace).toContain("<FieldConversionDialog")
    expect(dialog).toContain("See exactly what will happen to saved values")
    expect(dialog).toContain("Places to review")
    expect(dialog).not.toContain("expectedFieldRevision")
    expect(dialog).not.toContain("previewVersion")
  })

  it("keeps public-link autofill answer-first and hides generated link details", () => {
    const editor = readFileSync(
      resolve(process.cwd(), "src/components/connected/form-editor.tsx"),
      "utf8",
    )

    expect(editor).toContain("Start with an answer filled in")
    expect(editor).toContain("Starting answer")
    expect(editor).toContain("Copy link with this answer")
    expect(editor).not.toContain('placeholder="customer_email"')
    expect(editor).not.toContain("Name used in the share link")
    expect(editor).not.toContain("Advanced: customize the share-link name")
  })

  it("names icon-only question controls in both responsive form-builder layouts", () => {
    const builder = readFileSync(
      resolve(process.cwd(), "src/components/forms/form-builder.tsx"),
      "utf8",
    )

    expect(builder.match(/aria-label="Add question"/g)).toHaveLength(2)
  })

  it("keeps public links readable while preserving links that were already shared", () => {
    const slugHelpers = readFileSync(
      resolve(process.cwd(), "convex/lib/formSlugs.ts"),
      "utf8",
    )
    const migrations = readFileSync(
      resolve(process.cwd(), "convex/migrations.ts"),
      "utf8",
    )
    const publicForm = readFileSync(
      resolve(
        process.cwd(),
        "src/components/forms/connected-public-form.tsx",
      ),
      "utf8",
    )

    expect(slugHelpers).toContain("suffixedSlug(base, attempt)")
    expect(slugHelpers).not.toContain("randomUUID")
    expect(slugHelpers).toContain('"formSlugAliases"')
    expect(migrations).toContain("backfillFriendlyFormSlugs")
    expect(publicForm).toContain("window.history.replaceState")
  })
})
