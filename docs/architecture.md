# Architecture

RailMeet is a **pnpm + Turborepo** monorepo: three deployable apps, shared packages, and one async pipeline from search creation to ranked results.

## Repository layout

```text
railmeet/
├── apps/
│   ├── web/              # Next.js 15 — map-first UI, same-origin API proxy
│   ├── api/              # Fastify — HTTP boundary, no BullMQ/Transitous
│   └── worker/           # Outbox dispatcher + BullMQ consumers
├── packages/
│   ├── shared/           # Domain vocabulary (enums, limits, lifecycle helpers)
│   ├── validation/       # Zod request/response schemas
│   ├── database/         # Drizzle, PostGIS, repositories, outbox claim
│   ├── queue/            # BullMQ dispatcher, job contracts, consumers (shared)
│   ├── config/           # Validated environment loaders
│   ├── observability/    # Pino logging
│   ├── routing/          # Provider-neutral plan + Transitous MOTIS v5 adapter
│   ├── search-engine/    # Candidate ordinals, feasibility, ranking
│   └── catalog/          # GeoNames + Transitous hub import pipeline
├── docs/
└── docker-compose.yml    # PostgreSQL 16 + PostGIS 3.5, Redis 7
```

## Dependency direction

```text
packages/shared
    ↑
packages/validation · packages/search-engine
packages/database
    ↑
packages/queue · packages/routing · packages/catalog
    ↑
apps/api · apps/web · apps/worker
```

**Hard rules**

| Layer | Must not import |
| ----- | ---------------- |
| `apps/api` | `@railmeet/queue`, `@railmeet/routing`, BullMQ, Redis clients, Transitous |
| `apps/web` | PostgreSQL, Redis, BullMQ, direct Transitous plan calls |
| `packages/shared` | Zod, Drizzle, Fastify, infrastructure |
| `packages/routing` | Database, BullMQ (adapter only) |

- Finite enums and numeric limits live **once** in `@railmeet/shared`.
- Zod schemas and SQL `CHECK` constraints reuse those values.
- Queue job names and outbox event types live in `@railmeet/queue`.
- Ranking and feasibility logic live in `@railmeet/search-engine` — no Fastify or Transitous imports.

## Service responsibilities

| Service | Role |
| ------- | ---- |
| **web** | Planner, status polling, results, map, journey detail UI. Talks to Fastify via same-origin Route Handlers (`/api/v1/...`). |
| **api** | Validates HTTP, creates searches, reads summary/results/journey detail. Thin routes → services → repositories. |
| **worker** | Outbox dispatcher; kickoff, candidate, routing, and finalization BullMQ consumers; Transitous plan calls; Redis plan cache. |

## End-to-end lifecycle

```text
Browser → POST /api/v1/meeting-searches → 202 Accepted
                ↓ (transaction)
         search row + outbox event
                ↓
Worker dispatcher → BullMQ meeting-search.requested
                ↓
Kickoff consumer → status running
                ↓
Candidate generation → nearest meeting cities + routing work rows
                ↓
Routing consumers → Transitous /api/v5/plan → normalized journeys (+ optional provider itinerary JSON)
                ↓
Finalization → feasibility + rankAllModes → relational rankings
                ↓
status completed | failed
                ↓
Browser polls GET summary → GET results → lazy GET journey detail
```

Status meanings:

| Status | Meaning |
| ------ | ------- |
| `queued` | Aggregate and outbox row committed; job may not be published yet |
| `running` | Pipeline accepted; candidates/routing/finalization in progress |
| `completed` | Terminal success — rankings (possibly empty outcome) persisted |
| `failed` | Terminal technical failure — no partial rankings |

## Runtime conventions

- `buildServer()` / worker bootstrap construct dependencies without listening as a side effect.
- Database and Redis clients are created in entrypoints, not at module import.
- Config is loaded through `@railmeet/config`; route handlers do not read `process.env` directly.
- Worker graceful shutdown: stop consumers → stop dispatcher → close queues/Redis → close database.

## Local infrastructure

Compose provides PostGIS and Redis:

- Image: `ghcr.io/baosystems/postgis:16-3.5` (arm64-friendly).
- Redis: `noeviction`, AOF enabled.

Integration tests use Testcontainers against the same migration journal as production (`pnpm test:integration`, `pnpm test:integration:queue`).
