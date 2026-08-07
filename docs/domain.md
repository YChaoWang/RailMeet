# Domain model

Shared vocabulary for places, participants, travel windows, and validation ownership.

## Core concepts

| Concept                      | Package    | Notes                                                                |
| ---------------------------- | ---------- | -------------------------------------------------------------------- |
| `PlaceReference`             | shared     | Canonical `placeId` + optional display `label`; no provider stop IDs |
| `Participant`                | shared     | Stable ID, display name, origin place                                |
| `SearchConstraints`          | shared     | Travel window, duration/transfer limits, modes, optional countries   |
| `SearchRequest`              | shared     | Participants + constraints + ranking mode                            |
| `CreateMeetingSearchRequest` | validation | Zod-inferred create-search DTO                                       |
| Ranking / transport / status | shared     | Single-source tuples (`RANKING_MODES`, …)                            |
| `API_ERROR_CODES`            | shared     | Stable machine-readable API error codes                              |
| `PLACE_KINDS`                | shared     | `city` \| `station`                                                  |

## Place identifiers

Canonical place IDs are **opaque trimmed strings** (max length from shared limits),
recommended form `place:<slug>`.

They are not UUIDs and are not mutable name-based slug semantics. Provider-specific IDs
(Transitous / GTFS / MOTIS) belong only inside a future routing adapter.

## Time and timezone semantics

Participants leave from different European cities. Wall-clock fields must not pretend
every local time shares one timezone.

1. **`travelDate`** is a calendar date (`YYYY-MM-DD`), not a UTC timestamp.
2. **`earliestDepartureTime`** (`HH:mm`) is local to each participant origin on
   `travelDate`.
3. **`latestArrivalTime`** (`HH:mm`) is local to the candidate meeting city on
   `travelDate + arrivalDayOffset`.
4. **`arrivalDayOffset`** is `0` (same day) or `1` (next day) for overnight journeys.
5. Do not compare departure and arrival wall clocks as absolute values until IANA
   timezones are resolved from canonical places.
6. Boundary Zod schemas validate **shape only** — not place existence and not
   “must not be in the past” (that needs an injected clock).
7. Routing results must eventually use timezone-aware timestamps; DST edge cases are
   handled at the provider boundary, not in request schemas.

Persistence mirrors this: `travel_date` is PostgreSQL `date`; departure/arrival are
`time without time zone`; audit columns are `timestamptz`.

## Validation ownership

- Trim surrounding whitespace on IDs, names, labels, dates, times, and country codes.
- Do not silently repair invalid values (no auto-uppercase countries, no dropping
  duplicates).
- Reject unknown object keys via Zod `.strict()` on **request** schemas.
- Durations use integer minutes with named upper bounds from `@railmeet/shared`.
- Canonical-place existence is an application/repository concern after structural
  validation — never a Zod refinement with database I/O.
