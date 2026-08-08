import {
  MEETING_SEARCH_CANDIDATES_REQUESTED_JOB_NAME,
  MEETING_SEARCH_CANDIDATES_REQUESTED_JOB_SCHEMA_VERSION,
  MEETING_SEARCH_FINALIZATION_REQUESTED_JOB_NAME,
  MEETING_SEARCH_FINALIZATION_REQUESTED_JOB_SCHEMA_VERSION,
  MEETING_SEARCH_REQUESTED_JOB_NAME,
  MEETING_SEARCH_REQUESTED_JOB_SCHEMA_VERSION,
  ROUTING_REQUESTED_JOB_NAME,
  ROUTING_REQUESTED_JOB_SCHEMA_VERSION,
  type MeetingSearchCandidatesRequestedJobData,
  type MeetingSearchFinalizationRequestedJobData,
  type MeetingSearchRequestedJobData,
  type RoutingRequestedJobData,
} from './contract.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type JobValidationFailureCode =
  'WRONG_JOB_NAME' | 'UNSUPPORTED_SCHEMA_VERSION' | 'INVALID_JOB_PAYLOAD' | 'INVALID_SEARCH_ID';

export type JobValidationResult<T> =
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly code: JobValidationFailureCode; readonly message: string };

function asObject(data: unknown): Record<string, unknown> | null {
  if (!data || typeof data !== 'object') {
    return null;
  }
  return data as Record<string, unknown>;
}

/**
 * Runtime validation of kickoff consumer job name + payload.
 */
export function validateMeetingSearchRequestedJob(input: {
  readonly name: string;
  readonly data: unknown;
}): JobValidationResult<MeetingSearchRequestedJobData> {
  if (input.name !== MEETING_SEARCH_REQUESTED_JOB_NAME) {
    return {
      ok: false,
      code: 'WRONG_JOB_NAME',
      message: `Unexpected job name: ${input.name}`,
    };
  }
  const data = asObject(input.data);
  if (!data) {
    return { ok: false, code: 'INVALID_JOB_PAYLOAD', message: 'Job data must be an object' };
  }
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
  if (Object.keys(data).some((key) => key !== 'schemaVersion' && key !== 'searchId')) {
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

export function validateCandidatesRequestedJob(input: {
  readonly name: string;
  readonly data: unknown;
}): JobValidationResult<MeetingSearchCandidatesRequestedJobData> {
  if (input.name !== MEETING_SEARCH_CANDIDATES_REQUESTED_JOB_NAME) {
    return {
      ok: false,
      code: 'WRONG_JOB_NAME',
      message: `Unexpected job name: ${input.name}`,
    };
  }
  const data = asObject(input.data);
  if (!data) {
    return { ok: false, code: 'INVALID_JOB_PAYLOAD', message: 'Job data must be an object' };
  }
  if (data.schemaVersion !== MEETING_SEARCH_CANDIDATES_REQUESTED_JOB_SCHEMA_VERSION) {
    return {
      ok: false,
      code: 'UNSUPPORTED_SCHEMA_VERSION',
      message: `Unsupported schemaVersion: ${String(data.schemaVersion)}`,
    };
  }
  if (typeof data.searchId !== 'string' || !UUID_RE.test(data.searchId)) {
    return {
      ok: false,
      code: 'INVALID_SEARCH_ID',
      message: 'Job data.searchId must be a UUID',
    };
  }
  if (Object.keys(data).some((key) => key !== 'schemaVersion' && key !== 'searchId')) {
    return {
      ok: false,
      code: 'INVALID_JOB_PAYLOAD',
      message: 'Job data contains unexpected properties',
    };
  }
  return {
    ok: true,
    data: {
      schemaVersion: MEETING_SEARCH_CANDIDATES_REQUESTED_JOB_SCHEMA_VERSION,
      searchId: data.searchId,
    },
  };
}

export function validateRoutingRequestedJob(input: {
  readonly name: string;
  readonly data: unknown;
}): JobValidationResult<RoutingRequestedJobData> {
  if (input.name !== ROUTING_REQUESTED_JOB_NAME) {
    return {
      ok: false,
      code: 'WRONG_JOB_NAME',
      message: `Unexpected job name: ${input.name}`,
    };
  }
  const data = asObject(input.data);
  if (!data) {
    return { ok: false, code: 'INVALID_JOB_PAYLOAD', message: 'Job data must be an object' };
  }
  if (data.schemaVersion !== ROUTING_REQUESTED_JOB_SCHEMA_VERSION) {
    return {
      ok: false,
      code: 'UNSUPPORTED_SCHEMA_VERSION',
      message: `Unsupported schemaVersion: ${String(data.schemaVersion)}`,
    };
  }
  if (typeof data.searchId !== 'string' || !UUID_RE.test(data.searchId)) {
    return {
      ok: false,
      code: 'INVALID_SEARCH_ID',
      message: 'Job data.searchId must be a UUID',
    };
  }
  if (typeof data.routingWorkId !== 'string' || !UUID_RE.test(data.routingWorkId)) {
    return {
      ok: false,
      code: 'INVALID_JOB_PAYLOAD',
      message: 'Job data.routingWorkId must be a UUID',
    };
  }
  if (
    Object.keys(data).some(
      (key) => key !== 'schemaVersion' && key !== 'searchId' && key !== 'routingWorkId',
    )
  ) {
    return {
      ok: false,
      code: 'INVALID_JOB_PAYLOAD',
      message: 'Job data contains unexpected properties',
    };
  }
  return {
    ok: true,
    data: {
      schemaVersion: ROUTING_REQUESTED_JOB_SCHEMA_VERSION,
      searchId: data.searchId,
      routingWorkId: data.routingWorkId,
    },
  };
}

export function validateFinalizationRequestedJob(input: {
  readonly name: string;
  readonly data: unknown;
}): JobValidationResult<MeetingSearchFinalizationRequestedJobData> {
  if (input.name !== MEETING_SEARCH_FINALIZATION_REQUESTED_JOB_NAME) {
    return {
      ok: false,
      code: 'WRONG_JOB_NAME',
      message: `Unexpected job name: ${input.name}`,
    };
  }
  const data = asObject(input.data);
  if (!data) {
    return { ok: false, code: 'INVALID_JOB_PAYLOAD', message: 'Job data must be an object' };
  }
  if (data.schemaVersion !== MEETING_SEARCH_FINALIZATION_REQUESTED_JOB_SCHEMA_VERSION) {
    return {
      ok: false,
      code: 'UNSUPPORTED_SCHEMA_VERSION',
      message: `Unsupported schemaVersion: ${String(data.schemaVersion)}`,
    };
  }
  if (typeof data.searchId !== 'string' || !UUID_RE.test(data.searchId)) {
    return {
      ok: false,
      code: 'INVALID_SEARCH_ID',
      message: 'Job data.searchId must be a UUID',
    };
  }
  if (Object.keys(data).some((key) => key !== 'schemaVersion' && key !== 'searchId')) {
    return {
      ok: false,
      code: 'INVALID_JOB_PAYLOAD',
      message: 'Job data contains unexpected properties',
    };
  }
  return {
    ok: true,
    data: {
      schemaVersion: MEETING_SEARCH_FINALIZATION_REQUESTED_JOB_SCHEMA_VERSION,
      searchId: data.searchId,
    },
  };
}
