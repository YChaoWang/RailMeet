import {
  MEETING_SEARCH_AGGREGATE_TYPE,
  MEETING_SEARCH_REQUESTED_EVENT_TYPE,
  MEETING_SEARCH_REQUESTED_SCHEMA_VERSION,
  type OutboxEventRecord,
} from '@railmeet/database';

import {
  MEETING_SEARCH_REQUESTED_JOB_NAME,
  MEETING_SEARCH_REQUESTED_JOB_SCHEMA_VERSION,
  MEETING_SEARCHES_QUEUE_NAME,
  assertSafeJobId,
  meetingSearchRequestedJobId,
  type MeetingSearchRequestedJobData,
  type OutboxPoisonErrorCode,
} from './contract.js';

export type MappedMeetingSearchJob = {
  readonly queueName: typeof MEETING_SEARCHES_QUEUE_NAME;
  readonly jobName: typeof MEETING_SEARCH_REQUESTED_JOB_NAME;
  readonly jobId: string;
  readonly data: MeetingSearchRequestedJobData;
};

export type MapOutboxEventResult =
  | { readonly ok: true; readonly job: MappedMeetingSearchJob }
  | { readonly ok: false; readonly errorCode: OutboxPoisonErrorCode };

/**
 * Validates an outbox row and maps it to the BullMQ job contract.
 * Does not include participant data, credentials, or row internals.
 */
export function mapOutboxEventToJob(event: OutboxEventRecord): MapOutboxEventResult {
  if (event.eventType !== MEETING_SEARCH_REQUESTED_EVENT_TYPE) {
    return { ok: false, errorCode: 'UNSUPPORTED_EVENT_TYPE' };
  }
  if (event.aggregateType !== MEETING_SEARCH_AGGREGATE_TYPE) {
    return { ok: false, errorCode: 'UNSUPPORTED_EVENT_TYPE' };
  }
  if (event.schemaVersion !== MEETING_SEARCH_REQUESTED_SCHEMA_VERSION) {
    return { ok: false, errorCode: 'UNSUPPORTED_SCHEMA_VERSION' };
  }

  const searchId = event.payload.searchId;
  if (typeof searchId !== 'string' || searchId.length === 0 || searchId !== event.aggregateId) {
    return { ok: false, errorCode: 'INVALID_PAYLOAD' };
  }

  const jobId = meetingSearchRequestedJobId(event.id);
  assertSafeJobId(jobId);

  return {
    ok: true,
    job: {
      queueName: MEETING_SEARCHES_QUEUE_NAME,
      jobName: MEETING_SEARCH_REQUESTED_JOB_NAME,
      jobId,
      data: {
        schemaVersion: MEETING_SEARCH_REQUESTED_JOB_SCHEMA_VERSION,
        searchId,
      },
    },
  };
}
