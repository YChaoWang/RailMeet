import type { SearchStatus } from './search-status.js';
import { SEARCH_STATUSES } from './search-status.js';

/**
 * Terminal meeting-search statuses for Phase 9 polling.
 *
 * Evidence:
 * - Phase 8 finalization writes only `completed` or `failed`.
 * - `cancelled` is documented as terminal cancellation.
 * - Kickoff treats `cancelled` as already_terminal (no re-start).
 *
 * `cancelling` is transitional (docs) even though kickoff refuses to re-start it.
 * `partially-completed` is reserved for future partial publication; kickoff refuses
 * re-start, but Phase 8 does not emit it and results are only readable for `completed`.
 */
export const TERMINAL_SEARCH_STATUSES = ['completed', 'failed', 'cancelled'] as const;

export type TerminalSearchStatus = (typeof TERMINAL_SEARCH_STATUSES)[number];

/** Statuses that should keep polling the summary endpoint. */
export const POLLING_SEARCH_STATUSES = [
  'queued',
  'running',
  'partially-completed',
  'cancelling',
] as const;

export type PollingSearchStatus = (typeof POLLING_SEARCH_STATUSES)[number];

export function isTerminalSearchStatus(status: SearchStatus): boolean {
  return (TERMINAL_SEARCH_STATUSES as readonly string[]).includes(status);
}

export function shouldContinueSearchPolling(status: SearchStatus): boolean {
  return (POLLING_SEARCH_STATUSES as readonly string[]).includes(status);
}

/** Phase 8 persisted rankings are only exposed for completed searches. */
export function shouldFetchSearchResults(status: SearchStatus): boolean {
  return status === 'completed';
}

/**
 * Exhaustive compile-time check: every SearchStatus must be classified.
 * Adding a status without updating the maps fails typecheck.
 */
export function assertSearchStatusLifecycleCoverage(): void {
  const classified = new Set<string>([...TERMINAL_SEARCH_STATUSES, ...POLLING_SEARCH_STATUSES]);
  for (const status of SEARCH_STATUSES) {
    if (!classified.has(status)) {
      throw new Error(`Unclassified search status: ${status}`);
    }
  }
  if (classified.size !== SEARCH_STATUSES.length) {
    throw new Error('Lifecycle classification must cover each SearchStatus exactly once');
  }
}
