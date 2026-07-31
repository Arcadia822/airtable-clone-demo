import { describe, expect, it } from "vitest"

import {
  describeFormCondition,
  describeFormVisibility,
  evaluateFormVisibility,
  isFormQuestionVisible,
  matchesFormCondition,
  visibleFormQuestions,
  type ConditionalFormQuestion,
  type FormVisibilityCondition,
  type FormVisibilityRule,
} from "@/lib/form-conditional-logic"

function question(
  id: string,
  fieldId: string,
  label: string,
  visibility?: FormVisibilityRule,
): ConditionalFormQuestion {
  return {
    id,
    fieldId,
    label,
    helpText: "",
    required: false,
    rank: id,
    visibility,
  }
}

function condition(
  operator: FormVisibilityCondition["operator"],
  value?: FormVisibilityCondition["value"],
  overrides: Partial<FormVisibilityCondition> = {},
): FormVisibilityCondition {
  return {
    id: "condition_private",
    sourceQuestionId: "question_private_source",
    sourceFieldId: "field_private_source",
    operator,
    ...(value === undefined ? {} : { value }),
    ...overrides,
  }
}

const sourceQuestion = question(
  "question_private_source",
  "field_private_source",
  "Launch status",
)

describe("form conditional logic", () => {
  it("supports AND and OR rules with case-insensitive equality and contains", () => {
    const conditions: FormVisibilityCondition[] = [
      condition("is", "shipped"),
      condition("contains", "launch", {
        id: "condition_notes",
        sourceQuestionId: "question_notes",
        sourceFieldId: "field_notes",
      }),
    ]
    const questions = [
      sourceQuestion,
      question("question_notes", "field_notes", "Notes"),
    ]
    const answers = new Map([
      ["question_private_source", "Shipped"],
      ["question_notes", "Urgent LAUNCH request"],
    ])

    expect(
      evaluateFormVisibility(
        { conjunction: "and", conditions },
        answers,
        questions,
      ),
    ).toBe(true)
    expect(
      evaluateFormVisibility(
        {
          conjunction: "or",
          conditions: [
            { ...conditions[0]!, value: "Planned" },
            conditions[1]!,
          ],
        },
        answers,
        questions,
      ),
    ).toBe(true)
    expect(
      evaluateFormVisibility(
        { conjunction: "and", conditions: [] },
        answers,
        questions,
      ),
    ).toBe(true)
  })

  it("handles empty and negative conditions without revealing early", () => {
    expect(
      matchesFormCondition(
        condition("is_empty"),
        { question_private_source: "   " },
        [sourceQuestion],
      ),
    ).toBe(true)
    expect(
      matchesFormCondition(
        condition("is_empty"),
        { question_private_source: [] },
        [sourceQuestion],
      ),
    ).toBe(true)
    expect(
      matchesFormCondition(
        condition("is_not_empty"),
        { question_private_source: 0 },
        [sourceQuestion],
      ),
    ).toBe(true)
    expect(
      matchesFormCondition(
        condition("is_not_empty"),
        { question_private_source: false },
        [sourceQuestion],
      ),
    ).toBe(true)
    expect(
      matchesFormCondition(
        condition("is_not", "Shipped"),
        {},
        [sourceQuestion],
      ),
    ).toBe(false)
    expect(
      matchesFormCondition(
        condition("does_not_contain", "launch"),
        {},
        [sourceQuestion],
      ),
    ).toBe(false)
  })

  it("supports checked and not-checked answers from native form values", () => {
    expect(
      matchesFormCondition(
        condition("is_checked"),
        { question_private_source: "yes" },
        [sourceQuestion],
      ),
    ).toBe(true)
    expect(
      matchesFormCondition(
        condition("is_checked"),
        { question_private_source: true },
        [sourceQuestion],
      ),
    ).toBe(true)
    expect(
      matchesFormCondition(
        condition("is_not_checked"),
        { question_private_source: "0" },
        [sourceQuestion],
      ),
    ).toBe(true)
    expect(
      matchesFormCondition(
        condition("is_not_checked"),
        {},
        [sourceQuestion],
      ),
    ).toBe(true)
    expect(
      matchesFormCondition(
        condition("is_not_checked"),
        { question_private_source: "not a checkbox value" },
        [sourceQuestion],
      ),
    ).toBe(false)
  })

  it.each([
    ["greater_than", "101", 100, true],
    ["greater_than_or_equal", 100, 100, true],
    ["less_than", 99, "100", true],
    ["less_than_or_equal", 100, 100, true],
    ["greater_than", "not a number", 100, false],
  ] as const)(
    "evaluates the %s numeric comparison safely",
    (operator, actual, expected, result) => {
      expect(
        matchesFormCondition(
          condition(operator, expected),
          { question_private_source: actual },
          [sourceQuestion],
        ),
      ).toBe(result)
    },
  )

  it("compares date-only and timestamp answers without timezone drift", () => {
    expect(
      matchesFormCondition(
        condition("before", "2026-07-30"),
        { question_private_source: "2026-07-29T23:59:59-10:00" },
        [sourceQuestion],
      ),
    ).toBe(true)
    expect(
      matchesFormCondition(
        condition("on_or_before", "2026-07-30"),
        { question_private_source: "2026-07-30T18:00:00+04:00" },
        [sourceQuestion],
      ),
    ).toBe(true)
    expect(
      matchesFormCondition(
        condition("after", "2026-07-30"),
        { question_private_source: "2026-07-31" },
        [sourceQuestion],
      ),
    ).toBe(true)
    expect(
      matchesFormCondition(
        condition("on_or_after", "invalid"),
        { question_private_source: "2026-07-31" },
        [sourceQuestion],
      ),
    ).toBe(false)
  })

  it("supports named multi-choice answers and file-name contains checks", () => {
    expect(
      matchesFormCondition(
        condition("is", "Email"),
        { question_private_source: ["Web", "Email"] },
        [sourceQuestion],
      ),
    ).toBe(true)
    expect(
      matchesFormCondition(
        condition("is", ["Email", "Web"]),
        { question_private_source: ["Web", "Email"] },
        [sourceQuestion],
      ),
    ).toBe(true)
    expect(
      matchesFormCondition(
        condition("contains", "brief.pdf"),
        {
          question_private_source: [
            { name: "Launch brief.pdf", size: 2500 },
          ],
        },
        [sourceQuestion],
      ),
    ).toBe(false)
    expect(
      matchesFormCondition(
        condition("contains", "launch brief.pdf"),
        {
          question_private_source: [
            { name: "Launch brief.pdf", size: 2500 },
          ],
        },
        [sourceQuestion],
      ),
    ).toBe(true)
  })

  it("fails closed for missing questions and changed source mappings", () => {
    expect(
      matchesFormCondition(
        condition("is", "Shipped"),
        { question_private_source: "Shipped" },
        [],
      ),
    ).toBe(false)
    expect(
      matchesFormCondition(
        {
          ...condition("is", "Shipped"),
          sourceFieldId: "field_private_replaced",
        },
        { question_private_source: "Shipped" },
        [sourceQuestion],
      ),
    ).toBe(false)
  })

  it("keeps hidden sources from unlocking downstream questions and closes cycles", () => {
    const detailsRule: FormVisibilityRule = {
      conjunction: "and",
      conditions: [
        condition("is", "Yes", {
          sourceQuestionId: "question_gate",
          sourceFieldId: "field_gate",
        }),
      ],
    }
    const uploadRule: FormVisibilityRule = {
      conjunction: "and",
      conditions: [
        condition("is_not_empty", undefined, {
          sourceQuestionId: "question_details",
          sourceFieldId: "field_details",
        }),
      ],
    }
    const questions = [
      question("question_gate", "field_gate", "Continue?"),
      question(
        "question_details",
        "field_details",
        "Details",
        detailsRule,
      ),
      question(
        "question_upload",
        "field_upload",
        "Upload",
        uploadRule,
      ),
    ]

    const staleAnswers = {
      question_gate: "No",
      question_details: "A stale hidden answer",
    }
    expect(
      isFormQuestionVisible(
        "question_details",
        questions,
        staleAnswers,
      ),
    ).toBe(false)
    expect(
      isFormQuestionVisible(
        "question_upload",
        questions,
        staleAnswers,
      ),
    ).toBe(false)
    expect(
      visibleFormQuestions(questions, staleAnswers).map(
        ({ label }) => label,
      ),
    ).toEqual(["Continue?"])

    const visibleAnswers = {
      question_gate: "Yes",
      question_details: "Fresh details",
    }
    expect(
      visibleFormQuestions(questions, visibleAnswers).map(
        ({ label }) => label,
      ),
    ).toEqual(["Continue?", "Details", "Upload"])

    const cycle = [
      question("question_a", "field_a", "A", {
        conjunction: "and",
        conditions: [
          condition("is_checked", undefined, {
            sourceQuestionId: "question_b",
            sourceFieldId: "field_b",
          }),
        ],
      }),
      question("question_b", "field_b", "B", {
        conjunction: "and",
        conditions: [
          condition("is_checked", undefined, {
            sourceQuestionId: "question_a",
            sourceFieldId: "field_a",
          }),
        ],
      }),
    ]
    expect(
      visibleFormQuestions(cycle, {
        question_a: true,
        question_b: true,
      }),
    ).toEqual([])
  })

  it("describes conditions with labels while keeping identifiers private", () => {
    const privateCondition = condition("is", "option_private_shipped")
    const generic = describeFormCondition(privateCondition, [
      sourceQuestion,
    ])
    const resolved = describeFormCondition(
      privateCondition,
      [sourceQuestion],
      { valueLabel: () => "Shipped" },
    )
    const missing = describeFormCondition(
      {
        ...privateCondition,
        sourceQuestionId: "question_private_missing",
      },
      [sourceQuestion],
    )
    const summary = describeFormVisibility(
      {
        conjunction: "and",
        conditions: [
          privateCondition,
          condition("after", "2026-07-30", {
            id: "condition_date",
          }),
        ],
      },
      [sourceQuestion],
      { valueLabel: (item) => item.id === "condition_private" ? "Shipped" : undefined },
    )

    expect(generic).toBe("“Launch status” is the selected choice")
    expect(resolved).toBe("“Launch status” is “Shipped”")
    expect(missing).toBe(
      "Unavailable question is the selected choice",
    )
    expect(summary).toContain("Show when all conditions match")
    expect(summary).toContain("Jul 30, 2026")
    for (const output of [generic, resolved, missing, summary]) {
      expect(output).not.toMatch(
        /question_private|field_private|option_private|condition_private/,
      )
    }
  })
})
