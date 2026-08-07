/**
 * Asynchronous meeting-search lifecycle statuses.
 *
 * Meanings (state machine enforcement is deferred):
 * - `queued`: Accepted and waiting for a worker.
 * - `running`: Worker is actively evaluating candidates.
 * - `partially-completed`: Some candidates evaluated; usable partial results exist
 *   while work may still continue or stop early due to partial provider failure.
 * - `completed`: Finished successfully with a final ranking.
 * - `failed`: Terminal failure with no usable result set.
 * - `cancelling`: Cancellation requested; worker has not finished tearing down yet.
 * - `cancelled`: Terminal cancellation.
 */
export const SEARCH_STATUSES = [
  'queued',
  'running',
  'partially-completed',
  'completed',
  'failed',
  'cancelling',
  'cancelled',
] as const;

export type SearchStatus = (typeof SEARCH_STATUSES)[number];

export function isSearchStatus(value: string): value is SearchStatus {
  return (SEARCH_STATUSES as readonly string[]).includes(value);
}
