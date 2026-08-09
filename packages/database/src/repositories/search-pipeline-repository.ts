import { and, asc, eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import {
  MEETING_SEARCH_AGGREGATE_TYPE,
  MEETING_SEARCH_FINALIZATION_REQUESTED_EVENT_TYPE,
  MEETING_SEARCH_FINALIZATION_REQUESTED_SCHEMA_VERSION,
  ROUTING_REQUESTED_EVENT_TYPE,
  ROUTING_REQUESTED_SCHEMA_VERSION,
  candidateGenerationFinalizationDedupeKey,
  routingWorkFinalizationDedupeKey,
} from '../outbox.js';
import type {
  CandidateGenerationRecord,
  CandidateGenerationStatus,
  MeetingSearchCandidateRecord,
  NearestCityCandidate,
  PersistJourneyInput,
  PersistedJourneyRecord,
  RoutingWorkRecord,
  RoutingWorkStatus,
} from '../models.js';
import type { NormalizedJourneyLegJson } from '../schema/tables.js';
import {
  meetingSearchCandidateGenerations,
  meetingSearchCandidates,
  meetingSearchJourneys,
  meetingSearchRoutingWork,
  outboxEvents,
} from '../schema/tables.js';
import type * as schema from '../schema/index.js';

type Db = PostgresJsDatabase<typeof schema>;

function assertGenerationStatus(value: string): CandidateGenerationStatus {
  if (
    value === 'pending' ||
    value === 'running' ||
    value === 'succeeded' ||
    value === 'failed_permanent'
  ) {
    return value;
  }
  throw new Error(`Unexpected candidate generation status: ${value}`);
}

function assertRoutingStatus(value: string): RoutingWorkStatus {
  if (
    value === 'pending' ||
    value === 'running' ||
    value === 'succeeded' ||
    value === 'no_journeys' ||
    value === 'exhausted'
  ) {
    return value;
  }
  throw new Error(`Unexpected routing work status: ${value}`);
}

function mapGeneration(
  row: typeof meetingSearchCandidateGenerations.$inferSelect,
): CandidateGenerationRecord {
  return {
    searchId: row.searchId,
    status: assertGenerationStatus(row.status),
    startedAt: row.startedAt ?? null,
    completedAt: row.completedAt ?? null,
    errorCode: row.errorCode ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapCandidate(
  row: typeof meetingSearchCandidates.$inferSelect,
): MeetingSearchCandidateRecord {
  return {
    searchId: row.searchId,
    destinationPlaceId: row.destinationPlaceId,
    ordinal: row.ordinal,
    distanceMeters: row.distanceMeters,
    createdAt: row.createdAt,
  };
}

function mapRoutingWork(row: typeof meetingSearchRoutingWork.$inferSelect): RoutingWorkRecord {
  return {
    id: row.id,
    searchId: row.searchId,
    participantId: row.participantId,
    destinationPlaceId: row.destinationPlaceId,
    status: assertRoutingStatus(row.status),
    startedAt: row.startedAt ?? null,
    completedAt: row.completedAt ?? null,
    errorCode: row.errorCode ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapJourney(row: typeof meetingSearchJourneys.$inferSelect): PersistedJourneyRecord {
  const legs = (row.legs as readonly NormalizedJourneyLegJson[]).map((leg) => ({
    mode: leg.mode,
    departureAt: new Date(leg.departureAt),
    arrivalAt: new Date(leg.arrivalAt),
    durationMinutes: leg.durationMinutes,
    ...(leg.providerReference ? { providerReference: leg.providerReference } : {}),
    ...(leg.geometry
      ? {
          geometry: {
            points: leg.geometry.points,
            precision: leg.geometry.precision,
            length: leg.geometry.length,
          },
        }
      : {}),
  }));
  return {
    id: row.id,
    routingWorkId: row.routingWorkId,
    journeyOrdinal: row.journeyOrdinal,
    departureAt: row.departureAt,
    arrivalAt: row.arrivalAt,
    durationMinutes: row.durationMinutes,
    transfers: row.transfers,
    transportModes: row.transportModes,
    legs,
    providerReference: row.providerReference ?? null,
    createdAt: row.createdAt,
  };
}

export type ClaimCandidateGenerationResult =
  | { readonly outcome: 'claimed'; readonly generation: CandidateGenerationRecord }
  | { readonly outcome: 'already_running'; readonly generation: CandidateGenerationRecord }
  | { readonly outcome: 'already_succeeded'; readonly generation: CandidateGenerationRecord }
  | { readonly outcome: 'already_failed'; readonly generation: CandidateGenerationRecord }
  | { readonly outcome: 'not_found' };

export type ClaimRoutingWorkResult =
  | { readonly outcome: 'claimed'; readonly work: RoutingWorkRecord }
  | { readonly outcome: 'already_running'; readonly work: RoutingWorkRecord }
  | { readonly outcome: 'already_terminal'; readonly work: RoutingWorkRecord }
  | { readonly outcome: 'not_found' };

export type FanOutRoutingInput = {
  readonly searchId: string;
  readonly candidates: readonly {
    readonly destinationPlaceId: string;
    readonly ordinal: number;
    readonly distanceMeters: number;
  }[];
  readonly participantIds: readonly string[];
};

export type SearchPipelineRepository = {
  findCandidateGeneration: (searchId: string) => Promise<CandidateGenerationRecord | null>;
  claimCandidateGeneration: (searchId: string) => Promise<ClaimCandidateGenerationResult>;
  completeCandidateGeneration: (
    searchId: string,
    outcome: 'succeeded' | 'failed_permanent',
    errorCode?: string,
  ) => Promise<void>;
  findNearestCityCandidates: (
    originPlaceIds: readonly string[],
    limit: number,
  ) => Promise<readonly NearestCityCandidate[]>;
  listCandidates: (searchId: string) => Promise<readonly MeetingSearchCandidateRecord[]>;
  /**
   * Idempotent fan-out: insert candidates + routing work + routing outbox in one transaction.
   * Safe on redelivery (ON CONFLICT DO NOTHING).
   */
  persistCandidatesAndFanOut: (input: FanOutRoutingInput) => Promise<{
    readonly candidateCount: number;
    readonly routingWorkCount: number;
  }>;
  findRoutingWorkById: (routingWorkId: string) => Promise<RoutingWorkRecord | null>;
  claimRoutingWork: (routingWorkId: string) => Promise<ClaimRoutingWorkResult>;
  completeRoutingWorkWithJourneys: (input: {
    readonly routingWorkId: string;
    readonly status: 'succeeded' | 'no_journeys';
    readonly journeys: readonly PersistJourneyInput[];
  }) => Promise<void>;
  markRoutingWorkExhausted: (routingWorkId: string, errorCode: string) => Promise<void>;
  listJourneysForRoutingWork: (routingWorkId: string) => Promise<readonly PersistedJourneyRecord[]>;
  countRoutingWorkForSearch: (searchId: string) => Promise<number>;
};

export function createSearchPipelineRepository(db: Db): SearchPipelineRepository {
  return {
    async findCandidateGeneration(searchId) {
      const [row] = await db
        .select()
        .from(meetingSearchCandidateGenerations)
        .where(eq(meetingSearchCandidateGenerations.searchId, searchId))
        .limit(1);
      return row ? mapGeneration(row) : null;
    },

    async claimCandidateGeneration(searchId) {
      const claimed = await db
        .update(meetingSearchCandidateGenerations)
        .set({
          status: 'running',
          startedAt: sql`coalesce(${meetingSearchCandidateGenerations.startedAt}, now())`,
          updatedAt: sql`now()`,
        })
        .where(
          and(
            eq(meetingSearchCandidateGenerations.searchId, searchId),
            eq(meetingSearchCandidateGenerations.status, 'pending'),
          ),
        )
        .returning();

      if (claimed.length > 0) {
        return { outcome: 'claimed', generation: mapGeneration(claimed[0]!) };
      }

      const current = await this.findCandidateGeneration(searchId);
      if (!current) {
        return { outcome: 'not_found' };
      }
      if (current.status === 'running') {
        // Redelivery after commit-before-ack: allow processor to resume fan-out.
        return { outcome: 'already_running', generation: current };
      }
      if (current.status === 'succeeded') {
        return { outcome: 'already_succeeded', generation: current };
      }
      return { outcome: 'already_failed', generation: current };
    },

    async completeCandidateGeneration(searchId, outcome, errorCode) {
      await db.transaction(async (tx) => {
        await tx
          .update(meetingSearchCandidateGenerations)
          .set({
            status: outcome,
            completedAt: sql`coalesce(${meetingSearchCandidateGenerations.completedAt}, now())`,
            errorCode: errorCode ?? null,
            updatedAt: sql`now()`,
          })
          .where(
            and(
              eq(meetingSearchCandidateGenerations.searchId, searchId),
              sql`${meetingSearchCandidateGenerations.status} IN ('pending', 'running')`,
            ),
          );

        if (outcome === 'failed_permanent') {
          await tx
            .insert(outboxEvents)
            .values({
              eventType: MEETING_SEARCH_FINALIZATION_REQUESTED_EVENT_TYPE,
              aggregateType: MEETING_SEARCH_AGGREGATE_TYPE,
              aggregateId: searchId,
              schemaVersion: MEETING_SEARCH_FINALIZATION_REQUESTED_SCHEMA_VERSION,
              dedupeKey: candidateGenerationFinalizationDedupeKey(searchId),
              payload: { searchId },
            })
            .onConflictDoNothing();
        }
      });
    },

    async findNearestCityCandidates(originPlaceIds, limit) {
      if (originPlaceIds.length === 0 || limit < 1) {
        return [];
      }

      const rows = await db.execute(sql`
        WITH origins AS (
          SELECT location
          FROM places
          WHERE id IN (${sql.join(
            originPlaceIds.map((id) => sql`${id}`),
            sql`, `,
          )})
        ),
        center AS (
          SELECT ST_SetSRID(
            ST_MakePoint(avg(ST_X(location)), avg(ST_Y(location))),
            4326
          ) AS geom
          FROM origins
        )
        SELECT
          p.id AS place_id,
          ST_Distance(p.location::geography, c.geom::geography) AS distance_meters
        FROM places p
        CROSS JOIN center c
        WHERE p.kind = 'city'
          AND c.geom IS NOT NULL
        ORDER BY p.location <-> c.geom, p.id ASC
        LIMIT ${limit}
      `);

      const list = rows as unknown as Array<{ place_id: string; distance_meters: number | string }>;
      return list.map((row) => ({
        placeId: row.place_id,
        distanceMeters: Number(row.distance_meters),
      }));
    },

    async listCandidates(searchId) {
      const rows = await db
        .select()
        .from(meetingSearchCandidates)
        .where(eq(meetingSearchCandidates.searchId, searchId))
        .orderBy(asc(meetingSearchCandidates.ordinal));
      return rows.map(mapCandidate);
    },

    async persistCandidatesAndFanOut(input) {
      return db.transaction(async (tx) => {
        if (input.candidates.length > 0) {
          await tx
            .insert(meetingSearchCandidates)
            .values(
              input.candidates.map((candidate) => ({
                searchId: input.searchId,
                destinationPlaceId: candidate.destinationPlaceId,
                ordinal: candidate.ordinal,
                distanceMeters: candidate.distanceMeters,
              })),
            )
            .onConflictDoNothing();
        }

        const existingCandidates = await tx
          .select()
          .from(meetingSearchCandidates)
          .where(eq(meetingSearchCandidates.searchId, input.searchId))
          .orderBy(asc(meetingSearchCandidates.ordinal));

        if (existingCandidates.length > 0 && input.participantIds.length > 0) {
          const workValues = existingCandidates.flatMap((candidate) =>
            input.participantIds.map((participantId) => ({
              searchId: input.searchId,
              participantId,
              destinationPlaceId: candidate.destinationPlaceId,
              status: 'pending' as const,
            })),
          );

          await tx.insert(meetingSearchRoutingWork).values(workValues).onConflictDoNothing();
        }

        const workRows = await tx
          .select()
          .from(meetingSearchRoutingWork)
          .where(eq(meetingSearchRoutingWork.searchId, input.searchId));

        if (workRows.length > 0) {
          await tx
            .insert(outboxEvents)
            .values(
              workRows.map((work) => ({
                eventType: ROUTING_REQUESTED_EVENT_TYPE,
                aggregateType: MEETING_SEARCH_AGGREGATE_TYPE,
                aggregateId: input.searchId,
                schemaVersion: ROUTING_REQUESTED_SCHEMA_VERSION,
                dedupeKey: work.id,
                payload: { searchId: input.searchId, routingWorkId: work.id },
              })),
            )
            .onConflictDoNothing();
        }

        await tx
          .update(meetingSearchCandidateGenerations)
          .set({
            status: 'succeeded',
            completedAt: sql`coalesce(${meetingSearchCandidateGenerations.completedAt}, now())`,
            errorCode: null,
            updatedAt: sql`now()`,
          })
          .where(eq(meetingSearchCandidateGenerations.searchId, input.searchId));

        if (existingCandidates.length === 0) {
          await tx
            .insert(outboxEvents)
            .values({
              eventType: MEETING_SEARCH_FINALIZATION_REQUESTED_EVENT_TYPE,
              aggregateType: MEETING_SEARCH_AGGREGATE_TYPE,
              aggregateId: input.searchId,
              schemaVersion: MEETING_SEARCH_FINALIZATION_REQUESTED_SCHEMA_VERSION,
              dedupeKey: candidateGenerationFinalizationDedupeKey(input.searchId),
              payload: { searchId: input.searchId },
            })
            .onConflictDoNothing();
        }

        return {
          candidateCount: existingCandidates.length,
          routingWorkCount: workRows.length,
        };
      });
    },

    async findRoutingWorkById(routingWorkId) {
      const [row] = await db
        .select()
        .from(meetingSearchRoutingWork)
        .where(eq(meetingSearchRoutingWork.id, routingWorkId))
        .limit(1);
      return row ? mapRoutingWork(row) : null;
    },

    async claimRoutingWork(routingWorkId) {
      const claimed = await db
        .update(meetingSearchRoutingWork)
        .set({
          status: 'running',
          startedAt: sql`coalesce(${meetingSearchRoutingWork.startedAt}, now())`,
          updatedAt: sql`now()`,
        })
        .where(
          and(
            eq(meetingSearchRoutingWork.id, routingWorkId),
            eq(meetingSearchRoutingWork.status, 'pending'),
          ),
        )
        .returning();

      if (claimed.length > 0) {
        return { outcome: 'claimed', work: mapRoutingWork(claimed[0]!) };
      }

      const current = await this.findRoutingWorkById(routingWorkId);
      if (!current) {
        return { outcome: 'not_found' };
      }
      if (current.status === 'running') {
        return { outcome: 'already_running', work: current };
      }
      return { outcome: 'already_terminal', work: current };
    },

    async completeRoutingWorkWithJourneys(input) {
      await db.transaction(async (tx) => {
        if (input.journeys.length > 0) {
          await tx
            .insert(meetingSearchJourneys)
            .values(
              input.journeys.map((journey) => ({
                routingWorkId: input.routingWorkId,
                journeyOrdinal: journey.journeyOrdinal,
                departureAt: journey.departureAt,
                arrivalAt: journey.arrivalAt,
                durationMinutes: journey.durationMinutes,
                transfers: journey.transfers,
                transportModes: [...journey.transportModes],
                legs: journey.legs.map((leg): NormalizedJourneyLegJson => ({
                  mode: leg.mode,
                  departureAt: leg.departureAt.toISOString(),
                  arrivalAt: leg.arrivalAt.toISOString(),
                  durationMinutes: leg.durationMinutes,
                  ...(leg.providerReference ? { providerReference: leg.providerReference } : {}),
                  ...(leg.geometry
                    ? {
                        geometry: {
                          points: leg.geometry.points,
                          precision: leg.geometry.precision,
                          length: leg.geometry.length,
                        },
                      }
                    : {}),
                })),
                providerReference: journey.providerReference ?? null,
              })),
            )
            .onConflictDoNothing();
        }

        const updated = await tx
          .update(meetingSearchRoutingWork)
          .set({
            status: input.status,
            completedAt: sql`coalesce(${meetingSearchRoutingWork.completedAt}, now())`,
            errorCode: null,
            updatedAt: sql`now()`,
          })
          .where(
            and(
              eq(meetingSearchRoutingWork.id, input.routingWorkId),
              sql`${meetingSearchRoutingWork.status} IN ('pending', 'running')`,
            ),
          )
          .returning({
            id: meetingSearchRoutingWork.id,
            searchId: meetingSearchRoutingWork.searchId,
          });

        const work =
          updated[0] ??
          (
            await tx
              .select({
                id: meetingSearchRoutingWork.id,
                searchId: meetingSearchRoutingWork.searchId,
              })
              .from(meetingSearchRoutingWork)
              .where(eq(meetingSearchRoutingWork.id, input.routingWorkId))
              .limit(1)
          )[0];

        if (work) {
          await tx
            .insert(outboxEvents)
            .values({
              eventType: MEETING_SEARCH_FINALIZATION_REQUESTED_EVENT_TYPE,
              aggregateType: MEETING_SEARCH_AGGREGATE_TYPE,
              aggregateId: work.searchId,
              schemaVersion: MEETING_SEARCH_FINALIZATION_REQUESTED_SCHEMA_VERSION,
              dedupeKey: routingWorkFinalizationDedupeKey(work.id),
              payload: { searchId: work.searchId },
            })
            .onConflictDoNothing();
        }
      });
    },

    async markRoutingWorkExhausted(routingWorkId, errorCode) {
      await db.transaction(async (tx) => {
        const updated = await tx
          .update(meetingSearchRoutingWork)
          .set({
            status: 'exhausted',
            completedAt: sql`coalesce(${meetingSearchRoutingWork.completedAt}, now())`,
            errorCode,
            updatedAt: sql`now()`,
          })
          .where(
            and(
              eq(meetingSearchRoutingWork.id, routingWorkId),
              sql`${meetingSearchRoutingWork.status} IN ('pending', 'running')`,
            ),
          )
          .returning({
            id: meetingSearchRoutingWork.id,
            searchId: meetingSearchRoutingWork.searchId,
          });

        const work =
          updated[0] ??
          (
            await tx
              .select({
                id: meetingSearchRoutingWork.id,
                searchId: meetingSearchRoutingWork.searchId,
              })
              .from(meetingSearchRoutingWork)
              .where(eq(meetingSearchRoutingWork.id, routingWorkId))
              .limit(1)
          )[0];

        if (work) {
          await tx
            .insert(outboxEvents)
            .values({
              eventType: MEETING_SEARCH_FINALIZATION_REQUESTED_EVENT_TYPE,
              aggregateType: MEETING_SEARCH_AGGREGATE_TYPE,
              aggregateId: work.searchId,
              schemaVersion: MEETING_SEARCH_FINALIZATION_REQUESTED_SCHEMA_VERSION,
              dedupeKey: routingWorkFinalizationDedupeKey(work.id),
              payload: { searchId: work.searchId },
            })
            .onConflictDoNothing();
        }
      });
    },

    async listJourneysForRoutingWork(routingWorkId) {
      const rows = await db
        .select()
        .from(meetingSearchJourneys)
        .where(eq(meetingSearchJourneys.routingWorkId, routingWorkId))
        .orderBy(asc(meetingSearchJourneys.journeyOrdinal));
      return rows.map(mapJourney);
    },

    async countRoutingWorkForSearch(searchId) {
      const [row] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(meetingSearchRoutingWork)
        .where(eq(meetingSearchRoutingWork.searchId, searchId));
      return row?.count ?? 0;
    },
  };
}
