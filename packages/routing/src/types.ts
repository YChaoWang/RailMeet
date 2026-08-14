import type {
  JourneyLegIdentityFields,
  JourneyLegMode as SharedJourneyLegMode,
  JourneyLegStopView,
  MotisPlanItineraryPayload,
} from '@railmeet/shared';

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

export type JourneyLegMode = SharedJourneyLegMode;
export type JourneyLegStop = JourneyLegStopView;

/**
 * Compact Google Encoded Polyline from MOTIS EncodedPolyline.
 * Precision is provider-supplied (v5 /api/v5/plan typically uses 6) — never hard-code.
 */
export type EncodedRouteGeometry = {
  readonly points: string;
  readonly precision: number;
  readonly length: number;
};

export type JourneyLeg = JourneyLegIdentityFields & {
  readonly mode: JourneyLegMode;
  /** Exact MOTIS v5 Mode token (canonicalized). Unknown future tokens are preserved. */
  readonly motisMode: string;
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
  /** Full MOTIS itinerary retained for Journey Details. Ranking uses `legs`. */
  readonly providerItinerary?: MotisPlanItineraryPayload;
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

/** Viewport station kind derived from MOTIS Place.modes. */
export type StationKind = 'rail' | 'metro' | 'tram' | 'bus' | 'ferry' | 'other';

/** Coarse importance bucket from MOTIS Place.importance. */
export type StationImportance = 'major' | 'regional' | 'local';

export type StationFeatureProperties = {
  readonly stopId: string;
  readonly name: string;
  readonly kind: StationKind;
  readonly importance: StationImportance;
  readonly modes: readonly string[];
  readonly parentId: string | null;
};

export type StationFeature = {
  readonly type: 'Feature';
  readonly geometry: {
    readonly type: 'Point';
    /** GeoJSON order: [longitude, latitude]. */
    readonly coordinates: readonly [number, number];
  };
  readonly properties: StationFeatureProperties;
};

export type StationFeatureCollectionMetadata = {
  readonly truncated: boolean;
  readonly aggregated: boolean;
  readonly minimumDetailZoom: number | null;
  readonly sourceFeatureCount: number;
};

/**
 * Normalized viewport stations. Provider Place objects must not leak through this shape.
 */
export type StationFeatureCollection = {
  readonly type: 'FeatureCollection';
  readonly features: readonly StationFeature[];
  readonly metadata: StationFeatureCollectionMetadata;
};

export type FetchMapStopsInput = {
  readonly minLat: number;
  readonly minLon: number;
  readonly maxLat: number;
  readonly maxLon: number;
  readonly signal?: AbortSignal;
};

export type MapStopsClient = {
  fetchMapStops: (input: FetchMapStopsInput) => Promise<StationFeatureCollection>;
};
