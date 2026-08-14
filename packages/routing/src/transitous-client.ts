import type { Logger } from '@railmeet/observability';

import { RoutingError } from './errors.js';
import {
  assertPlanJourneyCoordinates,
  MOTIS_OPENAPI_PIN,
  MOTIS_PLAN_API_VERSION,
  normalizeMotisPlanResponse,
} from './motis-normalize.js';
import type { JourneyPlanner, PlanJourneyInput, PlanJourneyResult } from './types.js';

export type TransitousClientOptions = {
  readonly baseUrl: string;
  readonly userAgent: string;
  readonly timeoutMs: number;
  readonly maxResponseBytes: number;
  readonly logger?: Logger;
  /** Injected for tests. Defaults to global fetch. */
  readonly fetchImpl?: typeof fetch;
};

function joinUrl(baseUrl: string, path: string): string {
  const normalizedBase = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${normalizedBase}${normalizedPath}`;
}

function placeParam(latitude: number, longitude: number): string {
  return `${latitude},${longitude}`;
}

/**
 * Production-quality Transitous MOTIS 2 adapter for a single planJourney call.
 * Performs at most one HTTP attempt per invocation (no layered retries).
 */
export function createTransitousJourneyPlanner(options: TransitousClientOptions): JourneyPlanner {
  const fetchImpl = options.fetchImpl ?? fetch;
  const logger = options.logger;

  return {
    async planJourney(input: PlanJourneyInput): Promise<PlanJourneyResult> {
      assertPlanJourneyCoordinates(input);
      if (!(input.departureAt instanceof Date) || Number.isNaN(input.departureAt.getTime())) {
        throw new RoutingError('INVALID_REQUEST', 'permanent', 'departureAt must be a valid Date');
      }

      // Pinned to `/api/v5/plan`. Do not call `/api/v5/refresh-itinerary` (404)
      // or mix in `/api/v6/refresh-itinerary` while this adapter stays on v5.
      const url = new URL(joinUrl(options.baseUrl, `/${MOTIS_PLAN_API_VERSION}/plan`));
      url.searchParams.set('fromPlace', placeParam(input.origin.latitude, input.origin.longitude));
      url.searchParams.set(
        'toPlace',
        placeParam(input.destination.latitude, input.destination.longitude),
      );
      url.searchParams.set('time', input.departureAt.toISOString());
      if (input.arriveBy !== undefined) {
        url.searchParams.set('arriveBy', String(input.arriveBy));
      }
      if (input.locale) {
        url.searchParams.set('locale', input.locale);
      }
      if (input.maxTransfers !== undefined) {
        url.searchParams.set('maxTransfers', String(input.maxTransfers));
      }

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
      const started = Date.now();

      logger?.info(
        {
          event: 'transitous_request_started',
          provider: 'transitous',
          operation: 'plan',
          apiPin: MOTIS_OPENAPI_PIN,
        },
        'Transitous request started',
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

        const contentType = response.headers.get('content-type') ?? '';
        const raw = await response.text();
        if (Buffer.byteLength(raw, 'utf8') > options.maxResponseBytes) {
          throw new RoutingError(
            'PROVIDER_CONTRACT_FAILURE',
            'provider_contract',
            'Provider response exceeded size limit',
            { httpStatus: response.status },
          );
        }

        if (!contentType.toLowerCase().includes('application/json')) {
          throw classifyHttpFailure(response.status, 'non-json body');
        }

        let json: unknown;
        try {
          json = raw.length === 0 ? {} : JSON.parse(raw);
        } catch (cause) {
          throw new RoutingError(
            'PROVIDER_CONTRACT_FAILURE',
            'provider_contract',
            'Provider returned invalid JSON',
            { cause, httpStatus: response.status },
          );
        }

        if (!response.ok) {
          throw classifyHttpFailure(response.status, 'error status');
        }

        const journeys = normalizeMotisPlanResponse(json);
        logger?.info(
          {
            event: 'transitous_request_completed',
            provider: 'transitous',
            operation: 'plan',
            httpStatusClass: `${Math.floor(response.status / 100)}xx`,
            latencyMs: Date.now() - started,
            journeyCount: journeys.length,
          },
          'Transitous request completed',
        );
        return { journeys };
      } catch (error) {
        if (error instanceof RoutingError) {
          logger?.warn(
            {
              event: 'transitous_request_failed',
              provider: 'transitous',
              operation: 'plan',
              errorCode: error.code,
              classification: error.classification,
              httpStatusClass:
                error.httpStatus !== undefined
                  ? `${Math.floor(error.httpStatus / 100)}xx`
                  : undefined,
              latencyMs: Date.now() - started,
            },
            'Transitous request failed',
          );
          throw error;
        }
        if (isAbortError(error)) {
          const externalAbort = Boolean(input.signal?.aborted) && !timedOut;
          const routingError = externalAbort
            ? new RoutingError('SHUTDOWN', 'shutdown', 'Transitous request aborted by shutdown', {
                cause: error,
              })
            : new RoutingError('TIMEOUT', 'transient', 'Transitous request timed out', {
                cause: error,
              });
          logger?.warn(
            {
              event: 'transitous_request_failed',
              provider: 'transitous',
              operation: 'plan',
              errorCode: routingError.code,
              classification: routingError.classification,
              latencyMs: Date.now() - started,
            },
            'Transitous request failed',
          );
          throw routingError;
        }
        const routingError = new RoutingError(
          'NETWORK_FAILURE',
          'transient',
          'Transitous network failure',
          { cause: error },
        );
        logger?.warn(
          {
            event: 'transitous_request_failed',
            provider: 'transitous',
            operation: 'plan',
            errorCode: routingError.code,
            classification: routingError.classification,
            latencyMs: Date.now() - started,
          },
          'Transitous request failed',
        );
        throw routingError;
      } finally {
        clearTimeout(timer);
        input.signal?.removeEventListener('abort', onExternalAbort);
      }
    },
  };
}

function classifyHttpFailure(status: number, detail: string): RoutingError {
  if (status === 429) {
    return new RoutingError('RATE_LIMITED', 'rate_limited', `Transitous rate limited (${detail})`, {
      httpStatus: status,
    });
  }
  if (status === 400 || status === 404) {
    return new RoutingError(
      'PROVIDER_REQUEST_FAILED',
      'permanent',
      `Transitous rejected the request (${detail})`,
      { httpStatus: status },
    );
  }
  if (status >= 500) {
    return new RoutingError(
      'PROVIDER_UNAVAILABLE',
      'provider_unavailable',
      `Transitous unavailable (${detail})`,
      { httpStatus: status },
    );
  }
  return new RoutingError(
    'PROVIDER_REQUEST_FAILED',
    'permanent',
    `Transitous request failed (${detail})`,
    { httpStatus: status },
  );
}

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof Error && error.name === 'AbortError') ||
    (typeof error === 'object' &&
      error !== null &&
      'name' in error &&
      (error as { name: string }).name === 'AbortError')
  );
}
