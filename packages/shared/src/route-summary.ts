import {
  isMotisTransitLeg,
  joinInterlinedMotisLegs,
  motisLegDisplayName,
  type MotisItineraryJson,
  type MotisLegJson,
} from './motis-itinerary.js';
import { sanitizeMotisHexColor } from './motis-mode-style.js';
import { canonicalMotisModeToken } from './motis-plan-mode.js';

/** Soft cap so compact results cannot grow unbounded from provider legs. */
export const ROUTE_SUMMARY_SEGMENTS_MAX = 24 as const;
export const ROUTE_SUMMARY_DISPLAY_NAME_MAX = 64 as const;

export type RouteSummarySegment = {
  readonly mode: string;
  readonly displayName?: string;
  readonly routeColor?: string;
  readonly routeTextColor?: string;
};

export type RankingLegForRouteSummary = {
  readonly mode: string;
  readonly motisMode?: string;
  readonly displayName?: string;
  readonly routeColor?: string;
  readonly routeTextColor?: string;
};

function optionalDisplayName(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }
  return trimmed.length > ROUTE_SUMMARY_DISPLAY_NAME_MAX
    ? trimmed.slice(0, ROUTE_SUMMARY_DISPLAY_NAME_MAX)
    : trimmed;
}

function segmentFromMotisLeg(leg: MotisLegJson): RouteSummarySegment {
  const mode = canonicalMotisModeToken(leg.mode);
  const displayName = optionalDisplayName(motisLegDisplayName(leg));
  const routeColor = sanitizeMotisHexColor(leg.routeColor);
  const routeTextColor = sanitizeMotisHexColor(leg.routeTextColor);
  return {
    mode,
    ...(displayName ? { displayName } : {}),
    ...(routeColor ? { routeColor } : {}),
    ...(routeTextColor ? { routeTextColor } : {}),
  };
}

function segmentFromRankingLeg(leg: RankingLegForRouteSummary): RouteSummarySegment | null {
  const mode = canonicalMotisModeToken(leg.motisMode ?? leg.mode);
  if (mode === 'WALK') {
    return null;
  }
  const displayName = optionalDisplayName(leg.displayName);
  // Transit chips prefer legs with a service label; coarse train/bus still appear.
  const routeColor = sanitizeMotisHexColor(leg.routeColor);
  const routeTextColor = sanitizeMotisHexColor(leg.routeTextColor);
  return {
    mode,
    ...(displayName ? { displayName } : {}),
    ...(routeColor ? { routeColor } : {}),
    ...(routeTextColor ? { routeTextColor } : {}),
  };
}

/** Chip segments from a provider-native MOTIS itinerary (joined interlines). */
export function buildRouteSummaryFromProviderItinerary(
  itinerary: MotisItineraryJson,
): readonly RouteSummarySegment[] {
  return joinInterlinedMotisLegs(itinerary.legs)
    .filter(isMotisTransitLeg)
    .map(segmentFromMotisLeg)
    .slice(0, ROUTE_SUMMARY_SEGMENTS_MAX);
}

/** Chip segments from ranking/normalized legs when no provider itinerary exists. */
export function buildRouteSummaryFromRankingLegs(
  legs: readonly RankingLegForRouteSummary[],
): readonly RouteSummarySegment[] {
  const segments: RouteSummarySegment[] = [];
  for (const leg of legs) {
    const segment = segmentFromRankingLeg(leg);
    if (segment) {
      segments.push(segment);
    }
    if (segments.length >= ROUTE_SUMMARY_SEGMENTS_MAX) {
      break;
    }
  }
  return segments;
}

export function buildRouteSummary(input: {
  readonly providerItinerary?: MotisItineraryJson | null;
  readonly rankingLegs: readonly RankingLegForRouteSummary[];
}): readonly RouteSummarySegment[] {
  if (input.providerItinerary?.legs?.length) {
    const fromProvider = buildRouteSummaryFromProviderItinerary(input.providerItinerary);
    if (fromProvider.length > 0) {
      return fromProvider;
    }
  }
  return buildRouteSummaryFromRankingLegs(input.rankingLegs);
}
