import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { eq, sql, and } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabase, schema, type Database } from '@railmeet/database';

import { importCatalogArtifact, loadCatalogArtifactFile } from './import.js';
import { getCatalogReadiness } from './cli-lib.js';
import { evaluateCatalogReadiness } from './readiness.js';

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
