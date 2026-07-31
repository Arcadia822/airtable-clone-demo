# EVE assistant integration contract

This directory is the server-side boundary between the EVE agent and the application data plane. The model never receives or chooses a Clerk organization ID. The EVE channel derives the active organization and user from Clerk, and every tool derives the same scope from `ctx.session.auth`.

## Required application wiring

The root Next.js configuration wraps the existing config with `withEve` from
`eve/next`.

Configure these EVE/Vercel runtime variables:

| Variable | Purpose |
| --- | --- |
| `CLERK_SECRET_KEY` | Verifies Clerk session requests. |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk instance identifier used during verification. |
| `CLERK_AI_FEATURE` | Bare Clerk Billing feature slug checked by `auth.has`; defaults to `ai_assistant`. |
| `NEXT_PUBLIC_EVE_HOST` | Cookie-free EVE origin used by the browser. Set this to the separately deployed agent origin in production. Local development automatically swaps `localhost` and `127.0.0.1`. |
| `EVE_ALLOWED_ORIGINS` | Comma-separated exact application origins accepted as Clerk authorized parties. Required in production unless an app/Vercel URL variable resolves an origin. |
| `EVE_CONVEX_BRIDGE_URL` | Full Convex HTTP action URL for bounded reads and approved writes, for example `https://deployment.convex.site/eve/assistant`. |
| `EVE_SESSION_OWNERSHIP_URL` | Full Convex HTTP action URL for EVE session owner registration and checks, for example `https://deployment.convex.site/eve/session-ownership`. |
| `EVE_CONVEX_HMAC_SECRET` | High-entropy secret shared only by EVE and the two Convex HTTP actions. |
| `EVE_CONVEX_HMAC_KEY_ID` | Optional rotation identifier; defaults to `primary`. |

No Clerk Billing webhook or user/subscription mirror is expected. Clerk session claims and `has({ feature: "ai_assistant" })` remain the entitlement source of truth. Billing feature and plan checks use bare slugs; do not prefix this feature with `org:`.

Browser requests use an explicit EVE origin so they carry the short-lived Clerk
bearer without also forwarding the web app's Clerk cookies. The channel permits
only exact configured origins, `GET`/`POST`, and the authorization/content-type
headers. This avoids request-header `431` failures without increasing proxy
limits or relaxing Clerk verification. In production, the EVE host must not
redirect back to the application origin.

## Signed HTTP request

Both endpoints receive JSON via `POST`. Requests carry:

- `x-eve-timestamp`: Unix time in seconds.
- `x-eve-nonce`: A fresh UUID consumed exactly once during the replay window.
- `x-eve-signature`: `v1=` followed by the lowercase hex HMAC-SHA256 digest.
- `x-eve-key-id`: the configured key identifier.

The signed message is the exact UTF-8 string:

```text
<x-eve-timestamp>.<x-eve-nonce>.<uppercase HTTP method>.<URL pathname>.<raw request body>
```

The Convex HTTP action rejects an unknown key ID, a reused nonce, a signature
mismatch using constant-time comparison, or a timestamp outside its five-minute
replay window. It parses and validates the body only after signature
verification. Convex HTTP actions do not have argument validators, so manual
validation is mandatory at this boundary.

Successful responses use:

```json
{ "ok": true, "data": {} }
```

Failures should use a non-2xx status and a bounded error:

```json
{ "ok": false, "error": { "code": "stale_write", "message": "The record changed." } }
```

Do not return stack traces, credentials, raw file contents, base64, data URLs, storage URLs, or signed download URLs.

## Data bridge endpoint

`EVE_CONVEX_BRIDGE_URL` accepts a server-derived `scope.organizationId`, an
`actor`, an allowlisted operation, and the operation-specific `input`. Every
actor includes the durable EVE `turnId`; Convex uses that identifier to
deduplicate repeated quota-consumption attempts made by tool calls in the same
turn.

Read operations:

- `describe_table`
- `list_records` (maximum 50 rows and 20 projected fields)
- `summarize_table` (server-computed summaries for at most 10 fields)
- `inspect_form`
- `form_analytics` (aggregate metrics only, maximum 90 days)

Write operations:

- `create_record`
- `update_record`
- `delete_record`
- `create_field`
- `delete_field`
- `create_form`
- `update_form_settings`

There is deliberately no generic mutation operation. Reject any operation outside this allowlist and validate that the base, table, record, field, or form belongs to `scope.organizationId`.

Every write carries:

```json
{
  "idempotencyKey": "eve:<sessionId>:<toolCallId>",
  "payloadHash": "<sha256>",
  "actor": {
    "userId": "user_...",
    "sessionId": "...",
    "turnId": "...",
    "callId": "..."
  }
}
```

Dispatch each accepted write to one `internalMutation`. In that single transaction:

1. Recheck organization ownership and the exact operation allowlist.
2. Look up a receipt using an index on organization ID plus idempotency key.
3. If a receipt exists with the same payload hash, return the stored result as `status: "replayed"`.
4. If the key exists with a different hash, reject it as an idempotency conflict.
5. Require and compare `expectedVersion` for record updates, record deletions, field deletions, and form-setting updates, plus the exact before values supplied in the proposed diff.
6. Apply the mutation, insert the immutable audit record, and insert the receipt atomically.

HTTP actions are not automatically retried. EVE or the network can replay a request, which is why the receipt is required.

Attachment cells returned to the agent expose only a count keyed by the requested field ID:

```json
{
  "attachmentCounts": {
    "field_...": 2
  }
}
```

Never return attachment IDs, storage IDs, file names, URLs, or contents through an assistant read. Attachment fields are not writable through the assistant record tools.

## Session ownership endpoint

`EVE_SESSION_OWNERSHIP_URL` receives one of:

```json
{
  "version": 1,
  "kind": "session-ownership",
  "input": {
    "action": "register",
    "sessionId": "...",
    "continuationTokenHash": "<64 lowercase hex characters>",
    "organizationId": "org_...",
    "userId": "user_..."
  }
}
```

```json
{
  "version": 1,
  "kind": "session-ownership",
  "input": {
    "action": "assert",
    "sessionId": "...",
    "organizationId": "org_...",
    "userId": "user_..."
  }
}
```

The reset route is keyed by EVE's continuation token rather than a session ID. The channel hashes that capability locally and sends only its SHA-256 digest:

```json
{
  "version": 1,
  "kind": "session-ownership",
  "input": {
    "action": "assert-continuation",
    "continuationTokenHash": "<64 lowercase hex characters>",
    "organizationId": "org_...",
    "userId": "user_..."
  }
}
```

`register` must be insert-only: an existing session ID or continuation-token hash may be accepted only when both resolve to the same owner and the same pair. Store only the hash, never the raw continuation token. `assert` and `assert-continuation` return `{ "ok": true, "data": { "allowed": true } }` only for an exact match and otherwise return 403. The EVE channel performs these checks before continuation, input response, cancellation, reset, or stream access. A `session.started` hook registers new sessions and fails closed when either the continuation token or ownership persistence is unavailable.

Keep this endpoint server-to-server. It is not a replacement for Clerk authentication; it is the per-session ACL that EVE route auth intentionally does not provide.
