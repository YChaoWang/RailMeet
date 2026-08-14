/**
 * Canonical MOTIS / Transitous mode tokens → RailMeet domain modes.
 * Structured mode strings only — never display-name inference.
 * Keep in sync with map/stops rail-family handling.
 *
 * Precise MOTIS subtypes (HIGHSPEED_RAIL, SUBURBAN, …) stay on the leg as
 * `motisMode`; this mapper only produces the coarse ranking/filter mode.
 */
import {
  canonicalMotisModeToken,
  isMotisPlanMode,
  mapMotisPlanModeToDomain,
  TRANSPORT_MODES,
  isTransportMode,
  type JourneyLegMode,
  type TransportMode,
} from '@railmeet/shared';

import type { JourneyLeg } from './types.js';

/** Canonical journey-level transport mode order (deterministic, locale-independent). */
export const JOURNEY_TRANSPORT_MODE_ORDER: readonly TransportMode[] = TRANSPORT_MODES;

/**
 * Map a raw MOTIS leg mode token to a domain leg mode.
 * Unknown structured values become `other` (never silently treated as train).
 */
export function mapMotisLegMode(rawMode: string): JourneyLegMode {
  return mapMotisPlanModeToDomain(rawMode);
}

export function canonicalMotisLegMode(rawMode: string): string {
  return canonicalMotisModeToken(rawMode);
}

/**
 * Deterministic, deduplicated transit modes for a journey.
 * Walk and unmapped (`other`) legs are excluded from the summary.
 */
export function collectJourneyTransportModes(
  legs: readonly Pick<JourneyLeg, 'mode'>[],
): readonly TransportMode[] {
  const present = new Set<TransportMode>();
  for (const leg of legs) {
    if (isTransportMode(leg.mode)) {
      present.add(leg.mode);
    }
  }
  return JOURNEY_TRANSPORT_MODE_ORDER.filter((mode) => present.has(mode));
}

/**
 * True when a non-walk leg used a token that is not in the pinned MOTIS v5 enum.
 * Known MOTIS modes that are coarse-`other` (airplane, rental, …) are not unmapped.
 */
export function hasUnmappedTransitLegs(
  legs: readonly { readonly mode: JourneyLeg['mode']; readonly motisMode?: string }[],
): boolean {
  return legs.some((leg) => {
    if (leg.mode !== 'other') {
      return false;
    }
    if (!leg.motisMode) {
      return true;
    }
    return !isMotisPlanMode(leg.motisMode);
  });
}
