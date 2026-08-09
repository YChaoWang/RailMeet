import type { TransportMode } from '@railmeet/shared';

/** Geographic coordinates in WGS84 degrees. */
export type GeoCoordinates = {
  readonly latitude: number;
  readonly longitude: number;
};

/**
 * Provider-neutral single origin→destination journey request.
 * Does not include meeting-search participant aggregates or ranking inputs.
 */
export type PlanJourneyInput = {
  readonly origin: GeoCoordinates;
  readonly destination: GeoCoordinates;
  /** Departure (or arrival when arriveBy) instant in UTC. */
  readonly departureAt: Date;
  readonly arriveBy?: boolean;
  readonly locale?: string;
  readonly maxTransfers?: number;
  /** Application shutdown / cancellation; distinguished from request timeout. */
  readonly signal?: AbortSignal;
};

export type JourneyLegMode = TransportMode | 'walk' | 'other';

/**
 * Compact Google Encoded Polyline from MOTIS EncodedPolyline.
 * Precision is provider-supplied (v5 /api/v5/plan typically uses 6) — never hard-code.
 */
export type EncodedRouteGeometry = {
  readonly points: string;
  readonly precision: number;
  readonly length: number;
};

export type JourneyLeg = {
  readonly mode: JourneyLegMode;
  readonly departureAt: Date;
  readonly arrivalAt: Date;
  readonly durationMinutes: number;
  /** Opaque provider trip/route reference when present. */
  readonly providerReference?: string;
  /** Normalized leg geometry when MOTIS supplied valid legGeometry; otherwise omitted. */
  readonly geometry?: EncodedRouteGeometry;
};

/**
 * Normalized journey. Provider wire types must not leak through this shape.
 */
export type PlannedJourney = {
  readonly departureAt: Date;
  readonly arrivalAt: Date;
  readonly durationMinutes: number;
  readonly transfers: number;
  readonly legs: readonly JourneyLeg[];
  readonly providerReference?: string;
};

export type PlanJourneyResult = {
  readonly journeys: readonly PlannedJourney[];
};

export type JourneyPlanner = {
  planJourney: (input: PlanJourneyInput) => Promise<PlanJourneyResult>;
};

/** MOTIS geocode location types exposed as normalized suggestion types. */
export type PlaceSuggestionType = 'ADDRESS' | 'PLACE' | 'STOP';

/**
 * Provider-neutral place suggestion for autocomplete.
 * `providerId` is the stable MOTIS Match.id — never a display label.
 */
export type PlaceSuggestion = {
  readonly providerId: string;
  readonly name: string;
  readonly type: PlaceSuggestionType;
  readonly latitude: number;
  readonly longitude: number;
  readonly countryCode: string | null;
  readonly timezone: string | null;
  readonly modes: readonly string[];
  readonly secondaryLabel: string | null;
};

export type GeocodePlacesInput = {
  readonly text: string;
  readonly signal?: AbortSignal;
};

export type GeocodePlacesResult = {
  readonly suggestions: readonly PlaceSuggestion[];
};

export type PlaceGeocoder = {
  geocodePlaces: (input: GeocodePlacesInput) => Promise<GeocodePlacesResult>;
};
