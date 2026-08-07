# @railmeet/database

PostgreSQL / PostGIS persistence for RailMeet via Drizzle ORM.

## Responsibilities

- Drizzle schema and committed SQL migrations
- Explicit database factory (`createDatabase`) with migrate/close lifecycle
- Place and meeting-search repositories (transactional aggregate create)

## Commands

```bash
pnpm db:generate      # generate SQL from schema
pnpm db:migrate       # apply committed migrations (requires DATABASE_URL)
pnpm db:check         # migration consistency check
pnpm db:studio        # Drizzle Studio
pnpm test:integration # Testcontainers PostGIS suite
```

## Notes

- Does not depend on `@railmeet/validation`, Fastify, BullMQ, or Redis
- Place IDs are opaque text keys; search IDs are UUIDs
- Empty allowed-countries child rows means no country filter
