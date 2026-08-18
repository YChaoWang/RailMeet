# Database Migration Runbook

## When to Use

Use this procedure when a PR includes committed schema migration changes in
`packages/database/migrations/` (SQL or journal/meta). CI will display:

> DATABASE MIGRATION RELEASE REQUIRED

If CI marks only `migration_image=true` (for example `infra/migration.Dockerfile` or
`packages/database/src/migrate-cli.ts`) and `migration=false`, rebuild the migration Job image
but do not run this schema-apply runbook automatically.

## Sequence

1. CI passes on the migration PR.
2. Pause API CD (Northflank → railmeet-api → Settings → CD off).
3. Pause Worker CD (Northflank → railmeet-worker → Settings → CD off).
4. Verify Neon backup / restore point exists.
5. Merge migration PR to `main`.
6. Wait for API, Worker, and migration image builds to complete.
7. Verify all builds use the expected commit SHA (`git log --oneline -1`).
8. Run the migration Job (Northflank → railmeet-migration → Run).
9. Verify: connect to Neon and check `drizzle.__drizzle_migrations` has the new entry.
10. If migration succeeded: deploy the selected API/Worker builds (Northflank → Deploy SHA).
11. Run health/readiness checks:
    - `GET /health` returns `status: "ok"` with correct `gitSha`.
    - `GET /ready` returns `status: "ready"`.
12. Run production smoke test (see `docs/production-smoke-test.md`).
13. Re-enable CD for API and Worker.
14. Record deployed SHAs in release notes or Slack.

## Failure Handling

- **Migration failure**: Do NOT deploy new API/Worker. Preserve logs. Investigate.
- **Do not blindly retry**. Understand the failure first.
- **Forward-fix preferred**: Create a new migration to correct the issue.
- **Never automatically run down migrations** in production.
- **If API/Worker deployed before migration**: Rollback API/Worker to previous SHA immediately.

## Environment Variables

- `DATABASE_URL_DIRECT` (preferred, bypasses connection pooler for DDL).
- `DATABASE_URL` (fallback).
- `GIT_SHA` (logged for traceability).

## Migration Image

- Dockerfile: `infra/migration.Dockerfile`
- Build: `docker build -f infra/migration.Dockerfile -t railmeet-migration .`
- Command: `node dist/migrate-cli.js`
