import { and, asc, eq, isNull } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import {
  isOutboxAggregateType,
  isOutboxEventType,
  type MeetingSearchRequestedPayload,
} from '../outbox.js';
import type { OutboxEventRecord } from '../models.js';
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
  };
}

export type OutboxRepository = {
  findByAggregateId: (aggregateId: string) => Promise<readonly OutboxEventRecord[]>;
  findUnpublished: (limit?: number) => Promise<readonly OutboxEventRecord[]>;
};

export function createOutboxRepository(db: Db): OutboxRepository {
  return {
    async findByAggregateId(aggregateId) {
      const rows = await db
        .select()
        .from(outboxEvents)
        .where(eq(outboxEvents.aggregateId, aggregateId))
        .orderBy(asc(outboxEvents.createdAt));
      return rows.map(mapOutboxEvent);
    },

    async findUnpublished(limit = 100) {
      const rows = await db
        .select()
        .from(outboxEvents)
        .where(and(isNull(outboxEvents.publishedAt)))
        .orderBy(asc(outboxEvents.createdAt))
        .limit(limit);
      return rows.map(mapOutboxEvent);
    },
  };
}
