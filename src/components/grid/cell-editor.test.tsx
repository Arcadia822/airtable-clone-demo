import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { toast } from "sonner"

import { CellEditor } from "@/components/grid/cell-editor"
import type { FieldDefinition } from "@/lib/domain"

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
  },
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const ratingField: FieldDefinition = {
  id: "field_internal_rating",
  name: "Customer score",
  type: "rating",
  config: { min: 1, max: 5, precision: 0 },
  rank: "a",
  width: 180,
  isPrimary: false,
}

const attachmentField: FieldDefinition = {
  id: "field_internal_attachment",
  name: "Launch files",
  type: "attachment",
  config: { attachmentKind: "any" },
  rank: "b",
  width: 180,
  isPrimary: false,
}

describe("CellEditor rating", () => {
  it("renders an accessible five-star editor using the column name", () => {
    const onCommit = vi.fn()
    const { container } = render(
      <CellEditor
        field={ratingField}
        onCommit={onCommit}
        value={3}
      />,
    )

    expect(
      screen.getByRole("group", {
        name: "Customer score: 3 out of 5 stars",
      }),
    ).toBeInTheDocument()
    expect(
      screen.getAllByRole("button", { name: /Set Customer score to/ }),
    ).toHaveLength(5)
    expect(
      screen.getByRole("button", {
        name: "Set Customer score to 3 stars",
      }),
    ).toHaveAttribute("aria-pressed", "true")
    expect(container.textContent).not.toContain("field_internal_rating")

    fireEvent.click(
      screen.getByRole("button", {
        name: "Set Customer score to 5 stars",
      }),
    )
    expect(onCommit).toHaveBeenCalledWith(5)

    fireEvent.click(
      screen.getByRole("button", {
        name: "Clear Customer score rating",
      }),
    )
    expect(onCommit).toHaveBeenCalledWith(null)
  })
})

describe("CellEditor attachments", () => {
  it("does not expose internal upload errors", async () => {
    const onUploadFiles = vi.fn().mockRejectedValue(
      new Error(
        "ArgumentValidationError: fieldId=field_private_123 requestId=req_private_456",
      ),
    )
    render(
      <CellEditor
        field={attachmentField}
        onCommit={vi.fn()}
        onUploadFiles={onUploadFiles}
        value={[]}
      />,
    )

    fireEvent.change(screen.getByLabelText("Choose files for Launch files"), {
      target: {
        files: [new File(["hello"], "launch.txt", { type: "text/plain" })],
      },
    })

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "The attachment could not be uploaded",
        { description: "Please try again." },
      ),
    )
    expect(JSON.stringify(vi.mocked(toast.error).mock.calls)).not.toContain(
      "field_private",
    )
  })
})
