import { MOTIS_PLAN_ITINERARY_FORMAT, pickJourneyLegIdentity } from '@railmeet/shared';
import type { MotisItineraryJson, MotisPlanItineraryPayload } from '@railmeet/shared';

import type { EncodedRouteGeometryRecord, PersistedJourneyLeg, RankedJourneyLegRecord } from './models.js';
import type {
  NormalizedEncodedRouteGeometryJson,
  NormalizedJourneyLegJson,
  StoredJourneyLegsJson,
  StoredMotisPlanItineraryDocument,
} from './schema/tables.js';
import { STORED_JOURNEY_LEGS_FORMAT } from './schema/tables.js';

function mapGeometry(
  geometry: NormalizedEncodedRouteGeometryJson | EncodedRouteGeometryRecord,
): EncodedRouteGeometryRecord {
  return {
    points: geometry.points,
    precision: geometry.precision,
    length: geometry.length,
  };
}

export function persistedLegFromJson(leg: NormalizedJourneyLegJson): PersistedJourneyLeg {
  const identity = pickJourneyLegIdentity(leg);
  return {
    mode: leg.mode,
    departureAt: new Date(leg.departureAt),
    arrivalAt: new Date(leg.arrivalAt),
    durationMinutes: leg.durationMinutes,
    ...identity,
    ...(leg.providerReference ? { providerReference: leg.providerReference } : {}),
    ...(leg.geometry ? { geometry: mapGeometry(leg.geometry) } : {}),
  };
}

export function jsonFromPersistedLeg(leg: PersistedJourneyLeg): NormalizedJourneyLegJson {
  const identity = pickJourneyLegIdentity(leg);
  return {
    mode: leg.mode,
    departureAt: leg.departureAt.toISOString(),
    arrivalAt: leg.arrivalAt.toISOString(),
    durationMinutes: leg.durationMinutes,
    ...identity,
    ...(leg.providerReference ? { providerReference: leg.providerReference } : {}),
    ...(leg.geometry
      ? {
          geometry: {
            points: leg.geometry.points,
            precision: leg.geometry.precision,
            length: leg.geometry.length,
          },
        }
      : {}),
  };
}

export function rankedLegFromJson(leg: NormalizedJourneyLegJson): RankedJourneyLegRecord {
  const identity = pickJourneyLegIdentity(leg);
  return {
    mode: leg.mode,
    departureAt: new Date(leg.departureAt),
    arrivalAt: new Date(leg.arrivalAt),
    durationMinutes: leg.durationMinutes,
    geometry: leg.geometry
      ? {
          points: leg.geometry.points,
          precision: leg.geometry.precision,
          length: leg.geometry.length,
        }
      : null,
    ...identity,
  };
}

export type ParsedStoredJourneyLegs = {
  readonly rankingLegs: readonly NormalizedJourneyLegJson[];
  readonly providerItinerary: MotisPlanItineraryPayload | null;
  readonly storageKind: 'provider_document' | 'legacy_array' | 'unrecognized';
  readonly unavailableReason: string | null;
};

export function isStoredMotisPlanItineraryDocument(
  value: unknown,
): value is StoredMotisPlanItineraryDocument {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as { format?: unknown; rankingLegs?: unknown; itinerary?: unknown };
  return (
    record.format === STORED_JOURNEY_LEGS_FORMAT &&
    Array.isArray(record.rankingLegs) &&
    typeof record.itinerary === 'object' &&
    record.itinerary !== null
  );
}

function isUsableMotisItinerary(value: unknown): value is MotisItineraryJson {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as {
    legs?: unknown;
    duration?: unknown;
    startTime?: unknown;
    endTime?: unknown;
  };
  return (
    Array.isArray(record.legs) &&
    record.legs.length > 0 &&
    typeof record.duration === 'number' &&
    typeof record.startTime === 'string' &&
    typeof record.endTime === 'string'
  );
}

export function parseStoredJourneyLegs(raw: unknown): ParsedStoredJourneyLegs {
  if (Array.isArray(raw)) {
    return {
      rankingLegs: raw as readonly NormalizedJourneyLegJson[],
      providerItinerary: null,
      storageKind: 'legacy_array',
      unavailableReason: null,
    };
  }
  if (isStoredMotisPlanItineraryDocument(raw)) {
    if (!isUsableMotisItinerary(raw.itinerary)) {
      return {
        rankingLegs: raw.rankingLegs,
        providerItinerary: null,
        storageKind: 'provider_document',
        unavailableReason: 'provider_itinerary_invalid',
      };
    }
    if (raw.motisPlanApiVersion !== 'v5' || typeof raw.motisOpenApiPin !== 'string') {
      return {
        rankingLegs: raw.rankingLegs,
        providerItinerary: null,
        storageKind: 'provider_document',
        unavailableReason: 'provider_itinerary_metadata_invalid',
      };
    }
    return {
      rankingLegs: raw.rankingLegs,
      providerItinerary: {
        format: MOTIS_PLAN_ITINERARY_FORMAT,
        motisPlanApiVersion: raw.motisPlanApiVersion,
        motisOpenApiPin: raw.motisOpenApiPin,
        itinerary: raw.itinerary,
      },
      storageKind: 'provider_document',
      unavailableReason: null,
    };
  }
  return {
    rankingLegs: [],
    providerItinerary: null,
    storageKind: 'unrecognized',
    unavailableReason: 'unrecognized_legs_document',
  };
}

export function storedJourneyLegsJson(input: {
  readonly rankingLegs: readonly NormalizedJourneyLegJson[];
  readonly providerItinerary?: MotisPlanItineraryPayload;
}): StoredJourneyLegsJson {
  if (!input.providerItinerary) {
    return input.rankingLegs;
  }
  return {
    format: STORED_JOURNEY_LEGS_FORMAT,
    motisPlanApiVersion: input.providerItinerary.motisPlanApiVersion,
    motisOpenApiPin: input.providerItinerary.motisOpenApiPin,
    itinerary: input.providerItinerary.itinerary,
    rankingLegs: input.rankingLegs,
  };
}

