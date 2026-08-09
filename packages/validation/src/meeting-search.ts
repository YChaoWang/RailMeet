import {
  ALLOWED_COUNTRY_CODES_MAX,
  ALLOWED_TRANSPORT_MODES_MAX,
  ARRIVAL_DAY_OFFSET_MAX,
  ARRIVAL_DAY_OFFSET_MIN,
  MAX_JOURNEY_DURATION_MINUTES_UPPER_BOUND,
  MAX_TRANSFERS_UPPER_BOUND,
  MIN_TRANSFER_DURATION_MINUTES_UPPER_BOUND,
  PARTICIPANT_COUNT_MAX,
  PARTICIPANT_COUNT_MIN,
  PARTICIPANT_ID_MAX_LENGTH,
  PARTICIPANT_NAME_MAX_LENGTH,
} from '@railmeet/shared';
import { z } from 'zod';

import { meetingSearchOriginSchema } from './place.js';
import {
  calendarDateSchema,
  hasUniqueValues,
  isoCountryCodeSchema,
  localTimeSchema,
  rankingModeSchema,
  transportModeSchema,
} from './primitives.js';

export const participantInputSchema = z
  .object({
    id: z
      .string()
      .trim()
      .min(1, { message: 'Participant ID must not be empty' })
      .max(PARTICIPANT_ID_MAX_LENGTH, {
        message: `Participant ID must be at most ${PARTICIPANT_ID_MAX_LENGTH} characters`,
      }),
    displayName: z
      .string()
      .trim()
      .min(1, { message: 'Participant display name must not be empty' })
      .max(PARTICIPANT_NAME_MAX_LENGTH, {
        message: `Participant display name must be at most ${PARTICIPANT_NAME_MAX_LENGTH} characters`,
      }),
    origin: meetingSearchOriginSchema,
  })
  .strict();

/**
 * Zod schema for creating a meeting search (HTTP / application boundary).
 * Inferred type is the validated DTO — not the internal domain `SearchRequest`.
 */
export const createMeetingSearchRequestSchema = z
  .object({
    participants: z
      .array(participantInputSchema)
      .min(PARTICIPANT_COUNT_MIN, {
        message: `At least ${PARTICIPANT_COUNT_MIN} participants are required`,
      })
      .max(PARTICIPANT_COUNT_MAX, {
        message: `At most ${PARTICIPANT_COUNT_MAX} participants are allowed`,
      })
      .superRefine((participants, ctx) => {
        const seen = new Set<string>();
        for (const [index, participant] of participants.entries()) {
          if (seen.has(participant.id)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: 'Participant IDs must be unique within a search request',
              path: [index, 'id'],
            });
          }
          seen.add(participant.id);
        }
      }),
    travelDate: calendarDateSchema,
    earliestDepartureTime: localTimeSchema,
    latestArrivalTime: localTimeSchema,
    arrivalDayOffset: z
      .union([z.literal(ARRIVAL_DAY_OFFSET_MIN), z.literal(ARRIVAL_DAY_OFFSET_MAX)], {
        errorMap: () => ({
          message: `Arrival day offset must be ${ARRIVAL_DAY_OFFSET_MIN} or ${ARRIVAL_DAY_OFFSET_MAX}`,
        }),
      })
      .default(ARRIVAL_DAY_OFFSET_MIN),
    maxJourneyDurationMinutes: z
      .number({
        invalid_type_error: 'Maximum journey duration must be a number',
      })
      .int({ message: 'Maximum journey duration must be an integer' })
      .positive({ message: 'Maximum journey duration must be a positive integer' })
      .max(MAX_JOURNEY_DURATION_MINUTES_UPPER_BOUND, {
        message: `Maximum journey duration must be at most ${MAX_JOURNEY_DURATION_MINUTES_UPPER_BOUND} minutes`,
      }),
    maxTransfers: z
      .number({
        invalid_type_error: 'Maximum transfers must be a number',
      })
      .int({ message: 'Maximum transfers must be an integer' })
      .nonnegative({ message: 'Maximum transfers must be a non-negative integer' })
      .max(MAX_TRANSFERS_UPPER_BOUND, {
        message: `Maximum transfers must be at most ${MAX_TRANSFERS_UPPER_BOUND}`,
      }),
    minTransferDurationMinutes: z
      .number({
        invalid_type_error: 'Minimum transfer duration must be a number',
      })
      .int({ message: 'Minimum transfer duration must be an integer' })
      .positive({ message: 'Minimum transfer duration must be a positive integer' })
      .max(MIN_TRANSFER_DURATION_MINUTES_UPPER_BOUND, {
        message: `Minimum transfer duration must be at most ${MIN_TRANSFER_DURATION_MINUTES_UPPER_BOUND} minutes`,
      }),
    allowedTransportModes: z
      .array(transportModeSchema)
      .min(1, { message: 'At least one transport mode is required' })
      .max(ALLOWED_TRANSPORT_MODES_MAX, {
        message: `At most ${ALLOWED_TRANSPORT_MODES_MAX} transport modes are allowed`,
      })
      .superRefine((modes, ctx) => {
        if (!hasUniqueValues(modes)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Transport modes must not contain duplicates',
          });
        }
      }),
    allowedCountryCodes: z
      .array(isoCountryCodeSchema)
      .min(1, { message: 'Country filter must not be empty when provided' })
      .max(ALLOWED_COUNTRY_CODES_MAX, {
        message: `At most ${ALLOWED_COUNTRY_CODES_MAX} country codes are allowed`,
      })
      .superRefine((codes, ctx) => {
        if (!hasUniqueValues(codes)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Country codes must not contain duplicates',
          });
        }
      })
      .optional(),
    rankingMode: rankingModeSchema,
  })
  .strict();

/** Validated create-meeting-search DTO inferred from the Zod schema. */
export type CreateMeetingSearchRequest = z.output<typeof createMeetingSearchRequestSchema>;

export type ParticipantInput = z.output<typeof participantInputSchema>;
