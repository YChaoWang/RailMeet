# `@railmeet/routing`

Provider-neutral journey-planning boundary and Transitous MOTIS 2 adapter.

- Domain contract: `JourneyPlanner.planJourney`
- Adapter: `createTransitousJourneyPlanner` → `GET /api/v5/plan` (MOTIS OpenAPI pin `motis@2.10.2`)
- No database or BullMQ imports
- Ordinary tests use a local mock HTTP server
- Live smoke: `pnpm test:integration:transitous` (one request; not part of unit tests)

See [docs/search-kickoff-and-routing.md](../../docs/search-kickoff-and-routing.md).
