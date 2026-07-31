import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ViewSwitcher } from "@/components/connected/view-switcher"

vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
)
HTMLElement.prototype.scrollIntoView = vi.fn()
afterEach(cleanup)

const views = [
  {
    id: "view_internal_default",
    isDefault: true,
    name: "All records",
    status: "active" as const,
    type: "grid" as const,
  },
  {
    id: "view_internal_launch",
    isDefault: false,
    name: "Launch schedule",
    status: "active" as const,
    type: "grid" as const,
  },
]

describe("ViewSwitcher", () => {
  it("switches and creates views using friendly names", async () => {
    const onCreate = vi.fn(async () => "view_internal_new")
    const onSelect = vi.fn()
    render(
      <ViewSwitcher
        activeViewId={views[0].id}
        canManage
        onCreate={onCreate}
        onSelect={onSelect}
        views={views}
      />,
    )

    fireEvent.click(screen.getByRole("button", { name: "Choose a view" }))
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Launch schedule" }))
    expect(onSelect).toHaveBeenCalledWith("view_internal_launch")

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Choose a view" }),
      ).toHaveAttribute("aria-expanded", "false"),
    )
    fireEvent.click(screen.getByRole("button", { name: "Choose a view" }))
    const createMenuItem = await screen.findByRole("menuitem", {
      name: "Create view",
    })
    fireEvent.click(createMenuItem)
    fireEvent.change(screen.getByLabelText("View name"), {
      target: { value: "Customer follow-up" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Create view" }))

    await waitFor(() => {
      expect(onCreate).toHaveBeenCalledWith("Customer follow-up", {
        type: "grid",
      })
      expect(onSelect).toHaveBeenCalledWith("view_internal_new")
    })
    expect(screen.queryByText("view_internal_new")).not.toBeInTheDocument()
  })

  it("configures visual layouts by named columns instead of internal values", async () => {
    const onCreate = vi.fn(async () => "view_internal_calendar")
    render(
      <ViewSwitcher
        canManage
        fields={[
          {
            id: "field_internal_status",
            name: "Delivery status",
            type: "singleSelect",
          },
          {
            id: "field_internal_date",
            name: "Target date",
            type: "date",
          },
        ]}
        onCreate={onCreate}
        onSelect={vi.fn()}
        views={views}
      />,
    )

    fireEvent.click(screen.getByRole("button", { name: "Choose a view" }))
    fireEvent.click(screen.getByRole("menuitem", { name: "Create view" }))
    fireEvent.change(screen.getByLabelText("View name"), {
      target: { value: "Launch calendar" },
    })
    fireEvent.click(
      screen.getByRole("button", { name: /CalendarRecords by date/ }),
    )
    expect(
      screen.getByRole("button", { name: "Create view" }),
    ).toBeDisabled()

    fireEvent.click(screen.getByRole("combobox", { name: "Date column" }))
    fireEvent.click(
      screen.getByRole("option", {
        name: /Target date.*Date only/,
      }),
    )
    fireEvent.click(screen.getByRole("button", { name: "Agenda" }))
    fireEvent.click(screen.getByRole("button", { name: "Create view" }))

    await waitFor(() =>
      expect(onCreate).toHaveBeenCalledWith("Launch calendar", {
        type: "calendar",
        calendarDateFieldId: "field_internal_date",
        calendarDisplay: "agenda",
      }),
    )
    expect(document.body.textContent).not.toContain("field_internal")
  })

  it("manages views with names and plain-language actions", async () => {
    const onArchive = vi.fn(async () => true)
    const onDelete = vi.fn(async () => true)
    const onDuplicate = vi.fn(async () => "view_internal_copy")
    const onMove = vi.fn(async () => true)
    const onRename = vi.fn(async () => true)
    const onRestore = vi.fn(async () => true)
    const onSetDefault = vi.fn(async () => true)
    const { container } = render(
      <ViewSwitcher
        activeViewId={views[1].id}
        canManage
        onArchive={onArchive}
        onCreate={vi.fn()}
        onDelete={onDelete}
        onDuplicate={onDuplicate}
        onMove={onMove}
        onRename={onRename}
        onRestore={onRestore}
        onSelect={vi.fn()}
        onSetDefault={onSetDefault}
        views={[
          ...views,
          {
            id: "view_internal_archived",
            isDefault: false,
            name: "Previous quarter",
            status: "archived",
            type: "grid",
          },
        ]}
      />,
    )

    fireEvent.click(screen.getByRole("button", { name: "Choose a view" }))
    fireEvent.click(screen.getByRole("menuitem", { name: "View options" }))
    fireEvent.change(screen.getByLabelText("View name"), {
      target: { value: "Customer pipeline" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }))
    await waitFor(() =>
      expect(onRename).toHaveBeenCalledWith(
        "view_internal_launch",
        "Customer pipeline",
      ),
    )

    fireEvent.click(screen.getByRole("button", { name: "Choose a view" }))
    fireEvent.click(screen.getByRole("menuitem", { name: "View options" }))
    fireEvent.click(screen.getByRole("button", { name: "Make default" }))
    await waitFor(() =>
      expect(onSetDefault).toHaveBeenCalledWith("view_internal_launch"),
    )

    fireEvent.click(screen.getByRole("button", { name: "Choose a view" }))
    fireEvent.click(screen.getByRole("menuitem", { name: "View options" }))
    fireEvent.click(screen.getByRole("button", { name: "Duplicate" }))
    await waitFor(() =>
      expect(onDuplicate).toHaveBeenCalledWith("view_internal_launch"),
    )

    fireEvent.click(screen.getByRole("button", { name: "Choose a view" }))
    fireEvent.click(screen.getByRole("menuitem", { name: "View options" }))
    fireEvent.click(
      screen.getByRole("button", { name: "Move Launch schedule up" }),
    )
    await waitFor(() =>
      expect(onMove).toHaveBeenCalledWith("view_internal_launch", "up"),
    )

    fireEvent.click(screen.getByRole("button", { name: "Archive" }))
    await waitFor(() =>
      expect(onArchive).toHaveBeenCalledWith("view_internal_launch"),
    )

    fireEvent.click(screen.getByRole("button", { name: "Choose a view" }))
    fireEvent.click(
      screen.getByRole("menuitem", { name: "Restore Previous quarter" }),
    )
    await waitFor(() =>
      expect(onRestore).toHaveBeenCalledWith("view_internal_archived"),
    )

    fireEvent.click(screen.getByRole("button", { name: "Choose a view" }))
    fireEvent.click(screen.getByRole("menuitem", { name: "View options" }))
    fireEvent.click(screen.getByRole("button", { name: "Delete" }))
    fireEvent.click(screen.getByRole("button", { name: "Delete view" }))
    await waitFor(() =>
      expect(onDelete).toHaveBeenCalledWith("view_internal_launch"),
    )

    expect(container.textContent).not.toContain("view_internal")
  })

  it("changes a view layout using a named column", async () => {
    const onUpdateOptions = vi.fn(async () => true)
    render(
      <ViewSwitcher
        activeViewId={views[1].id}
        canManage
        fields={[
          {
            id: "field_internal_status",
            name: "Delivery status",
            type: "singleSelect",
          },
        ]}
        onCreate={vi.fn()}
        onSelect={vi.fn()}
        onUpdateOptions={onUpdateOptions}
        views={views}
      />,
    )

    fireEvent.click(screen.getByRole("button", { name: "Choose a view" }))
    fireEvent.click(screen.getByRole("menuitem", { name: "View options" }))
    fireEvent.click(
      screen.getByRole("button", { name: "Kanban" }),
    )
    fireEvent.click(
      screen.getByRole("combobox", { name: "Group cards by" }),
    )
    fireEvent.click(
      screen.getByRole("option", {
        name: /Delivery status.*Cards will be grouped by this column/,
      }),
    )
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }))

    await waitFor(() =>
      expect(onUpdateOptions).toHaveBeenCalledWith(
        "view_internal_launch",
        "Launch schedule",
        {
          type: "kanban",
          kanbanFieldId: "field_internal_status",
          kanbanSummaryFieldIds: [],
        },
      ),
    )
    expect(document.body.textContent).not.toContain("field_internal")
  })

  it("configures gallery covers and card details with column names", async () => {
    const onCreate = vi.fn(async () => "view_internal_gallery")
    render(
      <ViewSwitcher
        canManage
        fields={[
          {
            id: "field_internal_title",
            isPrimary: true,
            name: "Project",
            type: "singleLineText",
          },
          {
            id: "field_internal_owner",
            name: "Owner",
            type: "email",
          },
          {
            id: "field_internal_due",
            name: "Due date",
            type: "date",
          },
          {
            id: "field_internal_image",
            name: "Hero image",
            type: "attachment",
          },
        ]}
        onCreate={onCreate}
        onSelect={vi.fn()}
        views={views}
      />,
    )

    fireEvent.click(screen.getByRole("button", { name: "Choose a view" }))
    fireEvent.click(screen.getByRole("menuitem", { name: "Create view" }))
    fireEvent.change(screen.getByLabelText("View name"), {
      target: { value: "Project gallery" },
    })
    fireEvent.click(
      screen.getByRole("button", { name: /GalleryVisual cards/ }),
    )
    fireEvent.click(screen.getByRole("combobox", { name: "Cover image" }))
    fireEvent.click(
      screen.getByRole("option", {
        name: /Hero image.*first image becomes the card cover/i,
      }),
    )
    fireEvent.click(screen.getByRole("checkbox", { name: "Due date" }))
    fireEvent.click(screen.getByRole("button", { name: "Create view" }))

    await waitFor(() =>
      expect(onCreate).toHaveBeenCalledWith("Project gallery", {
        type: "gallery",
        galleryCoverFieldId: "field_internal_image",
        gallerySummaryFieldIds: ["field_internal_owner"],
      }),
    )
    expect(document.body.textContent).not.toContain("field_internal")
  })

  it("keeps saved views easy to recognize and favorite", async () => {
    const onSetFavorite = vi.fn(async () => true)
    render(
      <ViewSwitcher
        activeViewId={views[1].id}
        canManage
        onCreate={vi.fn()}
        onSelect={vi.fn()}
        onSetFavorite={onSetFavorite}
        views={[
          { ...views[0], isFavorite: true },
          { ...views[1], lastOpenedAt: 42 },
        ]}
      />,
    )

    fireEvent.click(screen.getByRole("button", { name: "Choose a view" }))
    expect(screen.getByText("Favorites")).toBeInTheDocument()
    expect(screen.getByText("Recent")).toBeInTheDocument()
    fireEvent.click(
      screen.getByRole("menuitem", {
        name: "Add Launch schedule to favorites",
      }),
    )

    await waitFor(() =>
      expect(onSetFavorite).toHaveBeenCalledWith(
        "view_internal_launch",
        true,
      ),
    )
    expect(document.body.textContent).not.toContain("view_internal")
  })
})
