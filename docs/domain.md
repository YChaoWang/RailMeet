# Domain model

Shared vocabulary for places, participants, travel windows, journeys, and validation ownership.

## Core concepts

| Concept | Location | Notes |
| ------- | -------- | ----- |
| `PlaceReference` | shared | Canonical `placeId` + optional display `label` |
| `Participant` | shared | Stable id, display name, origin place |
| `SearchConstraints` | shared | Date, local times, duration/transfer limits, modes, optional countries |
| `SearchRequest` | shared | Participants + constraints + requested ranking mode |
| `CreateMeetingSearchRequest` | validation | Zod-inferred create DTO |
| Ranking / transport / status enums | shared | `RANKING_MODES`, `TRANSPORT_MODES`, `SEARCH_STATUSES`, … |
| `API_ERROR_CODES` | shared | Stable machine-readable API errors |
| `PLACE_KINDS` | shared | `city` \| `station` |

## Place identifiers

Canonical place IDs are **opaque trimmed strings** (max length from shared limits), recommended form `place:<slug>`.

They are not UUIDs. Provider stop IDs (Transitous / MOTIS / GTFS) appear only inside routing adapters and upserted `places.provider_place_id` — never as the user-facing primary key.

## Time and timezone semantics

Participants leave from different European cities. Wall-clock fields must not assume one timezone.

1. **`travelDate`** — calendar date (`YYYY-MM-DD`), not a UTC instant.
2. **`earliestDepartureTime`** (`HH:mm`) — local to each participant origin on `travelDate`.
3. **`latestArrivalTime`** (`HH:mm`) — local to the candidate meeting city on `travelDate + arrivalDayOffset`.
4. **`arrivalDayOffset`** — `0` (same day) or `1` (next calendar day) for overnight windows.
5. Do not compare departure and arrival wall clocks until IANA timezones are resolved from places.
6. Request Zod schemas validate **shape only** — not “must not be in the past” (needs injected clock).
7. Provider itineraries use ISO timestamps with per-stop `tz` where MOTIS supplies them; UI formatting uses `Intl` in station timezones.

Persistence: `travel_date` is PostgreSQL `date`; departure/arrival are `time without time zone`; audit columns are `timestamptz`.

## Journey representation

### Compact results (list/card)

Each selected journey in `GET …/results` exposes:

- `journeyId`, participant, origin/destination labels, times, duration, transfers
- **`routeSummary`** — short chips (`displayName`, mode, optional route colors)
- **`legs`** — normalized ranking legs with optional map `geometry` (EncodedPolyline)
- **No** full `providerItinerary` on the compact endpoint

### Journey detail (expanded panel)

`GET …/journeys/:journeyId` returns:

| Field | Meaning |
| ----- | ------- |
| `detailSource: 'provider'` | Full MOTIS plan itinerary available (`motis-plan-itinerary-v1`) |
| `detailSource: 'legacy'` | Ranking legs only — search predates stored itineraries or parse failure |
| `providerItinerary` | Nested MOTIS itinerary (legs, stops, alerts, alternatives when present) |
| `legs` | Normalized ranking legs (always present for map/legacy fallback) |

The UI must use **`detailSource`**, not the mere presence of a null `providerItinerary`, to choose rendering strategy.

## Validation ownership

- Trim whitespace on IDs, names, labels, dates, times, country codes.
- Do not silently repair invalid values (no auto-uppercase countries, no dropping duplicates).
- Reject unknown keys via Zod `.strict()` on request schemas.
- Durations use integer minutes with upper bounds from `@railmeet/shared`.
- Canonical place existence is validated in the repository after structural Zod passes — never inside Zod with database I/O.
