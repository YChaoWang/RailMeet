# RailMeet documentation

Design and operations docs for the monorepo. Organized by **system structure**, not delivery phases.

## Start here

| If you want to… | Read |
| ---------------- | ---- |
| Run the stack locally | Root [README](../README.md) — install, env, commands |
| Understand layout and dependency rules | [architecture.md](./architecture.md) |
| Learn places, time, and validation | [domain.md](./domain.md) |
| Work on HTTP or PostgreSQL | [persistence-and-api.md](./persistence-and-api.md) |
| Work on the async pipeline | Outbox → kickoff → candidates → routing → finalization (below) |
| Work on the Next.js UI | [search-and-results-ux.md](./search-and-results-ux.md) |
| Run or extend tests | [testing.md](./testing.md) |

## Pipeline (async search)

```text
POST create search
  → outbox meeting-search.requested
  → dispatcher → BullMQ
  → kickoff (queued → running)
  → candidate generation + routing fan-out
  → Transitous plan per participant × candidate
  → finalization + ranking
  → completed | failed
```

| Doc | Stage |
| --- | ----- |
| [outbox-dispatch.md](./outbox-dispatch.md) | PostgreSQL outbox → BullMQ publish |
| [search-kickoff-and-routing.md](./search-kickoff-and-routing.md) | Kickoff consumer, Redis policy, Transitous adapter boundary |
| [candidate-generation-and-routing-fanout.md](./candidate-generation-and-routing-fanout.md) | Meeting cities, routing work, journey persistence |
| [finalization-and-ranking.md](./finalization-and-ranking.md) | Feasibility, four ranking modes, terminal outcomes |

## Catalog and meeting cities

Production candidate cities come from GeoNames + Transitous hub enrichment, not hand-maintained seeds.

- [adr/0005-meeting-city-catalog.md](./adr/0005-meeting-city-catalog.md) — decision record
- [packages/catalog/README.md](../packages/catalog/README.md) — import commands and readiness

## ADRs

Architecture decision records live under [adr/](./adr/).
