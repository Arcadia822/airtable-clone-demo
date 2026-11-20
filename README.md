# Basecraft — an Airtable-style workspace on Next.js, Postgres, and Factory

Basecraft is a working Airtable-shaped product: bases, tables, typed columns,
records with views, public forms that write straight back into a table,
workspace-wide search, file attachments, and an AI analyst that previews every
write before it touches your data.

> **Disclaimer:** Basecraft is a fictional educational project. It is not
> affiliated with, endorsed by, or connected to Airtable or its owners. The
> people, workspaces, companies, records, and form responses in the seeded data
> are synthetic. Airtable, Next.js, React, Tailwind CSS, Postgres, Neon and other
> third-party names are trademarks of their respective owners and are used only
> to identify the technologies and product category demonstrated here.

## What ships

- **Grid** — spreadsheet-grade cells with keyboard selection, range copy/paste,
  typed clipboard round-trips, column drag/resize/reorder/freeze, undo/redo,
  recoverable deletion, and row virtualization.
- **Five more views** — Kanban lanes, a Timeline ruler, a Calendar (month and
  agenda), an image-forward Gallery, and a Dashboard of metric cards and charts.
  Views persist their filters, sorts, groups, and per-view configuration.
- **Typed schema** — 15 column types including autonumber, currency, percent,
  rating, image, attachments, and date ranges, all validated on both sides.
- **Public forms** — build a form from table fields, publish an immutable
  version, share `/f/<slug>`, and see submissions land as real records.
- **Search** — one query surface over bases, tables, views, forms, and record
  content (including select labels, currency renderings, and 2-character CJK
  words) with snippets.
- **Attachments** — chunked into Postgres (1 MiB rows) so uploads survive a
  read-only runtime; the filesystem adapter exists for local debugging only.
- **AI analyst** — streaming chat over the Factory `app-ai` protocol with an
  opt-in OpenAI-compatible fallback. Reads are bounded; writes are proposed and
  require explicit approval. Without credentials the assistant says it is
  unavailable instead of inventing an answer.
- **Mobile** — below 640 px the grid becomes a card list with a record drawer.

## Stack

| Layer | Choice |
| --- | --- |
| Framework | Next.js 16.4.1 (App Router, Turbopack, React Compiler) |
| UI | React 19, Tailwind CSS v4, Base UI, TanStack Table + Virtual, Recharts |
| Data | Drizzle ORM over PGlite (local), Postgres, or Neon serverless (WebSocket) |
| Auth | Factory visitor session (`FACTORY_VISITOR_AUTH_URL/TOKEN`), or an explicitly opted-in local single-tenant mode |
| Tests | Vitest (416 unit/integration), Playwright (8 end-to-end) |

## Quick start

```bash
pnpm install
cp .env.example .env.local   # optional: nothing is required for local mode
pnpm dev                      # http://localhost:3000
```

With no `DATABASE_URL` the app runs on an embedded PGlite database at
`.data/pglite`, applies migrations from `drizzle/`, and seeds one demo base
("Product Workspace" → "Project Tracker", six records, five views, one published
form). With no Factory credentials it also runs in local single-tenant mode
(`local-org` / `local-user`), so there is no login step to click through.

Production check:

```bash
pnpm build
DATABASE_URL=pglite:.data/e2e pnpm start --port 3100
```

## Environment

Everything is optional in local development; production needs a database.

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | `pglite:<dir>` (embedded, default `.data/pglite`), a Postgres URL, or a Neon URL. Migrations apply automatically for PGlite. |
| `FACTORY_VISITOR_AUTH_URL` | Factory visitor-auth base URL. With the token, `/session` gates every page. |
| `FACTORY_VISITOR_AUTH_TOKEN` | Bearer token for the visitor-auth service. |
| `FACTORY_APP_AI_URL` | Factory `app-ai` endpoint used by the assistant. |
| `FACTORY_APP_AI_TOKEN` | Bearer token for `app-ai`. |
| `LLM_GATEWAY_BASE_URL` | Optional OpenAI-compatible endpoint used only when `FACTORY_APP_AI_URL` is empty. |
| `LLM_GATEWAY_API_KEY` | Key for that fallback gateway. |
| `LLM_GATEWAY_MODEL` | Model id for that fallback gateway. |
| `UPLOAD_DIR` | Directory for the filesystem attachment adapter (default `.data/uploads`, `ATTACHMENT_STORAGE=fs` only). |
| `ATTACHMENT_STORAGE` | `postgres` (default, durable) or `fs` (local debugging only). |
| `ALLOW_LOCAL_WORKSPACE` | `1` keeps the local single-tenant workspace on a deployed instance. Without it a production or Vercel deployment with no Factory credentials answers `503 AUTH_NOT_CONFIGURED` instead of signing everyone in locally. Local development never needs it. |
| `TURNSTILE_SECRET_KEY` | Optional Cloudflare Turnstile secret. When set, public submit, metric, and upload requests must carry a verified widget token. |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | Public half of the same Turnstile widget; set it together with the secret. |
| `NEXT_PUBLIC_APP_URL` | Absolute origin used in metadata and auth callbacks (default `http://localhost:3000`). |
| `FACTORY_PREVIEW_HOST` | Preferred origin sent to visitor auth on preview deployments. |

Attachment limits: 25 MB per file, 10 files per cell, one image per image cell,
stored as 1 MiB chunks in `attachment_chunks`/`attachment_blobs`. The stored type
is sniffed from the file's leading bytes; SVG, HTML, and XML are rejected, and
anything unrecognized is served as an `application/octet-stream` download.

## Security model

- **Auth fails closed.** A deployed instance (`NODE_ENV=production` or any
  `VERCEL_ENV`) with no Factory visitor credentials and no
  `ALLOW_LOCAL_WORKSPACE=1` refuses every authenticated request with
  `503 AUTH_NOT_CONFIGURED`. Local development is unchanged.
- **Cookie-authenticated writes check origin.** Every mutating route and the
  JSON record query assert same origin before touching data, so a cross-site
  form post cannot ride a session cookie.
- **Public surfaces are rate limited.** Submit, metric, and upload endpoints
  use a per-IP, per-form fixed window (10/min, 60/min, 20/min), and verify a
  Cloudflare Turnstile token when `TURNSTILE_SECRET_KEY` is set.
- **AI writes need a server-issued ticket.** The chat route mints an opaque
  proposal token bound to the session, operation, and input hash; the write
  route consumes it exactly once inside a 15-minute TTL and executes the input
  the server stored, never the client's copy.
- **Deletes are archives.** Forms, fields, and records are marked archived, so
  nothing a member can still be shown loses its data.

## Scripts

| Command | What it does |
| --- | --- |
| `pnpm dev` | Next dev server. |
| `pnpm build` / `pnpm start` | Production build and server. |
| `pnpm typecheck` | `tsc --noEmit`. |
| `pnpm lint` | ESLint (React Compiler rules included). |
| `pnpm test` | Vitest unit and route/service tests. |
| `pnpm test:e2e` | Playwright against `next start` — run `pnpm build` first. |
| `pnpm db:generate` / `pnpm db:migrate` | Drizzle migrations. |

The Playwright suite (`tests/e2e/workspace.spec.ts`) wipes `.data/e2e`, boots
`next start` on port 3100 with `DATABASE_URL=pglite:.data/e2e`, and runs one
worker because the tests share the seeded workspace.

## Verified locally

| Check | Result |
| --- | --- |
| `npx tsc --noEmit` | clean |
| `pnpm build` (Next 16.4.1, Turbopack) | exit 0, 5.7 s with a warm `.next` cache (a cold compile pass takes ~12.5 s) |
| `npx vitest run` | 60 files, 416 tests passed, 19.8 s |
| `npx playwright test tests/e2e/workspace.spec.ts` | 8 tests passed, 9.0 s |
| `next-server` RSS | 586 000 KB (~572 MiB) after migrations, seed, and the first table render (PGlite shares the Node heap) |

The Playwright suite runs `next start`, which is a production build, so its
`webServer` env sets `ALLOW_LOCAL_WORKSPACE=1`; without it the fail-closed auth
gate would answer `503` to every request.

## Known limitations

- **Attachments live in Postgres.** Bytes are chunked into 1 MiB rows with a
  25 MB per-file cap; there is no S3/R2 adapter yet, so a large file store grows
  the database.
- **AI is unverified in local runs.** No Factory credentials were available, so
  the verified behaviour is the honest "assistant unavailable" path; the
  streaming/approval flow is covered by unit tests against a stubbed gateway.
- **English-only UI.** Copy is English throughout; seeded demo records are
  English, though search is CJK-aware.
- **The table page is client-fetch.** The table route renders a client shell
  that fetches records from the JSON API, so first paint shows a loading state
  and the server does not stream rows.
- **Single tenant.** One `orgId` per deployment; there is no workspace or
  membership dimension, and no billing.
- **PGlite is single-process.** Concurrent writers in one process are fine, but
  do not point several instances at one embedded database directory.
- **Migration baseline is committed.** `drizzle/` is authoritative; a host that
  rejects a non-empty baseline needs an explicit baseline step.
- **Rate limits are per instance.** The fixed-window limiter lives in process
  memory, so N replicas allow roughly N times the stated budget. The platform
  proxy is the outer bound; Turnstile is the per-visitor control.
- **Respondent dedupe is heuristic.** A form set to one response per person
  keys on address plus user agent, which two people behind one NAT and one
  browser will share. Forms that need stronger identity must add a question.
- **Cookie-authenticated writes are origin-checked, not CSRF-token-checked.**
  The guard accepts a request whose `Origin` is the deployment origin (or the
  concrete request host), and rejects `Sec-Fetch-Site: same-site`, because a
  sibling subdomain is not ours to trust. A request that sends neither header
  is treated as a non-browser client, which cannot be tricked into replaying a
  victim's cookie.
- **Proposal pruning is opportunistic.** Expired AI approval rows are dropped
  in batches of 50 whenever a new proposal is issued, so a deployment that
  stops using the assistant keeps its last expired rows until it does again.

## Repository map

```
src/app/                 routes: workspace pages, /f/<slug>, /api/*
src/components/grid/     grid, cell editors, schema dialogs
src/components/views/    kanban, timeline, calendar, gallery, dashboard, mobile
src/components/forms/    form studio, public form renderer
src/components/assistant/AI dock and panel
src/server/services/     bases, tables, fields, records, views, forms, search, attachments
src/server/ai/           Factory app-ai client, tools, previews
src/server/storage/      Postgres chunk store + filesystem adapter
src/db/                  client (PGlite/Postgres/Neon) and seed
drizzle/                 schema and migrations
tests/e2e/               Playwright workspace suite
```

`docs/architecture.md` documents the shipped trust boundaries, data model,
attachment storage, views, forms, auth, AI flow, and deployment.
