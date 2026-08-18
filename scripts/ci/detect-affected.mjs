#!/usr/bin/env node
/**
 * Affected-change detection for CI.
 *
 * Compares base..head SHAs and outputs boolean flags indicating which
 * services/areas are affected. Derives paths from the actual workspace
 * dependency graph — not guessed from package names.
 *
 * Usage:
 *   node scripts/ci/detect-affected.mjs --base <sha> --head <sha>
 *   node scripts/ci/detect-affected.mjs --files path1 path2 ...  (test mode)
 *
 * Outputs JSON to stdout and sets GitHub Actions outputs when $GITHUB_OUTPUT is set.
 */

import { execSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';

// ---------------------------------------------------------------------------
// Path → area mapping derived from actual workspace dependency graph
// ---------------------------------------------------------------------------

/** Root files that affect all production builds (install/prune/compile). */
const GLOBAL_BUILD_INPUTS = [
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'turbo.json',
  'tsconfig.base.json',
  '.npmrc',
  '.dockerignore',
];

const MIGRATION_SCHEMA_INPUTS = [
  'packages/database/migrations/',
  'packages/database/migrations/meta/',
];

const MIGRATION_IMAGE_INPUTS = [
  'infra/migration.Dockerfile',
  'packages/database/src/migrate-cli.ts',
  'packages/database/package.json',
];

/**
 * Workspace packages and which services they affect.
 * Derived from package.json dependencies and turbo dry-run results.
 */
const PACKAGE_SERVICE_MAP = {
  'packages/shared': ['api', 'worker', 'web'],
  'packages/validation': ['api', 'web'],
  'packages/config': ['api', 'worker'],
  'packages/observability': ['api', 'worker'],
  'packages/search-engine': ['api', 'worker'],
  'packages/database': ['api', 'worker'],
  'packages/routing': ['api', 'worker'],
  'packages/queue': ['worker'],
  'packages/catalog': ['worker'],
};

/**
 * Classify a single changed file path into affected areas.
 * Returns a Set of area strings.
 */
export function classifyFile(filePath) {
  const areas = new Set();

  // Root global build inputs → all services
  if (GLOBAL_BUILD_INPUTS.includes(filePath)) {
    areas.add('api');
    areas.add('worker');
    areas.add('web');
    areas.add('migration_image');
    return areas;
  }

  // CI infrastructure → all services (conservative: proves the new workflow works)
  if (filePath.startsWith('.github/') || filePath.startsWith('scripts/ci/')) {
    areas.add('api');
    areas.add('worker');
    areas.add('web');
    areas.add('database');
    areas.add('integration');
    return areas;
  }

  // Dockerfiles → relevant services
  if (filePath.startsWith('infra/')) {
    areas.add('api');
    areas.add('worker');
    areas.add('database');
    if (filePath === 'infra/migration.Dockerfile') {
      areas.add('migration_image');
    }
    return areas;
  }

  // App-level changes
  if (filePath.startsWith('apps/api/')) {
    areas.add('api');
    return areas;
  }
  if (filePath.startsWith('apps/worker/')) {
    areas.add('worker');
    return areas;
  }
  if (filePath.startsWith('apps/web/')) {
    areas.add('web');
    return areas;
  }

  // Package-level changes
  for (const [pkgPath, services] of Object.entries(PACKAGE_SERVICE_MAP)) {
    if (filePath.startsWith(pkgPath + '/')) {
      for (const svc of services) {
        areas.add(svc);
      }
      // Database sub-classification handled below
      break;
    }
  }

  // Migration schema changes that require database migration runbook
  if (MIGRATION_SCHEMA_INPUTS.some((prefix) => filePath.startsWith(prefix))) {
    areas.add('migration');
    areas.add('migration_image');
  }

  // Inputs requiring migration image rebuild, but not always schema apply
  if (MIGRATION_IMAGE_INPUTS.includes(filePath)) {
    areas.add('migration_image');
  }

  // Database source (non-migration) → also flag 'database' for integration test relevance
  if (filePath.startsWith('packages/database/')) {
    areas.add('database');
  }

  // Catalog data changes
  if (filePath.startsWith('packages/catalog/')) {
    areas.add('catalog');
  }

  // Docs-only detection handled at aggregate level
  if (filePath.startsWith('docs/') || filePath.endsWith('.md')) {
    areas.add('docs');
  }

  return areas;
}

/**
 * Given a list of changed file paths, compute the full affected output.
 */
export function computeAffected(files) {
  const allAreas = new Set();

  for (const f of files) {
    for (const area of classifyFile(f)) {
      allAreas.add(area);
    }
  }

  const web = allAreas.has('web');
  const api = allAreas.has('api');
  const worker = allAreas.has('worker');
  const database = allAreas.has('database');
  const migration = allAreas.has('migration');
  const migration_image = allAreas.has('migration_image');
  const catalog = allAreas.has('catalog');

  // Integration tests needed when database, queue, catalog, worker, or CI infra changed
  const integration = database || worker || catalog || allAreas.has('integration');

  // docs_only: only docs areas, no production service affected
  const docs_only =
    !web &&
    !api &&
    !worker &&
    !database &&
    !migration &&
    !migration_image &&
    !catalog &&
    allAreas.has('docs');

  return {
    web,
    api,
    worker,
    database,
    migration,
    migration_image,
    catalog,
    integration,
    docs_only,
  };
}

/**
 * Get changed files between two commits using git diff.
 */
function getChangedFiles(baseSha, headSha) {
  const cmd = `git diff --name-only --diff-filter=ACDMR ${baseSha}...${headSha}`;
  const output = execSync(cmd, { encoding: 'utf8' }).trim();
  if (!output) return [];
  return output.split('\n').filter(Boolean);
}

function parseArgs(argv) {
  const args = argv.slice(2);
  let base = null;
  let head = null;
  let files = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--base' && args[i + 1]) {
      base = args[++i];
    } else if (args[i] === '--head' && args[i + 1]) {
      head = args[++i];
    } else if (args[i] === '--files') {
      files = args.slice(i + 1);
      break;
    }
  }

  return { base, head, files };
}

function main() {
  const { base, head, files: explicitFiles } = parseArgs(process.argv);

  let files;
  if (explicitFiles && explicitFiles.length > 0) {
    files = explicitFiles;
  } else if (base && head) {
    files = getChangedFiles(base, head);
  } else {
    console.error('Usage: --base <sha> --head <sha>  OR  --files <path1> <path2> ...');
    process.exit(1);
  }

  const result = computeAffected(files);

  // Output JSON
  const output = JSON.stringify(result, null, 2);
  console.log(output);

  // Set GitHub Actions outputs
  const ghOutput = process.env.GITHUB_OUTPUT;
  if (ghOutput) {
    for (const [key, value] of Object.entries(result)) {
      appendFileSync(ghOutput, `${key}=${value}\n`);
    }
  }
}

// Run main only when executed directly (not imported for testing)
const isDirectRun = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'));
if (isDirectRun || (!process.argv[1] && import.meta.url === `file://${process.argv[1]}`)) {
  // Fallback: always run main if not obviously imported
}

// Detect if this is the entry point
const entryUrl = `file://${process.argv[1]}`;
if (import.meta.url === entryUrl || import.meta.url === entryUrl.replace(/\\/g, '/')) {
  main();
}
