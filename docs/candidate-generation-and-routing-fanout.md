# Candidate generation and durable journey fan-out

## Context

Phase 6 leaves meeting searches in `running` after an idempotent kickoff. Phase 7 continues
that pipeline by generating candidate cities, creating participant × candidate routing work,
calling Transitous from routing consumers, and persisting provider-neutral journeys.

## Decision

### Place coordinate invariants

Participant origins reference `places.id` with `ON DELETE RESTRICT`. Persisted
`places.location` values are `geometry(Point, 4326) NOT NULL` with checks for
Point type, non-empty geometry, SRID 4326, longitude in `[-180, 180]`, and
latitude in `[-90, 90]` (including rejection of non-finite coordinates). Invalid
origins therefore cannot be stored and cannot enter candidate generation.

### Candidate-generation algorithm

1. Verify **production** meeting-city catalog readiness (GeoNames cities + Transitous hubs with
   provider stop IDs). Fixture-only catalogs fail with `CANDIDATE_CATALOG_NOT_READY`.
2. Fail with typed codes if not ready (`CANDIDATE_CATALOG_NOT_READY` /
   `CANDIDATES_HAVE_NO_ROUTING_TARGET`).
3. Resolve participant origin places (coordinates required).
4. Compute a planar lon/lat centroid in SRID 4326:
   `ST_SetSRID(ST_MakePoint(avg(ST_X), avg(ST_Y)), 4326)`.
5. Select nearest **active** `kind = city` places with GiST KNN:
   `ORDER BY location <-> center, id ASC LIMIT n`.
6. Attach a deterministic representative routing hub per city (`meeting_city_hubs`). Cities without
   an authoritative hub are skipped (centroid fallback is disabled for production).
7. Persist ordinal = result order and geodesic `ST_Distance(...::geography)` for explanation.
8. **Progressive fan-out**: persist up to `SEARCH_LIMITS.maximumCandidates` (3) cities, but create
   routing work only for ordinal `0` first. Finalization expands to ordinal `1`, then `2`, only when
   the evaluated wave has no feasible candidate. Absolute plan budget: `maximumTotalPlanCalls = 18`.

`allowedCountryCodes` applies only when the user supplies them. Origin countries are never
inferred as an automatic filter.

See [ADR 0005](./adr/0005-meeting-city-catalog.md) and `packages/catalog/README.md`.

### Deterministic ordering

Same search data yields the same ordered candidates. Tie-break is place `id ASC` after distance.

### Database entities

- `meeting_search_candidate_generations` — one claim row per search
- `meeting_search_candidates` — unique `(search_id, destination_place_id)`
- `meeting_search_routing_work` — unique `(search_id, participant_id, destination_place_id)`
- `meeting_search_journeys` — unique `(routing_work_id, journey_ordinal)`; normalized legs JSONB only

### Transactional outbox flow

```text
create search → outbox meeting-search.requested
kickoff CAS queued→running (same TX) → candidate_generations + outbox candidates-requested
candidate processor → candidates + routing_work + outbox routing.requested (per work id)
dispatcher → BullMQ queues (no Redis publish inside DB transactions)
routing consumer → Transitous once per attempt → persist journeys
```

Outbox uniqueness is `(aggregate_type, aggregate_id, event_type, dedupe_key)`.
Routing events use `dedupe_key = routingWorkId`.

### Idempotency boundaries

At-least-once queue delivery + PostgreSQL uniqueness/CAS:

- duplicate kickoff does not create duplicate candidate work
- duplicate candidate delivery does not duplicate candidates/routing rows
- duplicate routing delivery does not reopen terminal work or duplicate journeys
- `started_at` is never reset

This is **not** exactly-once execution.

### Retry behavior

BullMQ retries use Phase 6 attempts/backoff/jitter/retention. Transient Transitous and database
errors retry. Permanent provider-contract/request failures and malformed jobs do not retry
indefinitely. Retry exhaustion marks routing work `exhausted` only — never the whole search.

### Routing reclaim after `pending → running → transient failure`

Compare-and-set claim transitions `pending → running` and sets `started_at` once. If Transitous
or PostgreSQL fails after that claim, the row remains `running` (not rolled back to `pending`).
A BullMQ retry calls `claimRoutingWork` again, observes `already_running`, and **reclaims** the
same work without resetting `started_at`. Processing continues (Transitous may be called again
only when no journeys are persisted yet). If journeys were already written, the retry completes
the row to `succeeded` without another provider call. Work is therefore not permanently stuck
in `running` while retries remain available.

### Journey persistence format

Typed columns for departure/arrival/duration/transfers/modes; JSONB legs are normalized
(`mode`, ISO timestamps, durationMinutes, optional opaque providerReference). Raw Transitous
bodies are never stored.

### Privacy and log redaction

Logs must not include coordinates, complete request URLs, or provider response bodies.

### Why the search remains `running`

Phase 7 only gathers candidates and journeys. Ranking, destination selection, and completion
are Phase 8 — see [finalization-and-ranking.md](./finalization-and-ranking.md).

## Consequences

- Worker runs dispatcher + kickoff + candidate + routing consumers.
- Fan-out size is bounded by participant limits × `SEARCH_CANDIDATE_LIMIT`.
- Existing Phase 5/6 outbox events remain valid with `dedupe_key = default`.
