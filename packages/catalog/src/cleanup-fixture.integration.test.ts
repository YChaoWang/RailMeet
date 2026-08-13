import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createDatabase, schema, type Database } from '@railmeet/database';

import {
  cleanupOfflineFixture,
  countCatalogHubStations,
  countPlacesByOwnership,
  FixtureCleanupAbortedError,
  validateFixtureCleanupState,
} from './cleanup-fixture.js';
import { importCatalogArtifact, loadCatalogArtifactFile } from './import.js';
import { getCatalogReadiness } from './status.js';

const POSTGIS_IMAGE = 'ghcr.io/baosystems/postgis:16-3.5';
const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const fixturePath = join(packageRoot, 'data/fixtures/importer-it-v1.json');

async function seedProductionCatalog(database: Database, cityCount: number): Promise<void> {
  const now = new Date();
  for (let i = 0; i < cityCount; i += 1) {
    const cityId = `place:geonames:prod-${i}`;
    const hubId = `place:hub:motis:prod-${i}-aaaaaaaaaaaaaaaa`;
    await database.db.insert(schema.places).values({
      id: cityId,
      name: `ProdCity${i}`,
      kind: 'city',
      countryCode: 'DE',
      timezone: 'Europe/Berlin',
      location: { x: 13.4 + i * 0.01, y: 52.5 + i * 0.01 },
      provider: 'geonames',
      providerPlaceId: `prod-${i}`,
      ownership: 'catalog:geonames',
      sourceVersion: 'test-prod',
      normalizedName: `prodcity${i}`,
      population: 200_000,
      featureCode: 'PPLC',
      active: true,
      createdAt: now,
      updatedAt: now,
    });
    await database.db.insert(schema.places).values({
      id: hubId,
      name: `ProdHub${i}`,
      kind: 'station',
      countryCode: 'DE',
      timezone: 'Europe/Berlin',
      location: { x: 13.41 + i * 0.01, y: 52.51 + i * 0.01 },
      parentCityId: cityId,
      provider: 'motis',
      providerPlaceId: `prod-stop-${i}`,
      ownership: 'catalog:transitous',
      sourceVersion: 'test-prod',
      normalizedName: `prodhub${i}`,
      active: true,
      createdAt: now,
      updatedAt: now,
    });
    await database.db.insert(schema.meetingCityHubs).values({
      cityPlaceId: cityId,
      hubPlaceId: hubId,
      priority: 0,
      matchMethod: 'test-primary',
      source: 'catalog:transitous',
      sourceVersion: 'test-prod',
      regional: false,
      distanceMeters: 500,
      active: true,
      createdAt: now,
      updatedAt: now,
    });
  }
}

async function seedOrphanCatalogHub(database: Database): Promise<string> {
  const now = new Date();
  const cityId = 'place:geonames:orphan-parent';
  const hubId = 'place:catalog:hub:orphan-should-keep';
  await database.db.insert(schema.places).values({
    id: cityId,
    name: 'OrphanParent',
    kind: 'city',
    countryCode: 'FR',
    timezone: 'Europe/Paris',
    location: { x: 2.3, y: 48.8 },
    provider: 'geonames',
    providerPlaceId: 'orphan-parent',
    ownership: 'catalog:geonames',
    sourceVersion: 'test-prod',
    normalizedName: 'orphanparent',
    population: 150_000,
    featureCode: 'PPLA',
    active: true,
    createdAt: now,
    updatedAt: now,
  });
  await database.db.insert(schema.places).values({
    id: hubId,
    name: 'OrphanHub',
    kind: 'station',
    countryCode: 'FR',
    timezone: 'Europe/Paris',
    location: { x: 2.31, y: 48.81 },
    parentCityId: cityId,
    provider: 'railmeet-hub',
    providerPlaceId: 'orphan-hub',
    ownership: 'catalog:hub',
    sourceVersion: 'test-prod',
    normalizedName: 'orphanhub',
    active: true,
    createdAt: now,
    updatedAt: now,
  });
  return hubId;
}

async function countAllPlaces(database: Database): Promise<number> {
  const rows = await database.db.execute(sql`SELECT COUNT(*)::int AS count FROM places`);
  return Number((rows as unknown as Array<{ count: number }>)[0]?.count ?? 0);
}

describe('catalog fixture cleanup integration (PostGIS)', () => {
  let container: StartedPostgreSqlContainer;
  let database: Database;

  beforeAll(async () => {
    container = await new PostgreSqlContainer(POSTGIS_IMAGE)
      .withDatabase('railmeet_catalog_cleanup_it')
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

  beforeEach(async () => {
    await database.db.execute(sql`TRUNCATE meeting_city_hubs, catalog_import_runs, places CASCADE`);
  });

  it('dry-run reports fixture rows and makes no changes', async () => {
    const { artifact, text } = loadCatalogArtifactFile(fixturePath);
    await importCatalogArtifact(database, artifact, text);
    await seedProductionCatalog(database, 20);
    const orphanHubId = await seedOrphanCatalogHub(database);

    const beforePlaces = await countAllPlaces(database);
    const beforeFixtureCities = await countPlacesByOwnership(
      database,
      'fixture:offline-europe-v1',
      'city',
    );
    const beforeHubs = await countCatalogHubStations(database);

    const result = await cleanupOfflineFixture(database, { apply: false });
    expect(result.applied).toBe(false);
    expect(result.report.fixtureCityCount).toBe(3);
    expect(result.report.fixtureStationCount).toBeGreaterThan(0);
    expect(result.report.blocking).toBe(false);

    expect(await countAllPlaces(database)).toBe(beforePlaces);
    expect(await countPlacesByOwnership(database, 'fixture:offline-europe-v1', 'city')).toBe(
      beforeFixtureCities,
    );
    expect(await countCatalogHubStations(database)).toBe(beforeHubs);
    expect(await database.places.findById(orphanHubId)).not.toBeNull();
  });

  it('applies cleanup, preserves production places, and is idempotent', async () => {
    const { artifact, text } = loadCatalogArtifactFile(fixturePath);
    const imported = await importCatalogArtifact(database, artifact, text);
    expect(imported.ok).toBe(true);

    await seedProductionCatalog(database, 20);
    const orphanHubId = await seedOrphanCatalogHub(database);

    const geonamesBefore = await countPlacesByOwnership(database, 'catalog:geonames', 'city');
    const transitousBefore = await countPlacesByOwnership(
      database,
      'catalog:transitous',
      'station',
    );
    const orphanHubsBefore = await countCatalogHubStations(database);

    const dry = await cleanupOfflineFixture(database, { apply: false });
    expect(dry.report.fixtureCityCount).toBe(3);
    const expectedStations = dry.report.fixtureStationCount;
    const expectedAssocs = dry.report.associationCount;

    const applied = await cleanupOfflineFixture(database, {
      apply: true,
      strictProductionValidation: false,
    });
    expect(applied.applied).toBe(true);
    if (!applied.applied) {
      return;
    }

    expect(applied.deletedCities).toBe(3);
    expect(applied.deletedStations).toBe(expectedStations);
    expect(applied.deletedAssociations).toBe(expectedAssocs);
    expect(applied.deletedCityIds).toEqual(expect.arrayContaining(dry.report.fixtureCityIds));
    expect(applied.validation.fixtureCityCount).toBe(0);
    expect(applied.validation.fixtureStationCount).toBe(0);
    expect(applied.validation.ok).toBe(true);

    expect(await countPlacesByOwnership(database, 'fixture:offline-europe-v1', 'city')).toBe(0);
    expect(await countPlacesByOwnership(database, 'catalog:geonames', 'city')).toBe(geonamesBefore);
    expect(await countPlacesByOwnership(database, 'catalog:transitous', 'station')).toBe(
      transitousBefore,
    );
    // Orphan catalog:hub under GeoNames parent must remain (not every catalog:hub).
    expect(await database.places.findById(orphanHubId)).not.toBeNull();
    expect(await countCatalogHubStations(database)).toBe(
      orphanHubsBefore - expectedStations,
    );

    const readiness = await getCatalogReadiness(database);
    expect(readiness.readiness.ready).toBe(true);

    const again = await cleanupOfflineFixture(database, {
      apply: true,
      strictProductionValidation: false,
    });
    expect(again.applied).toBe(true);
    if (!again.applied) {
      return;
    }
    expect(again.deletedCities).toBe(0);
    expect(again.deletedStations).toBe(0);
    expect(again.deletedAssociations).toBe(0);
    expect(again.validation.ok).toBe(true);
    expect(await countPlacesByOwnership(database, 'catalog:geonames', 'city')).toBe(geonamesBefore);
    expect(await countPlacesByOwnership(database, 'catalog:transitous', 'station')).toBe(
      transitousBefore,
    );
  });

  it('aborts when a fixture place is referenced by search data', async () => {
    const { artifact, text } = loadCatalogArtifactFile(fixturePath);
    await importCatalogArtifact(database, artifact, text);
    await seedProductionCatalog(database, 2);

    const search = await database.meetingSearches.create({
      participants: [
        {
          participantId: 'p1',
          displayName: 'One',
          origin: { kind: 'existing', placeId: 'place:it:york' },
          position: 0,
        },
        {
          participantId: 'p2',
          displayName: 'Two',
          origin: { kind: 'existing', placeId: 'place:geonames:prod-0' },
          position: 1,
        },
      ],
      travelDate: '2026-09-01',
      earliestDepartureTime: '08:00',
      latestArrivalTime: '22:00',
      arrivalDayOffset: 0,
      maxJourneyDurationMinutes: 480,
      maxTransfers: 2,
      minTransferDurationMinutes: 5,
      allowedTransportModes: ['train'],
      allowedCountryCodes: ['GB', 'DE'],
      rankingMode: 'fairest',
    });
    expect(search.ok).toBe(true);

    const dry = await cleanupOfflineFixture(database, { apply: false });
    expect(dry.report.blocking).toBe(true);
    expect(dry.report.references.some((hit) => hit.placeId === 'place:it:york')).toBe(true);

    await expect(
      cleanupOfflineFixture(database, { apply: true, strictProductionValidation: false }),
    ).rejects.toBeInstanceOf(FixtureCleanupAbortedError);

    expect(await countPlacesByOwnership(database, 'fixture:offline-europe-v1', 'city')).toBe(3);
    expect(await countPlacesByOwnership(database, 'catalog:geonames', 'city')).toBe(2);
  });

  it('does not delete catalog:transitous stations even if parented under a fixture city', async () => {
    const { artifact, text } = loadCatalogArtifactFile(fixturePath);
    await importCatalogArtifact(database, artifact, text);

    const now = new Date();
    await database.db.insert(schema.places).values({
      id: 'place:hub:motis:misparented-keep',
      name: 'Misparented Transitous',
      kind: 'station',
      countryCode: 'GB',
      timezone: 'Europe/London',
      location: { x: -1.08, y: 53.95 },
      parentCityId: 'place:it:york',
      provider: 'motis',
      providerPlaceId: 'misparented-stop',
      ownership: 'catalog:transitous',
      sourceVersion: 'test',
      normalizedName: 'misparented',
      active: true,
      createdAt: now,
      updatedAt: now,
    });

    const dry = await cleanupOfflineFixture(database, { apply: false });
    expect(dry.report.blocking).toBe(true);
    expect(dry.report.unsafeStations.some((row) => row.id === 'place:hub:motis:misparented-keep')).toBe(
      true,
    );

    await expect(
      cleanupOfflineFixture(database, { apply: true, strictProductionValidation: false }),
    ).rejects.toBeInstanceOf(FixtureCleanupAbortedError);

    expect(await database.places.findById('place:hub:motis:misparented-keep')).not.toBeNull();
    expect(await countPlacesByOwnership(database, 'fixture:offline-europe-v1', 'city')).toBe(3);
  });

  it('post-validation detects remaining fixture cities', async () => {
    const { artifact, text } = loadCatalogArtifactFile(fixturePath);
    await importCatalogArtifact(database, artifact, text);
    const validation = await validateFixtureCleanupState(database, {
      strictProductionValidation: false,
    });
    expect(validation.ok).toBe(false);
    expect(validation.fixtureCityCount).toBe(3);
    expect(validation.failures.some((row) => row.includes('fixture city count'))).toBe(true);
  });
});
