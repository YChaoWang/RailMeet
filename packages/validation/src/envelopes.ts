import { API_ERROR_CODES, asNonEmptyStringTuple } from '@railmeet/shared';
import { z } from 'zod';

const apiErrorCodeSchema = z.enum(asNonEmptyStringTuple(API_ERROR_CODES));

export const apiErrorDetailSchema = z
  .object({
    path: z.string().min(1),
    message: z.string().min(1),
  })
  .strict();

/**
 * Stable API error envelope.
 * Must not include stack traces, provider payloads, secrets, or SQL errors.
 */
export const apiErrorEnvelopeSchema = z
  .object({
    error: z
      .object({
        code: apiErrorCodeSchema,
        message: z.string().min(1),
        details: z.array(apiErrorDetailSchema).optional(),
        requestId: z.string().min(1).optional(),
      })
      .strict(),
  })
  .strict();

export type ApiErrorEnvelope = z.output<typeof apiErrorEnvelopeSchema>;
export type ApiErrorDetail = z.output<typeof apiErrorDetailSchema>;

/**
 * Builds a success envelope schema for a given payload schema.
 * Optional `meta.requestId` avoids forcing every endpoint to redefine metadata.
 */
export function successEnvelopeSchema<T extends z.ZodTypeAny>(dataSchema: T) {
  return z
    .object({
      data: dataSchema,
      meta: z
        .object({
          requestId: z.string().min(1).optional(),
        })
        .strict()
        .optional(),
    })
    .strict();
}

export type SuccessEnvelope<T> = {
  readonly data: T;
  readonly meta?: {
    readonly requestId?: string;
  };
};
