import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { getFunctionName } from "convex/server"
import type { ReactNode } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { ConnectedFormEditor } from "@/components/connected/form-editor"

const mocks = vi.hoisted(() => ({
  useAuth: vi.fn(() => ({
    has: () => true,
    isLoaded: true,
    orgId: "organization",
    orgRole: "org:admin",
  })),
  useMutation: vi.fn((reference?: unknown) => {
    void reference
    return vi.fn()
  }),
  useQuery: vi.fn(),
  createAppearanceUploadUrl: vi.fn(),
  clipboardWriteText: vi.fn(),
  saveDraft: vi.fn(),
  setAppearanceAsset: vi.fn(),
  useConnectionState: vi.fn(),
}))

vi.mock("@clerk/nextjs", () => ({
  useAuth: mocks.useAuth,
}))

vi.mock("convex/react", () => ({
  useConvexAuth: () => ({
    isAuthenticated: true,
    isLoading: false,
  }),
  useConvexConnectionState: mocks.useConnectionState,
  useMutation: mocks.useMutation,
  useQuery: mocks.useQuery,
}))

vi.mock("@/components/connected/org-states", () => ({
  ActiveOrganizationRequired: () => <div>Choose a workspace</div>,
  ConnectedLoading: () => <div>Loading</div>,
  ConnectedTopBar: ({ children }: { children?: ReactNode }) => (
    <header>{children}</header>
  ),
  SignedOutState: () => <div>Sign in</div>,
}))

vi.mock("@/components/connected/assistant-sheet", () => ({
  ConnectedAssistantSheet: () => null,
}))

vi.mock("@/components/forms/public-form", () => ({
  PublicForm: ({
    form,
  }: {
    form: {
      theme: {
        layout: string
        logoUrl?: string
        coverUrl?: string
      }
    }
  }) => (
    <div data-form-layout={form.theme.layout}>
      Form preview
      {form.theme.logoUrl ? <span>Logo visible in preview</span> : null}
      {form.theme.coverUrl ? <span>Cover visible in preview</span> : null}
    </div>
  ),
}))

vi.mock("@/components/forms/conditional-logic-editor", () => ({
  ConditionalLogicEditor: () => <div>Display rules</div>,
}))

vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
)
HTMLElement.prototype.scrollIntoView = vi.fn()
Element.prototype.getAnimations = vi.fn(() => [])
Object.defineProperty(navigator, "clipboard", {
  configurable: true,
  value: {
    writeText: mocks.clipboardWriteText,
  },
})

beforeEach(() => {
  mocks.clipboardWriteText.mockReset()
  mocks.clipboardWriteText.mockResolvedValue(undefined)
  mocks.useConnectionState.mockReturnValue({
    connectionRetries: 0,
    hasEverConnected: true,
    inflightMutations: 0,
    isWebSocketConnected: true,
    timeOfOldestInflightRequest: null,
  })
})

afterEach(cleanup)

function renderEditorQuestion({
  fieldConfig = {},
  fieldType = "singleLineText",
  fixedValue,
  mode,
  prefillParameter,
  published = false,
}: {
  fieldConfig?: {
    options?: Array<{ id: string; label: string; color: string }>
  }
  fieldType?: "singleLineText" | "singleSelect"
  fixedValue?: string
  mode: "hidden" | "visible"
  prefillParameter?: string
  published?: boolean
}) {
  mocks.useQuery.mockImplementation((reference) => {
    switch (getFunctionName(reference)) {
      case "forms:getDraft":
        return {
          form: {
            _id: "form_internal",
            baseId: "base_internal",
            tableId: "table_internal",
            name: "Campaign intake",
            slug: "private-address",
            title: "Campaign intake",
            description: "Tell us about the campaign.",
            status: published ? "published" : "draft",
            appearance: {
              primaryColor: "#2563eb",
              backgroundColor: "#ffffff",
              submitLabel: "Submit",
              showPoweredBy: true,
              layout: "card",
              logoUrl: null,
              coverUrl: null,
              logoFingerprint: null,
              coverFingerprint: null,
            },
            thankYou: {
              title: "Thank you",
              message: "Response received.",
            },
            draftRevision: 1,
          },
          fields: [
            {
              _id: "question_internal",
              targetFieldId: "column_internal",
              label: "Campaign source",
              required: mode === "hidden",
              rank: "a",
              mode,
              fixedValue,
              prefillParameter,
            },
          ],
          liveVersion: published
            ? {
                version: 1,
                publishedAt: Date.now(),
                title: "Campaign intake",
                description: "Tell us about the campaign.",
                appearance: {
                  primaryColor: "#2563eb",
                  backgroundColor: "#ffffff",
                  submitLabel: "Submit",
                  showPoweredBy: true,
                  layout: "card",
                  logoUrl: null,
                  coverUrl: null,
                  logoFingerprint: null,
                  coverFingerprint: null,
                },
                thankYou: {
                  title: "Thank you",
                  message: "Response received.",
                },
                fields: [
                  {
                    targetFieldId: "column_internal",
                    label: "Campaign source",
                    required: mode === "hidden",
                    mode,
                    fixedValue,
                    prefillParameter,
                  },
                ],
              }
            : null,
        }
      case "fields:list":
        return [
            {
              _id: "column_internal",
              name: "Campaign source",
              type: fieldType,
              config: fieldConfig,
            rank: "a",
            width: 200,
            isPrimary: true,
            status: "active",
          },
        ]
      default:
        return undefined
    }
  })

  return render(
    <ConnectedFormEditor
      baseId="base_internal"
      formId="form_internal"
    />,
  )
}

function expectInternalReferencesHidden(container: HTMLElement) {
  expect(container.textContent).not.toContain("form_internal")
  expect(container.textContent).not.toContain("table_internal")
  expect(container.textContent).not.toContain("column_internal")
  expect(container.textContent).not.toContain("question_internal")
  expect(container.textContent).not.toContain("private-address")
}

describe("form editor answer sources", () => {
  it("uses a named, typed control for an automatic hidden value", () => {
    const { container } = renderEditorQuestion({
      fieldConfig: {
        options: [
          {
            id: "option_internal_partner",
            label: "Partner referral",
            color: "#2563eb",
          },
        ],
      },
      fieldType: "singleSelect",
      fixedValue: "option_internal_partner",
      mode: "hidden",
    })

    expect(screen.getByLabelText("Save answers in")).toHaveTextContent(
      "Campaign source",
    )
    expect(
      screen.getByRole("combobox", {
        name: "How this column is filled",
      }),
    ).toHaveTextContent("Set automatically and hide")
    expect(screen.getByLabelText("Builder label")).toHaveValue(
      "Campaign source",
    )
    expect(
      screen.getByLabelText("Fixed value for Campaign source"),
    ).toHaveTextContent("Partner referral")
    expect(
      screen.getByText(/Visitors will not see this question/i),
    ).toBeInTheDocument()
    expect(
      screen.queryByText("Start with an answer filled in"),
    ).not.toBeInTheDocument()
    expect(container.textContent).not.toContain("option_internal_partner")
    expectInternalReferencesHidden(container)

    fireEvent.click(
      screen.getByRole("button", { name: "Review publish changes" }),
    )
    expect(
      screen.getByRole("heading", { name: "Publish this form?" }),
    ).toBeInTheDocument()
    expect(screen.getByText("Added questions")).toBeInTheDocument()
    expect(document.body.textContent).not.toContain(
      "option_internal_partner",
    )
  })

  it("creates prefilled links from a friendly starting-answer input without exposing link keys", () => {
    const { container } = renderEditorQuestion({
      mode: "visible",
      prefillParameter: "campaign_source",
    })

    expect(
      screen.getByRole("combobox", {
        name: "How this column is filled",
      }),
    ).toHaveTextContent("Ask on the form")
    expect(
      screen.getByRole("switch", { name: "Required" }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole("switch", {
        name: "Start with an answer filled in",
      }),
    ).toBeInTheDocument()
    expect(
      screen.getByText("Start with an answer filled in"),
    ).toBeInTheDocument()
    expect(screen.getByLabelText("Starting answer")).toBeInTheDocument()
    expect(
      screen.getByRole("button", {
        name: "Copy link with this answer",
      }),
    ).toBeDisabled()
    expect(screen.getByText(/publish your latest changes/i)).toBeInTheDocument()
    expect(container.textContent).not.toContain("campaign_source")
    expect(container.textContent).not.toContain("?campaign_source")
    expect(container.textContent).not.toContain("customer_email")
    expectInternalReferencesHidden(container)
  })

  it("copies a published prefilled link from the starting answer", async () => {
    renderEditorQuestion({
      mode: "visible",
      prefillParameter: "campaign_source",
      published: true,
    })

    fireEvent.change(screen.getByLabelText("Starting answer"), {
      target: { value: "Partner referral" },
    })
    const copyButton = screen.getByRole("button", {
      name: "Copy link with this answer",
    })
    expect(copyButton).toBeEnabled()
    fireEvent.click(copyButton)

    await waitFor(() =>
      expect(mocks.clipboardWriteText).toHaveBeenCalledWith(
        "http://localhost:3000/f/private-address?campaign_source=Partner+referral",
      ),
    )
  })

  it("supports pointer reordering while preserving named keyboard buttons", () => {
    mocks.useQuery.mockImplementation((reference) => {
      switch (getFunctionName(reference)) {
        case "forms:getDraft":
          return {
            form: {
              _id: "form_internal",
              baseId: "base_internal",
              tableId: "table_internal",
              name: "Campaign intake",
              slug: "private-address",
              title: "Campaign intake",
              description: "",
              status: "draft",
              appearance: {
                primaryColor: "#2563eb",
                backgroundColor: "#ffffff",
                submitLabel: "Submit",
                showPoweredBy: true,
                layout: "card",
                logoUrl: null,
                coverUrl: null,
                logoFingerprint: null,
                coverFingerprint: null,
              },
              thankYou: {
                title: "Thank you",
                message: "Response received.",
              },
              draftRevision: 1,
            },
            fields: [
              {
                _id: "question_one_internal",
                targetFieldId: "column_one_internal",
                label: "Campaign name",
                required: true,
                rank: "a",
                mode: "visible",
              },
              {
                _id: "question_two_internal",
                targetFieldId: "column_two_internal",
                label: "Campaign owner",
                required: false,
                rank: "b",
                mode: "visible",
              },
            ],
            liveVersion: null,
          }
        case "fields:list":
          return [
            {
              _id: "column_one_internal",
              name: "Campaign name",
              type: "singleLineText",
              config: {},
              rank: "a",
              width: 200,
              isPrimary: true,
              status: "active",
            },
            {
              _id: "column_two_internal",
              name: "Campaign owner",
              type: "email",
              config: {},
              rank: "b",
              width: 200,
              isPrimary: false,
              status: "active",
            },
          ]
        default:
          return undefined
      }
    })

    const { container } = render(
      <ConnectedFormEditor
        baseId="base_internal"
        formId="form_internal"
      />,
    )
    const rows = Array.from(
      container.querySelectorAll<HTMLElement>('[draggable="true"]'),
    )
    expect(rows).toHaveLength(2)
    expect(rows[0]).toHaveTextContent("Campaign name")
    expect(rows[1]).toHaveTextContent("Campaign owner")

    let dragged = ""
    const dataTransfer = {
      dropEffect: "none",
      effectAllowed: "none",
      getData: () => dragged,
      setData: (_type: string, value: string) => {
        dragged = value
      },
    }
    fireEvent.dragStart(rows[0]!, { dataTransfer })
    fireEvent.dragOver(rows[1]!, { dataTransfer })
    fireEvent.drop(rows[1]!, { dataTransfer })

    const reordered = Array.from(
      container.querySelectorAll<HTMLElement>('[draggable="true"]'),
    )
    expect(reordered[0]).toHaveTextContent("Campaign owner")
    expect(reordered[1]).toHaveTextContent("Campaign name")
    expect(
      screen.getByRole("button", { name: "Move Campaign name up" }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "Move Campaign owner down" }),
    ).toBeInTheDocument()
  })

  it("uses named image controls, layout choices, and responsive previews", async () => {
    const otherMutation = vi.fn()
    mocks.createAppearanceUploadUrl.mockResolvedValue(
      "https://upload.example/logo",
    )
    mocks.setAppearanceAsset.mockResolvedValue({
      draftRevision: 2,
      url: "https://images.example/logo.png",
      fingerprint: "image-fingerprint",
    })
    mocks.useMutation.mockImplementation((reference: unknown) => {
      switch (
        getFunctionName(
          reference as Parameters<typeof getFunctionName>[0],
        )
      ) {
        case "forms:createAppearanceUploadUrl":
          return mocks.createAppearanceUploadUrl
        case "forms:setAppearanceAsset":
          return mocks.setAppearanceAsset
        default:
          return otherMutation
      }
    })
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue({
        ok: true,
        json: async () => ({ storageId: "storage_internal" }),
      } as Response)
    const { container } = renderEditorQuestion({
      mode: "visible",
    })

    fireEvent.click(screen.getByRole("tab", { name: "Design" }))
    expect(
      screen.getByRole("button", { name: /^Card layout/ }),
    ).toHaveAttribute("aria-pressed", "true")
    fireEvent.click(
      screen.getByRole("button", { name: /^Open layout/ }),
    )
    expect(
      container.querySelector('[data-form-layout="plain"]'),
    ).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "Desktop preview" }),
    ).toBeInTheDocument()
    fireEvent.click(
      screen.getByRole("button", { name: "Mobile preview" }),
    )

    const logoInput = container.querySelector<HTMLInputElement>(
      "#connected-form-logo-image",
    )!
    fireEvent.change(logoInput, {
      target: {
        files: [
          new File(["logo"], "company-logo.png", {
            type: "image/png",
          }),
        ],
      },
    })

    await waitFor(() =>
      expect(mocks.setAppearanceAsset).toHaveBeenCalledWith({
        formId: "form_internal",
        expectedRevision: 1,
        kind: "logo",
        storageId: "storage_internal",
      }),
    )
    expect(
      await screen.findByText("Logo visible in preview"),
    ).toBeInTheDocument()
    expect(
      screen.getByText("No cover image selected"),
    ).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(container.textContent).not.toContain("storage_internal")
    expect(container.textContent).not.toContain("image-fingerprint")
  })

  it("preserves unsaved text and blocks saving, publishing, and uploads until recovery", async () => {
    mocks.useConnectionState.mockReturnValue({
      connectionRetries: 1,
      hasEverConnected: true,
      inflightMutations: 0,
      isWebSocketConnected: false,
      timeOfOldestInflightRequest: null,
    })
    mocks.saveDraft.mockResolvedValue({ draftRevision: 2 })
    mocks.useMutation.mockImplementation((reference: unknown) => {
      const functionName = getFunctionName(
        reference as Parameters<typeof getFunctionName>[0],
      )
      if (functionName === "forms:saveDraft") return mocks.saveDraft
      return vi.fn()
    })

    const view = renderEditorQuestion({ mode: "visible" })
    fireEvent.click(screen.getByRole("tab", { name: "Design" }))
    const workspaceName = screen.getByLabelText("Form name")
    fireEvent.change(workspaceName, {
      target: { value: "Campaign intake — offline draft" },
    })

    expect(screen.getByText(/Form changes are paused/i)).toHaveTextContent(
      /unsaved draft stays here/i,
    )
    expect(
      screen.getByRole("button", { name: "Save changes" }),
    ).toBeDisabled()
    expect(
      screen.getByRole("button", { name: "Review publish changes" }),
    ).toBeDisabled()
    expect(
      view.container.querySelector("#connected-form-logo-image"),
    ).toBeDisabled()
    expect(mocks.saveDraft).not.toHaveBeenCalled()

    mocks.useConnectionState.mockReturnValue({
      connectionRetries: 0,
      hasEverConnected: true,
      inflightMutations: 0,
      isWebSocketConnected: true,
      timeOfOldestInflightRequest: null,
    })
    view.rerender(
      <ConnectedFormEditor
        baseId="base_internal"
        formId="form_internal"
      />,
    )

    expect(screen.getByLabelText("Form name")).toHaveValue(
      "Campaign intake — offline draft",
    )
    const saveButton = screen.getByRole("button", {
      name: "Save changes",
    })
    expect(saveButton).toBeEnabled()
    expect(
      view.container.querySelector("#connected-form-logo-image"),
    ).toBeEnabled()
    fireEvent.click(saveButton)

    await waitFor(() =>
      expect(mocks.saveDraft).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "Campaign intake — offline draft",
        }),
      ),
    )
  })

  it("keeps publication state and responsive preview controls visible in the builder", () => {
    renderEditorQuestion({
      mode: "visible",
      published: true,
    })

    expect(
      screen.getByLabelText("Publication status"),
    ).toHaveTextContent("Published · version 1")
    expect(
      screen.getByLabelText("Live form preview"),
    ).toHaveTextContent("Public form preview")
    expect(
      screen.getByRole("button", { name: "Desktop preview" }),
    ).toHaveTextContent("Desktop")
    expect(
      screen.getByRole("button", { name: "Mobile preview" }),
    ).toHaveTextContent("Mobile")
    expect(screen.getByText("Form outline")).toBeInTheDocument()
    expect(screen.getByText(/Saves to Campaign source/)).toBeInTheDocument()
  })
})
