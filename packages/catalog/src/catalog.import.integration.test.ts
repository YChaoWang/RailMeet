import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { eq, sql, and } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabase, schema, type Database } from '@railmeet/database';

import { importCatalogArtifact, loadCatalogArtifactFile } from './import.js';
import { getCatalogReadiness } from './status.js';
import { evaluateCatalogReadiness } from './readiness.js';
import { productionCatalogArtifactPath } from './paths.js';
import { existsSync } from 'node:fs';

const POSTGIS_IMAGE = 'ghcr.io/baosystems/postgis:16-3.5';
const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const fixturePath = join(packageRoot, 'data/fixtures/importer-it-v1.json');

describe('catalog importer integration (PostGIS)', () => {
  let container: StartedPostgreSqlContainer;
  let database: Database;

  beforeAll(async () => {
    container = await new PostgreSqlContainer(POSTGIS_IMAGE)
      .withDatabase('railmeet_catalog_it')
      .withUsername('railmeet')
      .withPassword('railmeet')
      .start();

    database = createDatabase({
      connectionString: container.getConnectionUri(),
      maxConnections: 5,
    });
    await database.migrate();
  }, 180_000);

  afterAll(async () => {
    if (database) {
      await database.close();
    }
    if (container) {
      await container.stop();
    }
  }, 60_000);

  it('imports idempotently, preserves stable IDs, distinguishes same-name cities, and never marks fixture-only as production ready', async () => {
    const { artifact, text } = loadCatalogArtifactFile(fixturePath);
    const first = await importCatalogArtifact(database, artifact, text);
    expect(first.ok).toBe(true);
    expect(first.cityCount).toBe(3);
    expect(first.hubCount).toBe(4);
    expect(first.associationCount).toBe(4);
    expect(first.createdCount).toBe(3);
    expect(first.stats.preloadQueries).toBe(1);
    expect(first.stats.totalQueries).toBeLessThan(40);

    const citiesAfterFirst = await database.db
      .select({
        id: schema.places.id,
        name: schema.places.name,
        countryCode: schema.places.countryCode,
      })
      .from(schema.places)
      .where(
        and(
          eq(schema.places.kind, 'city'),
          eq(schema.places.ownership, 'fixture:offline-europe-v1'),
        ),
      );
    expect(citiesAfterFirst).toHaveLength(3);
    const parisCities = citiesAfterFirst.filter((row) => row.name === 'Paris');
    expect(parisCities).toHaveLength(2);
    expect(new Set(parisCities.map((row) => row.countryCode))).toEqual(new Set(['FR', 'US']));

    const idsAfterFirst = citiesAfterFirst.map((row) => row.id).sort();

    const second = await importCatalogArtifact(database, artifact, text);
    expect(second.ok).toBe(true);
    expect(second.cityCount).toBe(3);
    expect(second.hubCount).toBe(4);
    expect(second.createdCount).toBe(0);
    expect(second.updatedCount).toBe(0);
    expect(second.unchangedCount).toBe(3);
    expect(second.stats.cityBatches).toBe(0);

    const citiesAfterSecond = await database.db
      .select({ id: schema.places.id })
      .from(schema.places)
      .where(
        and(
          eq(schema.places.kind, 'city'),
          eq(schema.places.ownership, 'fixture:offline-europe-v1'),
        ),
      );
    expect(citiesAfterSecond.map((row) => row.id).sort()).toEqual(idsAfterFirst);

    const cityCount = await database.db.execute(sql`
      SELECT COUNT(*)::int AS count FROM places
      WHERE kind = 'city' AND ownership = 'fixture:offline-europe-v1'
    `);
    expect(Number((cityCount as unknown as Array<{ count: number }>)[0]?.count)).toBe(3);

    const hubsOrdered = await database.db.execute(sql`
      SELECT hub_place_id, priority
      FROM meeting_city_hubs
      WHERE city_place_id = 'place:it:york' AND active = true
      ORDER BY priority ASC, hub_place_id ASC
    `);
    expect(hubsOrdered).toHaveLength(2);
    expect(hubsOrdered[0]?.['priority']).toBe(0);

    const status = await getCatalogReadiness(database);
    expect(status.productionReadiness).toBe('fixture-only-catalog');
    expect(status.readiness.ready).toBe(false);
    if (!status.readiness.ready) {
      expect(status.readiness.code).toBe('CANDIDATE_CATALOG_NOT_READY');
    }

    // Manual ownership is preserved across refresh.
    await database.db
      .update(schema.places)
      .set({ ownership: 'manual', name: 'York Manual' })
      .where(eq(schema.places.id, 'place:it:york'));

    const refreshed = structuredClone(artifact) as {
      cities: Array<Record<string, unknown>>;
      hubs: Array<Record<string, unknown>>;
      sourceVersion: string;
    };
    refreshed.sourceVersion = 'importer-it-v1-refresh';
    const york = refreshed.cities.find((city) => city['id'] === 'place:it:york')!;
    york['name'] = 'York Should Not Overwrite Manual';
    // Drop paris-us from source → should deactivate non-manual fixture cities not present.
    refreshed.cities = refreshed.cities.filter((city) => city['id'] !== 'place:it:paris-us');
    refreshed.hubs = refreshed.hubs.filter((hub) => hub['cityId'] !== 'place:it:paris-us');

    const third = await importCatalogArtifact(database, refreshed, JSON.stringify(refreshed));
    expect(third.ok).toBe(true);

    const yorkRow = await database.places.findById('place:it:york');
    expect(yorkRow?.name).toBe('York Manual');

    const parisUs = await database.places.findById('place:it:paris-us');
    expect(parisUs?.active).toBe(false);

    // Empty production catalog status for worker.
    const emptyReadiness = evaluateCatalogReadiness({
      activeCityCount: 0,
      activeHubCount: 0,
      citiesWithActiveHubs: 0,
      sourceVersion: null,
      productionCityCount: 0,
      fixtureCityCount: 0,
      hubsWithProviderStopId: 0,
    });
    expect(emptyReadiness.ready).toBe(false);
    if (!emptyReadiness.ready) {
      expect(emptyReadiness.code).toBe('CANDIDATE_CATALOG_NOT_READY');
    }

    // Failed validation writes no places from a bad artifact (beyond existing).
    const beforeBad = await database.db.execute(sql`SELECT COUNT(*)::int AS count FROM places`);
    const bad = await importCatalogArtifact(
      database,
      { schemaVersion: 1, source: 'bad' },
      '{"bad":true}',
    );
    expect(bad.ok).toBe(false);
    const afterBad = await database.db.execute(sql`SELECT COUNT(*)::int AS count FROM places`);
    expect(Number((afterBad as unknown as Array<{ count: number }>)[0]?.count)).toBe(
      Number((beforeBad as unknown as Array<{ count: number }>)[0]?.count),
    );

    // Completed-search survival: place rows remain loadable by id after deactivation.
    const deactivated = await database.places.findById('place:it:paris-us');
    expect(deactivated).not.toBeNull();
    expect(deactivated?.id).toBe('place:it:paris-us');
    expect(deactivated?.active).toBe(false);
  });

  it('updates changed city fields while preserving stable internal IDs', async () => {
    const { artifact } = loadCatalogArtifactFile(fixturePath);
    const clone = structuredClone(artifact) as {
      cities: Array<Record<string, unknown>>;
      hubs: Array<Record<string, unknown>>;
      source: string;
      sourceVersion: string;
      schemaVersion: number;
      artifactKind: string;
      selectionPolicyVersion: string;
      license: string;
      attribution: string;
      retrievedAt: string;
      coverage: string;
    };
    // Isolate ownership namespace so prior fixture rows are not deactivated by this case.
    clone.source = 'fixture:importer-it-update';
    clone.sourceVersion = 'importer-it-update-1';
    for (const city of clone.cities) {
      city['id'] = String(city['id']).replace('place:it:', 'place:it-upd:');
      city['externalId'] = `upd:${String(city['externalId'])}`;
    }
    for (const hub of clone.hubs) {
      hub['id'] = String(hub['id']).replace('place:it:', 'place:it-upd:');
      hub['cityId'] = String(hub['cityId']).replace('place:it:', 'place:it-upd:');
      hub['externalId'] = `upd:${String(hub['externalId'])}`;
    }

    const first = await importCatalogArtifact(database, clone, JSON.stringify(clone));
    expect(first.ok).toBe(true);
    expect(first.createdCount).toBe(3);
    const idBefore = (await database.places.findById('place:it-upd:paris-fr'))?.id;

    clone.sourceVersion = 'importer-it-update-2';
    const paris = clone.cities.find((city) => city['id'] === 'place:it-upd:paris-fr')!;
    paris['name'] = 'Paris Updated';
    paris['population'] = 2_200_000;

    const progress: string[] = [];
    const second = await importCatalogArtifact(database, clone, JSON.stringify(clone), {
      batchSize: 250,
      onProgress: (event) => {
        progress.push(`${event.phase} ${event.done}/${event.total}`);
      },
    });
    expect(second.ok).toBe(true);
    expect(second.updatedCount).toBe(1);
    expect(second.unchangedCount).toBe(2);
    expect(second.createdCount).toBe(0);
    expect((await database.places.findById('place:it-upd:paris-fr'))?.name).toBe('Paris Updated');
    expect((await database.places.findById('place:it-upd:paris-fr'))?.id).toBe(idBefore);
    expect(progress.some((line) => line.startsWith('cities '))).toBe(true);
    expect(progress.some((line) => line.startsWith('hubs '))).toBe(true);
    expect(progress.some((line) => line.startsWith('associations '))).toBe(true);
  });

  it('resumes safely after an interrupted city write batch', async () => {
    const { artifact } = loadCatalogArtifactFile(fixturePath);
    const clone = structuredClone(artifact) as {
      cities: Array<Record<string, unknown>>;
      hubs: Array<Record<string, unknown>>;
      source: string;
      sourceVersion: string;
      schemaVersion: number;
      artifactKind: string;
      selectionPolicyVersion: string;
      license: string;
      attribution: string;
      retrievedAt: string;
      coverage: string;
    };
    clone.source = 'fixture:importer-it-resume';
    clone.sourceVersion = 'importer-it-resume-1';
    for (const city of clone.cities) {
      city['id'] = String(city['id']).replace('place:it:', 'place:it-res:');
      city['externalId'] = `res:${String(city['externalId'])}`;
    }
    for (const hub of clone.hubs) {
      hub['id'] = String(hub['id']).replace('place:it:', 'place:it-res:');
      hub['cityId'] = String(hub['cityId']).replace('place:it:', 'place:it-res:');
      hub['externalId'] = `res:${String(hub['externalId'])}`;
    }

    await expect(
      importCatalogArtifact(database, clone, JSON.stringify(clone), {
        batchSize: 250,
        failAfterCityBatches: 1,
      }),
    ).rejects.toThrow(/Simulated catalog import interrupt/);

    const citiesAfterInterrupt = await database.db.execute(sql`
      SELECT COUNT(*)::int AS count FROM places
      WHERE ownership = 'fixture:offline-europe-v1' AND id LIKE 'place:it-res:%' AND kind = 'city'
    `);
    expect(Number((citiesAfterInterrupt as unknown as Array<{ count: number }>)[0]?.count)).toBe(3);

    const hubsAfterInterrupt = await database.db.execute(sql`
      SELECT COUNT(*)::int AS count FROM places
      WHERE id LIKE 'place:it-res:%' AND kind = 'station' AND active = true
    `);
    expect(Number((hubsAfterInterrupt as unknown as Array<{ count: number }>)[0]?.count)).toBe(0);

    const resumed = await importCatalogArtifact(database, clone, JSON.stringify(clone), {
      batchSize: 250,
    });
    expect(resumed.ok).toBe(true);
    expect(resumed.hubCount).toBe(4);
    expect(resumed.unchangedCount).toBe(3);

    const hubsAfterResume = await database.db.execute(sql`
      SELECT COUNT(*)::int AS count FROM places
      WHERE id LIKE 'place:it-res:%' AND kind = 'station' AND active = true
    `);
    expect(Number((hubsAfterResume as unknown as Array<{ count: number }>)[0]?.count)).toBe(4);

    const associations = await database.db.execute(sql`
      SELECT COUNT(*)::int AS count FROM meeting_city_hubs
      WHERE city_place_id LIKE 'place:it-res:%' AND active = true
    `);
    expect(Number((associations as unknown as Array<{ count: number }>)[0]?.count)).toBe(4);
  });

  it('rejects invalid timezones/coordinates/country without partial writes when validation fails first', async () => {
    const raw = JSON.parse(readFileSync(fixturePath, 'utf8')) as {
      cities: Array<Record<string, unknown>>;
      hubs: unknown[];
      sourceVersion: string;
    };
    raw.sourceVersion = 'bad-coords';
    raw.cities = [
      {
        ...raw.cities[0]!,
        id: 'place:it:bad',
        externalId: 'fixture:bad',
        timezone: 'Not/AZone',
        latitude: 0.01,
        longitude: 0.01,
        countryCode: 'FR',
      },
    ];
    raw.hubs = [];
    const before = await database.db.execute(
      sql`SELECT COUNT(*)::int AS count FROM places WHERE id = 'place:it:bad'`,
    );
    const result = await importCatalogArtifact(database, raw, JSON.stringify(raw));
    expect(result.ok).toBe(false);
    const after = await database.db.execute(
      sql`SELECT COUNT(*)::int AS count FROM places WHERE id = 'place:it:bad'`,
    );
    expect(Number((after as unknown as Array<{ count: number }>)[0]?.count)).toBe(
      Number((before as unknown as Array<{ count: number }>)[0]?.count),
    );
  });
});

describe('catalog importer production-artifact benchmark (PostGIS)', () => {
  it('imports europe-production-catalog-v1 with bounded queries', async () => {
    const artifactPath = productionCatalogArtifactPath();
    if (!existsSync(artifactPath)) {
      console.warn(`Skipping production benchmark; missing ${artifactPath}`);
      return;
    }

    const container = await new PostgreSqlContainer(POSTGIS_IMAGE)
      .withDatabase('railmeet_catalog_bench')
      .withUsername('railmeet')
      .withPassword('railmeet')
      .start();
    const database = createDatabase({
      connectionString: container.getConnectionUri(),
      maxConnections: 5,
    });
    try {
      await database.migrate();
      const { artifact, text } = loadCatalogArtifactFile(artifactPath);
      const progress: string[] = [];
      const first = await importCatalogArtifact(database, artifact, text, {
        batchSize: 500,
        onProgress: (event) => {
          if (event.done === event.total || event.done % 500 === 0) {
            progress.push(`${event.phase} ${event.done}/${event.total}`);
          }
        },
      });
      expect(first.ok).toBe(true);
      expect(first.cityCount).toBeGreaterThan(6000);
      expect(first.hubCount).toBeGreaterThan(1000);
      // Old importer ≈ 3 queries/city + 3/hub + 1/association ≈ 25k+ round trips.
      // New importer: 1 preload + ~ceil(n/500) writes per phase + deactivation ≤ ~80.
      expect(first.stats.totalQueries).toBeLessThan(100);
      expect(first.stats.durationMs).toBeLessThan(180_000);

      const second = await importCatalogArtifact(database, artifact, text, { batchSize: 500 });
      expect(second.ok).toBe(true);
      expect(second.unchangedCount).toBe(first.cityCount);
      expect(second.createdCount).toBe(0);
      expect(second.updatedCount).toBe(0);
      expect(second.stats.durationMs).toBeLessThan(60_000);

      console.info(
        JSON.stringify(
          {
            event: 'catalog_import_benchmark',
            first: first.stats,
            second: second.stats,
            cityCount: first.cityCount,
            hubCount: first.hubCount,
            estimatedLegacyQueries:
              first.cityCount * 3 + first.hubCount * 3 + first.associationCount + 5,
            progressSample: progress.slice(0, 12),
          },
          null,
          2,
        ),
      );
    } finally {
      await database.close();
      await container.stop();
    }
  }, 300_000);
});
