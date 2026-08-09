/**
 * Terminal completion outcomes persisted on meeting_searches.completion_outcome.
 */
export const SEARCH_COMPLETION_OUTCOMES = [
  'no_candidates',
  'ranked',
  'no_feasible_candidates',
] as const;

export type SearchCompletionOutcome = (typeof SEARCH_COMPLETION_OUTCOMES)[number];

export function isSearchCompletionOutcome(value: string): value is SearchCompletionOutcome {
  return (SEARCH_COMPLETION_OUTCOMES as readonly string[]).includes(value);
}

/**
 * Sanitized search failure codes persisted on meeting_searches.failure_code.
 * Safe for clients; never include stack traces or SQL.
 */
export const SEARCH_FAILURE_CODES = [
  'INVARIANT_VIOLATION',
  'CANDIDATE_GENERATION_FAILED',
  'ROUTING_TECHNICAL_FAILURE',
] as const;

export type SearchFailureCode = (typeof SEARCH_FAILURE_CODES)[number];

export function isSearchFailureCode(value: string): value is SearchFailureCode {
  return (SEARCH_FAILURE_CODES as readonly string[]).includes(value);
}
