import { createClerkClient } from "@clerk/backend"
import { expect, test as setup } from "@playwright/test"
import { clerk, clerkSetup } from "@clerk/testing/playwright"
import { mkdir } from "node:fs/promises"

const authFile = "playwright/.clerk/user.json"
const organizationName =
  process.env.E2E_CLERK_ORGANIZATION_NAME?.trim()

setup.describe.configure({ mode: "serial" })

setup("configure Clerk browser testing", async () => {
  await clerkSetup()
})

setup("authenticate an existing organization admin", async ({ page }) => {
  const secretKey = process.env.CLERK_SECRET_KEY
  if (!secretKey) {
    throw new Error(
      "CLERK_SECRET_KEY is required for connected browser tests.",
    )
  }
  if (!organizationName) {
    throw new Error(
      "E2E_CLERK_ORGANIZATION_NAME is required for connected browser tests. Use a disposable organization because the suite creates and archives test data.",
    )
  }

  const client = createClerkClient({ secretKey })
  const organizations = await client.organizations.getOrganizationList({
    limit: 20,
    query: organizationName,
  })
  const organization = organizations.data.find(
    (candidate) =>
      candidate.name.toLocaleLowerCase() ===
      organizationName.toLocaleLowerCase(),
  )
  if (!organization) {
    throw new Error(
      `The connected test workspace “${organizationName}” was not found.`,
    )
  }

  const memberships =
    await client.organizations.getOrganizationMembershipList({
      limit: 100,
      organizationId: organization.id,
    })
  const administrator = memberships.data.find(
    (membership) =>
      membership.role === "org:admin" &&
      membership.publicUserData?.userId,
  )
  if (!administrator?.publicUserData?.userId) {
    throw new Error(
      `The connected test workspace “${organizationName}” needs an administrator.`,
    )
  }
  const user = await client.users.getUser(
    administrator.publicUserData.userId,
  )
  const emailAddress = user.primaryEmailAddress?.emailAddress
  if (!emailAddress) {
    throw new Error(
      "The connected test administrator needs a primary email address.",
    )
  }

  await page.goto("/")
  await clerk.signIn({ emailAddress, page })
  await page.waitForFunction(
    () =>
      Boolean(
        (
          window as unknown as {
            Clerk?: { loaded?: boolean }
          }
        ).Clerk?.loaded,
      ),
  )
  const hasFreshSessionToken = await page.evaluate(async (organizationId) => {
    const activeClerk = (
      window as unknown as {
        Clerk: {
          session?: {
            getToken: (input: {
              skipCache: boolean
            }) => Promise<string | null>
          }
          setActive: (input: {
            organization: string
          }) => Promise<void>
        }
      }
    ).Clerk
    await activeClerk.setActive({ organization: organizationId })
    return Boolean(
      await activeClerk.session?.getToken({ skipCache: true }),
    )
  }, organization.id)
  expect(hasFreshSessionToken).toBe(true)

  const legacyConvexTemplateFailures: string[] = []
  page.on("response", (response) => {
    const url = new URL(response.url())
    if (
      response.status() === 404 &&
      /\/tokens\/convex$/.test(url.pathname)
    ) {
      legacyConvexTemplateFailures.push(url.pathname)
    }
  })
  await page.goto("/dashboard")
  await expect(
    page.getByRole("heading", { name: "Bases", exact: true }),
  ).toBeVisible({ timeout: 20_000 })
  await expect(page.getByText(organizationName).first()).toBeVisible()
  expect(legacyConvexTemplateFailures).toEqual([])

  const clerkCookies = (await page.context().cookies()).filter((cookie) =>
    /^__(?:session|clerk_db_jwt)(?:_|$)/.test(cookie.name),
  )
  expect(clerkCookies.length).toBeGreaterThan(0)
  for (const cookie of clerkCookies) {
    expect(cookie.domain).toBe("localhost")
    expect(
      cookie.sameSite === "None" && !cookie.secure,
      `${cookie.name} must not use SameSite=None without Secure`,
    ).toBe(false)
  }

  await mkdir("playwright/.clerk", { recursive: true })
  await page.context().storageState({ path: authFile })
})
