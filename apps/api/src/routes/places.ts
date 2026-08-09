import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  placeSearchDataSchema,
  placeSearchQuerySchema,
  successEnvelopeSchema,
} from '@railmeet/validation';

import { sendError } from '../http/errors.js';
import type { PlaceSearchService } from '../services/place-search-service.js';

export type PlaceSearchRoutesOptions = {
  readonly placeSearchService: PlaceSearchService;
};

const placeSearchEnvelopeSchema = successEnvelopeSchema(placeSearchDataSchema);

export const placeSearchRoutes: FastifyPluginAsyncZod<PlaceSearchRoutesOptions> = async (
  app,
  options,
) => {
  const { placeSearchService } = options;

  app.get(
    '/api/v1/places/search',
    {
      schema: {
        querystring: placeSearchQuerySchema,
        response: {
          200: placeSearchEnvelopeSchema,
        },
      },
    },
    async (request, reply) => {
      const abort = new AbortController();
      const onClose = () => abort.abort();
      request.raw.on('close', onClose);

      try {
        const result = await placeSearchService.searchPlaces({
          query: request.query.q,
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
          request.log.error({ err: result.error.cause }, 'Place search failed');
          return sendError(reply, request, 500, {
            code: 'INTERNAL_ERROR',
            message: 'An unexpected error occurred',
          });
        }

        return reply.status(200).send({
          data: {
            query: result.value.query,
            suggestions: result.value.suggestions.map((suggestion) => ({
              providerId: suggestion.providerId,
              name: suggestion.name,
              type: suggestion.type,
              latitude: suggestion.latitude,
              longitude: suggestion.longitude,
              countryCode: suggestion.countryCode,
              timezone: suggestion.timezone,
              modes: [...suggestion.modes],
              secondaryLabel: suggestion.secondaryLabel,
            })),
          },
          meta: { requestId: request.id },
        });
      } finally {
        request.raw.off('close', onClose);
      }
    },
  );
};
