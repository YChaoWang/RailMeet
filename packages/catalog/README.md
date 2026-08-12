# Meeting-city catalog

RailMeet discovers meeting **cities** and routes to representative **transit hubs**.

Phase 9 remains in progress until production readiness is honest, eligible meeting cities
have authoritative hubs, and acceptance cases (including London/Paris) are verified.

## Fixture ≠ production artifact ≠ database state

| Layer                      | Path / command                                     | Role                                          |
| -------------------------- | -------------------------------------------------- | --------------------------------------------- |
| Offline test fixture       | `data/fixtures/offline-europe-v1.json`             | CI + local deterministic validation only      |
| Importer IT fixture        | `data/fixtures/importer-it-v1.json`                | PostGIS/Testcontainers importer tests         |
| GeoNames source            | `pnpm catalog:download --source geonames`          | Official `cities15000.zip` (gitignored cache) |
| Production cities artifact | `data/artifacts/europe-cities-geonames-v1.json`    | Built locally; not committed                  |
| Transitous hubs artifact   | `data/artifacts/europe-hubs-transitous-v1.json`    | Built via manual enrich; not committed        |
| Merged production catalog  | `data/artifacts/europe-production-catalog-v1.json` | Import target for production                  |
| Imported DB state          | `places` + `meeting_city_hubs`                     | Runtime catalog                               |

**A tiny fixture must never report production readiness.**
**GeoNames import success does not imply RailMeet meeting-city suitability.**
**A real Transitous/MOTIS stop ID does not imply an appropriate primary intercity hub.**

## Why not a SQL seed or hand-curated JSON alone?

- Migration `0008_seed_meeting_cities.sql` is an immutable bootstrap for DBs that already applied it.
- Hand-curated JSON lacks reproducible provenance, checksummed source artifacts, and refreshability.
- Production coverage uses versioned authoritative dumps + a deterministic importer.

See ADR `docs/adr/0005-meeting-city-catalog.md`.

## Sources

| Layer  | Source                                                   | License                                                                                |
| ------ | -------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Cities | GeoNames `cities15000.zip`                               | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) — attribute GeoNames         |
| Hubs   | Transitous MOTIS `/api/v1/geocode` STOP matches (cached) | Transitous/MOTIS; underlying GTFS/OSM per feed. **MOTIS stop IDs are never invented.** |

Manifests:

- `data/manifests/geonames-cities15000.json`
- `data/manifests/transitous-hubs.json`
- `data/manifest.json` (fixture vs production map)

## Commands

```bash
pnpm catalog:validate                         # offline fixture (CI-safe)
pnpm catalog:download --source geonames       # manual; writes cache + manifest checksum
pnpm catalog:build --source geonames          # parse → europe-cities-geonames-v1.json
pnpm catalog:enrich-hubs --dry-run            # report eligible cities needing hubs
pnpm catalog:enrich-hubs [--limit N] [--refresh]  # manual Transitous STOP association
pnpm catalog:import --source fixture          # import offline fixture (not production-ready)
pnpm catalog:import --source production       # import merged production artifact
pnpm catalog:status                           # readiness + coverage metrics
```

Enrichment is manual only: not during migrate, startup, test, typecheck, or build.

## Imported city ≠ eligible meeting city ≠ routable meeting city

| State                      | Meaning                                                |
| -------------------------- | ------------------------------------------------------ |
| Imported GeoNames city     | Provenance row from `cities15000` European filter      |
| Tier-eligible meeting city | Passes policy `meeting-city-v2` (admin/population)     |
| Routable meeting city      | Tier-eligible **and** has an authoritative primary hub |

### Meeting-city policy `meeting-city-v2`

Declared geographic scope: `EUROPE_ISO_COUNTRY_CODES` (same as GeoNames European filter).

Deterministic tiers (not weighted scoring):

1. Supported country + populated-place feature class `P`
2. Admin/importance: `PPLC` (capital) → `PPLA`/`PPLA2` (admin seats) → population ≥ 100_000
3. Authoritative primary hub required for candidate generation
4. Geographic nearest-city discovery among routable cities only
5. Stable lexicographic ordering (`location <-> centroid`, then `id`)

The population floor is a **RailMeet product rule**, not a GeoNames rule. GeoNames
`cities15000` already uses ~15_000; that threshold floods candidate discovery with
towns that lack suitable intercity hubs.

## City → hub association

Uses structured MOTIS fields (`type`, `modes`, coordinates, locality, namespaced stop ID).

Capability classes from `modes`:

- Primary-eligible: `intercity_rail`, `regional_rail`, `ferry_terminal`, `coach_terminal`
- Not primary: `metro_only`, `local_bus`, `unknown` (including caches missing modes)

Deterministic precedence:

1. Explicit reviewed override (stable GeoNames + provider IDs) when present
2. Same-country STOP with exact normalized name
3. Same-country STOP with locality/parent name
4. Eligible capability within soft/hard geodesic distance (SRID 4326 / geography)
5. Ambiguous near-ties are reported, not guessed

Within a level: capability class → geodesic distance → stable provider stop ID.
Insertion order is never significant.

Caches that omit `modes` are treated as stale and refreshed on the next network enrich.

## Ownership

| Ownership                   | Meaning                                             |
| --------------------------- | --------------------------------------------------- |
| `manual`                    | Human override; import will not overwrite           |
| `catalog:bootstrap`         | Legacy 0008 bootstrap cities                        |
| `catalog:geonames`          | Production GeoNames cities                          |
| `catalog:transitous`        | Hubs with authoritative MOTIS stop IDs              |
| `catalog:hub`               | Hub rows without provider stop IDs (fixture/legacy) |
| `fixture:offline-europe-v1` | Offline fixture cities                              |
| `provider:motis`            | Runtime autocomplete origins                        |

## Readiness

`catalog:status` reports typed production readiness, including:

- `fixture-only-catalog`
- `production-catalog-absent` / `production-artifact-downloaded`
- `production-catalog-partial` (hubs exist but tier-eligible cities remain uncovered)
- `production-catalog-unusable`
- `production-catalog-stale`
- `production-catalog-ready` (every tier-eligible city has an authoritative primary hub)

Partial hub coverage (e.g. hundreds of hubs among thousands of imports) must **never**
report `production-catalog-ready`. Fallback-only / centroid cities do not count as hub coverage.

Worker scheduling may still run when enough hubbed eligible cities exist
(`evaluateCatalogReadiness`), while status remains `production-catalog-partial`.

Empty / fixture-only / unusable catalogs fail before routing jobs are scheduled
(`CANDIDATE_CATALOG_NOT_READY` / `CANDIDATES_HAVE_NO_ROUTING_TARGET`).

## Centroid fallback

Production candidate generation **requires** an authoritative primary hub.
`routing_target_reason = centroid_fallback` is fixture/dev-only when explicitly allowed.
Centroid coordinates are never pretended to be provider stop IDs.
Proximity-only hub matches require rail capability (`intercity_rail` / `regional_rail`);
coach/ferry may still win via exact name or locality parent matches.

## Provider normalization

- Known MOTIS modes normalize centrally; unknown values stay in diagnostics as `other`
- All-unknown transit journeys are rejected
- Geometry: absent/empty → omit; valid → keep; malformed non-empty → typed failure
- One malformed itinerary is skipped; sibling valid itineraries are retained

## Completed searches

Historical results load places by ID without requiring `active = true`, so catalog
refresh/deactivation does not break completed-search display. Selected hub IDs and
`routing_target_reason` remain reconstructable.

## Offline CI vs live acceptance

CI uses fixtures + Testcontainers. Live Transitous checks and browser automation are
manual/operator-only and are not network-dependent CI.
