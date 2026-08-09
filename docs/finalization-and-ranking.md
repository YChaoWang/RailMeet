# Finalization, ranking, and search completion

## Context

Phase 7 leaves meeting searches in `running` after candidate generation, routing fan-out,
and normalized journey persistence. Phase 8 finalizes the pipeline: evaluate feasibility,
rank candidates for every supported ranking mode, persist relational results, and transition
the search to `completed` or `failed`.

Phase 8 does **not** own the public results UI. Phase 9 reads these persisted rows through
`GET /api/v1/meeting-searches/:searchId` and `GET …/results`. See
[search-and-results-ux.md](./search-and-results-ux.md).

## Decision

### Phase 8 boundary

```text
all routing work terminal
→ evaluate candidate feasibility
→ select journeys
→ calculate all ranking modes
→ persist deterministic ranked results
→ select primary recommendation for requested ranking_mode
→ running → completed | failed
```

### Fan-in architecture

Every terminal pipeline write inserts a transactional outbox event
`meeting-search.finalization-requested` with a deterministic `dedupe_key`:

- `candidate-generation:<searchId>` when generation succeeds with zero candidates or fails permanently
- `routing-work:<routingWorkId>` when routing work reaches `succeeded`, `no_journeys`, or `exhausted`

No Redis publish occurs inside a database transaction. Early finalization requests are
expected and return `not_ready`. The last terminal work item guarantees another request.

### Readiness checks

Under `SELECT … FOR UPDATE` on the meeting search:

1. status is `running`
2. candidate generation is terminal
3. participant count is valid (2–6)
4. candidate count is stable
5. routing-work count equals `participant_count × candidate_count`
6. every participant × candidate pair exists once
7. every routing-work row is terminal
8. `succeeded` work has ≥1 journey; `no_journeys` has zero
9. no candidate silently omits a participant

Nonterminal work → `not_ready` (search unchanged). Impossible relational states →
`failed` with a sanitized code and **no** partial rankings.

### Feasibility

A candidate is feasible only when every participant has exactly one `succeeded` routing-work
row with at least one normalized journey. `no_journeys` makes the candidate infeasible
(`participant_no_journeys`) and excludes it from rankings. `exhausted` is a technical failure
for the whole search.

When finalization proceeds through candidate evaluation (completion path, including
`no_feasible_candidates` and `ranked`), evaluation rows are persisted for every candidate.
Search-wide terminal failures detected during readiness (`exhausted`, missing participant ×
candidate pairs, `succeeded` with zero journeys, other invariant breaks) CAS to `failed`
**without** writing evaluation, ranking, or journey-selection rows — partial results are never
committed.

### Ranking algorithms

Durations use **integer minutes** (same unit as `meeting_search_journeys.duration_minutes`).
Arrival spread uses milliseconds between earliest and latest selected arrivals. All comparisons
use UTC instants (`timestamptz` / `Date`), never `HH:mm` strings.

| Mode               | Journey pick                                                                               | Candidate order                                                                       |
| ------------------ | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| `fastest-overall`  | duration, transfers, arrival, departure, journeyId                                         | totalDur, maxDur, totalTransfers, arrivalSpread, ordinal, candidateId                 |
| `fairest`          | same fastest journey pick                                                                  | maxDur, duration range, totalDur, totalTransfers, arrivalSpread, ordinal, candidateId |
| `fewest-transfers` | transfers, duration, arrival, departure, journeyId                                         | totalTransfers, maxTransfers, totalDur, maxDur, ordinal, candidateId                  |
| `arrive-together`  | smallest arrival-range cover; within each width-`D` window: duration, transfers, journeyId | arrivalSpread, totalDur, maxDur, totalTransfers, latestArrival, ordinal, candidateId  |

**Arrive-together:** sort journeys by absolute arrival instant. Find the global minimum
feasible arrival spread `D` with a participant-covering sliding window. For each distinct
lower endpoint `L` from sorted arrivals, consider `[L, L + D]`; if every participant has a
journey in range, pick one journey per participant by
`duration → transfers → binary journeyId` (no local arrival/departure tie-break), then keep
the best set under
`spread → total duration → total transfers → latest arrival → earliest arrival →`
element-by-element journey-ID tuple (binary-sorted participant order; never a joined string).

Why `duration → transfers → journeyId` is valid inside a width-`D` window:

1. `D` is already the globally minimum possible covering spread.
2. Every selected set inside an inclusive interval `[L, L + D]` has spread at most `D`.
3. It cannot have spread below `D`, or `D` would not be minimal.
4. Therefore every feasible selected set in that window has spread exactly `D`.
5. A width-`D` set inside `[L, L + D]` must attain the window endpoints, so earliest and
   latest arrival are fixed for that window (set-level keys 4–5 do not prefer one local
   arrival/departure alternative inside the window).
6. Duration and transfers are additive, so independently choosing each participant’s
   minimum duration, then minimum transfers, minimizes the corresponding set totals.
7. Once those values tie, independently choosing the binary-smallest journey ID for each
   participant produces the lexicographically smallest participant-ordered ID tuple.
8. Full set comparison across different windows still uses
   `spread → total duration → total transfers → latest arrival → earliest arrival →`
   element-by-element journey-ID tuple.

Complexity: **O(T log T + T² · P)** time, **O(T + P)** space (`T` = journeys for the candidate,
`P` = participants). This is polynomial; there is no Cartesian combination enumeration.

Feasible candidates receive unique ranks `1..N`. Rank 1 for the search’s `ranking_mode` is the
primary recommendation. All four modes are always persisted so Phase 9 can switch views without
re-calling Transitous.

### Result schema

- `meeting_searches`: `completed_at` / `failed_at` (once), `completion_outcome`, `failure_code`,
  `recommended_destination_place_id`
- `meeting_search_candidate_evaluations`
- `meeting_search_candidate_rankings`
- `meeting_search_candidate_ranking_journeys`

Core relationships are relational with uniqueness constraints. Raw Transitous bodies are never stored.

### Completion and failure semantics

| Situation                                          | Result                                 |
| -------------------------------------------------- | -------------------------------------- |
| Zero candidates                                    | `completed` / `no_candidates`          |
| ≥1 feasible candidate                              | `completed` / `ranked`                 |
| Candidates but none feasible                       | `completed` / `no_feasible_candidates` |
| Technical routing / generation / invariant failure | `failed` + sanitized code              |
| Nonterminal work                                   | remain `running`                       |
| Duplicate delivery after terminal                  | `already_terminal` no-op               |

`no_journeys` is a domain outcome, not a technical system failure.
`started_at` is never reset. Terminal timestamps are set with `coalesce` exactly once.

### Atomic finalization and at-least-once execution

Validate → evaluate → persist rankings/journeys → complete/fail happens in one transaction.
Rollback leaves no partial rankings. Commit-before-ack retries converge via uniqueness and
compare-and-set. The system remains **at-least-once with idempotent effects**, not exactly-once.

### Privacy and log redaction

Logs must not include coordinates, complete provider URLs, or response bodies. Failure codes
are sanitized internal constants.

### Why partial results are not published

Invariant breaks and technical failures mark the search `failed` without ranking rows. Phase 9
must not expose incomplete recommendations.

## Consequences

- Worker runs dispatcher + kickoff + candidate + routing + finalization consumers.
- Effective finalization concurrency defaults to `SEARCH_FINALIZATION_CONSUMER_CONCURRENCY=2`.
- Phase 9 owns HTTP/SSE/frontend result surfaces.
