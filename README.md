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
| [docs/finalization-and-ranking.md](./docs/finalization-and-ranking.md)                               | Phase 8 fan-in, ranking, completion     |
| [docs/search-and-results-ux.md](./docs/search-and-results-ux.md)                                     | Phase 9 results API and search UI       |

## Architecture (summary)

```text
apps/web · apps/api · apps/worker
        ↑
packages/queue · packages/routing · packages/search-engine (worker)
packages/validation · packages/database
        ↑
packages/shared
```

- **web** — UI only; talks to the API
- **api** — validates requests, creates searches, returns status (thin handlers)
- **worker** — outbox dispatcher + kickoff, candidate, routing, and finalization consumers

See [docs/architecture.md](./docs/architecture.md) for the full layout and dependency rules.

## What works today

- Canonical places + meeting-search aggregates in PostGIS
- Transactional outbox on create, candidates, routing, and finalization fan-in
- Worker dispatcher publishes unpublished events to BullMQ with deterministic job IDs
- Kickoff → candidate generation → routing → finalization ranking pipeline
- Deterministic ranking for `fairest`, `fastest-overall`, `fewest-transfers`, `arrive-together`
- Durable `completed` / `failed` search outcomes with relational ranking persistence
- Provider-neutral routing boundary + Transitous MOTIS 2 `/api/v5/plan` adapter
- `POST/GET /api/v1/meeting-searches` and `GET …/results` with shared envelopes
- Next.js search form + durable status/results pages (same-origin Route Handlers)
- `/health`, Compose PostGIS + Redis, unit and integration tests

`queued` means durably accepted. `running` means the async pipeline is in progress.
`completed` / `failed` are Phase 8 terminal outcomes. The UI polls summary until terminal,
then loads persisted rankings (Phase 9).

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
| `API_BASE_URL`             | api, worker, web proxy   | Fastify origin (web: server-only proxy) |
| `API_HOST` / `API_PORT`    | api                      | Listen address                          |
| `NEXT_PUBLIC_API_BASE_URL` | legacy tooling           | Deprecated for browser calls in Phase 9 |
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
| `pnpm worker:dev`                  | Run dispatcher + Phase 6–8 consumers         |
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

- **European coverage follows Transitous** — meeting cities and schedules are limited to
  locations and feeds available through [Transitous](https://transitous.org). The catalog is
  imported from GeoNames + Transitous hub enrichment; production readiness is
  `production-catalog-partial` until every tier-eligible city has an authoritative hub.
- **Manual catalog import** — run `pnpm catalog:download`, `catalog:build`, `catalog:enrich-hubs`,
  and `catalog:import` against production Postgres before live searches (see
  [packages/catalog/README.md](./packages/catalog/README.md)).
- No authentication or user ownership
- No search cancellation UI (backend supports terminal cancel states for future work)
- `/ready` probe not yet implemented (use `/health`)
- Existing Phase 5 jobs retain their original unbounded retention options

## Deployment

RailMeet targets a three-service layout:

| Service       | Platform          | Role                                                             |
| ------------- | ----------------- | ---------------------------------------------------------------- |
| `apps/web`    | Vercel            | Next.js UI (same-origin API proxy or `NEXT_PUBLIC_API_BASE_URL`) |
| `apps/api`    | Railway (public)  | Fastify API, **sole migration runner**, `/health`                |
| `apps/worker` | Railway (private) | Outbox dispatcher + BullMQ consumers                             |

Supporting infrastructure: **Neon** (PostGIS), **Railway Redis**, **Transitous** (external routing).

### Environment variables by platform

**Vercel (`apps/web`)**

| Variable                   | Purpose                                               |
| -------------------------- | ----------------------------------------------------- |
| `NEXT_PUBLIC_API_BASE_URL` | Optional public API URL when not using Route Handlers |
| `API_BASE_URL`             | Server-side proxy target (build/runtime on Vercel)    |

**Railway API (`apps/api`)**

| Variable                | Purpose                                                            |
| ----------------------- | ------------------------------------------------------------------ |
| `NODE_ENV=production`   | Enables production validation (no localhost URLs)                  |
| `DATABASE_URL`          | Neon **pooled** runtime connection                                 |
| `DATABASE_URL_DIRECT`   | Neon **direct** connection for `pnpm db:migrate` only              |
| `REDIS_URL`             | Railway Redis                                                      |
| `WEB_ORIGIN`            | Comma-separated CORS origins (Vercel production + preview + local) |
| `API_BASE_URL`          | Public HTTPS API URL                                               |
| `TRANSITOUS_BASE_URL`   | `https://api.transitous.org/api`                                   |
| `TRANSITOUS_USER_AGENT` | `RailMeet/<version> (+https://…)`                                  |

**Railway Worker (`apps/worker`)**

| Variable              | Purpose                                     |
| --------------------- | ------------------------------------------- |
| `NODE_ENV=production` | Production validation                       |
| `DATABASE_URL`        | Neon pooled connection                      |
| `REDIS_URL`           | Railway Redis (BullMQ + routing plan cache) |
| `API_BASE_URL`        | Internal reference URL                      |
| `TRANSITOUS_*`        | Same as API                                 |

**Neon**

- Enable PostGIS: migrations run `CREATE EXTENSION IF NOT EXISTS postgis`
- Use pooled `DATABASE_URL` for API/worker runtime
- Use direct `DATABASE_URL_DIRECT` for migrations (`pnpm db:migrate` from API deploy)

### Build commands

```bash
pnpm --filter @railmeet/web build
pnpm --filter @railmeet/api build && node apps/api/dist/index.js
pnpm --filter @railmeet/worker build && node --enable-source-maps apps/worker/dist/index.js
```

See `apps/web/vercel.json`, `apps/api/railway.toml`, and `apps/worker/railway.toml` for platform defaults.

### Docker (API + Worker)

Multi-stage images use the **repository root** as build context, Node 20 slim, Corepack
`pnpm@10.8.0`, and `turbo prune` so only the target app and its workspace dependencies are
built. Images run as user `railmeet` (uid 1001), exclude `.env` files, and do **not** run
migrations or bundle Postgres/Redis.

Build:

```bash
docker build -f apps/api/Dockerfile -t railmeet-api .
docker build -f apps/worker/Dockerfile -t railmeet-worker .
```

Run locally against **external** Postgres and Redis (not the in-container localhost defaults).
Use `host.docker.internal` on Docker Desktop when pointing at Compose services on the host:

```bash
# API — binds 0.0.0.0, uses PORT or API_PORT (default 3001), GET /health
docker run --rm -p 3001:3001 \
  -e NODE_ENV=development \
  -e DATABASE_URL=postgresql://railmeet:railmeet@host.docker.internal:5432/railmeet \
  -e REDIS_URL=redis://host.docker.internal:6379 \
  -e API_BASE_URL=http://localhost:3001 \
  -e TRANSITOUS_BASE_URL=https://api.transitous.org/api \
  railmeet-api

# Worker — no HTTP port; source maps enabled
docker run --rm \
  -e NODE_ENV=development \
  -e DATABASE_URL=postgresql://railmeet:railmeet@host.docker.internal:5432/railmeet \
  -e REDIS_URL=redis://host.docker.internal:6379 \
  -e API_BASE_URL=http://localhost:3001 \
  -e TRANSITOUS_BASE_URL=https://api.transitous.org/api \
  railmeet-worker
```

The API image includes a Docker `HEALTHCHECK` on `/health` (compatible with Northflank HTTP
probes). Set `NODE_ENV=production` in real deployments; production validation rejects
`localhost` database/redis URLs inside the container.

## Transitous attribution

Routing data © [Transitous](https://transitous.org) contributors and underlying GTFS/OSM sources.
RailMeet uses the public MOTIS API; respect provider rate limits (max **18** plan calls and **2**
concurrent requests per search).

## Product scope (verified)

- **2–6 participants** end to end (shared `SEARCH_LIMITS` / validation)
- **Progressive candidate evaluation** — up to **3** meeting cities, stopping early when feasible
- **Four ranking modes** — fairest, fastest overall, fewest transfers, arrive together
- **Modes** — train, bus, tram, metro, ferry (via MOTIS normalization)
- **Async lifecycle** — queued → running → completed/failed with polling UI
