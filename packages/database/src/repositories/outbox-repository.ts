import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import {
  isOutboxAggregateType,
  isOutboxEventType,
  type MeetingSearchRequestedPayload,
} from '../outbox.js';
import type {
  ClaimOutboxEventsCommand,
  ConditionalOutboxUpdateResult,
  MarkOutboxDeadLetterCommand,
  MarkOutboxPublishedCommand,
  MarkOutboxRetryCommand,
  OutboxEventRecord,
} from '../models.js';
import { outboxEvents } from '../schema/tables.js';
import type * as schema from '../schema/index.js';

type Db = PostgresJsDatabase<typeof schema>;

function mapOutboxEvent(row: typeof outboxEvents.$inferSelect): OutboxEventRecord {
  if (!isOutboxEventType(row.eventType)) {
    throw new Error(`Unexpected outbox event type from database: ${row.eventType}`);
  }
  if (!isOutboxAggregateType(row.aggregateType)) {
    throw new Error(`Unexpected outbox aggregate type from database: ${row.aggregateType}`);
  }

  const payload = row.payload as MeetingSearchRequestedPayload;
  if (typeof payload.searchId !== 'string') {
    throw new Error('Outbox payload missing searchId');
  }

  return {
    id: row.id,
    eventType: row.eventType,
    aggregateType: row.aggregateType,
    aggregateId: row.aggregateId,
    schemaVersion: row.schemaVersion,
    payload: { searchId: payload.searchId },
    createdAt: row.createdAt,
    publishedAt: row.publishedAt ?? null,
    failureCount: row.failureCount,
    nextAttemptAt: row.nextAttemptAt ?? null,
    leaseToken: row.leaseToken ?? null,
    leasedUntil: row.leasedUntil ?? null,
    lastErrorCode: row.lastErrorCode ?? null,
    deadLetteredAt: row.deadLetteredAt ?? null,
  };
}

export type OutboxRepository = {
  findByAggregateId: (aggregateId: string) => Promise<readonly OutboxEventRecord[]>;
  findUnpublished: (limit?: number) => Promise<readonly OutboxEventRecord[]>;
  findById: (eventId: string) => Promise<OutboxEventRecord | null>;
  /**
   * Atomically claim a bounded batch of due unpublished events.
   * Uses PostgreSQL `FOR UPDATE SKIP LOCKED` and sets lease_token / leased_until.
   * Must not be held open across Redis I/O.
   */
  claimDue: (command: ClaimOutboxEventsCommand) => Promise<readonly OutboxEventRecord[]>;
  markPublished: (command: MarkOutboxPublishedCommand) => Promise<ConditionalOutboxUpdateResult>;
  markRetry: (command: MarkOutboxRetryCommand) => Promise<ConditionalOutboxUpdateResult>;
  markDeadLettered: (
    command: MarkOutboxDeadLetterCommand,
  ) => Promise<ConditionalOutboxUpdateResult>;
};

export function createOutboxRepository(db: Db): OutboxRepository {
  return {
    async findByAggregateId(aggregateId) {
      const rows = await db
        .select()
        .from(outboxEvents)
        .where(eq(outboxEvents.aggregateId, aggregateId))
        .orderBy(asc(outboxEvents.createdAt), asc(outboxEvents.id));
      return rows.map(mapOutboxEvent);
    },

    async findUnpublished(limit = 100) {
      const rows = await db
        .select()
        .from(outboxEvents)
        .where(and(isNull(outboxEvents.publishedAt), isNull(outboxEvents.deadLetteredAt)))
        .orderBy(asc(outboxEvents.createdAt), asc(outboxEvents.id))
        .limit(limit);
      return rows.map(mapOutboxEvent);
    },

    async findById(eventId) {
      const row = await db.query.outboxEvents.findFirst({
        where: eq(outboxEvents.id, eventId),
      });
      return row ? mapOutboxEvent(row) : null;
    },

    async claimDue(command) {
      if (command.batchSize < 1) {
        return [];
      }

      const rows = await db.transaction(async (tx) => {
        const claimed = await tx.execute(sql`
          WITH due AS (
            SELECT id
            FROM outbox_events
            WHERE published_at IS NULL
              AND dead_lettered_at IS NULL
              AND (next_attempt_at IS NULL OR next_attempt_at <= now())
              AND (leased_until IS NULL OR leased_until < now())
            ORDER BY created_at ASC, id ASC
            LIMIT ${command.batchSize}
            FOR UPDATE SKIP LOCKED
          )
          UPDATE outbox_events AS o
          SET
            lease_token = ${command.leaseToken}::uuid,
            leased_until = now() + (${command.leaseMs}::text || ' milliseconds')::interval
          FROM due
          WHERE o.id = due.id
          RETURNING
            o.id,
            o.event_type,
            o.aggregate_type,
            o.aggregate_id,
            o.schema_version,
            o.payload,
            o.created_at,
            o.published_at,
            o.failure_count,
            o.next_attempt_at,
            o.lease_token,
            o.leased_until,
            o.last_error_code,
            o.dead_lettered_at
        `);

        return claimed as unknown as Array<{
          id: string;
          event_type: string;
          aggregate_type: string;
          aggregate_id: string;
          schema_version: number;
          payload: { searchId: string };
          created_at: Date | string;
          published_at: Date | string | null;
          failure_count: number;
          next_attempt_at: Date | string | null;
          lease_token: string | null;
          leased_until: Date | string | null;
          last_error_code: string | null;
          dead_lettered_at: Date | string | null;
        }>;
      });

      return rows.map((row) =>
        mapOutboxEvent({
          id: row.id,
          eventType: row.event_type,
          aggregateType: row.aggregate_type,
          aggregateId: row.aggregate_id,
          schemaVersion: row.schema_version,
          payload: row.payload,
          createdAt: new Date(row.created_at),
          publishedAt: row.published_at ? new Date(row.published_at) : null,
          failureCount: row.failure_count,
          nextAttemptAt: row.next_attempt_at ? new Date(row.next_attempt_at) : null,
          leaseToken: row.lease_token,
          leasedUntil: row.leased_until ? new Date(row.leased_until) : null,
          lastErrorCode: row.last_error_code,
          deadLetteredAt: row.dead_lettered_at ? new Date(row.dead_lettered_at) : null,
        }),
      );
    },

    async markPublished(command) {
      const updated = await db
        .update(outboxEvents)
        .set({
          publishedAt: sql`now()`,
          leaseToken: null,
          leasedUntil: null,
          lastErrorCode: null,
          nextAttemptAt: null,
        })
        .where(
          and(
            eq(outboxEvents.id, command.eventId),
            eq(outboxEvents.leaseToken, command.leaseToken),
            isNull(outboxEvents.publishedAt),
            isNull(outboxEvents.deadLetteredAt),
          ),
        )
        .returning({ id: outboxEvents.id });

      return updated.length > 0 ? { outcome: 'updated' } : { outcome: 'not_updated' };
    },

    async markRetry(command) {
      const updated = await db
        .update(outboxEvents)
        .set({
          failureCount: sql`${outboxEvents.failureCount} + 1`,
          nextAttemptAt: sql`now() + (${command.nextAttemptDelayMs}::text || ' milliseconds')::interval`,
          leaseToken: null,
          leasedUntil: null,
          lastErrorCode: command.errorCode,
        })
        .where(
          and(
            eq(outboxEvents.id, command.eventId),
            eq(outboxEvents.leaseToken, command.leaseToken),
            isNull(outboxEvents.publishedAt),
            isNull(outboxEvents.deadLetteredAt),
          ),
        )
        .returning({ id: outboxEvents.id });

      return updated.length > 0 ? { outcome: 'updated' } : { outcome: 'not_updated' };
    },

    async markDeadLettered(command) {
      const updated = await db
        .update(outboxEvents)
        .set({
          deadLetteredAt: sql`now()`,
          leaseToken: null,
          leasedUntil: null,
          lastErrorCode: command.errorCode,
          failureCount: sql`${outboxEvents.failureCount} + 1`,
        })
        .where(
          and(
            eq(outboxEvents.id, command.eventId),
            eq(outboxEvents.leaseToken, command.leaseToken),
            isNull(outboxEvents.publishedAt),
            isNull(outboxEvents.deadLetteredAt),
          ),
        )
        .returning({ id: outboxEvents.id });

      return updated.length > 0 ? { outcome: 'updated' } : { outcome: 'not_updated' };
    },
  };
}
