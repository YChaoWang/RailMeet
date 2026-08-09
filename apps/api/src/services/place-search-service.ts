import type { PlaceGeocoder, PlaceSuggestion } from '@railmeet/routing';
import { RoutingError } from '@railmeet/routing';
import { PLACE_GEOCODE_CACHE_TTL_MS, PLACE_SEARCH_QUERY_MIN_LENGTH } from '@railmeet/shared';

export type PlaceSearchServiceError =
  | { readonly kind: 'validation'; readonly message: string }
  | { readonly kind: 'unavailable'; readonly message: string }
  | { readonly kind: 'internal'; readonly cause: unknown };

export type PlaceSearchServiceResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: PlaceSearchServiceError };

export type PlaceSearchResult = {
  readonly query: string;
  readonly suggestions: readonly PlaceSuggestion[];
};

export type PlaceSearchService = {
  searchPlaces: (input: {
    readonly query: string;
    readonly signal?: AbortSignal;
  }) => Promise<PlaceSearchServiceResult<PlaceSearchResult>>;
};

type CacheEntry = {
  readonly expiresAt: number;
  readonly suggestions: readonly PlaceSuggestion[];
};

function normalizeQuery(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ');
}

function mapUpstreamError(error: unknown): PlaceSearchServiceError {
  if (error instanceof RoutingError) {
    if (error.code === 'SHUTDOWN') {
      return { kind: 'unavailable', message: 'Place search was cancelled' };
    }
    if (
      error.code === 'TIMEOUT' ||
      error.code === 'NETWORK_FAILURE' ||
      error.code === 'PROVIDER_UNAVAILABLE' ||
      error.code === 'RATE_LIMITED' ||
      error.code === 'PROVIDER_REQUEST_FAILED'
    ) {
      return {
        kind: 'unavailable',
        message: 'Place suggestions are temporarily unavailable. Try again.',
      };
    }
    if (error.code === 'INVALID_REQUEST') {
      return { kind: 'validation', message: 'Enter a longer place name to search' };
    }
  }
  return { kind: 'internal', cause: error };
}

export function createPlaceSearchService(deps: {
  readonly geocoder: PlaceGeocoder;
  readonly cacheTtlMs?: number;
  readonly now?: () => number;
}): PlaceSearchService {
  const cache = new Map<string, CacheEntry>();
  const cacheTtlMs = deps.cacheTtlMs ?? PLACE_GEOCODE_CACHE_TTL_MS;
  const now = deps.now ?? Date.now;

  return {
    async searchPlaces(input) {
      const query = normalizeQuery(input.query);
      if (query.length < PLACE_SEARCH_QUERY_MIN_LENGTH) {
        return {
          ok: false,
          error: {
            kind: 'validation',
            message: `Enter at least ${PLACE_SEARCH_QUERY_MIN_LENGTH} characters`,
          },
        };
      }

      const cacheKey = query.toLowerCase();
      const cached = cache.get(cacheKey);
      if (cached && cached.expiresAt > now()) {
        return { ok: true, value: { query, suggestions: cached.suggestions } };
      }

      try {
        const result = await deps.geocoder.geocodePlaces({
          text: query,
          ...(input.signal ? { signal: input.signal } : {}),
        });
        cache.set(cacheKey, {
          expiresAt: now() + cacheTtlMs,
          suggestions: result.suggestions,
        });
        return { ok: true, value: { query, suggestions: result.suggestions } };
      } catch (error) {
        return { ok: false, error: mapUpstreamError(error) };
      }
    },
  };
}
