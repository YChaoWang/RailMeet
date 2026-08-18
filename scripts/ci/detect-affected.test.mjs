#!/usr/bin/env node
/**
 * Tests for detect-affected.mjs
 * Run: node scripts/ci/detect-affected.test.mjs
 */

import { strict as assert } from 'node:assert';
import { computeAffected, classifyFile } from './detect-affected.mjs';

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (e) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${e.message}`);
    process.exitCode = 1;
  }
}

console.log('detect-affected tests\n');

// --- classifyFile unit tests ---

test('docs only file', () => {
  const areas = classifyFile('docs/architecture.md');
  assert(areas.has('docs'));
  assert(!areas.has('api'));
  assert(!areas.has('worker'));
  assert(!areas.has('web'));
});

test('README.md at root is docs', () => {
  const areas = classifyFile('README.md');
  assert(areas.has('docs'));
});

test('apps/web file → web', () => {
  const areas = classifyFile('apps/web/src/app/layout.tsx');
  assert(areas.has('web'));
  assert(!areas.has('api'));
  assert(!areas.has('worker'));
});

test('apps/api file → api', () => {
  const areas = classifyFile('apps/api/src/index.ts');
  assert(areas.has('api'));
  assert(!areas.has('worker'));
});

test('apps/worker file → worker', () => {
  const areas = classifyFile('apps/worker/src/app.ts');
  assert(areas.has('worker'));
  assert(!areas.has('api'));
});

test('packages/queue → worker only', () => {
  const areas = classifyFile('packages/queue/src/dispatcher.ts');
  assert(areas.has('worker'));
  assert(!areas.has('api'));
  assert(!areas.has('web'));
});

test('packages/validation → api + web', () => {
  const areas = classifyFile('packages/validation/src/meeting-search.ts');
  assert(areas.has('api'));
  assert(areas.has('web'));
  assert(!areas.has('worker'));
});

test('packages/database/src → api + worker + database', () => {
  const areas = classifyFile('packages/database/src/client.ts');
  assert(areas.has('api'));
  assert(areas.has('worker'));
  assert(areas.has('database'));
  assert(!areas.has('migration'));
});

test('packages/database/migrations SQL → api + worker + database + migration', () => {
  const areas = classifyFile('packages/database/migrations/0013_next.sql');
  assert(areas.has('api'));
  assert(areas.has('worker'));
  assert(areas.has('database'));
  assert(areas.has('migration'));
  assert(areas.has('migration_image'));
});

test('packages/database/migrations/meta/_journal.json → migration', () => {
  const areas = classifyFile('packages/database/migrations/meta/_journal.json');
  assert(areas.has('migration'));
  assert(areas.has('migration_image'));
});

test('root package.json → all services', () => {
  const areas = classifyFile('package.json');
  assert(areas.has('api'));
  assert(areas.has('worker'));
  assert(areas.has('web'));
});

test('pnpm-lock.yaml → all services', () => {
  const areas = classifyFile('pnpm-lock.yaml');
  assert(areas.has('api'));
  assert(areas.has('worker'));
  assert(areas.has('web'));
});

test('packages/catalog → worker + catalog', () => {
  const areas = classifyFile('packages/catalog/src/import.ts');
  assert(areas.has('worker'));
  assert(areas.has('catalog'));
  assert(!areas.has('api'));
});

// --- computeAffected integration tests ---

test('docs only → docs_only=true', () => {
  const r = computeAffected(['docs/architecture.md', 'docs/README.md']);
  assert.equal(r.docs_only, true);
  assert.equal(r.api, false);
  assert.equal(r.worker, false);
  assert.equal(r.web, false);
  assert.equal(r.migration, false);
});

test('web only', () => {
  const r = computeAffected(['apps/web/src/app/page.tsx']);
  assert.equal(r.web, true);
  assert.equal(r.api, false);
  assert.equal(r.worker, false);
  assert.equal(r.docs_only, false);
});

test('API only', () => {
  const r = computeAffected(['apps/api/src/routes/places.ts']);
  assert.equal(r.api, true);
  assert.equal(r.worker, false);
  assert.equal(r.web, false);
});

test('Worker only', () => {
  const r = computeAffected(['apps/worker/src/finalization.ts']);
  assert.equal(r.worker, true);
  assert.equal(r.api, false);
  assert.equal(r.integration, true);
});

test('queue package → worker + integration', () => {
  const r = computeAffected(['packages/queue/src/consumer.ts']);
  assert.equal(r.worker, true);
  assert.equal(r.api, false);
  assert.equal(r.integration, true);
});

test('validation package → api + web, no worker', () => {
  const r = computeAffected(['packages/validation/src/primitives.ts']);
  assert.equal(r.api, true);
  assert.equal(r.web, true);
  assert.equal(r.worker, false);
  assert.equal(r.integration, false);
});

test('database source (non-migration) → api + worker + database + integration', () => {
  const r = computeAffected(['packages/database/src/models.ts']);
  assert.equal(r.api, true);
  assert.equal(r.worker, true);
  assert.equal(r.database, true);
  assert.equal(r.integration, true);
  assert.equal(r.migration, false);
  assert.equal(r.migration_image, false);
});

test('database migration → api + worker + database + migration + integration', () => {
  const r = computeAffected(['packages/database/migrations/0013_new.sql']);
  assert.equal(r.api, true);
  assert.equal(r.worker, true);
  assert.equal(r.database, true);
  assert.equal(r.migration, true);
  assert.equal(r.migration_image, true);
  assert.equal(r.integration, true);
});

test('root lockfile → all services', () => {
  const r = computeAffected(['pnpm-lock.yaml']);
  assert.equal(r.api, true);
  assert.equal(r.worker, true);
  assert.equal(r.web, true);
});

test('file deletion (path still classifies)', () => {
  const r = computeAffected(['apps/api/src/deleted-route.ts']);
  assert.equal(r.api, true);
});

test('file rename (new path classifies)', () => {
  const r = computeAffected(['packages/shared/src/renamed-file.ts']);
  assert.equal(r.api, true);
  assert.equal(r.worker, true);
  assert.equal(r.web, true);
});

test('mixed changes', () => {
  const r = computeAffected([
    'docs/testing.md',
    'apps/web/src/components/ui/button.tsx',
    'packages/queue/src/contract.ts',
  ]);
  assert.equal(r.web, true);
  assert.equal(r.worker, true);
  assert.equal(r.api, false);
  assert.equal(r.docs_only, false);
  assert.equal(r.integration, true);
});

test('empty file list → docs_only=false, nothing affected', () => {
  const r = computeAffected([]);
  assert.equal(r.docs_only, false);
  assert.equal(r.api, false);
  assert.equal(r.worker, false);
  assert.equal(r.web, false);
  assert.equal(r.migration_image, false);
});

// --- CI infrastructure conservative classification ---

test('.github/workflows/ci.yml → all services + integration', () => {
  const r = computeAffected(['.github/workflows/ci.yml']);
  assert.equal(r.api, true);
  assert.equal(r.worker, true);
  assert.equal(r.web, true);
  assert.equal(r.database, true);
  assert.equal(r.integration, true);
  assert.equal(r.docs_only, false);
});

test('scripts/ci/detect-affected.mjs → all services + integration', () => {
  const r = computeAffected(['scripts/ci/detect-affected.mjs']);
  assert.equal(r.api, true);
  assert.equal(r.worker, true);
  assert.equal(r.web, true);
  assert.equal(r.integration, true);
});

test('infra/migration.Dockerfile → api + worker + migration_image + database', () => {
  const r = computeAffected(['infra/migration.Dockerfile']);
  assert.equal(r.api, true);
  assert.equal(r.worker, true);
  assert.equal(r.migration, false);
  assert.equal(r.migration_image, true);
  assert.equal(r.database, true);
  assert.equal(r.web, false);
});

test('apps/api/Dockerfile → api only', () => {
  const r = computeAffected(['apps/api/Dockerfile']);
  assert.equal(r.api, true);
  assert.equal(r.worker, false);
  assert.equal(r.web, false);
});

test('apps/worker/Dockerfile → worker only', () => {
  const r = computeAffected(['apps/worker/Dockerfile']);
  assert.equal(r.worker, true);
  assert.equal(r.api, false);
  assert.equal(r.web, false);
});

test('turbo.json → all services', () => {
  const r = computeAffected(['turbo.json']);
  assert.equal(r.api, true);
  assert.equal(r.worker, true);
  assert.equal(r.web, true);
});

test('tsconfig.base.json → all services', () => {
  const r = computeAffected(['tsconfig.base.json']);
  assert.equal(r.api, true);
  assert.equal(r.worker, true);
  assert.equal(r.web, true);
  assert.equal(r.migration_image, true);
});

test('migration CLI source → migration_image only (not schema migration)', () => {
  const r = computeAffected(['packages/database/src/migrate-cli.ts']);
  assert.equal(r.migration, false);
  assert.equal(r.migration_image, true);
  assert.equal(r.database, true);
});

test('database package manifest → migration_image true', () => {
  const r = computeAffected(['packages/database/package.json']);
  assert.equal(r.migration, false);
  assert.equal(r.migration_image, true);
});

test('docs-only keeps migration and migration_image false', () => {
  const r = computeAffected(['docs/migration-notes.md']);
  assert.equal(r.docs_only, true);
  assert.equal(r.migration, false);
  assert.equal(r.migration_image, false);
});

console.log('\nAll tests passed ✓');
