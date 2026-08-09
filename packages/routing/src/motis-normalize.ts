import { z } from 'zod';

import {
  ENCODED_POLYLINE_POINTS_MAX_LENGTH,
  ENCODED_POLYLINE_PRECISION_MAX,
  ENCODED_POLYLINE_PRECISION_MIN,
  isTransportMode,
  type TransportMode,
} from '@railmeet/shared';

import { RoutingError } from './errors.js';
import type { EncodedRouteGeometry, JourneyLeg, JourneyLegMode, PlannedJourney } from './types.js';

/**
 * Pinned MOTIS OpenAPI surface used by this adapter:
 * MOTIS 2.10.2 /api/v5/plan (see docs/routing-transitous.md).
 * Do not regenerate clients during ordinary build/test.
 */
export const MOTIS_PLAN_API_VERSION = 'v5' as const;
export const MOTIS_OPENAPI_PIN = 'motis@2.10.2:/api/v5/plan' as const;

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

const motisLegSchema = z
  .object({
    mode: motisModeSchema,
    startTime: z.string().min(1),
    endTime: z.string().min(1),
    duration: z.number().finite().nonnegative(),
    tripId: z.string().optional(),
    routeId: z.string().optional(),
    legGeometry: motisEncodedPolylineSchema.optional(),
  })
  .passthrough();

const motisItinerarySchema = z
  .object({
    duration: z.number().finite().nonnegative(),
    startTime: z.string().min(1),
    endTime: z.string().min(1),
    transfers: z.number().int().nonnegative(),
    legs: z.array(motisLegSchema).min(1),
  })
  .passthrough();

export const motisPlanResponseSchema = z
  .object({
    itineraries: z.array(motisItinerarySchema).default([]),
  })
  .passthrough();

function mapMode(mode: string): JourneyLegMode {
  const normalized = mode.trim().toLowerCase();
  if (normalized === 'walk' || normalized === 'foot') {
    return 'walk';
  }
  const aliases: Record<string, TransportMode> = {
    rail: 'train',
    train: 'train',
    subway: 'metro',
    metro: 'metro',
    suburban: 'train',
    tram: 'tram',
    bus: 'bus',
    ferry: 'ferry',
    boat: 'ferry',
  };
  const mapped = aliases[normalized];
  if (mapped && isTransportMode(mapped)) {
    return mapped;
  }
  return 'other';
}

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

function normalizeLegGeometry(raw: unknown): EncodedRouteGeometry | undefined {
  if (raw === undefined) {
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

  return parsed.data.itineraries.map((itinerary) => {
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
      const providerReference = leg.tripId ?? leg.routeId;
      const geometry = normalizeLegGeometry(leg.legGeometry);
      const mapped: JourneyLeg = {
        mode: mapMode(leg.mode),
        departureAt: legDeparture,
        arrivalAt: legArrival,
        durationMinutes: Math.max(0, Math.round(leg.duration / 60)),
        ...(geometry ? { geometry } : {}),
      };
      if (providerReference) {
        return { ...mapped, providerReference };
      }
      return mapped;
    });

    return {
      departureAt,
      arrivalAt,
      durationMinutes,
      transfers: itinerary.transfers,
      legs,
    };
  });
}
