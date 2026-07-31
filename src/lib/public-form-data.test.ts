import { describe, expect, it } from "vitest"

import { DEMO_FIELDS, DEMO_FORM } from "@/lib/demo-data"
import type { FieldDefinition, FormDefinition } from "@/lib/domain"
import {
  indicatesPublishedFormChanged,
  invalidatesPendingPublicSubmission,
  pruneHiddenPublicFormData,
  publicFormAnswers,
  publicSubmissionErrorMessage,
  validatePublicFormData,
} from "@/lib/public-form-data"

describe("public form answer mapping", () => {
  it("maps each question back to its immutable form-version field", () => {
    const data = new FormData()
    data.set("question_name", "A better launch flow")
    data.set("question_notes", "The collaboration felt immediate.")
    data.set("question_status", "review")

    const answers = publicFormAnswers(DEMO_FORM, DEMO_FIELDS, data)

    expect(answers).toEqual([
      {
        formVersionFieldId: "question_name",
        value: "A better launch flow",
      },
      {
        formVersionFieldId: "question_notes",
        value: "The collaboration felt immediate.",
      },
      {
        formVersionFieldId: "question_status",
        value: "review",
      },
      {
        formVersionFieldId: "question_assets",
        value: [],
      },
    ])
  })

  it("uses finalized attachment IDs instead of browser File objects", () => {
    const data = new FormData()
    const attachments = new Map([
      ["question_assets", ["attachment_1", "attachment_2"]],
    ])

    const answers = publicFormAnswers(
      DEMO_FORM,
      DEMO_FIELDS,
      data,
      attachments,
    )

    expect(answers.at(-1)?.value).toEqual([
      "attachment_1",
      "attachment_2",
    ])
  })

  it("requires at least one option in a required multi-select group", () => {
    const field: FieldDefinition = {
      id: "interests",
      name: "Interests",
      type: "multiSelect",
      config: {
        options: [
          { id: "design", label: "Design", color: "#2563eb" },
        ],
      },
      rank: "a",
      width: 180,
      isPrimary: false,
    }
    const form = oneQuestionForm(field, true)
    const empty = new FormData()

    expect(validatePublicFormData(form, [field], empty)).toEqual({
      questionId: "question",
      message: "Choose at least one option for “Interests”.",
    })

    empty.append("question", "design")
    expect(validatePublicFormData(form, [field], empty)).toBeNull()
  })

  it("accepts only whole-number ratings from one to five", () => {
    const field: FieldDefinition = {
      id: "rating_internal",
      name: "Customer rating",
      type: "rating",
      config: { min: 1, max: 5, precision: 0 },
      rank: "a",
      width: 180,
      isPrimary: false,
    }
    const form = oneQuestionForm(field, true)
    const data = new FormData()
    data.set("question", "4")

    expect(validatePublicFormData(form, [field], data)).toBeNull()
    expect(publicFormAnswers(form, [field], data)).toEqual([
      {
        formVersionFieldId: "question",
        value: 4,
      },
    ])

    data.set("question", "4.5")
    expect(validatePublicFormData(form, [field], data)).toEqual({
      questionId: "question",
      message:
        "“Customer rating” must be a whole-number rating from 1 to 5.",
    })
    data.set("question", "6")
    expect(validatePublicFormData(form, [field], data)).toEqual({
      questionId: "question",
      message:
        "“Customer rating” must be a whole-number rating from 1 to 5.",
    })
  })

  it("requires a real file for required attachments and preserves file limits", () => {
    const field: FieldDefinition = {
      id: "files",
      name: "Files",
      type: "attachment",
      config: { attachmentKind: "any" },
      rank: "a",
      width: 180,
      isPrimary: false,
    }
    const form = oneQuestionForm(field, true)
    const empty = new FormData()

    expect(validatePublicFormData(form, [field], empty)).toEqual({
      questionId: "question",
      message: "Attach at least one file for “Files”.",
    })

    const tooMany = new FormData()
    for (let index = 0; index < 11; index += 1) {
      tooMany.append(
        "question",
        new File(["ok"], `attachment-${index}.txt`, {
          type: "text/plain",
        }),
      )
    }
    expect(validatePublicFormData(form, [field], tooMany)?.message).toBe(
      "Attach no more than 10 files to “Files”.",
    )
  })

  it("enforces the configured attachment kind before submission", () => {
    const field: FieldDefinition = {
      id: "images",
      name: "Images",
      type: "attachment",
      config: { attachmentKind: "image" },
      rank: "a",
      width: 180,
      isPrimary: false,
    }
    const form = oneQuestionForm(field, false)
    const data = new FormData()
    data.append(
      "question",
      new File(["document"], "notes.pdf", {
        type: "application/pdf",
      }),
    )

    expect(validatePublicFormData(form, [field], data)).toEqual({
      questionId: "question",
      message: "notes.pdf must be an image.",
    })
  })

  it("omits hidden answers and does not validate hidden required questions", () => {
    const fields: FieldDefinition[] = [
      {
        id: "launch",
        name: "Launch decision",
        type: "singleSelect",
        config: {
          options: [
            { id: "yes", label: "Yes", color: "#16a34a" },
            { id: "no", label: "No", color: "#94a3b8" },
          ],
        },
        rank: "a",
        width: 180,
        isPrimary: true,
      },
      {
        id: "details",
        name: "Launch details",
        type: "longText",
        config: {},
        rank: "b",
        width: 240,
        isPrimary: false,
      },
    ]
    const form: FormDefinition = {
      ...DEMO_FORM,
      questions: [
        {
          id: "question_launch",
          fieldId: "launch",
          label: "Should we launch?",
          helpText: "",
          required: true,
          rank: "a",
        },
        {
          id: "question_details",
          fieldId: "details",
          label: "Tell us more",
          helpText: "",
          required: true,
          rank: "b",
          visibility: {
            conjunction: "and",
            conditions: [
              {
                id: "launch_yes",
                sourceQuestionId: "question_launch",
                sourceFieldId: "launch",
                operator: "is",
                value: "yes",
              },
            ],
          },
        },
      ],
    }
    const data = new FormData()
    data.set("question_launch", "no")
    data.set("question_details", "This stale answer must not be submitted")

    expect(validatePublicFormData(form, fields, data)).toBeNull()
    expect(publicFormAnswers(form, fields, data)).toEqual([
      { formVersionFieldId: "question_launch", value: "no" },
    ])

    pruneHiddenPublicFormData(form, fields, data)
    expect(data.has("question_details")).toBe(false)
  })

  it("submits an explicit hidden value without trusting browser input", () => {
    const field: FieldDefinition = {
      id: "source",
      name: "Lead source",
      type: "singleLineText",
      config: {},
      rank: "a",
      width: 180,
      isPrimary: false,
    }
    const form: FormDefinition = {
      ...oneQuestionForm(field, true),
      questions: [
        {
          id: "source_question",
          fieldId: field.id,
          label: "Lead source",
          helpText: "",
          required: true,
          rank: "a",
          mode: "hidden",
          fixedValue: "Partner webinar",
        },
      ],
    }
    const data = new FormData()
    data.set("source_question", "Malicious browser override")

    expect(validatePublicFormData(form, [field], data)).toBeNull()
    expect(publicFormAnswers(form, [field], data)).toEqual([
      {
        formVersionFieldId: "source_question",
        value: "Partner webinar",
      },
    ])
  })
})

describe("public submission recovery", () => {
  it("invalidates cached state only for expired or changed sessions", () => {
    expect(
      invalidatesPendingPublicSubmission({
        data: { code: "PUBLIC_SUBMISSION_SESSION_INVALID" },
      }),
    ).toBe(true)
    expect(
      invalidatesPendingPublicSubmission(
        new Error(
          'Uncaught ConvexError: {"code":"FORM_UPDATED_OR_CLOSED"}',
        ),
      ),
    ).toBe(true)
    expect(
      invalidatesPendingPublicSubmission(new Error("Network request failed")),
    ).toBe(false)
    expect(
      invalidatesPendingPublicSubmission({
        data: { code: "UPLOAD_SESSION_NOT_FOUND" },
      }),
    ).toBe(false)
  })

  it("recognizes changed forms and returns safe user-facing errors", () => {
    const changed = { data: { code: "FORM_UPDATED_OR_CLOSED" } }
    expect(indicatesPublishedFormChanged(changed)).toBe(true)
    expect(publicSubmissionErrorMessage(changed)).toMatch(
      /changed or closed/i,
    )
    expect(
      publicSubmissionErrorMessage(
        new Error("secret backend diagnostic and stack"),
      ),
    ).not.toContain("secret backend diagnostic")
  })
})

function oneQuestionForm(
  field: FieldDefinition,
  required: boolean,
): FormDefinition {
  return {
    ...DEMO_FORM,
    questions: [
      {
        id: "question",
        fieldId: field.id,
        label: field.name,
        helpText: "",
        required,
        rank: "a",
      },
    ],
  }
}
