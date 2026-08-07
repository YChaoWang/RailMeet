# Architecture

RailMeet is a pnpm + Turborepo monorepo with three deployable apps and shared packages.

## Layout

```text
railmeet/
├── apps/
│   ├── web/           # Next.js UI (talks only to the API)
│   ├── api/           # Fastify HTTP API
│   └── worker/        # Background processing (BullMQ planned; idle today)
├── packages/
│   ├── shared/        # Domain vocabulary — no Zod, no infrastructure
│   ├── validation/    # Zod boundary schemas
│   ├── database/      # Drizzle + PostGIS
│   ├── config/        # Validated environment loaders
│   ├── observability/ # Structured logging (Pino)
│   ├── routing/       # Routing provider adapters (stub)
│   └── search-engine/ # Pruning / scoring / ranking (stub)
├── docs/
├── docker-compose.yml # PostgreSQL+PostGIS and Redis
└── turbo.json
```

## Dependency direction

```text
packages/shared
    ↑
packages/validation
packages/database
    ↑
apps/api · apps/web · apps/worker
```

Rules:

- Finite enums and numeric limits live once in `@railmeet/shared`.
- Zod schemas and SQL `CHECK` constraints reuse those values — they must not drift.
- Domain types (`SearchRequest`, …) describe internal concepts.
- Boundary DTOs (`CreateMeetingSearchRequest`, …) are inferred from Zod.
- Persistence commands (`CreateMeetingSearchCommand`, …) are explicit repository inputs,
  not Drizzle row types and not HTTP DTOs.
- Search/ranking logic must not import Fastify or Transitous directly.

## Service responsibilities

| Service    | Responsibility                                                                               |
| ---------- | -------------------------------------------------------------------------------------------- |
| **web**    | UI only. Never touches PostgreSQL, Redis, BullMQ, or Transitous.                             |
| **api**    | Validates requests, creates searches, returns status. Thin handlers over application code.   |
| **worker** | Long-running search work (not wired yet). Bounded concurrency and ranking persistence later. |

## Runtime lifecycle

- `buildApp()` / `buildServer()` constructs the process without listening.
- Listening and `createDatabase()` are explicit in the production entrypoint.
- `app.close()` awaits database pool shutdown when a database was registered.
- Config is loaded via `@railmeet/config` — route and repository modules must not read
  `process.env` directly.

## Local infrastructure

Compose provides PostgreSQL 16 + PostGIS 3.5 and Redis 7.

- Image: `ghcr.io/baosystems/postgis:16-3.5` (arm64-friendly; official `postgis/postgis`
  is amd64-only).
- Redis is reserved for future BullMQ; the application does not open Redis clients yet.
