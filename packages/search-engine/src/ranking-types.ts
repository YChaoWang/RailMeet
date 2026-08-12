import type { RankingMode } from '@railmeet/shared';

export type FeasibilityReason =
  | 'feasible'
  | 'participant_no_journeys'
  | 'routing_incomplete'
  | 'technical_failure'
  | 'invariant_violation';

export type RankingJourneyInput = {
  readonly journeyId: string;
  readonly participantId: string;
  readonly destinationPlaceId: string;
  readonly durationMinutes: number;
  readonly transfers: number;
  readonly departureAt: Date;
  readonly arrivalAt: Date;
};

export type RankingRoutingWorkInput = {
  readonly routingWorkId: string;
  readonly participantId: string;
  readonly destinationPlaceId: string;
  readonly status: 'pending' | 'running' | 'succeeded' | 'no_journeys' | 'exhausted';
  readonly journeys: readonly RankingJourneyInput[];
};

export type RankingCandidateInput = {
  /**
   * Stable candidate identity used for final ranking tie-breaks.
   * In persistence this equals `destination_place_id` (candidates PK),
   * but ranking compares `candidateId` explicitly — never a substitute field.
   */
  readonly candidateId: string;
  readonly destinationPlaceId: string;
  readonly ordinal: number;
};

export type CandidateEvaluationResult = {
  readonly destinationPlaceId: string;
  readonly feasibility: FeasibilityReason;
};

export type SelectedParticipantJourney = {
  readonly participantId: string;
  readonly journeyId: string;
  readonly durationMinutes: number;
  readonly transfers: number;
  readonly departureAt: Date;
  readonly arrivalAt: Date;
};

export type RankedCandidateMetrics = {
  readonly candidateId: string;
  readonly destinationPlaceId: string;
  readonly ordinal: number;
  readonly rank: number;
  readonly totalDurationMinutes: number;
  readonly maxDurationMinutes: number;
  readonly durationRangeMinutes: number;
  readonly totalTransfers: number;
  readonly maxTransfers: number;
  readonly earliestArrivalAt: Date;
  readonly latestArrivalAt: Date;
  readonly arrivalSpreadMs: number;
  /** max(0, arrivalSpreadMs − ARRIVAL_TOLERANCE_MS); Arrive-together primary key. */
  readonly arrivalPenaltyMs: number;
  readonly selectedJourneys: readonly SelectedParticipantJourney[];
};

export type ModeRankingResult = {
  readonly rankingMode: RankingMode;
  readonly rankings: readonly RankedCandidateMetrics[];
};

export type RankingComputationResult =
  | { readonly ok: true; readonly modes: readonly ModeRankingResult[] }
  | { readonly ok: false; readonly code: 'RANKING_INPUT_INVALID'; readonly message: string };

export const ALL_RANKING_MODES: readonly RankingMode[] = [
  'fairest',
  'fastest-overall',
  'fewest-transfers',
  'arrive-together',
] as const;
