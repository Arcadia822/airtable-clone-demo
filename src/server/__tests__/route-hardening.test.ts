import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { GET as sessionGET } from "@/app/api/auth/session/route"
import { POST as logoutPOST } from "@/app/api/auth/logout/route"
import { DELETE as fieldDELETE, PATCH as fieldPATCH } from "@/app/api/fields/[fieldId]/route"
import { POST as fieldRestorePOST } from "@/app/api/fields/[fieldId]/restore/route"
import { DELETE as formDELETE, PATCH as formPATCH } from "@/app/api/forms/[formId]/route"
import { PATCH as formDraftPATCH } from "@/app/api/forms/[formId]/draft/route"
import { POST as formDraftFromFieldsPOST } from "@/app/api/forms/[formId]/draft/from-fields/route"
import { POST as formPublishPOST } from "@/app/api/forms/[formId]/publish/route"
import { POST as formsPOST } from "@/app/api/forms/route"
import { PATCH as preferencesPATCH } from "@/app/api/preferences/route"
import { DELETE as recordDELETE, PATCH as recordPATCH } from "@/app/api/records/[recordId]/route"
import { POST as recordRestorePOST } from "@/app/api/records/[recordId]/restore/route"
import { DELETE as tablesDELETE, PATCH as tablesPATCH } from "@/app/api/tables/[tableId]/route"
import { POST as tableFieldsPOST } from "@/app/api/tables/[tableId]/fields/route"
import { PATCH as recordsBatchPATCH } from "@/app/api/tables/[tableId]/records/batch/route"
import { POST as recordsQueryPOST } from "@/app/api/tables/[tableId]/records/query/route"
import { DELETE as recordsDELETE, POST as recordsPOST } from "@/app/api/tables/[tableId]/records/route"
import { POST as tablesPOST } from "@/app/api/tables/route"
import { DELETE as viewDELETE, PATCH as viewPATCH } from "@/app/api/views/[viewId]/route"
import { PATCH as viewFieldPATCH } from "@/app/api/views/[viewId]/fields/[fieldId]/route"
import { POST as viewsPOST } from "@/app/api/views/route"
import { resetDbForTests } from "@/db/client"

const APP_ORIGIN = "http://localhost:3000"
const FOREIGN_ORIGIN = "https://evil.example"

type RouteHandler<T extends Record<string, string>> = (
  request: Request,
  context: { params: Promise<T> },
) => Promise<Response>

/** Binds a route handler to the dynamic params a real request would carry. */
function withParams<T extends Record<string, string>>(
  handler: RouteHandler<T>,
  params: T,
) {
  return (request: Request) => handler(request, { params: Promise.resolve(params) })
}

interface MutationCase {
  name: string
  method: "POST" | "PATCH" | "DELETE"
  handle: (request: Request) => Promise<Response>
}

/**
 * Every cookie-authenticated route under the CSRF slice. `POST` on
 * `/records/query` is a read, but it still carries a JSON body and a cookie,
 * so it is guarded like the mutations.
 */
const MUTATIONS: MutationCase[] = [
  { name: "POST /api/tables", method: "POST", handle: withParams(tablesPOST, {}) },
  {
    name: "PATCH /api/tables/[tableId]",
    method: "PATCH",
    handle: withParams(tablesPATCH, { tableId: "tbl_route_hardening" }),
  },
  {
    name: "DELETE /api/tables/[tableId]",
    method: "DELETE",
    handle: withParams(tablesDELETE, { tableId: "tbl_route_hardening" }),
  },
  {
    name: "POST /api/tables/[tableId]/fields",
    method: "POST",
    handle: withParams(tableFieldsPOST, { tableId: "tbl_route_hardening" }),
  },
  {
    name: "POST /api/tables/[tableId]/records",
    method: "POST",
    handle: withParams(recordsPOST, { tableId: "tbl_route_hardening" }),
  },
  {
    name: "DELETE /api/tables/[tableId]/records",
    method: "DELETE",
    handle: withParams(recordsDELETE, { tableId: "tbl_route_hardening" }),
  },
  {
    name: "PATCH /api/tables/[tableId]/records/batch",
    method: "PATCH",
    handle: withParams(recordsBatchPATCH, { tableId: "tbl_route_hardening" }),
  },
  {
    name: "POST /api/tables/[tableId]/records/query",
    method: "POST",
    handle: withParams(recordsQueryPOST, { tableId: "tbl_route_hardening" }),
  },
  {
    name: "PATCH /api/records/[recordId]",
    method: "PATCH",
    handle: withParams(recordPATCH, { recordId: "rec_route_hardening" }),
  },
  {
    name: "DELETE /api/records/[recordId]",
    method: "DELETE",
    handle: withParams(recordDELETE, { recordId: "rec_route_hardening" }),
  },
  {
    name: "POST /api/records/[recordId]/restore",
    method: "POST",
    handle: withParams(recordRestorePOST, { recordId: "rec_route_hardening" }),
  },
  {
    name: "PATCH /api/fields/[fieldId]",
    method: "PATCH",
    handle: withParams(fieldPATCH, { fieldId: "fld_route_hardening" }),
  },
  {
    name: "DELETE /api/fields/[fieldId]",
    method: "DELETE",
    handle: withParams(fieldDELETE, { fieldId: "fld_route_hardening" }),
  },
  {
    name: "POST /api/fields/[fieldId]/restore",
    method: "POST",
    handle: withParams(fieldRestorePOST, { fieldId: "fld_route_hardening" }),
  },
  { name: "POST /api/views", method: "POST", handle: withParams(viewsPOST, {}) },
  {
    name: "PATCH /api/views/[viewId]",
    method: "PATCH",
    handle: withParams(viewPATCH, { viewId: "viw_route_hardening" }),
  },
  {
    name: "DELETE /api/views/[viewId]",
    method: "DELETE",
    handle: withParams(viewDELETE, { viewId: "viw_route_hardening" }),
  },
  {
    name: "PATCH /api/views/[viewId]/fields/[fieldId]",
    method: "PATCH",
    handle: withParams(viewFieldPATCH, {
      viewId: "viw_route_hardening",
      fieldId: "fld_route_hardening",
    }),
  },
  { name: "POST /api/forms", method: "POST", handle: withParams(formsPOST, {}) },
  {
    name: "PATCH /api/forms/[formId]",
    method: "PATCH",
    handle: withParams(formPATCH, { formId: "frm_route_hardening" }),
  },
  {
    name: "DELETE /api/forms/[formId]",
    method: "DELETE",
    handle: withParams(formDELETE, { formId: "frm_route_hardening" }),
  },
  {
    name: "PATCH /api/forms/[formId]/draft",
    method: "PATCH",
    handle: withParams(formDraftPATCH, { formId: "frm_route_hardening" }),
  },
  {
    name: "POST /api/forms/[formId]/draft/from-fields",
    method: "POST",
    handle: withParams(formDraftFromFieldsPOST, { formId: "frm_route_hardening" }),
  },
  {
    name: "POST /api/forms/[formId]/publish",
    method: "POST",
    handle: withParams(formPublishPOST, { formId: "frm_route_hardening" }),
  },
  {
    name: "PATCH /api/preferences",
    method: "PATCH",
    handle: withParams(preferencesPATCH, {}),
  },
  { name: "POST /api/auth/logout", method: "POST", handle: withParams(logoutPOST, {}) },
]

function mutationRequest(method: string, origin: string): Request {
  return new Request(`${APP_ORIGIN}/api/route-hardening/${method.toLowerCase()}`, {
    method,
    headers: { "content-type": "application/json", origin },
    body: "{}",
  })
}

beforeEach(async () => {
  process.env.DATABASE_URL = "pglite:memory"
  vi.stubEnv("FACTORY_VISITOR_AUTH_URL", "")
  vi.stubEnv("FACTORY_VISITOR_AUTH_TOKEN", "")
  vi.stubEnv("ALLOW_LOCAL_WORKSPACE", "")
  vi.stubEnv("VERCEL_ENV", "")
  vi.stubEnv("TURNSTILE_SECRET_KEY", "")
  await resetDbForTests()
})

afterEach(async () => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  await resetDbForTests()
})

describe("CSRF origin guard on cookie-authenticated mutations", () => {
  it.each(MUTATIONS)(
    "$name rejects a foreign Origin with 403 FORBIDDEN",
    async ({ method, handle }) => {
      const response = await handle(mutationRequest(method, FOREIGN_ORIGIN))

      expect(response.status).toBe(403)
      expect(await response.json()).toMatchObject({ code: "FORBIDDEN" })
    },
  )

  it.each(MUTATIONS)(
    "$name lets the app Origin through the guard",
    async ({ method, handle }) => {
      const response = await handle(mutationRequest(method, APP_ORIGIN))

      expect(response.status).not.toBe(403)
      const body = (await response.json().catch(() => null)) as {
        code?: string
      } | null
      expect(body?.code).not.toBe("FORBIDDEN")
    },
  )

  it("still rejects cross-site fetch metadata without an Origin header", async () => {
    const request = new Request(`${APP_ORIGIN}/api/preferences`, {
      method: "PATCH",
      headers: { "content-type": "application/json", "sec-fetch-site": "cross-site" },
      body: "{}",
    })

    const response = await preferencesPATCH(request)

    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ code: "FORBIDDEN" })
  })
})

describe("GET /api/auth/session", () => {
  it("answers 503 AUTH_NOT_CONFIGURED on a deployment without credentials", async () => {
    vi.stubEnv("NODE_ENV", "production")

    const response = await sessionGET(new Request(`${APP_ORIGIN}/api/auth/session`))

    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({
      code: "AUTH_NOT_CONFIGURED",
      message: "Authentication is not configured for this deployment.",
    })
  })

  it("still reports the local visitor when local mode is allowed", async () => {
    const response = await sessionGET(new Request(`${APP_ORIGIN}/api/auth/session`))

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      authMode: "local",
      visitor: { orgId: "local-org", userId: "local-user" },
    })
  })

  it("keeps the signed-out envelope when Factory auth is configured but the cookie is rejected", async () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("FACTORY_VISITOR_AUTH_URL", "https://auth.factory.test")
    vi.stubEnv("FACTORY_VISITOR_AUTH_TOKEN", "test-token")
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 401 })),
    )

    const response = await sessionGET(new Request(`${APP_ORIGIN}/api/auth/session`))

    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({ visitor: null })
  })
})
