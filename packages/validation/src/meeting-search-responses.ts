import {
  RANKING_MODES,
  SEARCH_COMPLETION_OUTCOMES,
  SEARCH_FAILURE_CODES,
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
const completionOutcomeSchema = z.enum(asNonEmptyStringTuple(SEARCH_COMPLETION_OUTCOMES));
const searchFailureCodeSchema = z.enum(asNonEmptyStringTuple(SEARCH_FAILURE_CODES));

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

/**
 * Place identity with optional persisted label and coordinates from `places.location`.
 * Coordinates are never geocoded by the client.
 */
export const meetingSearchPlaceViewSchema = z.object({
  placeId: z.string().min(1),
  name: z.string().min(1).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  latitude: z.number().min(-90).max(90).optional(),
});

/** Participant projection for GET — no internal row UUIDs. */
export const meetingSearchParticipantViewSchema = z.object({
  id: z.string().min(1),
  displayName: z.string().min(1),
  origin: meetingSearchPlaceViewSchema,
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
  startedAt: z.string().datetime({ offset: true }).nullable(),
  completedAt: z.string().datetime({ offset: true }).nullable(),
  failedAt: z.string().datetime({ offset: true }).nullable(),
  completionOutcome: completionOutcomeSchema.nullable(),
  failureCode: searchFailureCodeSchema.nullable(),
  recommendedDestination: meetingSearchPlaceViewSchema.nullable(),
});

export type MeetingSearchDetailData = z.output<typeof meetingSearchDetailDataSchema>;

export const meetingSearchDetailEnvelopeSchema = z.object({
  data: meetingSearchDetailDataSchema,
  meta: z.object({
    requestId: z.string().min(1),
  }),
});

export type MeetingSearchDetailEnvelope = z.output<typeof meetingSearchDetailEnvelopeSchema>;

export const meetingSearchJourneyLegGeometrySchema = z
  .object({
    points: z.string().min(1),
    precision: z.number().int().positive(),
    length: z.number().int().nonnegative(),
  })
  .strict();

export const meetingSearchJourneyLegViewSchema = z.object({
  mode: z.string().min(1),
  departureAt: z.string().datetime({ offset: true }),
  arrivalAt: z.string().datetime({ offset: true }),
  durationMinutes: z.number().int().nonnegative(),
  geometry: meetingSearchJourneyLegGeometrySchema.nullable(),
});

export const meetingSearchSelectedJourneyViewSchema = z.object({
  participantId: z.string().min(1),
  participantDisplayName: z.string().min(1),
  participantPosition: z.number().int().nonnegative(),
  origin: meetingSearchPlaceViewSchema,
  destination: meetingSearchPlaceViewSchema,
  departureAt: z.string().datetime({ offset: true }),
  arrivalAt: z.string().datetime({ offset: true }),
  durationMinutes: z.number().int().nonnegative(),
  transfers: z.number().int().nonnegative(),
  transportModes: z.array(z.string().min(1)),
  legs: z.array(meetingSearchJourneyLegViewSchema),
});

export const meetingSearchRankedCandidateViewSchema = z.object({
  rankingMode: rankingModeSchema,
  rank: z.number().int().positive(),
  destination: meetingSearchPlaceViewSchema,
  recommended: z.boolean(),
  totalDurationMinutes: z.number().int().nonnegative(),
  maxDurationMinutes: z.number().int().nonnegative(),
  durationRangeMinutes: z.number().int().nonnegative(),
  totalTransfers: z.number().int().nonnegative(),
  maxTransfers: z.number().int().nonnegative(),
  earliestArrivalAt: z.string().datetime({ offset: true }),
  latestArrivalAt: z.string().datetime({ offset: true }),
  arrivalSpreadMs: z.number().int().nonnegative(),
  journeys: z.array(meetingSearchSelectedJourneyViewSchema),
});

/**
 * GET /meeting-searches/:searchId/results payload.
 * Empty `rankings` when completed with no feasible candidates / no candidates.
 */
export const meetingSearchResultsDataSchema = z.object({
  searchId: z.string().uuid(),
  status: z.literal('completed'),
  completionOutcome: completionOutcomeSchema,
  rankingMode: rankingModeSchema,
  recommendedDestination: meetingSearchPlaceViewSchema.nullable(),
  rankings: z.array(meetingSearchRankedCandidateViewSchema),
});

export type MeetingSearchResultsData = z.output<typeof meetingSearchResultsDataSchema>;

export const meetingSearchResultsEnvelopeSchema = z.object({
  data: meetingSearchResultsDataSchema,
  meta: z.object({
    requestId: z.string().min(1),
  }),
});

export type MeetingSearchResultsEnvelope = z.output<typeof meetingSearchResultsEnvelopeSchema>;

// Re-export builder for callers that compose envelopes in tests.
export { successEnvelopeSchema };
