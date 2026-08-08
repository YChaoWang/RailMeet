import {
  isRankingMode,
  isSearchStatus,
  isTransportMode,
  type RankingMode,
  type SearchStatus,
  type TransportMode,
} from '@railmeet/shared';
import { asc, eq, inArray, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import { placeNotFound, type PlaceNotFoundError } from '../errors.js';
import type {
  ConditionalStatusUpdateResult,
  CreateMeetingSearchCommand,
  MeetingSearchParticipantRecord,
  MeetingSearchRecord,
  SearchKickoffResult,
} from '../models.js';
import {
  MEETING_SEARCH_AGGREGATE_TYPE,
  MEETING_SEARCH_REQUESTED_EVENT_TYPE,
  MEETING_SEARCH_REQUESTED_SCHEMA_VERSION,
} from '../outbox.js';
import {
  meetingSearchAllowedCountries,
  meetingSearchParticipants,
  meetingSearchTransportModes,
  meetingSearches,
  outboxEvents,
  places,
} from '../schema/tables.js';
import type * as schema from '../schema/index.js';

type Db = PostgresJsDatabase<typeof schema>;

function normalizeLocalTime(value: string): string {
  // PostgreSQL `time` may return HH:mm:ss; application model uses HH:mm.
  if (/^\d{2}:\d{2}:\d{2}/.test(value)) {
    return value.slice(0, 5);
  }
  return value;
}

function toPostgresTime(value: string): string {
  if (/^\d{2}:\d{2}$/.test(value)) {
    return `${value}:00`;
  }
  return value;
}

function mapParticipant(
  row: typeof meetingSearchParticipants.$inferSelect,
): MeetingSearchParticipantRecord {
  return {
    participantId: row.participantId,
    displayName: row.displayName,
    originPlaceId: row.originPlaceId,
    position: row.position,
  };
}

function assertSearchStatus(value: string): SearchStatus {
  if (!isSearchStatus(value)) {
    throw new Error(`Unexpected search status from database: ${value}`);
  }
  return value;
}

function assertRankingMode(value: string): RankingMode {
  if (!isRankingMode(value)) {
    throw new Error(`Unexpected ranking mode from database: ${value}`);
  }
  return value;
}

function assertTransportMode(value: string): TransportMode {
  if (!isTransportMode(value)) {
    throw new Error(`Unexpected transport mode from database: ${value}`);
  }
  return value;
}

function assertArrivalDayOffset(value: number): 0 | 1 {
  if (value === 0 || value === 1) {
    return value;
  }
  throw new Error(`Unexpected arrival day offset from database: ${value}`);
}

async function loadMeetingSearchAggregate(
  db: Db,
  searchId: string,
): Promise<MeetingSearchRecord | null> {
  const search = await db.query.meetingSearches.findFirst({
    where: eq(meetingSearches.id, searchId),
  });
  if (!search) {
    return null;
  }

  const [participantRows, modeRows, countryRows] = await Promise.all([
    db
      .select()
      .from(meetingSearchParticipants)
      .where(eq(meetingSearchParticipants.meetingSearchId, searchId))
      .orderBy(asc(meetingSearchParticipants.position)),
    db
      .select()
      .from(meetingSearchTransportModes)
      .where(eq(meetingSearchTransportModes.meetingSearchId, searchId))
      .orderBy(asc(meetingSearchTransportModes.mode)),
    db
      .select()
      .from(meetingSearchAllowedCountries)
      .where(eq(meetingSearchAllowedCountries.meetingSearchId, searchId))
      .orderBy(asc(meetingSearchAllowedCountries.countryCode)),
  ]);

  return {
    id: search.id,
    status: assertSearchStatus(search.status),
    travelDate: search.travelDate,
    earliestDepartureTime: normalizeLocalTime(search.earliestDepartureTime),
    latestArrivalTime: normalizeLocalTime(search.latestArrivalTime),
    arrivalDayOffset: assertArrivalDayOffset(search.arrivalDayOffset),
    maxJourneyDurationMinutes: search.maxJourneyDurationMinutes,
    maxTransfers: search.maxTransfers,
    minTransferDurationMinutes: search.minTransferDurationMinutes,
    rankingMode: assertRankingMode(search.rankingMode),
    participants: participantRows.map(mapParticipant),
    allowedTransportModes: modeRows.map((row) => assertTransportMode(row.mode)),
    allowedCountryCodes: countryRows.map((row) => row.countryCode),
    startedAt: search.startedAt ?? null,
    createdAt: search.createdAt,
    updatedAt: search.updatedAt,
  };
}

const TERMINAL_KICKOFF_STATUSES = new Set<SearchStatus>([
  'completed',
  'failed',
  'cancelled',
  'cancelling',
  'partially-completed',
]);

export type MeetingSearchRepository = {
  create: (
    command: CreateMeetingSearchCommand,
  ) => Promise<{ ok: true; value: MeetingSearchRecord } | { ok: false; error: PlaceNotFoundError }>;
  findById: (searchId: string) => Promise<MeetingSearchRecord | null>;
  /**
   * Idempotent Phase 6 kickoff: queued → running with started_at set once.
   * Concurrent callers: only one transition wins; others observe already_started.
   */
  tryKickoff: (searchId: string) => Promise<SearchKickoffResult>;
  updateStatusIf: (
    searchId: string,
    expectedStatuses: readonly SearchStatus[],
    nextStatus: SearchStatus,
  ) => Promise<ConditionalStatusUpdateResult>;
  deleteById: (searchId: string) => Promise<boolean>;
};

export function createMeetingSearchRepository(db: Db): MeetingSearchRepository {
  return {
    async create(command) {
      const originIds = [...new Set(command.participants.map((p) => p.originPlaceId))];
      const existing = await db
        .select({ id: places.id })
        .from(places)
        .where(inArray(places.id, originIds));
      const existingIds = new Set(existing.map((row) => row.id));
      const missing = originIds.filter((id) => !existingIds.has(id));
      if (missing.length > 0) {
        return { ok: false, error: placeNotFound(missing) };
      }

      const createdId = await db.transaction(async (tx) => {
        const [search] = await tx
          .insert(meetingSearches)
          .values({
            status: command.status ?? 'queued',
            travelDate: command.travelDate,
            earliestDepartureTime: toPostgresTime(command.earliestDepartureTime),
            latestArrivalTime: toPostgresTime(command.latestArrivalTime),
            arrivalDayOffset: command.arrivalDayOffset,
            maxJourneyDurationMinutes: command.maxJourneyDurationMinutes,
            maxTransfers: command.maxTransfers,
            minTransferDurationMinutes: command.minTransferDurationMinutes,
            rankingMode: command.rankingMode,
          })
          .returning({ id: meetingSearches.id });

        if (!search) {
          throw new Error('Failed to insert meeting search');
        }

        await tx.insert(meetingSearchParticipants).values(
          command.participants.map((participant) => ({
            meetingSearchId: search.id,
            participantId: participant.participantId,
            displayName: participant.displayName,
            originPlaceId: participant.originPlaceId,
            position: participant.position,
          })),
        );

        await tx.insert(meetingSearchTransportModes).values(
          command.allowedTransportModes.map((mode) => ({
            meetingSearchId: search.id,
            mode,
          })),
        );

        if (command.allowedCountryCodes && command.allowedCountryCodes.length > 0) {
          await tx.insert(meetingSearchAllowedCountries).values(
            command.allowedCountryCodes.map((countryCode) => ({
              meetingSearchId: search.id,
              countryCode,
            })),
          );
        }

        await tx.insert(outboxEvents).values({
          eventType: MEETING_SEARCH_REQUESTED_EVENT_TYPE,
          aggregateType: MEETING_SEARCH_AGGREGATE_TYPE,
          aggregateId: search.id,
          schemaVersion: MEETING_SEARCH_REQUESTED_SCHEMA_VERSION,
          payload: { searchId: search.id },
        });

        return search.id;
      });

      const aggregate = await loadMeetingSearchAggregate(db, createdId);
      if (!aggregate) {
        throw new Error('Meeting search disappeared after create');
      }
      return { ok: true, value: aggregate };
    },

    async findById(searchId) {
      return loadMeetingSearchAggregate(db, searchId);
    },

    async tryKickoff(searchId) {
      const updated = await db
        .update(meetingSearches)
        .set({
          status: 'running',
          startedAt: sql`coalesce(${meetingSearches.startedAt}, now())`,
          updatedAt: sql`now()`,
        })
        .where(sql`${meetingSearches.id} = ${searchId} AND ${meetingSearches.status} = 'queued'`)
        .returning({
          id: meetingSearches.id,
          startedAt: meetingSearches.startedAt,
        });

      if (updated.length > 0) {
        const startedAt = updated[0]!.startedAt;
        if (!startedAt) {
          throw new Error('Kickoff updated search without started_at');
        }
        return { outcome: 'started', searchId, startedAt };
      }

      const current = await loadMeetingSearchAggregate(db, searchId);
      if (!current) {
        return { outcome: 'not_found', searchId };
      }
      if (current.status === 'running') {
        return {
          outcome: 'already_started',
          searchId,
          startedAt: current.startedAt,
        };
      }
      if (TERMINAL_KICKOFF_STATUSES.has(current.status)) {
        return {
          outcome: 'already_terminal',
          searchId,
          status: current.status,
          startedAt: current.startedAt,
        };
      }
      // Unexpected non-queued / non-running / non-terminal status — treat as terminal no-op.
      return {
        outcome: 'already_terminal',
        searchId,
        status: current.status,
        startedAt: current.startedAt,
      };
    },

    async updateStatusIf(searchId, expectedStatuses, nextStatus) {
      if (expectedStatuses.length === 0) {
        const current = await loadMeetingSearchAggregate(db, searchId);
        if (!current) {
          return { outcome: 'not_found' };
        }
        return { outcome: 'conflict', currentStatus: current.status };
      }

      const updated = await db
        .update(meetingSearches)
        .set({
          status: nextStatus,
          updatedAt: sql`now()`,
        })
        .where(
          sql`${meetingSearches.id} = ${searchId} AND ${meetingSearches.status} IN (${sql.join(
            expectedStatuses.map((status) => sql`${status}`),
            sql`, `,
          )})`,
        )
        .returning({ id: meetingSearches.id });

      if (updated.length > 0) {
        const aggregate = await loadMeetingSearchAggregate(db, searchId);
        if (!aggregate) {
          return { outcome: 'not_found' };
        }
        return { outcome: 'updated', search: aggregate };
      }

      const current = await loadMeetingSearchAggregate(db, searchId);
      if (!current) {
        return { outcome: 'not_found' };
      }
      return { outcome: 'conflict', currentStatus: current.status };
    },

    async deleteById(searchId) {
      const deleted = await db
        .delete(meetingSearches)
        .where(eq(meetingSearches.id, searchId))
        .returning({ id: meetingSearches.id });
      return deleted.length > 0;
    },
  };
}
