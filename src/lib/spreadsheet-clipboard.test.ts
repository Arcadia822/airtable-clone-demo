import { describe, expect, it } from "vitest"

import type {
  CellValue,
  FieldConfig,
  FieldDefinition,
  FieldType,
  GridRecord,
} from "@/lib/domain"
import {
  convertClipboardCell,
  convertClipboardRectangle,
  formatClipboardCellValue,
  parseAndConvertClipboard,
  parseClipboardRectangle,
  serializeClipboardRectangle,
} from "@/lib/spreadsheet-clipboard"

function field(
  id: string,
  name: string,
  type: FieldType,
  config: FieldConfig = {},
): FieldDefinition {
  return {
    id,
    name,
    type,
    config,
    rank: id,
    width: 160,
    isPrimary: false,
  }
}

function record(
  id: string,
  values: Record<string, CellValue>,
  overrides: Partial<GridRecord> = {},
): GridRecord {
  return {
    id,
    rank: id,
    values,
    revision: 1,
    createdAt: new Date(2026, 6, 30, 9, 15).getTime(),
    createdBy: "Maya Chen",
    updatedAt: new Date(2026, 6, 30, 10, 30).getTime(),
    updatedBy: "Maya Chen",
    ...overrides,
  }
}

describe("parseClipboardRectangle", () => {
  it("parses TSV and preserves empty cells, trailing cells, and blank rows", () => {
    expect(parseClipboardRectangle("A\t\tC\n\tB\t\n\nD")).toEqual([
      ["A", "", "C"],
      ["", "B", ""],
      ["", "", ""],
      ["D", "", ""],
    ])
    expect(parseClipboardRectangle("A\tB\t")).toEqual([["A", "B", ""]])
  })

  it("parses CSV-ish input and quoted delimiters, quotes, and newlines", () => {
    expect(
      parseClipboardRectangle(
        'Name,Notes,Status\r\n"Launch, mobile","Line one\nLine two","In ""review"""',
      ),
    ).toEqual([
      ["Name", "Notes", "Status"],
      ["Launch, mobile", "Line one\nLine two", 'In "review"'],
    ])
  })

  it("does not split quoted tabs or a quoted single-cell comma", () => {
    expect(parseClipboardRectangle('"Alpha\tBeta"\tDone')).toEqual([
      ["Alpha\tBeta", "Done"],
    ])
    expect(parseClipboardRectangle('"Alpha, Beta"')).toEqual([
      ["Alpha, Beta"],
    ])
  })

  it("handles a UTF-8 marker, CRLF, and a final row break", () => {
    expect(parseClipboardRectangle("\uFEFFA\tB\r\nC\tD\r\n")).toEqual([
      ["A", "B"],
      ["C", "D"],
    ])
  })
})

describe("clipboard serialization", () => {
  const status = field("status", "Status", "singleSelect", {
    options: [
      { id: "opaque_planned_92", label: "Planned", color: "#999" },
      { id: "opaque_review_18", label: "In review", color: "#00f" },
    ],
  })
  const channels = field("channels", "Channels", "multiSelect", {
    options: [
      { id: "opaque_web_15", label: "Web", color: "#00f" },
      { id: "opaque_email_26", label: "Email", color: "#f0f" },
    ],
  })

  it("copies choice names, percentages, dates, checks, and file names", () => {
    const fields = [
      status,
      channels,
      field("progress", "Progress", "percent", { precision: 0 }),
      field("score", "Score", "rating"),
      field("due", "Due", "date", { dateStyle: "date" }),
      field("done", "Done", "checkbox"),
      field("files", "Files", "attachment"),
    ]
    const source = record("one", {
      status: "opaque_review_18",
      channels: ["opaque_web_15", "opaque_email_26"],
      progress: 0.75,
      score: 4,
      due: new Date(2026, 6, 30).getTime(),
      done: true,
      files: [
        {
          id: "attachment_private_42",
          name: "Launch plan.pdf",
          mimeType: "application/pdf",
          size: 1200,
        },
      ],
    })

    const serialized = serializeClipboardRectangle([source], fields)
    expect(serialized).toBe(
      'In review\t"Web, Email"\t75%\t4\t2026-07-30\tChecked\tLaunch plan.pdf',
    )
    expect(serialized).not.toContain("opaque_")
    expect(serialized).not.toContain("attachment_private")
  })

  it("quotes tabs, commas, quotes, newlines, and surrounding whitespace", () => {
    const fields = [
      field("title", "Title", "singleLineText"),
      field("notes", "Notes", "longText"),
    ]
    const source = record("one", {
      title: '  Say "hello", team  ',
      notes: "First\tstep\nSecond step",
    })
    const serialized = serializeClipboardRectangle([source], fields)

    expect(parseClipboardRectangle(serialized)).toEqual([
      ['  Say "hello", team  ', "First\tstep\nSecond step"],
    ])
  })

  it("never copies unknown choice or creator IDs as labels", () => {
    const creator = field("creator", "Created by", "createdBy")
    const unknown = record("one", {
      status: "option_deleted_999",
      creator: "user_2abc987654321",
    })
    const serialized = serializeClipboardRectangle(
      [unknown],
      [status, creator],
    )

    expect(serialized).toBe("Unavailable choice\tTeam member")
    expect(serialized).not.toContain("option_deleted")
    expect(serialized).not.toContain("user_")
  })

  it("round-trips copied choice names back to internal values", () => {
    const source = record("one", {
      status: "opaque_planned_92",
      channels: ["opaque_web_15", "opaque_email_26"],
    })
    const clipboard = serializeClipboardRectangle(
      [source],
      [status, channels],
    )
    const converted = parseAndConvertClipboard(
      clipboard,
      [status, channels],
    )

    expect(converted.errors).toEqual([])
    expect(converted.rows).toEqual([
      {
        status: "opaque_planned_92",
        channels: ["opaque_web_15", "opaque_email_26"],
      },
    ])
    expect(clipboard).not.toContain("opaque_")
  })

  it("formats currency without failing on an unavailable currency code", () => {
    expect(
      formatClipboardCellValue(
        1234.5,
        field("budget", "Budget", "currency", {
          currency: "USD",
          precision: 2,
        }),
      ),
    ).toContain("1,234.50")
    expect(
      formatClipboardCellValue(
        1234.5,
        field("budget", "Budget", "currency", {
          currency: "INVALID",
        }),
      ),
    ).toBe("1234.5")
  })
})

describe("convertClipboardCell", () => {
  it("preserves text and uses an empty cell to clear a value", () => {
    const notes = field("notes", "Notes", "longText")
    expect(convertClipboardCell("First\nSecond", notes)).toEqual({
      ok: true,
      value: "First\nSecond",
    })
    expect(convertClipboardCell("", notes)).toEqual({
      ok: true,
      value: null,
    })
  })

  it.each([
    ["1,234.50", "number", 1234.5],
    ["AED 1,234.50", "currency", 1234.5],
    ["€1.234,50", "currency", 1234.5],
    ["(£2,500)", "currency", -2500],
    ["75%", "percent", 0.75],
    ["75", "percent", 0.75],
    ["0.75", "percent", 0.75],
  ] as const)("converts %s as a friendly %s value", (input, type, value) => {
    expect(
      convertClipboardCell(
        input,
        field("value", "Value", type as FieldType),
      ),
    ).toEqual({ ok: true, value })
  })

  it("returns specific number and percentage errors", () => {
    expect(
      convertClipboardCell(
        "twelve",
        field("amount", "Amount", "number"),
      ),
    ).toMatchObject({ ok: false, code: "invalid_number" })
    expect(
      convertClipboardCell(
        "almost done",
        field("progress", "Progress", "percent"),
      ),
    ).toMatchObject({ ok: false, code: "invalid_percentage" })
    expect(
      convertClipboardCell(
        "roughly 12",
        field("amount", "Amount", "currency", { currency: "USD" }),
      ),
    ).toMatchObject({ ok: false, code: "invalid_number" })
  })

  it("accepts named and visual ratings while rejecting values outside one to five", () => {
    const rating = field("score", "Customer score", "rating")
    expect(convertClipboardCell("4", rating)).toEqual({
      ok: true,
      value: 4,
    })
    expect(convertClipboardCell("5 stars", rating)).toEqual({
      ok: true,
      value: 5,
    })
    expect(convertClipboardCell("★★★★☆", rating)).toEqual({
      ok: true,
      value: 4,
    })
    expect(convertClipboardCell("4.5", rating)).toEqual({
      ok: false,
      code: "invalid_rating",
      message:
        "Enter Customer score as a whole-number rating from 1 to 5.",
    })
    expect(convertClipboardCell("6", rating)).toMatchObject({
      ok: false,
      code: "invalid_rating",
    })
  })

  it.each([
    ["Checked", true],
    ["YES", true],
    ["✓", true],
    ["Not checked", false],
    ["no", false],
    ["0", false],
  ] as const)("converts checkbox label %s", (input, value) => {
    expect(
      convertClipboardCell(
        input,
        field("done", "Done", "checkbox"),
      ),
    ).toEqual({ ok: true, value })
  })

  it("rejects an unclear checkbox value with friendly guidance", () => {
    expect(
      convertClipboardCell(
        "maybe",
        field("done", "Done", "checkbox"),
      ),
    ).toEqual({
      ok: false,
      code: "invalid_checkbox",
      message: "Use Checked or Not checked for Done.",
    })
  })

  it("normalizes date-only and date-time values", () => {
    expect(
      convertClipboardCell(
        "2026-07-30",
        field("due", "Due", "date", { dateStyle: "date" }),
      ),
    ).toEqual({ ok: true, value: "2026-07-30" })
    expect(
      convertClipboardCell(
        "2026-07-30 14:45",
        field("meeting", "Meeting", "date", {
          dateStyle: "dateTime",
        }),
      ),
    ).toEqual({ ok: true, value: "2026-07-30T14:45" })
    expect(
      convertClipboardCell(
        "next Octember",
        field("due", "Due", "date"),
      ),
    ).toMatchObject({ ok: false, code: "invalid_date" })
  })

  it("validates email, phone, and URL values and adds HTTPS when useful", () => {
    expect(
      convertClipboardCell(
        " maya@example.com ",
        field("email", "Email", "email"),
      ),
    ).toEqual({ ok: true, value: "maya@example.com" })
    expect(
      convertClipboardCell(
        "+971 (50) 123-4567",
        field("phone", "Phone", "phone"),
      ),
    ).toEqual({ ok: true, value: "+971 (50) 123-4567" })
    expect(
      convertClipboardCell(
        "example.com/brief",
        field("brief", "Brief", "url"),
      ),
    ).toEqual({ ok: true, value: "https://example.com/brief" })
    expect(
      convertClipboardCell(
        "not an email",
        field("email", "Email", "email"),
      ),
    ).toMatchObject({ ok: false, code: "invalid_email" })
    expect(
      convertClipboardCell(
        "call me",
        field("phone", "Phone", "phone"),
      ),
    ).toMatchObject({ ok: false, code: "invalid_phone" })
    expect(
      convertClipboardCell(
        "https://",
        field("brief", "Brief", "url"),
      ),
    ).toMatchObject({ ok: false, code: "invalid_url" })
  })

  it("resolves single- and multiple-choice labels without exposing IDs", () => {
    const config = {
      options: [
        { id: "private_planned_4", label: "Planned", color: "#999" },
        { id: "private_review_7", label: "In review", color: "#00f" },
        { id: "private_web_8", label: "Web", color: "#0af" },
      ],
    }
    expect(
      convertClipboardCell(
        "in REVIEW",
        field("status", "Status", "singleSelect", config),
      ),
    ).toEqual({ ok: true, value: "private_review_7" })
    expect(
      convertClipboardCell(
        "Planned, Web",
        field("tags", "Tags", "multiSelect", config),
      ),
    ).toEqual({
      ok: true,
      value: ["private_planned_4", "private_web_8"],
    })
    const error = convertClipboardCell(
      "private_review_7",
      field("status", "Status", "singleSelect", config),
    )
    expect(error).toMatchObject({
      ok: false,
      code: "unknown_choice",
    })
    expect(error.ok ? "" : error.message).not.toContain("private_")
  })

  it("handles a choice name containing a comma as one multiple choice", () => {
    expect(
      convertClipboardCell(
        "Design, Product",
        field("teams", "Teams", "multiSelect", {
          options: [
            {
              id: "private_design_product",
              label: "Design, Product",
              color: "#00f",
            },
          ],
        }),
      ),
    ).toEqual({ ok: true, value: ["private_design_product"] })
  })

  it("flags duplicate labels, uploads, and read-only columns", () => {
    expect(
      convertClipboardCell(
        "Ready",
        field("status", "Status", "singleSelect", {
          options: [
            { id: "one", label: "Ready", color: "#111" },
            { id: "two", label: "ready", color: "#222" },
          ],
        }),
      ),
    ).toMatchObject({ ok: false, code: "ambiguous_choice" })
    expect(
      convertClipboardCell(
        "photo.png",
        field("files", "Files", "attachment"),
      ),
    ).toMatchObject({ ok: false, code: "file_upload_required" })
    expect(
      convertClipboardCell(
        "Yesterday",
        field("created", "Created time", "createdTime"),
      ),
    ).toMatchObject({ ok: false, code: "read_only_column" })
  })
})

describe("clipboard rectangle conversion", () => {
  const fields = [
    field("name", "Name", "singleLineText"),
    field("score", "Score", "number"),
    field("done", "Done", "checkbox"),
  ]

  it("returns row maps, valid cells, one-based errors, and a friendly summary", () => {
    const converted = convertClipboardRectangle(
      [
        ["Launch", "8", "Checked"],
        ["Website", "many", "maybe"],
      ],
      fields,
    )

    expect(converted.rows).toEqual([
      { name: "Launch", score: 8, done: true },
      { name: "Website" },
    ])
    expect(converted.cells).toHaveLength(4)
    expect(converted.errors).toEqual([
      expect.objectContaining({
        rowNumber: 2,
        columnNumber: 2,
        columnName: "Score",
        code: "invalid_number",
      }),
      expect.objectContaining({
        rowNumber: 2,
        columnNumber: 3,
        columnName: "Done",
        code: "invalid_checkbox",
      }),
    ])
    expect(converted.summary).toBe(
      "2 of 6 cells need attention. Fix the highlighted values and try again.",
    )
  })

  it("reports values with no selected destination column", () => {
    const converted = convertClipboardRectangle(
      [["Launch", "8", "Checked", "Extra"]],
      fields,
    )
    expect(converted.errors).toEqual([
      expect.objectContaining({
        rowNumber: 1,
        columnNumber: 4,
        columnName: "Column 4",
        code: "missing_destination",
      }),
    ])
  })

  it("provides singular, successful, and all-error summaries", () => {
    expect(
      convertClipboardRectangle([["Launch"]], fields).summary,
    ).toBe("1 cell is ready to paste.")
    expect(
      convertClipboardRectangle(
        [["many"]],
        [field("score", "Score", "number")],
      ).summary,
    ).toBe(
      "The pasted cell needs attention. Fix the highlighted value and try again.",
    )
    expect(
      parseAndConvertClipboard("Launch\t8\tChecked", fields).summary,
    ).toBe("3 cells are ready to paste.")
  })
})
