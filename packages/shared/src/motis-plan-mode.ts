/**
 * MOTIS `/api/v5/plan` Mode enum, pinned to motis@2.10.2.
 *
 * RailMeet is pinned to MOTIS `/api/v5/plan` (`motis@2.10.2`).
 * Transitous current OpenAPI (same tag) documents `/api/v6/plan` as the live
 * plan endpoint and `/api/v6/refresh-itinerary` for reconstruction.
 * Do not claim Transitous itself is pinned to v5.
 *
 * Source: https://github.com/motis-project/motis/blob/v2.10.2/openapi.yaml
 * (`components.schemas.Mode`). Do not invent a parallel taxonomy.
 *
 * Since MOTIS 2.5.0 / v5: `METRO` was renamed to `SUBURBAN`, `AREAL_LIFT` to
 * `AERIAL_LIFT`. Deprecated tokens remain in the schema and may still appear.
 * `REGIONAL_FAST_RAIL` is deprecated in favour of `REGIONAL_RAIL`.
 *
 * RailMeet filter modes are derived from these tokens. Precise tokens stay on
 * the leg as `motisMode` for Journey Details.
 */

import { type TransportMode } from './transport-mode.js';

export const MOTIS_PLAN_OPENAPI_PIN = 'motis@2.10.2:/api/v5/plan' as const;

/**
 * Exhaustive MOTIS v5 Mode enum (OpenAPI order: street, then transit, then
 * deprecated aliases).
 */
export const MOTIS_PLAN_MODES = [
  'WALK',
  'BIKE',
  'RENTAL',
  'CAR',
  'CAR_PARKING',
  'CAR_DROPOFF',
  'ODM',
  'RIDE_SHARING',
  'FLEX',
  'DEBUG_BUS_ROUTE',
  'DEBUG_RAILWAY_ROUTE',
  'DEBUG_FERRY_ROUTE',
  'TRANSIT',
  'TRAM',
  'SUBWAY',
  'FERRY',
  'AIRPLANE',
  'BUS',
  'COACH',
  'RAIL',
  'HIGHSPEED_RAIL',
  'LONG_DISTANCE',
  'NIGHT_RAIL',
  'REGIONAL_FAST_RAIL',
  'REGIONAL_RAIL',
  'SUBURBAN',
  'FUNICULAR',
  'AERIAL_LIFT',
  'OTHER',
  'AREAL_LIFT',
  'METRO',
  'CABLE_CAR',
] as const;

export type MotisPlanMode = (typeof MOTIS_PLAN_MODES)[number];

const MOTIS_PLAN_MODE_SET: ReadonlySet<string> = new Set(MOTIS_PLAN_MODES);

/** Neutral label for unknown future MOTIS tokens — never "Train". */
export const UNKNOWN_MOTIS_MODE_LABEL = 'Other transport' as const;

/**
 * Precise, user-visible labels for every MOTIS v5 mode.
 * Rail subtypes stay distinct; deprecated aliases keep the current meaning.
 */
export const MOTIS_PLAN_MODE_LABELS: Readonly<Record<MotisPlanMode, string>> = {
  WALK: 'Walk',
  BIKE: 'Bike',
  RENTAL: 'Shared mobility',
  CAR: 'Car',
  CAR_PARKING: 'Park and ride',
  CAR_DROPOFF: 'Car drop-off',
  ODM: 'On-demand transport',
  RIDE_SHARING: 'Ride sharing',
  FLEX: 'Flexible transport',
  DEBUG_BUS_ROUTE: UNKNOWN_MOTIS_MODE_LABEL,
  DEBUG_RAILWAY_ROUTE: UNKNOWN_MOTIS_MODE_LABEL,
  DEBUG_FERRY_ROUTE: UNKNOWN_MOTIS_MODE_LABEL,
  TRANSIT: 'Transit',
  TRAM: 'Tram',
  SUBWAY: 'Metro',
  FERRY: 'Ferry',
  AIRPLANE: 'Flight',
  BUS: 'Bus',
  COACH: 'Coach',
  RAIL: 'Rail',
  HIGHSPEED_RAIL: 'High-speed rail',
  LONG_DISTANCE: 'Intercity rail',
  NIGHT_RAIL: 'Night rail',
  REGIONAL_FAST_RAIL: 'Regional express',
  REGIONAL_RAIL: 'Regional rail',
  SUBURBAN: 'Suburban rail',
  FUNICULAR: 'Funicular',
  AERIAL_LIFT: 'Aerial lift',
  OTHER: UNKNOWN_MOTIS_MODE_LABEL,
  AREAL_LIFT: 'Aerial lift',
  // Deprecated v5 alias of SUBURBAN (not SUBWAY).
  METRO: 'Suburban rail',
  CABLE_CAR: 'Cable car',
};

export type JourneyLegMode = TransportMode | 'walk' | 'unmapped';

const MOTIS_TO_DOMAIN: Readonly<Record<MotisPlanMode, JourneyLegMode>> = {
  WALK: 'walk',
  BIKE: 'unmapped',
  RENTAL: 'unmapped',
  CAR: 'unmapped',
  CAR_PARKING: 'unmapped',
  CAR_DROPOFF: 'unmapped',
  ODM: 'odm',
  RIDE_SHARING: 'ride_sharing',
  FLEX: 'unmapped',
  DEBUG_BUS_ROUTE: 'bus',
  DEBUG_RAILWAY_ROUTE: 'regional_rail',
  DEBUG_FERRY_ROUTE: 'ferry',
  TRANSIT: 'unmapped',
  TRAM: 'tram',
  SUBWAY: 'subway',
  FERRY: 'ferry',
  AIRPLANE: 'airplane',
  BUS: 'bus',
  COACH: 'coach',
  RAIL: 'regional_rail',
  HIGHSPEED_RAIL: 'highspeed_rail',
  LONG_DISTANCE: 'long_distance',
  NIGHT_RAIL: 'night_rail',
  REGIONAL_FAST_RAIL: 'regional_rail',
  REGIONAL_RAIL: 'regional_rail',
  SUBURBAN: 'suburban',
  FUNICULAR: 'funicular',
  AERIAL_LIFT: 'aerial_lift',
  OTHER: 'other',
  AREAL_LIFT: 'aerial_lift',
  METRO: 'suburban',
  CABLE_CAR: 'unmapped',
};

export function canonicalMotisModeToken(rawMode: string): string {
  return rawMode.trim().toUpperCase().replace(/[\s-]+/g, '_');
}

export function isMotisPlanMode(value: string): value is MotisPlanMode {
  return MOTIS_PLAN_MODE_SET.has(canonicalMotisModeToken(value));
}

export function parseMotisPlanMode(rawMode: string): MotisPlanMode | undefined {
  const token = canonicalMotisModeToken(rawMode);
  return isMotisPlanMode(token) ? token : undefined;
}

/**
 * Human label for a MOTIS mode token. Unknown future tokens → "Other transport".
 */
export function motisPlanModeLabel(rawMode: string | undefined): string {
  if (!rawMode || rawMode.trim().length === 0) {
    return UNKNOWN_MOTIS_MODE_LABEL;
  }
  const parsed = parseMotisPlanMode(rawMode);
  if (!parsed) {
    return UNKNOWN_MOTIS_MODE_LABEL;
  }
  return MOTIS_PLAN_MODE_LABELS[parsed];
}

/**
 * RailMeet filter mode for ranking summaries. Precise tokens stay on `motisMode`.
 */
export function mapMotisPlanModeToDomain(rawMode: string): JourneyLegMode {
  const parsed = parseMotisPlanMode(rawMode);
  if (parsed) {
    return MOTIS_TO_DOMAIN[parsed];
  }
  const normalized = rawMode.trim().toLowerCase().replace(/[\s-]+/g, '_');
  // Historical / non-enum aliases seen in older feeds — still structured tokens.
  if (normalized === 'foot') {
    return 'walk';
  }
  if (normalized === 'train') {
    return 'regional_rail';
  }
  if (normalized === 'intercity') {
    return 'long_distance';
  }
  if (normalized === 'high_speed_rail') {
    return 'highspeed_rail';
  }
  if (normalized === 'light_rail' || normalized === 'lightrail') {
    return 'tram';
  }
  if (normalized === 'boat') {
    return 'ferry';
  }
  return 'unmapped';
}

export type JourneyServiceIdentity = {
  readonly motisMode?: string;
  readonly displayName?: string;
  readonly routeShortName?: string;
  readonly tripShortName?: string;
  readonly agencyName?: string;
};

function firstNonEmpty(...values: readonly (string | undefined)[]): string | undefined {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) {
      return trimmed;
    }
  }
  return undefined;
}

/**
 * Service/route identity: display name → short name → trip/train number →
 * precise MOTIS mode label. Never invents an operator or a "Train" fallback
 * for unknown modes.
 */
export function formatJourneyServiceLabel(identity: JourneyServiceIdentity): string {
  return (
    firstNonEmpty(identity.displayName, identity.routeShortName, identity.tripShortName) ??
    motisPlanModeLabel(identity.motisMode)
  );
}

/**
 * Operator line from provider agency fields. Missing data is omitted (undefined),
 * never replaced with "Unknown operator" or inferred from country/station.
 */
export function formatJourneyOperatorLabel(identity: JourneyServiceIdentity): string | undefined {
  return firstNonEmpty(identity.agencyName);
}
