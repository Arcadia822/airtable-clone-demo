import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { useState } from "react"
import { afterEach, expect, it } from "vitest"

import { FieldValidationInputs } from "@/components/field-validation-inputs"
import type { FieldConfig, FieldType } from "@/lib/domain"

afterEach(cleanup)

function ValidationHarness({
  initialConfig = {},
  type,
}: {
  initialConfig?: FieldConfig
  type: FieldType
}) {
  const [config, setConfig] = useState(initialConfig)
  return (
    <>
      <FieldValidationInputs
        config={config}
        idPrefix="friendly"
        onChange={setConfig}
        type={type}
      />
      <output aria-label="Saved validation settings">
        {[config.maxLength, config.min, config.max]
          .filter((value) => value !== undefined)
          .join(" · ")}
      </output>
    </>
  )
}

it("sets a friendly maximum character count", () => {
  render(<ValidationHarness type="singleLineText" />)

  expect(screen.getByText(/recommended maximum of 10,000 characters/i))
    .toBeInTheDocument()
  fireEvent.change(
    screen.getByRole("spinbutton", { name: "Maximum characters" }),
    { target: { value: "750" } },
  )
  expect(screen.getByLabelText("Saved validation settings")).toHaveTextContent(
    "750",
  )
})

it("keeps numeric limits optional and explains an invalid range", () => {
  render(<ValidationHarness type="currency" />)

  fireEvent.change(
    screen.getByRole("spinbutton", { name: "Minimum allowed" }),
    { target: { value: "50" } },
  )
  fireEvent.change(
    screen.getByRole("spinbutton", { name: "Maximum allowed" }),
    { target: { value: "20" } },
  )
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Minimum cannot be greater than maximum.",
  )
  expect(document.body).not.toHaveTextContent(
    /fieldId|maxLength|maps to|config key/i,
  )
})
