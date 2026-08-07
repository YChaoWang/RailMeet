import { PLACE_ID_MAX_LENGTH, PLACE_LABEL_MAX_LENGTH } from '@railmeet/shared';
import { z } from 'zod';

/**
 * Boundary place reference accepted on create-search requests.
 * Coordinates are intentionally omitted — canonical geometry comes from the location source.
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
