/**
 * Structured public-transport identity preserved from MOTIS v5 legs.
 * Optional fields are omitted when the provider did not supply them.
 */

export type JourneyLegStopView = {
  readonly name: string;
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
  readonly distanceMeters?: number;
};

type IdentityDraft = {
  readonly [K in keyof JourneyLegIdentityFields]?: JourneyLegIdentityFields[K] | undefined;
};

export function pickJourneyLegIdentity(source: IdentityDraft): JourneyLegIdentityFields {
  const from = source.from
    ? source.from.track
      ? { name: source.from.name, track: source.from.track }
      : { name: source.from.name }
    : undefined;
  const to = source.to
    ? source.to.track
      ? { name: source.to.name, track: source.to.track }
      : { name: source.to.name }
    : undefined;
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
    ...(typeof source.distanceMeters === 'number' ? { distanceMeters: source.distanceMeters } : {}),
  };
}
