import { render, screen, within } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { ConditionalLogicEditor } from "@/components/forms/conditional-logic-editor"

describe("ConditionalLogicEditor", () => {
  it("describes rules with question and answer names instead of stored keys", () => {
    const sourceQuestionId = "question_01KYT3HIDDEN_INTERNAL_SOURCE"
    const dependentQuestionId =
      "question_01KYT3HIDDEN_INTERNAL_DEPENDENT"
    const sourceFieldId = "field_01KYT3HIDDEN_INTERNAL_SOURCE"
    const dependentFieldId =
      "field_01KYT3HIDDEN_INTERNAL_DEPENDENT"
    const optionId = "option_01KYT3HIDDEN_INTERNAL_YES"
    const questions = [
      {
        id: sourceQuestionId,
        targetFieldId: sourceFieldId,
        label: "Should this launch?",
      },
      {
        id: dependentQuestionId,
        targetFieldId: dependentFieldId,
        label: "Tell us why",
        visibility: {
          conjunction: "and" as const,
          conditions: [
            {
              id: "condition_01KYT3HIDDEN_INTERNAL",
              sourceQuestionId,
              sourceFieldId,
              operator: "is" as const,
              value: optionId,
            },
          ],
        },
      },
    ]
    const { container } = render(
      <ConditionalLogicEditor
        fields={[
          {
            id: sourceFieldId,
            name: "Launch decision",
            type: "singleSelect",
            config: {
              options: [
                { id: optionId, label: "Yes, launch", color: "#16a34a" },
              ],
            },
          },
          {
            id: dependentFieldId,
            name: "Launch reason",
            type: "longText",
            config: {},
          },
        ]}
        onChange={vi.fn()}
        question={questions[1]!}
        questions={questions}
      />,
    )

    expect(
      screen.getByText(
        "Show when “Should this launch?” is “Yes, launch”",
      ),
    ).toBeInTheDocument()
    expect(screen.getAllByText("Should this launch?").length).toBeGreaterThan(0)
    expect(screen.getAllByText("Yes, launch").length).toBeGreaterThan(0)
    expect(container).not.toHaveTextContent(sourceQuestionId)
    expect(container).not.toHaveTextContent(sourceFieldId)
    expect(container).not.toHaveTextContent(optionId)
    expect(
      screen.getByRole("combobox", { name: "Show this question" }),
    ).toHaveTextContent("Only when conditions match")
    expect(
      screen.getByRole("combobox", { name: "Earlier question" }),
    ).toHaveTextContent("Should this launch?")
    expect(
      screen.getByRole("combobox", { name: "Condition" }),
    ).toHaveTextContent("is")
    expect(
      screen.getByRole("combobox", { name: "Answer" }),
    ).toHaveTextContent("Yes, launch")
  })

  it("keeps the operator controlled while field details load", () => {
    const sourceQuestionId = "question_source"
    const sourceFieldId = "field_source"
    const questions = [
      {
        id: sourceQuestionId,
        targetFieldId: sourceFieldId,
        label: "Launch status",
      },
      {
        id: "question_follow_up",
        targetFieldId: "field_follow_up",
        label: "Follow-up",
        visibility: {
          conjunction: "and" as const,
          conditions: [
            {
              id: "condition_status",
              sourceQuestionId,
              sourceFieldId,
              operator: "is" as const,
              value: "approved",
            },
          ],
        },
      },
    ]
    const consoleError = vi.spyOn(console, "error").mockImplementation(
      () => undefined,
    )
    const view = render(
      <ConditionalLogicEditor
        fields={[]}
        onChange={vi.fn()}
        question={questions[1]!}
        questions={questions}
      />,
    )

    view.rerender(
      <ConditionalLogicEditor
        fields={[
          {
            id: sourceFieldId,
            name: "Launch status",
            type: "singleSelect",
            config: {
              options: [
                {
                  id: "approved",
                  label: "Approved",
                  color: "#16a34a",
                },
              ],
            },
          },
        ]}
        onChange={vi.fn()}
        question={questions[1]!}
        questions={questions}
      />,
    )

    expect(
      within(view.container).getByRole("combobox", { name: "Condition" }),
    ).toHaveTextContent("is")
    expect(
      consoleError.mock.calls.flat().join(" "),
    ).not.toContain("uncontrolled value state")
    consoleError.mockRestore()
  })
})
