# Persistence and HTTP API

How meeting searches are stored, accepted over HTTP, and prepared for asynchronous work.

## Persistence stack

| Choice           | Detail                                                                            |
| ---------------- | --------------------------------------------------------------------------------- |
| Database         | PostgreSQL 16 + PostGIS 3.5                                                       |
| ORM / migrations | Drizzle; committed SQL under `packages/database/migrations`                       |
| Driver           | `postgres` (postgres.js) via `drizzle-orm/postgres-js`                            |
| Factory          | `createDatabase(config)` — migrate/close are explicit; no import-time connections |

PostGIS is created in the first migration before geometry columns. Schema push is not
the production path — use `pnpm db:migrate`.

### Tables

| Table                              | Purpose                                                       |
| ---------------------------------- | ------------------------------------------------------------- |
| `places`                           | Canonical cities/stations with `geometry(Point, 4326)` + GiST |
| `meeting_searches`                 | Search header (status, calendar date, local times, limits, …) |
| `meeting_search_participants`      | Ordered participants + origin FK                              |
| `meeting_search_transport_modes`   | Allowed modes (unique per search)                             |
| `meeting_search_allowed_countries` | Optional uppercase country filter (empty = unrestricted)      |
| `outbox_events`                    | Minimal transactional outbox for durable processing intent    |

Place IDs are opaque text PKs. Meeting-search IDs are UUIDs. Child rows and outbox rows
cascade when a search is deleted. Origin place FKs use `ON DELETE RESTRICT`.

### Meeting-search create transaction

One PostgreSQL transaction:

1. Verify referenced origin places (typed `PLACE_NOT_FOUND` if missing — before write).
2. Insert search, participants, transport modes, countries.
3. Insert exactly one `meeting-search.requested` outbox event.
4. Commit — only then may the API return `202`.

Unexpected driver errors are not rewritten as “place not found.”

## Transactional outbox

Unsafe flow (rejected): insert search → return `202` → hope something enqueues later.

Chosen contract:

```text
one PostgreSQL transaction
  ├── meeting-search aggregate (+ children)
  └── meeting-search.requested outbox event
then return 202 Accepted
```

Initial event:

| Field            | Value                            |
| ---------------- | -------------------------------- |
| `event_type`     | `meeting-search.requested`       |
| `aggregate_type` | `meeting-search`                 |
| `aggregate_id`   | search UUID                      |
| `schema_version` | `1`                              |
| `payload`        | `{ "searchId": "<uuid>" }` only  |
| `published_at`   | `NULL` until a dispatcher exists |

Uniqueness on `(aggregate_type, aggregate_id, event_type)` prevents duplicate initial
events. An index on unpublished `created_at` supports future polling.

`queued` means the aggregate **and** outbox event are committed. It does **not** mean a
BullMQ job exists, a worker has started, or journey results exist. Dispatch to BullMQ is
not implemented yet; Redis remains unused by the application.

## HTTP API

Versioned meeting-search routes:

| Method | Path                                 | Success | Notes                                          |
| ------ | ------------------------------------ | ------- | ---------------------------------------------- |
| POST   | `/api/v1/meeting-searches`           | `202`   | Zod DTO → command; search + outbox; `Location` |
| GET    | `/api/v1/meeting-searches/:searchId` | `200`   | Deliberate API projection — not Drizzle rows   |
| GET    | `/health`                            | `200`   | Unversioned; backward compatible               |

Flow:

```text
Fastify route → Zod validation → meeting-search service → repository TX → response mapper
```

- Reuse `createMeetingSearchRequestSchema` as the request source of truth.
- Response schemas strip unexpected properties (Zod default strip mode).
- GET preserves participant order and deterministic transport-mode / country ordering.
- No auth, no journey results, no fake progress or candidates.

### Errors and request IDs

| Situation                | HTTP | Code                      |
| ------------------------ | ---- | ------------------------- |
| Invalid body/params/JSON | 400  | `VALIDATION_FAILED`       |
| Unknown search           | 404  | `NOT_FOUND`               |
| Uniqueness conflict      | 409  | `CONFLICT`                |
| Unknown origin place     | 422  | `INVALID_PLACE_REFERENCE` |
| Unexpected failure       | 500  | `INTERNAL_ERROR`          |
| Database unavailable     | 503  | `SERVICE_UNAVAILABLE`     |

Envelopes carry a stable `code`, safe `message`, optional field `details`, and
`requestId`. The same ID is returned in `x-request-id`. Client-supplied request ID
headers are not trusted as the server ID.

Never expose SQL text, constraint names, stack traces, raw driver errors, or outbox
internals to clients.

Validation uses `fastify-type-provider-zod@4.0.2` (Zod 3 + Fastify 5). Provider v7
requires Zod 4 and is not used.

## Testing

```bash
pnpm test                 # unit + Fastify inject (no real ports)
pnpm test:integration     # disposable PostGIS via Testcontainers + committed migrations
```

Integration tests cover atomic search+outbox commit, duplicate-event rejection, missing
origin rollback (no orphan rows), and cascade deletion of owned outbox events.
