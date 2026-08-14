# Search kickoff and Transitous routing

First BullMQ consumer after outbox dispatch: idempotent **`queued → running`**, plus the provider-neutral routing boundary.

## Kickoff consumer

Not the full pipeline — only a PostgreSQL compare-and-set:

```text
queued → running (set started_at once)
```

| Status | Meaning |
| ------ | ------- |
| `queued` | Committed; outbox may still be unpublished |
| `running` | Pipeline accepted; no rankings yet |

Terminal statuses are never reopened by kickoff. Duplicate delivery → `already_started` without resetting `started_at`.

## Worker Redis

- BullMQ workers: dedicated ioredis, `maxRetriesPerRequest: null`, no command timeout on blocking connections.
- Outbox publisher: separate fail-fast connection with bounded `commandTimeout`.
- Bounded consumer concurrency (`SEARCH_CONSUMER_CONCURRENCY`).
- Graceful shutdown: close consumer (await in-flight) → dispatcher → Redis → DB.

## Job retention

New jobs use attempts, exponential backoff with jitter, bounded removeOnComplete/removeOnFail. Older unbounded jobs may persist in Redis until manually cleaned — do not bulk-delete without understanding idempotency.

## Provider-neutral routing (`@railmeet/routing`)

Narrow `planJourney` contract. Transitous adapter implements MOTIS 2 **`/api/v5/plan`** (OpenAPI pin `motis@2.10.2`) with runtime JSON validation and normalized RailMeet types. Wire types do not leak into API or database layers.

Kickoff does **not** call Transitous — searches have origins but no chosen destination yet.

### Transitous policy

- Community-operated, best effort; identifying `User-Agent` required (`RailMeet/<version> (+https://…)`).
- Attribute Transitous in product surfaces.
- Public instance is for development / low volume — not assumed commercial SLA.
- `TRANSITOUS_BASE_URL` configurable for self-hosting.
- Opt-in live smoke: `pnpm test:integration:transitous` (at most one plan request).

Candidate generation and routing consumers are described in [candidate-generation-and-routing-fanout.md](./candidate-generation-and-routing-fanout.md).
