# Security policy

## Supported versions

Until Basecraft publishes tagged releases, security fixes are made only on the
latest revision of the default branch. Older snapshots and forks are not
maintained by this repository.

## Report a vulnerability privately

Do not open a public issue for a suspected vulnerability. Use
[GitHub private vulnerability reporting](https://github.com/sonnysangha/airtable-clone-demo/security/advisories/new)
and include:

- the affected route, component, or workflow;
- the development-only steps needed to reproduce the issue;
- the security impact and affected tenant boundary;
- any suggested mitigation; and
- whether you believe credentials or personal data were exposed.

Do not include live API keys, session tokens, customer data, uploaded files, or
production database contents. Reproduce the issue with development instances
and synthetic data whenever possible.

If private vulnerability reporting is unavailable, open a public issue asking
the maintainers to establish a private contact channel. Do not include
vulnerability details in that issue.

## High-impact areas

Reports are especially useful when they concern:

- cross-organization or cross-user data access;
- Clerk authentication, organization membership, roles, or billing checks;
- public form submission, attachment access, or Turnstile enforcement;
- Convex authorization, storage URLs, rate limits, or tenant-scoped indexes;
- EVE session ownership, tool authorization, approval bypasses, replay
  protection, or signed bridge requests; and
- accidental exposure of environment variables, deployment keys, or user data.

## Responsible testing

Test only against accounts, organizations, and deployments you control. Do not
degrade the service, access another tenant, submit harmful files, or use
automated scanning against a public deployment without written permission.

Good-faith reports that follow this policy will be handled as security research,
not abuse. This policy does not promise a bounty or a specific response time.
