import { z } from 'zod';

import {
  ENCODED_POLYLINE_POINTS_MAX_LENGTH,
  ENCODED_POLYLINE_PRECISION_MAX,
  ENCODED_POLYLINE_PRECISION_MIN,
  MOTIS_PLAN_ITINERARY_FORMAT,
  pickJourneyLegIdentity,
  type JourneyLegIntermediateStop,
  type JourneyLegStopView,
  type MotisItineraryJson,
} from '@railmeet/shared';

import { RoutingError } from './errors.js';
import { canonicalMotisLegMode, mapMotisLegMode } from './motis-mode.js';
import type { EncodedRouteGeometry, JourneyLeg, PlannedJourney } from './types.js';

/**
 * RailMeet plan adapter pin. Transitous current OpenAPI uses `/api/v6/plan`
 * and `/api/v6/refresh-itinerary`; this adapter still calls `/api/v5/plan`.
 * Live `/api/v5/refresh-itinerary` is 404, so RailMeet does not expose refresh
 * while pinned to v5 (itinerary.id is still persisted for a future v6 pin).
 */
export const MOTIS_PLAN_API_VERSION = 'v5' as const;
export const MOTIS_OPENAPI_PIN = 'motis@2.10.2:/api/v5/plan' as const;
export const MOTIS_REFRESH_ITINERARY_SUPPORTED = false;

const coordinateSchema = z.number().finite().gte(-90).lte(90);
const longitudeSchema = z.number().finite().gte(-180).lte(180);

export function assertPlanJourneyCoordinates(input: {
  readonly origin: { latitude: number; longitude: number };
  readonly destination: { latitude: number; longitude: number };
}): void {
  const originLat = coordinateSchema.safeParse(input.origin.latitude);
  const originLon = longitudeSchema.safeParse(input.origin.longitude);
  const destLat = coordinateSchema.safeParse(input.destination.latitude);
  const destLon = longitudeSchema.safeParse(input.destination.longitude);
  if (!originLat.success || !originLon.success || !destLat.success || !destLon.success) {
    throw new RoutingError('INVALID_REQUEST', 'permanent', 'Invalid journey coordinates');
  }
}

const motisModeSchema = z.string();

/** MOTIS EncodedPolyline — precision is not hard-coded (v5 typically uses 6). */
export const motisEncodedPolylineSchema = z
  .object({
    points: z.string().min(1).max(ENCODED_POLYLINE_POINTS_MAX_LENGTH),
    precision: z
      .number()
      .int()
      .min(ENCODED_POLYLINE_PRECISION_MIN)
      .max(ENCODED_POLYLINE_PRECISION_MAX),
    length: z.number().int().nonnegative(),
  })
  .strict();

const motisPlaceSchema = z
  .object({
    name: z.string().optional(),
    track: z.string().optional().nullable(),
    scheduledTrack: z.string().optional().nullable(),
    lat: z.number().optional().nullable(),
    lon: z.number().optional().nullable(),
  })
  .passthrough();

/**
 * MOTIS `intermediateStops[]`. Kept permissive (passthrough) so the provider
 * document stays lossless; only the fields RailMeet renders are validated.
 */
const motisIntermediateStopSchema = z
  .object({
    name: z.string().optional(),
    track: z.string().optional().nullable(),
    scheduledTrack: z.string().optional().nullable(),
    lat: z.number().optional().nullable(),
    lon: z.number().optional().nullable(),
    arrival: z.string().optional().nullable(),
    departure: z.string().optional().nullable(),
    scheduledArrival: z.string().optional().nullable(),
    scheduledDeparture: z.string().optional().nullable(),
  })
  .passthrough();

const motisLegSchema = z
  .object({
    mode: motisModeSchema,
    startTime: z.string().min(1),
    endTime: z.string().min(1),
    duration: z.number().finite().nonnegative(),
    tripId: z.string().optional(),
    routeId: z.string().optional(),
    headsign: z.string().optional().nullable(),
    agencyName: z.string().optional().nullable(),
    agencyId: z.string().optional().nullable(),
    agencyUrl: z.string().optional().nullable(),
    routeShortName: z.string().optional().nullable(),
    routeLongName: z.string().optional().nullable(),
    tripShortName: z.string().optional().nullable(),
    displayName: z.string().optional().nullable(),
    routeColor: z.string().optional().nullable(),
    routeTextColor: z.string().optional().nullable(),
    distance: z.number().finite().nonnegative().optional(),
    from: motisPlaceSchema.optional(),
    to: motisPlaceSchema.optional(),
    // Elements stay `unknown` so a single malformed stop cannot drop the whole
    // itinerary; each entry is parsed defensively in `normalizeIntermediateStops`.
    intermediateStops: z.array(z.unknown()).nullable().optional(),
    // Validated in normalizeLegGeometry — empty points must not fail the whole plan.
    legGeometry: z.unknown().optional(),
  })
  .passthrough();

const motisItinerarySchema = z
  .object({
    duration: z.number().finite().nonnegative(),
    startTime: z.string().min(1),
    endTime: z.string().min(1),
    transfers: z.number().int().nonnegative(),
    id: z.string().optional(),
    legs: z.array(motisLegSchema).min(1),
  })
  .passthrough();

export const motisPlanResponseSchema = z
  .object({
    itineraries: z.array(motisItinerarySchema).default([]),
  })
  .passthrough();

function parseInstant(value: string, label: string): Date {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new RoutingError(
      'PROVIDER_CONTRACT_FAILURE',
      'provider_contract',
      `Invalid ${label} timestamp from provider`,
    );
  }
  return date;
}

function optionalText(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function optionalUrl(value: string | null | undefined): string | undefined {
  const trimmed = optionalText(value);
  if (!trimmed) {
    return undefined;
  }
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  return undefined;
}

function optionalCoordinate(value: number | null | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function normalizeStop(
  place: z.infer<typeof motisPlaceSchema> | undefined,
): JourneyLegStopView | undefined {
  if (!place) {
    return undefined;
  }
  const name = optionalText(place.name);
  if (!name) {
    return undefined;
  }
  const track =
    optionalText(place.track ?? undefined) ?? optionalText(place.scheduledTrack ?? undefined);
  const latitude = optionalCoordinate(place.lat);
  const longitude = optionalCoordinate(place.lon);
  return {
    name,
    ...(track ? { track } : {}),
    ...(latitude !== undefined ? { latitude } : {}),
    ...(longitude !== undefined ? { longitude } : {}),
  };
}

/**
 * Map MOTIS `intermediateStops[]` onto the ranking identity. Stops without a
 * name are dropped; coordinates and times are included only when usable, so the
 * map never fabricates a marker position.
 */
function normalizeIntermediateStops(
  raw: readonly unknown[] | null | undefined,
): readonly JourneyLegIntermediateStop[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const stops: JourneyLegIntermediateStop[] = [];
  for (const entry of raw) {
    const parsed = motisIntermediateStopSchema.safeParse(entry);
    if (!parsed.success) {
      continue;
    }
    const name = optionalText(parsed.data.name);
    if (!name) {
      continue;
    }
    const latitude = optionalCoordinate(parsed.data.lat);
    const longitude = optionalCoordinate(parsed.data.lon);
    const track =
      optionalText(parsed.data.track ?? undefined) ??
      optionalText(parsed.data.scheduledTrack ?? undefined);
    const arrivalAt = optionalText(parsed.data.arrival ?? undefined);
    const departureAt = optionalText(parsed.data.departure ?? undefined);
    const scheduledArrivalAt = optionalText(parsed.data.scheduledArrival ?? undefined);
    const scheduledDepartureAt = optionalText(parsed.data.scheduledDeparture ?? undefined);
    stops.push({
      name,
      ...(latitude !== undefined ? { latitude } : {}),
      ...(longitude !== undefined ? { longitude } : {}),
      ...(arrivalAt ? { arrivalAt } : {}),
      ...(departureAt ? { departureAt } : {}),
      ...(scheduledArrivalAt ? { scheduledArrivalAt } : {}),
      ...(scheduledDepartureAt ? { scheduledDepartureAt } : {}),
      ...(track ? { track } : {}),
    });
  }
  return stops;
}

function normalizeLegGeometry(raw: unknown): EncodedRouteGeometry | undefined {
  if (raw === undefined || raw === null) {
    return undefined;
  }
  // Transitous sometimes returns `{ points: "", precision, length: 0 }` for
  // zero-length walk stubs; treat that as absent geometry rather than failing
  // the entire participant × candidate plan (which would exhaust the search).
  if (
    typeof raw === 'object' &&
    raw !== null &&
    'points' in raw &&
    (raw as { points?: unknown }).points === ''
  ) {
    return undefined;
  }
  const parsed = motisEncodedPolylineSchema.safeParse(raw);
  if (!parsed.success) {
    throw new RoutingError(
      'PROVIDER_CONTRACT_FAILURE',
      'provider_contract',
      'Provider legGeometry failed schema validation',
    );
  }
  return {
    points: parsed.data.points,
    precision: parsed.data.precision,
    length: parsed.data.length,
  };
}

export function normalizeMotisPlanResponse(payload: unknown): readonly PlannedJourney[] {
  const parsed = motisPlanResponseSchema.safeParse(payload);
  if (!parsed.success) {
    throw new RoutingError(
      'PROVIDER_CONTRACT_FAILURE',
      'provider_contract',
      'Provider JSON failed schema validation',
    );
  }

  const journeys: PlannedJourney[] = [];
  for (const itinerary of parsed.data.itineraries) {
    try {
      journeys.push(normalizeOneItinerary(itinerary));
    } catch (error) {
      // Isolate malformed itineraries so one bad legGeometry/instant does not
      // abort sibling valid itineraries in the same plan response.
      if (error instanceof RoutingError && error.code === 'PROVIDER_CONTRACT_FAILURE') {
        continue;
      }
      throw error;
    }
  }
  return journeys;
}

function normalizeOneItinerary(itinerary: z.infer<typeof motisItinerarySchema>): PlannedJourney {
  const departureAt = parseInstant(itinerary.startTime, 'journey start');
  const arrivalAt = parseInstant(itinerary.endTime, 'journey end');
  if (arrivalAt.getTime() < departureAt.getTime()) {
    throw new RoutingError(
      'PROVIDER_CONTRACT_FAILURE',
      'provider_contract',
      'Journey arrival precedes departure',
    );
  }
  const durationMinutes = Math.max(0, Math.round(itinerary.duration / 60));
  const legs: JourneyLeg[] = itinerary.legs.map((leg) => {
    const legDeparture = parseInstant(leg.startTime, 'leg start');
    const legArrival = parseInstant(leg.endTime, 'leg end');
    if (legArrival.getTime() < legDeparture.getTime()) {
      throw new RoutingError(
        'PROVIDER_CONTRACT_FAILURE',
        'provider_contract',
        'Leg arrival precedes departure',
      );
    }
    const providerReference = optionalText(leg.tripId) ?? optionalText(leg.routeId);
    const geometry = normalizeLegGeometry(leg.legGeometry);
    const intermediateStops = normalizeIntermediateStops(leg.intermediateStops);
    const identity = pickJourneyLegIdentity({
      motisMode: canonicalMotisLegMode(leg.mode),
      displayName: optionalText(leg.displayName ?? undefined),
      routeShortName: optionalText(leg.routeShortName ?? undefined),
      routeLongName: optionalText(leg.routeLongName ?? undefined),
      tripShortName: optionalText(leg.tripShortName ?? undefined),
      headsign: optionalText(leg.headsign ?? undefined),
      agencyName: optionalText(leg.agencyName ?? undefined),
      agencyId: optionalText(leg.agencyId ?? undefined),
      agencyUrl: optionalUrl(leg.agencyUrl ?? undefined),
      routeColor: optionalText(leg.routeColor ?? undefined),
      routeTextColor: optionalText(leg.routeTextColor ?? undefined),
      from: normalizeStop(leg.from),
      to: normalizeStop(leg.to),
      ...(Array.isArray(leg.intermediateStops)
        ? { intermediateStopCount: leg.intermediateStops.length }
        : {}),
      ...(intermediateStops.length > 0 ? { intermediateStops } : {}),
      ...(typeof leg.distance === 'number' ? { distanceMeters: leg.distance } : {}),
    });
    const mapped: JourneyLeg = {
      mode: mapMotisLegMode(leg.mode),
      motisMode: identity.motisMode ?? canonicalMotisLegMode(leg.mode),
      departureAt: legDeparture,
      arrivalAt: legArrival,
      durationMinutes: Math.max(0, Math.round(leg.duration / 60)),
      ...identity,
      ...(geometry ? { geometry } : {}),
    };
    if (providerReference) {
      return { ...mapped, providerReference };
    }
    return mapped;
  });

  const planned: PlannedJourney = {
    departureAt,
    arrivalAt,
    durationMinutes,
    transfers: itinerary.transfers,
    legs,
    providerItinerary: {
      format: MOTIS_PLAN_ITINERARY_FORMAT,
      motisPlanApiVersion: 'v5',
      motisOpenApiPin: MOTIS_OPENAPI_PIN,
      itinerary: itinerary as MotisItineraryJson,
    },
  };
  const itineraryId = optionalText(itinerary.id);
  if (itineraryId) {
    return { ...planned, providerReference: itineraryId };
  }
  return planned;
}
