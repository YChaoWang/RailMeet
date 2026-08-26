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

const stopLatitudeSchema = z.number().finite().min(-90).max(90);
const stopLongitudeSchema = z.number().finite().min(-180).max(180);

export const meetingSearchJourneyLegStopSchema = z.object({
  name: z.string().min(1),
  track: z.string().min(1).optional(),
  latitude: stopLatitudeSchema.optional(),
  longitude: stopLongitudeSchema.optional(),
});

/** MOTIS intermediate stop projection used for map stop markers. */
export const meetingSearchJourneyIntermediateStopSchema = z.object({
  name: z.string().min(1),
  latitude: stopLatitudeSchema.optional(),
  longitude: stopLongitudeSchema.optional(),
  arrivalAt: z.string().min(1).optional(),
  departureAt: z.string().min(1).optional(),
  scheduledArrivalAt: z.string().min(1).optional(),
  scheduledDepartureAt: z.string().min(1).optional(),
  track: z.string().min(1).optional(),
});

export const meetingSearchJourneyLegViewSchema = z.object({
  mode: z.string().min(1),
  departureAt: z.string().datetime({ offset: true }),
  arrivalAt: z.string().datetime({ offset: true }),
  durationMinutes: z.number().int().nonnegative(),
  geometry: meetingSearchJourneyLegGeometrySchema.nullable(),
  motisMode: z.string().min(1).optional(),
  displayName: z.string().min(1).optional(),
  routeShortName: z.string().min(1).optional(),
  routeLongName: z.string().min(1).optional(),
  tripShortName: z.string().min(1).optional(),
  headsign: z.string().min(1).optional(),
  agencyName: z.string().min(1).optional(),
  agencyId: z.string().min(1).optional(),
  agencyUrl: z.string().url().optional(),
  routeColor: z.string().min(1).optional(),
  routeTextColor: z.string().min(1).optional(),
  from: meetingSearchJourneyLegStopSchema.optional(),
  to: meetingSearchJourneyLegStopSchema.optional(),
  intermediateStopCount: z.number().int().nonnegative().optional(),
  intermediateStops: z.array(meetingSearchJourneyIntermediateStopSchema).optional(),
  distanceMeters: z.number().nonnegative().optional(),
});

const motisLegPassthroughSchema = z
  .object({
    mode: z.string().min(1),
    startTime: z.string().min(1),
    endTime: z.string().min(1),
    duration: z.number(),
  })
  .passthrough();

/** Provider-native MOTIS itinerary. Extra itinerary/leg fields are retained. */
export const motisItineraryViewSchema = z
  .object({
    duration: z.number(),
    startTime: z.string().min(1),
    endTime: z.string().min(1),
    transfers: z.number().int().nonnegative(),
    id: z.string().min(1).optional(),
    legs: z.array(motisLegPassthroughSchema).min(1),
  })
  .passthrough();

export const meetingSearchProviderItinerarySchema = z.object({
  format: z.literal('motis-plan-itinerary-v1'),
  motisPlanApiVersion: z.literal('v5'),
  motisOpenApiPin: z.string().min(1),
  itinerary: motisItineraryViewSchema,
});

/** Strict #RRGGBB / #RGB for compact route chips. */
const routeSummaryHexColorSchema = z
  .string()
  .regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, 'Route color must be #RGB or #RRGGBB');

/** Soft caps align with @railmeet/shared route-summary builders. */
export const meetingSearchRouteSummarySegmentSchema = z
  .object({
    mode: z.string().min(1).max(64),
    displayName: z.string().min(1).max(64).optional(),
    routeColor: routeSummaryHexColorSchema.optional(),
    routeTextColor: routeSummaryHexColorSchema.optional(),
  })
  .strict();

/**
 * Compact selected journey on GET …/results.
 * Ranking legs (map geometry) + routeSummary chips; never embeds providerItinerary.
 */
export const meetingSearchSelectedJourneyViewSchema = z.object({
  journeyId: z.string().uuid(),
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
  routeSummary: z.array(meetingSearchRouteSummarySegmentSchema).max(24),
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

/** Path params for GET …/journeys/:journeyId */
export const meetingSearchJourneyIdParamsSchema = z
  .object({
    searchId: z.string().uuid({ message: 'Search ID must be a valid UUID' }),
    journeyId: z.string().uuid({ message: 'Journey ID must be a valid UUID' }),
  })
  .strict();

export type MeetingSearchJourneyIdParams = z.output<typeof meetingSearchJourneyIdParamsSchema>;

/**
 * Discriminated journey detail — Web must branch on detailSource, not missing providerItinerary.
 */
export const meetingSearchJourneyDetailDataSchema = z.object({
  journeyId: z.string().uuid(),
  detailSource: z.enum(['provider', 'legacy']),
  itineraryId: z.string().min(1).nullable(),
  providerItinerary: meetingSearchProviderItinerarySchema.nullable(),
  legs: z.array(meetingSearchJourneyLegViewSchema),
  providerItineraryUnavailableReason: z.string().min(1).nullable(),
});

export type MeetingSearchJourneyDetailData = z.output<typeof meetingSearchJourneyDetailDataSchema>;

export const meetingSearchJourneyDetailEnvelopeSchema = z.object({
  data: meetingSearchJourneyDetailDataSchema,
  meta: z.object({
    requestId: z.string().min(1),
  }),
});

export type MeetingSearchJourneyDetailEnvelope = z.output<
  typeof meetingSearchJourneyDetailEnvelopeSchema
>;

// Re-export builder for callers that compose envelopes in tests.
export { successEnvelopeSchema };
