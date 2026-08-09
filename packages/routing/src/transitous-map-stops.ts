import { RoutingError } from './errors.js';
import {
  MOTIS_MAP_STOPS_API_VERSION,
  MOTIS_MAP_STOPS_OPENAPI_PIN,
  normalizeMotisMapStopsResponse,
} from './motis-map-stops.js';
import type { TransitousClientOptions } from './transitous-client.js';
import type { FetchMapStopsInput, MapStopsClient, StationFeatureCollection } from './types.js';

function joinUrl(baseUrl: string, path: string): string {
  const normalizedBase = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${normalizedBase}${normalizedPath}`;
}

/**
 * MOTIS `/v1/map/stops` expects:
 * - min = lower-right = (minLat, maxLon)
 * - max = upper-left = (maxLat, minLon)
 */
function assertValidBounds(input: FetchMapStopsInput): void {
  if (
    !(
      Number.isFinite(input.minLat) &&
      Number.isFinite(input.maxLat) &&
      Number.isFinite(input.minLon) &&
      Number.isFinite(input.maxLon)
    )
  ) {
    throw new RoutingError('INVALID_REQUEST', 'permanent', 'Map stops bounds must be finite');
  }
  if (!(input.minLat < input.maxLat) || !(input.minLon < input.maxLon)) {
    throw new RoutingError(
      'INVALID_REQUEST',
      'permanent',
      'Map stops bounds require minLat < maxLat and minLon < maxLon',
    );
  }
  if (
    Math.abs(input.minLat) > 90 ||
    Math.abs(input.maxLat) > 90 ||
    Math.abs(input.minLon) > 180 ||
    Math.abs(input.maxLon) > 180
  ) {
    throw new RoutingError('INVALID_REQUEST', 'permanent', 'Map stops bounds are out of range');
  }
}

/**
 * Transitous MOTIS map-stops adapter for viewport station layers.
 * One HTTP attempt per invocation; raw Place payloads never leave this package.
 */
export function createTransitousMapStopsClient(options: TransitousClientOptions): MapStopsClient {
  const fetchImpl = options.fetchImpl ?? fetch;
  const logger = options.logger;

  return {
    async fetchMapStops(input: FetchMapStopsInput): Promise<StationFeatureCollection> {
      assertValidBounds(input);

      const url = new URL(joinUrl(options.baseUrl, `/${MOTIS_MAP_STOPS_API_VERSION}/map/stops`));
      // MOTIS: min=lower-right, max=upper-left (lat,lon).
      url.searchParams.set('min', `${input.minLat},${input.maxLon}`);
      url.searchParams.set('max', `${input.maxLat},${input.minLon}`);

      const controller = new AbortController();
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, options.timeoutMs);
      const onExternalAbort = (): void => {
        controller.abort();
      };
      if (input.signal) {
        if (input.signal.aborted) {
          controller.abort();
        } else {
          input.signal.addEventListener('abort', onExternalAbort, { once: true });
        }
      }

      logger?.info(
        {
          event: 'transitous_request_started',
          provider: 'transitous',
          operation: 'map_stops',
          apiPin: MOTIS_MAP_STOPS_OPENAPI_PIN,
        },
        'Transitous map stops request started',
      );

      try {
        const response = await fetchImpl(url, {
          method: 'GET',
          headers: {
            Accept: 'application/json',
            'User-Agent': options.userAgent,
          },
          signal: controller.signal,
          redirect: 'error',
        });

        if (response.status === 429) {
          throw new RoutingError(
            'RATE_LIMITED',
            'rate_limited',
            'Transitous map stops rate limited',
            { httpStatus: 429 },
          );
        }
        if (response.status >= 500) {
          throw new RoutingError(
            'PROVIDER_UNAVAILABLE',
            'provider_unavailable',
            'Transitous map stops unavailable',
            { httpStatus: response.status },
          );
        }
        if (!response.ok) {
          throw new RoutingError(
            'PROVIDER_REQUEST_FAILED',
            'permanent',
            `Transitous map stops failed with HTTP ${response.status}`,
            { httpStatus: response.status },
          );
        }

        const buffer = await response.arrayBuffer();
        if (buffer.byteLength > options.maxResponseBytes) {
          throw new RoutingError(
            'PROVIDER_CONTRACT_FAILURE',
            'provider_contract',
            'Transitous map stops response exceeded size limit',
          );
        }

        let payload: unknown;
        try {
          payload = JSON.parse(new TextDecoder().decode(buffer));
        } catch (error) {
          throw new RoutingError(
            'PROVIDER_CONTRACT_FAILURE',
            'provider_contract',
            'Transitous map stops response was not valid JSON',
            { cause: error },
          );
        }

        return normalizeMotisMapStopsResponse(payload);
      } catch (error) {
        if (error instanceof RoutingError) {
          throw error;
        }
        if (controller.signal.aborted) {
          if (timedOut) {
            throw new RoutingError('TIMEOUT', 'transient', 'Transitous map stops timed out');
          }
          if (input.signal?.aborted) {
            throw new RoutingError('SHUTDOWN', 'shutdown', 'Transitous map stops aborted');
          }
          throw new RoutingError('TIMEOUT', 'transient', 'Transitous map stops aborted');
        }
        throw new RoutingError(
          'NETWORK_FAILURE',
          'transient',
          'Transitous map stops network failure',
          { cause: error },
        );
      } finally {
        clearTimeout(timer);
        if (input.signal) {
          input.signal.removeEventListener('abort', onExternalAbort);
        }
      }
    },
  };
}
