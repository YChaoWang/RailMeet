# Outbox dispatch to BullMQ

PostgreSQL accepts meeting searches together with an unpublished outbox event. Because PostgreSQL and Redis cannot share one transaction, BullMQ enqueue happens asynchronously in the worker.

## Flow

```text
Worker dispatcher (non-overlapping cycles)
  1. Claim due events (FOR UPDATE SKIP LOCKED + lease)
  2. Close DB transaction
  3. Queue.add() with job id outbox-<eventUuid>
  4. Mark published only after enqueue succeeds (including duplicate job id)
```

## Delivery semantics

**At-least-once** with enqueue deduplication while the BullMQ job is retained.

Crash after successful `add()` but before `published_at` update: lease expires, reclaim, same job id (no-op duplicate), then mark published.

Custom job IDs prevent duplicate enqueue **only while the prior job exists**. Worker handlers must be idempotent. Bounded `removeOnComplete` / `removeOnFail` on new jobs means old job ids may be reused; PostgreSQL idempotency preserves correctness.

## Leasing

Columns `failure_count`, `next_attempt_at`, `lease_token`, `leased_until`, `last_error_code`, `dead_lettered_at` support multiple dispatcher instances without advisory locks. Mark-published / mark-retry / mark-dead-letter require the current lease token.

Lease duration must cover worst-case batch publish time (`OUTBOX_LEASE_MS` validated against batch size and Redis timeout in `@railmeet/config`).

## Retry vs poison

| Class | Examples | Behavior |
| ----- | -------- | -------- |
| Transient | Redis down, timeout | Backoff retry; never permanent discard for valid events |
| Poison | Bad type/version/payload | `dead_lettered_at` with stable error code |

## Queue contract

- Queue: `meeting-searches`
- Job: `meeting-search.requested`
- Job ID: `outbox-<eventId>`
- Payload: `{ schemaVersion: 1, searchId }`

## API independence

`POST /api/v1/meeting-searches` returns `202` when Redis is down — PostgreSQL persistence is the acceptance boundary.

After publish the search stays `queued` until the kickoff consumer sets `running`. See [search-kickoff-and-routing.md](./search-kickoff-and-routing.md).

## Local worker

```bash
pnpm worker:dev
```

Shutdown order: consumers → dispatcher → queues → Redis → database.

## Tests

```bash
pnpm test:integration          # claim/lease in PostgreSQL
pnpm test:integration:queue    # end-to-end dispatch
```
