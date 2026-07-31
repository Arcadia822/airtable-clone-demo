import { describe, expect, it } from "vitest"

import {
  buildKanbanLanes,
  calendarValueForDay,
  calendarMonthDays,
  friendlyRecordDetails,
  galleryCover,
  recordsByCalendarDay,
} from "@/lib/alternative-view-data"
import type {
  FieldDefinition,
  GridRecord,
} from "@/lib/domain"

const statusField: FieldDefinition = {
  id: "field_internal_status",
  name: "Delivery status",
  type: "singleSelect",
  config: {
    options: [
      { id: "option_internal_planned", label: "Planned", color: "#64748B" },
      { id: "option_internal_live", label: "Live", color: "#10B981" },
    ],
    archivedOptions: [
      {
        id: "option_removed",
        label: "Paused",
        color: "#F59E0B",
      },
    ],
  },
  rank: "a",
  width: 180,
  isPrimary: false,
}
const dateField: FieldDefinition = {
  id: "field_internal_date",
  name: "Target date",
  type: "date",
  config: { dateStyle: "date" },
  rank: "b",
  width: 180,
  isPrimary: false,
}
const ownerField: FieldDefinition = {
  id: "field_internal_owner",
  name: "Created by",
  type: "createdBy",
  config: {},
  rank: "c",
  width: 180,
  isPrimary: false,
}
const coverField: FieldDefinition = {
  id: "field_internal_cover",
  name: "Cover image",
  type: "attachment",
  config: { attachmentKind: "image" },
  rank: "d",
  width: 220,
  isPrimary: false,
}

function record(
  id: string,
  values: GridRecord["values"],
): GridRecord {
  return {
    id,
    values,
    rank: id,
    revision: 1,
    createdAt: 1,
    createdBy: "user_internal_creator",
    updatedAt: 1,
    updatedBy: "user_internal_creator",
  }
}

describe("alternative view data", () => {
  it("groups cards under named choices without exposing unknown option IDs", () => {
    const lanes = buildKanbanLanes(
      [
        record("record_one", {
          [statusField.id]: "option_internal_live",
        }),
        record("record_two", {
          [statusField.id]: "option_removed",
        }),
      ],
      statusField,
    )

    expect(lanes.map((lane) => [lane.label, lane.records.length])).toEqual([
      ["Planned", 0],
      ["Live", 1],
      ["Paused (archived)", 1],
      ["Unassigned", 0],
    ])
    expect(lanes.find((lane) => lane.label === "Paused (archived)"))
      .toMatchObject({ canReceive: false })
    expect(JSON.stringify(lanes.map((lane) => lane.label))).not.toContain(
      "option_internal",
    )
  })

  it("builds a complete calendar grid and keeps undated records separate", () => {
    const days = calendarMonthDays(new Date(2026, 6, 15))
    expect(days).toHaveLength(42)
    expect(days.filter((day) => day.inCurrentMonth)).toHaveLength(31)

    const dated = new Date(2026, 6, 18, 9, 30).getTime()
    const result = recordsByCalendarDay(
      [
        record("record_dated", { [dateField.id]: dated }),
        record("record_date_string", {
          [dateField.id]: "2026-07-19",
        }),
        record("record_datetime_string", {
          [dateField.id]: "2026-07-20T15:45",
        }),
        record("record_unscheduled", { [dateField.id]: null }),
      ],
      dateField,
    )
    expect(result.byDay.get("2026-07-18")?.[0]?.id).toBe("record_dated")
    expect(result.byDay.get("2026-07-19")?.[0]?.id).toBe(
      "record_date_string",
    )
    expect(result.byDay.get("2026-07-20")?.[0]?.id).toBe(
      "record_datetime_string",
    )
    expect(result.unscheduled[0]?.id).toBe("record_unscheduled")
    const moved = new Date(
      calendarValueForDay(new Date(2026, 6, 21), dated),
    )
    expect([moved.getDate(), moved.getHours(), moved.getMinutes()]).toEqual([
      21, 9, 30,
    ])
    expect(
      calendarValueForDay(
        new Date(2026, 6, 22),
        "2026-07-19",
        "date",
      ),
    ).toBe("2026-07-22")
    expect(
      calendarValueForDay(
        new Date(2026, 6, 23),
        "2026-07-20T15:45",
        "dateTime",
      ),
    ).toBe("2026-07-23T15:45")
  })

  it("uses attachment metadata for covers and friendly detail values", () => {
    const item = record("record_with_cover", {
      [coverField.id]: [
        {
          id: "attachment_internal",
          name: "Launch photo.png",
          mimeType: "image/png",
          size: 120,
          url: "https://example.test/launch.png",
        },
      ],
      [statusField.id]: "option_internal_live",
      [ownerField.id]: "user_internal_creator",
    })
    expect(galleryCover(item, coverField)?.name).toBe("Launch photo.png")
    expect(
      friendlyRecordDetails(item, [statusField, ownerField], { limit: 2 }),
    ).toEqual([
      {
        fieldId: statusField.id,
        label: "Delivery status",
        value: "Live",
      },
      {
        fieldId: ownerField.id,
        label: "Created by",
        value: "Team member",
      },
    ])
  })
})
