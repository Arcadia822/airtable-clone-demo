# Basecraft

Basecraft is an Airtable-style B2B workspace built with Next.js, Clerk
Organizations and Billing, Convex, shadcn Base UI, and Vercel EVE.

It includes:

- organization-scoped bases, tables, fields, and realtime records;
- typed fields, select options, image/file attachments, and soft deletion;
- multiple public forms with a named “Save answers in” column picker;
- immutable form publishing, custom confirmation copy, and privacy-first analytics;
- a custom Clerk organization pricing experience for Free, Starter, and Pro;
- a Pro-only EVE assistant with bounded reads and human-approved writes;
- an interactive `/demo` experience that works before cloud credentials are connected.

![Basecraft demo workspace](docs/assets/basecraft-demo.png)

## Verified stack

The dependency set was verified against live package data on 31 July 2026 and is
locked by `pnpm-lock.yaml`:

- Next.js 16.2.12 and React 19.2.8
- Clerk Next.js 7.6.3, Clerk.js 6.25.12, and Clerk Backend 3.14.0
- Convex 1.42.3
- EVE 0.27.13 and AI SDK 7.0.42
- Tailwind CSS 4.3.3 and shadcn CLI 4.16.0

Node.js 24 or newer and pnpm 11 are required.

## Try the credential-free demo

```bash
pnpm install
pnpm dev:next
```

Open `http://localhost:3000/demo`. This starts only the Next.js app and uses
local fixture data, so Clerk, Convex, Billing, Turnstile, and EVE credentials
are not required. The demo is explicitly labelled for design and browser QA;
it is not evidence of a connected deployment.

After Clerk and Convex are linked and the development deployment contains the
EVE HMAC secret, run the full connected development stack:

```bash
pnpm dev
```

The connected launcher requires `NEXT_PUBLIC_CONVEX_SITE_URL`, derives both EVE
HTTP endpoints from it, and securely reads the shared HMAC secret from
the linked Convex development deployment. This keeps the secret out of local
files while ensuring session ownership and the assistant bridge are configured
before EVE starts. The browser uses the alternate loopback hostname for local
EVE requests, so Clerk cookies are not attached to assistant requests and
cannot overflow request headers.

## Connect Clerk

1. Authenticate and link a Clerk development instance:

   ```bash
   clerk auth login
   ```

2. Enable Organizations, require organization membership, and hide personal
   accounts.
3. Enable Clerk Billing for organizations and configure:

   - Free: 2 seats.
   - Starter: $19/month including 3 seats, then $5/seat; $190/year, then
     $50/seat; maximum 10 seats.
   - Pro: $59/month including 5 seats, then $10/seat; $590/year, then
     $100/seat; maximum 20 seats.

4. Add feature slugs `form_analytics`, `custom_form_branding`, and
   `ai_assistant`. Starter receives the first two; Pro receives all three.
5. Activate Clerk's modern Convex integration. The Clerk CLI can apply the
   required audience claim directly to the default session token:

   ```bash
   clerk config patch \
     --app app_yourClerkApplicationId \
     --instance dev \
     --json '{"session":{"claims":{"aud":"convex"}}}' \
     --yes
   ```

   Verify it with `clerk config pull --instance dev --keys session`. The
   resulting `session.claims.aud` must be `convex`. The equivalent Dashboard
   flow is **Integrations → Convex → Activate Convex integration**.
6. Copy the Clerk publishable and secret keys into `.env.local`, then copy the
   Clerk issuer shown by the integration to `CLERK_JWT_ISSUER_DOMAIN` in the
   matching Convex deployment.

Clerk remains the source of truth. There is no user, organization, membership,
plan, or subscription mirror and no billing webhook. The app reads current
Clerk session claims, uses Clerk's `has()` checks and billing hooks where
appropriate, and asks Clerk directly for anonymous form entitlement checks.

Do not create the legacy custom `convex` JWT template. Custom JWT templates
cannot include the session-bound `pla` and `fea` billing claims used here;
Clerk's current Convex integration and default session token are required.

## Connect Convex

The Convex CLI is installed as a project dependency:

```bash
pnpm exec convex dev
```

Authenticate when prompted and create or select the development deployment.
The CLI writes `CONVEX_DEPLOYMENT`, `NEXT_PUBLIC_CONVEX_URL`, and
`NEXT_PUBLIC_CONVEX_SITE_URL` locally. Set server-side values separately in the
Convex deployment, for example:

```bash
pnpm exec convex env set CLERK_JWT_ISSUER_DOMAIN https://example.clerk.accounts.dev
```

Use the real issuer displayed by Clerk, without a trailing slash. Repeat the
setup with separate Clerk and Convex instances for production.

The repository includes bootstrap files under `convex/_generated` so a
credential-free checkout can compile. They are not generated-schema or
deployment proof. An authenticated `convex dev` or `convex deploy` must replace
them, after which lint, typecheck, tests, and the production build must be run
again.

## Apply data migrations

After the current Convex functions are available, run the bounded, idempotent
migration chain once for each deployment:

```bash
pnpm exec convex run migrations:runAll
```

It creates default views and per-view column settings for older tables,
prepares full-table saved-view results, and replaces legacy public-form links
that exposed internal or random values. Previously shared form links remain
valid as aliases and the public page replaces the browser address with the new
readable link. Rerunning the command is safe. Use the Convex CLI's `--prod`
flag only after selecting and verifying the intended production deployment.

## Load the demo workspace

Signed-in organization admins can choose **Load demo workspace** from the empty
dashboard. The app creates one Free-compatible Product Operations base with
three tables, representative typed fields, realistic records, a published
feedback form, and 14 days of sample analytics.

Deployment admins can seed the same data from the terminal after the current
Convex functions have been pushed:

```bash
pnpm seed:demo
```

The command reads Clerk access from `.env.local`, targets the linked development
deployment, and shows an interactive numbered list of organization names. For
automation, pass a readable name such as
`--organization "Acme Studio"`. Optionally use
`--creator-email admin@acme.example` to attribute seeded rows to an existing
organization member. No Clerk IDs need to be found or pasted. Use
`pnpm seed:demo -- --help` for local and production options.

The seed is atomic and idempotent per organization. Rerunning it never
duplicates the workspace, even after users rename it. If the demo base is in
the trash, the in-app action restores it. The terminal wrapper is a privileged
deployment-admin convenience, applies Free-plan limits, and does not replace
Clerk membership verification. Production requires both `--prod` and
`--confirm-production`. Directly deleting seeded documents in the Convex
dashboard is outside the supported reset flow; a missing install is reported
for deployment-admin repair rather than duplicated.

## Environment ownership

`.env.local` configures the local Next.js and EVE processes; it does not upload
secrets to Convex. Configure each variable in the runtime that reads it:

| Runtime | Variables |
| --- | --- |
| Next.js / Vercel web | `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_EVE_HOST`, Clerk publishable/secret keys and route variables, `NEXT_PUBLIC_CONVEX_URL`, `NEXT_PUBLIC_TURNSTILE_SITE_KEY` |
| EVE service on Vercel | `AI_GATEWAY_API_KEY` or Vercel OIDC, Clerk publishable/secret keys, `CLERK_AI_FEATURE`, `EVE_ALLOWED_ORIGINS`, both EVE Convex endpoint URLs, and the HMAC secret/key ID |
| Convex deployment | `CLERK_JWT_ISSUER_DOMAIN`, `CLERK_SECRET_KEY`, `TURNSTILE_SECRET_KEY`, `TURNSTILE_EXPECTED_HOSTNAME`, `FORM_ANALYTICS_HASH_SALT`, and the same EVE HMAC secret/key ID |
| Vercel build environment | `CONVEX_DEPLOY_KEY`, scoped to the Convex deployment being released |

The two EVE endpoint variables point at the deployment's
`NEXT_PUBLIC_CONVEX_SITE_URL`, ending in `/eve/assistant` and
`/eve/session-ownership`. Shared HMAC values must match exactly in Vercel and
Convex. Store secrets in the Vercel and Convex dashboards (or `convex env set`);
never expose them with a `NEXT_PUBLIC_` prefix.

## Configure Turnstile

Create a Cloudflare Turnstile widget whose allowed hostnames match the public
form host. Set its site key in the web runtime and its secret in Convex.
`TURNSTILE_EXPECTED_HOSTNAME=localhost` is only for local development.

For production, set the exact production hostname in both Cloudflare and the
production Convex deployment. For previews, use a stable preview domain and a
separate preview Turnstile/Convex configuration, or update the preview
deployment's expected hostname to the exact preview host. Arbitrary changing
preview URLs should not share the production hostname check.

## Connect EVE and deploy

For local AI runs, set `AI_GATEWAY_API_KEY`. Vercel deployments can use project
OIDC. Configure the runtime values listed above, then validate the generated
EVE service:

```bash
pnpm exec eve build
```

Use `pnpm build` for the supported Webpack production build. The unflagged
Turbopack build remains available as
`pnpm build:experimental:turbopack` for diagnostics.

For Vercel, set the project's Build Command to `pnpm convex:deploy` and add the
deployment-scoped `CONVEX_DEPLOY_KEY`. That script runs
`convex deploy --cmd 'pnpm build'`, deploying Convex before the Next.js build.
After the project is linked and its environment is configured, deploy with:

```bash
pnpm exec eve deploy
```

EVE is a preview framework. Every write tool uses per-call approval,
organization/user session ownership checks, expected record revisions, and an
idempotent HMAC-signed Convex bridge.

## Browser tests

Install Playwright's Chromium browser once, then run the credential-free suite:

```bash
pnpm exec playwright install chromium
pnpm test:e2e
```

This command starts `pnpm dev:next` and runs only the public desktop and
responsive projects. It does not authenticate with Clerk or select a Convex
deployment.

The connected browser suite is a separate, explicitly mutating workflow. It can
create and update bases, tables, columns, records, views, forms, submissions,
and EVE sessions. Point it only at a dedicated disposable Clerk development
organization and matching Convex development deployment—never production. Add
the organization name and connected credentials to `.env.local`:

```dotenv
E2E_CLERK_ORGANIZATION_NAME="Basecraft E2E"
```

After the connected setup in this README is complete, run:

```bash
pnpm test:e2e:connected
```

The connected runner refuses to start until
`E2E_CLERK_ORGANIZATION_NAME` is explicitly set.

## Quality commands

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm build
# Optional diagnostic:
pnpm build:experimental:turbopack
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the pull-request checklist and
[SECURITY.md](SECURITY.md) for private vulnerability reporting.

## Product boundaries

The focused production v1 includes persisted grid, Kanban, calendar, and
gallery views; saved sorting, filtering, grouping, field layout and
favourites; recoverable field archiving; resumable populated-field conversion;
and live collaborator presence with cell-level editing indicators. Formulas,
linked records, automations, granular Airtable-style roles, comments, mentions,
and notifications remain outside this release.
