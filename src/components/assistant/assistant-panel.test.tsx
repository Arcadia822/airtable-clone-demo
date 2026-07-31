import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  ASSISTANT_TURN_TIMEOUT_MS,
} from "@/lib/eve/assistant-resilience"

import { AssistantPanel } from "./assistant-panel"

const clerkGetToken = vi.hoisted(() => vi.fn())
const clientSession = vi.hoisted(() => ({
  cancel: vi.fn(),
  reset: vi.fn(),
}))
const saveReportMutation = vi.hoisted(() => vi.fn())
const archiveReportMutation = vi.hoisted(() => vi.fn())
const savedReportsState = vi.hoisted(() => ({
  lists: {
    active: [] as Array<Record<string, unknown>>,
    archived: [] as Array<Record<string, unknown>>,
  },
  openReport: undefined as Record<string, unknown> | null | undefined,
}))
const agentState = vi.hoisted(() => ({
  data: {
    messages: [] as unknown[],
  },
  error: undefined as Error | undefined,
  events: [] as unknown[],
  reset: vi.fn(),
  send: vi.fn(),
  status: "ready" as "error" | "ready" | "streaming" | "submitted",
  stop: vi.fn(),
}))

vi.mock("@clerk/nextjs", () => ({
  useAuth: () => ({ getToken: clerkGetToken }),
}))

vi.mock("convex/react", async () => {
  const { getFunctionName } =
    await vi.importActual<typeof import("convex/server")>("convex/server")
  return {
    useConvexAuth: () => ({
      isAuthenticated: true,
      isLoading: false,
    }),
    useMutation: (reference: unknown) => {
      const name = getFunctionName(reference as never)
      if (name === "aiReports:save") return saveReportMutation
      if (name === "aiReports:archive") return archiveReportMutation
      return vi.fn()
    },
    useQuery: (reference: unknown, args: unknown) => {
      if (args === "skip") return undefined
      const name = getFunctionName(reference as never)
      if (name === "aiReports:list") return savedReportsState.lists
      if (name === "aiReports:get") return savedReportsState.openReport
      return {
        eligible: true,
        limit: 500,
        recentChanges: [
          {
            createdAt: 1_785_430_524_000,
            id: "audit_change_1",
            label: "Updated a record",
            location: "Product roadmap",
          },
        ],
        remaining: 477,
        used: 23,
      }
    },
  }
})

vi.mock("eve/client", () => ({
  Client: class {
    session() {
      return clientSession
    }
  },
}))

vi.mock("eve/react", () => ({
  useEveAgent: () => agentState,
}))

function approvalMessage() {
  return {
    id: "message-1",
    role: "assistant",
    parts: [
      {
        type: "dynamic-tool",
        toolCallId: "call-1",
        toolName: "update_record",
        state: "approval-requested",
        input: {
          baseId: "base_123",
          tableId: "table_123",
          recordId: "record_123",
          expectedVersion: 8,
          changes: [
            {
              fieldId: "field_123",
              fieldName: "Status",
              before: "Planned",
              after: "Shipped",
            },
          ],
        },
        toolMetadata: {
          eve: {
            inputRequest: {
              display: "confirmation",
              requestId: "request_123",
              prompt:
                "Approve operationId=operation_secret for recordId=record_123",
              options: [
                { id: "approve", label: "Raw approve option" },
                {
                  id: "deny",
                  label: "Raw deny option",
                  style: "danger",
                },
              ],
            },
            kind: "tool-call",
            name: "update_record",
          },
        },
      },
    ],
  }
}

function completedAnalysisMessage() {
  return {
    id: "message-analysis",
    role: "assistant",
    parts: [
      {
        type: "text",
        state: "done",
        text: "Roadmap health is improving. recordId=record_private should never be shown.",
      },
    ],
  }
}

function completedSourcedAnalysisMessage() {
  return {
    id: "message-sourced-analysis",
    role: "assistant",
    parts: [
      {
        type: "dynamic-tool",
        toolCallId: "call-summarize",
        toolName: "summarize_table",
        state: "output-available",
        input: {
          baseId: "base_private",
          tableId: "table_private",
          fieldIds: ["field_status_private"],
          groupByFieldId: "field_status_private",
        },
        output: {
          recordCount: 7,
          summaries: [],
          grouped: [
            { group: "Planned", count: 4 },
            { group: "Shipped", count: 3 },
          ],
          source: {
            kind: "table",
            base: { id: "base_private", name: "Product operations" },
            table: { id: "table_private", name: "Product roadmap" },
            fields: [{ id: "field_status_private", name: "Status" }],
            query: {
              kind: "tableSummary",
              description:
                "Summarized 7 records from Product roadmap using Status, grouped by Status.",
              rowLimit: 500,
            },
          },
          truncated: false,
        },
      },
      {
        type: "text",
        state: "done",
        text: `Facts
Seven records were reviewed: four are Planned and three are Shipped.

Interpretation
The roadmap is moving, with a meaningful share already shipped.

Limitations
Status alone does not show whether delivery is on time.`,
      },
    ],
  }
}

describe("AssistantPanel trust and recovery", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    agentState.data.messages = [approvalMessage()]
    agentState.error = undefined
    agentState.events = []
    agentState.status = "ready"
    agentState.send.mockResolvedValue(undefined)
    saveReportMutation.mockResolvedValue(null)
    archiveReportMutation.mockResolvedValue(null)
    savedReportsState.lists = { active: [], archived: [] }
    savedReportsState.openReport = undefined
    clientSession.cancel.mockResolvedValue({ outcome: "accepted" })
    clientSession.reset.mockResolvedValue({ outcome: "reset" })
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches: true })),
    )
    vi.stubGlobal(
      "ResizeObserver",
      class {
        disconnect() {}
        observe() {}
        unobserve() {}
      },
    )
    Element.prototype.scrollTo = vi.fn()
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it("shows a named scope and plain before/after proposal without internal references", () => {
    render(
      <AssistantPanel
        context={{
          base: { id: "base_secret", name: "Product operations" },
          table: { id: "table_secret", name: "Product roadmap" },
        }}
      />,
    )

    expect(screen.getByText("Update a record")).toBeInTheDocument()
    expect(screen.getByText("Status before")).toBeInTheDocument()
    expect(screen.getByText("Planned")).toBeInTheDocument()
    expect(screen.getByText("Status after")).toBeInTheDocument()
    expect(screen.getByText("Shipped")).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "Approve change" }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "Keep as is" }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole("link", { name: "Open record" }),
    ).toHaveAttribute(
      "href",
      "/bases/base_123/tables/table_123?record=record_123",
    )
    expect(
      screen.getAllByText(/Table · Product roadmap/).length,
    ).toBeGreaterThan(0)
    expect(
      screen.getByText("477 of 500 questions left this month"),
    ).toBeInTheDocument()
    expect(screen.getByText("Recent approved AI changes")).toBeInTheDocument()
    expect(screen.getByText("Updated a record")).toBeInTheDocument()
    expect(screen.getAllByText(/Product roadmap/).length).toBeGreaterThan(0)

    const visible = document.body.textContent ?? ""
    expect(visible).not.toMatch(
      /baseId|tableId|recordId|fieldId|expectedVersion|operationId/,
    )
    expect(visible).not.toMatch(/_123|base_secret|table_secret/)
    expect(visible).not.toContain("Raw approve option")
    expect(document.querySelector("pre")).not.toBeInTheDocument()
  })

  it("submits an explicit approval response and nothing implicit", async () => {
    render(<AssistantPanel />)

    fireEvent.click(screen.getByRole("button", { name: "Approve change" }))

    await waitFor(() => {
      expect(agentState.send).toHaveBeenCalledWith({
        inputResponses: [
          {
            optionId: "approve",
            requestId: "request_123",
          },
        ],
      })
    })
    expect(agentState.send).toHaveBeenCalledTimes(1)
  })

  it("blocks saving a response that has no verified workspace source", () => {
    agentState.data.messages = [completedAnalysisMessage()]

    render(
      <AssistantPanel
        context={{
          base: { id: "base_private", name: "Product operations" },
          table: { id: "table_private", name: "Product roadmap" },
        }}
      />,
    )

    fireEvent.click(screen.getByText("Saved analyses"))
    expect(
      screen.getByRole("button", { name: "Save latest analysis" }),
    ).toBeDisabled()
    expect(screen.getByText(/no verified workspace source/i)).toBeInTheDocument()
    expect(saveReportMutation).not.toHaveBeenCalled()
    expect(document.body.textContent).not.toMatch(
      /recordId|record_private|base_private|table_private/,
    )
  })

  it("shows named evidence and saves only supported aggregate output as a chart", async () => {
    agentState.data.messages = [completedSourcedAnalysisMessage()]

    render(
      <AssistantPanel
        context={{
          base: { id: "base_private", name: "Product operations" },
          table: { id: "table_private", name: "Product roadmap" },
        }}
      />,
    )

    expect(
      screen.getByRole("region", { name: "Facts from workspace data" }),
    ).toHaveTextContent("Seven records were reviewed")
    expect(
      screen.getByRole("region", { name: "Interpretation" }),
    ).toHaveTextContent("The roadmap is moving")
    expect(
      screen.getByRole("link", {
        name:
          "Open source Query · Summarized 7 records from Product roadmap using Status, grouped by Status.",
      }),
    ).toHaveAttribute(
      "href",
      "/bases/base_private/tables/table_private",
    )

    fireEvent.click(screen.getByText("Saved analyses"))
    fireEvent.click(
      screen.getByRole("button", { name: "Save latest analysis" }),
    )
    fireEvent.click(screen.getByRole("button", { name: "Chart" }))

    expect(await screen.findByLabelText("Chart name")).toHaveValue(
      "Product roadmap by Status",
    )
    fireEvent.click(screen.getByRole("button", { name: "Save chart" }))

    await waitFor(() => {
      expect(saveReportMutation).toHaveBeenCalledWith({
        name: "Product roadmap by Status",
        content: `Facts
Seven records were reviewed: four are Planned and three are Shipped.

Interpretation
The roadmap is moving, with a meaningful share already shipped.

Limitations
Status alone does not show whether delivery is on time.`,
        scopeLabel: "Table · Product roadmap",
        format: "chart",
        chart: {
          type: "bar",
          title: "Product roadmap by Status",
          xLabel: "Status",
          yLabel: "Records",
          data: [
            { label: "Planned", value: 4 },
            { label: "Shipped", value: 3 },
          ],
        },
        sources: [
          {
            kind: "table",
            baseId: "base_private",
            tableId: "table_private",
            fieldIds: ["field_status_private"],
            recordIds: [],
            queryDescriptions: [
              "Summarized 7 records from Product roadmap using Status, grouped by Status.",
            ],
          },
        ],
      })
    })

    const visible = document.body.textContent ?? ""
    expect(visible).not.toMatch(
      /base_private|table_private|field_status_private|baseId|tableId|fieldId/,
    )
  })

  it("opens and archives a saved report without exposing its database reference", async () => {
    savedReportsState.lists.active = [
      {
        id: "report_private_reference",
        name: "Weekly roadmap health",
        scopeLabel: "Table · Product roadmap",
        status: "active",
        createdAt: 1_785_430_524_000,
        updatedAt: 1_785_430_524_000,
        canArchive: true,
      },
    ]
    savedReportsState.openReport = {
      name: "Weekly roadmap health",
      content:
        "Three launches are on track. recordId=record_private stays hidden.",
      scopeLabel: "Table · Product roadmap",
      status: "active",
      createdAt: 1_785_430_524_000,
      updatedAt: 1_785_430_524_000,
    }

    render(<AssistantPanel />)

    fireEvent.click(screen.getByText("Saved analyses"))
    fireEvent.click(
      screen.getByRole("button", { name: "Open Weekly roadmap health" }),
    )

    expect(
      await screen.findByRole("heading", { name: "Weekly roadmap health" }),
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        "Three launches are on track. the selected item stays hidden.",
      ),
    ).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(
      /report_private_reference|recordId|record_private/,
    )

    fireEvent.click(
      screen.getByRole("button", { name: "Archive analysis" }),
    )
    await waitFor(() => {
      expect(archiveReportMutation).toHaveBeenCalledWith({
        reportId: "report_private_reference",
      })
    })
  })

  it("renders a saved chart with its named source and accessible values", async () => {
    savedReportsState.lists.active = [
      {
        id: "report_chart_private",
        name: "Status distribution",
        scopeLabel: "Table · Product roadmap",
        format: "chart",
        sourceCount: 1,
        status: "active",
        createdAt: 1_785_430_524_000,
        updatedAt: 1_785_430_524_000,
        canArchive: true,
      },
    ]
    savedReportsState.openReport = {
      name: "Status distribution",
      content: `Facts
Four records are Planned and three are Shipped.

Interpretation
The roadmap has a balanced mix of upcoming and completed work.`,
      scopeLabel: "Table · Product roadmap",
      format: "chart",
      chart: {
        type: "bar",
        title: "Product roadmap by Status",
        xLabel: "Status",
        yLabel: "Records",
        data: [
          { label: "Planned", value: 4 },
          { label: "Shipped", value: 3 },
        ],
      },
      citations: [
        {
          kind: "table",
          label: "Table · Product roadmap",
          href: "/bases/base_private/tables/table_private",
        },
      ],
      status: "active",
      createdAt: 1_785_430_524_000,
      updatedAt: 1_785_430_524_000,
    }

    render(<AssistantPanel />)

    fireEvent.click(screen.getByText("Saved analyses"))
    fireEvent.click(
      screen.getByRole("button", { name: "Open Status distribution" }),
    )

    expect(
      await screen.findByRole("img", {
        name: "Product roadmap by Status. Records by Status.",
      }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole("region", { name: "Facts from workspace data" }),
    ).toHaveTextContent("Four records are Planned")
    expect(
      screen.getByRole("link", {
        name: "Open source Table · Product roadmap",
      }),
    ).toHaveAttribute(
      "href",
      "/bases/base_private/tables/table_private",
    )
    expect(screen.getByRole("table")).toHaveTextContent("Planned4")
    expect(document.body.textContent).not.toMatch(
      /base_private|table_private|report_chart_private/,
    )
  })

  it("maps a 431 failure to a clean customer recovery action", () => {
    agentState.error = new Error("Server returned 431: headers too large")

    render(<AssistantPanel />)

    expect(screen.getByRole("alert")).toHaveTextContent(
      "The assistant connection needs a clean refresh.",
    )
    expect(
      screen.getByRole("button", { name: "Reload page" }),
    ).toBeInTheDocument()
    expect(screen.getByRole("alert")).not.toHaveTextContent("431")
  })

  it("resets the durable session before retrying a failed request", async () => {
    agentState.data.messages = []
    agentState.send
      .mockRejectedValueOnce(new Error("Max retries reached"))
      .mockResolvedValueOnce(undefined)

    render(<AssistantPanel />)

    fireEvent.change(screen.getByLabelText("Message workspace analyst"), {
      target: { value: "Summarize Product roadmap" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Send message" }))

    expect(
      await screen.findByRole("button", { name: "Try request again" }),
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Try request again" }))

    await waitFor(() => {
      expect(clientSession.reset).toHaveBeenCalledTimes(1)
      expect(agentState.reset).toHaveBeenCalledTimes(1)
      expect(agentState.send).toHaveBeenCalledTimes(2)
    })
  })

  it("recovers from a stale ownership link with a fresh client conversation", async () => {
    agentState.error = new Error("Continuation ownership mismatch")
    clientSession.reset.mockRejectedValueOnce(
      new Error("Continuation ownership mismatch"),
    )

    render(<AssistantPanel />)
    fireEvent.click(
      screen.getByRole("button", { name: "Start new conversation" }),
    )

    await waitFor(() => {
      expect(clientSession.reset).toHaveBeenCalledTimes(1)
      expect(agentState.reset).toHaveBeenCalledTimes(1)
    })
  })

  it("requests server cancellation for the active turn instead of stopping only the browser stream", async () => {
    agentState.status = "streaming"
    agentState.events = [
      { type: "turn.started", data: { turnId: "turn_private" } },
    ]

    render(<AssistantPanel />)
    fireEvent.click(screen.getByRole("button", { name: "Stop response" }))

    await waitFor(() => {
      expect(clientSession.cancel).toHaveBeenCalledWith({
        turnId: "turn_private",
      })
    })
    expect(agentState.stop).not.toHaveBeenCalled()
    expect(screen.getByText("Stopping this request safely…")).toBeInTheDocument()
  })

  it("stops an overlong turn and leaves an actionable timeout state", async () => {
    vi.useFakeTimers()
    agentState.status = "submitted"
    agentState.events = [
      { type: "turn.started", data: { turnId: "turn_private" } },
    ]

    render(<AssistantPanel />)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ASSISTANT_TURN_TIMEOUT_MS)
    })

    expect(clientSession.cancel).toHaveBeenCalledWith({
      turnId: "turn_private",
    })
    expect(
      screen.getByText("This is taking longer than expected. Stopping safely…"),
    ).toBeInTheDocument()
  })

  it("ends confirmed cancellation with a retry action and no write claim", async () => {
    agentState.status = "streaming"
    agentState.events = [
      { type: "turn.started", data: { turnId: "turn_private" } },
    ]
    const { rerender } = render(<AssistantPanel />)

    fireEvent.click(screen.getByRole("button", { name: "Stop response" }))
    agentState.status = "ready"
    agentState.events = [
      { type: "turn.started", data: { turnId: "turn_private" } },
      { type: "turn.cancelled", data: { turnId: "turn_private" } },
    ]
    rerender(<AssistantPanel />)

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The request was stopped. No changes were made.",
    )
    expect(
      screen.getByRole("button", { name: "Start new conversation" }),
    ).toBeInTheDocument()
  })
})
