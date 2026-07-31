import { describe, expect, it } from "vitest"

import {
  DEMO_BASES,
  DEMO_FIELDS,
  DEMO_FORM,
  DEMO_TABLE_DATA,
  DEMO_TABLES,
} from "@/lib/demo-data"
import type { FieldType } from "@/lib/domain"

describe("demo workspace fixtures", () => {
  it("provides substantial table-specific data for every listed table", () => {
    expect(Object.keys(DEMO_TABLE_DATA).sort()).toEqual(
      DEMO_TABLES.map((table) => table.id).sort(),
    )

    for (const table of DEMO_TABLES) {
      const fixture = DEMO_TABLE_DATA[table.id]
      expect(fixture, `${table.name} fixture`).toBeDefined()
      expect(fixture.fields.length, `${table.name} fields`).toBeGreaterThan(0)
      expect(
        fixture.records.length,
        `${table.name} record count`,
      ).toBeGreaterThanOrEqual(40)

      const primaryFields = fixture.fields.filter((field) => field.isPrimary)
      expect(primaryFields, `${table.name} primary field`).toHaveLength(1)
      expect(primaryFields[0].type).toBe("singleLineText")

      const fieldIds = new Set(fixture.fields.map((field) => field.id))
      expect(fieldIds.size, `${table.name} unique field IDs`).toBe(
        fixture.fields.length,
      )

      const recordIds = new Set(fixture.records.map((record) => record.id))
      expect(recordIds.size, `${table.name} unique record IDs`).toBe(
        fixture.records.length,
      )

      for (const record of fixture.records) {
        expect(
          Object.keys(record.values).every((fieldId) => fieldIds.has(fieldId)),
          `${record.id} only references fields from ${table.name}`,
        ).toBe(true)
        expect(record.values[primaryFields[0].id]).not.toBe("")
      }
    }
  })

  it("keeps base summary counts synchronized with their table fixtures", () => {
    for (const base of DEMO_BASES) {
      const tables = DEMO_TABLES.filter((table) => table.baseId === base.id)
      const recordCount = tables.reduce(
        (total, table) => total + DEMO_TABLE_DATA[table.id].records.length,
        0,
      )

      expect(tables, `${base.name} tables`).toHaveLength(base.tableCount)
      expect(recordCount, `${base.name} records`).toBe(base.recordCount)
    }
  })

  it("only emits valid select values and empty demo attachments", () => {
    for (const table of DEMO_TABLES) {
      const fixture = DEMO_TABLE_DATA[table.id]

      for (const field of fixture.fields) {
        const values = fixture.records.map((record) => record.values[field.id])

        if (field.type === "singleSelect") {
          const optionIds = new Set(
            field.config.options?.map((option) => option.id) ?? [],
          )
          for (const value of values) {
            expect(optionIds.has(value as string), `${field.name}: ${value}`).toBe(
              true,
            )
          }
        }

        if (field.type === "multiSelect") {
          const optionIds = new Set(
            field.config.options?.map((option) => option.id) ?? [],
          )
          for (const value of values) {
            expect(Array.isArray(value)).toBe(true)
            expect(
              (value as string[]).every((optionId) => optionIds.has(optionId)),
              field.name,
            ).toBe(true)
          }
        }

        if (field.type === "attachment") {
          for (const value of values) {
            expect(value, `${table.name}.${field.name}`).toEqual([])
          }
        }

        if (field.type === "percent") {
          for (const value of values) {
            expect(value as number).toBeGreaterThanOrEqual(0)
            expect(value as number).toBeLessThanOrEqual(1)
          }
        }
      }
    }
  })

  it("exercises the requested grid field types across the demo", () => {
    const usedTypes = new Set<FieldType>(
      Object.values(DEMO_TABLE_DATA).flatMap(({ fields }) =>
        fields.map((field) => field.type),
      ),
    )

    expect(usedTypes).toEqual(
      expect.objectContaining(
        new Set<FieldType>([
          "singleLineText",
          "longText",
          "number",
          "currency",
          "percent",
          "checkbox",
          "date",
          "email",
          "phone",
          "url",
          "singleSelect",
          "multiSelect",
          "attachment",
        ]),
      ),
    )
  })

  it("maps the public feedback form to the Feedback table fields", () => {
    const feedback = DEMO_TABLE_DATA[DEMO_FORM.tableId]
    const fieldIds = new Set(feedback.fields.map((field) => field.id))

    expect(feedback.fields).toBe(DEMO_FIELDS)
    expect(
      DEMO_FORM.questions.every((question) => fieldIds.has(question.fieldId)),
    ).toBe(true)
  })
})
