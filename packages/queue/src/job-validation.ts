import {
  MEETING_SEARCH_REQUESTED_JOB_NAME,
  MEETING_SEARCH_REQUESTED_JOB_SCHEMA_VERSION,
  type MeetingSearchRequestedJobData,
} from './contract.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type JobValidationFailureCode =
  'WRONG_JOB_NAME' | 'UNSUPPORTED_SCHEMA_VERSION' | 'INVALID_JOB_PAYLOAD' | 'INVALID_SEARCH_ID';

export type JobValidationResult =
  | { readonly ok: true; readonly data: MeetingSearchRequestedJobData }
  | { readonly ok: false; readonly code: JobValidationFailureCode; readonly message: string };

/**
 * Runtime validation of consumer job name + payload.
 * Producer validation is not trusted.
 */
export function validateMeetingSearchRequestedJob(input: {
  readonly name: string;
  readonly data: unknown;
}): JobValidationResult {
  if (input.name !== MEETING_SEARCH_REQUESTED_JOB_NAME) {
    return {
      ok: false,
      code: 'WRONG_JOB_NAME',
      message: `Unexpected job name: ${input.name}`,
    };
  }
  if (!input.data || typeof input.data !== 'object') {
    return {
      ok: false,
      code: 'INVALID_JOB_PAYLOAD',
      message: 'Job data must be an object',
    };
  }
  const data = input.data as Record<string, unknown>;
  if (data.schemaVersion !== MEETING_SEARCH_REQUESTED_JOB_SCHEMA_VERSION) {
    return {
      ok: false,
      code: 'UNSUPPORTED_SCHEMA_VERSION',
      message: `Unsupported schemaVersion: ${String(data.schemaVersion)}`,
    };
  }
  if (typeof data.searchId !== 'string' || data.searchId.length === 0) {
    return {
      ok: false,
      code: 'INVALID_JOB_PAYLOAD',
      message: 'Job data.searchId must be a non-empty string',
    };
  }
  if (!UUID_RE.test(data.searchId)) {
    return {
      ok: false,
      code: 'INVALID_SEARCH_ID',
      message: 'Job data.searchId must be a UUID',
    };
  }
  const keys = Object.keys(data);
  if (keys.some((key) => key !== 'schemaVersion' && key !== 'searchId')) {
    return {
      ok: false,
      code: 'INVALID_JOB_PAYLOAD',
      message: 'Job data contains unexpected properties',
    };
  }
  return {
    ok: true,
    data: {
      schemaVersion: MEETING_SEARCH_REQUESTED_JOB_SCHEMA_VERSION,
      searchId: data.searchId,
    },
  };
}
