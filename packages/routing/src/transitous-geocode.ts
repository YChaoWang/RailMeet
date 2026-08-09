import { RoutingError } from './errors.js';
import {
  MOTIS_GEOCODE_API_VERSION,
  MOTIS_GEOCODE_OPENAPI_PIN,
  normalizeMotisGeocodeResponse,
} from './motis-geocode.js';
import type { PlaceGeocoder, GeocodePlacesInput, GeocodePlacesResult } from './types.js';
import type { TransitousClientOptions } from './transitous-client.js';

function joinUrl(baseUrl: string, path: string): string {
  const normalizedBase = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${normalizedBase}${normalizedPath}`;
}

/**
 * Transitous MOTIS geocode adapter for place autocomplete.
 * One HTTP attempt per invocation; raw Match payloads never leave this package.
 */
export function createTransitousPlaceGeocoder(options: TransitousClientOptions): PlaceGeocoder {
  const fetchImpl = options.fetchImpl ?? fetch;
  const logger = options.logger;

  return {
    async geocodePlaces(input: GeocodePlacesInput): Promise<GeocodePlacesResult> {
      const text = input.text.trim();
      if (text.length === 0) {
        throw new RoutingError('INVALID_REQUEST', 'permanent', 'Geocode text must not be empty');
      }

      const url = new URL(joinUrl(options.baseUrl, `/${MOTIS_GEOCODE_API_VERSION}/geocode`));
      url.searchParams.set('text', text);

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
          operation: 'geocode',
          apiPin: MOTIS_GEOCODE_OPENAPI_PIN,
        },
        'Transitous geocode request started',
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
            'Transitous geocode rate limited',
            { httpStatus: 429 },
          );
        }
        if (response.status >= 500) {
          throw new RoutingError(
            'PROVIDER_UNAVAILABLE',
            'provider_unavailable',
            'Transitous geocode unavailable',
            { httpStatus: response.status },
          );
        }
        if (!response.ok) {
          throw new RoutingError(
            'PROVIDER_REQUEST_FAILED',
            'permanent',
            `Transitous geocode failed with HTTP ${response.status}`,
            { httpStatus: response.status },
          );
        }

        const buffer = await response.arrayBuffer();
        if (buffer.byteLength > options.maxResponseBytes) {
          throw new RoutingError(
            'PROVIDER_CONTRACT_FAILURE',
            'provider_contract',
            'Transitous geocode response exceeded size limit',
          );
        }

        let payload: unknown;
        try {
          payload = JSON.parse(new TextDecoder().decode(buffer));
        } catch (error) {
          throw new RoutingError(
            'PROVIDER_CONTRACT_FAILURE',
            'provider_contract',
            'Transitous geocode response was not valid JSON',
            { cause: error },
          );
        }

        return { suggestions: normalizeMotisGeocodeResponse(payload) };
      } catch (error) {
        if (error instanceof RoutingError) {
          throw error;
        }
        if (controller.signal.aborted) {
          if (timedOut) {
            throw new RoutingError('TIMEOUT', 'transient', 'Transitous geocode timed out');
          }
          if (input.signal?.aborted) {
            throw new RoutingError('SHUTDOWN', 'shutdown', 'Transitous geocode aborted');
          }
          throw new RoutingError('TIMEOUT', 'transient', 'Transitous geocode aborted');
        }
        throw new RoutingError(
          'NETWORK_FAILURE',
          'transient',
          'Transitous geocode network failure',
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
