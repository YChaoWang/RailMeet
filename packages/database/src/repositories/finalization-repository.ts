import {
  evaluateCandidateFeasibility,
  rankAllModes,
  type RankingJourneyInput,
  type RankingRoutingWorkInput,
} from '@railmeet/search-engine';
import type { RankingMode, SearchStatus } from '@railmeet/shared';
import { RANKING_MODES } from '@railmeet/shared';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import type {
  CandidateFeasibilityReason,
  FinalizeMeetingSearchResult,
  PlaceViewRecord,
  RankedCandidateRecord,
  RankedParticipantJourneyRecord,
  RankedResultsReadModel,
  SearchCompletionOutcome,
} from '../models.js';
import {
  meetingSearchCandidateEvaluations,
  meetingSearchCandidateGenerations,
  meetingSearchCandidateRankingJourneys,
  meetingSearchCandidateRankings,
  meetingSearchCandidates,
  meetingSearchJourneys,
  meetingSearchParticipants,
  meetingSearchRoutingWork,
  meetingSearches,
  places,
  type NormalizedJourneyLegJson,
} from '../schema/tables.js';
import type * as schema from '../schema/index.js';

type Db = PostgresJsDatabase<typeof schema>;

const TERMINAL_ROUTING = new Set(['succeeded', 'no_journeys', 'exhausted']);

export type FinalizationRepository = {
  finalizeMeetingSearch: (searchId: string) => Promise<FinalizeMeetingSearchResult>;
  /**
   * Phase 9 read: load persisted rankings for a completed search.
   * Uses a fixed number of queries (header + rankings + journeys + places).
   * Never recomputes ranking or feasibility. Failed searches return `failed`
   * without ranking rows.
   */
  loadRankedResults: (searchId: string) => Promise<RankedResultsReadModel>;
  listCandidateEvaluations: (searchId: string) => Promise<
    readonly {
      readonly destinationPlaceId: string;
      readonly feasibility: CandidateFeasibilityReason;
    }[]
  >;
  listCandidateRankings: (searchId: string) => Promise<
    readonly {
      readonly rankingMode: string;
      readonly destinationPlaceId: string;
      readonly rank: number;
      readonly totalDurationMinutes: number;
      readonly maxDurationMinutes: number;
      readonly durationRangeMinutes: number;
      readonly totalTransfers: number;
      readonly maxTransfers: number;
      readonly earliestArrivalAt: Date;
      readonly latestArrivalAt: Date;
      readonly arrivalSpreadMs: number;
    }[]
  >;
  listRankingJourneys: (searchId: string) => Promise<
    readonly {
      readonly rankingMode: string;
      readonly destinationPlaceId: string;
      readonly participantId: string;
      readonly journeyId: string;
    }[]
  >;
};

function assertFeasibility(value: string): CandidateFeasibilityReason {
  if (
    value === 'feasible' ||
    value === 'participant_no_journeys' ||
    value === 'routing_incomplete' ||
    value === 'technical_failure' ||
    value === 'invariant_violation'
  ) {
    return value;
  }
  throw new Error(`Unexpected feasibility: ${value}`);
}

export function createFinalizationRepository(db: Db): FinalizationRepository {
  return {
    async finalizeMeetingSearch(searchId) {
      return db.transaction(async (tx) => {
        const locked = await tx.execute(sql`
          SELECT id, status, ranking_mode, started_at, completed_at, failed_at
          FROM meeting_searches
          WHERE id = ${searchId}
          FOR UPDATE
        `);
        const searchRows = locked as unknown as Array<{
          id: string;
          status: string;
          ranking_mode: string;
          started_at: Date | null;
          completed_at: Date | null;
          failed_at: Date | null;
        }>;
        const search = searchRows[0];
        if (!search) {
          return { outcome: 'not_found', searchId };
        }
        if (search.status !== 'running') {
          return {
            outcome: 'already_terminal',
            searchId,
            status: search.status as SearchStatus,
          };
        }

        const [generation] = await tx
          .select()
          .from(meetingSearchCandidateGenerations)
          .where(eq(meetingSearchCandidateGenerations.searchId, searchId))
          .limit(1);
        if (!generation) {
          return failSearch(tx, searchId, 'INVARIANT_VIOLATION');
        }
        if (generation.status === 'pending' || generation.status === 'running') {
          return { outcome: 'not_ready', searchId };
        }
        if (generation.status === 'failed_permanent') {
          return failSearch(tx, searchId, 'CANDIDATE_GENERATION_FAILED');
        }

        const participants = await tx
          .select()
          .from(meetingSearchParticipants)
          .where(eq(meetingSearchParticipants.meetingSearchId, searchId))
          .orderBy(asc(meetingSearchParticipants.position));
        if (participants.length < 2 || participants.length > 6) {
          return failSearch(tx, searchId, 'INVARIANT_VIOLATION');
        }

        const candidates = await tx
          .select()
          .from(meetingSearchCandidates)
          .where(eq(meetingSearchCandidates.searchId, searchId))
          .orderBy(asc(meetingSearchCandidates.ordinal));

        const workRows = await tx
          .select()
          .from(meetingSearchRoutingWork)
          .where(eq(meetingSearchRoutingWork.searchId, searchId));

        if (candidates.length === 0) {
          if (workRows.length !== 0) {
            return failSearch(tx, searchId, 'INVARIANT_VIOLATION');
          }
          return completeSearch(tx, searchId, 'no_candidates', null);
        }

        const participantIds = participants.map((row) => row.participantId);
        const expectedWork = participants.length * candidates.length;
        if (workRows.length !== expectedWork) {
          const nonterminal = workRows.some((row) => !TERMINAL_ROUTING.has(row.status));
          if (nonterminal || workRows.length < expectedWork) {
            // Missing pairs may still be pending creation only during fan-out; treat incomplete as not_ready
            // unless every present row is terminal and counts still mismatch → invariant.
            if (workRows.every((row) => TERMINAL_ROUTING.has(row.status))) {
              return failSearch(tx, searchId, 'INVARIANT_VIOLATION');
            }
            return { outcome: 'not_ready', searchId };
          }
          return failSearch(tx, searchId, 'INVARIANT_VIOLATION');
        }

        if (workRows.some((row) => !TERMINAL_ROUTING.has(row.status))) {
          return { outcome: 'not_ready', searchId };
        }

        // Pair completeness
        for (const candidate of candidates) {
          for (const participantId of participantIds) {
            const match = workRows.find(
              (row) =>
                row.destinationPlaceId === candidate.destinationPlaceId &&
                row.participantId === participantId,
            );
            if (!match) {
              return failSearch(tx, searchId, 'INVARIANT_VIOLATION');
            }
          }
        }

        const journeyRows = await tx
          .select({
            journey: meetingSearchJourneys,
            workId: meetingSearchRoutingWork.id,
          })
          .from(meetingSearchJourneys)
          .innerJoin(
            meetingSearchRoutingWork,
            eq(meetingSearchJourneys.routingWorkId, meetingSearchRoutingWork.id),
          )
          .where(eq(meetingSearchRoutingWork.searchId, searchId));

        const journeysByWork = new Map<string, (typeof meetingSearchJourneys.$inferSelect)[]>();
        for (const row of journeyRows) {
          const list = journeysByWork.get(row.workId) ?? [];
          list.push(row.journey);
          journeysByWork.set(row.workId, list);
        }

        for (const work of workRows) {
          const journeys = journeysByWork.get(work.id) ?? [];
          if (work.status === 'succeeded' && journeys.length === 0) {
            return failSearch(tx, searchId, 'INVARIANT_VIOLATION');
          }
          if (work.status === 'no_journeys' && journeys.length > 0) {
            return failSearch(tx, searchId, 'INVARIANT_VIOLATION');
          }
          if (work.status === 'exhausted') {
            return failSearch(tx, searchId, 'ROUTING_TECHNICAL_FAILURE');
          }
        }

        const routingWork: RankingRoutingWorkInput[] = workRows.map((work) => {
          const journeys = (journeysByWork.get(work.id) ?? []).map(
            (journey): RankingJourneyInput => ({
              journeyId: journey.id,
              participantId: work.participantId,
              destinationPlaceId: work.destinationPlaceId,
              durationMinutes: journey.durationMinutes,
              transfers: journey.transfers,
              departureAt: journey.departureAt,
              arrivalAt: journey.arrivalAt,
            }),
          );
          return {
            routingWorkId: work.id,
            participantId: work.participantId,
            destinationPlaceId: work.destinationPlaceId,
            status: work.status as RankingRoutingWorkInput['status'],
            journeys,
          };
        });

        const evaluations = evaluateCandidateFeasibility({
          participantIds,
          candidates: candidates.map((row) => ({
            candidateId: row.destinationPlaceId,
            destinationPlaceId: row.destinationPlaceId,
            ordinal: row.ordinal,
          })),
          routingWork,
        });

        if (evaluations.some((row) => row.feasibility === 'invariant_violation')) {
          return failSearch(tx, searchId, 'INVARIANT_VIOLATION');
        }
        if (evaluations.some((row) => row.feasibility === 'technical_failure')) {
          return failSearch(tx, searchId, 'ROUTING_TECHNICAL_FAILURE');
        }
        if (evaluations.some((row) => row.feasibility === 'routing_incomplete')) {
          return { outcome: 'not_ready', searchId };
        }

        await tx
          .insert(meetingSearchCandidateEvaluations)
          .values(
            evaluations.map((row) => ({
              searchId,
              destinationPlaceId: row.destinationPlaceId,
              feasibility: row.feasibility,
            })),
          )
          .onConflictDoNothing();

        const feasibleCount = evaluations.filter((row) => row.feasibility === 'feasible').length;
        if (feasibleCount === 0) {
          return completeSearch(tx, searchId, 'no_feasible_candidates', null);
        }

        const ranked = rankAllModes({
          participantIds,
          candidates: candidates.map((row) => ({
            candidateId: row.destinationPlaceId,
            destinationPlaceId: row.destinationPlaceId,
            ordinal: row.ordinal,
          })),
          routingWork,
          evaluations,
        });
        if (!ranked.ok) {
          return failSearch(tx, searchId, 'INVARIANT_VIOLATION');
        }

        for (const mode of ranked.modes) {
          for (const entry of mode.rankings) {
            const [rankingRow] = await tx
              .insert(meetingSearchCandidateRankings)
              .values({
                searchId,
                rankingMode: mode.rankingMode,
                destinationPlaceId: entry.destinationPlaceId,
                rank: entry.rank,
                totalDurationMinutes: entry.totalDurationMinutes,
                maxDurationMinutes: entry.maxDurationMinutes,
                durationRangeMinutes: entry.durationRangeMinutes,
                totalTransfers: entry.totalTransfers,
                maxTransfers: entry.maxTransfers,
                earliestArrivalAt: entry.earliestArrivalAt,
                latestArrivalAt: entry.latestArrivalAt,
                arrivalSpreadMs: entry.arrivalSpreadMs,
              })
              .onConflictDoNothing()
              .returning();

            const rankingId =
              rankingRow?.id ??
              (
                await tx
                  .select({ id: meetingSearchCandidateRankings.id })
                  .from(meetingSearchCandidateRankings)
                  .where(
                    and(
                      eq(meetingSearchCandidateRankings.searchId, searchId),
                      eq(meetingSearchCandidateRankings.rankingMode, mode.rankingMode),
                      eq(
                        meetingSearchCandidateRankings.destinationPlaceId,
                        entry.destinationPlaceId,
                      ),
                    ),
                  )
                  .limit(1)
              )[0]?.id;

            if (!rankingId) {
              return failSearch(tx, searchId, 'INVARIANT_VIOLATION');
            }

            await tx
              .insert(meetingSearchCandidateRankingJourneys)
              .values(
                entry.selectedJourneys.map((selected) => ({
                  searchId,
                  rankingMode: mode.rankingMode,
                  destinationPlaceId: entry.destinationPlaceId,
                  participantId: selected.participantId,
                  journeyId: selected.journeyId,
                  rankingId,
                })),
              )
              .onConflictDoNothing();
          }
        }

        const primary = ranked.modes.find((mode) => mode.rankingMode === search.ranking_mode);
        const recommendation = primary?.rankings.find((row) => row.rank === 1)?.destinationPlaceId;
        if (!recommendation) {
          return failSearch(tx, searchId, 'INVARIANT_VIOLATION');
        }

        return completeSearch(tx, searchId, 'ranked', recommendation);
      });
    },

    async loadRankedResults(searchId) {
      // Query 1: search header
      const [header] = await db
        .select({
          id: meetingSearches.id,
          status: meetingSearches.status,
          rankingMode: meetingSearches.rankingMode,
          completionOutcome: meetingSearches.completionOutcome,
          failureCode: meetingSearches.failureCode,
          recommendedDestinationPlaceId: meetingSearches.recommendedDestinationPlaceId,
        })
        .from(meetingSearches)
        .where(eq(meetingSearches.id, searchId))
        .limit(1);

      if (!header) {
        return { kind: 'not_found' };
      }

      const status = header.status as SearchStatus;
      if (status === 'failed' || status === 'cancelled') {
        return {
          kind: 'failed',
          searchId,
          failureCode: header.failureCode,
        };
      }
      if (status !== 'completed') {
        return { kind: 'not_ready', searchId, status };
      }

      const completionOutcome = header.completionOutcome as SearchCompletionOutcome | null;
      if (!completionOutcome) {
        return {
          kind: 'failed',
          searchId,
          failureCode: 'INVARIANT_VIOLATION',
        };
      }

      // Query 2: rankings ordered by mode → rank
      const rankingRows = await db
        .select()
        .from(meetingSearchCandidateRankings)
        .where(eq(meetingSearchCandidateRankings.searchId, searchId))
        .orderBy(
          asc(meetingSearchCandidateRankings.rankingMode),
          asc(meetingSearchCandidateRankings.rank),
        );

      // Query 3: selected journeys joined with rankings so order follows persisted rank
      // (mode → rank → participant ordinal), not destination ID.
      const journeyRows = await db
        .select({
          rankingMode: meetingSearchCandidateRankingJourneys.rankingMode,
          destinationPlaceId: meetingSearchCandidateRankingJourneys.destinationPlaceId,
          rank: meetingSearchCandidateRankings.rank,
          participantId: meetingSearchCandidateRankingJourneys.participantId,
          participantDisplayName: meetingSearchParticipants.displayName,
          participantPosition: meetingSearchParticipants.position,
          originPlaceId: meetingSearchParticipants.originPlaceId,
          departureAt: meetingSearchJourneys.departureAt,
          arrivalAt: meetingSearchJourneys.arrivalAt,
          durationMinutes: meetingSearchJourneys.durationMinutes,
          transfers: meetingSearchJourneys.transfers,
          transportModes: meetingSearchJourneys.transportModes,
          legs: meetingSearchJourneys.legs,
        })
        .from(meetingSearchCandidateRankingJourneys)
        .innerJoin(
          meetingSearchCandidateRankings,
          and(
            eq(
              meetingSearchCandidateRankingJourneys.searchId,
              meetingSearchCandidateRankings.searchId,
            ),
            eq(
              meetingSearchCandidateRankingJourneys.rankingMode,
              meetingSearchCandidateRankings.rankingMode,
            ),
            eq(
              meetingSearchCandidateRankingJourneys.destinationPlaceId,
              meetingSearchCandidateRankings.destinationPlaceId,
            ),
          ),
        )
        .innerJoin(
          meetingSearchJourneys,
          eq(meetingSearchCandidateRankingJourneys.journeyId, meetingSearchJourneys.id),
        )
        .innerJoin(
          meetingSearchParticipants,
          and(
            eq(meetingSearchParticipants.meetingSearchId, searchId),
            eq(
              meetingSearchParticipants.participantId,
              meetingSearchCandidateRankingJourneys.participantId,
            ),
          ),
        )
        .where(eq(meetingSearchCandidateRankingJourneys.searchId, searchId))
        .orderBy(
          asc(meetingSearchCandidateRankings.rankingMode),
          asc(meetingSearchCandidateRankings.rank),
          asc(meetingSearchParticipants.position),
        );

      const placeIds = new Set<string>();
      if (header.recommendedDestinationPlaceId) {
        placeIds.add(header.recommendedDestinationPlaceId);
      }
      for (const row of rankingRows) {
        placeIds.add(row.destinationPlaceId);
      }
      for (const row of journeyRows) {
        placeIds.add(row.originPlaceId);
        placeIds.add(row.destinationPlaceId);
      }

      // Query 4: place names + persisted coordinates for all referenced IDs (single IN query)
      const placeById = new Map<string, { name: string; longitude: number; latitude: number }>();
      const placeIdList = [...placeIds];
      if (placeIdList.length > 0) {
        const placeRows = await db
          .select({ id: places.id, name: places.name, location: places.location })
          .from(places)
          .where(inArray(places.id, placeIdList));
        for (const place of placeRows) {
          placeById.set(place.id, {
            name: place.name,
            longitude: place.location.x,
            latitude: place.location.y,
          });
        }
      }

      const placeView = (placeId: string): PlaceViewRecord => {
        const found = placeById.get(placeId);
        return {
          placeId,
          name: found?.name ?? null,
          longitude: found?.longitude ?? null,
          latitude: found?.latitude ?? null,
        };
      };

      const journeysByKey = new Map<string, RankedParticipantJourneyRecord[]>();
      for (const row of journeyRows) {
        const key = `${row.rankingMode}\0${row.destinationPlaceId}`;
        const list = journeysByKey.get(key) ?? [];
        const legsJson = row.legs as readonly NormalizedJourneyLegJson[];
        list.push({
          participantId: row.participantId,
          participantDisplayName: row.participantDisplayName,
          participantPosition: row.participantPosition,
          origin: placeView(row.originPlaceId),
          destination: placeView(row.destinationPlaceId),
          departureAt: row.departureAt,
          arrivalAt: row.arrivalAt,
          durationMinutes: row.durationMinutes,
          transfers: row.transfers,
          transportModes: [...row.transportModes],
          legs: legsJson.map((leg) => ({
            mode: leg.mode,
            departureAt: new Date(leg.departureAt),
            arrivalAt: new Date(leg.arrivalAt),
            durationMinutes: leg.durationMinutes,
            geometry: leg.geometry
              ? {
                  points: leg.geometry.points,
                  precision: leg.geometry.precision,
                  length: leg.geometry.length,
                }
              : null,
          })),
        });
        journeysByKey.set(key, list);
      }

      // Re-sort journeys by participant position within each candidate (defensive).
      for (const [key, list] of journeysByKey) {
        journeysByKey.set(
          key,
          [...list].sort((a, b) => a.participantPosition - b.participantPosition),
        );
      }

      const rankings: RankedCandidateRecord[] = rankingRows.map((row) => {
        const key = `${row.rankingMode}\0${row.destinationPlaceId}`;
        return {
          rankingMode: row.rankingMode as RankingMode,
          rank: row.rank,
          destination: placeView(row.destinationPlaceId),
          recommended:
            header.recommendedDestinationPlaceId === row.destinationPlaceId &&
            row.rankingMode === header.rankingMode,
          totalDurationMinutes: row.totalDurationMinutes,
          maxDurationMinutes: row.maxDurationMinutes,
          durationRangeMinutes: row.durationRangeMinutes,
          totalTransfers: row.totalTransfers,
          maxTransfers: row.maxTransfers,
          earliestArrivalAt: row.earliestArrivalAt,
          latestArrivalAt: row.latestArrivalAt,
          arrivalSpreadMs: row.arrivalSpreadMs,
          journeys: journeysByKey.get(key) ?? [],
        };
      });

      // Public deterministic mode order follows RANKING_MODES, then persisted rank.
      const modeOrder = new Map(RANKING_MODES.map((mode, index) => [mode, index]));
      rankings.sort((a, b) => {
        const modeCmp =
          (modeOrder.get(a.rankingMode) ?? Number.MAX_SAFE_INTEGER) -
          (modeOrder.get(b.rankingMode) ?? Number.MAX_SAFE_INTEGER);
        if (modeCmp !== 0) {
          return modeCmp;
        }
        return a.rank - b.rank;
      });

      return {
        kind: 'completed',
        searchId,
        completionOutcome,
        rankingMode: header.rankingMode as RankingMode,
        recommendedDestination: header.recommendedDestinationPlaceId
          ? placeView(header.recommendedDestinationPlaceId)
          : null,
        rankings,
        queryCount: placeIdList.length > 0 ? 4 : 3,
      };
    },

    async listCandidateEvaluations(searchId) {
      const rows = await db
        .select()
        .from(meetingSearchCandidateEvaluations)
        .where(eq(meetingSearchCandidateEvaluations.searchId, searchId));
      return rows.map((row) => ({
        destinationPlaceId: row.destinationPlaceId,
        feasibility: assertFeasibility(row.feasibility),
      }));
    },

    async listCandidateRankings(searchId) {
      const rows = await db
        .select()
        .from(meetingSearchCandidateRankings)
        .where(eq(meetingSearchCandidateRankings.searchId, searchId))
        .orderBy(
          asc(meetingSearchCandidateRankings.rankingMode),
          asc(meetingSearchCandidateRankings.rank),
        );
      return rows.map((row) => ({
        rankingMode: row.rankingMode,
        destinationPlaceId: row.destinationPlaceId,
        rank: row.rank,
        totalDurationMinutes: row.totalDurationMinutes,
        maxDurationMinutes: row.maxDurationMinutes,
        durationRangeMinutes: row.durationRangeMinutes,
        totalTransfers: row.totalTransfers,
        maxTransfers: row.maxTransfers,
        earliestArrivalAt: row.earliestArrivalAt,
        latestArrivalAt: row.latestArrivalAt,
        arrivalSpreadMs: row.arrivalSpreadMs,
      }));
    },

    async listRankingJourneys(searchId) {
      const rows = await db
        .select()
        .from(meetingSearchCandidateRankingJourneys)
        .where(eq(meetingSearchCandidateRankingJourneys.searchId, searchId));
      return rows.map((row) => ({
        rankingMode: row.rankingMode,
        destinationPlaceId: row.destinationPlaceId,
        participantId: row.participantId,
        journeyId: row.journeyId,
      }));
    },
  };
}

async function failSearch(
  tx: Db,
  searchId: string,
  failureCode: string,
): Promise<FinalizeMeetingSearchResult> {
  const updated = await tx
    .update(meetingSearches)
    .set({
      status: 'failed',
      failedAt: sql`coalesce(${meetingSearches.failedAt}, now())`,
      failureCode,
      completionOutcome: null,
      completedAt: null,
      recommendedDestinationPlaceId: null,
      updatedAt: sql`now()`,
    })
    .where(and(eq(meetingSearches.id, searchId), eq(meetingSearches.status, 'running')))
    .returning({ id: meetingSearches.id });

  if (updated.length === 0) {
    const [current] = await tx
      .select({ status: meetingSearches.status })
      .from(meetingSearches)
      .where(eq(meetingSearches.id, searchId))
      .limit(1);
    if (!current) {
      return { outcome: 'not_found', searchId };
    }
    return {
      outcome: 'already_terminal',
      searchId,
      status: current.status as SearchStatus,
    };
  }

  return { outcome: 'failed', searchId, failureCode };
}

async function completeSearch(
  tx: Db,
  searchId: string,
  completionOutcome: SearchCompletionOutcome,
  recommendedDestinationPlaceId: string | null,
): Promise<FinalizeMeetingSearchResult> {
  const updated = await tx
    .update(meetingSearches)
    .set({
      status: 'completed',
      completedAt: sql`coalesce(${meetingSearches.completedAt}, now())`,
      completionOutcome,
      recommendedDestinationPlaceId,
      failedAt: null,
      failureCode: null,
      updatedAt: sql`now()`,
    })
    .where(and(eq(meetingSearches.id, searchId), eq(meetingSearches.status, 'running')))
    .returning({ id: meetingSearches.id });

  if (updated.length === 0) {
    const [current] = await tx
      .select({ status: meetingSearches.status })
      .from(meetingSearches)
      .where(eq(meetingSearches.id, searchId))
      .limit(1);
    if (!current) {
      return { outcome: 'not_found', searchId };
    }
    return {
      outcome: 'already_terminal',
      status: current.status as SearchStatus,
      searchId,
    };
  }

  return {
    outcome: 'completed',
    searchId,
    completionOutcome,
    recommendedDestinationPlaceId,
  };
}
