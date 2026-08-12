import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';

import {
  CITY_SELECTION_POLICY_VERSION,
  GEONAMES_ELIGIBLE_FEATURE_CODES,
  isEuropeCountryCode,
} from './europe-scope.js';
import {
  GEONAMES_ATTRIBUTION,
  GEONAMES_LICENSE_URL,
  GEONAMES_SOURCE_DEFAULTS,
} from './geonames-download.js';
import type { CatalogArtifact, CatalogCity } from './types.js';

/** Official GeoNames dump column count for the main geoname table. */
export const GEONAMES_COLUMN_COUNT = 19;

const ELIGIBLE_FEATURE = new Set<string>(GEONAMES_ELIGIBLE_FEATURE_CODES);

export type GeonamesRawCity = {
  readonly geonameId: number;
  readonly name: string;
  readonly asciiName: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly featureClass: string;
  readonly featureCode: string;
  readonly countryCode: string;
  readonly population: number;
  readonly timezone: string;
  readonly modificationDate: string;
};

export type GeonamesParseDiagnostics = {
  readonly rowsRead: number;
  readonly accepted: number;
  readonly rejectedMalformed: number;
  readonly rejectedCountry: number;
  readonly rejectedFeature: number;
  readonly rejectedTimezone: number;
  readonly rejectedCoordinates: number;
  readonly rejectedLatLonReversal: number;
  readonly duplicateGeonameIds: readonly number[];
  readonly messages: readonly string[];
};

function isValidIanaTimeZone(tz: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * Detect common lat/lon swap for European cities: lon in Europe is typically
 * within ~-25..45 and lat within ~35..72. A swapped pair often places
 * "latitude" west of -25 or east of 45 while "longitude" sits in 35..72.
 */
export function looksLikeLatLonReversed(latitude: number, longitude: number): boolean {
  const latLooksLikeLon = Math.abs(latitude) <= 90 && Math.abs(latitude) < 35;
  const lonLooksLikeLat = longitude >= 35 && longitude <= 72;
  const lonOutsideEuropeBand = longitude < -30 || longitude > 50;
  return lonLooksLikeLat && (latLooksLikeLon || lonOutsideEuropeBand);
}

export function parseGeonamesLine(line: string): GeonamesRawCity | { error: string } {
  if (!line || line.startsWith('#')) {
    return { error: 'empty-or-comment' };
  }
  const cols = line.split('\t');
  if (cols.length !== GEONAMES_COLUMN_COUNT) {
    return { error: `expected ${GEONAMES_COLUMN_COUNT} columns, got ${cols.length}` };
  }
  const geonameId = Number(cols[0]);
  const latitude = Number(cols[4]);
  const longitude = Number(cols[5]);
  const population = Number(cols[14]);
  if (!Number.isInteger(geonameId) || geonameId <= 0) {
    return { error: 'invalid geonameid' };
  }
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
    return { error: 'invalid latitude' };
  }
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    return { error: 'invalid longitude' };
  }
  if (!Number.isFinite(population) || population < 0) {
    return { error: 'invalid population' };
  }
  const countryCode = (cols[8] ?? '').trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(countryCode)) {
    return { error: 'invalid country code' };
  }
  return {
    geonameId,
    name: (cols[1] ?? '').trim(),
    asciiName: (cols[2] ?? '').trim(),
    latitude,
    longitude,
    featureClass: (cols[6] ?? '').trim(),
    featureCode: (cols[7] ?? '').trim(),
    countryCode,
    population,
    timezone: (cols[17] ?? '').trim(),
    modificationDate: (cols[18] ?? '').trim(),
  };
}

export function isEligibleGeonamesCity(row: GeonamesRawCity): {
  readonly ok: boolean;
  readonly reason?: string;
} {
  if (!isEuropeCountryCode(row.countryCode)) {
    return { ok: false, reason: 'country' };
  }
  if (row.featureClass !== 'P' || !ELIGIBLE_FEATURE.has(row.featureCode)) {
    return { ok: false, reason: 'feature' };
  }
  if (!row.name || !row.timezone || !isValidIanaTimeZone(row.timezone)) {
    return { ok: false, reason: 'timezone' };
  }
  if (Math.abs(row.latitude) < 0.5 && Math.abs(row.longitude) < 0.5) {
    return { ok: false, reason: 'coordinates' };
  }
  if (looksLikeLatLonReversed(row.latitude, row.longitude)) {
    return { ok: false, reason: 'latlon-reversal' };
  }
  // cities15000 already encodes pop>15000 or capital; keep explicit documentation.
  // Capitals (PPLC) may have population below 15000 in rare cases — still eligible.
  if (row.population < 15_000 && row.featureCode !== 'PPLC') {
    return { ok: false, reason: 'population' };
  }
  return { ok: true };
}

export function toCatalogCity(row: GeonamesRawCity): CatalogCity {
  return {
    id: `place:geonames:${row.geonameId}`,
    externalId: `geonames:${row.geonameId}`,
    geonamesId: row.geonameId,
    name: row.name,
    countryCode: row.countryCode,
    timezone: row.timezone,
    latitude: row.latitude,
    longitude: row.longitude,
    ownership: 'catalog:geonames',
    population: row.population,
    featureClass: row.featureClass,
    featureCode: row.featureCode,
  };
}

/**
 * Stream-parse GeoNames cities15000.txt into European meeting-city candidates.
 * Output order is sorted by geonameId for determinism independent of source row order.
 */
export async function parseGeonamesCitiesFile(txtPath: string): Promise<{
  readonly cities: readonly CatalogCity[];
  readonly diagnostics: GeonamesParseDiagnostics;
}> {
  const rl = createInterface({
    input: createReadStream(txtPath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });
  const byId = new Map<number, CatalogCity>();
  const duplicateGeonameIds: number[] = [];
  const messages: string[] = [];
  let rowsRead = 0;
  let rejectedMalformed = 0;
  let rejectedCountry = 0;
  let rejectedFeature = 0;
  let rejectedTimezone = 0;
  let rejectedCoordinates = 0;
  let rejectedLatLonReversal = 0;

  for await (const line of rl) {
    rowsRead += 1;
    const parsed = parseGeonamesLine(line);
    if ('error' in parsed) {
      if (parsed.error !== 'empty-or-comment') {
        rejectedMalformed += 1;
        if (messages.length < 50) {
          messages.push(`row ${rowsRead}: ${parsed.error}`);
        }
      }
      continue;
    }
    const eligibility = isEligibleGeonamesCity(parsed);
    if (!eligibility.ok) {
      switch (eligibility.reason) {
        case 'country':
          rejectedCountry += 1;
          break;
        case 'feature':
          rejectedFeature += 1;
          break;
        case 'timezone':
          rejectedTimezone += 1;
          break;
        case 'coordinates':
          rejectedCoordinates += 1;
          break;
        case 'latlon-reversal':
          rejectedLatLonReversal += 1;
          break;
        default:
          rejectedFeature += 1;
      }
      continue;
    }
    if (byId.has(parsed.geonameId)) {
      duplicateGeonameIds.push(parsed.geonameId);
      continue;
    }
    byId.set(parsed.geonameId, toCatalogCity(parsed));
  }

  const cities = [...byId.values()].sort((a, b) => {
    const aid = a.geonamesId ?? 0;
    const bid = b.geonamesId ?? 0;
    return aid - bid || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  });

  return {
    cities,
    diagnostics: {
      rowsRead,
      accepted: cities.length,
      rejectedMalformed,
      rejectedCountry,
      rejectedFeature,
      rejectedTimezone,
      rejectedCoordinates,
      rejectedLatLonReversal,
      duplicateGeonameIds,
      messages,
    },
  };
}

export function buildGeonamesCitiesArtifact(
  cities: readonly CatalogCity[],
  options: {
    readonly sourceVersion: string;
    readonly retrievedAt: string;
    readonly sha256: string;
  },
): CatalogArtifact {
  return {
    schemaVersion: 1,
    source: 'catalog:geonames',
    sourceVersion: options.sourceVersion,
    license: `${GEONAMES_SOURCE_DEFAULTS.license} (${GEONAMES_LICENSE_URL})`,
    attribution: GEONAMES_ATTRIBUTION,
    retrievedAt: options.retrievedAt,
    coverage: `European meeting cities from GeoNames cities15000 (sha256=${options.sha256.slice(0, 12)}…)`,
    artifactKind: 'production-catalog',
    selectionPolicyVersion: CITY_SELECTION_POLICY_VERSION,
    cities: [...cities],
    hubs: [],
  };
}
