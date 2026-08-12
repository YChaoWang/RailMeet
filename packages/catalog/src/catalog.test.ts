import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  associateCityToHub,
  classifyHubCapability,
  isEligiblePrimaryHubCapability,
} from './associate.js';
import {
  isMeetingCityTierEligible,
  isProductionMeetingCityCandidate,
  MEETING_CITY_MIN_POPULATION,
  MEETING_CITY_POLICY_VERSION,
} from './eligibility.js';
import {
  isEligibleGeonamesCity,
  looksLikeLatLonReversed,
  parseGeonamesLine,
  toCatalogCity,
} from './geonames-parse.js';
import { selectRoutingTarget } from './hub-select.js';
import { evaluateCatalogReadiness, classifyProductionReadiness } from './readiness.js';
import { validateCatalogArtifact } from './validate.js';

const fixturePath = join(
  dirname(fileURLToPath(import.meta.url)),
  '../data/fixtures/offline-europe-v1.json',
);

describe('validateCatalogArtifact', () => {
  it('accepts the offline europe fixture and classifies it as a fixture', () => {
    const raw = JSON.parse(readFileSync(fixturePath, 'utf8')) as {
      artifactKind?: string;
      source: string;
    };
    const report = validateCatalogArtifact(raw);
    expect(report.ok).toBe(true);
    expect(report.artifactKind).toBe('offline-test-fixture');
    expect(report.source.startsWith('fixture:')).toBe(true);
    expect(report.fixtureRecordCount).toBe(report.importedCityCount);
    expect(report.productionCityCount).toBe(0);
  });
});

describe('evaluateCatalogReadiness / production classification', () => {
  it('never treats fixture-only data as production ready', () => {
    const counts = {
      activeCityCount: 39,
      activeHubCount: 39,
      citiesWithActiveHubs: 39,
      sourceVersion: 'offline-europe-v1',
      fixtureCityCount: 39,
      productionCityCount: 0,
      productionHubCount: 0,
      hubsWithProviderStopId: 0,
      eligibleHubbedCityCount: 0,
      tierEligibleCityCount: 0,
    };
    expect(evaluateCatalogReadiness(counts).ready).toBe(false);
    expect(classifyProductionReadiness(counts).kind).toBe('fixture-only-catalog');
  });

  it('does not report production-catalog-ready for ~242/6074 style partial coverage', () => {
    const counts = {
      activeCityCount: 6074,
      activeHubCount: 242,
      citiesWithActiveHubs: 281,
      sourceVersion: 'cities15000@2026-08-09',
      productionCityCount: 6074,
      productionHubCount: 242,
      hubsWithProviderStopId: 242,
      citiesWithoutHubs: 5831,
      tierEligibleCityCount: 1200,
      eligibleHubbedCityCount: 200,
      tierEligibleWithoutHubCount: 1000,
      fixtureCityCount: 0,
    };
    const classified = classifyProductionReadiness(counts);
    expect(classified.kind).toBe('production-catalog-partial');
    expect(classified.kind).not.toBe('production-catalog-ready');
    expect(classified.reasons.some((reason) => /Partial hub coverage/i.test(reason))).toBe(true);
  });

  it('reports ready only when every tier-eligible city has a primary hub', () => {
    const counts = {
      activeCityCount: 100,
      activeHubCount: 100,
      citiesWithActiveHubs: 100,
      sourceVersion: 'v1',
      productionCityCount: 100,
      productionHubCount: 100,
      hubsWithProviderStopId: 100,
      citiesWithoutHubs: 0,
      tierEligibleCityCount: 80,
      eligibleHubbedCityCount: 80,
      tierEligibleWithoutHubCount: 0,
      fixtureCityCount: 0,
    };
    expect(classifyProductionReadiness(counts).kind).toBe('production-catalog-ready');
    expect(evaluateCatalogReadiness(counts).ready).toBe(true);
  });
});

describe('meeting-city eligibility', () => {
  it(`uses ${MEETING_CITY_POLICY_VERSION} with admin tiers and population floor`, () => {
    expect(
      isMeetingCityTierEligible({
        countryCode: 'GB',
        featureCode: 'PPL',
        population: MEETING_CITY_MIN_POPULATION - 1,
      }),
    ).toBe(false);
    expect(
      isMeetingCityTierEligible({
        countryCode: 'GB',
        featureCode: 'PPLC',
        population: 1,
      }),
    ).toBe(true);
    expect(
      isProductionMeetingCityCandidate({
        countryCode: 'GB',
        featureCode: 'PPLA',
        population: 50_000,
        hasAuthoritativePrimaryHub: true,
      }),
    ).toBe(true);
    expect(
      isProductionMeetingCityCandidate({
        countryCode: 'GB',
        featureCode: 'PPLA',
        population: 50_000,
        hasAuthoritativePrimaryHub: false,
      }),
    ).toBe(false);
  });
});

describe('selectRoutingTarget', () => {
  it('does not enable centroid fallback by default', () => {
    expect(selectRoutingTarget([])).toEqual({ reason: 'no_routing_target', hubPlaceId: null });
    expect(selectRoutingTarget([], { allowCentroidFallback: true })).toEqual({
      reason: 'centroid_fallback',
      hubPlaceId: null,
    });
  });

  it('picks the lowest priority hub deterministically', () => {
    const selected = selectRoutingTarget([
      { hubPlaceId: 'hub-b', priority: 1, distanceMeters: 100, regional: false },
      { hubPlaceId: 'hub-a', priority: 0, distanceMeters: 500, regional: false },
      { hubPlaceId: 'hub-c', priority: 0, distanceMeters: 50, regional: false },
    ]);
    expect(selected).toEqual({ reason: 'hub', hubPlaceId: 'hub-c', priority: 0 });
  });
});

describe('hub capability / association', () => {
  const city = {
    id: 'place:geonames:2643743',
    externalId: 'geonames:2643743',
    geonamesId: 2643743,
    name: 'London',
    countryCode: 'GB',
    timezone: 'Europe/London',
    latitude: 51.5074,
    longitude: -0.1278,
    ownership: 'catalog:geonames' as const,
    population: 8_000_000,
    featureCode: 'PPLC',
  };

  it('classifies rail vs local bus from structured modes', () => {
    expect(classifyHubCapability(['LONG_DISTANCE', 'SUBWAY'])).toBe('intercity_rail');
    expect(classifyHubCapability(['BUS'])).toBe('local_bus');
    expect(isEligiblePrimaryHubCapability('local_bus')).toBe(false);
    expect(isEligiblePrimaryHubCapability('intercity_rail')).toBe(true);
  });

  it('rejects London Eye style coach-only stops when rail hubs exist', () => {
    const result = associateCityToHub(city, [
      {
        providerStopId: 'gb-great-britain_490G00009275',
        name: 'London Eye',
        countryCode: 'GB',
        timezone: 'Europe/London',
        latitude: 51.5033,
        longitude: -0.1195,
        modes: ['COACH'],
        resultType: 'STOP',
      },
      {
        providerStopId: 'gb-great-britain_910GEUSTON',
        name: 'London Euston',
        countryCode: 'GB',
        timezone: 'Europe/London',
        latitude: 51.528,
        longitude: -0.133,
        modes: ['LONG_DISTANCE', 'REGIONAL_RAIL'],
        resultType: 'STOP',
      },
    ]);
    expect(result.status).toBe('matched');
    if (result.status === 'matched') {
      expect(result.hub.providerStopId).toBe('gb-great-britain_910GEUSTON');
      expect(result.hub.name).not.toMatch(/Eye/i);
      expect(result.capabilityClass).toBe('intercity_rail');
    }
  });

  it('rejects when only local bus stops are available', () => {
    const result = associateCityToHub(city, [
      {
        providerStopId: 'bus-1',
        name: 'London Eye',
        countryCode: 'GB',
        timezone: 'Europe/London',
        latitude: 51.5033,
        longitude: -0.1195,
        modes: ['BUS'],
        resultType: 'STOP',
      },
    ]);
    expect(result.status).toBe('rejected');
  });

  it('rejects PLACE/POI results when structured type is non-STOP', () => {
    const result = associateCityToHub(city, [
      {
        providerStopId: 'node/1',
        name: 'London',
        countryCode: 'GB',
        timezone: 'Europe/London',
        latitude: 51.5074,
        longitude: -0.1278,
        modes: [],
        resultType: 'PLACE',
      },
    ]);
    expect(result.status).toBe('rejected');
  });
});

describe('geonames parse', () => {
  const yorkLine =
    '2633352\tYork\tYork\t\t53.95763\t-1.08271\tP\tPPLA2\tGB\t\tENG\tJ3\t\t\t153717\t\t\tEurope/London\t2024-01-01';

  it('parses a 19-column GeoNames row', () => {
    const parsed = parseGeonamesLine(yorkLine);
    expect('error' in parsed).toBe(false);
    if ('error' in parsed) {
      return;
    }
    expect(isEligibleGeonamesCity(parsed).ok).toBe(true);
    expect(toCatalogCity(parsed).ownership).toBe('catalog:geonames');
  });

  it('detects lat/lon reversal heuristics', () => {
    expect(looksLikeLatLonReversed(-1.08, 53.95)).toBe(true);
  });
});
