import type { Participant } from './participant.js';
import type { RankingMode } from './ranking-mode.js';
import type { SearchConstraints } from './search-constraints.js';

/**
 * Domain representation of a meeting-search request.
 *
 * This is an internal domain concept used by application and search logic.
 * HTTP boundary payloads are validated separately in `@railmeet/validation`
 * and inferred as DTO types from Zod schemas — they are not required to be
 * identical to this type.
 */
export type SearchRequest = {
  readonly participants: readonly Participant[];
  readonly constraints: SearchConstraints;
  readonly rankingMode: RankingMode;
};
