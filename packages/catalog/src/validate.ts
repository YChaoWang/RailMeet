import {
  CATALOG_HUB_DISTANCE_HARD_MAX_METERS,
  CATALOG_HUB_DISTANCE_SOFT_MAX_METERS,
  CATALOG_MIN_ACTIVE_CITIES,
} from '@railmeet/shared';

import {
  catalogArtifactSchema,
  type CatalogArtifact,
  type CatalogValidationReport,
} from './types.js';

export function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const r = 6_371_000;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(a));
}

function isValidIanaTimeZone(tz: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function emptyReport(rejected: readonly string[]): CatalogValidationReport {
  return {
    source: 'invalid',
    sourceVersion: 'invalid',
    artifactKind: null,
    selectionPolicyVersion: null,
    importedCityCount: 0,
    activeCityCount: 0,
    activeHubCount: 0,
    countriesCovered: [],
    countsByCountry: {},
    citiesWithoutHubs: [],
    citiesWithMultiplePrimaryHubs: [],
    citiesUsingCentroidFallbackEligible: [],
    invalidTimeZones: [],
    invalidCoordinates: [],
    duplicateExternalIds: [],
    ambiguousMatches: [],
    rejectedRecords: [...rejected],
    fixtureRecordCount: 0,
    productionCityCount: 0,
    hubsWithProviderStopId: 0,
    ok: false,
  };
}

/**
 * Validate a catalog artifact offline (CI-safe; no network).
 */
export function validateCatalogArtifact(raw: unknown): CatalogValidationReport {
  const parsed = catalogArtifactSchema.safeParse(raw);
  if (!parsed.success) {
    return emptyReport(
      parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
    );
  }

  const artifact = parsed.data;
  const rejected: string[] = [];
  const invalidTimeZones: string[] = [];
  const invalidCoordinates: string[] = [];
  const duplicateExternalIds: string[] = [];
  const ambiguousMatches: string[] = [];

  const cityExt = new Set<string>();
  const hubExt = new Set<string>();
  const cityIds = new Set(artifact.cities.map((city) => city.id));

  for (const city of artifact.cities) {
    if (cityExt.has(city.externalId)) {
      duplicateExternalIds.push(city.externalId);
    }
    cityExt.add(city.externalId);
    if (!isValidIanaTimeZone(city.timezone)) {
      invalidTimeZones.push(`${city.id}:${city.timezone}`);
    }
    if (Math.abs(city.latitude) < 0.5 && Math.abs(city.longitude) < 0.5) {
      invalidCoordinates.push(`${city.id}:near-null-island`);
    }
    // Detect lat/lon likely reversed for Europe-ish points.
    if (city.longitude >= 35 && city.longitude <= 72 && Math.abs(city.latitude) < 35) {
      invalidCoordinates.push(`${city.id}:possible-lat-lon-reversal`);
    }
  }

  const hubsByCity = new Map<string, typeof artifact.hubs>();
  for (const hub of artifact.hubs) {
    if (hubExt.has(hub.externalId)) {
      duplicateExternalIds.push(hub.externalId);
    }
    hubExt.add(hub.externalId);
    if (!cityIds.has(hub.cityId)) {
      rejected.push(`hub ${hub.id} references missing city ${hub.cityId}`);
      continue;
    }
    if (hub.countryCode !== artifact.cities.find((city) => city.id === hub.cityId)?.countryCode) {
      ambiguousMatches.push(`hub ${hub.id} country mismatch vs city ${hub.cityId}`);
    }
    if (!isValidIanaTimeZone(hub.timezone)) {
      invalidTimeZones.push(`${hub.id}:${hub.timezone}`);
    }
    // Invented MOTIS-looking IDs without providerStopId are rejected for production artifacts.
    if (
      artifact.artifactKind === 'production-catalog' &&
      hub.externalId.startsWith('motis:') &&
      !hub.providerStopId
    ) {
      rejected.push(`hub ${hub.id} claims motis externalId without providerStopId`);
    }
    const city = artifact.cities.find((entry) => entry.id === hub.cityId)!;
    const distance = haversineMeters(city.latitude, city.longitude, hub.latitude, hub.longitude);
    const max = hub.regional
      ? CATALOG_HUB_DISTANCE_HARD_MAX_METERS
      : CATALOG_HUB_DISTANCE_SOFT_MAX_METERS;
    if (distance > max) {
      rejected.push(
        `hub ${hub.id} is ${Math.round(distance)}m from ${hub.cityId} (max ${max}${hub.regional ? ' regional' : ''})`,
      );
    }
    const list = hubsByCity.get(hub.cityId) ?? [];
    list.push(hub);
    hubsByCity.set(hub.cityId, list);
  }

  const citiesWithoutHubs = artifact.cities
    .filter((city) => !hubsByCity.has(city.id))
    .map((city) => city.id);

  const citiesWithMultiplePrimaryHubs: string[] = [];
  for (const [cityId, hubs] of hubsByCity) {
    const zeros = hubs.filter((hub) => hub.priority === 0);
    if (zeros.length > 1) {
      citiesWithMultiplePrimaryHubs.push(cityId);
    }
    const priorities = hubs.map((hub) => hub.priority);
    if (new Set(priorities).size !== priorities.length) {
      ambiguousMatches.push(`duplicate hub priorities for ${cityId}`);
    }
  }

  const countsByCountry: Record<string, number> = {};
  for (const city of artifact.cities) {
    countsByCountry[city.countryCode] = (countsByCountry[city.countryCode] ?? 0) + 1;
  }
  const countries = Object.keys(countsByCountry).sort();
  const fixtureRecordCount = artifact.cities.filter(
    (city) =>
      city.ownership === 'fixture:offline-europe-v1' || city.ownership === 'catalog:bootstrap',
  ).length;
  const productionCityCount = artifact.cities.filter(
    (city) => city.ownership === 'catalog:geonames',
  ).length;
  const hubsWithProviderStopId = artifact.hubs.filter((hub) => Boolean(hub.providerStopId)).length;

  const isFixture =
    artifact.artifactKind === 'offline-test-fixture' ||
    artifact.source.startsWith('fixture:') ||
    fixtureRecordCount === artifact.cities.length;

  // Production city dumps may include cities awaiting hub enrichment.
  // Fixtures that ship hubs must associate every city.
  const requireHubsPerCity =
    artifact.artifactKind !== 'production-catalog' &&
    !artifact.source.startsWith('catalog:geonames');

  const ok =
    rejected.length === 0 &&
    duplicateExternalIds.length === 0 &&
    invalidTimeZones.length === 0 &&
    invalidCoordinates.length === 0 &&
    citiesWithMultiplePrimaryHubs.length === 0 &&
    (!requireHubsPerCity || citiesWithoutHubs.length === 0) &&
    (isFixture
      ? artifact.cities.length >= 1
      : artifact.cities.length >= CATALOG_MIN_ACTIVE_CITIES || artifact.hubs.length === 0);

  return {
    source: artifact.source,
    sourceVersion: artifact.sourceVersion,
    artifactKind: artifact.artifactKind ?? null,
    selectionPolicyVersion: artifact.selectionPolicyVersion ?? null,
    importedCityCount: artifact.cities.length,
    activeCityCount: artifact.cities.length,
    activeHubCount: artifact.hubs.length,
    countriesCovered: countries,
    countsByCountry,
    citiesWithoutHubs,
    citiesWithMultiplePrimaryHubs,
    citiesUsingCentroidFallbackEligible: citiesWithoutHubs,
    invalidTimeZones,
    invalidCoordinates,
    duplicateExternalIds,
    ambiguousMatches,
    rejectedRecords: rejected,
    fixtureRecordCount,
    productionCityCount,
    hubsWithProviderStopId,
    ok,
  };
}

export function parseCatalogArtifact(raw: unknown): CatalogArtifact {
  return catalogArtifactSchema.parse(raw);
}
