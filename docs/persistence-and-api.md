# Persistence and HTTP API

How meeting searches are stored, exposed over HTTP, and read back without recomputing rankings.

## Persistence stack

| Choice | Detail |
| ------ | ------ |
| Database | PostgreSQL 16 + PostGIS 3.5 |
| ORM / migrations | Drizzle; committed SQL under `packages/database/migrations` |
| Driver | `postgres` (postgres.js) via `drizzle-orm/postgres-js` |
| Factory | `createDatabase(config)` — migrate/close are explicit |

PostGIS is enabled in the first migration. Production path: `pnpm db:migrate` (not schema push).

### Core tables

| Table | Purpose |
| ----- | ------- |
| `places` | Canonical cities/stations; `geometry(Point, 4326)` + GiST |
| `meeting_searches` | Search header (status, dates, limits, terminal fields) |
| `meeting_search_participants` | Ordered participants + origin FK |
| `meeting_search_transport_modes` | Allowed modes (unique per search) |
| `meeting_search_allowed_countries` | Optional ISO country filter |
| `outbox_events` | Transactional outbox |
| `meeting_search_candidates` | Generated meeting cities |
| `meeting_search_routing_work` | Participant × candidate plan jobs |
| `meeting_search_journeys` | Normalized journeys + legs JSONB |
| `meeting_search_candidate_rankings` | Persisted ranking rows per mode |

Place IDs are opaque text PKs. Search IDs are UUIDs. Origin place FKs use `ON DELETE RESTRICT`.

### Journey legs JSONB

`meeting_search_journeys.legs` stores normalized ranking legs **and**, when available, a versioned **`providerItinerary`** blob (`motis-plan-itinerary-v1`) captured at routing time. Parsing is defensive: corrupt provider JSON falls back to legacy detail without failing the search.

## Create transaction

One PostgreSQL transaction on `POST /api/v1/meeting-searches`:

1. Verify origin places exist (`PLACE_NOT_FOUND` → 422 before write).
2. Insert search, participants, modes, countries.
3. Insert exactly one `meeting-search.requested` outbox event.
4. Commit — only then return `202`.

See [outbox-dispatch.md](./outbox-dispatch.md) for publish semantics.

## HTTP API

All versioned routes use shared success/error envelopes with server-generated `requestId` (client `x-request-id` is not trusted).

| Method | Path | Success | Notes |
| ------ | ---- | ------- | ----- |
| POST | `/api/v1/meeting-searches` | `202` | Create; `Location` header |
| GET | `/api/v1/meeting-searches/:searchId` | `200` | Summary for any lifecycle state |
| GET | `/api/v1/meeting-searches/:searchId/results` | `200` | Rankings when `completed` |
| GET | `/api/v1/meeting-searches/:searchId/journeys/:journeyId` | `200` | Lazy journey detail |
| GET | `/api/v1/places/search?q=…` | `200` | Autocomplete (Transitous geocode) |
| GET | `/api/v1/map/stops?…` | `200` | Viewport station overlay |
| GET | `/health` | `200` | Unversioned liveness |

### Results contract (compact)

- Rankings ordered by `RANKING_MODES` → persisted rank → participant ordinal.
- Each journey includes `journeyId`, `routeSummary`, normalized `legs` with optional geometry.
- **`providerItinerary` is stripped** from compact results — fetch journey detail when expanded.

### Journey detail contract

Returns `detailSource`, optional `providerItinerary`, ranking `legs`, and `providerItineraryUnavailableReason` when applicable. `404` when journey id is unknown or not associated with the search.

### Error mapping

| Situation | HTTP | Code |
| --------- | ---- | ---- |
| Invalid body/params/JSON | 400 | `VALIDATION_FAILED` |
| Unknown search/journey | 404 | `NOT_FOUND` |
| Uniqueness conflict | 409 | `CONFLICT` |
| Results not ready | 409 | `RESULTS_NOT_READY` |
| Search failed/cancelled (results) | 409 | `SEARCH_FAILED` |
| Unknown origin place | 422 | `INVALID_PLACE_REFERENCE` |
| Unexpected failure | 500 | `INTERNAL_ERROR` |
| Database unavailable | 503 | `SERVICE_UNAVAILABLE` |

Never expose SQL, constraint names, stack traces, or outbox internals to clients.

## Web proxy

Next.js Route Handlers under `apps/web/src/app/api/v1/` forward to Fastify using server-only `API_BASE_URL`. The browser calls same-origin `/api/v1/...` only.

## Testing

See [testing.md](./testing.md). Quick commands:

```bash
pnpm test                      # unit + Fastify inject (default CI path)
pnpm test:integration          # PostGIS + catalog import
pnpm test:integration:queue    # outbox + BullMQ + worker recovery
```

Integration tests apply committed migrations to disposable PostGIS via Testcontainers.
