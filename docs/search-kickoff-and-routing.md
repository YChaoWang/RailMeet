# Search kickoff consumer and Transitous routing

## Context

Phase 5 publishes durable `meeting-search.requested` BullMQ jobs from the PostgreSQL
outbox. Until Phase 6 there was no consumer, searches stayed `queued`, and jobs were
retained indefinitely so Redis job-ID deduplication remained available.

## Decision

### Kickoff consumer (not the full search pipeline)

The first BullMQ `Worker` only performs an idempotent PostgreSQL compare-and-set:

```text
queued → running (set started_at once)
```

`running` in Phase 6 means the asynchronous search pipeline accepted the search.
It does not mean routes or recommendations already exist.

A completed BullMQ kickoff job can therefore correspond to a still-`running` search.
Phase 7 continues a `running` search with candidate generation and journey retrieval.

### Status meanings

| Status    | Meaning                                                         |
| --------- | --------------------------------------------------------------- |
| `queued`  | Durably accepted in PostgreSQL; outbox may still be unpublished |
| `running` | Kickoff consumer accepted the search; no journey results yet    |

Terminal statuses (`completed`, `failed`, …) are never reopened by the kickoff consumer.

### Idempotency and delivery

```text
at-least-once queue delivery
+ idempotent PostgreSQL state transition
= effectively-once search kickoff state change
```

- Concurrent consumers: only one `queued → running` update wins.
- Crash after DB commit but before BullMQ ack: redelivery observes `already_started`.
- Retries never reset `started_at`.
- Duplicate jobs do not enqueue Phase 6 downstream work (there is none yet).

### Worker Redis connections

Each BullMQ consumer uses a dedicated ioredis connection with:

- `maxRetriesPerRequest: null` (BullMQ blocking-command requirement);
- `commandTimeout` disabled — outbox publisher timeouts must not abort idle BRPOP/BZPOP waits;
- `enableOfflineQueue: true` so workers recover across brief Redis blips.

The outbox publisher keeps a separate fail-fast connection with a bounded `commandTimeout`.

### Worker concurrency and shutdown

- Bounded local BullMQ concurrency (`SEARCH_CONSUMER_CONCURRENCY`).
- Startup: config → DB → Redis → publisher/dispatcher → processor → consumer → start dispatcher → run consumer.
- Shutdown: close consumer (stop accepting jobs, await in-flight with timeout) → stop dispatcher → close queues/Redis → close DB.
- If graceful worker close exceeds timeout, stalled-job recovery may reclaim unfinished work.

### Bounded job retention

New jobs use producer-side `attempts`, exponential backoff with configurable jitter,
and bounded `removeOnComplete` / `removeOnFail` age+count. Failed retention age and
count are validated to be at least as long/large as completed retention.

Existing Phase 5 jobs retain their original unbounded retention options and may
remain indefinitely unless explicitly cleaned up. Phase 6 does not automatically
delete or migrate those jobs. Do not scan Redis and bulk-delete old jobs.

Bounded retention applies only to newly produced jobs using the new options. After a
completed or failed Redis job is removed, its deterministic job ID may be accepted
again. PostgreSQL kickoff idempotency preserves correctness after Redis
deduplication expires. The system provides at-least-once delivery with an
idempotent state transition, not exactly-once execution.

### Provider-neutral routing + Transitous

`@railmeet/routing` defines a narrow `planJourney` contract. The Transitous adapter
implements MOTIS 2 `/api/v5/plan` (OpenAPI pin `motis@2.10.2`) with runtime JSON
validation and normalized RailMeet types. Provider wire types do not leak into
database, worker kickoff, or API layers.

The Phase 6 kickoff consumer does **not** call Transitous: meeting searches have
origins but no chosen destination. No destination is invented.

### Transitous usage policy

- Community-operated and best effort; limited public resources.
- Every request requires an identifying `User-Agent` (`RailMeet/<version> (+https://…)`).
- Provide source attribution in product surfaces that display Transitous data.
- Public Transitous is not an assumed commercial production backend.
- Commercial operation needs explicit permission, another provider, or self-hosted MOTIS.
- Phase 6 use is development / low-volume validation only.
- `TRANSITOUS_BASE_URL` remains configurable for self-hosting later.
- Live smoke (`pnpm test:integration:transitous`) performs at most one plan request.

## Consequences

- API remains independent of Redis and Transitous.
- Correctness no longer requires indefinite Redis job retention.
- Candidate generation, ranking, journey persistence, and completion remain Phase 7+.
