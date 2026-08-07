export type PlaceNotFoundError = {
  readonly code: 'PLACE_NOT_FOUND';
  readonly placeIds: readonly string[];
  readonly message: string;
};

export type SearchNotFoundError = {
  readonly code: 'SEARCH_NOT_FOUND';
  readonly searchId: string;
  readonly message: string;
};

export type StatusConflictError = {
  readonly code: 'STATUS_CONFLICT';
  readonly searchId: string;
  readonly currentStatus: string;
  readonly message: string;
};

export type PersistenceError = PlaceNotFoundError | SearchNotFoundError | StatusConflictError;

export function placeNotFound(placeIds: readonly string[]): PlaceNotFoundError {
  return {
    code: 'PLACE_NOT_FOUND',
    placeIds,
    message: 'One or more origin places were not found',
  };
}

export function searchNotFound(searchId: string): SearchNotFoundError {
  return {
    code: 'SEARCH_NOT_FOUND',
    searchId,
    message: 'Meeting search was not found',
  };
}

export function statusConflict(searchId: string, currentStatus: string): StatusConflictError {
  return {
    code: 'STATUS_CONFLICT',
    searchId,
    currentStatus,
    message: 'Meeting search status did not match the expected precondition',
  };
}

/**
 * Safe classification of postgres.js / PostgreSQL driver failures.
 * Callers map these to HTTP envelopes — never expose raw driver text to clients.
 */

function readErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') {
    return undefined;
  }
  if ('code' in error && typeof (error as { code: unknown }).code === 'string') {
    return (error as { code: string }).code;
  }
  return undefined;
}

/** PostgreSQL unique_violation */
export function isUniqueViolationError(error: unknown): boolean {
  return readErrorCode(error) === '23505';
}

const UNAVAILABLE_CODES = new Set([
  'ECONNREFUSED',
  'ENOTFOUND',
  'ETIMEDOUT',
  'ECONNRESET',
  'EPIPE',
  '08000',
  '08001',
  '08003',
  '08004',
  '08006',
  '08007',
  '57P01',
  '57P02',
  '57P03',
  '53300',
]);

export function isDatabaseUnavailableError(error: unknown): boolean {
  const code = readErrorCode(error);
  return code !== undefined && UNAVAILABLE_CODES.has(code);
}
