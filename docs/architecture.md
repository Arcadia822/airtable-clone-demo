# Basecraft architecture

## Trust boundaries

Clerk authenticates users, owns organization memberships and roles, and is the
only billing authority. Convex stores application data and derives the active
organization, user, role, plans, and features from the verified Clerk identity.
Client arguments never select an organization.

Anonymous public form submissions have no Clerk session. A server-only action
resolves the form owner, checks the current Clerk organization subscription on
demand, validates Turnstile, and invokes one internal Convex transaction.
Public reads and submission starts share a bounded 30-second in-memory Clerk
lookup cache; the final commit always fetches fresh entitlements. The
short-lived submission session records only its start-time quota class so file
uploads do not call Clerk once per file. These checks deliberately fail closed
when Clerk Billing is unavailable; no durable subscription state is mirrored
into Convex.

## Data model

The hierarchy is:

```text
Clerk organization
└── base
    ├── table
    │   ├── field definitions
    │   ├── record documents
    │   └── saved views
    │       └── per-view field presentation
    └── forms
        ├── editable draft questions
        ├── immutable published versions
        └── submissions
```

Each record is one Convex document whose `values` map is keyed by stable field
IDs. One-document rows keep realtime pages bounded and make a form submission
atomic. All semantic validation is field-aware on the server. Fractional string
ranks order bases, tables, fields, rows, views, and per-view field presentation
without a shared counter hotspot.

The checked-in `convex/_generated` bootstrap files allow the repository to
compile before a deployment is linked. They are not generated-schema or
deployment proof. An authenticated `convex dev` or `convex deploy` run must
replace them with deployment-generated contracts before production validation.

Every tenant document repeats the Clerk organization ID and has a compound
index that starts with its parent and active/deleted status. Queries use
indexes and pagination; unbounded `collect()` and per-cell subscriptions are
not permitted.

## Realtime editing

The grid subscribes once to the field list and once to paginated rows. It
virtualizes visible rows with TanStack Table and TanStack Virtual, and renders
only the frozen columns plus the horizontally visible column window. The
windowing helpers keep logical selection and keyboard navigation independent
from which rows and columns are mounted.
Human edits target one cell; Convex optimistic concurrency retries preserve
different-cell edits on the same row. The latest committed edit wins for the
same cell.

Views with filters, sorts, or groups use a versioned server-side
materialization. Bounded jobs scan the whole table, catch up from a per-table
change log, and atomically make a completed generation active. Pages therefore
remain correctly filtered and ordered beyond the first 100 records, while the
client shows a named preparation state during a rebuild. Record, attachment,
form-submission, and approved AI writes all append to the same bounded change
path. A previous same-view snapshot can finish an already-running subscription
during the brief invalidation race, but the status subscription keeps it hidden
until the current generation is ready.

EVE record updates/deletions and field deletions include an expected revision.
A stale proposal fails instead of overwriting newer human work.

## Form publishing and files

A form targets one table. Draft questions map to stable field IDs. Publishing
validates every mapping and creates immutable form-version and question
snapshots. Public submissions target only the currently published version and
create one record plus one submission receipt atomically.

New public links are generated from the form's readable name, with numeric
suffixes for collisions. A bounded migration replaces legacy links containing
internal or random values and stores the old address as an alias, so an
already-shared link still resolves and is then canonicalized in the browser.

Attachments use a staged upload session:

1. create a short-lived upload session;
2. upload directly to Convex storage;
3. finalize verified metadata and reserve quota;
4. claim the attachment in a record or form submission;
5. delete expired, unclaimed blobs in bounded scheduled work;
6. sweep the `_storage` system table with a persistent cursor so raw uploads
   abandoned before finalization are also reclaimed after a safety window.

Only authorized calls receive generated bearer URLs. Raw storage IDs and URLs
never enter EVE.

## Analytics and AI

Form analytics stores sharded daily counters for views, starts, validation
failures, successful submissions, and best-effort exits. Device and traffic
reports use coarse categories calculated in the browser; raw screen details,
referrer URLs, and user agents are never sent. Question-exit counters retain
only the immutable published-question reference needed to show its name and
never include an answer or file.

Each form locks an IANA analytics timezone when it is first published. Public
events and submissions derive their reporting day from that server-owned
timezone, and report ranges use timezone- and daylight-saving-aware local
midnights. Legacy published forms remain on UTC so existing daily counters are
never silently reinterpreted.

Opaque first-party visitor IDs are HMACed per form and day for best-effort
deduplication. Those daily matching rows are removed after 100 days in bounded
batches. Aggregate counters remain available with the form, including after it
is closed or archived. Raw events, IPs, referrer URLs, user agents, cookies,
form values, and attachment metadata are not analytics data. Reports read a
maximum 90-day range, use bounded samples for answer and question-exit
summaries, and clearly disclose when a sample limit applies.

The EVE assistant uses bounded tools to describe schema, page or sample rows,
calculate labelled summaries, and inspect form analytics. Mutating tools are
granular and always require approval. The executor derives identity from the
current EVE session and signs the method, route, timestamp, one-time nonce, and
exact command body. Every turn is metered once by durable `turnId`; repeated
tool calls in that turn deduplicate. Writes use `eve:<sessionId>:<callId>` for
idempotency. Convex applies the write, audit event, and command receipt in one
transaction.
