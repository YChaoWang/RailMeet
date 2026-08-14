# Finalization and search completion

When all routing work is terminal, the worker evaluates feasibility, ranks every candidate for all four modes, persists relational results, and completes or fails the search.

Public UI reads these rows — no recomputation. See [search-and-results-ux.md](./search-and-results-ux.md).

## Pipeline step

```text
all routing work terminal
  → feasibility per candidate
  → select journeys per ranking mode
  → persist rankings + selected journeys
  → primary recommendation for requested ranking_mode
  → running → completed | failed
```

## Fan-in triggers

Transactional outbox `meeting-search.finalization-requested` with deterministic `dedupe_key`:

- `candidate-generation:<searchId>` — generation terminal (including zero candidates)
- `routing-work:<routingWorkId>` — work terminal (`succeeded`, `no_journeys`, `exhausted`)

Early requests return `not_ready`. The last terminal work item always schedules another attempt.

## Readiness (under row lock)

- Search `running`
- Candidate generation terminal; stable candidate count
- Routing work count = `participants × candidates`
- Every pair exists once; all rows terminal
- `succeeded` ⇒ ≥1 journey; `no_journeys` ⇒ zero journeys

Nonterminal work → `not_ready`. Invariant violation → `failed` without partial rankings.

## Feasibility

Candidate feasible iff every participant has one `succeeded` row with ≥1 journey. `no_journeys` excludes candidate from rankings. `exhausted` routing fails the whole search.

## Ranking modes

Durations in **integer minutes**; arrival spread in milliseconds; comparisons on UTC instants.

| Mode | Candidate ordering (summary) |
| ---- | ---------------------------- |
| `fastest-overall` | Total duration, then max duration, transfers, spread, ordinal |
| `fairest` | Max participant duration, range, total duration, … |
| `fewest-transfers` | Total transfers, max transfers, duration, … |
| `arrive-together` | Arrival penalty (spread beyond 60 min tolerance), then duration, transfers, journey-id tuple |

All four modes are always persisted so the UI can switch tabs without re-planning.

Implementation: `@railmeet/search-engine` (`rankAllModes`, `selectArriveTogetherJourneys`, …).

## Completion outcomes

| Situation | Outcome |
| --------- | ------- |
| Zero candidates | `completed` / `no_candidates` |
| ≥1 feasible | `completed` / `ranked` |
| Candidates but none feasible | `completed` / `no_feasible_candidates` |
| Technical / invariant failure | `failed` + sanitized code |

`no_journeys` is a domain outcome, not a system error. Terminal timestamps set once with `coalesce`.

## Atomicity

Validate → evaluate → persist → complete/fail in one transaction. Commit-before-ack retries converge via uniqueness and CAS.

## Consequences

- Worker runs finalization consumer (`SEARCH_FINALIZATION_CONSUMER_CONCURRENCY` default 2).
- Phase 9+ UI and `GET …/results` / `GET …/journeys/:id` are read-only over persisted data.
