# Outbox dispatch to BullMQ

## Context

Meeting searches are durably accepted in PostgreSQL together with an unpublished
`meeting-search.requested` outbox event. PostgreSQL and Redis cannot share one atomic
transaction, so enqueueing into BullMQ must happen asynchronously.

## Decision

The worker process runs a non-overlapping outbox dispatcher:

1. Claim a bounded batch of due events with `FOR UPDATE SKIP LOCKED` and a lease.
2. Close the PostgreSQL transaction before talking to Redis.
3. `Queue.add()` with deterministic job ID `outbox-<eventUuid>`.
4. Mark the outbox row published only after enqueue succeeds (including duplicate ID).

### Delivery semantics

At-least-once delivery with enqueue deduplication while the BullMQ job is retained.

Crash window:

```text
BullMQ add succeeds → process crashes → published_at still NULL
```

Recovery reclaims the expired lease, calls `add()` with the same job ID (no-op duplicate),
then marks published. Custom job IDs prevent duplicate enqueue **only while the prior job
still exists**. Worker-level idempotency is required before any auto-removal policy.

Phase 6 introduces bounded producer-side retention for **new** jobs (`attempts`, exponential
backoff with jitter, `removeOnComplete` / `removeOnFail` age+count). Existing Phase 5 jobs
retain their original unbounded retention options and may remain indefinitely unless
explicitly cleaned up. Phase 6 does not automatically delete or migrate those jobs. After
removal, the same deterministic job ID may be added again; PostgreSQL kickoff idempotency
preserves correctness (at-least-once delivery with an idempotent state transition).

### Leasing

`failure_count`, `next_attempt_at`, `lease_token`, `leased_until`, `last_error_code`,
`dead_lettered_at` support concurrent dispatchers without advisory locks. Mark-published,
mark-retry, and mark-dead-letter require the current lease token so stale owners cannot
overwrite newer leases.

Lease duration must cover the worst-case time for the last event in a claimed batch under
bounded publish concurrency:

```text
waves = ceil(batchSize / publishConcurrency)
minimumLease = waves × (redisCommandTimeout + perEventSafety)
OUTBOX_LEASE_MS > minimumLease
```

Defaults use batch 10, concurrency 3, lease 60s. Configuration validation rejects unsafe
combinations. Leases are not renewed mid-batch in this phase.

### Retry vs poison

| Class     | Examples                       | Behavior                                                                                                             |
| --------- | ------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| Transient | Redis down, timeout, reset     | Clear lease, increment failure, schedule `next_attempt_at` with capped exponential backoff. Never permanent discard. |
| Poison    | Bad event type/version/payload | Set `dead_lettered_at` with a stable error code.                                                                     |

Valid searches are not discarded because Redis was unavailable for a long time.

### Queue contract

- Queue: `meeting-searches`
- Job name: `meeting-search.requested`
- Job ID: `outbox-<eventId>`
- Data: `{ schemaVersion: 1, searchId }`

### API independence

The Fastify API does not import BullMQ/Redis. `POST /api/v1/meeting-searches` returns
`202` when Redis is down because PostgreSQL outbox persistence is the acceptance boundary.

### Status meaning

After successful publication the meeting search remains `queued` until the Phase 6 kickoff
consumer transitions it to `running`. See [search-kickoff-and-routing.md](./search-kickoff-and-routing.md).

## Local worker

```bash
pnpm worker:dev
# or
pnpm --filter @railmeet/worker start
```

Shutdown: stop dispatcher → close queue → close Redis → close database.

## Tests

```bash
pnpm test
pnpm test:integration          # PostgreSQL claim/lease
pnpm test:integration:queue    # PostgreSQL + Redis end-to-end dispatch
```
