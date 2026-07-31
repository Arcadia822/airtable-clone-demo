import {
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { FieldConversionDialog } from "@/components/connected/field-conversion-dialog"
import type {
  FieldConversionJobProgress,
  FieldConversionPreview,
} from "@/lib/field-conversion"

afterEach(cleanup)

const preview: FieldConversionPreview = {
  columnName: "Customer score",
  currentType: "Short text",
  newType: "Rating",
  expectedFieldRevision: 7,
  previewVersion: "private-preview-token",
  canApply: true,
  blockingReason: null,
  requiresDataLossAcknowledgement: true,
  counts: {
    reviewedRows: 8,
    filledCells: 6,
    keptAsIs: 2,
    changed: 3,
    cleared: 1,
    losingSomeInformation: 1,
  },
  examples: [
    {
      before: "4.4",
      after: "4",
      result: "Will change",
      explanation: "The rating will be rounded to a whole number.",
    },
    {
      before: "Excellent",
      after: "Empty",
      result: "Will be cleared",
      explanation: "Ratings must be whole numbers from 1 to 5.",
    },
  ],
  dependencies: [
    { category: "Saved view", name: "At-risk customers" },
    { category: "Saved analysis", name: "Customer health review" },
  ],
  warnings: [
    "1 filled cell cannot be converted and will be cleared.",
  ],
}

const readyJob: FieldConversionJobProgress = {
  jobId: "conversion-job",
  fieldId: "customer-score",
  columnName: "Customer score",
  targetType: "rating",
  targetConfig: { min: 1, max: 5, precision: 0 },
  status: "ready",
  phase: "staging",
  counts: {
    reviewedRows: 121,
    filledCells: 121,
    keptAsIs: 0,
    changed: 120,
    cleared: 1,
    losingSomeInformation: 0,
    appliedRows: 0,
    rowsUpdated: 0,
  },
  failureMessage: null,
}

describe("FieldConversionDialog", () => {
  it("shows named impact, hides handshake values, and gates a lossy apply", () => {
    const onApply = vi.fn()
    const onAcknowledgedChange = vi.fn()
    const { container, rerender } = render(
      <FieldConversionDialog
        acknowledged={false}
        applying={false}
        columnName="Customer score"
        onAcknowledgedChange={onAcknowledgedChange}
        onApply={onApply}
        onOpenChange={vi.fn()}
        onTargetConfigChange={vi.fn()}
        open
        preview={preview}
        targetConfig={{ min: 1, max: 5, precision: 0 }}
        targetType="rating"
      />,
    )

    expect(screen.getByText("Short text")).toBeInTheDocument()
    expect(screen.getByText("Rating")).toBeInTheDocument()
    expect(screen.getByText("At-risk customers", { exact: false })).toBeInTheDocument()
    expect(
      screen.getByText("Customer health review", { exact: false }),
    ).toBeInTheDocument()
    expect(screen.getByText("Saved analysis")).toBeInTheDocument()
    expect(screen.getByText("Excellent")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Change to Rating" })).toBeDisabled()
    expect(container.textContent).not.toContain("private-preview-token")
    expect(container.textContent).not.toContain("expectedFieldRevision")

    fireEvent.click(
      screen.getByRole("checkbox", {
        name: /Confirm conversion data loss/,
      }),
    )
    expect(onAcknowledgedChange).toHaveBeenCalledWith(true)

    rerender(
      <FieldConversionDialog
        acknowledged
        applying={false}
        columnName="Customer score"
        onAcknowledgedChange={onAcknowledgedChange}
        onApply={onApply}
        onOpenChange={vi.fn()}
        onTargetConfigChange={vi.fn()}
        open
        preview={preview}
        targetConfig={{ min: 1, max: 5, precision: 0 }}
        targetType="rating"
      />,
    )
    fireEvent.click(screen.getByRole("button", { name: "Change to Rating" }))
    expect(onApply).toHaveBeenCalledTimes(1)
  })

  it("shows a plain-language blocker and prevents apply", () => {
    render(
      <FieldConversionDialog
        acknowledged
        applying={false}
        columnName="Email"
        onAcknowledgedChange={vi.fn()}
        onApply={vi.fn()}
        onOpenChange={vi.fn()}
        onTargetConfigChange={vi.fn()}
        open
        preview={{
          ...preview,
          newType: "Number",
          canApply: false,
          blockingReason:
            "Close or update the published forms that use this column first.",
          warnings: [
            "Close or update the published forms that use this column first.",
          ],
        }}
        targetConfig={{ precision: 0 }}
        targetType="number"
      />,
    )

    expect(
      screen.getByText(
        "Close or update the published forms that use this column first.",
      ),
    ).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Change to Number" })).toBeDisabled()
  })

  it("asks for named choices instead of exposing an invalid preview state", () => {
    const { container } = render(
      <FieldConversionDialog
        acknowledged={false}
        applying={false}
        columnName="Status"
        configIssue="Add at least one named choice before reviewing this change."
        onAcknowledgedChange={vi.fn()}
        onApply={vi.fn()}
        onOpenChange={vi.fn()}
        onTargetConfigChange={vi.fn()}
        open
        preview={undefined}
        targetConfig={{ options: [] }}
        targetType="singleSelect"
      />,
    )

    expect(
      screen.getByText(
        "Add at least one named choice before reviewing this change.",
      ),
    ).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "Preparing preview…" }),
    ).toBeDisabled()
    expect(container.textContent).not.toContain("ID")
    expect(container.textContent).not.toContain("key")
  })

  it("requires a fresh confirmation after every row is reviewed and can cancel before apply", () => {
    const onAcknowledgedChange = vi.fn()
    const onApply = vi.fn()
    const onCancel = vi.fn()
    const { rerender } = render(
      <FieldConversionDialog
        acknowledged={false}
        applying={false}
        columnName="Customer score"
        job={readyJob}
        onAcknowledgedChange={onAcknowledgedChange}
        onApply={onApply}
        onCancel={onCancel}
        onOpenChange={vi.fn()}
        onTargetConfigChange={vi.fn()}
        open
        preview={undefined}
        targetConfig={{ min: 1, max: 5, precision: 0 }}
        targetType="rating"
      />,
    )

    expect(
      screen.getByText("Every saved row is reviewed"),
    ).toBeInTheDocument()
    expect(screen.getByText(/121 saved rows were checked/)).toBeInTheDocument()
    expect(screen.getByText(/1 cell will be empty/)).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "Confirm and update rows" }),
    ).toBeDisabled()

    fireEvent.click(
      screen.getByRole("checkbox", {
        name: /Confirm final conversion results/,
      }),
    )
    expect(onAcknowledgedChange).toHaveBeenCalledWith(true)
    fireEvent.click(
      screen.getByRole("button", { name: "Cancel and unlock column" }),
    )
    expect(onCancel).toHaveBeenCalledTimes(1)

    rerender(
      <FieldConversionDialog
        acknowledged
        applying={false}
        columnName="Customer score"
        job={readyJob}
        onAcknowledgedChange={onAcknowledgedChange}
        onApply={onApply}
        onCancel={onCancel}
        onOpenChange={vi.fn()}
        onTargetConfigChange={vi.fn()}
        open
        preview={undefined}
        targetConfig={{ min: 1, max: 5, precision: 0 }}
        targetType="rating"
      />,
    )
    fireEvent.click(
      screen.getByRole("button", { name: "Confirm and update rows" }),
    )
    expect(onApply).toHaveBeenCalledTimes(1)
  })

  it("keeps cancel available while reviewing and offers retry after a paused step", () => {
    const onCancel = vi.fn()
    const { rerender } = render(
      <FieldConversionDialog
        acknowledged={false}
        applying
        columnName="Customer score"
        job={{ ...readyJob, status: "staging" }}
        onAcknowledgedChange={vi.fn()}
        onApply={vi.fn()}
        onCancel={onCancel}
        onOpenChange={vi.fn()}
        onTargetConfigChange={vi.fn()}
        open
        preview={undefined}
        targetConfig={{ min: 1, max: 5, precision: 0 }}
        targetType="rating"
      />,
    )
    const cancelButton = screen.getByRole("button", {
      name: "Cancel and unlock column",
    })
    expect(cancelButton).toBeEnabled()
    fireEvent.click(cancelButton)
    expect(onCancel).toHaveBeenCalledTimes(1)

    const onRetry = vi.fn()
    rerender(
      <FieldConversionDialog
        acknowledged={false}
        applying={false}
        columnName="Customer score"
        job={{
          ...readyJob,
          status: "failed",
          phase: "applying",
          failureMessage:
            "A saved value changed during the column update.",
        }}
        onAcknowledgedChange={vi.fn()}
        onApply={vi.fn()}
        onOpenChange={vi.fn()}
        onRetry={onRetry}
        onTargetConfigChange={vi.fn()}
        open
        preview={undefined}
        targetConfig={{ min: 1, max: 5, precision: 0 }}
        targetType="rating"
      />,
    )
    expect(
      screen.getByText("A saved value changed during the column update."),
    ).toBeInTheDocument()
    fireEvent.click(
      screen.getByRole("button", { name: "Retry column change" }),
    )
    expect(onRetry).toHaveBeenCalledTimes(1)
  })
})
