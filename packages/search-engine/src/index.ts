/**
 * Framework-independent candidate pruning, scoring, and ranking helpers.
 * Must not import Fastify, Next.js, BullMQ, Redis, or Drizzle.
 */

export const SEARCH_ENGINE_PACKAGE = '@railmeet/search-engine' as const;

export { assignCandidateOrdinals, type RankedCityCandidate } from './candidates.js';
export { wallTimeInZoneToUtc } from './wall-time.js';
export { evaluateCandidateFeasibility, type EvaluateFeasibilityInput } from './feasibility.js';
export {
  RankingInputError,
  assertValidJourney,
  compareBinaryStrings,
  compareJourneyIdTuples,
  selectArriveTogetherJourneys,
  selectFastestJourneys,
  selectFewestTransferJourneys,
} from './journey-selection.js';
export { rankAllModes, type RankCandidatesInput } from './ranking.js';
export {
  ALL_RANKING_MODES,
  type CandidateEvaluationResult,
  type FeasibilityReason,
  type ModeRankingResult,
  type RankedCandidateMetrics,
  type RankingCandidateInput,
  type RankingComputationResult,
  type RankingJourneyInput,
  type RankingRoutingWorkInput,
  type SelectedParticipantJourney,
} from './ranking-types.js';
