/**
 * Strict shape checks for persisted ranking legs after worker recovery.
 * Keeps Phase 7 integration assertions aligned with NormalizedJourneyLegJson /
 * JourneyLegIntermediateStop without allowing raw provider-only fields to leak.
 */

const RANKING_LEG_KEYS = new Set([
  'mode',
  'departureAt',
  'arrivalAt',
  'durationMinutes',
  'providerReference',
  'geometry',
  'motisMode',
  'displayName',
  'routeShortName',
  'routeLongName',
  'tripShortName',
  'headsign',
  'agencyName',
  'agencyId',
  'agencyUrl',
  'routeColor',
  'routeTextColor',
  'from',
  'to',
  'intermediateStopCount',
  'intermediateStops',
  'distanceMeters',
]);

/** Matches NormalizedJourneyLegIntermediateStopJson / JourneyLegIntermediateStop. */
const INTERMEDIATE_STOP_KEYS = new Set([
  'name',
  'latitude',
  'longitude',
  'arrivalAt',
  'departureAt',
  'scheduledArrivalAt',
  'scheduledDepartureAt',
  'track',
]);

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function assertOptionalIsoString(value: unknown, field: string, path: string): void {
  if (value === undefined) {
    return;
  }
  if (!isNonEmptyString(value)) {
    throw new Error(`Ranking leg intermediate stop ${field} must be a non-empty string at ${path}`);
  }
}

function assertOptionalFiniteNumber(value: unknown, field: string, path: string): void {
  if (value === undefined) {
    return;
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Ranking leg intermediate stop ${field} must be a finite number at ${path}`);
  }
}

export function assertIntermediateStopShape(stop: unknown, path: string): void {
  if (!stop || typeof stop !== 'object' || Array.isArray(stop)) {
    throw new Error(`Ranking leg intermediate stop must be an object at ${path}`);
  }
  const record = stop as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!INTERMEDIATE_STOP_KEYS.has(key)) {
      throw new Error(`Unexpected intermediate stop field "${key}" at ${path}`);
    }
  }
  if (!isNonEmptyString(record.name)) {
    throw new Error(`Ranking leg intermediate stop name must be a non-empty string at ${path}`);
  }
  assertOptionalFiniteNumber(record.latitude, 'latitude', path);
  assertOptionalFiniteNumber(record.longitude, 'longitude', path);
  assertOptionalIsoString(record.arrivalAt, 'arrivalAt', path);
  assertOptionalIsoString(record.departureAt, 'departureAt', path);
  assertOptionalIsoString(record.scheduledArrivalAt, 'scheduledArrivalAt', path);
  assertOptionalIsoString(record.scheduledDepartureAt, 'scheduledDepartureAt', path);
  if (record.track !== undefined && !isNonEmptyString(record.track)) {
    throw new Error(`Ranking leg intermediate stop track must be a non-empty string at ${path}`);
  }
}

export function assertRankingLegShape(leg: Record<string, unknown>, path: string): void {
  for (const key of Object.keys(leg)) {
    if (!RANKING_LEG_KEYS.has(key)) {
      throw new Error(`Unexpected ranking leg field "${key}" at ${path}`);
    }
  }

  if (!Object.prototype.hasOwnProperty.call(leg, 'intermediateStops')) {
    return;
  }

  const stops = leg.intermediateStops;
  if (!Array.isArray(stops)) {
    throw new Error(`Ranking leg intermediateStops must be an array at ${path}`);
  }
  for (const [index, stop] of stops.entries()) {
    assertIntermediateStopShape(stop, `${path}.intermediateStops[${index}]`);
  }
}

export function assertNormalizedJourneyPersistence(value: unknown, path = 'root'): void {
  if (value === null || value === undefined) {
    return;
  }
  if (Array.isArray(value)) {
    for (const [index, entry] of value.entries()) {
      if (
        entry &&
        typeof entry === 'object' &&
        typeof (entry as { mode?: unknown }).mode === 'string' &&
        ((entry as { departureAt?: unknown }).departureAt instanceof Date ||
          typeof (entry as { departureAt?: unknown }).departureAt === 'string') &&
        typeof (entry as { durationMinutes?: unknown }).durationMinutes === 'number'
      ) {
        assertRankingLegShape(entry as Record<string, unknown>, `${path}[${index}]`);
        continue;
      }
      assertNormalizedJourneyPersistence(entry, `${path}[${index}]`);
    }
    return;
  }
  if (typeof value !== 'object') {
    return;
  }

  const record = value as Record<string, unknown>;
  if (Object.prototype.hasOwnProperty.call(record, 'itineraries')) {
    throw new Error(`Persisted journey graph must not embed raw Transitous response at ${path}`);
  }

  // Versioned MOTIS document in legs jsonb, or providerItinerary payload on the record.
  if (record.format === 'motis-plan-itinerary-v1') {
    if (Array.isArray(record.rankingLegs)) {
      assertNormalizedJourneyPersistence(record.rankingLegs, `${path}.rankingLegs`);
      if (!record.itinerary || typeof record.itinerary !== 'object') {
        throw new Error(`motis-plan-itinerary-v1 missing itinerary at ${path}`);
      }
      return;
    }
    if (record.itinerary && typeof record.itinerary === 'object') {
      return;
    }
    throw new Error(`motis-plan-itinerary-v1 missing itinerary at ${path}`);
  }

  if (
    typeof record.mode === 'string' &&
    (record.departureAt instanceof Date || typeof record.departureAt === 'string') &&
    typeof record.durationMinutes === 'number'
  ) {
    assertRankingLegShape(record, path);
    return;
  }

  for (const [key, child] of Object.entries(record)) {
    assertNormalizedJourneyPersistence(child, `${path}.${key}`);
  }
}
