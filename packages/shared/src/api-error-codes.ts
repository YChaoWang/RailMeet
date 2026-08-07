/**
 * Stable machine-readable API error codes.
 * Safe for clients to branch on; messages remain human-readable separately.
 */
export const API_ERROR_CODES = [
  'VALIDATION_FAILED',
  'INVALID_PLACE_REFERENCE',
  'NOT_FOUND',
  'CONFLICT',
  'RATE_LIMITED',
  'INTERNAL_ERROR',
  'SERVICE_UNAVAILABLE',
] as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

export function isApiErrorCode(value: string): value is ApiErrorCode {
  return (API_ERROR_CODES as readonly string[]).includes(value);
}
