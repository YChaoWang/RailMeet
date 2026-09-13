/**
 * Transitous plan tokens → RailMeet filter modes.
 * Structured mode strings only — never display-name inference.
 */
import {
  canonicalMotisModeToken,
  isMotisPlanMode,
  mapMotisPlanModeToDomain,
  TRANSPORT_MODES,
  type JourneyLegMode,
  type TransportMode,
} from '@railmeet/shared';

import type { JourneyLeg } from './types.js';

const TRANSPORT_MODE_SET: ReadonlySet<string> = new Set(TRANSPORT_MODES);

function isJourneyTransportMode(value: string): value is TransportMode {
  return TRANSPORT_MODE_SET.has(value);
}

export function mapMotisLegMode(rawMode: string): JourneyLegMode {
  return mapMotisPlanModeToDomain(rawMode);
}

export function canonicalMotisLegMode(rawMode: string): string {
  return canonicalMotisModeToken(rawMode);
}

/** Deduplicated transit modes for a journey, in filter order. Walk and unmapped are omitted. */
export function collectJourneyTransportModes(
  legs: readonly Pick<JourneyLeg, 'mode'>[],
): readonly TransportMode[] {
  const present = new Set<TransportMode>();
  for (const leg of legs) {
    if (isJourneyTransportMode(leg.mode)) {
      present.add(leg.mode);
    }
  }
  return TRANSPORT_MODES.filter((mode) => present.has(mode));
}

/** True when a transit leg used a token that is not a known Transitous mode. */
export function hasUnmappedTransitLegs(
  legs: readonly { readonly mode: JourneyLeg['mode']; readonly motisMode?: string }[],
): boolean {
  return legs.some((leg) => {
    if (leg.mode !== 'unmapped') {
      return false;
    }
    if (!leg.motisMode) {
      return true;
    }
    return !isMotisPlanMode(leg.motisMode);
  });
}
