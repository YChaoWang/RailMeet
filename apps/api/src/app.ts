import type { Database } from '@railmeet/database';
import type { Logger } from '@railmeet/observability';
import type { MapStopsClient, PlaceGeocoder } from '@railmeet/routing';
import { buildReleaseIdentity } from '@railmeet/shared';
import Fastify from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { ZodError } from 'zod';

import { isZodError, sendError, zodIssuesToDetails } from './http/errors.js';
import { mapStopsRoutes } from './routes/map-stops.js';
import { meetingSearchRoutes } from './routes/meeting-searches.js';
import { placeSearchRoutes } from './routes/places.js';
import { createMapStopsService, type MapStopsService } from './services/map-stops-service.js';
import {
  createMeetingSearchService,
  type MeetingSearchService,
} from './services/meeting-search-service.js';
import {
  createPlaceSearchService,
  type PlaceSearchService,
} from './services/place-search-service.js';

export type HealthResponse = {
  status: 'ok';
  service: string;
  version: string;
  gitSha: string;
  timestamp: string;
};

export type BuildServerOptions = {
  readonly logger: Logger;
  /** Persistence handle. Required for meeting-search routes; optional only for health-only tests. */
  readonly database?: Database;
  /** Allowed browser origins for CORS. Empty disables cross-origin access. */
  readonly webOrigins?: readonly string[];
  /** Override for deterministic request IDs in tests. */
  readonly genReqId?: () => string;
  /** Optional service override for unit/API tests with fakes. */
  readonly meetingSearchService?: MeetingSearchService;
  readonly placeSearchService?: PlaceSearchService;
  /** Optional geocoder used when placeSearchService is not provided. */
  readonly placeGeocoder?: PlaceGeocoder;
  readonly mapStopsService?: MapStopsService;
  /** Optional map-stops client used when mapStopsService is not provided. */
  readonly mapStopsClient?: MapStopsClient;
  /** Override readiness probe timeout (tests only). */
  readonly readinessProbeTimeoutMs?: number;
  /** Override readiness cache TTL (tests only). */
  readonly readinessCacheTtlMs?: number;
};

const DEFAULT_READINESS_PROBE_TIMEOUT_MS = 1_500;
const DEFAULT_READINESS_CACHE_TTL_MS = 5_000;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('readiness_probe_timeout')), timeoutMs);
    void promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/**
 * Builds a Fastify application without listening.
 * Database connections are closed via `app.close()` when a database was provided.
 *
 * Validation uses `fastify-type-provider-zod@4.0.2`, which peers with Zod 3 and Fastify 5.
 * Do not upgrade to provider v7 (requires Zod 4) while the monorepo stays on Zod 3.
 */
export async function buildServer(options: BuildServerOptions) {
  const app = Fastify({
    // Fastify accepts a Pino-compatible logger instance. The structural
    // FastifyBaseLogger type is slightly narrower under exactOptionalPropertyTypes.
    loggerInstance: options.logger,
    // Never trust an arbitrary client-supplied request ID string.
    requestIdHeader: false,
    genReqId: options.genReqId ?? (() => crypto.randomUUID()),
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  const allowedOrigins = new Set(options.webOrigins ?? []);
  if (allowedOrigins.size > 0) {
    app.addHook('onRequest', async (request, reply) => {
      const origin = request.headers.origin;
      if (origin && allowedOrigins.has(origin)) {
        reply.header('Access-Control-Allow-Origin', origin);
        reply.header('Vary', 'Origin');
        reply.header('Access-Control-Allow-Credentials', 'true');
      }
      if (request.method === 'OPTIONS') {
        reply.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        reply.header('Access-Control-Allow-Headers', 'Content-Type, Accept');
        if (origin && allowedOrigins.has(origin)) {
          reply.header('Access-Control-Allow-Origin', origin);
        }
        await reply.status(204).send();
        return;
      }
    });
  }

  app.addHook('onSend', async (request, reply, payload) => {
    void reply.header('x-request-id', request.id);
    return payload;
  });

  app.setErrorHandler((error, request, reply) => {
    if (reply.sent) {
      return;
    }

    if (isZodError(error) || error instanceof ZodError) {
      sendError(reply, request, 400, {
        code: 'VALIDATION_FAILED',
        message: 'Request validation failed',
        details: zodIssuesToDetails(error),
      });
      return;
    }

    // Fastify JSON parse errors
    if (
      error instanceof SyntaxError ||
      (error as { code?: string }).code === 'FST_ERR_CTP_INVALID_JSON_BODY'
    ) {
      sendError(reply, request, 400, {
        code: 'VALIDATION_FAILED',
        message: 'Malformed JSON body',
      });
      return;
    }

    const statusCode =
      typeof (error as { statusCode?: unknown }).statusCode === 'number'
        ? (error as { statusCode: number }).statusCode
        : 500;

    if (statusCode === 400) {
      sendError(reply, request, 400, {
        code: 'VALIDATION_FAILED',
        message: 'Request validation failed',
      });
      return;
    }

    request.log.error({ err: error }, 'Unhandled request error');
    sendError(reply, request, 500, {
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
    });
  });

  app.setNotFoundHandler((request, reply) => {
    // Keep /health as the only unversioned public route; everything else uses envelopes.
    sendError(reply, request, 404, {
      code: 'NOT_FOUND',
      message: 'The requested resource was not found',
    });
  });

  const release = buildReleaseIdentity('railmeet-api');
  const readinessProbeTimeoutMs = options.readinessProbeTimeoutMs ?? DEFAULT_READINESS_PROBE_TIMEOUT_MS;
  const readinessCacheTtlMs = options.readinessCacheTtlMs ?? DEFAULT_READINESS_CACHE_TTL_MS;
  let readinessCache:
    | { readonly status: 'ready' | 'unavailable'; readonly checkedAtMs: number }
    | undefined;

  app.get('/health', async (): Promise<HealthResponse> => {
    return {
      status: 'ok',
      service: release.service,
      version: release.version,
      gitSha: release.gitSha,
      timestamp: new Date().toISOString(),
    };
  });

  app.get('/ready', async (_req, reply) => {
    if (!options.database) {
      return reply.status(503).send({ status: 'unavailable', reason: 'database_unavailable' });
    }
    const now = Date.now();
    if (readinessCache && now - readinessCache.checkedAtMs <= readinessCacheTtlMs) {
      if (readinessCache.status === 'ready') {
        return { status: 'ready', service: release.service };
      }
      return reply.status(503).send({ status: 'unavailable', reason: 'database_unavailable' });
    }

    try {
      await withTimeout(options.database.ping(), readinessProbeTimeoutMs);
      readinessCache = { status: 'ready', checkedAtMs: now };
      return { status: 'ready', service: release.service };
    } catch {
      readinessCache = { status: 'unavailable', checkedAtMs: now };
      return reply.status(503).send({ status: 'unavailable', reason: 'database_unavailable' });
    }
  });

  const meetingSearchService =
    options.meetingSearchService ??
    (options.database
      ? createMeetingSearchService({
          meetingSearches: options.database.meetingSearches,
          places: options.database.places,
          finalization: options.database.finalization,
        })
      : undefined);

  if (meetingSearchService) {
    await app.register(meetingSearchRoutes, { meetingSearchService });
  }

  const placeSearchService =
    options.placeSearchService ??
    (options.placeGeocoder
      ? createPlaceSearchService({ geocoder: options.placeGeocoder })
      : undefined);

  if (placeSearchService) {
    await app.register(placeSearchRoutes, { placeSearchService });
  }

  const mapStopsService =
    options.mapStopsService ??
    (options.mapStopsClient
      ? createMapStopsService({ mapStopsClient: options.mapStopsClient })
      : undefined);

  if (mapStopsService) {
    await app.register(mapStopsRoutes, { mapStopsService });
  }

  if (options.database) {
    const database = options.database;
    app.addHook('onClose', async () => {
      await database.close();
    });
  }

  return app;
}
