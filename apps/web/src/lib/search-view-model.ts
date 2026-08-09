import type { MeetingSearchDetailData, MeetingSearchResultsData } from '@railmeet/validation';
import type { RankingMode, SearchStatus } from '@railmeet/shared';
import { shouldContinueSearchPolling, shouldFetchSearchResults } from '@railmeet/shared';

export const RANKING_MODE_LABELS: Record<RankingMode, { title: string; description: string }> = {
  fairest: {
    title: 'Fairest',
    description: 'Balances travel effort across everyone.',
  },
  'fastest-overall': {
    title: 'Fastest overall',
    description: 'Minimizes the group’s combined travel time.',
  },
  'fewest-transfers': {
    title: 'Fewest transfers',
    description: 'Reduces the group’s total number of changes.',
  },
  'arrive-together': {
    title: 'Arrive together',
    description: 'Minimizes the difference between arrival times.',
  },
};

export type SearchPageViewState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'malformed_id' }
  | { readonly kind: 'not_found' }
  | {
      readonly kind: 'queued' | 'running' | 'partially_completed' | 'cancelling';
      readonly summary: MeetingSearchDetailData;
    }
  | {
      readonly kind: 'completed';
      readonly summary: MeetingSearchDetailData;
      readonly results: MeetingSearchResultsData | null;
      readonly resultsLoading: boolean;
    }
  | {
      readonly kind: 'failed';
      readonly summary: MeetingSearchDetailData;
    }
  | {
      readonly kind: 'cancelled';
      readonly summary: MeetingSearchDetailData;
    }
  | {
      readonly kind: 'network_error';
      readonly summary: MeetingSearchDetailData | null;
      readonly message: string;
    };

export type SummaryPollDecision =
  | {
      readonly action: 'poll';
      readonly viewKind: 'queued' | 'running' | 'partially_completed' | 'cancelling';
    }
  | { readonly action: 'fetch_results' }
  | { readonly action: 'stop_failed' }
  | { readonly action: 'stop_cancelled' };

/** Exhaustive Phase 9 summary → polling/results decision. */
export function decideSummaryPollAction(status: SearchStatus): SummaryPollDecision {
  switch (status) {
    case 'queued':
      return { action: 'poll', viewKind: 'queued' };
    case 'running':
      return { action: 'poll', viewKind: 'running' };
    case 'partially-completed':
      return { action: 'poll', viewKind: 'partially_completed' };
    case 'cancelling':
      return { action: 'poll', viewKind: 'cancelling' };
    case 'completed':
      return { action: 'fetch_results' };
    case 'failed':
      return { action: 'stop_failed' };
    case 'cancelled':
      return { action: 'stop_cancelled' };
    default: {
      const _exhaustive: never = status;
      return _exhaustive;
    }
  }
}

export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function formatDurationMinutes(total: number): string {
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  if (hours === 0) {
    return `${minutes} min`;
  }
  if (minutes === 0) {
    return `${hours} h`;
  }
  return `${hours} h ${minutes} min`;
}

export function formatArrivalSpreadMs(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  return `${minutes} min`;
}

export function failureMessage(code: string | null | undefined): string {
  switch (code) {
    case 'ROUTING_TECHNICAL_FAILURE':
      return 'Journey planning could not finish for every traveler.';
    case 'CANDIDATE_GENERATION_FAILED':
      return 'RailMeet could not build a set of meeting cities for this search.';
    case 'INVARIANT_VIOLATION':
      return 'The search reached an inconsistent state and was stopped safely.';
    default:
      return 'Something prevented RailMeet from finishing the comparison.';
  }
}

export function emptyOutcomeMessage(
  outcome: MeetingSearchResultsData['completionOutcome'],
): string {
  switch (outcome) {
    case 'no_candidates':
      return 'No meeting cities were generated for this search under the current conditions.';
    case 'no_feasible_candidates':
      return 'No destination had valid journeys for every traveler under the current conditions.';
    case 'ranked':
      return 'No destination had valid journeys for every traveler under the current conditions.';
    default: {
      const _exhaustive: never = outcome;
      return _exhaustive;
    }
  }
}

/** Preserve API order — never re-sort candidates on the client. */
export function rankingsForMode(
  results: MeetingSearchResultsData,
  mode: RankingMode,
): MeetingSearchResultsData['rankings'] {
  return results.rankings.filter((row) => row.rankingMode === mode);
}

export function assertLifecycleHelpersAligned(): void {
  // Guard rails for view-model vs shared helpers.
  const statuses: SearchStatus[] = [
    'queued',
    'running',
    'partially-completed',
    'completed',
    'failed',
    'cancelling',
    'cancelled',
  ];
  for (const status of statuses) {
    const decision = decideSummaryPollAction(status);
    if (decision.action === 'poll') {
      if (!shouldContinueSearchPolling(status) || shouldFetchSearchResults(status)) {
        throw new Error(`Poll decision mismatch for ${status}`);
      }
    } else if (decision.action === 'fetch_results') {
      if (!shouldFetchSearchResults(status) || shouldContinueSearchPolling(status)) {
        throw new Error(`Fetch-results decision mismatch for ${status}`);
      }
    } else if (shouldContinueSearchPolling(status) || shouldFetchSearchResults(status)) {
      throw new Error(`Stop decision mismatch for ${status}`);
    }
  }
}
