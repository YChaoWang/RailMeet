import {
  RANKING_MODES,
  SEARCH_STATUSES,
  TRANSPORT_MODES,
  asNonEmptyStringTuple,
} from '@railmeet/shared';
import { z } from 'zod';

import { successEnvelopeSchema } from './envelopes.js';
import { calendarDateSchema, isoCountryCodeSchema, localTimeSchema } from './primitives.js';

const rankingModeSchema = z.enum(asNonEmptyStringTuple(RANKING_MODES));
const transportModeSchema = z.enum(asNonEmptyStringTuple(TRANSPORT_MODES));
const searchStatusSchema = z.enum(asNonEmptyStringTuple(SEARCH_STATUSES));

/** Path params for GET /api/v1/meeting-searches/:searchId */
export const meetingSearchIdParamsSchema = z
  .object({
    searchId: z.string().uuid({ message: 'Search ID must be a valid UUID' }),
  })
  .strict();

export type MeetingSearchIdParams = z.output<typeof meetingSearchIdParamsSchema>;

/**
 * POST 202 Accepted payload.
 * Status is always `queued` after durable outbox commit in Phase 4.
 *
 * Response objects intentionally use Zod's default strip mode (not `.strict()`)
 * so Fastify serialization removes unexpected properties instead of failing closed
 * with a 500 when an internal mapper accidentally adds a field.
 */
export const meetingSearchAcceptedDataSchema = z.object({
  searchId: z.string().uuid(),
  status: z.literal('queued'),
  createdAt: z.string().datetime({ offset: true }),
});

export type MeetingSearchAcceptedData = z.output<typeof meetingSearchAcceptedDataSchema>;

export const meetingSearchAcceptedEnvelopeSchema = z.object({
  data: meetingSearchAcceptedDataSchema,
  meta: z.object({
    requestId: z.string().min(1),
  }),
});

export type MeetingSearchAcceptedEnvelope = z.output<typeof meetingSearchAcceptedEnvelopeSchema>;

/** Participant projection for GET — no internal row UUIDs. */
export const meetingSearchParticipantViewSchema = z.object({
  id: z.string().min(1),
  displayName: z.string().min(1),
  origin: z.object({
    placeId: z.string().min(1),
  }),
});

/**
 * GET meeting-search resource projection.
 * Deliberate API shape — not a Drizzle row or outbox record.
 */
export const meetingSearchDetailDataSchema = z.object({
  searchId: z.string().uuid(),
  status: searchStatusSchema,
  travelDate: calendarDateSchema,
  earliestDepartureTime: localTimeSchema,
  latestArrivalTime: localTimeSchema,
  arrivalDayOffset: z.union([z.literal(0), z.literal(1)]),
  maxJourneyDurationMinutes: z.number().int().positive(),
  maxTransfers: z.number().int().nonnegative(),
  minTransferDurationMinutes: z.number().int().positive(),
  rankingMode: rankingModeSchema,
  participants: z.array(meetingSearchParticipantViewSchema).min(1),
  allowedTransportModes: z.array(transportModeSchema).min(1),
  allowedCountryCodes: z.array(isoCountryCodeSchema),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});

export type MeetingSearchDetailData = z.output<typeof meetingSearchDetailDataSchema>;

export const meetingSearchDetailEnvelopeSchema = z.object({
  data: meetingSearchDetailDataSchema,
  meta: z.object({
    requestId: z.string().min(1),
  }),
});

export type MeetingSearchDetailEnvelope = z.output<typeof meetingSearchDetailEnvelopeSchema>;

// Re-export builder for callers that compose envelopes in tests.
export { successEnvelopeSchema };
