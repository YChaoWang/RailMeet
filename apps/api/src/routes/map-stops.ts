import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  mapStopsQuerySchema,
  stationFeatureCollectionSchema,
  successEnvelopeSchema,
} from '@railmeet/validation';

import { sendError } from '../http/errors.js';
import type { MapStopsService } from '../services/map-stops-service.js';

export type MapStopsRoutesOptions = {
  readonly mapStopsService: MapStopsService;
};

const mapStopsEnvelopeSchema = successEnvelopeSchema(stationFeatureCollectionSchema);

export const mapStopsRoutes: FastifyPluginAsyncZod<MapStopsRoutesOptions> = async (
  app,
  options,
) => {
  const { mapStopsService } = options;

  app.get(
    '/api/v1/map/stops',
    {
      schema: {
        querystring: mapStopsQuerySchema,
        response: {
          200: mapStopsEnvelopeSchema,
        },
      },
    },
    async (request, reply) => {
      const abort = new AbortController();
      const onClose = () => abort.abort();
      request.raw.on('close', onClose);

      try {
        const result = await mapStopsService.getMapStops({
          minLon: request.query.minLon,
          minLat: request.query.minLat,
          maxLon: request.query.maxLon,
          maxLat: request.query.maxLat,
          zoom: request.query.zoom,
          signal: abort.signal,
        });

        if (!result.ok) {
          if (result.error.kind === 'validation') {
            return sendError(reply, request, 400, {
              code: 'VALIDATION_FAILED',
              message: result.error.message,
            });
          }
          if (result.error.kind === 'unavailable') {
            return sendError(reply, request, 503, {
              code: 'SERVICE_UNAVAILABLE',
              message: result.error.message,
            });
          }
          request.log.error({ err: result.error.cause }, 'Map stops lookup failed');
          return sendError(reply, request, 500, {
            code: 'INTERNAL_ERROR',
            message: 'An unexpected error occurred',
          });
        }

        return reply.status(200).send({
          data: {
            type: 'FeatureCollection',
            features: result.value.features.map((feature) => ({
              type: 'Feature' as const,
              geometry: {
                type: 'Point' as const,
                coordinates: [feature.geometry.coordinates[0], feature.geometry.coordinates[1]] as [
                  number,
                  number,
                ],
              },
              properties: {
                stopId: feature.properties.stopId,
                name: feature.properties.name,
                kind: feature.properties.kind,
                importance: feature.properties.importance,
                modes: [...feature.properties.modes],
                parentId: feature.properties.parentId,
              },
            })),
            metadata: {
              truncated: result.value.metadata.truncated,
              aggregated: result.value.metadata.aggregated,
              minimumDetailZoom: result.value.metadata.minimumDetailZoom,
              sourceFeatureCount: result.value.metadata.sourceFeatureCount,
            },
          },
          meta: { requestId: request.id },
        });
      } finally {
        request.raw.off('close', onClose);
      }
    },
  );
};
