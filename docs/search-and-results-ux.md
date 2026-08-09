# Search and results user experience

Phase 9 exposes Phase 8 persisted rankings through read APIs and a map-first Next.js UI.

## Architecture

```text
Browser (MapLibre map + planner panel)
  → Next.js Route Handlers (/api/v1/meeting-searches…)
  → Fastify (/api/v1/meeting-searches…)
  → PostgreSQL (Phase 8 persisted rows + places.location)
```

No Redis, BullMQ, Transitous, ranking recomputation, feasibility recomputation, or
browser geocoding on the read path. Ranking-mode tabs switch over already-persisted rows.

## Place autocomplete

Origin fields use a same-origin combobox:

```text
PlaceCombobox → GET /api/v1/places/search?q=…
  → Next.js proxy → Fastify → Transitous GET /api/v1/geocode?text=…
  → normalized PlaceSuggestion[]
```

Requirements:

- search starts after 2 non-whitespace characters with ~300 ms debounce;
- stops are prioritized ahead of cities/addresses;
- selection requires a structured MOTIS identity + coordinates (never free text);
- places are upserted into `places` (provider + provider_place_id) only when the meeting
  search is created;
- worker routing continues to use stored `places.location` — no browser Transitous calls
  and no re-geocode for already-persisted origins.

The map is the primary workspace.

| Viewport        | Layout                                                                            |
| --------------- | --------------------------------------------------------------------------------- |
| Desktop (~1440) | Full-bleed MapLibre map; ~400px left overlay panel with brand + controls          |
| Tablet (~768)   | Same left-panel pattern                                                           |
| Mobile (~390)   | Full-screen map; single bottom sheet (collapsed / expanded / drag) with safe-area |

Lifecycle status, search form, ranking modes, candidates, and journey details render inside
the panel. The map shell stays mounted across polling and transient network errors. Draft
origins appear on the map as soon as a place suggestion is selected (no routes before create).

### Markers and routes (persisted data only)

Place views on summary and results include optional `longitude` / `latitude` from
`places.location` (PostGIS). The UI:

- draws distinct origin markers (stable letter + color) for travelers with coordinates;
- draws candidate meeting-point markers for the active ranking mode;
- emphasizes the selected candidate destination;
- draws **every traveler’s** real selected-candidate journey geometry simultaneously from
  persisted MOTIS EncodedPolyline fields (transit solid, walk dashed; never fabricated
  straight lines);
- highlights one traveler’s full route while dimming others;
- shows accessible popups (traveler journey summary / meeting arrival spread) and a compact
  letter+name legend;
- fits bounds to markers and decoded route coordinates once per geometry identity, with
  sheet/panel-aware padding — emphasis and manual pan/zoom do not repeatedly reset the camera.

Missing coordinates omit that marker; missing leg geometry omits that segment only.

## Public HTTP contracts

| Method | Path                                         | Behavior                                                                                                                                                  |
| ------ | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/api/v1/meeting-searches`                   | Create (unchanged)                                                                                                                                        |
| GET    | `/api/v1/meeting-searches/:searchId`         | Summary for any lifecycle state (`200`); `404` unknown; `400` bad UUID                                                                                    |
| GET    | `/api/v1/meeting-searches/:searchId/results` | Ranked results when `completed` (`200`); `409 RESULTS_NOT_READY` while non-completed non-failed; `409 SEARCH_FAILED` when failed/cancelled; `404` unknown |

Place views may include `name`, `longitude`, and `latitude` when present in `places`.
Selected journey legs include optional normalized `geometry: { points, precision, length } | null`
from MOTIS EncodedPolyline (persisted in `meeting_search_journeys.legs` jsonb). Precision is
provider-supplied (v5 typically 6) and is never hard-coded to 5.

## Map route rendering

When a ranked candidate is selected (default: rank 1 of the active mode):

- origin and meeting-point markers are shown when coordinates exist;
- each participant’s selected journey legs are decoded client-side and drawn as MapLibre
  GeoJSON line layers (transit solid, walk dashed, with white casing);
- missing leg geometry never produces a straight-line fallback — journey details show
  “Route shape unavailable for this segment”;
- ranking-mode and candidate switches use already-loaded results only (no Transitous).

Attribution remains visible (OpenStreetMap + Transitous) outside the panel cover zone.

## Exhaustive lifecycle → UI mapping

| Status                | Produced by (today)                          | Terminal | Continue polling | Fetch results | Panel copy                   |
| --------------------- | -------------------------------------------- | -------: | ---------------: | ------------: | ---------------------------- |
| `queued`              | create                                       |       no |              yes |            no | Preparing / waiting          |
| `running`             | kickoff                                      |       no |              yes |            no | Comparing routes             |
| `partially-completed` | reserved; not written by Phase 8             |       no |              yes |            no | Still refining               |
| `completed`           | Phase 8 finalize                             |      yes |               no |           yes | Ranked list or empty outcome |
| `failed`              | Phase 8 finalize                             |      yes |               no |            no | Failed (safe copy)           |
| `cancelling`          | unused transitional; kickoff refuses restart |       no |              yes |            no | Stopping (no Cancel control) |
| `cancelled`           | unused; kickoff treats as terminal           |      yes |               no |            no | Cancelled terminal           |

Shared helpers in `@railmeet/shared` (`search-lifecycle.ts`) classify terminal vs polling statuses.
`shouldFetchSearchResults` is true only for `completed`.

## Completion outcomes

| Outcome                  | HTTP results                | UI                                                              |
| ------------------------ | --------------------------- | --------------------------------------------------------------- |
| `ranked`                 | `200` with ranking rows     | Segmented ranking modes; preserve API order; map selection sync |
| `no_candidates`          | `200` with empty `rankings` | Empty plan copy inside panel; map remains visible               |
| `no_feasible_candidates` | `200` with empty `rankings` | Same empty plan screen                                          |

## Deterministic result order

```text
RANKING_MODES order → persisted rank ascending → participant position ascending
```

Frontend filters by mode only and does not re-sort. Selecting a candidate updates map
highlight state without creating a new search or calling Transitous.

## Polling rules (web)

1. Open `/search/[searchId]` inside the map shell.
2. Poll summary about every 2 seconds without overlapping requests.
3. Abort on unmount; stop on terminal / not-found / malformed ID.
4. Fetch `/results` once after `completed`.
5. Preserve last summary on network errors; show inline Retry.
6. Ignore stale responses after retry generation bumps.

## Visual direction

Restrained transportation aesthetic: neutral map background, white panels, navy text, teal
selection accent, compact typography, subtle borders/shadows. No glassmorphism or dashboard
stat tiles. MapLibre + OpenFreeMap Liberty style with attribution.

## Local environment

| Variable       | Used by             | Notes                                        |
| -------------- | ------------------- | -------------------------------------------- |
| `API_BASE_URL` | Next Route Handlers | Server-only Fastify origin (default `:3001`) |

Browser calls same-origin `/api/v1/...` only.

## Browser visual verification (when tooling available)

Capture at 1440 / 768 / 390 for: initial search, queued/running, ranked results, selected
candidate with journeys, empty outcome, failed/network error, mobile collapsed + expanded
sheet. Do not claim visual acceptance without screenshots or human review.

## Tests

```bash
pnpm --filter @railmeet/web test
pnpm --filter @railmeet/api test
pnpm --filter @railmeet/database test:integration
```

MapLibre is stubbed in unit tests (`disableMap` / module mock). Draft markers are asserted via
the real `SearchPlannerPage` wiring (autocomplete select → live scene → SearchMap props)
before any create-search call. Results markers/routes still come from `buildMapScene`.

Station/railway context uses OpenFreeMap Liberty basemap layers (`road_*_rail`, `poi_transit`);
no viewport station API is required for Phase 9.

## Out of scope

Auth, accounts, SSE, cancel/retry controls, fabricated route geometry, Google Maps API,
browser-direct Transitous plan calls, analytics, and Phase 10+ product work.
