# ADR 0005: Versioned meeting-city catalog with representative hubs

## Status

Accepted (Phase 9 — in progress until readiness + hub coverage + acceptance DoD)

## Context

A temporary SQL seed (`0008_seed_meeting_cities`) unblocked London/Edinburgh searches after the
catalog contained only Paris/Berlin fixtures. Hand-maintained city centroids and a small curated
JSON file are **not** a maintainable production catalog: they lack provenance, checksummed source
artifacts, refreshability, auditable hubs, and honest readiness checks.

### Why a small SQL seed is insufficient

- Migrations are a poor refresh channel for thousands of cities.
- Seeds cannot carry SHA-256 manifests, selection-policy versions, or reversible soft-deactivation.
- Network fetches inside migrations are unsafe.

### Why a small hand-curated JSON fixture is insufficient

- Coverage is not measurable against a declared European scope.
- Hub coordinates were curated offsets without authoritative stop IDs.
- Importing the fixture must never report production readiness.

### Why GeoNames import alone is insufficient

- `cities15000` populated places ≠ RailMeet meeting cities.
- Without an authoritative primary hub, routing collapses to centroid coordinate routing.
- A real MOTIS stop ID (e.g. a coach stop near a landmark) is identity, not intercity suitability.

## Decision

1. Keep `0008`–`0011` immutable once applied (bootstrap / schema / legacy deactivation / ownership).
2. Forward migration `0012` adds source-owned `population` and `feature_code` for eligibility.
3. Separate **offline fixtures** from **production source artifacts** from **imported DB state**.
4. Production cities: official GeoNames `cities15000.zip` → deterministic European filter
   (`geonames-europe-ppl-v1`) → versioned artifact + manifest checksum.
5. Meeting-city eligibility is a separate versioned policy (`meeting-city-v2`): admin feature codes
   and a documented population floor, plus an authoritative primary hub for routable candidates.
6. Production hubs: Transitous MOTIS geocode STOP matches (manually retrieved, cached) with real
   stop IDs and structured `modes` for capability classification. Never invent MOTIS IDs.
7. Deterministic city↔hub association preferring intercity/regional rail over local bus/metro;
   ambiguous matches are reported.
8. Centroid fallback is not production candidate support and does not count toward readiness.
9. Honest readiness states: partial hub coverage must not report `production-catalog-ready`.
10. Idempotent transactional importer; soft-deactivate removed source-owned rows; preserve `manual`.
11. Fail searches with typed codes when the production catalog is absent, fixture-only, or unusable.
12. CI validates offline fixtures and runs PostGIS/Testcontainers importer tests without network.
13. Provider plan normalization isolates malformed itineraries so one bad geometry/mode does not
    erase sibling valid journeys.

## Alternatives considered

| Alternative                             | Why rejected                                                        |
| --------------------------------------- | ------------------------------------------------------------------- |
| Grow the SQL seed forever               | Migrations are a poor refresh channel; no checksum/version workflow |
| Treat curated JSON as production Europe | Misleading readiness; no reproducible GeoNames path                 |
| Use autocomplete results as the catalog | Origins ≠ meeting cities; pollutes production catalog               |
| Route only to city centroids            | Works poorly vs provider stop graphs; hubs preferred                |
| Import inside migrations                | Network + large dumps in migrate is unsafe                          |
| Restrict candidates to origin countries | Incorrect product constraint (London+Paris may meet in Brussels)    |
| Invent MOTIS stop IDs                   | Provider identities must come from the provider                     |
| Arbitrary weighted name matching        | Non-auditable; display-name collisions across countries             |
| Claim ready after GeoNames import       | False readiness when hubs are sparse or weak                        |

## Consequences

- Operators run download → build → enrich-hubs → import for production catalogs.
- `pnpm catalog:status` reports fixture-only vs partial vs ready explicitly.
- Ranking algorithms and the 60-minute arrival tolerance remain unchanged.
- Completed searches remain reconstructable after catalog refresh/deactivation.
- Europe-wide `production-catalog-ready` requires every tier-eligible city to have a primary hub;
  until then status remains partial with measured coverage.
