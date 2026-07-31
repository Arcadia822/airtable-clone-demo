import { describe, expect, it } from "vitest"

import type {
  FieldDefinition,
  FormDefinition,
} from "@/lib/domain"
import {
  formPrefillParameterIssue,
  hiddenFixedAnswerLookup,
  normalizeFormPrefillParameter,
  publicFormPrefillValues,
  suggestedFormPrefillName,
} from "@/lib/form-prefill"

const fields: FieldDefinition[] = [
  {
    id: "email_column",
    name: "Contact email",
    type: "email",
    config: {},
    rank: "a",
    width: 200,
    isPrimary: true,
  },
  {
    id: "plan_column",
    name: "Plan",
    type: "singleSelect",
    config: {
      options: [
        {
          id: "option_internal_enterprise",
          label: "Enterprise",
          color: "#0f766e",
        },
      ],
    },
    rank: "b",
    width: 180,
    isPrimary: false,
  },
  {
    id: "discount_column",
    name: "Discount",
    type: "percent",
    config: { min: 0, max: 1 },
    rank: "c",
    width: 160,
    isPrimary: false,
  },
]

const form: FormDefinition = {
  id: "form",
  baseId: "base",
  tableId: "table",
  name: "Lead form",
  title: "Talk to sales",
  description: "",
  submitLabel: "Send",
  thankYouTitle: "Thank you",
  thankYouMessage: "Received",
  publicSlug: "lead-form",
  status: "published",
  theme: {
    accent: "#2563eb",
    background: "#ffffff",
    hideBranding: false,
    layout: "card",
  },
  version: 1,
  questions: [
    {
      id: "email_question",
      fieldId: "email_column",
      label: "Work email",
      helpText: "",
      required: true,
      rank: "a",
      mode: "visible",
      prefillParameter: "customer_email",
    },
    {
      id: "plan_question",
      fieldId: "plan_column",
      label: "Plan",
      helpText: "",
      required: false,
      rank: "b",
      mode: "visible",
      prefillParameter: "plan",
    },
    {
      id: "discount_question",
      fieldId: "discount_column",
      label: "Discount",
      helpText: "",
      required: false,
      rank: "c",
      mode: "visible",
      prefillParameter: "discount",
    },
  ],
}

describe("friendly form prefills", () => {
  it("normalizes and validates readable parameter names", () => {
    expect(normalizeFormPrefillParameter(" Customer Email ")).toBe(
      "customer_email",
    )
    expect(
      suggestedFormPrefillName("Campaign source", "Source"),
    ).toBe("campaign_source")
    expect(suggestedFormPrefillName("✨", "Contact email")).toBe(
      "contact_email",
    )
    expect(formPrefillParameterIssue("customer_email")).toBeNull()
    expect(formPrefillParameterIssue("token")).toMatch(/reserved/i)
    expect(
      formPrefillParameterIssue("customer_email", ["customer_email"]),
    ).toMatch(/different/i)
    expect(formPrefillParameterIssue("__proto__")).toMatch(
      /start with a letter/i,
    )
  })

  it("accepts only compatible typed values and friendly option labels", () => {
    const values = publicFormPrefillValues(
      form,
      fields,
      new URLSearchParams(
        "customer_email=hello%40example.com&plan=Enterprise&discount=25",
      ),
    )

    expect(values).toEqual(
      new Map<string, string | number>([
        ["email_question", "hello@example.com"],
        ["plan_question", "option_internal_enterprise"],
        ["discount_question", 0.25],
      ]),
    )
  })

  it("ignores unknown, malformed, and raw option values", () => {
    const values = publicFormPrefillValues(
      form,
      fields,
      new URLSearchParams(
        "unknown=private&customer_email=not-an-email&plan=option_internal_enterprise&__proto__=polluted",
      ),
    )

    expect(values.size).toBe(0)
    expect(Object.prototype).not.toHaveProperty("polluted")
  })

  it("keeps hidden fixed values separate from URL input", () => {
    const hiddenForm: FormDefinition = {
      ...form,
      questions: [
        {
          ...form.questions[1]!,
          mode: "hidden",
          fixedValue: "option_internal_enterprise",
          prefillParameter: undefined,
        },
      ],
    }

    expect(
      hiddenFixedAnswerLookup(hiddenForm.questions),
    ).toEqual(
      new Map([
        ["plan_question", "option_internal_enterprise"],
      ]),
    )
    expect(
      publicFormPrefillValues(
        hiddenForm,
        fields,
        new URLSearchParams("plan=Something+else"),
      ).size,
    ).toBe(0)
  })
})
