import { expect, test, type Page } from "@playwright/test"

async function gotoHydrated(page: Page, path: string) {
  await page.goto(path)
  await expect(page.locator("html")).toHaveAttribute(
    "data-app-hydrated",
    "true",
    { timeout: 15_000 },
  )
}

test("mobile workspace navigation is named, URL-aware, and overflow-safe", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 760 })
  await gotoHydrated(page, "/demo")

  await page.getByRole("button", { name: "Open navigation" }).click()
  const navigation = page.getByRole("dialog", {
    name: "Workspace navigation",
  })
  await expect(navigation).toBeVisible()
  await expect(
    navigation.getByRole("link", { name: "All bases" }),
  ).toHaveAttribute("aria-current", "page")
  await expect(
    navigation.getByRole("link", { name: "Forms" }),
  ).toBeVisible()
  await expect(
    navigation.getByRole("link", { name: "Analytics" }),
  ).toBeVisible()
  await expect(
    navigation.getByRole("link", { name: "Plans" }),
  ).toBeVisible()

  await navigation.getByRole("link", { name: "Forms" }).click()
  await expect(page).toHaveURL(/\/demo\/forms$/)
  await page.goBack()
  await expect(page).toHaveURL(/\/demo$/)

  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth >
      document.documentElement.clientWidth,
  )
  expect(overflow).toBe(false)
})

test("named create dialogs do not ask for database keys", async ({ page }) => {
  await gotoHydrated(page, "/demo")

  await page.getByRole("button", { name: "Create table" }).click()
  const dialog = page.getByRole("dialog", { name: "Create a table" })
  await expect(dialog.getByLabel("Table name")).toBeFocused()
  await expect(dialog.getByText(/required Name column/i)).toBeVisible()
  await expect(dialog).not.toContainText(
    /tableId|baseId|fieldId|maps to|slug|database key/i,
  )
})
