import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  createMeetingSearchRequestSchema,
  meetingSearchAcceptedEnvelopeSchema,
  meetingSearchDetailEnvelopeSchema,
  meetingSearchIdParamsSchema,
} from '@railmeet/validation';

import { mapServiceErrorToHttp } from '../http/errors.js';
import type { MeetingSearchService } from '../services/meeting-search-service.js';

export type MeetingSearchRoutesOptions = {
  readonly meetingSearchService: MeetingSearchService;
};

export const meetingSearchRoutes: FastifyPluginAsyncZod<MeetingSearchRoutesOptions> = async (
  app,
  options,
) => {
  const { meetingSearchService } = options;

  app.post(
    '/api/v1/meeting-searches',
    {
      schema: {
        body: createMeetingSearchRequestSchema,
        response: {
          202: meetingSearchAcceptedEnvelopeSchema,
        },
      },
    },
    async (request, reply) => {
      const result = await meetingSearchService.createAcceptedSearch(request.body);

      if (!result.ok) {
        return mapServiceErrorToHttp(reply, request, result.error);
      }

      const location = `/api/v1/meeting-searches/${result.value.searchId}`;
      return reply
        .status(202)
        .header('Location', location)
        .send({
          data: result.value,
          meta: { requestId: request.id },
        });
    },
  );

  app.get(
    '/api/v1/meeting-searches/:searchId',
    {
      schema: {
        params: meetingSearchIdParamsSchema,
        response: {
          200: meetingSearchDetailEnvelopeSchema,
        },
      },
    },
    async (request, reply) => {
      const result = await meetingSearchService.getSearchById(request.params.searchId);

      if (!result.ok) {
        return mapServiceErrorToHttp(reply, request, result.error);
      }

      return reply.status(200).send({
        data: result.value,
        meta: { requestId: request.id },
      });
    },
  );
};
