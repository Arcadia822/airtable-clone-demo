import { describe, expect, it } from "vitest"

import type {
  CellValue,
  FieldDefinition,
  GridRecord,
} from "@/lib/domain"
import {
  applySavedView,
  filterRecordsForView,
  flattenSavedViewGroups,
  groupRecordsForView,
  processSavedView,
  sortRecordsForView,
  type SavedViewFilter,
  type SavedViewGroup,
  type SavedViewSort,
  type ViewProcessableField,
} from "@/lib/view-processing"

function field(
  id: string,
  name: string,
  type: ViewProcessableField["type"],
  config: FieldDefinition["config"] = {},
): ViewProcessableField {
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
    createdAt: new Date(2026, 0, 1).getTime(),
    createdBy: "Maya Chen",
    updatedAt: new Date(2026, 0, 1).getTime(),
    updatedBy: "Maya Chen",
    ...overrides,
  }
}

const textField = field("name", "Initiative", "singleLineText")
const records = [
  record("a", { name: "Mobile launch" }),
  record("b", { name: "Website refresh" }),
  record("c", { name: "Launch playbook" }),
]

describe("saved-view filtering", () => {
  it("supports friendly text operators and both filter conjunctions", () => {
    const filters: SavedViewFilter[] = [
      {
        id: "contains-launch",
        fieldId: "name",
        operator: "contains",
        value: "LAUNCH",
      },
      {
        id: "not-mobile",
        fieldId: "name",
        operator: "does_not_contain",
        value: "mobile",
      },
    ]

    expect(
      filterRecordsForView(records, [textField], filters, "and").map(
        ({ id }) => id,
      ),
    ).toEqual(["c"])
    expect(
      filterRecordsForView(records, [textField], filters, "or").map(
        ({ id }) => id,
      ),
    ).toEqual(["a", "b", "c"])
    expect(
      filterRecordsForView(
        records,
        [textField],
        [
          {
            id: "exact",
            fieldId: "name",
            operator: "is",
            value: "mobile launch",
          },
          {
            id: "different",
            fieldId: "name",
            operator: "is_not",
            value: "Website refresh",
          },
        ],
        "and",
      ).map(({ id }) => id),
    ).toEqual(["a"])
  })

  it("treats whitespace and empty arrays as blank without hiding zero or false", () => {
    const notes = field("notes", "Notes", "longText")
    const tags = field("tags", "Tags", "multiSelect")
    const checked = field("checked", "Done", "checkbox")
    const amount = field("amount", "Amount", "number")
    const blankRecords = [
      record("space", { notes: "   ", tags: [], checked: false, amount: 0 }),
      record("filled", {
        notes: "Ready",
        tags: ["one"],
        checked: true,
        amount: 12,
      }),
    ]

    expect(
      filterRecordsForView(
        blankRecords,
        [notes, tags, checked, amount],
        [
          {
            id: "blank-notes",
            fieldId: "notes",
            operator: "is_empty",
          },
          {
            id: "blank-tags",
            fieldId: "tags",
            operator: "is_empty",
          },
          {
            id: "checked-present",
            fieldId: "checked",
            operator: "is_not_empty",
          },
          {
            id: "amount-present",
            fieldId: "amount",
            operator: "is_not_empty",
          },
        ],
        "and",
      ).map(({ id }) => id),
    ).toEqual(["space"])
  })

  it.each([
    ["number", "Score", 8],
    ["currency", "Budget", 12_000],
    ["percent", "Progress", 0.75],
    ["rating", "Rating", 4],
  ] as const)(
    "compares %s columns numerically",
    (type, name, threshold) => {
      const numericField = field("value", name, type)
      const numericRecords = [
        record("low", { value: threshold - 1 }),
        record("same", { value: threshold }),
        record("high", { value: threshold + 1 }),
      ]

      expect(
        filterRecordsForView(
          numericRecords,
          [numericField],
          [
            {
              id: "greater",
              fieldId: "value",
              operator: "greater_than",
              value: threshold,
            },
          ],
          "and",
        ).map(({ id }) => id),
      ).toEqual(["high"])
      expect(
        filterRecordsForView(
          numericRecords,
          [numericField],
          [
            {
              id: "less",
              fieldId: "value",
              operator: "less_than",
              value: threshold,
            },
          ],
          "and",
        ).map(({ id }) => id),
      ).toEqual(["low"])
    },
  )

  it("supports date-only equality plus before and after comparisons", () => {
    const due = field("due", "Due date", "date", { dateStyle: "date" })
    const first = new Date(2026, 0, 14).getTime()
    const second = new Date(2026, 0, 15, 18, 30).getTime()
    const third = new Date(2026, 0, 16).getTime()
    const dated = [
      record("before", { due: first }),
      record("same-day", { due: second }),
      record("after", { due: third }),
    ]

    expect(
      filterRecordsForView(
        dated,
        [due],
        [
          {
            id: "same-date",
            fieldId: "due",
            operator: "is",
            value: "2026-01-15",
          },
        ],
        "and",
      ).map(({ id }) => id),
    ).toEqual(["same-day"])
    expect(
      filterRecordsForView(
        dated,
        [due],
        [
          {
            id: "before",
            fieldId: "due",
            operator: "before",
            value: "2026-01-15",
          },
        ],
        "and",
      ).map(({ id }) => id),
    ).toEqual(["before"])
    expect(
      filterRecordsForView(
        dated,
        [due],
        [
          {
            id: "after",
            fieldId: "due",
            operator: "after",
            value: "2026-01-15",
          },
        ],
        "and",
      ).map(({ id }) => id),
    ).toEqual(["after"])
  })

  it("handles checkbox and named single- and multiple-choice values", () => {
    const done = field("done", "Done", "checkbox")
    const status = field("status", "Status", "singleSelect", {
      options: [
        { id: "choice_z9P2", label: "Planned", color: "#999" },
        { id: "choice_a1B3", label: "Shipped", color: "#0a0" },
      ],
    })
    const channels = field("channels", "Channels", "multiSelect", {
      options: [
        { id: "channel_7Z", label: "Web", color: "#00f" },
        { id: "channel_8Y", label: "Email", color: "#f0f" },
      ],
    })
    const choiceRecords = [
      record("planned", {
        done: false,
        status: "choice_z9P2",
        channels: ["channel_7Z"],
      }),
      record("shipped", {
        done: true,
        status: "choice_a1B3",
        channels: ["channel_7Z", "channel_8Y"],
      }),
    ]

    expect(
      filterRecordsForView(
        choiceRecords,
        [done, status, channels],
        [
          {
            id: "checked",
            fieldId: "done",
            operator: "is",
            value: "checked",
          },
          {
            id: "shipped",
            fieldId: "status",
            operator: "is",
            value: "Shipped",
          },
          {
            id: "email",
            fieldId: "channels",
            operator: "contains",
            value: "email",
          },
        ],
        "and",
      ).map(({ id }) => id),
    ).toEqual(["shipped"])
  })

  it("ignores stale column references instead of breaking a view", () => {
    expect(
      filterRecordsForView(
        records,
        [textField],
        [
          {
            id: "stale",
            fieldId: "removed-column",
            operator: "is",
            value: "anything",
          },
        ],
        "and",
      ),
    ).toEqual(records)
  })
})

describe("saved-view sorting", () => {
  it("applies ranked multi-sorts stably and sorts choices by their names", () => {
    const status = field("status", "Status", "singleSelect", {
      options: [
        { id: "opaque_z", label: "Alpha", color: "#111" },
        { id: "opaque_a", label: "Zulu", color: "#222" },
      ],
    })
    const score = field("score", "Score", "number")
    const sortable = [
      record("first-tie", { status: "opaque_z", score: 5 }),
      record("zulu", { status: "opaque_a", score: 99 }),
      record("highest-alpha", { status: "opaque_z", score: 9 }),
      record("second-tie", { status: "opaque_z", score: 5 }),
      record("empty", { status: null, score: 100 }),
    ]
    const sorts: SavedViewSort[] = [
      {
        id: "score-second",
        fieldId: "score",
        direction: "desc",
        rank: "b",
      },
      {
        id: "status-first",
        fieldId: "status",
        direction: "asc",
        rank: "a",
      },
    ]

    expect(
      sortRecordsForView(sortable, [status, score], sorts).map(
        ({ id }) => id,
      ),
    ).toEqual([
      "highest-alpha",
      "first-tie",
      "second-tie",
      "zulu",
      "empty",
    ])
    expect(sortable.map(({ id }) => id)).toEqual([
      "first-tie",
      "zulu",
      "highest-alpha",
      "second-tie",
      "empty",
    ])
  })
})

describe("saved-view grouping", () => {
  it("returns named nested sections without leaking choice or user IDs", () => {
    const status = field("status", "Status", "singleSelect", {
      options: [
        { id: "opt_private_91", label: "Building", color: "#00f" },
        { id: "opt_private_52", label: "Shipped", color: "#0a0" },
      ],
    })
    const owner = field("owner", "Owner", "createdBy")
    const grouped = [
      record("building", {
        status: "opt_private_91",
        owner: "user_2abc987654321",
      }),
      record("shipped", {
        status: "opt_private_52",
        owner: "Maya Chen",
      }),
      record("empty", { status: null, owner: "" }),
      record("unknown", {
        status: "opt_deleted_24",
        owner: "user_9def123456789",
      }),
    ]
    const groups: SavedViewGroup[] = [
      {
        id: "owner-second",
        fieldId: "owner",
        direction: "asc",
        rank: "b",
      },
      {
        id: "status-first",
        fieldId: "status",
        direction: "asc",
        rank: "a",
      },
    ]

    const result = groupRecordsForView(grouped, [status, owner], groups)
    expect(result.map(({ label }) => label)).toEqual([
      "Building",
      "Shipped",
      "Unavailable choice",
      "Empty",
    ])
    expect(result[0]).toMatchObject({
      fieldName: "Status",
      label: "Building",
      children: [
        {
          fieldName: "Owner",
          label: "Team member",
        },
      ],
    })
    const presentationText = result
      .flatMap((group) => [
        group.fieldName,
        group.label,
        ...group.children.flatMap((child) => [
          child.fieldName,
          child.label,
        ]),
      ])
      .join(" ")
    expect(presentationText).not.toContain("opt_private")
    expect(presentationText).not.toContain("opt_deleted")
    expect(presentationText).not.toContain("user_")
  })

  it("uses friendly labels for multiple choices, values, and blank groups", () => {
    const tags = field("tags", "Channels", "multiSelect", {
      options: [
        { id: "private_web", label: "Web", color: "#00f" },
        { id: "private_email", label: "Email", color: "#f0f" },
      ],
    })
    const progress = field("progress", "Progress", "percent", {
      precision: 0,
    })
    const grouped = [
      record("both", {
        tags: ["private_web", "private_email"],
        progress: 0.75,
      }),
      record("blank", { tags: [], progress: null }),
    ]

    expect(
      groupRecordsForView(
        grouped,
        [tags],
        [
          {
            id: "tags",
            fieldId: "tags",
            direction: "asc",
            rank: "a",
          },
        ],
      ).map(({ label }) => label),
    ).toEqual(["Email, Web", "Empty"])
    expect(
      groupRecordsForView(
        grouped,
        [progress],
        [
          {
            id: "progress",
            fieldId: "progress",
            direction: "asc",
            rank: "a",
          },
        ],
      ).map(({ label }) => label),
    ).toEqual(["75%", "Empty"])
  })

  it("flattens nested groups into friendly grid sections", () => {
    const status = field("status", "Status", "singleSelect", {
      options: [
        { id: "opaque_status", label: "In progress", color: "#00f" },
      ],
    })
    const owner = field("owner", "Owner", "createdBy")
    const groupedRecords = [
      record("one", {
        status: "opaque_status",
        owner: "user_private_123456789012345",
      }),
      record("two", {
        status: "opaque_status",
        owner: "Maya Chen",
      }),
    ]
    const groups = groupRecordsForView(
      groupedRecords,
      [status, owner],
      [
        {
          id: "status-group",
          fieldId: status.id,
          direction: "asc",
          rank: "a",
        },
        {
          id: "owner-group",
          fieldId: owner.id,
          direction: "asc",
          rank: "b",
        },
      ],
    )

    const flattened = flattenSavedViewGroups(groups)
    expect(flattened.records).toHaveLength(2)
    expect(Object.values(flattened.labelsByRecordId)).toEqual(
      expect.arrayContaining([
        "Status: In progress · Owner: Team member",
        "Status: In progress · Owner: Maya Chen",
      ]),
    )
    expect(JSON.stringify(flattened.labelsByRecordId)).not.toContain(
      "user_private",
    )
    expect(JSON.stringify(flattened.labelsByRecordId)).not.toContain(
      "opaque_status",
    )
  })
})

describe("complete saved-view processing", () => {
  it("filters and sorts before building group sections", () => {
    const status = field("status", "Status", "singleSelect", {
      options: [
        { id: "planned-key", label: "Planned", color: "#999" },
        { id: "shipped-key", label: "Shipped", color: "#0a0" },
      ],
    })
    const score = field("score", "Score", "rating")
    const source = [
      record("low", { status: "planned-key", score: 2 }),
      record("high", { status: "planned-key", score: 5 }),
      record("shipped", { status: "shipped-key", score: 4 }),
    ]
    const processed = processSavedView(source, [status, score], {
      filterConjunction: "and",
      filters: [
        {
          id: "above-two",
          fieldId: "score",
          operator: "greater_than",
          value: 2,
        },
      ],
      sorts: [
        {
          id: "highest-first",
          fieldId: "score",
          direction: "desc",
          rank: "a",
        },
      ],
      groups: [
        {
          id: "by-status",
          fieldId: "status",
          direction: "asc",
          rank: "a",
        },
      ],
    })

    expect(processed.records.map(({ id }) => id)).toEqual([
      "high",
      "shipped",
    ])
    expect(processed.groups).toMatchObject([
      { label: "Planned", records: [{ id: "high" }] },
      { label: "Shipped", records: [{ id: "shipped" }] },
    ])
    expect(
      applySavedView(source, [status, score], {
        filterConjunction: "and",
        filters: [],
        sorts: [],
      }),
    ).toEqual(source)
  })
})
