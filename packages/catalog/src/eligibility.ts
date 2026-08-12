/**
 * Versioned meeting-city eligibility (distinct from GeoNames import).
 *
 * Imported GeoNames city ≠ active RailMeet meeting city ≠ routable meeting city.
 *
 * Policy `meeting-city-v2` (2026-08-09):
 * - Scope: EUROPE_ISO_COUNTRY_CODES
 * - Tier A: GeoNames capitals (PPLC) — national meeting relevance
 * - Tier B: admin seats PPLA / PPLA2 — regional meeting relevance
 * - Tier C: population ≥ MEETING_CITY_MIN_POPULATION — justified as intercity
 *   meeting density; NOT a GeoNames rule (cities15000 already uses 15_000)
 * - Routable: must also have an active authoritative primary hub
 *
 * Cities that are imported but fail this policy remain in the catalog for
 * provenance; they must not enter production candidate generation.
 */
export const MEETING_CITY_POLICY_VERSION = 'meeting-city-v2';

/**
 * Minimum population for non-admin GeoNames places to become meeting candidates.
 * Chosen for same-day European meet-ups: below this, places are typically
 * suburbs/towns that flood nearest-city discovery without suitable hubs.
 */
export const MEETING_CITY_MIN_POPULATION = 100_000;

/** Admin / capital feature codes that are eligible regardless of the population floor. */
export const MEETING_CITY_ADMIN_FEATURE_CODES = ['PPLC', 'PPLA', 'PPLA2'] as const;

export type MeetingCityEligibilityInput = {
  readonly countryCode: string;
  readonly featureClass?: string | null;
  readonly featureCode?: string | null;
  readonly population?: number | null;
  readonly hasAuthoritativePrimaryHub?: boolean;
};

export type MeetingCityTier = 'admin-capital' | 'admin-seat' | 'population' | 'ineligible';

export function classifyMeetingCityTier(input: MeetingCityEligibilityInput): MeetingCityTier {
  const code = (input.featureCode ?? '').toUpperCase();
  if (code === 'PPLC') {
    return 'admin-capital';
  }
  if (code === 'PPLA' || code === 'PPLA2') {
    return 'admin-seat';
  }
  if ((input.population ?? 0) >= MEETING_CITY_MIN_POPULATION) {
    return 'population';
  }
  return 'ineligible';
}

/**
 * Structural eligibility (tier) — does not require a hub yet.
 */
export function isMeetingCityTierEligible(input: MeetingCityEligibilityInput): boolean {
  if (input.featureClass && input.featureClass !== 'P') {
    return false;
  }
  return classifyMeetingCityTier(input) !== 'ineligible';
}

/**
 * Production candidate eligibility: tier + authoritative primary hub.
 */
export function isProductionMeetingCityCandidate(input: MeetingCityEligibilityInput): boolean {
  return isMeetingCityTierEligible(input) && Boolean(input.hasAuthoritativePrimaryHub);
}
