/**
 * Framework-independent candidate pruning, scoring, and ranking helpers.
 * Must not import Fastify, Next.js, BullMQ, Redis, or Drizzle.
 */

export const SEARCH_ENGINE_PACKAGE = '@railmeet/search-engine' as const;

export { assignCandidateOrdinals, type RankedCityCandidate } from './candidates.js';
export { wallTimeInZoneToUtc } from './wall-time.js';
