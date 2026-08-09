import {
  PLACE_ID_MAX_LENGTH,
  PLACE_LABEL_MAX_LENGTH,
  PLACE_NAME_MAX_LENGTH,
  PLACE_SEARCH_QUERY_MAX_LENGTH,
  PLACE_SEARCH_QUERY_MIN_LENGTH,
  PLACE_SEARCH_RESULT_LIMIT,
  PROVIDER_PLACE_ID_MAX_LENGTH,
  IANA_TIMEZONE_MAX_LENGTH,
} from '@railmeet/shared';
import { z } from 'zod';

/**
 * Existing RailMeet place reference (canonical `places.id`).
 * Coordinates are not accepted here — they come from the database.
 */
export const placeReferenceSchema = z
  .object({
    placeId: z
      .string()
      .trim()
      .min(1, { message: 'Place ID must not be empty' })
      .max(PLACE_ID_MAX_LENGTH, {
        message: `Place ID must be at most ${PLACE_ID_MAX_LENGTH} characters`,
      }),
    label: z
      .string()
      .trim()
      .min(1, { message: 'Place label must not be empty when provided' })
      .max(PLACE_LABEL_MAX_LENGTH, {
        message: `Place label must be at most ${PLACE_LABEL_MAX_LENGTH} characters`,
      })
      .optional(),
  })
  .strict();

export const placeSuggestionTypeSchema = z.enum(['ADDRESS', 'PLACE', 'STOP']);

/**
 * Structured MOTIS geocode selection submitted on create-search.
 * Must retain provider identity + coordinates — never display text alone.
 */
export const selectedPlaceOriginSchema = z
  .object({
    providerId: z
      .string()
      .trim()
      .min(1, { message: 'Provider place id must not be empty' })
      .max(PROVIDER_PLACE_ID_MAX_LENGTH, {
        message: `Provider place id must be at most ${PROVIDER_PLACE_ID_MAX_LENGTH} characters`,
      }),
    name: z
      .string()
      .trim()
      .min(1, { message: 'Place name must not be empty' })
      .max(PLACE_NAME_MAX_LENGTH, {
        message: `Place name must be at most ${PLACE_NAME_MAX_LENGTH} characters`,
      }),
    type: placeSuggestionTypeSchema,
    latitude: z.number().finite().min(-90).max(90),
    longitude: z.number().finite().min(-180).max(180),
    countryCode: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{2}$/, { message: 'Country code must be a 2-letter ISO code' })
      .nullable(),
    timezone: z
      .string()
      .trim()
      .min(1)
      .max(IANA_TIMEZONE_MAX_LENGTH, {
        message: `Timezone must be at most ${IANA_TIMEZONE_MAX_LENGTH} characters`,
      })
      .nullable(),
    modes: z.array(z.string().trim().min(1).max(64)).max(32),
    secondaryLabel: z.string().trim().max(PLACE_LABEL_MAX_LENGTH).nullable(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (!value.countryCode) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Selected place must include a country code',
        path: ['countryCode'],
      });
    }
  });

export const meetingSearchOriginSchema = z.union([placeReferenceSchema, selectedPlaceOriginSchema]);

export const placeSuggestionSchema = z
  .object({
    providerId: z.string().min(1),
    name: z.string().min(1),
    type: placeSuggestionTypeSchema,
    latitude: z.number(),
    longitude: z.number(),
    countryCode: z.string().nullable(),
    timezone: z.string().nullable(),
    modes: z.array(z.string()),
    secondaryLabel: z.string().nullable(),
  })
  .strict();

export const placeSearchQuerySchema = z.object({
  q: z
    .string()
    .trim()
    .min(PLACE_SEARCH_QUERY_MIN_LENGTH, {
      message: `Query must be at least ${PLACE_SEARCH_QUERY_MIN_LENGTH} characters`,
    })
    .max(PLACE_SEARCH_QUERY_MAX_LENGTH, {
      message: `Query must be at most ${PLACE_SEARCH_QUERY_MAX_LENGTH} characters`,
    }),
});

export const placeSearchDataSchema = z.object({
  query: z.string().min(1),
  suggestions: z.array(placeSuggestionSchema).max(PLACE_SEARCH_RESULT_LIMIT),
});

export type PlaceReferenceInput = z.output<typeof placeReferenceSchema>;
export type SelectedPlaceOrigin = z.output<typeof selectedPlaceOriginSchema>;
export type MeetingSearchOrigin = z.output<typeof meetingSearchOriginSchema>;
export type PlaceSuggestionView = z.output<typeof placeSuggestionSchema>;
export type PlaceSearchData = z.output<typeof placeSearchDataSchema>;

export function isSelectedPlaceOrigin(origin: MeetingSearchOrigin): origin is SelectedPlaceOrigin {
  return 'providerId' in origin;
}
