import { expect, test, type Page } from "@playwright/test"

async function gotoHydrated(page: Page, path: string) {
  await page.goto(path)
  await expect(page.locator("html")).toHaveAttribute(
    "data-app-hydrated",
    "true",
    { timeout: 15_000 },
  )
}

async function waitForLiveSave(page: Page) {
  await expect(
    page
      .getByRole("status", {
        name: /Live\. All changes are saved\./,
      })
      .last(),
  ).toBeVisible({ timeout: 20_000 })
}

async function waitForGridWrite(page: Page) {
  const grid = page.getByRole("grid", { name: "Records grid" })
  await expect(grid).toHaveAttribute("aria-busy", "true", {
    timeout: 10_000,
  })
  await expect(grid).toHaveAttribute("aria-busy", "false", {
    timeout: 20_000,
  })
  await waitForLiveSave(page)
}

async function openSyntheticAiWorkspace(page: Page) {
  const baseName = "AI browser validation"
  const tableName = "Synthetic signals"

  await gotoHydrated(page, "/dashboard")
  await waitForLiveSave(page)

  const existingBase = page
    .getByRole("link", { name: new RegExp(baseName, "i") })
    .first()
  const hasExistingBase = await existingBase
    .waitFor({ state: "visible", timeout: 5_000 })
    .then(() => true)
    .catch(() => false)
  if (hasExistingBase) {
    await existingBase.click()
  } else {
    await page.getByRole("button", { name: "New base" }).click()
    const baseDialog = page.getByRole("dialog", { name: "Create a base" })
    await baseDialog.getByLabel("Name", { exact: true }).fill(baseName)
    await baseDialog
      .getByLabel(/Description/)
      .fill("Synthetic records created only for automated AI validation")
    await baseDialog.getByRole("button", { name: "Create base" }).click()
  }

  const existingTable = page
    .getByRole("link", { name: new RegExp(tableName, "i") })
    .first()
  const hasExistingTable = await existingTable
    .waitFor({ state: "visible", timeout: 5_000 })
    .then(() => true)
    .catch(() => false)
  if (hasExistingTable) {
    await existingTable.click()
  } else {
    await page
      .getByRole("button", {
        name: /^(?:New table|Create first table)$/,
      })
      .first()
      .click()
    const tableDialog = page.getByRole("dialog", { name: "Create a table" })
    await tableDialog.getByLabel("Table name").fill(tableName)
    await tableDialog.getByRole("button", { name: "Create table" }).click()
  }

  const grid = page.getByRole("grid", { name: "Records grid" })
  await expect(grid).toBeVisible({ timeout: 20_000 })
  const names = page.getByRole("textbox", { name: /^Name, record \d+$/ })
  const existingRecordCount = await names.count()
  const syntheticNames = [
    "Synthetic amber signal",
    "Synthetic cobalt signal",
    "Synthetic violet signal",
  ]

  for (
    let index = existingRecordCount;
    index < syntheticNames.length;
    index += 1
  ) {
    await page.getByRole("button", { name: "Add record" }).click()
    const name = page.getByRole("textbox", {
      name: `Name, record ${index + 1}`,
      exact: true,
    })
    await expect(name).toBeVisible()
    await name.fill(syntheticNames[index])
    await name.press("Enter")
    await waitForGridWrite(page)
  }
}

test("live workspace AI answers with named data and no auth or transport failure", async ({
  page,
}) => {
  test.setTimeout(180_000)
  const runtimeErrors: string[] = []
  page.on("console", (message) => {
    if (message.type() === "error") runtimeErrors.push(message.text())
  })
  page.on("pageerror", (error) => runtimeErrors.push(error.message))
  page.on("response", (response) => {
    if (response.status() === 404) {
      runtimeErrors.push(`404 ${response.url()}`)
    }
  })

  await openSyntheticAiWorkspace(page)

  await page.getByRole("button", { name: "Ask Basecraft AI" }).click()
  const analyst = page.locator("#basecraft-assistant-panel")
  await expect(analyst).toBeVisible()
  await expect(analyst).toContainText("Basecraft AI")
  const message = analyst.getByRole("textbox", {
    name: "Message workspace analyst",
  })
  await expect(message).toBeEnabled({ timeout: 20_000 })
  await message.fill(
    "How many records are in this synthetic test table? Name two records and cite the table you inspected.",
  )
  await analyst.getByRole("button", { name: "Send message" }).click()

  await expect(
    analyst.getByText(/Reviewing .*table|Reviewing .*signals/i),
  ).toBeVisible({ timeout: 20_000 })
  await expect(
    analyst.getByRole("button", { name: "Stop response" }),
  ).toBeVisible({ timeout: 20_000 })
  await expect(
    analyst.getByRole("button", { name: "Stop response" }),
  ).toHaveCount(0, { timeout: 120_000 })
  await expect(message).toBeEnabled({ timeout: 20_000 })
  await expect(analyst.getByText("Named sources").first()).toBeVisible()
  await expect(
    analyst.getByRole("link", { name: /Product roadmap|Record/i }).first(),
  ).toHaveAttribute("href", /\/bases\/[^/]+\/tables\/[^/?]+/)

  await expect(analyst).not.toContainText(
    /Server returned 431|sign in to use|workflow failed|FatalError/i,
  )
  await expect(analyst).not.toContainText(
    /\b(?:base|table|field|record|form)_[a-z0-9_-]{4,}\b/i,
  )
  expect(
    runtimeErrors.filter(
      (messageText) =>
        !messageText.includes("development keys") &&
        !messageText.includes("infinite redirect loop"),
    ),
  ).toEqual([])
})
