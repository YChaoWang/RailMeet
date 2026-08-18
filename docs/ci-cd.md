# CI/CD

## Branch Strategy

- `main` is the production branch. Merges to `main` trigger deployment.
- Development uses `feature/*`, `fix/*`, `refactor/*`, `chore/*`, `docs/*`, `test/*` branches.

## Pull Request CI

All PRs targeting `main` run the `CI` workflow (`.github/workflows/ci.yml`):

1. **detect** — Affected-change detection (outputs which services need build/test).
2. **check** — lint, typecheck, unit tests, affected production builds.
3. **integration** — Database + queue integration tests (only when `integration=true`).
4. **required-check** — Gate job for branch protection. Always runs; aggregates results.

GitHub required check: `CI / required-check`

## Affected Detection

`scripts/ci/detect-affected.mjs` compares base↔head SHAs and outputs:
`web`, `api`, `worker`, `database`, `migration`, `migration_image`, `catalog`, `integration`, `docs_only`.

Paths are derived from the workspace dependency graph:
- Root config (lockfile, turbo.json, tsconfig.base) → all services.
- `packages/database/migrations/` and journal files → `migration=true` and `migration_image=true`.
- `infra/migration.Dockerfile` and `packages/database/src/migrate-cli.ts` → `migration_image=true`, `migration=false`.
- Changes only in `docs/` or `.md` files → `docs_only=true`.

Only `migration=true` emits the **DATABASE MIGRATION RELEASE REQUIRED** warning.

## Normal CD

| Service | Platform | Trigger |
|---------|----------|---------|
| Web | Vercel | Push to `main` |
| API | Northflank Combined Service | Push to `main` (path rules) |
| Worker | Northflank Combined Service | Push to `main` (path rules) |

## Vercel Configuration

- Root Directory: `apps/web`
- Framework: Next.js
- Skip Deployments: use `vercel.json` or Ignored Build Step when only non-web files change.

## Northflank Path Rules

### API
```
apps/api/**
packages/shared/**
packages/validation/**
packages/config/**
packages/observability/**
packages/search-engine/**
packages/database/**
packages/routing/**
package.json
pnpm-lock.yaml
pnpm-workspace.yaml
turbo.json
tsconfig.base.json
.npmrc
.dockerignore
```

### Worker
```
apps/worker/**
packages/shared/**
packages/config/**
packages/observability/**
packages/search-engine/**
packages/database/**
packages/routing/**
packages/queue/**
packages/catalog/**
package.json
pnpm-lock.yaml
pnpm-workspace.yaml
turbo.json
tsconfig.base.json
.npmrc
.dockerignore
```

### Migration Job
```
infra/migration.Dockerfile
packages/database/migrations/**
packages/database/src/migrate-cli.ts
packages/database/package.json
package.json
pnpm-lock.yaml
pnpm-workspace.yaml
turbo.json
tsconfig.base.json
.npmrc
.dockerignore
```

## Release Identity

Each service exposes safe metadata (never secrets):
- `SERVICE_NAME`, `APP_VERSION`, `GIT_SHA`, `DEPLOYED_AT`

**API**: `/health` returns `{ status, service, version, gitSha, timestamp }`.
**Worker**: Structured `worker_ready` log includes release fields.
**Web**: `NEXT_PUBLIC_GIT_SHA` and `NEXT_PUBLIC_APP_VERSION` (derived from `VERCEL_GIT_COMMIT_SHA`).
**Migration**: Logs start/completion with SHA.

## Failure Behavior

- CI failure blocks merge (branch protection on `required-check`).
- CD failure on Northflank: manual rollback to previous SHA.
- Vercel: automatic rollback via Vercel dashboard.

## Rollback

- **Web**: Promote previous deployment in Vercel.
- **API/Worker**: Redeploy previous SHA in Northflank.
- **Migration**: Forward-fix preferred; never automatically run down migrations.

## Production Smoke Test

See `docs/production-smoke-test.md` for the manual post-deployment checklist.
