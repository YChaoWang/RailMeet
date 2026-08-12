import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { associateCityToHub, type HubMatchCandidate } from './associate.js';
import { GEONAMES_ATTRIBUTION, writeSourceManifest } from './geonames-download.js';
import {
  artifactsDir,
  cacheDir,
  transitousHubsArtifactPath,
  transitousHubsManifestPath,
} from './paths.js';
import type { CatalogArtifact, CatalogCity, CatalogHub, SourceManifest } from './types.js';

const DEFAULT_TRANSITOUS_BASE = 'https://api.transitous.org';

export type TransitousGeocodeMatch = {
  readonly type: string;
  readonly name: string;
  readonly id: string;
  readonly lat: number;
  readonly lon: number;
  readonly country?: string;
  readonly tz?: string;
  readonly modes?: readonly string[];
  readonly areas?: ReadonlyArray<{ readonly name: string; readonly adminLevel?: number }>;
};

/**
 * Fetch STOP matches from Transitous MOTIS geocode for a city query.
 * Manual/offline-cacheable — not used by CI.
 */
export async function fetchTransitousStopsForCity(
  city: CatalogCity,
  options?: {
    readonly baseUrl?: string;
    readonly fetchImpl?: typeof fetch;
  },
): Promise<readonly HubMatchCandidate[]> {
  const baseUrl = options?.baseUrl ?? DEFAULT_TRANSITOUS_BASE;
  const fetchImpl = options?.fetchImpl ?? fetch;
  const url = new URL(`${baseUrl.replace(/\/$/, '')}/api/v1/geocode`);
  url.searchParams.set('text', city.name);
  // Bias toward the city centroid so same-name places elsewhere do not dominate.
  url.searchParams.set('place', `${city.latitude},${city.longitude}`);

  const response = await fetchImpl(url, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      'User-Agent': 'RailMeet/0.1 (catalog-hub-enrich; local manual)',
    },
    redirect: 'error',
  });
  if (!response.ok) {
    throw new Error(`Transitous geocode HTTP ${response.status} for ${city.id}`);
  }
  const payload = (await response.json()) as TransitousGeocodeMatch[];
  if (!Array.isArray(payload)) {
    throw new Error(`Transitous geocode non-array for ${city.id}`);
  }

  return payload
    .filter((match) => match.type === 'STOP' && typeof match.id === 'string')
    .map((match) => {
      const country = (match.country ?? city.countryCode).trim().toUpperCase();
      const locality =
        match.areas?.find((area) => (area.adminLevel ?? 0) >= 4 && (area.adminLevel ?? 0) <= 8)
          ?.name ?? null;
      return {
        providerStopId: match.id,
        name: match.name,
        countryCode: /^[A-Z]{2}$/.test(country) ? country : city.countryCode,
        timezone: match.tz?.trim() || city.timezone,
        latitude: match.lat,
        longitude: match.lon,
        localityName: locality,
        modes: match.modes ?? [],
        resultType: match.type,
      } satisfies HubMatchCandidate;
    });
}

export type HubEnrichmentReport = {
  readonly matched: number;
  readonly ambiguous: number;
  readonly rejected: number;
  readonly hubs: readonly CatalogHub[];
  readonly ambiguousDetails: readonly string[];
  readonly rejectedDetails: readonly string[];
};

/**
 * Deterministically associate cities to Transitous STOP hubs.
 * When `cacheOnly` is true, reads previously cached geocode JSON per city.
 */
function geocodeCacheMissingModes(stops: readonly HubMatchCandidate[]): boolean {
  // Pre-capability caches omitted MOTIS modes; those cannot distinguish rail hubs
  // from local coach/bus stops and must be refreshed from Transitous.
  return stops.length > 0 && stops.every((stop) => stop.modes === undefined);
}

export async function enrichHubsForCities(
  cities: readonly CatalogCity[],
  options?: {
    readonly baseUrl?: string;
    readonly fetchImpl?: typeof fetch;
    readonly cacheOnly?: boolean;
    /** Force network refresh even when a cache file exists. */
    readonly refresh?: boolean;
    readonly limit?: number;
    readonly delayMs?: number;
  },
): Promise<HubEnrichmentReport> {
  mkdirSync(join(cacheDir(), 'transitous-geocode'), { recursive: true });
  const hubs: CatalogHub[] = [];
  const ambiguousDetails: string[] = [];
  const rejectedDetails: string[] = [];
  const limit = options?.limit ?? cities.length;
  const selected = [...cities]
    .sort(
      (a, b) =>
        (b.population ?? 0) - (a.population ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    )
    .slice(0, limit);

  for (const city of selected) {
    const cachePath = join(
      cacheDir(),
      'transitous-geocode',
      `${city.id.replace(/[/:]/g, '_')}.json`,
    );
    let stops: readonly HubMatchCandidate[];
    if (options?.cacheOnly) {
      if (!existsSync(cachePath)) {
        rejectedDetails.push(`${city.id}:cache-miss`);
        continue;
      }
      stops = JSON.parse(readFileSync(cachePath, 'utf8')) as HubMatchCandidate[];
    } else {
      const cached =
        !options?.refresh && existsSync(cachePath)
          ? (JSON.parse(readFileSync(cachePath, 'utf8')) as HubMatchCandidate[])
          : null;
      const cacheUsable = cached !== null && !geocodeCacheMissingModes(cached);
      if (cacheUsable) {
        stops = cached;
      } else {
        try {
          stops = await fetchTransitousStopsForCity(city, options);
          writeFileSync(cachePath, `${JSON.stringify(stops, null, 2)}\n`, 'utf8');
          if (options?.delayMs && options.delayMs > 0) {
            await new Promise((resolve) => setTimeout(resolve, options.delayMs));
          }
        } catch (error) {
          rejectedDetails.push(
            `${city.id}:fetch-error:${error instanceof Error ? error.message : 'unknown'}`,
          );
          continue;
        }
      }
    }

    const result = associateCityToHub(city, stops);
    if (result.status === 'matched') {
      hubs.push(result.hub);
    } else if (result.status === 'ambiguous') {
      ambiguousDetails.push(`${city.id}:${result.reason}:${result.candidates.join(',')}`);
    } else {
      rejectedDetails.push(`${city.id}:${result.reason}`);
    }
  }

  hubs.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return {
    matched: hubs.length,
    ambiguous: ambiguousDetails.length,
    rejected: rejectedDetails.length,
    hubs,
    ambiguousDetails,
    rejectedDetails,
  };
}

export function writeHubsArtifact(
  hubs: readonly CatalogHub[],
  options: {
    readonly sourceVersion: string;
    readonly retrievedAt: string;
    readonly citiesSourceVersion: string;
  },
): void {
  mkdirSync(artifactsDir(), { recursive: true });
  const sidecar = {
    schemaVersion: 1 as const,
    source: 'catalog:transitous',
    sourceVersion: options.sourceVersion,
    license:
      'Hub stop IDs and coordinates from Transitous MOTIS geocode (OpenStreetMap/GTFS feeds). City metadata remains GeoNames CC BY 4.0.',
    attribution: `${GEONAMES_ATTRIBUTION}; Transitous https://transitous.org/`,
    retrievedAt: options.retrievedAt,
    coverage: `Representative hubs for cities from ${options.citiesSourceVersion}`,
    selectionPolicyVersion: 'transitous-geocode-stop-v1',
    hubs: [...hubs],
  };
  writeFileSync(transitousHubsArtifactPath(), `${JSON.stringify(sidecar, null, 2)}\n`, 'utf8');

  const manifest: SourceManifest = {
    source: 'transitous',
    artifactUrl: `${DEFAULT_TRANSITOUS_BASE}/api/v1/geocode`,
    retrievedAt: options.retrievedAt,
    version: options.sourceVersion,
    sha256: null,
    expectedSha256: null,
    license: 'Transitous/MOTIS stop data; underlying GTFS/OSM per feed licenses',
    attribution: 'Transitous https://transitous.org/',
    format: 'MOTIS geocode STOP matches (cached JSON per city)',
    coverage: 'Hubs for European GeoNames cities (manual enrich)',
    selectionPolicyVersion: 'transitous-geocode-stop-v1',
  };
  writeSourceManifest(transitousHubsManifestPath(), manifest);
}

export function loadHubsSidecar(path = transitousHubsArtifactPath()): {
  readonly hubs: readonly CatalogHub[];
  readonly sourceVersion: string;
} {
  const raw = JSON.parse(readFileSync(path, 'utf8')) as {
    hubs: CatalogHub[];
    sourceVersion: string;
  };
  return { hubs: raw.hubs, sourceVersion: raw.sourceVersion };
}

export function mergeCitiesAndHubs(
  citiesArtifact: CatalogArtifact,
  hubs: readonly CatalogHub[],
): CatalogArtifact {
  const cityIds = new Set(citiesArtifact.cities.map((city) => city.id));
  const filtered = hubs.filter((hub) => cityIds.has(hub.cityId));
  return {
    ...citiesArtifact,
    source: 'catalog:geonames+transitous',
    hubs: [...filtered].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    license: `${citiesArtifact.license}; hubs from Transitous MOTIS geocode`,
    attribution: `${citiesArtifact.attribution}; Transitous https://transitous.org/`,
  };
}
