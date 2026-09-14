# RailMeet

Find the fairest European city for a group to meet, based on real public-transport journeys.

The map-first planner ranks meeting cities by fairness, total travel time, transfers, and arrival-time alignment. Coverage follows [Transitous](https://transitous.org).

Live: [railmeet.ichauw.com](https://railmeet.ichauw.com)

## Local setup

Requires Node.js 22+, pnpm 10+, and Docker.

```bash
pnpm install
cp .env.example .env
pnpm docker:up
pnpm build
pnpm db:migrate
pnpm dev
```

- Web: http://localhost:3000

On Apple Silicon, Compose uses `ghcr.io/baosystems/postgis:16-3.5` (arm64). If port `3001` is taken, change `API_PORT` and matching URLs in `.env`.

Environment variables are documented in [`.env.example`](./.env.example). Production catalog import is in [packages/catalog/README.md](./packages/catalog/README.md).

## Commands

| Command | Description |
| --- | --- |
| `pnpm dev` | Start web, api, worker, and watched packages |
| `pnpm test` | Unit tests |
| `pnpm test:integration` | Database integration tests (Docker) |
| `pnpm lint` / `pnpm typecheck` | Lint and type-check |
| `pnpm docker:up` / `pnpm docker:down` | Start or stop PostGIS and Redis |
| `pnpm db:migrate` | Apply committed SQL |

See `package.json` for the rest (`format`, `db:studio`, live Transitous smoke, and so on).

## Docs

[docs/README.md](./docs/README.md) is the index: architecture, domain, API, the async pipeline, UI, testing, and deploy.

Routing data © [Transitous](https://transitous.org) contributors and underlying GTFS/OSM sources.
