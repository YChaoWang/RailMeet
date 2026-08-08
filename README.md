# RailMeet

Find the fairest European city for a group to meet, based on real public-transport journeys.

RailMeet ranks candidate meeting cities by fairness, total travel time, transfers, and
arrival-time alignment. It is a portfolio-oriented backend / full-stack project built for
reliability, clear architecture, and incremental delivery.

## Docs

| Doc                                                                                                  | Contents                                |
| ---------------------------------------------------------------------------------------------------- | --------------------------------------- |
| [docs/architecture.md](./docs/architecture.md)                                                       | Monorepo, packages, services, lifecycle |
| [docs/domain.md](./docs/domain.md)                                                                   | Domain model, time, validation          |
| [docs/persistence-and-api.md](./docs/persistence-and-api.md)                                         | Database, outbox, HTTP API              |
| [docs/outbox-dispatch.md](./docs/outbox-dispatch.md)                                                 | Dispatcher, BullMQ publish, retries     |
| [docs/search-kickoff-and-routing.md](./docs/search-kickoff-and-routing.md)                           | Kickoff consumer, retention, Transitous |
| [docs/candidate-generation-and-routing-fanout.md](./docs/candidate-generation-and-routing-fanout.md) | Phase 7 candidates and journey fan-out  |

## Architecture (summary)

```text
apps/web · apps/api · apps/worker
        ↑
packages/queue · packages/routing (worker)
packages/validation · packages/database
        ↑
packages/shared
```

- **web** — UI only; talks to the API
- **api** — validates requests, creates searches, returns status (thin handlers)
- **worker** — outbox → BullMQ publisher + kickoff consumer (`queued` → `running`)

See [docs/architecture.md](./docs/architecture.md) for the full layout and dependency rules.

## What works today

- Canonical places + meeting-search aggregates in PostGIS
- Transactional outbox (`meeting-search.requested`) on create
- Worker dispatcher publishes unpublished events to BullMQ with deterministic job IDs
- BullMQ kickoff consumer atomically transitions `queued` → `running` (idempotent)
- Provider-neutral routing boundary + Transitous MOTIS 2 `/api/v5/plan` adapter
- `POST/GET /api/v1/meeting-searches` with shared envelopes and request IDs
- `/health`, Compose PostGIS + Redis, unit and integration tests

`queued` means durably accepted. `running` means the kickoff job was accepted — not that
routes exist yet. There is no auth, candidate generation, journey persistence, or ranking yet.

## Local setup

### Prerequisites

- Node.js 22+
- pnpm 10+
- Docker Desktop (or another Docker engine) for Compose and Testcontainers

### Install

```bash
pnpm install
cp .env.example .env
pnpm docker:up
pnpm build
pnpm db:migrate
```

On Apple Silicon, Compose uses `ghcr.io/baosystems/postgis:16-3.5` (arm64). The official
`postgis/postgis` image is amd64-only.

If port `3001` is in use, change `API_PORT` and matching base URLs in `.env`.

### Development

```bash
pnpm dev
```

- Web: http://localhost:3000
- API health: http://localhost:3001/health
- Meeting searches: `POST/GET /api/v1/meeting-searches` (requires seeded places)
- Worker: readiness logs only

### Database

```bash
pnpm db:migrate    # apply committed SQL
pnpm db:generate   # after schema changes — commit the new SQL
pnpm db:check      # migration consistency
```

## Environment variables

See [`.env.example`](./.env.example).

| Variable                   | Used by                  | Purpose                                 |
| -------------------------- | ------------------------ | --------------------------------------- |
| `DATABASE_URL`             | api, worker, migrate     | PostgreSQL connection string            |
| `REDIS_URL`                | worker (api config only) | Redis for BullMQ                        |
| `API_BASE_URL`             | api, worker              | Public API base URL                     |
| `API_HOST` / `API_PORT`    | api                      | Listen address                          |
| `NEXT_PUBLIC_API_BASE_URL` | web                      | Browser-facing API URL                  |
| `TRANSITOUS_BASE_URL`      | worker                   | MOTIS API root (`…/api`)                |
| `TRANSITOUS_USER_AGENT`    | worker                   | Required identifying User-Agent         |
| `LOG_LEVEL`                | all                      | Pino log level                          |
| `NODE_ENV`                 | all                      | `development` \| `test` \| `production` |

No secrets are committed.

## Commands

| Command                            | Description                                  |
| ---------------------------------- | -------------------------------------------- |
| `pnpm dev`                         | Start web, api, worker, and watched packages |
| `pnpm build`                       | Build all packages and apps                  |
| `pnpm lint`                        | Lint all workspaces                          |
| `pnpm typecheck`                   | Type-check all workspaces                    |
| `pnpm test`                        | Unit/smoke tests (no Testcontainers)         |
| `pnpm test:integration`            | Database integration tests (Docker required) |
| `pnpm test:integration:queue`      | Outbox + BullMQ consumer Redis integration   |
| `pnpm test:integration:transitous` | Opt-in live Transitous smoke (1 request)     |
| `pnpm worker:dev`                  | Run dispatcher + kickoff consumer            |
| `pnpm format`                      | Format with Prettier                         |
| `pnpm format:check`                | Check formatting                             |
| `pnpm docker:up`                   | Start PostGIS and Redis                      |
| `pnpm docker:down`                 | Stop Compose services                        |
| `pnpm db:generate`                 | Generate SQL migrations from Drizzle schema  |
| `pnpm db:migrate`                  | Apply committed migrations                   |
| `pnpm db:check`                    | Check migration consistency                  |
| `pnpm db:studio`                   | Open Drizzle Studio                          |

## Testing

```bash
pnpm test
pnpm test:integration
```

API tests use `fastify.inject()` (no real ports). Integration tests apply committed
migrations against disposable PostGIS via Testcontainers.

## Current limitations

- Searches remain `running` after candidate generation and journey fan-out; ranking, destination selection, and completion are Phase 8
- No public journey/result or progress APIs yet
- No place seed/import pipeline
- Parent-city “must be kind=city” is not DB-enforced
- No authentication or user ownership
- No cancellation, SSE, maps, or deployment config
- `/ready` probe not yet implemented
- Existing Phase 5 jobs retain their original unbounded retention options and may remain indefinitely unless explicitly cleaned up; Phase 6/7 do not automatically delete or migrate those jobs. Bounded retention applies only to newly produced jobs.
