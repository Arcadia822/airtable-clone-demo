import { expect, it } from "vitest"

import { fieldConfigForMutation } from "@/components/connected/adapters"

it("preserves friendly validation settings in the existing field contract", () => {
  expect(
    fieldConfigForMutation({
      maxLength: 750,
      min: -25.5,
      max: 500,
      precision: 2,
    }),
  ).toMatchObject({
    maxLength: 750,
    min: -25.5,
    max: 500,
    precision: 2,
  })
})
