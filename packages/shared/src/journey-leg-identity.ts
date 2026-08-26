/**
 * Structured public-transport identity preserved from MOTIS v5 legs.
 * Optional fields are omitted when the provider did not supply them.
 */

export type JourneyLegStopView = {
  readonly name: string;
  readonly track?: string;
  /** WGS84 degrees. Present only when the provider supplied finite coordinates. */
  readonly latitude?: number;
  readonly longitude?: number;
};

/**
 * A MOTIS `intermediateStops[]` entry reduced to what the map and journey
 * details need. Times are ISO-8601 strings so the shape is JSONB-safe.
 */
export type JourneyLegIntermediateStop = {
  readonly name: string;
  readonly latitude?: number;
  readonly longitude?: number;
  readonly arrivalAt?: string;
  readonly departureAt?: string;
  readonly scheduledArrivalAt?: string;
  readonly scheduledDepartureAt?: string;
  readonly track?: string;
};

export type JourneyLegIdentityFields = {
  readonly motisMode?: string;
  readonly displayName?: string;
  readonly routeShortName?: string;
  readonly routeLongName?: string;
  readonly tripShortName?: string;
  readonly headsign?: string;
  readonly agencyName?: string;
  readonly agencyId?: string;
  readonly agencyUrl?: string;
  readonly routeColor?: string;
  readonly routeTextColor?: string;
  readonly from?: JourneyLegStopView;
  readonly to?: JourneyLegStopView;
  readonly intermediateStopCount?: number;
  readonly intermediateStops?: readonly JourneyLegIntermediateStop[];
  readonly distanceMeters?: number;
};

type IdentityDraft = {
  readonly [K in keyof JourneyLegIdentityFields]?: JourneyLegIdentityFields[K] | undefined;
};

function isFiniteNumber(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function pickStop(stop: JourneyLegStopView | undefined): JourneyLegStopView | undefined {
  if (!stop) {
    return undefined;
  }
  return {
    name: stop.name,
    ...(stop.track ? { track: stop.track } : {}),
    ...(isFiniteNumber(stop.latitude) ? { latitude: stop.latitude } : {}),
    ...(isFiniteNumber(stop.longitude) ? { longitude: stop.longitude } : {}),
  };
}

function pickIntermediateStop(stop: JourneyLegIntermediateStop): JourneyLegIntermediateStop {
  return {
    name: stop.name,
    ...(isFiniteNumber(stop.latitude) ? { latitude: stop.latitude } : {}),
    ...(isFiniteNumber(stop.longitude) ? { longitude: stop.longitude } : {}),
    ...(stop.arrivalAt ? { arrivalAt: stop.arrivalAt } : {}),
    ...(stop.departureAt ? { departureAt: stop.departureAt } : {}),
    ...(stop.scheduledArrivalAt ? { scheduledArrivalAt: stop.scheduledArrivalAt } : {}),
    ...(stop.scheduledDepartureAt ? { scheduledDepartureAt: stop.scheduledDepartureAt } : {}),
    ...(stop.track ? { track: stop.track } : {}),
  };
}

export function pickJourneyLegIdentity(source: IdentityDraft): JourneyLegIdentityFields {
  const from = pickStop(source.from);
  const to = pickStop(source.to);
  const intermediateStops = source.intermediateStops
    ?.filter((stop) => Boolean(stop?.name))
    .map(pickIntermediateStop);
  return {
    ...(source.motisMode ? { motisMode: source.motisMode } : {}),
    ...(source.displayName ? { displayName: source.displayName } : {}),
    ...(source.routeShortName ? { routeShortName: source.routeShortName } : {}),
    ...(source.routeLongName ? { routeLongName: source.routeLongName } : {}),
    ...(source.tripShortName ? { tripShortName: source.tripShortName } : {}),
    ...(source.headsign ? { headsign: source.headsign } : {}),
    ...(source.agencyName ? { agencyName: source.agencyName } : {}),
    ...(source.agencyId ? { agencyId: source.agencyId } : {}),
    ...(source.agencyUrl ? { agencyUrl: source.agencyUrl } : {}),
    ...(source.routeColor ? { routeColor: source.routeColor } : {}),
    ...(source.routeTextColor ? { routeTextColor: source.routeTextColor } : {}),
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
    ...(typeof source.intermediateStopCount === 'number'
      ? { intermediateStopCount: source.intermediateStopCount }
      : {}),
    ...(intermediateStops && intermediateStops.length > 0 ? { intermediateStops } : {}),
    ...(typeof source.distanceMeters === 'number' ? { distanceMeters: source.distanceMeters } : {}),
  };
}
