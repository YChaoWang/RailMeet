# Production Smoke Test (Manual)

Perform after every production deployment. Browser-based, not automated.

## Checklist

- [ ] **Web loads** — Navigate to production URL; no 500/blank page.
- [ ] **API `/health`** — Returns `{ status: "ok", version, gitSha }` with expected SHA.
- [ ] **API `/ready`** — Returns `{ status: "ready" }`.
- [ ] **Worker ready logs** — Check Northflank logs for `worker_ready` event with correct SHA.
- [ ] **Create a new search** — Create a multi-participant meeting search via the UI.
- [ ] **Job progresses** — Search status moves `queued → running → completed`.
- [ ] **Results exist** — Results contain `journeyId` values.
- [ ] **Journey Detail** — Expand a journey; verify `detailSource="provider"` (fresh fetch).
- [ ] **Record SHAs** — Note Web/API/Worker deployed SHAs for the release record.

## Dashboard Checklist

### GitHub Branch Protection (`main`)

- Require status check: `CI / required-check`
- Require branch to be up to date: optional (recommended off for merge throughput)
- Require PR review: recommended

### Vercel (Web)

- Root Directory: `apps/web`
- Framework Preset: Next.js
- Environment Variables: `NEXT_PUBLIC_API_BASE_URL`

### Northflank — API Combined Service

- Branch: `main`
- CD: enabled (pause during migration releases)
- Dockerfile: `apps/api/Dockerfile`
- Build context: `/`
- Path Rules mode: Allow
- Path Rules: see `docs/ci-cd.md`
- Environment: `DATABASE_URL`, `REDIS_URL`, `API_BASE_URL`, `WEB_ORIGIN`, `TRANSITOUS_USER_AGENT`, `APP_VERSION`, `DEPLOYED_AT`
- `gitSha`: Northflank injects `NF_DEPLOYMENT_SHA` automatically. `GIT_SHA` is an optional override.
- `APP_VERSION` remains operator-defined.

### Northflank — Worker Combined Service

- Branch: `main`
- CD: enabled (pause during migration releases)
- Dockerfile: `apps/worker/Dockerfile`
- Build context: `/`
- Path Rules mode: Allow
- Path Rules: see `docs/ci-cd.md`
- Environment: `DATABASE_URL`, `REDIS_URL`, `API_BASE_URL`, `TRANSITOUS_USER_AGENT`, `APP_VERSION`, `DEPLOYED_AT`
- `gitSha`: Northflank injects `NF_DEPLOYMENT_SHA` automatically. `GIT_SHA` is an optional override.
- `APP_VERSION` remains operator-defined.

### Northflank — Migration Manual Job

- Dockerfile: `infra/migration.Dockerfile`
- Build context: `/`
- Environment: `DATABASE_URL_DIRECT` (or `DATABASE_URL`), `GIT_SHA`
- Run: manually triggered per migration-runbook

### Required Secrets/Variables

| Variable | API | Worker | Migration | Web |
|----------|:---:|:------:|:---------:|:---:|
| DATABASE_URL | ✓ | ✓ | fallback | |
| DATABASE_URL_DIRECT | | | ✓ | |
| REDIS_URL | ✓ | ✓ | | |
| API_BASE_URL | ✓ | ✓ | | |
| WEB_ORIGIN | ✓ | | | |
| TRANSITOUS_USER_AGENT | ✓ | ✓ | | |
| GIT_SHA (optional override) | ✓ | ✓ | ✓ | auto |
| NF_DEPLOYMENT_SHA (Northflank injected) | auto | auto | | |
| APP_VERSION (operator-defined) | ✓ | ✓ | | auto |
| DEPLOYED_AT | ✓ | ✓ | | |
| NEXT_PUBLIC_API_BASE_URL | | | | ✓ |
