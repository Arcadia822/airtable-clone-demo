import { expect, test, type Locator, type Page } from "@playwright/test"

/**
 * End-to-end coverage of the shipped workspace: seeded table, every view type,
 * schema and record writes that survive a reload, forms publishing round-trips,
 * workspace search, the compact mobile layout, and the honest AI fallback.
 *
 * Runs serially against one throwaway database (see playwright.config.ts), so
 * later tests build on the workspace earlier tests shaped.
 */
test.describe.configure({ mode: "serial" })

const AI_UNAVAILABLE =
  "The AI assistant is not available right now. Try again in a moment."

let basePath = ""
let tablePath = ""

function primaryInputs(page: Page): Locator {
  return page.locator('input[aria-label^="Project Name,"]')
}

async function primaryValues(page: Page): Promise<string[]> {
  return primaryInputs(page).evaluateAll((elements) =>
    elements.map((element) => (element as HTMLInputElement).value),
  )
}

async function waitForGridIdle(page: Page) {
  await expect(page.getByRole("grid", { name: "Records grid" })).toHaveAttribute(
    "aria-busy",
    "false",
  )
}

async function openTable(page: Page) {
  await page.goto(tablePath)
  await expect(page.getByRole("grid", { name: "Records grid" })).toBeVisible()
  await expect(primaryInputs(page).first()).toBeVisible()
  await waitForGridIdle(page)
}

async function addRecord(page: Page, title: string) {
  await page.getByRole("button", { name: "Add record" }).click()
  // The grid remounts every row after the server round-trip, so type only once
  // the created record has settled.
  await waitForGridIdle(page)
  const input = primaryInputs(page).last()
  await expect(input).toHaveValue("")
  await input.fill(title)
  await input.press("Enter")
  await waitForGridIdle(page)
  await expect
    .poll(async () => (await primaryValues(page)).includes(title))
    .toBe(true)
}

test("seeded workspace opens the table with six auto-numbered rows", async ({
  page,
}) => {
  await page.goto("/")

  await expect(page).toHaveURL(/\/bases\/[^/]+\/tables\/[^/]+$/)
  tablePath = new URL(page.url()).pathname
  basePath = tablePath.split("/").slice(0, 3).join("/")

  await expect(page.getByRole("grid", { name: "Records grid" })).toBeVisible()
  await expect(page.getByLabel("Record count")).toHaveText("6 records")

  const serials = page.locator('[data-grid-cell][data-grid-column="1"]')
  await expect(serials).toHaveCount(6)
  await expect(serials).toHaveText(["1", "2", "3", "4", "5", "6"])

  const titles = await primaryValues(page)
  expect(titles).toHaveLength(6)
  expect(titles).toContain("Q4 Mobile Onboarding Redesign")
  expect(titles).toContain("Billing & Usage Metering")
})

test("every view type renders its seeded records", async ({ page }) => {
  await openTable(page)
  const main = page.locator("main")

  await page.getByRole("tab", { name: "Status Board" }).click()
  await expect(main).toContainText("Move Q4 Mobile Onboarding Redesign to another group")
  await expect(main).toContainText("In Progress")
  await expect(main).toContainText("Launched")

  await page.getByRole("tab", { name: "Roadmap Timeline" }).click()
  await expect(main).toContainText("Grouped by Status")
  await expect(main).toContainText("Sep 14")

  await page.getByRole("tab", { name: "Launch Calendar" }).click()
  await expect(main).toContainText("Q4 Mobile Onboarding Redesign")

  await page.getByRole("tab", { name: "Executive Dashboard" }).click()
  await expect(main).toContainText("Total Projects")
  await expect(main).toContainText("$329,000")
  await expect(main).toContainText("Projects by Status")

  // Gallery is not part of the seed: create it from the view picker.
  await page.getByRole("button", { name: "New view" }).click()
  await page.getByRole("button", { name: /^Gallery/ }).click()
  await expect(page.getByRole("tab", { name: "Gallery view" })).toBeVisible()
  await expect(main).toContainText("Gallery view")
  await expect(main).toContainText("Enterprise SSO & Audit Logs")

  await page.getByRole("tab", { name: "All Projects" }).click()
  await expect(page.getByRole("grid", { name: "Records grid" })).toBeVisible()
})

test("adds autonumber and image columns to the table", async ({ page }) => {
  await openTable(page)

  for (const [name, typeLabel] of [
    ["Serial", "Autonumber"],
    ["Hero", "Image"],
  ] as const) {
    await page.getByRole("button", { name: "Add column" }).click()
    await page.locator("#field-name").fill(name)
    await page.getByLabel("Column type").selectOption({ label: typeLabel })
    await page.getByRole("button", { name: "Create column" }).click()
    await expect(
      page.locator(`[role="columnheader"][aria-label="${name}"]`),
    ).toBeVisible()
  }

  await expect(
    page.locator('[role="columnheader"][aria-label="Hero"]'),
  ).toBeVisible()
})

test("new records and cell edits survive a reload", async ({ page }) => {
  await openTable(page)
  await addRecord(page, "Playwright Smoke Record")

  await page
    .locator('select[aria-label^="Status,"]')
    .last()
    .selectOption({ label: "In Review" })
  await waitForGridIdle(page)
  await expect(page.locator('select[aria-label^="Status,"]').last()).toHaveValue(
    "opt_review",
  )

  await page.reload()

  await expect(page.getByRole("grid", { name: "Records grid" })).toBeVisible()
  await waitForGridIdle(page)
  // Serial is the tenth data column after the two schema additions.
  const serials = page.locator('[data-grid-cell][data-grid-column="10"]')
  await expect(serials).toHaveCount(7)
  await expect(serials.last()).toHaveText("7")

  const titles = await primaryValues(page)
  expect(titles).toContain("Playwright Smoke Record")
  await expect(page.locator('select[aria-label^="Status,"]').last()).toHaveValue(
    "opt_review",
  )
})

test("publishes a form and writes the submission back into the table", async ({
  page,
  browser,
}) => {
  await openTable(page)
  await page.getByRole("button", { name: "Forms for this base" }).click()
  await expect(page.getByRole("heading", { name: "Forms" })).toBeVisible()

  await page.getByRole("button", { name: "New form" }).first().click()
  await page.locator("#form-name").fill("E2E Intake")
  await page.getByRole("button", { name: "Create form" }).click()

  await expect(page).toHaveURL(/\/forms\/frm_/)
  await expect(page.getByRole("button", { name: "Questions" })).toBeVisible()

  await page.getByRole("button", { name: "Publish form" }).click()
  await expect(page.getByRole("status")).toContainText("Published version 1")

  const publicPath = (await page.locator("header code").first().innerText()).trim()
  expect(publicPath).toMatch(/^\/f\/[a-z0-9-]+$/)

  // Submit as an anonymous visitor in a separate browser context.
  const visitor = await browser.newContext()
  const visitorPage = await visitor.newPage()
  await visitorPage.goto(publicPath)
  await visitorPage.getByLabel("Project Name").fill("Community Launch Notes")
  await visitorPage.getByRole("button", { name: "Submit", exact: true }).click()
  await expect(
    visitorPage.getByRole("button", { name: "Submit another response" }),
  ).toBeVisible()
  await visitor.close()

  await openTable(page)
  await expect
    .poll(async () => (await primaryValues(page)).includes("Community Launch Notes"))
    .toBe(true)
})

test("workspace search returns record hits with snippets", async ({ page }) => {
  await openTable(page)
  await addRecord(page, "季度发布计划")

  await page.getByRole("button", { name: "Search the workspace" }).click()
  const dialog = page.getByRole("dialog")
  const searchInput = dialog.getByPlaceholder(
    "Search tables, views, forms, or any cell…",
  )

  // Two-character Chinese term: label and snippet both render.
  await searchInput.fill("季度")
  const chineseHit = dialog.getByRole("option", { name: /季度发布计划/ }).first()
  await expect(chineseHit).toBeVisible()
  const chineseText = await chineseHit.innerText()
  expect(chineseText.match(/季度发布计划/g)?.length ?? 0).toBeGreaterThanOrEqual(2)

  // Select-option label: the snippet is the matched field text, not the title.
  await searchInput.fill("Launched")
  const enumHit = dialog
    .getByRole("option", { name: /Self-Serve Analytics Dashboard/ })
    .first()
  await expect(enumHit).toBeVisible()
  await expect(enumHit).toContainText("Launched")

  await page.keyboard.press("Escape")
  await expect(dialog).toBeHidden()
})

test("375×812 renders record cards, opens the drawer, and never scrolls sideways", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 375, height: 812 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 3,
  })
  const page = await context.newPage()
  await page.goto(tablePath)
  await page.waitForLoadState("networkidle")

  const cards = page.locator("article")
  await expect(cards.first()).toBeVisible()
  expect(await cards.count()).toBeGreaterThanOrEqual(6)
  await expect(cards.first()).toContainText("#1")
  await expect(page.getByRole("button", { name: "New record" })).toBeVisible()

  await cards.first().getByRole("button").first().click()
  const drawer = page.getByRole("dialog", {
    name: "Q4 Mobile Onboarding Redesign",
  })
  await expect(drawer).toBeVisible()
  await expect(drawer).toContainText(
    "Review and update this record using its named columns.",
  )
  await expect(
    drawer.getByLabel("Project Name for Q4 Mobile Onboarding Redesign"),
  ).toBeVisible()

  const scrollWidth = await page.evaluate(
    () => document.documentElement.scrollWidth,
  )
  expect(scrollWidth).toBeLessThanOrEqual(375)

  await context.close()
})

test("assistant reports the unavailable gateway instead of inventing an answer", async ({
  page,
}) => {
  await openTable(page)
  await page.getByRole("button", { name: "Open the AI assistant" }).click()

  const panel = page.getByRole("dialog", { name: "AI workspace assistant" })
  const composer = panel.getByLabel("Message the workspace analyst")
  await expect(composer).toBeVisible()
  await composer.fill("How many records are in this table?")
  await panel.getByRole("button", { name: "Send", exact: true }).click()

  await expect(panel.getByRole("alert")).toContainText(AI_UNAVAILABLE)
  // Nothing may claim an answer: no answer body, no chart, no saved report.
  await expect(
    panel.getByRole("button", { name: "Save this analysis to reports" }),
  ).toHaveCount(0)
  await expect(panel).not.toContainText("records in this table")
})
