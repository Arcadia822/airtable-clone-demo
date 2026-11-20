# Basecraft architecture

The upstream demo ran on Convex, Clerk, and EVE; that stack has been removed, and this document describes the shipped code.

## Trust boundaries

- The browser is untrusted. `getServerSession()` and `requireSession()` in `src/server/auth.ts` derive `userId` and `orgId`; client input never selects an organization. Service queries filter by `session.orgId`.
- Workspace API routes call `requireSession`. The unauthenticated surfaces are `/api/auth/*`, `/api/public/forms/*`, `/f/[slug]`, the `publicFormSlug` branch of the attachment session/upload/finalize routes, and `/api/files/[attachmentId]` when a published form for the attachment's table grants read access.
- Public form reads and submissions resolve only the current published version. Answers are accepted only for field ids that version maps; hidden questions are ignored.
- Anonymous uploads use a 15-minute session bound to the published form's table. Finalization verifies the storage key belongs to the session and moves the chunks; authenticated sessions default to one hour.
- AI credentials are read server-side from the environment. Model output is never executed as code or SQL: writes become a proposal that a signed-in member must approve through `/api/ai/tools/write`.

## Data model

The hierarchy is `bases` → `tables` → `fields` and `records`; `views` belong to a table, and `forms` target one table. Workspace rows carry `orgId`; child rows such as `field_sequences` and `attachment_chunks` inherit it through their parent. Active rows use `status = "active"`, and deletion is archival.

User columns are metadata, not schema. `fields` stores `name`, `type`, `config` (JSONB), `rank`, `width`, `isPrimary`, and `frozen`; `records.values` is a JSONB object keyed by field id. Adding, renaming, retyping, or archiving a column writes only these rows and never runs DDL. `rank` is a fractional string index ordering bases, tables, fields, records, views, and per-view fields.

`records` also stores `revision` (optimistic concurrency through optional `expectedRevision`), `createdBy`/`updatedBy`, and `searchText`. `buildRecordSearchText` (`src/server/search-text.ts`) flattens values plus field configuration — select option labels, currency renderings, attachment names — into lowercase `searchText`. Record writes, field archive/restore, auto-number backfill, and select-label edits rebuild it; record search queries it with `position()`, while workspace name search uses `ILIKE`.

`field_sequences` (`fieldId` primary key, `tableId`, `nextValue`) backs `autoNumber` fields. The row is created with the field, allocated by every record-creating path, and rebuilt in rank order when an auto-number column is added or restored.

`drizzle/schema.ts` and the committed SQL in `drizzle/` are the only schema authority. There is no per-workspace DDL.

## Attachments

- `attachments` is metadata: `tableId`, optional `recordId`/`fieldId`, `name`, `mimeType`, `size`, `storageKey`, and `status`. Bytes live in `attachment_chunks` as 1 MiB `bytea` rows keyed by `(attachment_id, seq)`; `attachment_blobs` records total size and chunk count.
- Upload flow: `POST /api/attachments/session` → `POST /api/attachments/upload/[sessionId]` (stores the body as 1 MiB chunks) → `POST /api/attachments/finalize`. Finalize verifies the storage key, moves the chunk rows to the new attachment id, writes `attachment_blobs`, and consumes the session in one transaction.
- `src/server/storage/` hides the backend. `PostgresAttachmentStorage` is the default and the only durable option on a Worker; `ATTACHMENT_STORAGE=fs` dynamically loads a filesystem adapter for local debugging.
- Limits are 25 MB per file (`MAX_FILE_BYTES`), 10 attachments per cell, and one file for an image cell.

## Views and dashboards

A `views` row stores `type`, `visibility`, `isDefault`, `filterConjunction`, `filters`/`sorts`/`groups` (JSONB), and `configuration` (JSONB). `view_field_configs` stores per-view `hidden`, `frozen`, `width`, `rank`, and `formatting`, unique on `(viewId, fieldId)`.

Six types ship: `grid`, `kanban`, `timeline`, `calendar`, `gallery`, and `dashboard` (`VIEW_TYPES` in `src/lib/domain.ts`). `validateViewConfiguration` (`src/server/services/views.ts`) enforces each type's required columns; dashboard widgets live in `configuration.dashboardWidgets` as at most 12 `metric` or `chart` entries with an optional `aggregate` and, for charts, a `groupByFieldId`.

Filtering, sorting, and grouping have one implementation in `src/lib/view-processing.ts` (`processSavedView`). `queryRecords` applies it server-side after a `searchText` prefilter, and the grid uses the same semantics client-side. Records are never materialized per view.

## Forms

A form belongs to one base and one table. `form_draft_fields` holds editable questions mapped to `targetFieldId`; `generateFormDraft` (`src/server/services/forms.ts`) builds questions from eligible columns and skips read-only types (`autoNumber`, `createdTime`, `createdBy`).

Publishing validates that every mapped column still exists and is writable, then inserts an immutable `form_versions` row plus `form_version_fields` snapshots (label, type, config, requirement, visibility rules) and points `forms.publishedVersionId` at it. The draft can keep changing; the published version does not.

`/f/[slug]` and `/api/public/forms/[slug]` resolve only the current `publishedVersionId`. Submission validates answers against the snapshot, ignores hidden questions, allocates auto-numbers, rebuilds `searchText`, inserts a real `records` row, then a `form_submissions` receipt; if the receipt insert fails, the record is deleted. `form_metric_buckets` stores daily `view`, `start`, and `submission` counters by form, day, and breakdown.

## Authentication

`src/server/auth.ts` uses the Factory visitor-auth service when `FACTORY_VISITOR_AUTH_URL` and `FACTORY_VISITOR_AUTH_TOKEN` are set. It calls `GET /session` with a bearer token and `x-factory-visitor-origin`, and forwards cookies opaquely. `/api/auth/login` and `/register` POST `/authorize` with a random state cookie; `/api/auth/callback` verifies state and POSTs `/exchange`, forwarding `Set-Cookie`; `/api/auth/logout` proxies `/logout`.

With either variable missing, `getServerSession` returns the local single-tenant workspace (`local-user`, `local-org`, `authMode: "local"`), and the login/logout routes no-op. There is one `orgId` per deployment: no memberships, roles, or billing. `FACTORY_PREVIEW_HOST` supplies the origin sent to visitor auth on preview deployments.

## AI assistant

`POST /api/ai/chat` is a Node route that streams SSE events: `delta`, `tool_result`, `chart`, `citations`, `proposal`, `done`, and `error`. It requires a session and accepts `{ requestId, messages, context }`.

`src/server/ai/gateway.ts` calls Factory `app-ai` at `FACTORY_APP_AI_URL` with `FACTORY_APP_AI_TOKEN`. `LLM_GATEWAY_BASE_URL`/`API_KEY`/`MODEL` is an opt-in OpenAI-compatible fallback used only when the Factory URL is empty. Missing credentials produce an `ai-unavailable` error event rather than a fabricated answer.

Read tools in `src/server/ai/tools.ts` run in-process against Drizzle, scoped to the session organization: `describe_table`, `list_records` (bounded pages), `summarize_table`, `inspect_form`, and `form_analytics`. The same tools are exposed at `/api/ai/tools/read`. For write intent the model returns a schema-constrained action; `buildWriteProposal` validates it and emits a `proposal` with diff and warnings without touching data. Approval POSTs `{ operation, input }` to `/api/ai/tools/write`, where `executeApprovedWrite` re-validates and applies it. Operations are `create_table`, `create_record`, `update_record`, `delete_record`, `create_field`, `delete_field`, `create_form`, `update_form_settings`, and `create_view`.

`ai_reports` persists analysis reports with citations and optional chart configuration; `/api/ai/reports` serves them.

## Deployment

- Local: with no `DATABASE_URL`, the app uses PGlite at `.data/pglite`. `getDb()` applies the committed migrations from `drizzle/` once per process, and the first base listing seeds the demo workspace.
- Neon: a URL containing `neon.tech` uses the Neon HTTP driver. Runtime migration is PGlite-only, so run `pnpm db:migrate` before serving Postgres or Neon. `drizzle/` is authoritative; a host that rejects a non-empty baseline needs an explicit baseline step.
- Factory previews receive a Neon `preview/<branch>` database branch and an injected `DATABASE_URL`.
- Publish builds the repository with the platform's pinned Next.js 16.4.1 and OpenNext 1.20.15 toolchain into a Cloudflare Worker. The Worker filesystem is read-only, which is why attachment bytes default to Postgres.
- `pnpm build` and `pnpm start` run the same app locally. CI (`.github/workflows/ci.yml`) runs lint, typecheck, Vitest, the production build, and Playwright.

## Known limits

- Attachment bytes live in Postgres with a 25 MB per-file cap; there is no S3/R2 adapter, and a large store grows the database.
- The table page is client-fetch: it renders a shell and loads records from `/api/tables/[tableId]/records/query`, so first paint is a loading state.
- UI copy and seeded records are English-only; search is CJK-aware.
- One tenant per deployment: no workspaces, roles, or billing.
- PGlite is single-process; several app instances must not share one embedded directory.
- AI streaming and approvals are not verified against live Factory credentials in this repository.
