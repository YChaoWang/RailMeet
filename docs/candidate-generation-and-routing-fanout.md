# Candidate generation and journey fan-out

After kickoff, the worker generates meeting-city candidates, fans out routing work, calls Transitous, and persists normalized journeys.

## Prerequisites

- Participant origins reference valid `places.location` (PostGIS point, SRID 4326, finite coordinates).
- **Production catalog readiness** — GeoNames cities + Transitous hubs with provider stop IDs. Fixture-only catalogs fail with `CANDIDATE_CATALOG_NOT_READY`.
- See [adr/0005-meeting-city-catalog.md](./adr/0005-meeting-city-catalog.md) and `packages/catalog/README.md`.

## Candidate algorithm

1. Resolve participant origin coordinates.
2. Planar centroid in SRID 4326.
3. GiST KNN: nearest active `kind = city` places, tie-break `id ASC`.
4. Attach deterministic representative hub per city (`meeting_city_hubs`); skip cities without authoritative hub.
5. Persist ordinal and geodesic distance.
6. **Progressive fan-out**: up to `SEARCH_LIMITS.maximumCandidates` (3) cities; routing work for ordinal 0 first; expand only when the evaluated wave has no feasible candidate. Plan budget: **18** calls per search.

`allowedCountryCodes` applies only when the user supplied them.

## Entities

| Table | Role |
| ----- | ---- |
| `meeting_search_candidate_generations` | One claim row per search |
| `meeting_search_candidates` | Unique `(search_id, destination_place_id)` |
| `meeting_search_routing_work` | Unique `(search_id, participant_id, destination_place_id)` |
| `meeting_search_journeys` | Unique `(routing_work_id, journey_ordinal)` |

## Outbox chain

```text
meeting-search.requested → kickoff
  → meeting-search.candidates-requested
  → per routing work: meeting-search.routing-requested (dedupe_key = routingWorkId)
dispatcher → BullMQ (no Redis inside DB transactions)
routing consumer → Transitous → persist journeys
```

## Idempotency

At-least-once delivery + PostgreSQL uniqueness/CAS:

- Duplicate kickoff does not duplicate candidate rows.
- Duplicate routing delivery does not reopen terminal work or duplicate journeys.
- `started_at` never reset.

## Routing reclaim

Claim transitions `pending → running`. Transient failure after claim leaves row `running`; retry reclaims without resetting `started_at`. If journeys already persisted, retry completes without another provider call.

## Journey persistence

Typed columns for times/duration/transfers; legs JSONB with normalized ranking legs. When MOTIS returns a full plan payload, store **`providerItinerary`** (`motis-plan-itinerary-v1`) for later journey-detail UI — raw Transitous bodies are not stored separately.

Redis plan cache uses a **versioned key** so pre-itinerary cache entries cannot collide with provider-native payloads.

## Privacy

Logs must not include coordinates, full request URLs, or provider response bodies.

Search remains `running` until finalization — [finalization-and-ranking.md](./finalization-and-ranking.md).
