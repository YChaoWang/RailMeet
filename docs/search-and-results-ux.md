# Search and results UX

Map-first Next.js UI for planning, polling, ranked results, and lazy journey details.

## Data flow

```text
Browser (MapLibre + planner panel)
  → Next.js Route Handlers (/api/v1/…)
  → Fastify
  → PostgreSQL (rankings, places, journey legs JSONB)
```

The read path does **not** use Redis, BullMQ, Transitous plan, or ranking recomputation. Ranking-mode tabs switch over persisted rows only.

## Planner and place input

### Autocomplete

```text
PlaceCombobox → GET /api/v1/places/search?q=…
  → Transitous GET /api/v1/geocode
  → PlaceSuggestion[] (type icon, mode chips, locality line)
```

- Debounced (~300 ms) after 2+ non-whitespace characters.
- Stops prioritized over cities/addresses.
- Submit requires a structured selection (provider id + coordinates) — arbitrary text is rejected.
- Places upsert into `places` on search create; routing uses stored coordinates.

### Map-first workspace

| Viewport | Layout |
| -------- | ------ |
| Desktop (~1440) | Full-bleed map; ~400px left overlay panel |
| Tablet (~768) | Same left panel |
| Mobile (~390) | Full-screen map; bottom sheet (collapsed / expanded) |

- Map shell stays mounted across lifecycle states and network errors.
- Draft origin markers appear on autocomplete select (before submit).
- No route geometry until ranked results exist.

### Search form

- 2–6 travelers; auto-generated participant ids; optional display names default to “Traveler A/B/…”.
- No manual participant-id field in the UI.

## Results and ranking modes

When `completionOutcome === 'ranked'`:

- Four modes when persisted: fairest, fastest overall, fewest transfers, arrive together.
- Candidate list preserves **API order** (rank ascending) — no client re-sort.
- Selecting a candidate updates map emphasis; does not create a new search or call Transitous.

Empty outcomes (`no_candidates`, `no_feasible_candidates`) show copy inside the panel; map remains visible.

## Map rendering

From persisted data only:

- Lettered origin markers per traveler.
- Meeting-point marker for selected candidate.
- All travelers’ route geometries decoded from MOTIS EncodedPolyline (transit solid, walk dashed).
- One traveler emphasized at a time; others dimmed.
- Missing geometry omits that segment — no straight-line fallback.
- Pre-search: station overlay via `GET /api/v1/map/stops` on pan/zoom (no `/plan` on draft map).

Attribution: OpenStreetMap + Transitous outside the panel cover zone.

## Journey details (expanded)

Compact result rows show **`routeSummary` chips** only. Full detail loads on expand:

```text
JourneyDetailsPanel
  → loadJourneyDetailCached(searchId, journeyId)
  → GET /api/v1/meeting-searches/:searchId/journeys/:journeyId
  → JourneyItineraryTimeline (provider) | RankingJourneyLegs (legacy)
```

### Client cache

- In-memory cache keyed by `searchId + journeyId`.
- Concurrent expanders share one in-flight promise.
- Re-opening or switching ranking mode reuses cache when `journeyId` unchanged.
- No prefetch of all journeys on results load.

### Provider-native timeline UI

When `detailSource === 'provider'`, the timeline follows a **Transitous-inspired** continuous layout (not isolated leg cards):

- Sticky journey header: participant context, origin → destination, date range, `+N day` arrival, route pill sequence
- Colored **route pills** and vertical segments using MOTIS route colors (sanitized)
- Time + station on one line; platform/track badges; tabular numerals
- Cross-midnight **date separators** using station-local timezones (`Intl`, not +24h arithmetic)
- Transfer blocks between services: connection window, walk, waiting, station-change warning
- Progressive disclosure: intermediate stops, walking directions, alerts, ticket links (validated URLs)
- **`displayName`** as primary service identity (ICE 1135, FlixBus N814, LNER — never generic “Train”)
- Leg **alternatives** from MOTIS shown as informational only (do not mutate ranked journey)

Legacy searches render the same timeline component from normalized ranking legs with generic mode labels.

### Participant context

Multi-traveler candidates show whose timeline is expanded, e.g. “David’s journey · Berlin Hbf → York”.

## Polling

On `/search/[searchId]`:

1. Poll summary ~every 2 s without overlap.
2. Abort on unmount; stop on terminal / not-found / malformed id.
3. Fetch `/results` once when `completed`.
4. Preserve last summary on network error with Retry.
5. Ignore stale responses after retry generation bumps.

Shared helpers in `@railmeet/shared` (`search-lifecycle.ts`) drive terminal vs polling behavior.

## Visual direction

Restrained transportation aesthetic: neutral map, white panels, navy text, teal selection accent, compact type. MapLibre + OpenFreeMap Liberty style.

## Local verification

```bash
pnpm --filter @railmeet/web dev
pnpm --filter @railmeet/web test
pnpm --filter @railmeet/web exec tsx ./scripts/journey-details-screenshots.tsx
```

Screenshots land in `tmp/journey-details-screenshots/` for visual comparison (Berlin→York fixture, mobile/desktop).

## Out of scope

Authentication, SSE, search cancellation UI, browser-direct Transitous plan, fabricated geometry, analytics.
