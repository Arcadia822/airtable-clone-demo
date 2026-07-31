# Contributing to Basecraft

Thanks for helping improve Basecraft. Keep changes focused, test the behavior
you touch, and describe any setup or product-boundary changes in the same pull
request.

## Prerequisites

- Node.js 24 or newer
- pnpm 11
- Playwright Chromium only when running browser tests

The exact pnpm release is declared in `package.json`.

## Start without cloud credentials

```bash
pnpm install
pnpm dev:next
```

Open `http://localhost:3000/demo`. The local demo uses fixture data and does not
require Clerk, Convex, Billing, Turnstile, or EVE credentials.

Follow the connected setup in [README.md](README.md) only when your change needs
live authentication, realtime persistence, public submissions, billing, or AI.
Use development instances and synthetic data.

## Before opening a pull request

Run the credential-free checks:

```bash
pnpm lint
pnpm typecheck
pnpm exec vitest run
pnpm test:convex
pnpm build
```

`pnpm build` is the supported Webpack production build. The Turbopack build is
diagnostic and is not a required pull-request check.

For browser-facing changes:

```bash
pnpm exec playwright install chromium
pnpm test:e2e
```

The normal browser command runs only the credential-free projects. Run
`pnpm test:e2e:connected` only with a dedicated disposable Clerk organization
and matching development deployment. The connected suite mutates real
development data and must never target production.

## Project conventions

- Use pnpm; do not add npm or Yarn lockfiles.
- Keep Clerk as the source of truth for users, organizations, memberships,
  plans, and feature access.
- Derive the active organization from verified authentication, never from a
  client-selected tenant identifier.
- Keep Convex queries bounded, indexed, paginated, and organization-scoped.
- Preserve explicit approval for every EVE write.
- Keep secrets server-side and out of logs, fixtures, screenshots, issues, and
  pull requests.
- Add or update tests for behavior changes.
- Update README or architecture documentation when setup, trust boundaries, or
  product capabilities change.

When changing Convex code, read `convex/_generated/ai/guidelines.md` before
editing and regenerate deployment contracts with an authenticated Convex CLI
before treating a connected build as production evidence.

## Pull-request checklist

- [ ] The change has a clear user or maintenance outcome.
- [ ] Unrelated worktree changes are not included.
- [ ] Lint, typecheck, unit tests, Convex tests, and the Webpack build pass.
- [ ] Browser tests cover meaningful UI changes.
- [ ] Connected tests, if used, ran only against disposable development data.
- [ ] Documentation and `.env.example` match any setup changes.
- [ ] No credentials, customer data, generated reports, or local auth state are
      included.

Report vulnerabilities through [SECURITY.md](SECURITY.md), not a public issue.
