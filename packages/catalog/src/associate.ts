import {
  CATALOG_HUB_DISTANCE_HARD_MAX_METERS,
  CATALOG_HUB_DISTANCE_SOFT_MAX_METERS,
} from '@railmeet/shared';

import { haversineMeters } from './validate.js';
import type { CatalogCity, CatalogHub } from './types.js';

/** Structured MOTIS geocode mode tokens that indicate intercity / regional rail capability. */
export const RAIL_FAMILY_MODES = [
  'rail',
  'train',
  'long_distance',
  'highspeed_rail',
  'high_speed_rail',
  'night_rail',
  'regional_rail',
  'regional_fast_rail',
  'suburban',
  'intercity',
] as const;

export type HubCapabilityClass =
  | 'intercity_rail'
  | 'regional_rail'
  | 'ferry_terminal'
  | 'coach_terminal'
  | 'metro_only'
  | 'local_bus'
  | 'unknown';

export type HubMatchCandidate = {
  readonly providerStopId: string;
  readonly name: string;
  readonly countryCode: string;
  readonly timezone: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly localityName?: string | null;
  /** Structured MOTIS Match.modes when present. */
  readonly modes?: readonly string[];
  /** MOTIS location type (STOP / PLACE / ADDRESS). */
  readonly resultType?: string;
};

export type AssociationResult =
  | {
      readonly status: 'matched';
      readonly hub: CatalogHub;
      readonly distanceMeters: number;
      readonly capabilityClass: HubCapabilityClass;
    }
  | {
      readonly status: 'ambiguous';
      readonly reason: string;
      readonly candidates: readonly string[];
    }
  | {
      readonly status: 'rejected';
      readonly reason: string;
    };

function normalizeName(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeModeToken(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
}

export function classifyHubCapability(modes: readonly string[] | undefined): HubCapabilityClass {
  const normalized = new Set((modes ?? []).map(normalizeModeToken));
  if (
    normalized.has('long_distance') ||
    normalized.has('highspeed_rail') ||
    normalized.has('high_speed_rail') ||
    normalized.has('night_rail') ||
    normalized.has('intercity')
  ) {
    return 'intercity_rail';
  }
  if (
    normalized.has('rail') ||
    normalized.has('train') ||
    normalized.has('regional_rail') ||
    normalized.has('regional_fast_rail') ||
    normalized.has('suburban')
  ) {
    return 'regional_rail';
  }
  if (normalized.has('ferry') || normalized.has('boat')) {
    return 'ferry_terminal';
  }
  if (normalized.has('coach')) {
    return 'coach_terminal';
  }
  if (normalized.has('subway') || normalized.has('metro')) {
    return 'metro_only';
  }
  if (normalized.has('bus') || normalized.has('tram') || normalized.has('light_rail')) {
    return 'local_bus';
  }
  return 'unknown';
}

export function isEligiblePrimaryHubCapability(capability: HubCapabilityClass): boolean {
  return (
    capability === 'intercity_rail' ||
    capability === 'regional_rail' ||
    capability === 'ferry_terminal' ||
    capability === 'coach_terminal'
  );
}

function capabilityRank(capability: HubCapabilityClass): number {
  switch (capability) {
    case 'intercity_rail':
      return 0;
    case 'regional_rail':
      return 1;
    case 'ferry_terminal':
      return 2;
    case 'coach_terminal':
      return 3;
    case 'metro_only':
      return 8;
    case 'local_bus':
      return 9;
    case 'unknown':
      return 10;
    default: {
      const _exhaustive: never = capability;
      return _exhaustive;
    }
  }
}

/**
 * Deterministic city→hub association using structured STOP type + modes.
 * Display name alone is never sufficient. Local bus / metro-only stops cannot
 * become primary when rail/ferry/coach-capable stops exist; if none exist, reject.
 */
export function associateCityToHub(
  city: CatalogCity,
  stops: readonly HubMatchCandidate[],
  options?: { readonly softMaxMeters?: number; readonly hardMaxMeters?: number },
): AssociationResult {
  const softMax = options?.softMaxMeters ?? CATALOG_HUB_DISTANCE_SOFT_MAX_METERS;
  const hardMax = options?.hardMaxMeters ?? CATALOG_HUB_DISTANCE_HARD_MAX_METERS;

  const stopTyped = stops.filter((stop) => {
    if (stop.resultType && stop.resultType !== 'STOP') {
      return false;
    }
    return true;
  });
  const sameCountry = stopTyped.filter((stop) => stop.countryCode === city.countryCode);
  if (sameCountry.length === 0) {
    return { status: 'rejected', reason: 'no-stops-same-country' };
  }

  const withCapability = sameCountry.map((stop) => ({
    stop,
    capability: classifyHubCapability(stop.modes),
  }));
  const eligible = withCapability.filter((entry) =>
    isEligiblePrimaryHubCapability(entry.capability),
  );
  if (eligible.length === 0) {
    return {
      status: 'rejected',
      reason: 'no-eligible-intercity-capable-stop',
    };
  }

  const cityName = normalizeName(city.name);
  const eligibleStops = eligible.map((entry) => entry.stop);

  const exactName = eligibleStops.filter((stop) => normalizeName(stop.name) === cityName);
  if (exactName.length === 1) {
    return buildMatch(city, exactName[0]!, 'exact-normalized-stop-name', softMax, hardMax);
  }
  if (exactName.length > 1) {
    const ranked = rankEligible(city, exactName);
    if (isAmbiguousTie(ranked)) {
      return {
        status: 'ambiguous',
        reason: 'multiple-exact-name-stops',
        candidates: ranked.map((entry) => entry.stop.providerStopId),
      };
    }
    return buildMatch(city, ranked[0]!.stop, 'exact-normalized-stop-name', softMax, hardMax);
  }

  const locality = eligibleStops.filter(
    (stop) => stop.localityName && normalizeName(stop.localityName) === cityName,
  );
  if (locality.length === 1) {
    return buildMatch(city, locality[0]!, 'locality-parent-name', softMax, hardMax);
  }
  if (locality.length > 1) {
    const ranked = rankEligible(city, locality);
    if (isAmbiguousTie(ranked)) {
      return {
        status: 'ambiguous',
        reason: 'multiple-locality-stops',
        candidates: ranked.map((entry) => entry.stop.providerStopId),
      };
    }
    return buildMatch(city, ranked[0]!.stop, 'locality-parent-name', softMax, hardMax);
  }

  const withinSoft = eligibleStops.filter(
    (stop) =>
      haversineMeters(city.latitude, city.longitude, stop.latitude, stop.longitude) <= softMax,
  );
  // Proximity-only matches require rail capability so coach/bus terminals near landmarks
  // (e.g. London Eye COACH, city bus stations) cannot become primary via distance alone.
  const proximityEligible = (stops: readonly HubMatchCandidate[]) =>
    stops.filter((stop) => {
      const capability = classifyHubCapability(stop.modes);
      return capability === 'intercity_rail' || capability === 'regional_rail';
    });

  if (withinSoft.length === 0) {
    const withinHard = eligibleStops.filter(
      (stop) =>
        haversineMeters(city.latitude, city.longitude, stop.latitude, stop.longitude) <= hardMax,
    );
    const hardRail = proximityEligible(withinHard);
    if (hardRail.length === 0) {
      return { status: 'rejected', reason: 'no-eligible-stop-within-distance' };
    }
    const ranked = rankEligible(city, hardRail);
    if (isAmbiguousTie(ranked)) {
      return {
        status: 'ambiguous',
        reason: 'regional-proximity-tie',
        candidates: ranked.map((entry) => entry.stop.providerStopId),
      };
    }
    return buildMatch(city, ranked[0]!.stop, 'proximity-regional', softMax, hardMax, true);
  }

  const softRail = proximityEligible(withinSoft);
  if (softRail.length === 0) {
    return { status: 'rejected', reason: 'no-rail-capable-stop-within-soft-distance' };
  }
  const ranked = rankEligible(city, softRail);
  if (isAmbiguousTie(ranked)) {
    return {
      status: 'ambiguous',
      reason: 'proximity-tie',
      candidates: ranked.map((entry) => entry.stop.providerStopId),
    };
  }
  return buildMatch(city, ranked[0]!.stop, 'proximity-soft', softMax, hardMax, false);
}

function rankEligible(
  city: CatalogCity,
  stops: readonly HubMatchCandidate[],
): Array<{ stop: HubMatchCandidate; distance: number; capability: HubCapabilityClass }> {
  return [...stops]
    .map((stop) => ({
      stop,
      distance: haversineMeters(city.latitude, city.longitude, stop.latitude, stop.longitude),
      capability: classifyHubCapability(stop.modes),
    }))
    .sort(
      (a, b) =>
        capabilityRank(a.capability) - capabilityRank(b.capability) ||
        a.distance - b.distance ||
        (a.stop.providerStopId < b.stop.providerStopId
          ? -1
          : a.stop.providerStopId > b.stop.providerStopId
            ? 1
            : 0),
    );
}

function isAmbiguousTie(
  ranked: Array<{ stop: HubMatchCandidate; distance: number; capability: HubCapabilityClass }>,
): boolean {
  if (ranked.length < 2) {
    return false;
  }
  return (
    ranked[0]!.capability === ranked[1]!.capability &&
    Math.abs(ranked[0]!.distance - ranked[1]!.distance) < 50
  );
}

function buildMatch(
  city: CatalogCity,
  stop: HubMatchCandidate,
  matchMethod: string,
  softMax: number,
  hardMax: number,
  regional = false,
): AssociationResult {
  const distance = haversineMeters(city.latitude, city.longitude, stop.latitude, stop.longitude);
  const max = regional ? hardMax : softMax;
  if (distance > max) {
    return { status: 'rejected', reason: `distance-${Math.round(distance)}-exceeds-${max}` };
  }
  const capability = classifyHubCapability(stop.modes);
  if (!isEligiblePrimaryHubCapability(capability)) {
    return { status: 'rejected', reason: `capability-${capability}-not-primary` };
  }
  const stableId = stop.providerStopId.replace(/[^a-zA-Z0-9._:-]+/g, '_');
  const hub: CatalogHub = {
    id: `place:hub:motis:${stableId}`.slice(0, 128),
    externalId: `motis:${stop.providerStopId}`,
    name: stop.name,
    countryCode: stop.countryCode,
    timezone: stop.timezone || city.timezone,
    latitude: stop.latitude,
    longitude: stop.longitude,
    cityId: city.id,
    priority: 0,
    matchMethod,
    regional,
    providerStopId: stop.providerStopId,
    hubSource: 'catalog:transitous',
    confidence:
      capability === 'intercity_rail' || matchMethod.startsWith('exact') ? 'high' : 'medium',
  };
  return { status: 'matched', hub, distanceMeters: distance, capabilityClass: capability };
}
