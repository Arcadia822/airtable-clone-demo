# Basecraft architecture

The upstream demo ran on Convex, Clerk, and EVE; that stack has been removed, and this document describes the shipped code.

## Trust boundaries

- The browser is untrusted. `getServerSession()` and `requireSession()` in `src/server/auth.ts` derive `userId` and `orgId`; client input never selects an organization. Service queries filter by `session.orgId`.
- Auth fails closed. A production deployment (`NODE_ENV=production` or any `VERCEL_ENV`) with no Factory visitor credentials and no `ALLOW_LOCAL_WORKSPACE=1` answers `503 AUTH_NOT_CONFIGURED` from every authenticated route instead of minting a local session.
- Workspace API routes call `requireSession`. The unauthenticated surfaces are `/api/auth/*`, `/api/public/forms/*`, `/f/[slug]`, the `publicFormSlug` branch of the attachment session/upload/finalize routes, and `/api/files/[attachmentId]` when a published form for the attachment's table grants read access.
- Every cookie-authenticated mutation, plus the JSON `POST` records query, calls `requireSameOrigin` (`src/server/http.ts`) before touching data. It accepts an `Origin` that matches the deployment origin or the concrete request host, rejects `Sec-Fetch-Site: same-site`, and treats a request with neither header as a non-browser client.
- Public submit, metric, and upload endpoints are rate limited per IP and form with a fixed window (10, 60, and 20 requests per minute), and verify a Cloudflare Turnstile token when `TURNSTILE_SECRET_KEY` is set.
- Public form reads and submissions resolve only the current published version. Answers are accepted only for field ids that version maps; hidden questions are ignored, and an answer for a column archived after publishing is refused by question id instead of dropped.
- Anonymous uploads use a 15-minute session bound to the published form's table. Finalization verifies the storage key belongs to the session and moves the chunks; authenticated sessions default to one hour.
- AI credentials are read server-side from the environment. Model output is never executed as code or SQL: writes become a proposal carrying a server-issued, single-use ticket that a signed-in member must approve through `/api/ai/tools/write`.

## Data model

The hierarchy is `bases` → `tables` → `fields` and `records`; `views` belong to a table, and `forms` target one table. Workspace rows carry `orgId`; child rows such as `field_sequences` and `attachment_chunks` inherit it through their parent. Active rows use `status = "active"`, and deletion is archival.

User columns are metadata, not schema. `fields` stores `name`, `type`, `config` (JSONB), `rank`, `width`, `isPrimary`, and `frozen`; `records.values` is a JSONB object keyed by field id. Adding, renaming, retyping, or archiving a column writes only these rows and never runs DDL. `rank` is a fractional string index ordering bases, tables, fields, records, views, and per-view fields.

`records` also stores `revision`, `createdBy`/`updatedBy`, and `searchText`. A cell or record write is a single compare-and-swap statement: `UPDATE … SET revision = revision + 1 … WHERE id = … AND revision = <expected>` with `RETURNING`. A stale client (someone else already bumped the revision) updates zero rows and gets `REVISION_CONFLICT` naming the expected and actual revision, so no write can silently overwrite a newer edit. Sequences, ranks, and cascades allocate inside the same transaction as the row they support, with transaction-scoped advisory locks where relative order matters. `buildRecordSearchText` (`src/server/search-text.ts`) flattens values plus field configuration — select option labels, currency renderings, attachment names — into lowercase `searchText`. Record writes, field archive/restore, auto-number backfill, and select-label edits rebuild it; record search queries it with `position()`, while workspace name search uses `ILIKE`.

`field_sequences` (`fieldId` primary key, `tableId`, `nextValue`) backs `autoNumber` fields. The row is created with the field, allocated by every record-creating path, and rebuilt in rank order when an auto-number column is added or restored.

`drizzle/schema.ts` and the committed SQL in `drizzle/` are the only schema authority. There is no per-workspace DDL.

## Attachments

- `attachments` is metadata: `tableId`, optional `recordId`/`fieldId`, `name`, `mimeType`, `size`, `storageKey`, and `status`. Bytes live in `attachment_chunks` as 1 MiB `bytea` rows keyed by `(attachment_id, seq)`; `attachment_blobs` records total size and chunk count.
- Upload flow: `POST /api/attachments/session` → `POST /api/attachments/upload/[sessionId]` (stores the body as 1 MiB chunks) → `POST /api/attachments/finalize`. Finalize verifies the storage key, moves the chunk rows to the new attachment id, writes `attachment_blobs`, and consumes the session in one transaction.
- `src/server/storage/` hides the backend. `PostgresAttachmentStorage` is the default and the only durable option on a Worker; `ATTACHMENT_STORAGE=fs` dynamically loads a filesystem adapter for local debugging.
- Limits are 25 MB per file (`MAX_FILE_BYTES`), 10 attachments per cell, and one file for an image cell. The body is counted while streaming and cancelled past the cap; the declared `Content-Length` is only a hint.
- The stored MIME type is authoritatively sniffed from the file's leading bytes (`sniffMimeType`/`resolveUploadMimeType`). SVG, HTML, and XML are rejected outright; a recognized raster, PDF, or ZIP signature wins over the declared type; anything else is stored and served as `application/octet-stream`, always as a download with `X-Content-Type-Options: nosniff`.
- `POST /api/attachments/session` opportunistically purges expired sessions and the chunk rows they left behind, so abandoned uploads cannot accumulate without a scheduled job.

## Views and dashboards

A `views` row stores `type`, `visibility`, `isDefault`, `filterConjunction`, `filters`/`sorts`/`groups` (JSONB), and `configuration` (JSONB). `view_field_configs` stores per-view `hidden`, `frozen`, `width`, `rank`, and `formatting`, unique on `(viewId, fieldId)`.

Six types ship: `grid`, `kanban`, `timeline`, `calendar`, `gallery`, and `dashboard` (`VIEW_TYPES` in `src/lib/domain.ts`). `validateViewConfiguration` (`src/server/services/views.ts`) enforces each type's required columns; dashboard widgets live in `configuration.dashboardWidgets` as at most 12 `metric` or `chart` entries with an optional `aggregate` and, for charts, a `groupByFieldId`.

Filtering, sorting, and grouping have one implementation in `src/lib/view-processing.ts` (`processSavedView`). `queryRecords` applies it server-side after a `searchText` prefilter, and the grid uses the same semantics client-side. Records are never materialized per view.

## Forms

A form belongs to one base and one table. `form_draft_fields` holds editable questions mapped to `targetFieldId`; `generateFormDraft` (`src/server/services/forms.ts`) builds questions from eligible columns and skips read-only types (`autoNumber`, `createdTime`, `createdBy`).

Publishing validates that every mapped column still exists and is writable, then inserts an immutable `form_versions` row plus `form_version_fields` snapshots (label, type, config, requirement, visibility rules) and points `forms.publishedVersionId` at it. The version row, its snapshot fields, and the pointer are written in one transaction under a `SELECT … FOR UPDATE` on the form row, so concurrent publishes serialise and a unique index on `(formId, versionNumber)` backstops any writer that bypasses the lock. A rejected publish leaves no version row and no pointer. The draft can keep changing; the published version does not.

Deleting a form archives it: `forms.archived_at` is set, every form read and write filters it out, and `/f/[slug]` plus `/api/public/forms/[slug]` answer 404 while versions, submissions, and their records stay recoverable. A hard delete used to erase all three.

`/f/[slug]` and `/api/public/forms/[slug]` resolve only the current `publishedVersionId`. Submission runs in one transaction under the same form-row lock: the idempotency check, the per-respondent check, auto-number allocation, the record insert, the `form_submissions` receipt, and the analytics bucket all commit or roll back together, so a rejected submission never burns a sequence number or leaves an orphan record. A retry that carries the same `Idempotency-Key` (header or `submissionKey`) returns the original submission; a form with `allowMultipleSubmissions: false` keys "the same person" on a hash of form id, client address, and user agent, which the route passes in because only the transport knows them. Answers for a column archived after publishing are refused by question id. `form_metric_buckets` stores daily `view`, `start`, and `submission` counters, unique per form, day, metric, and breakdown, so concurrent events count once.

## Authentication

`src/server/auth.ts` uses the Factory visitor-auth service when `FACTORY_VISITOR_AUTH_URL` and `FACTORY_VISITOR_AUTH_TOKEN` are set. It calls `GET /session` with a bearer token and `x-factory-visitor-origin`, and forwards cookies opaquely. `/api/auth/login` and `/register` POST `/authorize` with a random state cookie; `/api/auth/callback` verifies state and POSTs `/exchange`, forwarding `Set-Cookie`; `/api/auth/logout` proxies `/logout`.

With either variable missing, `getServerSession` returns the local single-tenant workspace (`local-user`, `local-org`, `authMode: "local"`) only when local mode is allowed: `NODE_ENV !== "production"` with no `VERCEL_ENV`, or `ALLOW_LOCAL_WORKSPACE=1`. On any other deployment the session is `unauthenticated`, `requireSession` answers `503 AUTH_NOT_CONFIGURED`, and the login/logout routes no-op. Session cookie names are chosen once per deployment from the configured origin — the `__Host-` prefix only over https, plain names over http, because browsers would silently drop a `__Host-` cookie that is not `Secure`. There is one `orgId` per deployment: no memberships, roles, or billing. `FACTORY_PREVIEW_HOST` supplies the origin sent to visitor auth on preview deployments.

## AI assistant

`POST /api/ai/chat` is a Node route that streams SSE events: `delta`, `tool_result`, `chart`, `citations`, `proposal`, `done`, and `error`. It requires a session and accepts `{ requestId, messages, context }`.

`src/server/ai/gateway.ts` calls Factory `app-ai` at `FACTORY_APP_AI_URL` with `FACTORY_APP_AI_TOKEN`. `LLM_GATEWAY_BASE_URL`/`API_KEY`/`MODEL` is an opt-in OpenAI-compatible fallback used only when the Factory URL is empty. Missing credentials produce an `ai-unavailable` error event rather than a fabricated answer.

Read tools in `src/server/ai/tools.ts` run in-process against Drizzle, scoped to the session organization: `describe_table`, `list_records` (bounded pages), `summarize_table`, `inspect_form`, and `form_analytics`. The same tools are exposed at `/api/ai/tools/read`. For write intent the model returns a schema-constrained action; `buildWriteProposal` validates it and emits a `proposal` with diff and warnings without touching data.

An approval is a server-issued ticket, not a client-supplied instruction. When the chat route emits a proposal it calls `issueWriteProposalToken`, which stores an `ai_write_proposals` row — org, user, operation, a SHA-256 of the canonical (key-sorted) input, and a 15-minute expiry — and returns an opaque `awp_…` id that travels inside the proposal event. Approval POSTs `{ operation, input, token }` to `/api/ai/tools/write`; `consumeWriteProposalToken` runs one `UPDATE … SET consumed_at = now() … RETURNING input` filtered on every binding, so a token cannot be replayed, cannot be swapped to another operation or input, cannot cross an organization or user, and cannot outlive its TTL. The stored input is what `executeApprovedWrite` applies, never the client's copy. Issuing a token also deletes up to 50 expired rows, best effort, so the table does not grow without a scheduler. Operations are `create_table`, `create_record`, `update_record`, `delete_record`, `create_field`, `delete_field`, `create_form`, `update_form_settings`, and `create_view`.

`ai_reports` persists analysis reports with citations and optional chart configuration; `/api/ai/reports` serves them.

## Deployment

- `src/db/client.ts` picks a driver from `DATABASE_URL` behind one driver-agnostic `AppDb` type, and imports each driver at runtime so a Worker bundle never pulls in `pg` or the PGlite WASM build: PGlite for `pglite:` URLs (and the default), Neon serverless for `*.neon.tech`, node-postgres otherwise.
- Neon uses `@neondatabase/serverless` over WebSockets (`drizzle-orm/neon-serverless`), not the HTTP driver: `neon-http` cannot run transactions at all, and every multi-row write in this app is one. The WebSocket transport works in Node 22+ and in Workers, and a failed connect is not cached, so the next request retries.
- Local: with no `DATABASE_URL`, the app uses PGlite at `.data/pglite`. `getDb()` applies the committed migrations from `drizzle/` once per process, and the first base listing seeds the demo workspace. Runtime migration is PGlite-only, so run `pnpm db:migrate` before serving Postgres or Neon. `drizzle/` is authoritative; a host that rejects a non-empty baseline needs an explicit baseline step.
- Factory previews receive a Neon `preview/<branch>` database branch and an injected `DATABASE_URL`.
- Publish builds the repository with the platform's pinned Next.js 16.4.1 and OpenNext 1.20.15 toolchain into a Cloudflare Worker. The Worker filesystem is read-only, which is why attachment bytes default to Postgres and why only the Neon driver is reachable there.
- `next.config.ts` sends baseline security headers on every route: `nosniff`, `X-Frame-Options: DENY`, a referrer policy, a restrictive permissions policy, and a CSP whose only cross-origin allowances are the Turnstile script and frame. `script-src` still permits inline scripts because the app does not run nonce-aware middleware.
- `pnpm build` and `pnpm start` run the same app locally. CI (`.github/workflows/ci.yml`) runs lint, typecheck, Vitest, the production build, and Playwright; the Playwright `webServer` sets `ALLOW_LOCAL_WORKSPACE=1` because `next start` is a production build and auth fails closed otherwise.

## Known limits

- Attachment bytes live in Postgres with a 25 MB per-file cap; there is no S3/R2 adapter, and a large store grows the database.
- The table page is client-fetch: it renders a shell and loads records from `/api/tables/[tableId]/records/query`, so first paint is a loading state.
- UI copy and seeded records are English-only; search is CJK-aware.
- One tenant per deployment: no workspaces, roles, or billing.
- PGlite is single-process; several app instances must not share one embedded directory.
- AI streaming and approvals are not verified against live Factory credentials in this repository.
- The rate limiter is per process: N replicas allow roughly N times the stated budget. Turnstile is the per-visitor control and the platform proxy is the outer bound.
- Per-person form dedupe hashes address plus user agent, so two people behind one NAT and one browser are indistinguishable. Stronger identity would need a question the form owner controls.
- Cookie-authenticated writes are origin-checked rather than CSRF-token-checked; a request that omits both `Origin` and `Sec-Fetch-Site` is treated as a non-browser client.
- Expired AI proposals are pruned only when a new one is issued, so an idle deployment keeps its last expired rows.
- Archived forms, fields, and records keep their rows forever; nothing compacts or purges them.
