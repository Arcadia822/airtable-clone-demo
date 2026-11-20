import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react"
import { useState } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  ViewControls,
  type ViewControlsField,
  type ViewControlsValue,
} from "@/components/workspace/view-controls"

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

const fields: ViewControlsField[] = [
  {
    id: "field_private_name",
    name: "Project name",
    type: "singleLineText",
    config: {},
  },
  {
    id: "field_private_status",
    name: "Launch status",
    type: "singleSelect",
    config: {
      options: [
        {
          id: "option_private_planned",
          label: "Planned",
          color: "#64748b",
        },
        {
          id: "option_private_progress",
          label: "In progress",
          color: "#2563eb",
        },
      ],
    },
  },
  {
    id: "field_private_ready",
    name: "Ready to ship",
    type: "checkbox",
    config: {},
  },
  {
    id: "field_private_budget",
    name: "Budget",
    type: "currency",
    config: { currency: "USD", precision: 0 },
  },
  {
    id: "field_private_date",
    name: "Launch date",
    type: "date",
    config: { dateStyle: "date" },
  },
]

const emptyValue: ViewControlsValue = {
  filterConjunction: "and",
  filters: [],
  sorts: [],
  groups: [],
}

function StatefulViewControls({
  initialValue = emptyValue,
  onChange,
}: {
  initialValue?: ViewControlsValue
  onChange: (next: ViewControlsValue) => void
}) {
  const [value, setValue] = useState(initialValue)
  return (
    <ViewControls
      fields={fields}
      onChange={(next) => {
        setValue(next)
        onChange(next)
      }}
      value={value}
    />
  )
}

describe("ViewControls", () => {
  it("builds filters with named columns, choices, and plain-language operators", () => {
    const onChange = vi.fn()
    const { container } = render(
      <StatefulViewControls onChange={onChange} />,
    )

    fireEvent.click(
      screen.getByRole("button", { name: "Filter records" }),
    )
    fireEvent.click(
      screen.getByRole("button", { name: "Add condition" }),
    )

    fireEvent.click(screen.getByLabelText("Column"))
    fireEvent.click(screen.getByText("Launch status"))
    fireEvent.click(screen.getByLabelText("Choice"))
    fireEvent.click(screen.getByText("In progress"))

    const latest = onChange.mock.lastCall?.[0] as ViewControlsValue
    expect(latest.filters[0]).toMatchObject({
      fieldId: "field_private_status",
      operator: "is",
      value: "option_private_progress",
    })
    expect(screen.getByText("is")).toBeInTheDocument()
    expect(container.textContent).not.toContain("field_private")
    expect(container.textContent).not.toContain("option_private")
    expect(container.textContent).not.toContain("does_not_contain")
  })

  it("uses field-aware value inputs and omits values for empty checks", () => {
    render(
      <StatefulViewControls
        initialValue={{
          filterConjunction: "and",
          filters: [
            {
              id: "filter_private_empty",
              fieldId: "field_private_name",
              operator: "is_empty",
            },
            {
              id: "filter_private_ready",
              fieldId: "field_private_ready",
              operator: "is",
              value: true,
            },
            {
              id: "filter_private_status",
              fieldId: "field_private_status",
              operator: "is",
              value: "option_private_progress",
            },
            {
              id: "filter_private_budget",
              fieldId: "field_private_budget",
              operator: "greater_than",
              value: 42,
            },
            {
              id: "filter_private_date",
              fieldId: "field_private_date",
              operator: "after",
              value: "2026-07-30",
            },
          ],
          sorts: [],
          groups: [],
        }}
        onChange={vi.fn()}
      />,
    )

    fireEvent.click(
      screen.getByRole("button", {
        name: "Filter records, 5 active",
      }),
    )

    expect(screen.getByText("No value needed")).toBeInTheDocument()
    expect(screen.getByLabelText("Choice")).toHaveTextContent("In progress")
    expect(screen.getByDisplayValue("42")).toHaveAttribute("type", "number")
    expect(screen.getByDisplayValue("2026-07-30")).toHaveAttribute(
      "type",
      "date",
    )
    expect(
      screen.getAllByLabelText("Value").some((control) =>
        control.textContent?.includes("Yes"),
      ),
    ).toBe(true)
  })

  it("adds, prioritizes, and removes friendly sort and grouping rules", () => {
    const onChange = vi.fn()
    render(<StatefulViewControls onChange={onChange} />)

    fireEvent.click(screen.getByRole("button", { name: "Sort records" }))
    fireEvent.click(screen.getByRole("button", { name: "Add sort" }))
    expect(screen.getByText("A → Z")).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Add sort" }))
    expect(screen.getByText("Then by")).toBeInTheDocument()
    fireEvent.click(
      screen.getByRole("button", {
        name: "Move sort on Launch status up",
      }),
    )

    let latest = onChange.mock.lastCall?.[0] as ViewControlsValue
    expect(latest.sorts.map((sort) => sort.fieldId)).toEqual([
      "field_private_status",
      "field_private_name",
    ])
    expect(latest.sorts.every((sort) => Boolean(sort.rank))).toBe(true)

    fireEvent.click(
      screen.getByRole("button", {
        name: "Remove sort on Project name",
      }),
    )
    latest = onChange.mock.lastCall?.[0] as ViewControlsValue
    expect(latest.sorts).toHaveLength(1)

    fireEvent.click(
      screen.getByRole("button", { name: "Group records" }),
    )
    fireEvent.click(
      screen.getByRole("button", { name: "Add grouping" }),
    )
    const groupActions = screen.getByRole("group", {
      name: "Actions for group on Project name",
    })
    expect(
      within(groupActions).getByRole("button", {
        name: "Remove group on Project name",
      }),
    ).toBeInTheDocument()

    latest = onChange.mock.lastCall?.[0] as ViewControlsValue
    expect(latest.groups[0]).toMatchObject({
      fieldId: "field_private_name",
      direction: "asc",
    })
  })

  it("clears each view setting category without exposing internal values", () => {
    const onChange = vi.fn()
    const { container } = render(
      <StatefulViewControls
        initialValue={{
          filterConjunction: "and",
          filters: [
            {
              id: "filter_private",
              fieldId: "field_private_name",
              operator: "contains",
              value: "launch",
            },
          ],
          sorts: [
            {
              id: "sort_private",
              fieldId: "field_private_status",
              direction: "asc",
              rank: "a0",
            },
          ],
          groups: [
            {
              id: "group_private",
              fieldId: "field_private_ready",
              direction: "asc",
              rank: "a0",
            },
          ],
        }}
        onChange={onChange}
      />,
    )

    fireEvent.click(
      screen.getByRole("button", { name: "Filter records, 1 active" }),
    )
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }))
    expect(
      (onChange.mock.lastCall?.[0] as ViewControlsValue).filters,
    ).toEqual([])

    fireEvent.click(
      screen.getByRole("button", { name: "Sort records, 1 active" }),
    )
    fireEvent.click(screen.getByRole("button", { name: "Clear sorting" }))
    expect(
      (onChange.mock.lastCall?.[0] as ViewControlsValue).sorts,
    ).toEqual([])

    fireEvent.click(
      screen.getByRole("button", { name: "Group records, 1 active" }),
    )
    fireEvent.click(screen.getByRole("button", { name: "Clear grouping" }))
    expect(
      (onChange.mock.lastCall?.[0] as ViewControlsValue).groups,
    ).toEqual([])

    expect(container.textContent).not.toContain("field_private")
    expect(container.textContent).not.toContain("filter_private")
  })
})
