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

export type JourneyLeg = {
  readonly mode: JourneyLegMode;
  readonly departureAt: Date;
  readonly arrivalAt: Date;
  readonly durationMinutes: number;
  /** Opaque provider trip/route reference when present. */
  readonly providerReference?: string;
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
