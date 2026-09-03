import {
  canonicalMotisModeToken,
  getMotisModeStyle,
  getMotisRouteColors,
  isMotisWalkLeg,
  joinInterlinedMotisLegs,
  motisDirectionLabel,
  motisLegAgencyName,
  motisLegDisplayName,
  motisPlaceName,
  motisPlaceTrack,
  motisPlanModeLabel,
  type MotisColorable,
  type MotisItineraryJson,
  type MotisLegJson,
  type MotisModeIconKind,
  type MotisPlaceJson,
} from '@railmeet/shared';

export type RankingLeg = {
  readonly mode: string;
  readonly motisMode?: string | undefined;
  readonly displayName?: string | undefined;
  readonly agencyName?: string | undefined;
  readonly headsign?: string | undefined;
  readonly departureAt: string;
  readonly arrivalAt: string;
  readonly durationMinutes: number;
  readonly from?: { readonly name: string; readonly track?: string | undefined } | undefined;
  readonly to?: { readonly name: string; readonly track?: string | undefined } | undefined;
  readonly intermediateStopCount?: number | undefined;
  readonly distanceMeters?: number | undefined;
  readonly routeColor?: string | undefined;
  readonly routeTextColor?: string | undefined;
};

const RANKING_MODE_TO_MOTIS: Record<string, string> = {
  walk: 'WALK',
  train: 'RAIL',
  bus: 'BUS',
  metro: 'SUBWAY',
  tram: 'TRAM',
  ferry: 'FERRY',
  other: 'OTHER',
};

/** Exact MOTIS token for a ranking leg, preferring the persisted provider token. */
export function rankingLegMotisMode(leg: {
  readonly mode: string;
  readonly motisMode?: string | undefined;
}): string {
  return leg.motisMode ?? RANKING_MODE_TO_MOTIS[leg.mode] ?? canonicalMotisModeToken(leg.mode);
}

/** Legacy ranking-leg fallback only. Does not invent stop names or provider fields. */
export function rankingLegToMotis(leg: RankingLeg): MotisLegJson {
  const motisMode = rankingLegMotisMode(leg);
  let mapped: MotisLegJson = {
    mode: motisMode,
    startTime: leg.departureAt,
    endTime: leg.arrivalAt,
    duration: leg.durationMinutes * 60,
  };
  if (leg.displayName) {
    mapped = { ...mapped, displayName: leg.displayName };
  }
  if (leg.agencyName) {
    mapped = { ...mapped, agencyName: leg.agencyName };
  }
  if (leg.headsign) {
    mapped = { ...mapped, headsign: leg.headsign };
  }
  if (leg.routeColor) {
    mapped = { ...mapped, routeColor: leg.routeColor };
  }
  if (leg.routeTextColor) {
    mapped = { ...mapped, routeTextColor: leg.routeTextColor };
  }
  if (typeof leg.distanceMeters === 'number') {
    mapped = { ...mapped, distance: leg.distanceMeters };
  }
  if (!mapped.displayName) {
    mapped = { ...mapped, displayName: motisPlanModeLabel(motisMode) };
  }
  if (leg.from) {
    mapped = {
      ...mapped,
      from: leg.from.track ? { name: leg.from.name, track: leg.from.track } : { name: leg.from.name },
    };
  }
  if (leg.to) {
    mapped = {
      ...mapped,
      to: leg.to.track ? { name: leg.to.name, track: leg.to.track } : { name: leg.to.name },
    };
  }
  return mapped;
}

export function displayLegsFromItinerary(itinerary: MotisItineraryJson): MotisLegJson[] {
  return joinInterlinedMotisLegs(itinerary.legs);
}

export function motisServiceLabel(leg: MotisLegJson): string {
  return motisLegDisplayName(leg) ?? motisPlanModeLabel(leg.mode);
}

export function motisOperatorLabel(leg: MotisLegJson): string | undefined {
  return motisLegAgencyName(leg);
}

export function motisIconKind(leg: MotisLegJson): MotisModeIconKind {
  return getMotisModeStyle(leg)[0];
}

export function motisChipColors(leg: MotisColorable): { background: string; color: string } {
  const [background, color] = getMotisRouteColors(leg);
  return { background, color };
}

export function isWalkLike(leg: MotisLegJson): boolean {
  return isMotisWalkLeg(leg) || motisIconKind(leg) === 'walk';
}

export function formatMotisClock(iso: string | undefined, timeZone?: string): string {
  if (!iso) {
    return '';
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: timeZone ?? 'UTC',
  }).format(date);
}

export function formatMotisDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds / 60));
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  if (hours === 0) {
    return `${minutes} min`;
  }
  if (minutes === 0) {
    return `${hours} h`;
  }
  return `${hours} h ${minutes} min`;
}

export function formatMotisDistance(meters: number): string {
  if (meters >= 1000) {
    const km = meters / 1000;
    const rounded = km >= 10 ? Math.round(km) : Math.round(km * 10) / 10;
    return `${rounded} km`;
  }
  return `${Math.round(meters)} m`;
}

export function stopCountLabel(count: number): string {
  if (count <= 0) {
    return '0 stops';
  }
  return count === 1 ? '1 stop' : `${count} stops`;
}

export function platformLabel(place: MotisPlaceJson | undefined, mode: string): string | undefined {
  const track = motisPlaceTrack(place);
  if (!track) {
    return undefined;
  }
  const icon = getMotisModeStyle({ mode })[0];
  const noun = icon === 'train' || icon === 'metro' ? 'Track' : 'Platform';
  return `${noun} ${track}`;
}

export function directionLine(leg: MotisLegJson): string | undefined {
  const label = motisDirectionLabel(leg);
  return label ? `Toward ${label}` : undefined;
}

export function placeTitle(place: MotisPlaceJson | undefined, fallback: string): string {
  const name = motisPlaceName(place);
  if (!name || name === 'START' || name === 'END') {
    return fallback;
  }
  return name;
}
