/**
 * Pure helpers for Phase 7 candidate generation.
 * Geographic selection runs in PostgreSQL/PostGIS; these helpers stabilize ordering.
 */

export type RankedCityCandidate = {
  readonly placeId: string;
  readonly distanceMeters: number;
};

/**
 * Apply deterministic ordinals after a distance-ordered PostGIS query.
 * Stable tie-break is already encoded as `ORDER BY distance, id ASC` in SQL;
 * this helper only maps rows to ordinals and validates limit bounds for tests.
 */
export function assignCandidateOrdinals(
  cities: readonly RankedCityCandidate[],
  limit: number,
): readonly (RankedCityCandidate & { readonly ordinal: number })[] {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error('candidate limit must be a positive integer');
  }
  return cities.slice(0, limit).map((city, ordinal) => ({
    ...city,
    ordinal,
  }));
}
