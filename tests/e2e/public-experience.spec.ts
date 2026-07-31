import { expect, test, type Page } from "@playwright/test"

async function gotoHydrated(page: Page, path: string) {
  await page.goto(path)
  await expect(page.locator("html")).toHaveAttribute(
    "data-app-hydrated",
    "true",
    { timeout: 15_000 },
  )
}

test("marketing page leads to the interactive workspace", async ({ page }) => {
  await gotoHydrated(page, "/")
  await expect(
    page.getByRole("heading", { name: /Turn scattered work into shared momentum/i }),
  ).toBeVisible()
  await page
    .getByRole("button", { name: /Open interactive workspace/i })
    .click()
  await expect(page).toHaveURL(/\/demo$/)
  await expect(page.getByRole("grid", { name: "Records grid" })).toBeVisible()
  await expect(page.getByText("80 records")).toBeVisible()
})

test("public form accepts a response and renders custom confirmation", async ({
  page,
}) => {
  await gotoHydrated(page, "/f/launch-feedback-demo")
  await page.getByLabel("What should we call you?").fill("Jordan")
  await page
    .getByLabel("What would make this launch more useful?")
    .fill("A clear mobile review workflow.")
  await expect(page.getByLabel("What should we call you?")).toHaveValue("Jordan")
  await page.getByRole("button", { name: "Send feedback" }).click()
  await expect(
    page.getByRole("heading", { name: "Thank you for your feedback" }),
  ).toBeVisible()
  await expect(
    page.getByText("This demo response was not saved or sent."),
  ).toBeVisible()
})

test("anonymous data pages stay independent from signed-in session scripts", async ({
  page,
}) => {
  const runtimeErrors: string[] = []
  page.on("console", (message) => {
    if (message.type() === "error") runtimeErrors.push(message.text())
  })
  page.on("pageerror", (error) => runtimeErrors.push(error.message))

  await gotoHydrated(page, "/demo")
  await expect(page.locator("script[data-clerk-js-script]")).toHaveCount(0)
  expect(await page.evaluate(() => "Clerk" in window)).toBe(false)

  await gotoHydrated(page, "/f/launch-feedback-demo")
  await expect(page.locator("script[data-clerk-js-script]")).toHaveCount(0)
  expect(await page.evaluate(() => "Clerk" in window)).toBe(false)
  expect(runtimeErrors).toEqual([])
})

test("workspace has no horizontal page overflow on mobile", async ({ page }) => {
  await gotoHydrated(page, "/demo")
  await expect(page.getByRole("grid", { name: "Records grid" })).toBeVisible()
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  )
  expect(overflow).toBe(false)
})

test("pricing keeps custom plan cards readable without page overflow", async ({
  page,
}) => {
  await gotoHydrated(page, "/pricing")

  await expect(
    page.getByRole("heading", {
      name: "One workspace. Three clear plans.",
    }),
  ).toBeVisible()
  await expect(page.getByRole("heading", { name: "Free" })).toBeVisible()
  await expect(page.getByRole("heading", { name: "Starter" })).toBeVisible()
  await expect(page.getByRole("heading", { name: "Pro" })).toBeVisible()
  await expect(page.getByText("500 AI questions each month")).toBeVisible()

  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth >
      document.documentElement.clientWidth,
  )
  expect(overflow).toBe(false)
})
