/**
 * Ranking modes for meeting-city results.
 *
 * Scoring and sorting are implemented later in `@railmeet/search-engine`.
 * These values are stable machine-readable identifiers only.
 */
export const RANKING_MODES = [
  /** Minimize the longest individual journey (fairness). */
  'fairest',
  /** Minimize total travel time across all participants. */
  'fastest-overall',
  /** Minimize total transfer count across all participants. */
  'fewest-transfers',
  /** Minimize the arrival-time spread among participants. */
  'arrive-together',
] as const;

export type RankingMode = (typeof RANKING_MODES)[number];

export function isRankingMode(value: string): value is RankingMode {
  return (RANKING_MODES as readonly string[]).includes(value);
}
