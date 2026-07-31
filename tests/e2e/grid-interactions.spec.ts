import { expect, test, type Page } from "@playwright/test"

async function gotoHydrated(page: Page, path: string) {
  await page.goto(path)
  await expect(page.locator("html")).toHaveAttribute(
    "data-app-hydrated",
    "true",
    { timeout: 15_000 },
  )
}

async function tabToGrid(page: Page) {
  const grid = page.getByRole("grid", { name: "Records grid" })
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (
      await grid
        .evaluate((element) => document.activeElement === element)
        .catch(() => false)
    ) {
      return grid
    }
    await page.keyboard.press("Tab")
  }
  throw new Error("The records grid was not reachable with the Tab key.")
}

test("columns resize from their edge and reorder from the header", async (
  { page },
  testInfo,
) => {
  test.skip(
    testInfo.project.name === "mobile",
    "This verifies desktop precision mouse dragging; mobile responsiveness and keyboard column controls are covered separately.",
  )

  await gotoHydrated(page, "/demo")

  const launchResize = page.getByRole("separator", {
    name: "Resize Launch column",
  })
  const resizeBox = await launchResize.boundingBox()
  expect(resizeBox).not.toBeNull()
  const widthBefore = Number(await launchResize.getAttribute("aria-valuenow"))

  await page.mouse.move(
    resizeBox!.x + resizeBox!.width / 2,
    resizeBox!.y + resizeBox!.height / 2,
  )
  await page.mouse.down()
  await page.mouse.move(
    resizeBox!.x + resizeBox!.width / 2 + 48,
    resizeBox!.y + resizeBox!.height / 2,
    { steps: 6 },
  )
  await page.mouse.up()

  await expect
    .poll(async () => Number(await launchResize.getAttribute("aria-valuenow")))
    .toBeGreaterThan(widthBefore)
  await expect(page.locator("[data-grid-announcer]")).toContainText(
    /Launch width is now \d+ pixels\./,
  )

  const launchHeader = page.getByRole("columnheader", {
    name: "Launch",
  })
  const statusHeader = page.getByRole("columnheader", {
    name: "Status",
  })
  await statusHeader.scrollIntoViewIfNeeded()
  await expect(statusHeader).toBeVisible()
  const launchBox = await launchHeader.boundingBox()
  const statusBox = await statusHeader.boundingBox()
  expect(launchBox).not.toBeNull()
  expect(statusBox).not.toBeNull()

  await page.mouse.move(
    statusBox!.x + Math.min(12, statusBox!.width / 2),
    statusBox!.y + statusBox!.height / 2,
  )
  await page.mouse.down()
  await page.mouse.move(
    launchBox!.x + launchBox!.width * 0.25,
    launchBox!.y + launchBox!.height / 2,
    { steps: 10 },
  )
  await page.mouse.up()

  await expect
    .poll(async () =>
      (
        await page
          .locator('[role="columnheader"] > span.truncate')
          .allTextContents()
      ).slice(0, 2),
    )
    .toEqual(["Status", "Launch"])
  await expect(page.locator("[data-grid-announcer]")).toHaveText(
    "Status moved to column 1.",
  )
})

test("adding a column opens field-specific customization", async ({
  page,
}) => {
  await gotoHydrated(page, "/demo")

  await page.getByRole("button", { name: "Add column" }).click()
  await expect(
    page.getByRole("dialog", { name: "Customize new column" }),
  ).toBeVisible()
  await page
    .getByRole("combobox", { name: "Column type" })
    .selectOption("singleSelect")

  await expect(page.getByLabel("Option 1 label")).toBeVisible()
  await expect(page.getByRole("button", { name: "Add option" })).toBeVisible()
  await page.getByLabel("Column name").fill("Priority")
  await page.getByRole("button", { name: "Create column" }).click()

  await expect(
    page.getByRole("dialog", { name: "Customize new column" }),
  ).toBeHidden()
  await expect(
    page.getByRole("columnheader", {
      name: "Priority",
    }),
  ).toBeVisible()
})

test("keyboard range copy, typed paste, and range clear stay spreadsheet-friendly", async ({
  page,
}) => {
  await gotoHydrated(page, "/demo")

  const grid = page.getByRole("grid", { name: "Records grid" })
  await grid.focus()
  await expect(
    page.locator('[data-grid-row="0"][data-grid-column="0"]'),
  ).toHaveAttribute("aria-selected", "true")

  await page.keyboard.press("Shift+ArrowRight")
  await expect(
    page.locator('[data-grid-row="0"][data-grid-column="1"]'),
  ).toHaveAttribute("aria-selected", "true")
  const copied = await grid.evaluate((element) => {
    const clipboardData = new DataTransfer()
    element.dispatchEvent(
      new ClipboardEvent("copy", {
        bubbles: true,
        cancelable: true,
        clipboardData,
      }),
    )
    return clipboardData.getData("text/plain")
  })
  expect(copied).toBe("Workspace templates\tLaunched")

  await page
    .locator('[data-grid-row="1"][data-grid-column="0"]')
    .click()
  await grid.focus()
  await grid.evaluate((element) => {
    const clipboardData = new DataTransfer()
    clipboardData.setData("text/plain", "Pasted launch\tBuilding")
    element.dispatchEvent(
      new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        clipboardData,
      }),
    )
  })

  const launchCell = page.getByRole("textbox", {
    name: "Launch, record 2",
    exact: true,
  })
  const statusCell = page.getByRole("combobox", {
    name: "Status, record 2",
    exact: true,
  })
  await expect(launchCell).toHaveValue("Pasted launch")
  await expect(statusCell).toHaveValue("building")
  await expect(page.locator("[data-grid-announcer]")).toHaveText(
    "2 cells pasted",
  )

  await grid.focus()
  await page.keyboard.press("Delete")
  await expect(launchCell).toHaveValue("")
  await expect(statusCell).toHaveValue("")
  await expect(page.locator("[data-grid-announcer]")).toHaveText(
    "2 cells cleared",
  )
})

test("keyboard-only column navigation, resize, and reorder stay inside the grid workflow", async ({
  page,
}) => {
  await gotoHydrated(page, "/demo")

  const grid = await tabToGrid(page)
  await expect(grid).toBeFocused()
  await expect(grid).toHaveAttribute(
    "aria-activedescendant",
    "grid-cell-0-0",
  )

  await page.keyboard.press("ArrowRight")
  await expect(grid).toHaveAttribute(
    "aria-activedescendant",
    "grid-cell-0-1",
  )
  await page.keyboard.press("Shift+ArrowRight")
  await expect(
    page.locator('[data-grid-row="0"][data-grid-column="2"]'),
  ).toHaveAttribute("aria-selected", "true")
  await page.keyboard.press("ArrowLeft")
  await expect(grid).toHaveAttribute(
    "aria-activedescendant",
    "grid-cell-0-1",
  )

  const statusResize = page.getByRole("separator", {
    name: "Resize Status column",
  })
  const widthBefore = Number(
    await statusResize.getAttribute("aria-valuenow"),
  )
  await page.keyboard.press("Alt+ArrowRight")
  await expect
    .poll(async () =>
      Number(await statusResize.getAttribute("aria-valuenow")),
    )
    .toBe(widthBefore + 20)
  await expect(page.locator("[data-grid-announcer]")).toHaveText(
    `Status width is now ${widthBefore + 20} pixels.`,
  )
  await expect(grid).toBeFocused()

  await page.keyboard.press("Alt+Shift+ArrowLeft")
  await expect
    .poll(async () =>
      (
        await page
          .locator('[role="columnheader"] > span.truncate')
          .allTextContents()
      ).slice(0, 2),
    )
    .toEqual(["Status", "Launch"])
  await expect(page.locator("[data-grid-announcer]")).toHaveText(
    "Status moved to column 1.",
  )
})

test("grid semantics, focus, reduced motion, and overflow stay accessible", async ({
  page,
}) => {
  await page.setViewportSize({ width: 900, height: 700 })
  await page.emulateMedia({ reducedMotion: "reduce" })
  await gotoHydrated(page, "/demo")

  const grid = page.getByRole("grid", { name: "Records grid" })
  await expect(grid).toHaveAttribute("aria-multiselectable", "true")
  await expect(grid).toHaveAttribute("aria-rowcount", /^\d+$/)
  await expect(grid).toHaveAttribute("aria-colcount", /^\d+$/)
  await expect(grid).toHaveAttribute("aria-describedby", /.+/)
  await expect(
    page.getByRole("columnheader", { name: /Launch/ }),
  ).toHaveAttribute("aria-colindex", "2")
  await expect(
    page.locator('[data-grid-row="0"][data-grid-column="0"]'),
  ).toHaveAttribute("aria-colindex", "2")
  await expect(page.getByRole("row").first()).toHaveAttribute(
    "aria-rowindex",
    "1",
  )

  const pageWidth = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth,
  }))
  expect(pageWidth.documentWidth).toBeLessThanOrEqual(
    pageWidth.viewportWidth,
  )
  const scrollBounds = await page
    .locator("[data-grid-scroll-container]")
    .evaluate((element) => {
      const bounds = element.getBoundingClientRect()
      return {
        clientWidth: element.clientWidth,
        left: bounds.left,
        right: bounds.right,
        scrollWidth: element.scrollWidth,
        viewportWidth: window.innerWidth,
      }
    })
  expect(scrollBounds.scrollWidth).toBeGreaterThan(scrollBounds.clientWidth)
  expect(scrollBounds.left).toBeGreaterThanOrEqual(0)
  expect(scrollBounds.right).toBeLessThanOrEqual(
    scrollBounds.viewportWidth + 1,
  )

  const addColumn = page.getByRole("button", { name: "Add column" })
  await addColumn.click()
  const columnName = page.getByRole("textbox", { name: "Column name" })
  await expect(columnName).toBeFocused()
  const dialog = page.getByRole("dialog", {
    name: "Customize new column",
  })
  await expect
    .poll(() =>
      dialog.evaluate(
        (element) => getComputedStyle(element).animationName,
      ),
    )
    .toBe("none")
  await expect(
    page.locator('[data-slot="dialog-overlay"]'),
  ).toHaveCount(0)

  await page.keyboard.press("Escape")
  await expect(dialog).toBeHidden()
  await expect(addColumn).toBeFocused()
})
