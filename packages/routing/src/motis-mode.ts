import { TRANSPORT_MODES, isTransportMode, type TransportMode } from '@railmeet/shared';

import type { JourneyLeg, JourneyLegMode } from './types.js';

/**
 * Canonical MOTIS / Transitous mode tokens → RailMeet domain modes.
 * Structured mode strings only — never display-name inference.
 * Keep in sync with map/stops rail-family handling.
 */
const MOTIS_MODE_ALIASES: Readonly<Record<string, JourneyLegMode>> = {
  walk: 'walk',
  foot: 'walk',
  rail: 'train',
  train: 'train',
  intercity: 'train',
  highspeed_rail: 'train',
  high_speed_rail: 'train',
  long_distance: 'train',
  night_rail: 'train',
  regional_rail: 'train',
  regional_fast_rail: 'train',
  suburban: 'train',
  subway: 'metro',
  metro: 'metro',
  tram: 'tram',
  // MOTIS light rail is tram-like for RailMeet domain vocabulary.
  light_rail: 'tram',
  lightrail: 'tram',
  bus: 'bus',
  coach: 'bus',
  ferry: 'ferry',
  boat: 'ferry',
};

/** Canonical journey-level transport mode order (deterministic, locale-independent). */
export const JOURNEY_TRANSPORT_MODE_ORDER: readonly TransportMode[] = TRANSPORT_MODES;

/**
 * Map a raw MOTIS leg mode token to a domain leg mode.
 * Unknown structured values become `other` (never silently treated as train).
 */
export function mapMotisLegMode(rawMode: string): JourneyLegMode {
  const normalized = rawMode
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  const mapped = MOTIS_MODE_ALIASES[normalized];
  if (mapped) {
    return mapped;
  }
  return 'other';
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
 * True when the itinerary has a non-walk leg that did not map to a domain transport mode.
 */
export function hasUnmappedTransitLegs(legs: readonly Pick<JourneyLeg, 'mode'>[]): boolean {
  return legs.some((leg) => leg.mode === 'other');
}
