import type { MapStopsClient, StationFeatureCollection } from '@railmeet/routing';
import { RoutingError } from '@railmeet/routing';
import {
  MAP_STOPS_BOUNDS_QUANTIZE_DECIMALS,
  MAP_STOPS_CACHE_MAX_ENTRIES,
  MAP_STOPS_CACHE_TTL_MS,
  MAP_STOPS_FEATURE_SOFT_LIMIT,
  MAP_STOPS_MINIMUM_DETAIL_ZOOM,
} from '@railmeet/shared';

export type MapStopsServiceError =
  | { readonly kind: 'validation'; readonly message: string }
  | { readonly kind: 'unavailable'; readonly message: string }
  | { readonly kind: 'internal'; readonly cause: unknown };

export type MapStopsServiceResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: MapStopsServiceError };

export type MapStopsLookupInput = {
  readonly minLon: number;
  readonly minLat: number;
  readonly maxLon: number;
  readonly maxLat: number;
  readonly zoom: number;
  readonly signal?: AbortSignal;
};

export type MapStopsService = {
  getMapStops: (
    input: MapStopsLookupInput,
  ) => Promise<MapStopsServiceResult<StationFeatureCollection>>;
};

type CacheEntry = {
  readonly expiresAt: number;
  readonly collection: StationFeatureCollection;
};

function quantize(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

export function buildMapStopsCacheKey(input: {
  readonly minLon: number;
  readonly minLat: number;
  readonly maxLon: number;
  readonly maxLat: number;
  readonly zoom: number;
  readonly decimals?: number;
}): string {
  const decimals = input.decimals ?? MAP_STOPS_BOUNDS_QUANTIZE_DECIMALS;
  return [
    quantize(input.minLon, decimals).toFixed(decimals),
    quantize(input.minLat, decimals).toFixed(decimals),
    quantize(input.maxLon, decimals).toFixed(decimals),
    quantize(input.maxLat, decimals).toFixed(decimals),
    Math.floor(input.zoom),
  ].join(':');
}

function mapUpstreamError(error: unknown): MapStopsServiceError {
  if (error instanceof RoutingError) {
    if (error.code === 'SHUTDOWN') {
      return { kind: 'unavailable', message: 'Map stops request was cancelled' };
    }
    if (error.code === 'INVALID_REQUEST') {
      return { kind: 'validation', message: error.message };
    }
    if (
      error.code === 'TIMEOUT' ||
      error.code === 'NETWORK_FAILURE' ||
      error.code === 'PROVIDER_UNAVAILABLE' ||
      error.code === 'RATE_LIMITED' ||
      error.code === 'PROVIDER_REQUEST_FAILED' ||
      error.code === 'PROVIDER_CONTRACT_FAILURE'
    ) {
      return {
        kind: 'unavailable',
        message: 'Map stations are temporarily unavailable. Try again.',
      };
    }
  }
  return { kind: 'internal', cause: error };
}

function truncateIfNeeded(collection: StationFeatureCollection): StationFeatureCollection {
  if (collection.features.length <= MAP_STOPS_FEATURE_SOFT_LIMIT) {
    return {
      ...collection,
      metadata: {
        ...collection.metadata,
        sourceFeatureCount: collection.features.length,
      },
    };
  }

  const preferred = collection.features.filter(
    (feature) =>
      feature.properties.importance === 'major' || feature.properties.importance === 'regional',
  );
  const features =
    preferred.length > 0
      ? preferred.slice(0, MAP_STOPS_FEATURE_SOFT_LIMIT)
      : collection.features.slice(0, MAP_STOPS_FEATURE_SOFT_LIMIT);

  return {
    type: 'FeatureCollection',
    features,
    metadata: {
      truncated: true,
      aggregated: true,
      minimumDetailZoom: MAP_STOPS_MINIMUM_DETAIL_ZOOM,
      sourceFeatureCount: collection.features.length,
    },
  };
}

function touchLru(cache: Map<string, CacheEntry>, key: string, entry: CacheEntry): void {
  cache.delete(key);
  cache.set(key, entry);
  while (cache.size > MAP_STOPS_CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) {
      break;
    }
    cache.delete(oldest);
  }
}

export function createMapStopsService(deps: {
  readonly mapStopsClient: MapStopsClient;
  readonly cacheTtlMs?: number;
  readonly now?: () => number;
}): MapStopsService {
  const cache = new Map<string, CacheEntry>();
  const cacheTtlMs = deps.cacheTtlMs ?? MAP_STOPS_CACHE_TTL_MS;
  const now = deps.now ?? Date.now;

  return {
    async getMapStops(input) {
      const cacheKey = buildMapStopsCacheKey(input);
      const cached = cache.get(cacheKey);
      if (cached && cached.expiresAt > now()) {
        touchLru(cache, cacheKey, cached);
        return { ok: true, value: cached.collection };
      }

      try {
        const raw = await deps.mapStopsClient.fetchMapStops({
          minLat: input.minLat,
          minLon: input.minLon,
          maxLat: input.maxLat,
          maxLon: input.maxLon,
          ...(input.signal ? { signal: input.signal } : {}),
        });
        const collection = truncateIfNeeded(raw);
        touchLru(cache, cacheKey, {
          expiresAt: now() + cacheTtlMs,
          collection,
        });
        return { ok: true, value: collection };
      } catch (error) {
        return { ok: false, error: mapUpstreamError(error) };
      }
    },
  };
}
