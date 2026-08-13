import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { createDatabase, type Database } from '@railmeet/database';
import { config as loadDotenv } from 'dotenv';

import { getCatalogReadiness } from './status.js';
import { isMeetingCityTierEligible, MEETING_CITY_POLICY_VERSION } from './eligibility.js';
import {
  downloadGeonamesCities15000,
  extractGeonamesTxt,
  loadSourceManifest,
  verifyGeonamesChecksum,
} from './geonames-download.js';
import { buildGeonamesCitiesArtifact, parseGeonamesCitiesFile } from './geonames-parse.js';
import {
  importCatalogArtifact,
  loadCatalogArtifactFile,
  printCatalogImportProgress,
} from './import.js';
import {
  artifactsDir,
  cacheDir,
  defaultFixturePath,
  geonamesCacheZipPath,
  geonamesCitiesArtifactPath,
  geonamesManifestPath,
  productionCatalogArtifactPath,
  transitousHubsArtifactPath,
} from './paths.js';
import {
  enrichHubsForCities,
  loadHubsSidecar,
  mergeCitiesAndHubs,
  writeHubsArtifact,
} from './transitous-hubs.js';
import {
  findHubIdCollisions,
  remapCatalogHubIds,
} from './hub-id.js';
import {
  cleanupOfflineFixture,
  FixtureCleanupAbortedError,
} from './cleanup-fixture.js';
import { validateCatalogArtifact } from './validate.js';
import type { CatalogArtifact } from './types.js';

function loadEnv(): void {
  loadDotenv({ path: join(defaultFixturePath(), '../../../.env') });
  loadDotenv({ path: join(process.cwd(), '.env') });
  loadDotenv({ path: join(process.cwd(), '../../.env') });
}

async function withDatabase<T>(fn: (database: Database) => Promise<T>): Promise<T> {
  loadEnv();
  const connectionString = process.env['DATABASE_URL_DIRECT'] ?? process.env['DATABASE_URL'];
  if (!connectionString) {
    throw new Error('DATABASE_URL_DIRECT or DATABASE_URL is required');
  }
  if (process.env['DATABASE_URL_DIRECT']) {
    console.error('catalog import using DATABASE_URL_DIRECT');
  } else {
    console.error('catalog import using DATABASE_URL (DATABASE_URL_DIRECT unset)');
  }
  const database = createDatabase({ connectionString });
  try {
    return await fn(database);
  } finally {
    await database.close();
  }
}

function parseArgs(argv: string[]): {
  readonly command: string | undefined;
  readonly positional: string[];
  readonly flags: Record<string, string | boolean>;
} {
  const [, , command, ...rest] = argv;
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i]!;
    if (token.startsWith('--')) {
      const key = token.slice(2);
      const next = rest[i + 1];
      if (next && !next.startsWith('--')) {
        flags[key] = next;
        i += 1;
      } else {
        flags[key] = true;
      }
    } else {
      positional.push(token);
    }
  }
  return { command, positional, flags };
}

function resolveArtifactPath(
  command: string,
  positional: string[],
  flags: Record<string, string | boolean>,
): string {
  if (positional[0]) {
    return positional[0];
  }
  const source = typeof flags['source'] === 'string' ? flags['source'] : undefined;
  if (source === 'geonames' || source === 'production') {
    if (existsSync(productionCatalogArtifactPath())) {
      return productionCatalogArtifactPath();
    }
    return geonamesCitiesArtifactPath();
  }
  if (source === 'fixture' || command === 'validate' || command === 'import') {
    return defaultFixturePath();
  }
  return defaultFixturePath();
}

async function buildGeonamesArtifact(): Promise<CatalogArtifact> {
  const zipPath = geonamesCacheZipPath();
  if (!existsSync(zipPath)) {
    throw new Error(`Missing ${zipPath}. Run: pnpm catalog:download --source geonames`);
  }
  const checksum = await verifyGeonamesChecksum();
  if (!checksum.ok || !checksum.sha256) {
    throw new Error(checksum.message);
  }
  const manifest = existsSync(geonamesManifestPath())
    ? loadSourceManifest(geonamesManifestPath())
    : null;
  const txtPath = join(cacheDir(), 'cities15000.txt');
  await extractGeonamesTxt(zipPath, txtPath);
  const { cities, diagnostics } = await parseGeonamesCitiesFile(txtPath);
  console.error(JSON.stringify({ event: 'geonames-parse', diagnostics }, null, 2));
  const artifact = buildGeonamesCitiesArtifact(cities, {
    sourceVersion: manifest?.version ?? `cities15000@unknown`,
    retrievedAt: manifest?.retrievedAt ?? new Date().toISOString(),
    sha256: checksum.sha256,
  });
  mkdirSync(artifactsDir(), { recursive: true });
  writeFileSync(geonamesCitiesArtifactPath(), `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
  return artifact;
}

async function main(): Promise<void> {
  const { command, positional, flags } = parseArgs(process.argv);

  if (command === 'download') {
    const source = typeof flags['source'] === 'string' ? flags['source'] : 'geonames';
    if (source !== 'geonames') {
      console.error('Supported: --source geonames');
      process.exit(2);
    }
    const expected =
      typeof flags['expected-sha256'] === 'string' ? flags['expected-sha256'] : undefined;
    const result = await downloadGeonamesCities15000(
      expected ? { expectedSha256: expected } : undefined,
    );
    console.log(JSON.stringify(result, null, 2));
    process.exit(0);
  }

  if (command === 'build') {
    const source = typeof flags['source'] === 'string' ? flags['source'] : 'geonames';
    if (source !== 'geonames') {
      console.error('Supported: --source geonames');
      process.exit(2);
    }
    const artifact = await buildGeonamesArtifact();
    console.log(
      JSON.stringify(
        {
          path: geonamesCitiesArtifactPath(),
          cityCount: artifact.cities.length,
          sourceVersion: artifact.sourceVersion,
          selectionPolicyVersion: artifact.selectionPolicyVersion,
        },
        null,
        2,
      ),
    );
    process.exit(0);
  }

  if (command === 'enrich-hubs') {
    const citiesPath =
      typeof flags['cities'] === 'string' ? flags['cities'] : geonamesCitiesArtifactPath();
    if (!existsSync(citiesPath)) {
      throw new Error(`Cities artifact missing: ${citiesPath}`);
    }
    const { artifact } = loadCatalogArtifactFile(citiesPath);
    const citiesArtifact = artifact as CatalogArtifact;
    const limitRaw = typeof flags['limit'] === 'string' ? Number(flags['limit']) : Number.NaN;
    const minPopRaw =
      typeof flags['min-population'] === 'string' ? Number(flags['min-population']) : Number.NaN;
    const countriesRaw =
      typeof flags['countries'] === 'string'
        ? flags['countries'].split(',').map((c) => c.trim().toUpperCase())
        : null;
    const cacheOnly = Boolean(flags['cache-only']);
    const refresh = Boolean(flags['refresh']);
    const dryRun = Boolean(flags['dry-run']);
    let cities = citiesArtifact.cities;
    if (countriesRaw && countriesRaw.length > 0) {
      const set = new Set(countriesRaw);
      cities = cities.filter((city) => set.has(city.countryCode));
    }
    if (Number.isFinite(minPopRaw)) {
      cities = cities.filter((city) => (city.population ?? 0) >= minPopRaw);
    } else {
      // Default enrichment wave: meeting-city-v2 tier only (not all GeoNames imports).
      cities = cities.filter((city) => {
        const input: {
          countryCode: string;
          featureClass?: string | null;
          featureCode?: string | null;
          population?: number | null;
        } = { countryCode: city.countryCode };
        if (city.featureClass !== undefined) {
          input.featureClass = city.featureClass;
        }
        if (city.featureCode !== undefined) {
          input.featureCode = city.featureCode;
        }
        if (city.population !== undefined) {
          input.population = city.population;
        }
        return isMeetingCityTierEligible(input);
      });
    }
    const enrichOptions: {
      readonly cacheOnly: boolean;
      readonly refresh: boolean;
      readonly delayMs: number;
      readonly limit?: number;
    } = {
      cacheOnly,
      refresh,
      delayMs: 150,
    };
    if (Number.isFinite(limitRaw)) {
      (enrichOptions as { limit: number }).limit = limitRaw;
    }

    if (dryRun) {
      const existingHubs = existsSync(transitousHubsArtifactPath())
        ? loadHubsSidecar(transitousHubsArtifactPath()).hubs
        : [];
      const hubbedCityIds = new Set(existingHubs.map((hub) => hub.cityId));
      console.log(
        JSON.stringify(
          {
            dryRun: true,
            meetingCityPolicyVersion: MEETING_CITY_POLICY_VERSION,
            eligibleProductionCities: cities.length,
            citiesAlreadyHavingHubArtifact: cities.filter((city) => hubbedCityIds.has(city.id))
              .length,
            citiesNeedingEnrichment: cities.filter((city) => !hubbedCityIds.has(city.id)).length,
            existingHubArtifactCount: existingHubs.length,
            limit: Number.isFinite(limitRaw) ? limitRaw : cities.length,
            refresh,
            cacheOnly,
            note: 'Run without --dry-run to fetch/associate and rewrite hubs artifact',
          },
          null,
          2,
        ),
      );
      process.exit(0);
    }

    const report = await enrichHubsForCities(cities, enrichOptions);
    const existingHubs = existsSync(transitousHubsArtifactPath())
      ? loadHubsSidecar(transitousHubsArtifactPath()).hubs
      : [];
    const byCity = new Map<string, (typeof report.hubs)[number]>();
    for (const hub of existingHubs) {
      byCity.set(hub.cityId, hub);
    }
    for (const hub of report.hubs) {
      byCity.set(hub.cityId, hub);
    }
    const mergedHubs = [...byCity.values()].sort((a, b) =>
      a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
    );
    const retrievedAt = new Date().toISOString();
    writeHubsArtifact(mergedHubs, {
      sourceVersion: `transitous-geocode@${retrievedAt.slice(0, 10)}`,
      retrievedAt,
      citiesSourceVersion: citiesArtifact.sourceVersion,
    });
    const merged = mergeCitiesAndHubs(citiesArtifact, mergedHubs);
    writeFileSync(productionCatalogArtifactPath(), `${JSON.stringify(merged, null, 2)}\n`, 'utf8');
    console.log(
      JSON.stringify(
        {
          hubsPath: transitousHubsArtifactPath(),
          productionPath: productionCatalogArtifactPath(),
          matched: report.matched,
          ambiguous: report.ambiguous,
          rejected: report.rejected,
          cityCount: merged.cities.length,
          hubCount: merged.hubs.length,
          previousHubCount: existingHubs.length,
        },
        null,
        2,
      ),
    );
    process.exit(0);
  }

  if (command === 'merge') {
    const citiesPath =
      typeof flags['cities'] === 'string' ? flags['cities'] : geonamesCitiesArtifactPath();
    const hubsPath =
      typeof flags['hubs'] === 'string' ? flags['hubs'] : transitousHubsArtifactPath();
    const { artifact } = loadCatalogArtifactFile(citiesPath);
    const { hubs } = loadHubsSidecar(hubsPath);
    const merged = mergeCitiesAndHubs(artifact as CatalogArtifact, hubs);
    writeFileSync(productionCatalogArtifactPath(), `${JSON.stringify(merged, null, 2)}\n`, 'utf8');
    console.log(
      JSON.stringify(
        {
          path: productionCatalogArtifactPath(),
          cityCount: merged.cities.length,
          hubCount: merged.hubs.length,
        },
        null,
        2,
      ),
    );
    process.exit(0);
  }

  if (command === 'remap-hub-ids') {
    const hubsPath =
      typeof flags['hubs'] === 'string' ? flags['hubs'] : transitousHubsArtifactPath();
    const citiesPath =
      typeof flags['cities'] === 'string' ? flags['cities'] : geonamesCitiesArtifactPath();
    const loaded = loadHubsSidecar(hubsPath);
    const before = findHubIdCollisions(loaded.hubs);
    const remapped = remapCatalogHubIds(loaded.hubs);
    const after = findHubIdCollisions(remapped);
    const retrievedAt = new Date().toISOString();
    const { artifact: citiesArtifact } = loadCatalogArtifactFile(citiesPath);
    writeHubsArtifact(remapped, {
      sourceVersion: `transitous-geocode@${retrievedAt.slice(0, 10)}+hub-id-v2`,
      retrievedAt,
      citiesSourceVersion: (citiesArtifact as CatalogArtifact).sourceVersion,
    });
    const merged = mergeCitiesAndHubs(citiesArtifact as CatalogArtifact, remapped);
    writeFileSync(productionCatalogArtifactPath(), `${JSON.stringify(merged, null, 2)}\n`, 'utf8');
    const validation = validateCatalogArtifact(merged);
    console.log(
      JSON.stringify(
        {
          hubsPath: transitousHubsArtifactPath(),
          productionPath: productionCatalogArtifactPath(),
          collisionsBefore: before,
          collisionsAfter: after,
          hubCount: merged.hubs.length,
          cityCount: merged.cities.length,
          idsChanged: remapped.filter((hub, index) => hub.id !== loaded.hubs[index]?.id).length,
          validation: {
            ok: validation.ok,
            duplicateHubIds: validation.duplicateHubIds.length,
            duplicateProviderStopIds: validation.duplicateProviderStopIds.length,
            rejectedCount: validation.rejectedRecords.length,
          },
        },
        null,
        2,
      ),
    );
    process.exit(validation.ok && after.duplicatedIdCount === 0 ? 0 : 1);
  }

  if (command === 'validate') {
    const path = resolveArtifactPath(command, positional, flags);
    const { artifact } = loadCatalogArtifactFile(path);
    const report = validateCatalogArtifact(artifact);
    console.log(JSON.stringify({ path, ...report }, null, 2));
    process.exit(report.ok ? 0 : 1);
  }

  if (command === 'import') {
    await withDatabase(async (database) => {
      const path = resolveArtifactPath(command, positional, flags);
      const { artifact, text } = loadCatalogArtifactFile(path);
      const result = await importCatalogArtifact(database, artifact, text, {
        onProgress: printCatalogImportProgress,
      });
      const report = result.report;
      console.log(
        JSON.stringify(
          {
            path,
            ok: result.ok,
            checksum: result.checksum,
            cityCount: result.cityCount,
            hubCount: result.hubCount,
            associationCount: result.associationCount,
            createdCount: result.createdCount,
            updatedCount: result.updatedCount,
            unchangedCount: result.unchangedCount,
            deactivatedCount: result.deactivatedCount,
            stableInternalIdsPreserved: result.stableInternalIdsPreserved,
            stats: result.stats,
            validation: {
              source: report.source,
              sourceVersion: report.sourceVersion,
              artifactKind: report.artifactKind,
              selectionPolicyVersion: report.selectionPolicyVersion,
              importedCityCount: report.importedCityCount,
              activeHubCount: report.activeHubCount,
              hubsWithProviderStopId: report.hubsWithProviderStopId,
              citiesWithoutHubsCount: report.citiesWithoutHubs.length,
              countriesCoveredCount: report.countriesCovered.length,
              ok: report.ok,
            },
          },
          null,
          2,
        ),
      );
      process.exit(result.ok ? 0 : 1);
    });
    return;
  }

  if (command === 'status') {
    await withDatabase(async (database) => {
      const result = await getCatalogReadiness(database);
      console.log(JSON.stringify(result, null, 2));
      process.exit(result.readiness.ready ? 0 : 1);
    });
    return;
  }

  if (command === 'cleanup-fixture') {
    const apply = flags['apply'] === true;
    await withDatabase(async (database) => {
      try {
        const result = await cleanupOfflineFixture(database, {
          apply,
          strictProductionValidation: apply,
        });
        console.log(
          JSON.stringify(
            {
              mode: apply ? 'apply' : 'dry-run',
              ...result,
            },
            null,
            2,
          ),
        );
        if (!apply) {
          process.exit(result.report.blocking ? 1 : 0);
          return;
        }
        if (!result.applied) {
          process.exit(1);
          return;
        }
        process.exit(result.validation.ok ? 0 : 1);
      } catch (error) {
        if (error instanceof FixtureCleanupAbortedError) {
          console.error(
            JSON.stringify(
              {
                mode: 'apply',
                aborted: true,
                message: error.message,
                report: error.report,
              },
              null,
              2,
            ),
          );
          process.exit(1);
        }
        throw error;
      }
    });
    return;
  }

  console.error(`Usage:
  catalog download --source geonames [--expected-sha256 HEX]
  catalog build --source geonames
  catalog enrich-hubs [--cities PATH] [--limit N] [--cache-only]
  catalog merge [--cities PATH] [--hubs PATH]
  catalog remap-hub-ids [--cities PATH] [--hubs PATH]
  catalog validate [--source fixture|geonames|production] [artifact.json]
  catalog import [--source fixture|geonames|production] [artifact.json]
  catalog cleanup-fixture [--apply]
  catalog status`);
  process.exit(2);
}

void main();
