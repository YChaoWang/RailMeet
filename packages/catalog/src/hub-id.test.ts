import { createHash } from 'node:crypto';

import { PLACE_ID_MAX_LENGTH } from '@railmeet/shared';
import { describe, expect, it } from 'vitest';

import {
  buildCatalogHubPlaceId,
  findHubIdCollisions,
  legacyTruncatedCatalogHubPlaceId,
  remapCatalogHubIds,
} from './hub-id.js';
import { validateCatalogArtifact } from './validate.js';

describe('buildCatalogHubPlaceId', () => {
  const longPrefix =
    'fr-arrets-horaires-et-circuits-des-lignes-de-transports-en-commun-en-pays-de-la-loire-gtfs-destineo-reseaux-aom-aleop-1_';

  it('stays within PLACE_ID_MAX_LENGTH for long provider stop IDs', () => {
    const stopId = `${longPrefix}SNCF:StopPlace:StopArea:OCE87574004`;
    const id = buildCatalogHubPlaceId('motis', stopId);
    expect(id.length).toBeLessThanOrEqual(PLACE_ID_MAX_LENGTH);
    expect(id.startsWith('place:hub:motis:')).toBe(true);
  });

  it('produces distinct IDs for stops that share the same truncated prefix', () => {
    const a = `${longPrefix}ALEOP:StopPlace:SNCF:ST:87444000_OKINA_train`;
    const b = `${longPrefix}SNCF:StopPlace:StopArea:OCE87574004`;
    const legacyA = legacyTruncatedCatalogHubPlaceId(a);
    const legacyB = legacyTruncatedCatalogHubPlaceId(b);
    expect(legacyA).toBe(legacyB);

    const idA = buildCatalogHubPlaceId('motis', a);
    const idB = buildCatalogHubPlaceId('motis', b);
    expect(idA).not.toBe(idB);
    expect(idA.length).toBeLessThanOrEqual(PLACE_ID_MAX_LENGTH);
    expect(idB.length).toBeLessThanOrEqual(PLACE_ID_MAX_LENGTH);
  });

  it('is deterministic across rebuilds', () => {
    const stopId = `${longPrefix}SNCF:StopPlace:StopArea:OCE87394007`;
    expect(buildCatalogHubPlaceId('motis', stopId)).toBe(buildCatalogHubPlaceId('motis', stopId));
    const digest = createHash('sha256').update(`motis\0${stopId}`, 'utf8').digest('hex').slice(0, 16);
    expect(buildCatalogHubPlaceId('motis', stopId).endsWith(`-${digest}`)).toBe(true);
  });

  it('preserves IDs that already match the deterministic scheme during remap', () => {
    const stopId = 'gb-great-britain_910GEUSTON';
    const id = buildCatalogHubPlaceId('motis', stopId);
    const remapped = remapCatalogHubIds([
      {
        id,
        providerStopId: stopId,
      },
      {
        id: legacyTruncatedCatalogHubPlaceId(`${longPrefix}x`),
        providerStopId: `${longPrefix}SNCF:StopPlace:StopArea:OCE87574004`,
      },
    ]);
    expect(remapped[0]?.id).toBe(id);
    expect(remapped[1]?.id).toBe(
      buildCatalogHubPlaceId('motis', `${longPrefix}SNCF:StopPlace:StopArea:OCE87574004`),
    );
  });
});

describe('hub ID collision detection and validation', () => {
  it('reports collisions for truncated legacy IDs', () => {
    const longPrefix =
      'fr-arrets-horaires-et-circuits-des-lignes-de-transports-en-commun-en-pays-de-la-loire-gtfs-destineo-reseaux-aom-aleop-1_';
    const shared = legacyTruncatedCatalogHubPlaceId(`${longPrefix}a`);
    const report = findHubIdCollisions([
      {
        id: shared,
        cityId: 'place:a',
        name: 'A',
        countryCode: 'FR',
        providerStopId: `${longPrefix}a`,
      },
      {
        id: shared,
        cityId: 'place:b',
        name: 'B',
        countryCode: 'FR',
        providerStopId: `${longPrefix}b`,
      },
    ]);
    expect(report.duplicatedIdCount).toBe(1);
    expect(report.affectedStationCount).toBe(2);
    expect(report.countries).toEqual(['FR']);
  });

  it('fails validation when duplicate hub place IDs remain', () => {
    const shared = 'place:hub:motis:collision';
    const report = validateCatalogArtifact({
      schemaVersion: 1,
      source: 'fixture:dup-hub-id',
      sourceVersion: 'test',
      artifactKind: 'offline-test-fixture',
      license: 'test',
      attribution: 'test',
      retrievedAt: '2026-08-13',
      coverage: 'test',
      cities: [
        {
          id: 'place:c1',
          externalId: 'fixture:1',
          name: 'City1',
          countryCode: 'FR',
          timezone: 'Europe/Paris',
          latitude: 48.8,
          longitude: 2.3,
          ownership: 'fixture:offline-europe-v1',
        },
        {
          id: 'place:c2',
          externalId: 'fixture:2',
          name: 'City2',
          countryCode: 'FR',
          timezone: 'Europe/Paris',
          latitude: 48.9,
          longitude: 2.4,
          ownership: 'fixture:offline-europe-v1',
        },
      ],
      hubs: [
        {
          id: shared,
          externalId: 'motis:stop-a',
          name: 'Stop A',
          countryCode: 'FR',
          timezone: 'Europe/Paris',
          latitude: 48.8,
          longitude: 2.3,
          cityId: 'place:c1',
          priority: 0,
          matchMethod: 'test',
          regional: false,
          providerStopId: 'stop-a',
          hubSource: 'catalog:transitous',
        },
        {
          id: shared,
          externalId: 'motis:stop-b',
          name: 'Stop B',
          countryCode: 'FR',
          timezone: 'Europe/Paris',
          latitude: 48.9,
          longitude: 2.4,
          cityId: 'place:c2',
          priority: 0,
          matchMethod: 'test',
          regional: false,
          providerStopId: 'stop-b',
          hubSource: 'catalog:transitous',
        },
      ],
    });
    expect(report.ok).toBe(false);
    expect(report.duplicateHubIds).toContain(shared);
    expect(report.rejectedRecords.some((row) => row.includes('duplicate hub place id'))).toBe(true);
  });
});
