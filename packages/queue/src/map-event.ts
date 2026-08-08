import {
  MEETING_SEARCH_AGGREGATE_TYPE,
  MEETING_SEARCH_CANDIDATES_REQUESTED_EVENT_TYPE,
  MEETING_SEARCH_CANDIDATES_REQUESTED_SCHEMA_VERSION,
  MEETING_SEARCH_FINALIZATION_REQUESTED_EVENT_TYPE,
  MEETING_SEARCH_FINALIZATION_REQUESTED_SCHEMA_VERSION,
  MEETING_SEARCH_REQUESTED_EVENT_TYPE,
  MEETING_SEARCH_REQUESTED_SCHEMA_VERSION,
  ROUTING_REQUESTED_EVENT_TYPE,
  ROUTING_REQUESTED_SCHEMA_VERSION,
  type OutboxEventRecord,
  type RoutingRequestedPayload,
} from '@railmeet/database';

import {
  MEETING_SEARCH_CANDIDATES_QUEUE_NAME,
  MEETING_SEARCH_CANDIDATES_REQUESTED_JOB_NAME,
  MEETING_SEARCH_CANDIDATES_REQUESTED_JOB_SCHEMA_VERSION,
  MEETING_SEARCH_FINALIZATION_QUEUE_NAME,
  MEETING_SEARCH_FINALIZATION_REQUESTED_JOB_NAME,
  MEETING_SEARCH_FINALIZATION_REQUESTED_JOB_SCHEMA_VERSION,
  MEETING_SEARCH_REQUESTED_JOB_NAME,
  MEETING_SEARCH_REQUESTED_JOB_SCHEMA_VERSION,
  MEETING_SEARCHES_QUEUE_NAME,
  ROUTING_REQUESTED_JOB_NAME,
  ROUTING_REQUESTED_JOB_SCHEMA_VERSION,
  MEETING_SEARCH_ROUTING_QUEUE_NAME,
  assertSafeJobId,
  outboxJobId,
  type OutboxMappedJobData,
  type OutboxPoisonErrorCode,
} from './contract.js';

export type MappedOutboxJob = {
  readonly queueName: string;
  readonly jobName: string;
  readonly jobId: string;
  readonly data: OutboxMappedJobData;
};

/** @deprecated Prefer MappedOutboxJob */
export type MappedMeetingSearchJob = MappedOutboxJob & {
  readonly queueName: typeof MEETING_SEARCHES_QUEUE_NAME;
  readonly jobName: typeof MEETING_SEARCH_REQUESTED_JOB_NAME;
};

export type MapOutboxEventResult =
  | { readonly ok: true; readonly job: MappedOutboxJob }
  | { readonly ok: false; readonly errorCode: OutboxPoisonErrorCode };

/**
 * Validates an outbox row and maps it to the BullMQ job contract.
 * Does not include participant data, credentials, or row internals.
 */
export function mapOutboxEventToJob(event: OutboxEventRecord): MapOutboxEventResult {
  if (event.aggregateType !== MEETING_SEARCH_AGGREGATE_TYPE) {
    return { ok: false, errorCode: 'UNSUPPORTED_EVENT_TYPE' };
  }

  const jobId = outboxJobId(event.id);
  assertSafeJobId(jobId);

  if (event.eventType === MEETING_SEARCH_REQUESTED_EVENT_TYPE) {
    if (event.schemaVersion !== MEETING_SEARCH_REQUESTED_SCHEMA_VERSION) {
      return { ok: false, errorCode: 'UNSUPPORTED_SCHEMA_VERSION' };
    }
    const searchId = event.payload.searchId;
    if (typeof searchId !== 'string' || searchId.length === 0 || searchId !== event.aggregateId) {
      return { ok: false, errorCode: 'INVALID_PAYLOAD' };
    }
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

  if (event.eventType === MEETING_SEARCH_CANDIDATES_REQUESTED_EVENT_TYPE) {
    if (event.schemaVersion !== MEETING_SEARCH_CANDIDATES_REQUESTED_SCHEMA_VERSION) {
      return { ok: false, errorCode: 'UNSUPPORTED_SCHEMA_VERSION' };
    }
    const searchId = event.payload.searchId;
    if (typeof searchId !== 'string' || searchId.length === 0 || searchId !== event.aggregateId) {
      return { ok: false, errorCode: 'INVALID_PAYLOAD' };
    }
    return {
      ok: true,
      job: {
        queueName: MEETING_SEARCH_CANDIDATES_QUEUE_NAME,
        jobName: MEETING_SEARCH_CANDIDATES_REQUESTED_JOB_NAME,
        jobId,
        data: {
          schemaVersion: MEETING_SEARCH_CANDIDATES_REQUESTED_JOB_SCHEMA_VERSION,
          searchId,
        },
      },
    };
  }

  if (event.eventType === ROUTING_REQUESTED_EVENT_TYPE) {
    if (event.schemaVersion !== ROUTING_REQUESTED_SCHEMA_VERSION) {
      return { ok: false, errorCode: 'UNSUPPORTED_SCHEMA_VERSION' };
    }
    const payload = event.payload as RoutingRequestedPayload;
    const searchId = payload.searchId;
    const routingWorkId = payload.routingWorkId;
    if (
      typeof searchId !== 'string' ||
      searchId.length === 0 ||
      searchId !== event.aggregateId ||
      typeof routingWorkId !== 'string' ||
      routingWorkId.length === 0 ||
      event.dedupeKey !== routingWorkId
    ) {
      return { ok: false, errorCode: 'INVALID_PAYLOAD' };
    }
    return {
      ok: true,
      job: {
        queueName: MEETING_SEARCH_ROUTING_QUEUE_NAME,
        jobName: ROUTING_REQUESTED_JOB_NAME,
        jobId,
        data: {
          schemaVersion: ROUTING_REQUESTED_JOB_SCHEMA_VERSION,
          searchId,
          routingWorkId,
        },
      },
    };
  }

  if (event.eventType === MEETING_SEARCH_FINALIZATION_REQUESTED_EVENT_TYPE) {
    if (event.schemaVersion !== MEETING_SEARCH_FINALIZATION_REQUESTED_SCHEMA_VERSION) {
      return { ok: false, errorCode: 'UNSUPPORTED_SCHEMA_VERSION' };
    }
    const searchId = event.payload.searchId;
    if (
      typeof searchId !== 'string' ||
      searchId.length === 0 ||
      searchId !== event.aggregateId ||
      !(
        event.dedupeKey.startsWith('candidate-generation:') ||
        event.dedupeKey.startsWith('routing-work:')
      )
    ) {
      return { ok: false, errorCode: 'INVALID_PAYLOAD' };
    }
    return {
      ok: true,
      job: {
        queueName: MEETING_SEARCH_FINALIZATION_QUEUE_NAME,
        jobName: MEETING_SEARCH_FINALIZATION_REQUESTED_JOB_NAME,
        jobId,
        data: {
          schemaVersion: MEETING_SEARCH_FINALIZATION_REQUESTED_JOB_SCHEMA_VERSION,
          searchId,
        },
      },
    };
  }

  return { ok: false, errorCode: 'UNSUPPORTED_EVENT_TYPE' };
}
