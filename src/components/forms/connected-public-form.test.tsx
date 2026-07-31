import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { getFunctionName } from "convex/server"
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest"

import { ConnectedPublicForm } from "@/components/forms/connected-public-form"

const mocks = vi.hoisted(() => {
  const originalTurnstileSiteKey =
    process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY
  process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY =
    "1x00000000000000000000AA"
  return {
    originalTurnstileSiteKey,
    beginSubmission: vi.fn(),
    createUploadSession: vi.fn(),
    finalizeUpload: vi.fn(),
    getPublicForm: vi.fn(),
    submitForm: vi.fn(),
    trackMetric: vi.fn(),
    useAction: vi.fn(),
    selectedFiles: undefined as File[] | undefined,
  }
})

vi.mock("convex/react", () => ({
  useAction: mocks.useAction,
}))

vi.mock("@/components/forms/public-form", () => ({
  PublicForm: ({
    onAbandonment,
    onSubmitData,
    onStart,
    onValidationError,
    partialUploadState,
  }: {
    onAbandonment?: (lastQuestionId?: string) => void
    onSubmitData?: (data: FormData) => Promise<unknown>
    onStart?: () => void
    onValidationError?: () => void
    partialUploadState?: {
      uploadedCount: number
      totalCount: number
      failedFileName?: string
    }
  }) => (
    <div>
      <span>Public form ready</span>
      <button onClick={onStart}>Start form</button>
      <button
        onClick={() => onAbandonment?.("question_internal")}
      >
        Leave form
      </button>
      <button onClick={onValidationError}>Show validation error</button>
      <button
        onClick={() => {
          const data = new FormData()
          data.set("cf-turnstile-response", "verified")
          mocks.selectedFiles ??= [
            new File(["one"], "brief.pdf", {
              type: "application/pdf",
            }),
            new File(["two"], "launch-plan.pdf", {
              type: "application/pdf",
            }),
          ]
          for (const file of mocks.selectedFiles) {
            data.append("attachments_question", file)
          }
          void onSubmitData?.(data).catch(() => {})
        }}
      >
        Submit attachments
      </button>
      {partialUploadState ? (
        <div role="status">
          {partialUploadState.uploadedCount} of{" "}
          {partialUploadState.totalCount} safe
          {partialUploadState.failedFileName
            ? `; ${partialUploadState.failedFileName} failed`
            : ""}
        </div>
      ) : null}
    </div>
  ),
}))

const publishedForm = {
  slug: "campaign-intake",
  formVersionId: "version_internal",
  version: 1,
  title: "Campaign intake",
  description: "Tell us about the campaign.",
  appearance: {
    primaryColor: "#2563eb",
    backgroundColor: "#ffffff",
    submitLabel: "Submit",
    showPoweredBy: true,
    logoUrl: null,
    coverUrl: null,
  },
  fields: [
    {
      id: "question_internal",
      type: "singleLineText",
      config: {},
      label: "Campaign summary",
      required: false,
      mode: "visible",
    },
  ],
}

beforeEach(() => {
  mocks.selectedFiles = undefined
  window.history.replaceState(
    {},
    "",
    "/f/campaign-intake?utm_source=private-campaign",
  )
  Object.defineProperty(document, "referrer", {
    configurable: true,
    value: "https://private-referrer.example/secret",
  })
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: 1_280,
  })

  mocks.getPublicForm.mockResolvedValue(publishedForm)
  mocks.trackMetric.mockResolvedValue(null)
  mocks.useAction.mockImplementation((reference) => {
    switch (getFunctionName(reference)) {
      case "publicActions:getPublicForm":
        return mocks.getPublicForm
      case "publicActions:trackFormMetric":
        return mocks.trackMetric
      case "publicActions:beginPublicSubmission":
        return mocks.beginSubmission
      case "publicActions:createPublicUploadSession":
        return mocks.createUploadSession
      case "publicActions:finalizePublicUpload":
        return mocks.finalizeUpload
      case "publicActions:submitForm":
        return mocks.submitForm
      default:
        throw new Error(`Unexpected action: ${getFunctionName(reference)}`)
    }
  })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  Reflect.deleteProperty(document, "referrer")
  window.history.replaceState({}, "", "/")
})

afterAll(() => {
  if (mocks.originalTurnstileSiteKey === undefined) {
    delete process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY
  } else {
    process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY =
      mocks.originalTurnstileSiteKey
  }
})

describe("ConnectedPublicForm readable links", () => {
  it("keeps a legacy link working, then replaces it with the readable address without losing prefilled answers", async () => {
    const prefillQuery = "customer=Acme+Studio&campaign=summer"
    window.history.replaceState(
      {},
      "",
      `/f/form-550e8400-e29b-41d4-a716-446655440000?${prefillQuery}`,
    )
    mocks.getPublicForm.mockResolvedValue({
      ...publishedForm,
      slug: "campaign-intake",
    })

    render(
      <ConnectedPublicForm
        prefillQuery={prefillQuery}
        slug="form-550e8400-e29b-41d4-a716-446655440000"
      />,
    )
    await screen.findByText("Public form ready")

    expect(window.location.pathname).toBe("/f/campaign-intake")
    expect(window.location.search).toBe(
      "?customer=Acme+Studio&campaign=summer",
    )
    expect(mocks.getPublicForm).toHaveBeenCalledWith({
      slug: "form-550e8400-e29b-41d4-a716-446655440000",
    })
  })
})

describe("ConnectedPublicForm analytics privacy", () => {
  it("sends only coarse view context and question progress", async () => {
    render(<ConnectedPublicForm slug="campaign-intake" />)
    await screen.findByText("Public form ready")
    await waitFor(() => expect(mocks.trackMetric).toHaveBeenCalled())

    fireEvent.click(screen.getByRole("button", { name: "Start form" }))
    fireEvent.click(
      screen.getByRole("button", { name: "Show validation error" }),
    )
    fireEvent.click(screen.getByRole("button", { name: "Leave form" }))

    const payloads = mocks.trackMetric.mock.calls.map(([payload]) => payload)
    expect(payloads).toEqual([
      {
        slug: "campaign-intake",
        formVersionId: "version_internal",
        metric: "view",
        visitorNonce: expect.any(String),
        deviceCategory: "desktop",
        trafficSource: "campaign",
      },
      {
        slug: "campaign-intake",
        formVersionId: "version_internal",
        metric: "start",
        visitorNonce: expect.any(String),
      },
      {
        slug: "campaign-intake",
        formVersionId: "version_internal",
        metric: "validation_error",
        visitorNonce: expect.any(String),
      },
      {
        slug: "campaign-intake",
        formVersionId: "version_internal",
        metric: "abandonment",
        visitorNonce: expect.any(String),
        lastQuestionId: "question_internal",
      },
    ])

    const serialized = JSON.stringify(payloads)
    expect(serialized).not.toContain("private-campaign")
    expect(serialized).not.toContain("private-referrer")
    for (const payload of payloads) {
      expect(payload).not.toHaveProperty("answers")
      expect(payload).not.toHaveProperty("files")
      expect(payload).not.toHaveProperty("referrer")
      expect(payload).not.toHaveProperty("currentUrl")
      expect(payload).not.toHaveProperty("userAgent")
    }
  })
})

describe("ConnectedPublicForm attachment retry state", () => {
  it("preserves successful uploads and reports the file that stopped", async () => {
    mocks.getPublicForm.mockResolvedValue({
      ...publishedForm,
      fields: [
        {
          id: "attachments_question",
          type: "attachment",
          config: { attachmentKind: "any" },
          label: "Supporting files",
          required: false,
          mode: "visible",
        },
      ],
    })
    mocks.beginSubmission.mockResolvedValue({
      submissionSessionId: "session_internal",
      submissionProof: "proof",
      expiresAt: Date.now() + 60_000,
    })
    mocks.createUploadSession
      .mockResolvedValueOnce({
        uploadSessionId: "upload_one",
        uploadUrl: "https://upload.example/one",
        expiresAt: Date.now() + 60_000,
      })
      .mockResolvedValueOnce({
        uploadSessionId: "upload_two",
        uploadUrl: "https://upload.example/two",
        expiresAt: Date.now() + 60_000,
      })
      .mockResolvedValueOnce({
        uploadSessionId: "upload_two_retry",
        uploadUrl: "https://upload.example/two-retry",
        expiresAt: Date.now() + 60_000,
      })
    mocks.finalizeUpload
      .mockResolvedValueOnce({
        ok: true,
        attachmentId: "attachment_one",
      })
      .mockResolvedValueOnce({
        ok: false,
        error: "Upload did not finish",
      })
      .mockResolvedValueOnce({
        ok: true,
        attachmentId: "attachment_two",
      })
    mocks.submitForm.mockResolvedValue({
      thankYou: {
        title: "Thanks",
        message: "Saved",
      },
    })
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue({
        ok: true,
        json: async () => ({ storageId: "storage_internal" }),
      } as Response)

    render(<ConnectedPublicForm slug="campaign-intake" />)
    await screen.findByText("Public form ready")
    fireEvent.click(
      screen.getByRole("button", { name: "Submit attachments" }),
    )

    expect(await screen.findByRole("status")).toHaveTextContent(
      "1 of 2 safe; launch-plan.pdf failed",
    )
    expect(mocks.submitForm).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledTimes(2)

    fireEvent.click(
      screen.getByRole("button", { name: "Submit attachments" }),
    )
    await waitFor(() => expect(mocks.submitForm).toHaveBeenCalledOnce())
    expect(mocks.createUploadSession).toHaveBeenCalledTimes(3)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })
})
