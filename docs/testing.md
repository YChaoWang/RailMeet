# Testing

How RailMeet validates behavior, what runs in default CI, and what requires Docker/Redis.

## Commands

| Command | Scope | Infrastructure |
| ------- | ----- | -------------- |
| `pnpm test` | Unit + component + Fastify inject | None |
| `pnpm test:integration` | Database + catalog import | Docker (Testcontainers) |
| `pnpm test:integration:queue` | Outbox, BullMQ, worker/queue recovery | Docker + Redis |
| `pnpm test:integration:transitous` | Single live Transitous plan smoke | Network (opt-in) |

Default `pnpm test` **excludes** `*.integration.test.ts` in database, queue, worker, and catalog packages.

## Package overview

| Package / app | Default tests | Focus |
| ------------- | ------------- | ----- |
| `@railmeet/shared` | ~23 | Enums, calendar, MOTIS labels, route summary |
| `@railmeet/validation` | ~36 | Zod request/response contracts |
| `@railmeet/config` | ~28 | Environment schema bounds |
| `@railmeet/search-engine` | ~32 | Ranking modes, tie-breaks, feasibility |
| `@railmeet/routing` | ~78 | Transitous client, MOTIS normalization, plan cache |
| `@railmeet/database` | ~7 unit (+ integration separately) | Leg JSON parsing, client factory |
| `@railmeet/queue` | ~21 unit (+ integration separately) | Dispatcher, job validation |
| `@railmeet/catalog` | ~19 unit (+ integration separately) | Hub ids, import readiness |
| `@railmeet/api` | ~52 | HTTP mapping, envelopes, journey detail |
| `@railmeet/worker` | ~3 unit (+ integration separately) | Kickoff, persistence wiring |
| `@railmeet/web` | ~91 | UI components, polling, map scene, journey timeline |

Approximate total default suite: **~390 tests**, ~8–14 s wall clock (Turbo parallel).

## Web test layers

| Layer | Files | Purpose |
| ----- | ----- | ------- |
| Pure logic | `*.test.ts` in `src/lib/` | Timezones, transfers, map markers, view models |
| Components | `*.test.tsx` | Render + interaction (jsdom) |
| Integration-style | `search-results-view`, `journey-details-panel`, autocomplete | Fetch mocks, cache, real combobox boundary |

**Conventions**

- `.test.ts` — no React; fast logic tests.
- `.test.tsx` — requires jsdom when rendering components.
- MapLibre stubbed via `disableMap` or module mocks in unit tests.

### High-value web regressions

- Berlin→York multimodal fixture (service identity, overnight header, transfers)
- Journey detail fetch dedupe and `detailSource=legacy` routing
- Results cache: one fetch per `journeyId`, no Transitous on ranking/candidate switch
- Real autocomplete → map marker (integration test); multi-marker lifecycle (mocked combobox page test)

## API tests

Fastify `inject()` — no real ports. Covers status codes, envelope stripping, journey detail provider vs legacy, results `409` when not ready.

## Integration tests (not in default `pnpm test`)

Run explicitly before release or when changing pipeline semantics:

- **Database** — atomic create+outbox, candidate generation, finalization, phase-9 results ordering
- **Queue** — claim/lease, dispatch dedupe, consumer kickoff
- **Worker** — phase 7/8 recovery: CAS winners, commit-before-ack, Redis pause, malformed jobs
- **Catalog** — idempotent import, fixture cleanup guards

## Fixtures

| Fixture | Location | Used for |
| ------- | -------- | -------- |
| `transitous-berlin-york.json` | `packages/routing/src/fixtures/` | Multimodal overnight journey UI/tests |
| `transitous-manchester-york.json` | same | UK operators, walking, alerts |
| Ranking golden data | `packages/search-engine/src/ranking.test.ts` | Four-mode winners and tie-breaks |

## Layered duplication (intentional)

Validation, API, and database integration tests overlap on reject rules (participants, countries, modes). This is **deliberate**: Zod shape vs HTTP mapping vs CHECK constraints. Do not delete one layer without moving the assertion elsewhere.

## Gaps and follow-ups

- No Playwright e2e in CI — journey UI verified via component tests + optional screenshot script.
- DST boundary not fixture-tested explicitly (relies on `Intl` timezone database).
- Cancelled-service UI depends on provider alert fixtures in MOTIS payloads.

See root [README](../README.md) for prerequisites (Node 22+, pnpm 10+, Docker for integration).
