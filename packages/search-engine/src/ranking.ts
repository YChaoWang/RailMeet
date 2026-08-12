import type { RankingMode } from '@railmeet/shared';
import { ARRIVAL_TOLERANCE_MS } from '@railmeet/shared';

import { evaluateCandidateFeasibility } from './feasibility.js';
import {
  RankingInputError,
  compareBinaryStrings,
  selectArriveTogetherJourneys,
  selectFastestJourneys,
  selectFewestTransferJourneys,
} from './journey-selection.js';
import {
  ALL_RANKING_MODES,
  type CandidateEvaluationResult,
  type ModeRankingResult,
  type RankedCandidateMetrics,
  type RankingCandidateInput,
  type RankingComputationResult,
  type RankingJourneyInput,
  type RankingRoutingWorkInput,
  type SelectedParticipantJourney,
} from './ranking-types.js';

export type RankCandidatesInput = {
  readonly participantIds: readonly string[];
  readonly candidates: readonly RankingCandidateInput[];
  readonly routingWork: readonly RankingRoutingWorkInput[];
  /** Only feasible candidates are ranked; evaluations may be precomputed. */
  readonly evaluations?: readonly CandidateEvaluationResult[];
};

function metricsFromSelection(
  candidate: RankingCandidateInput,
  selected: readonly SelectedParticipantJourney[],
  rank: number,
): RankedCandidateMetrics {
  const durations = selected.map((j) => j.durationMinutes);
  const transfers = selected.map((j) => j.transfers);
  const arrivals = selected.map((j) => j.arrivalAt.getTime());
  const earliestArrivalAt = new Date(Math.min(...arrivals));
  const latestArrivalAt = new Date(Math.max(...arrivals));
  const arrivalSpreadMs = latestArrivalAt.getTime() - earliestArrivalAt.getTime();
  return {
    candidateId: candidate.candidateId,
    destinationPlaceId: candidate.destinationPlaceId,
    ordinal: candidate.ordinal,
    rank,
    totalDurationMinutes: durations.reduce((sum, value) => sum + value, 0),
    maxDurationMinutes: Math.max(...durations),
    durationRangeMinutes: Math.max(...durations) - Math.min(...durations),
    totalTransfers: transfers.reduce((sum, value) => sum + value, 0),
    maxTransfers: Math.max(...transfers),
    earliestArrivalAt,
    latestArrivalAt,
    arrivalSpreadMs,
    arrivalPenaltyMs: Math.max(0, arrivalSpreadMs - ARRIVAL_TOLERANCE_MS),
    selectedJourneys: [...selected].sort((a, b) =>
      compareBinaryStrings(a.participantId, b.participantId),
    ),
  };
}

function journeysForCandidate(
  work: readonly RankingRoutingWorkInput[],
  destinationPlaceId: string,
  participantIds: readonly string[],
): Map<string, readonly RankingJourneyInput[]> {
  const map = new Map<string, readonly RankingJourneyInput[]>();
  for (const participantId of participantIds) {
    const row = work.find(
      (entry) =>
        entry.destinationPlaceId === destinationPlaceId && entry.participantId === participantId,
    );
    if (!row || row.status !== 'succeeded') {
      throw new RankingInputError(
        `Missing succeeded routing work for ${participantId} → ${destinationPlaceId}`,
      );
    }
    for (const journey of row.journeys) {
      if (journey.destinationPlaceId !== destinationPlaceId) {
        throw new RankingInputError(`Journey ${journey.journeyId} has wrong destination`);
      }
      if (journey.participantId !== participantId) {
        throw new RankingInputError(`Journey ${journey.journeyId} has wrong participant`);
      }
    }
    map.set(participantId, row.journeys);
  }
  return map;
}

function selectForMode(
  mode: RankingMode,
  journeysByParticipant: ReadonlyMap<string, readonly RankingJourneyInput[]>,
): readonly SelectedParticipantJourney[] {
  if (mode === 'fewest-transfers') {
    return selectFewestTransferJourneys(journeysByParticipant);
  }
  if (mode === 'arrive-together') {
    return selectArriveTogetherJourneys(journeysByParticipant);
  }
  // fairest and fastest-overall use the same per-participant fastest journey pick
  return selectFastestJourneys(journeysByParticipant);
}

function compareCandidates(
  mode: RankingMode,
  a: RankedCandidateMetrics,
  b: RankedCandidateMetrics,
): number {
  if (mode === 'fastest-overall') {
    return (
      a.totalDurationMinutes - b.totalDurationMinutes ||
      a.maxDurationMinutes - b.maxDurationMinutes ||
      a.totalTransfers - b.totalTransfers ||
      a.arrivalSpreadMs - b.arrivalSpreadMs ||
      a.ordinal - b.ordinal ||
      compareBinaryStrings(a.candidateId, b.candidateId)
    );
  }
  if (mode === 'fairest') {
    return (
      a.maxDurationMinutes - b.maxDurationMinutes ||
      a.durationRangeMinutes - b.durationRangeMinutes ||
      a.totalDurationMinutes - b.totalDurationMinutes ||
      a.totalTransfers - b.totalTransfers ||
      a.arrivalSpreadMs - b.arrivalSpreadMs ||
      a.ordinal - b.ordinal ||
      compareBinaryStrings(a.candidateId, b.candidateId)
    );
  }
  if (mode === 'fewest-transfers') {
    return (
      a.totalTransfers - b.totalTransfers ||
      a.maxTransfers - b.maxTransfers ||
      a.totalDurationMinutes - b.totalDurationMinutes ||
      a.maxDurationMinutes - b.maxDurationMinutes ||
      a.ordinal - b.ordinal ||
      compareBinaryStrings(a.candidateId, b.candidateId)
    );
  }
  // arrive-together (tolerance-aware)
  return (
    a.arrivalPenaltyMs - b.arrivalPenaltyMs ||
    a.maxDurationMinutes - b.maxDurationMinutes ||
    a.totalDurationMinutes - b.totalDurationMinutes ||
    a.totalTransfers - b.totalTransfers ||
    a.arrivalSpreadMs - b.arrivalSpreadMs ||
    a.latestArrivalAt.getTime() - b.latestArrivalAt.getTime() ||
    a.ordinal - b.ordinal ||
    compareBinaryStrings(a.candidateId, b.candidateId)
  );
}

/**
 * Rank all feasible candidates for every supported ranking mode.
 * Infeasible candidates are excluded. Ranks are unique sequential 1..N.
 */
export function rankAllModes(input: RankCandidatesInput): RankingComputationResult {
  try {
    const evaluations =
      input.evaluations ??
      evaluateCandidateFeasibility({
        participantIds: input.participantIds,
        candidates: input.candidates,
        routingWork: input.routingWork,
      });
    const feasibleIds = new Set(
      evaluations
        .filter((row) => row.feasibility === 'feasible')
        .map((row) => row.destinationPlaceId),
    );
    const feasibleCandidates = [...input.candidates]
      .filter((candidate) => feasibleIds.has(candidate.destinationPlaceId))
      .sort((a, b) => a.ordinal - b.ordinal || compareBinaryStrings(a.candidateId, b.candidateId));

    const modes: ModeRankingResult[] = [];
    for (const rankingMode of ALL_RANKING_MODES) {
      const scored: RankedCandidateMetrics[] = feasibleCandidates.map((candidate) => {
        const journeysByParticipant = journeysForCandidate(
          input.routingWork,
          candidate.destinationPlaceId,
          input.participantIds,
        );
        const selected = selectForMode(rankingMode, journeysByParticipant);
        return metricsFromSelection(candidate, selected, 0);
      });
      scored.sort((a, b) => compareCandidates(rankingMode, a, b));
      const rankings = scored.map((row, index) => ({ ...row, rank: index + 1 }));
      modes.push({ rankingMode, rankings });
    }

    return { ok: true, modes };
  } catch (error) {
    if (error instanceof RankingInputError) {
      return { ok: false, code: error.code, message: error.message };
    }
    throw error;
  }
}
