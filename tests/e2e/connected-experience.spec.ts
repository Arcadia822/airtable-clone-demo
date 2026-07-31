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

async function createGridView(page: Page, name: string) {
  await page.getByRole("button", { name: "Choose a view" }).click()
  await page.getByRole("menuitem", { name: "Create view" }).click()

  const dialog = page.getByRole("dialog", { name: "Create a view" })
  await dialog.getByLabel("View name").fill(name)
  await dialog.getByRole("button", { name: "Create view" }).click()

  await expect(page.getByRole("button", { name: "Choose a view" })).toContainText(
    name,
  )
  await waitForLiveSave(page)
}

async function chooseNamedOption(
  page: Page,
  comboboxName: string,
  optionName: string,
) {
  const combobox = page.getByRole("combobox", {
    name: comboboxName,
    exact: true,
  })
  await expect(combobox).toBeVisible({ timeout: 10_000 })
  await combobox.click()
  await page
    .getByRole("option", {
      name: new RegExp(`^${escapeRegExp(optionName)}(?:\\s|$)`),
    })
    .click()
}

async function waitForViewControl(
  page: Page,
  name: RegExp,
) {
  await expect(page.getByRole("button", { name })).toBeEnabled({
    timeout: 20_000,
  })
  await waitForLiveSave(page)
}

async function waitForSavedViewReady(page: Page) {
  await expect(
    page.getByText("Preparing saved view…", { exact: true }),
  ).toHaveCount(0, { timeout: 30_000 })
  await expect(
    page.getByRole("grid", { name: "Records grid" }),
  ).toBeVisible({ timeout: 30_000 })
}

async function visibleRecordNames(page: Page) {
  const inputs = page.getByRole("textbox", {
    name: /^Name, record \d+$/,
  })
  const count = await inputs.count()
  return await Promise.all(
    Array.from({ length: count }, (_, index) =>
      inputs.nth(index).inputValue(),
    ),
  )
}

async function visibleRecordStages(page: Page) {
  return await page
    .getByRole("combobox", { name: /^Stage, record \d+$/ })
    .evaluateAll((controls) =>
      controls.map((control) => {
        const selected = (control as HTMLSelectElement).selectedOptions[0]
        return selected?.textContent?.trim() ?? ""
      }),
    )
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

test("authenticated workspace navigation stays named, live, and URL-aware", async ({
  page,
}) => {
  await gotoHydrated(page, "/dashboard")

  await expect(
    page.getByRole("heading", { name: "Bases", exact: true }),
  ).toBeVisible()
  await expect(
    page.getByRole("button", { name: "Open organization switcher" }),
  ).toBeVisible()
  await expect(page.getByRole("link", { name: "Sign in" })).toHaveCount(0)
  await expect(
    page
      .getByRole("navigation", { name: "App navigation" })
      .getByRole("link", { name: /Upgrade|Plans/i }),
  ).toHaveCount(0)
  await expect(
    page.getByRole("status", { name: /Live\. All changes are saved\./ }),
  ).toBeVisible()

  await page
    .getByRole("link", {
      name: "Product operations Base",
      exact: true,
    })
    .first()
    .click()
  await expect(page).toHaveURL(/\/tables\/[^/?]+/)
  await expect(
    page.getByRole("grid", { name: "Records grid" }),
  ).toBeVisible({ timeout: 20_000 })
  const shellBreadcrumb = page.getByRole("navigation", {
    name: "Workspace breadcrumb",
    exact: true,
  })
  await expect(
    shellBreadcrumb.getByRole("link", {
      name: "Bases",
      exact: true,
    }),
  ).toHaveAttribute("href", "/dashboard")
  await expect(
    shellBreadcrumb.getByRole("link", {
      name: "Product operations",
      exact: true,
    }),
  ).toHaveAttribute("href", /\/bases\/[^/]+$/)
  await expect(shellBreadcrumb.locator('[aria-current="page"]')).toHaveText(
    "Product roadmap",
  )
  const workspaceBreadcrumb = page.getByRole("navigation", {
    name: "Breadcrumb",
    exact: true,
  })
  await expect(
    workspaceBreadcrumb.getByRole("link", {
      name: "Product operations",
      exact: true,
    }),
  ).toHaveAttribute("href", /\/bases\/[^/]+$/)
  await expect(
    workspaceBreadcrumb.getByRole("link", {
      name: "Product roadmap",
      exact: true,
    }),
  ).toHaveAttribute("href", /\/tables\/[^/?]+$/)
  await expect(
    workspaceBreadcrumb.locator('[aria-current="page"]'),
  ).not.toBeEmpty()
  await expect(page.getByText(/Authorizing this organization/i)).toHaveCount(0)

  await page.goBack()
  await expect(
    page.getByRole("heading", {
      name: "Bases",
      exact: true,
    }),
  ).toBeVisible()
  await page.goForward()
  await expect(
    page.getByRole("grid", { name: "Records grid" }),
  ).toBeVisible()
})

test("workspace navigation collapse is persistent and base links resume work", async ({
  page,
}) => {
  await gotoHydrated(page, "/dashboard")

  const sidebar = page.locator(".workspace-sidebar")
  await expect(sidebar).toHaveCSS("width", "240px")
  await page
    .getByRole("button", { name: "Collapse workspace navigation" })
    .click()
  await expect(
    page.getByRole("button", { name: "Expand workspace navigation" }),
  ).toBeVisible()
  await expect(sidebar).toHaveCSS("width", "64px")
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.localStorage.getItem(
          "basecraft:workspace-navigation",
        ),
      ),
    )
    .toBe("collapsed")

  await page.reload()
  await expect(page.locator("html")).toHaveAttribute(
    "data-app-hydrated",
    "true",
  )
  await expect(
    page.getByRole("button", { name: "Expand workspace navigation" }),
  ).toBeVisible()
  await expect(sidebar).toHaveCSS("width", "64px")

  await page
    .getByRole("button", { name: "Expand workspace navigation" })
    .click()
  const baseLink = page
    .getByRole("navigation", { name: "App navigation" })
    .getByRole("link", {
      name: "Product operations Base",
      exact: true,
    })
  await expect(baseLink).toHaveAttribute("href", /\/bases\/[^/]+$/)
  await baseLink.click()
  await expect(page).toHaveURL(/\/bases\/[^/]+\/tables\/[^/?]+/)
  await expect(
    page.getByRole("grid", { name: "Records grid" }),
  ).toBeVisible({ timeout: 20_000 })
})

test("connected forms and analytics use readable resource names", async ({
  page,
}) => {
  await gotoHydrated(page, "/dashboard")
  await page
    .getByRole("link", {
      name: "Product operations Base",
      exact: true,
    })
    .first()
    .click()
  await page
    .getByRole("navigation", { name: "App navigation" })
    .getByRole("link", { name: /^Forms/ })
    .click()

  await expect(page).toHaveURL(/\/bases\/[^/]+\/forms$/)
  await expect(
    page.getByRole("heading", { name: "Public forms", exact: true }),
  ).toBeVisible()
  await expect(page.getByText("Product feedback").first()).toBeVisible()
  await expect(page.locator("body")).not.toContainText(
    /form_[a-z0-9]|table_[a-z0-9]|field_[a-z0-9]/i,
  )

  await page.getByRole("link", { name: /^Form analytics/ }).click()
  await expect(page).toHaveURL(/\/forms\/analytics$/)
  await expect(
    page.getByRole("heading", { name: /Form analytics/i }),
  ).toBeVisible()
  await expect(page.getByText("Product feedback").first()).toBeVisible()
})

test("connected navigation remains usable at a responsive viewport", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await gotoHydrated(page, "/dashboard")

  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth >
      document.documentElement.clientWidth,
  )
  expect(overflow).toBe(false)

  const navigationButton = page.getByRole("button", {
    name: "Open workspace navigation",
  })
  await expect(navigationButton).toBeVisible()
  await navigationButton.click()
  const navigationDialog = page.getByRole("dialog", {
    name: "Workspace navigation",
  })
  await expect(navigationDialog).toBeVisible()
  await expect(
    navigationDialog.getByRole("navigation", {
      name: "App navigation",
    }),
  ).toBeVisible()
  const basesLink = navigationDialog.getByRole("link", {
    name: "Bases",
    exact: true,
  })
  await expect(basesLink).toHaveAttribute("aria-current", "page")
  await expect(
    navigationDialog.getByRole("link", { name: /Upgrade|Plans/i }),
  ).toHaveCount(0)
  await basesLink.click()
  await expect(navigationDialog).toBeHidden()
})

test("signed-in pricing uses the active workspace and live catalog amounts", async ({
  page,
}) => {
  const organizationName =
    process.env.E2E_CLERK_ORGANIZATION_NAME?.trim()
  if (!organizationName) {
    throw new Error(
      "E2E_CLERK_ORGANIZATION_NAME is required for connected browser tests.",
    )
  }
  await gotoHydrated(page, "/pricing")

  await expect(page.getByRole("link", { name: "Sign in" })).toHaveCount(0)
  await expect(page.getByText(organizationName).first()).toBeVisible()
  await page.getByRole("button", { name: /Annual/ }).click()
  await expect(page.getByText("$189.96 billed annually")).toBeVisible()
  await expect(page.getByText("$590.04 billed annually")).toBeVisible()
})

test("an admin can build, collaborate on, publish, and measure a named workflow", async ({
  browser,
  page,
}) => {
  test.setTimeout(300_000)

  const runStamp = new Date()
    .toISOString()
    .replace("T", " ")
    .replace(/\.\d{3}Z$/, " UTC")
  const baseName = `Browser QA workspace ${runStamp}`
  const tableName = "Requests"
  const filteredViewName = "Approved requests"
  const groupedViewName = "Requests by stage"
  const formName = "Browser QA intake"

  await test.step("create a named base, table, and choice column", async () => {
    await gotoHydrated(page, "/dashboard")
    await waitForLiveSave(page)
    await page.getByRole("button", { name: "New base" }).click()

    const baseDialog = page.getByRole("dialog", { name: "Create a base" })
    await baseDialog.getByLabel("Name", { exact: true }).fill(baseName)
    await baseDialog
      .getByLabel(/Description/)
      .fill("Temporary browser validation workspace")
    await baseDialog.getByRole("button", { name: "Create base" }).click()

    await expect(page).toHaveURL(/\/bases\/[^/?]+$/)
    await expect(
      page.getByRole("heading", { name: baseName, exact: true }),
    ).toBeVisible()

    await page
      .getByRole("button", {
        name: /^(?:New table|Create first table)$/,
      })
      .first()
      .click()
    const tableDialog = page.getByRole("dialog", { name: "Create a table" })
    await tableDialog.getByLabel("Table name").fill(tableName)
    await tableDialog
      .getByRole("button", { name: "Create table" })
      .click()

    await expect(page).toHaveURL(/\/tables\/[^/?]+/)
    await expect(
      page.getByRole("grid", { name: "Records grid" }),
    ).toBeVisible({ timeout: 20_000 })

    await page.getByRole("button", { name: "Add column" }).click()
    const columnDialog = page.getByRole("dialog", {
      name: "Customize new column",
    })
    await columnDialog
      .getByRole("combobox", { name: "Column type" })
      .selectOption("singleSelect")
    await columnDialog.getByLabel("Column name").fill("Stage")
    await columnDialog.getByLabel("Option 1 label").fill("Approved")
    await columnDialog.getByLabel("Option 2 label").fill("New")
    await columnDialog
      .getByRole("button", { name: "Create column" })
      .click()

    await expect(
      page.getByRole("columnheader", { name: "Stage" }),
    ).toBeVisible()
    await waitForLiveSave(page)
  })

  await test.step("add records and prove reload persistence", async () => {
    const records = [
      { name: "Atlas request", stage: "Approved" },
      { name: "Beacon request", stage: "New" },
      { name: "Cedar request", stage: "Approved" },
    ]

    for (const [index, record] of records.entries()) {
      await page.getByRole("button", { name: "Add record" }).click()
      const recordNumber = index + 1
      const nameCell = page.getByRole("textbox", {
        name: `Name, record ${recordNumber}`,
        exact: true,
      })
      await expect(nameCell).toBeVisible()
      await nameCell.fill(record.name)
      await nameCell.press("Enter")
      await waitForGridWrite(page)
      await page
        .getByRole("combobox", {
          name: `Stage, record ${recordNumber}`,
          exact: true,
        })
        .selectOption({ label: record.stage })
      await waitForGridWrite(page)
    }

    await page.reload()
    await expect(page.locator("html")).toHaveAttribute(
      "data-app-hydrated",
      "true",
      { timeout: 15_000 },
    )
    await expect(
      page.getByRole("grid", { name: "Records grid" }),
    ).toBeVisible({ timeout: 20_000 })
    await expect
      .poll(async () => (await visibleRecordNames(page)).toSorted())
      .toEqual(
        ["Atlas request", "Beacon request", "Cedar request"].toSorted(),
      )
    await expect
      .poll(async () => (await visibleRecordStages(page)).toSorted())
      .toEqual(["Approved", "Approved", "New"].toSorted())
  })

  await test.step("propagate a cell edit to a second authenticated page", async () => {
    const collaboratorPage = await page.context().newPage()
    const tableUrl = new URL(page.url())
    await gotoHydrated(
      collaboratorPage,
      `${tableUrl.pathname}${tableUrl.search}`,
    )
    await expect(
      collaboratorPage.getByRole("grid", { name: "Records grid" }),
    ).toBeVisible({ timeout: 20_000 })

    const primaryCell = page.getByRole("textbox", {
      name: "Name, record 1",
      exact: true,
    })
    await primaryCell.fill("Atlas request live")
    await primaryCell.press("Enter")
    await waitForGridWrite(page)

    await expect(
      collaboratorPage.getByRole("textbox", {
        name: "Name, record 1",
        exact: true,
      }),
    ).toHaveValue("Atlas request live", { timeout: 20_000 })
    await collaboratorPage.close()
  })

  await test.step("create a filtered and sorted named view", async () => {
    await createGridView(page, filteredViewName)

    await page.getByRole("button", { name: "Filter records" }).click()
    await page.getByRole("button", { name: "Add condition" }).click()
    await waitForViewControl(page, /Filter records, 1 active/)
    await page
      .getByRole("button", { name: /Filter records, 1 active/ })
      .click()
    await chooseNamedOption(page, "Column", "Stage")
    await waitForViewControl(page, /Filter records, 1 active/)
    await page
      .getByRole("button", { name: /Filter records, 1 active/ })
      .click()
    await expect(
      page.getByRole("combobox", { name: "Choice", exact: true }),
    ).toContainText("Approved")
    await page.keyboard.press("Escape")

    await page.getByRole("button", { name: "Sort records" }).click()
    await page.getByRole("button", { name: "Add sort" }).click()
    await waitForViewControl(page, /Sort records, 1 active/)
    await page
      .getByRole("button", { name: /Sort records, 1 active/ })
      .click()
    await expect(
      page.getByRole("combobox", {
        name: "Sort first by",
        exact: true,
      }),
    ).toContainText("Name")
    await page
      .getByRole("combobox", { name: "Direction", exact: true })
      .click()
    await page.getByRole("option", { name: "Z → A" }).click()
    await waitForViewControl(page, /Sort records, 1 active/)
    await page.keyboard.press("Escape")

    await waitForSavedViewReady(page)
    await expect
      .poll(() => visibleRecordNames(page), { timeout: 30_000 })
      .toEqual(["Cedar request", "Atlas request live"])
  })

  await test.step("create a second named view grouped by the choice column", async () => {
    await createGridView(page, groupedViewName)
    await page.getByRole("button", { name: "Group records" }).click()
    await page.getByRole("button", { name: "Add grouping" }).click()
    await waitForViewControl(page, /Group records, 1 active/)
    await page
      .getByRole("button", { name: /Group records, 1 active/ })
      .click()
    await chooseNamedOption(page, "Group first by", "Stage")
    await waitForViewControl(page, /Group records, 1 active/)
    await page.keyboard.press("Escape")

    await waitForSavedViewReady(page)
    await expect(
      page.getByRole("rowheader", {
        name: "Collapse group Stage: Approved",
      }),
    ).toBeVisible()
    await expect(
      page.getByRole("rowheader", {
        name: "Collapse group Stage: New",
      }),
    ).toBeVisible()
    await expect
      .poll(async () => (await visibleRecordNames(page)).toSorted())
      .toEqual(
        ["Atlas request live", "Beacon request", "Cedar request"].toSorted(),
      )
  })

  await test.step("publish and submit a public form using named fields", async () => {
    await page.getByRole("link", { name: /^Forms/ }).click()
    await expect(
      page.getByRole("heading", { name: "Public forms", exact: true }),
    ).toBeVisible()
    await page.getByRole("button", { name: "Create form" }).click()

    const formDialog = page.getByRole("dialog", {
      name: "Create a public form",
    })
    await formDialog.getByLabel("Form name").fill(formName)
    await formDialog
      .getByRole("combobox", { name: "Save responses in" })
      .click()
    await page
      .getByRole("option", {
        name: new RegExp(`^${escapeRegExp(tableName)}(?:\\s|$)`),
      })
      .click()
    await formDialog.getByRole("button", { name: "Create form" }).click()

    await expect(
      page.getByRole("heading", { name: formName, exact: true }).first(),
    ).toBeVisible()
    await page
      .getByRole("button", { name: "Review publish changes" })
      .click()
    const publishDialog = page.getByRole("alertdialog", {
      name: "Publish this form?",
    })
    await publishDialog
      .getByRole("button", { name: "Publish form" })
      .click()
    await expect(page.getByText("Published", { exact: true })).toBeVisible()

    const publicPreviewPromise = page.waitForEvent("popup")
    await page.getByRole("button", { name: "Open", exact: true }).click()
    const publicPreview = await publicPreviewPromise
    await publicPreview.waitForLoadState("domcontentloaded")
    const publicHref = publicPreview.url()
    expect(publicHref).toMatch(/\/f\/[^/?]+/)
    await publicPreview.close()

    const publicContext = await browser.newContext()
    await publicContext.route(
      "https://challenges.cloudflare.com/turnstile/v0/api.js*",
      async (route) => {
        await route.fulfill({
          body: `
            window.turnstile = {
              render(_container, options) {
                queueMicrotask(() => options.callback("XXXX.DUMMY.TOKEN.XXXX"));
                return "basecraft-playwright-test";
              },
              remove() {},
              reset() {},
            };
          `,
          contentType: "application/javascript",
        })
      },
    )
    const publicPage = await publicContext.newPage()
    await gotoHydrated(publicPage, publicHref)
    await expect(
      publicPage.getByRole("heading", { name: formName, exact: true }),
    ).toBeVisible({ timeout: 20_000 })

    const verification = publicPage.getByRole("group", {
      name: "Security verification",
    })
    await expect(verification).toHaveAttribute("aria-busy", "false", {
      timeout: 30_000,
    })

    await publicPage.getByLabel(/^Name/).fill("Delta request")
    await publicPage
      .getByRole("combobox", { name: /^Stage/ })
      .click()
    await publicPage
      .getByRole("option", { name: "Approved", exact: true })
      .click()
    await publicPage
      .getByRole("button", { name: "Submit", exact: true })
      .click()

    await expect(
      publicPage.getByRole("heading", {
        name: "Thank you for your submission",
        exact: true,
      }),
    ).toBeVisible({ timeout: 30_000 })
    await expect(
      publicPage.getByText("Your response has been recorded.", {
        exact: true,
      }),
    ).toBeVisible()
    await publicContext.close()
  })

  await test.step("verify the response, created record, and form analytics", async () => {
    await page.getByRole("button", { name: "Responses", exact: true }).click()
    await expect(page).toHaveURL(/\/submissions(?:\?|$)/)
    await expect(
      page
        .getByRole("heading", { name: formName, exact: true })
        .first(),
    ).toBeVisible()
    await page
      .getByRole("button", { name: /Delta request/ })
      .click()

    const responseDialog = page.getByRole("dialog", {
      name: "Delta request",
    })
    await expect(responseDialog).toContainText("Name")
    await expect(responseDialog).toContainText("Delta request")
    await expect(responseDialog).toContainText("Stage")
    await expect(responseDialog).toContainText("Approved")
    await responseDialog
      .getByRole("link", { name: `Open record in ${tableName}` })
      .click()

    await expect(
      page.getByRole("dialog", { name: "Delta request" }),
    ).toContainText("Approved")
    await page.goBack()
    await expect(page).toHaveURL(/\/submissions(?:\?|$)/)
    await expect(
      page
        .getByRole("heading", { name: formName, exact: true })
        .first(),
    ).toBeVisible()
    await page.getByRole("button", { name: "Analytics", exact: true }).click()

    await expect(
      page.getByRole("group", { name: "Submissions: 1" }),
    ).toBeVisible({ timeout: 30_000 })
    await expect(
      page.getByRole("group", { name: "Unique views: 1" }).first(),
    ).toBeVisible({ timeout: 30_000 })
  })

  await test.step("archive the public form through its recoverable app action", async () => {
    await page
      .getByLabel("Breadcrumb", { exact: true })
      .getByRole("link", { name: "Forms", exact: true })
      .click()
    const formRow = page.getByLabel(`${formName} activity`)
    await formRow
      .getByRole("button", { name: `Archive ${formName}` })
      .click()

    const archiveDialog = page.getByRole("dialog", {
      name: `Archive “${formName}”?`,
    })
    await archiveDialog
      .getByRole("button", { name: "Archive form" })
      .click()
    await expect(formRow).toHaveCount(0)
  })
})
