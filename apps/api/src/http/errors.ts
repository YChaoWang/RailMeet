import type { ApiErrorCode } from '@railmeet/shared';
import type { ApiErrorDetail, ApiErrorEnvelope } from '@railmeet/validation';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';

import type { MeetingSearchServiceError } from '../services/meeting-search-service.js';

export type ErrorEnvelopeBody = ApiErrorEnvelope;

function buildErrorEnvelope(options: {
  code: ApiErrorCode;
  message: string;
  requestId: string;
  details?: readonly ApiErrorDetail[];
}): ErrorEnvelopeBody {
  return {
    error: {
      code: options.code,
      message: options.message,
      requestId: options.requestId,
      ...(options.details && options.details.length > 0 ? { details: [...options.details] } : {}),
    },
  };
}

export function sendError(
  reply: FastifyReply,
  request: FastifyRequest,
  statusCode: number,
  options: {
    code: ApiErrorCode;
    message: string;
    details?: readonly ApiErrorDetail[];
  },
): FastifyReply {
  return reply.status(statusCode).send(
    buildErrorEnvelope({
      code: options.code,
      message: options.message,
      requestId: request.id,
      ...(options.details ? { details: options.details } : {}),
    }),
  );
}

export function zodIssuesToDetails(error: ZodError): ApiErrorDetail[] {
  return error.issues.map((issue) => ({
    path: issue.path.length > 0 ? issue.path.join('.') : '(root)',
    message: issue.message,
  }));
}

export function mapServiceErrorToHttp(
  reply: FastifyReply,
  request: FastifyRequest,
  error: MeetingSearchServiceError,
): FastifyReply {
  switch (error.kind) {
    case 'invalid_place':
      return sendError(reply, request, 422, {
        code: 'INVALID_PLACE_REFERENCE',
        message: 'One or more origin places are not valid canonical places',
        details: error.placeIds.map((placeId) => ({
          path: 'participants.origin.placeId',
          message: `Unknown place reference: ${placeId}`,
        })),
      });
    case 'not_found':
      return sendError(reply, request, 404, {
        code: 'NOT_FOUND',
        message: 'Meeting search was not found',
      });
    case 'conflict':
      return sendError(reply, request, 409, {
        code: 'CONFLICT',
        message: error.message,
      });
    case 'unavailable':
      return sendError(reply, request, 503, {
        code: 'SERVICE_UNAVAILABLE',
        message: error.message,
      });
    case 'internal':
      request.log.error({ err: error.cause }, 'Unexpected meeting-search service failure');
      return sendError(reply, request, 500, {
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred',
      });
  }
}

export function isZodError(error: unknown): error is ZodError {
  return error instanceof ZodError;
}
