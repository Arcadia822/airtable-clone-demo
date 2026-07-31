import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { PublicForm } from "@/components/forms/public-form"
import { DEMO_FORM } from "@/lib/demo-data"
import type { FieldDefinition, FormDefinition } from "@/lib/domain"

afterEach(cleanup)

const fields: FieldDefinition[] = [
  {
    id: "details",
    name: "Details",
    type: "longText",
    config: {},
    rank: "a",
    width: 180,
    isPrimary: false,
  },
  {
    id: "topics",
    name: "Topics",
    type: "multiSelect",
    config: {
      options: [
        { id: "design", label: "Design", color: "#2563eb" },
        { id: "engineering", label: "Engineering", color: "#16a34a" },
      ],
    },
    rank: "b",
    width: 180,
    isPrimary: false,
  },
  {
    id: "files",
    name: "Attachments",
    type: "attachment",
    config: { attachmentKind: "any" },
    rank: "c",
    width: 180,
    isPrimary: false,
  },
]

const form: FormDefinition = {
  ...DEMO_FORM,
  questions: [
    {
      id: "details-question",
      fieldId: "details",
      label: "Details",
      helpText: "Tell us what happened.",
      required: false,
      rank: "a",
    },
    {
      id: "topics-question",
      fieldId: "topics",
      label: "Topics",
      helpText: "Choose every topic that applies.",
      required: true,
      rank: "b",
    },
    {
      id: "files-question",
      fieldId: "files",
      label: "Attachments",
      helpText: "Include supporting files.",
      required: true,
      rank: "c",
    },
  ],
}

describe("PublicForm accessibility and validation", () => {
  it("uses the form's customized thank-you copy in preview mode", async () => {
    const { container } = render(
      <PublicForm
        form={{
          ...form,
          thankYouTitle: "You are all set",
          thankYouMessage: "We will follow up tomorrow.",
          questions: [form.questions[0]!],
        }}
        fields={fields}
      />,
    )

    fireEvent.submit(container.querySelector("form")!)

    expect(
      await screen.findByRole(
        "heading",
        { name: "You are all set" },
        { timeout: 1_500 },
      ),
    ).toBeInTheDocument()
    expect(screen.getByText("We will follow up tomorrow.")).toBeInTheDocument()
  })

  it("hides fixed questions and keeps URL-prefilled answers editable", async () => {
    const hiddenField: FieldDefinition = {
      ...fields[0],
      id: "lead-source",
      name: "Lead source",
      type: "singleLineText",
    }
    const prefilledForm: FormDefinition = {
      ...form,
      questions: [
        {
          id: "source-question",
          fieldId: hiddenField.id,
          label: "Lead source",
          helpText: "",
          required: true,
          rank: "a",
          mode: "hidden",
          fixedValue: "Partner webinar",
        },
        {
          ...form.questions[0]!,
          required: true,
          prefillParameter: "request_details",
        },
      ],
    }
    let submitted: FormData | undefined
    const onSubmitData = vi.fn(async (data: FormData) => {
      submitted = data
      return { title: "Saved" }
    })

    const { container } = render(
      <PublicForm
        fields={[hiddenField, fields[0]!]}
        form={prefilledForm}
        onSubmitData={onSubmitData}
        prefillValues={
          new Map([["details-question", "Suggested starting answer"]])
        }
      />,
    )

    expect(screen.queryByLabelText("Lead source")).not.toBeInTheDocument()
    const details = screen.getByRole("textbox", { name: /Details/ })
    expect(details).toHaveValue("Suggested starting answer")
    fireEvent.change(details, { target: { value: "Edited by visitor" } })
    fireEvent.submit(container.querySelector("form")!)

    await waitFor(() => expect(onSubmitData).toHaveBeenCalledOnce())
    expect(submitted?.get("details-question")).toBe("Edited by visitor")
    expect(submitted?.has("source-question")).toBe(false)
  })

  it("uses a named one-to-five star input for rating questions", () => {
    const ratingField: FieldDefinition = {
      id: "rating_internal",
      name: "Customer rating",
      type: "rating",
      config: { min: 1, max: 5, precision: 0 },
      rank: "a",
      width: 180,
      isPrimary: false,
    }
    const ratingForm: FormDefinition = {
      ...form,
      questions: [
        {
          id: "rating_question_internal",
          fieldId: ratingField.id,
          label: "Customer rating",
          helpText: "Choose one to five stars.",
          required: true,
          rank: "a",
        },
      ],
    }

    const { container } = render(
      <PublicForm form={ratingForm} fields={[ratingField]} />,
    )
    const input = screen.getByRole("combobox", {
      name: "Customer rating",
    })
    expect(input).toHaveDisplayValue("Choose a rating")
    expect(screen.getByRole("option", { name: "5 stars" })).toBeInTheDocument()
    expect(container.textContent).not.toContain("rating_internal")
  })

  it("shows a choice name without exposing its stored key", () => {
    const priorityField: FieldDefinition = {
      id: "priority_field_private",
      name: "Priority",
      type: "singleSelect",
      config: {
        options: [
          {
            id: "priority_option_private",
            label: "High priority",
            color: "#dc2626",
          },
        ],
      },
      rank: "a",
      width: 180,
      isPrimary: false,
    }
    const priorityForm: FormDefinition = {
      ...form,
      questions: [
        {
          id: "priority_question_private",
          fieldId: priorityField.id,
          label: "Priority",
          helpText: "",
          required: true,
          rank: "a",
        },
      ],
    }

    render(
      <PublicForm
        fields={[priorityField]}
        form={priorityForm}
        prefillValues={
          new Map([
            [
              "priority_question_private",
              "priority_option_private",
            ],
          ])
        }
      />,
    )

    const priority = screen.getByRole("combobox", { name: /Priority/ })
    expect(priority).toHaveTextContent("High priority")
    expect(priority).not.toHaveTextContent("priority_option_private")
    expect(document.body).not.toHaveTextContent("priority_field_private")
  })

  it("keeps an initially empty choice input controlled while a visitor selects", () => {
    const priorityField: FieldDefinition = {
      id: "priority_field_private",
      name: "Priority",
      type: "singleSelect",
      config: {
        options: [
          {
            id: "priority_option_private",
            label: "High priority",
            color: "#dc2626",
          },
        ],
      },
      rank: "a",
      width: 180,
      isPrimary: false,
    }
    const priorityForm: FormDefinition = {
      ...form,
      questions: [
        {
          id: "priority_question_private",
          fieldId: priorityField.id,
          label: "Priority",
          helpText: "",
          required: true,
          rank: "a",
        },
      ],
    }
    const consoleError = vi.spyOn(console, "error").mockImplementation(
      () => undefined,
    )

    render(<PublicForm fields={[priorityField]} form={priorityForm} />)
    const priority = screen.getByRole("combobox", { name: /Priority/ })
    fireEvent.click(priority)
    const option = screen.getByRole("option", { name: "High priority" })
    fireEvent.pointerDown(option, { pointerType: "mouse" })
    fireEvent.click(option)

    expect(priority).toHaveTextContent("High priority")
    expect(
      consoleError.mock.calls.flat().join(" "),
    ).not.toContain("uncontrolled value state")
    consoleError.mockRestore()
  })

  it("associates help text and gives multi-select questions group semantics", () => {
    render(<PublicForm form={form} fields={fields} />)

    const details = screen.getByRole("textbox", { name: "Details" })
    const detailsHelp = screen.getByText("Tell us what happened.")
    expect(details).toHaveAttribute("aria-describedby", detailsHelp.id)

    const topics = screen.getByRole("group", { name: /Topics/ })
    const topicsHelp = screen.getByText("Choose every topic that applies.")
    expect(topics).toHaveAttribute("aria-describedby", topicsHelp.id)
    expect(topics).toHaveAttribute("aria-required", "true")

    const attachment = screen.getByLabelText(/Attachments/)
    const attachmentHelp = screen.getByText("Include supporting files.")
    expect(attachment).toHaveAttribute(
      "aria-describedby",
      attachmentHelp.id,
    )
  })

  it("blocks backend work when a required multi-select is empty", () => {
    const onSubmitData = vi.fn()
    const onValidationError = vi.fn()
    const { container } = render(
      <PublicForm
        form={{ ...form, questions: [form.questions[1]] }}
        fields={fields}
        onSubmitData={onSubmitData}
        onValidationError={onValidationError}
      />,
    )

    fireEvent.submit(container.querySelector("form")!)

    expect(onSubmitData).not.toHaveBeenCalled()
    expect(onValidationError).toHaveBeenCalledTimes(1)
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Choose at least one option for “Topics”.",
    )
  })

  it("reports one analytics event for a burst of native invalid controls", () => {
    const nativeFields: FieldDefinition[] = [
      {
        ...fields[0],
        id: "first",
        name: "First",
        type: "singleLineText",
      },
      {
        ...fields[0],
        id: "second",
        name: "Second",
        type: "singleLineText",
      },
    ]
    const nativeForm: FormDefinition = {
      ...form,
      questions: nativeFields.map((field, index) => ({
        id: field.id,
        fieldId: field.id,
        label: field.name,
        helpText: "",
        required: true,
        rank: String(index),
      })),
    }
    const onValidationError = vi.fn()
    render(
      <PublicForm
        form={nativeForm}
        fields={nativeFields}
        onValidationError={onValidationError}
      />,
    )

    fireEvent.invalid(screen.getByRole("textbox", { name: /First/ }))
    fireEvent.invalid(screen.getByRole("textbox", { name: /Second/ }))

    expect(onValidationError).toHaveBeenCalledTimes(1)
  })

  it("reports abandonment once with the last focused visible question", () => {
    const onAbandonment = vi.fn()
    const onStart = vi.fn()
    render(
      <PublicForm
        form={{ ...form, questions: [form.questions[0]!] }}
        fields={fields}
        onAbandonment={onAbandonment}
        onStart={onStart}
      />,
    )

    fireEvent.focus(screen.getByRole("textbox", { name: /Details/ }))
    window.dispatchEvent(new Event("pagehide"))
    window.dispatchEvent(new Event("pagehide"))

    expect(onStart).toHaveBeenCalledOnce()
    expect(onAbandonment).toHaveBeenCalledOnce()
    expect(onAbandonment).toHaveBeenCalledWith("details-question")
  })

  it("suppresses abandonment after success and resets it for another response", async () => {
    const onAbandonment = vi.fn()
    const onSubmitData = vi.fn(async () => ({ title: "Saved" }))
    const { container } = render(
      <PublicForm
        form={{ ...form, questions: [form.questions[0]!] }}
        fields={fields}
        onAbandonment={onAbandonment}
        onSubmitData={onSubmitData}
      />,
    )

    fireEvent.focus(screen.getByRole("textbox", { name: /Details/ }))
    fireEvent.submit(container.querySelector("form")!)
    await screen.findByRole("heading", { name: "Saved" })
    window.dispatchEvent(new Event("pagehide"))

    expect(onAbandonment).not.toHaveBeenCalled()

    fireEvent.click(
      screen.getByRole("button", { name: "Submit another response" }),
    )
    fireEvent.focus(screen.getByRole("textbox", { name: /Details/ }))
    window.dispatchEvent(new Event("pagehide"))

    expect(onAbandonment).toHaveBeenCalledOnce()
    expect(onAbandonment).toHaveBeenCalledWith("details-question")
  })

  it("shows selected attachments, allows removal, and rejects the wrong file kind", () => {
    const imageField: FieldDefinition = {
      ...fields[2],
      config: { attachmentKind: "image" },
    }
    const imageForm: FormDefinition = {
      ...form,
      questions: [
        {
          ...form.questions[2],
          fieldId: imageField.id,
          required: false,
        },
      ],
    }
    const { container } = render(
      <PublicForm form={imageForm} fields={[imageField]} />,
    )
    const input = container.querySelector<HTMLInputElement>(
      'input[type="file"]',
    )!
    expect(input).toHaveClass("sr-only")
    expect(input).not.toHaveClass("w-full")

    fireEvent.change(input, {
      target: {
        files: [
          new File(["document"], "notes.pdf", {
            type: "application/pdf",
          }),
        ],
      },
    })
    expect(
      screen.getByText("notes.pdf must be an image."),
    ).toHaveAttribute("role", "alert")
    expect(
      screen.queryByRole("button", { name: "Remove notes.pdf" }),
    ).not.toBeInTheDocument()

    fireEvent.change(input, {
      target: {
        files: [
          new File(["image"], "photo.png", {
            type: "image/png",
          }),
        ],
      },
    })
    const remove = screen.getByRole("button", {
      name: "Remove photo.png",
    })
    expect(remove).toBeInTheDocument()

    fireEvent.click(remove)
    expect(
      screen.queryByRole("button", { name: "Remove photo.png" }),
    ).not.toBeInTheDocument()
  })

  it("submits the selected files and focuses an announced completion message", async () => {
    const fileForm: FormDefinition = {
      ...form,
      questions: [{ ...form.questions[2], required: false }],
    }
    let submitted: FormData | undefined
    const onSubmitData = vi.fn(async (data: FormData) => {
      submitted = data
      return { title: "Response saved", message: "Thanks." }
    })
    const { container } = render(
      <PublicForm
        form={fileForm}
        fields={fields}
        onSubmitData={onSubmitData}
      />,
    )
    const file = new File(["notes"], "notes.txt", {
      type: "text/plain",
    })

    fireEvent.change(
      container.querySelector<HTMLInputElement>('input[type="file"]')!,
      { target: { files: [file] } },
    )
    fireEvent.submit(container.querySelector("form")!)

    const currentForm = within(container)
    expect(await currentForm.findByRole("status")).toBeInTheDocument()
    expect(submitted?.getAll("files-question")).toEqual([file])
    await waitFor(() =>
      expect(
        currentForm.getByRole("heading", { name: "Response saved" }),
      ).toHaveFocus(),
    )
  })

  it("uses a readable foreground on light custom accent surfaces", async () => {
    const lightAccentForm: FormDefinition = {
      ...form,
      theme: { ...form.theme, accent: "#fef08a" },
      questions: [{ ...form.questions[0], required: false }],
    }
    const view = render(
      <PublicForm
        form={lightAccentForm}
        fields={fields}
        onSubmitData={async () => ({
          title: "Response saved",
          message: "Thanks.",
        })}
      />,
    )
    const currentForm = within(view.container)
    const submit = currentForm.getByRole("button", {
      name: lightAccentForm.submitLabel,
    })
    expect(submit).toHaveStyle({ color: "#000000" })

    fireEvent.submit(view.container.querySelector("form")!)
    const status = await currentForm.findByRole("status")
    expect(status.querySelector("span")).toHaveStyle({
      color: "#000000",
    })
  })

  it("shows conditional questions from answers and prunes them when hidden", async () => {
    const conditionalFields: FieldDefinition[] = [
      {
        ...fields[0],
        id: "launch",
        name: "Launch decision",
        type: "singleLineText",
      },
      {
        ...fields[0],
        id: "reason",
        name: "Launch reason",
        type: "longText",
      },
    ]
    const conditionalForm: FormDefinition = {
      ...form,
      questions: [
        {
          id: "launch-question",
          fieldId: "launch",
          label: "Should we launch?",
          helpText: "",
          required: false,
          rank: "a",
        },
        {
          id: "reason-question",
          fieldId: "reason",
          label: "Why should we launch?",
          helpText: "",
          required: true,
          rank: "b",
          visibility: {
            conjunction: "and",
            conditions: [
              {
                id: "launch-yes",
                sourceQuestionId: "launch-question",
                sourceFieldId: "launch",
                operator: "is",
                value: "yes",
              },
            ],
          },
        },
      ],
    }
    let submitted: FormData | undefined
    const onSubmitData = vi.fn(async (data: FormData) => {
      submitted = data
      return { title: "Saved" }
    })
    const { container } = render(
      <PublicForm
        fields={conditionalFields}
        form={conditionalForm}
        onSubmitData={onSubmitData}
      />,
    )

    expect(
      screen.queryByRole("textbox", { name: /Why should we launch/ }),
    ).not.toBeInTheDocument()

    fireEvent.input(
      screen.getByRole("textbox", { name: "Should we launch?" }),
      { target: { value: "yes" } },
    )
    const reason = await screen.findByRole("textbox", {
      name: /Why should we launch/,
    })
    fireEvent.input(reason, {
      target: { value: "A strong customer signal" },
    })

    fireEvent.input(
      screen.getByRole("textbox", { name: "Should we launch?" }),
      { target: { value: "no" } },
    )
    await waitFor(() =>
      expect(
        screen.queryByRole("textbox", {
          name: /Why should we launch/,
        }),
      ).not.toBeInTheDocument(),
    )

    fireEvent.submit(container.querySelector("form")!)
    await waitFor(() => expect(onSubmitData).toHaveBeenCalledTimes(1))
    expect(submitted?.get("launch-question")).toBe("no")
    expect(submitted?.has("reason-question")).toBe(false)
  })

  it("explains partial attachment progress without asking for another upload", () => {
    render(
      <PublicForm
        fields={fields}
        form={form}
        partialUploadState={{
          uploadedCount: 1,
          totalCount: 2,
          failedFileName: "launch-plan.pdf",
        }}
      />,
    )

    const status = screen.getByRole("status")
    expect(status).toHaveTextContent("1 of 2 files are safely uploaded")
    expect(status).toHaveTextContent("launch-plan.pdf did not finish")
    expect(status).toHaveTextContent(
      "Already uploaded files will not be sent twice",
    )
    expect(status).not.toHaveTextContent("upload again")
  })

  it("renders the published logo, cover, and open layout", () => {
    const { container } = render(
      <PublicForm
        fields={fields}
        form={{
          ...form,
          theme: {
            ...form.theme,
            layout: "plain",
            logoUrl: "https://images.example/logo.png",
            coverUrl: "https://images.example/cover.jpg",
          },
        }}
      />,
    )

    expect(
      container.querySelector('[data-form-layout="plain"]'),
    ).toBeInTheDocument()
    expect(
      screen.getByRole("img", { name: `${form.title} logo` }),
    ).toHaveAttribute("src", "https://images.example/logo.png")
    expect(
      container.querySelector(
        '[style*="https://images.example/cover.jpg"]',
      ),
    ).toBeInTheDocument()
  })
})
