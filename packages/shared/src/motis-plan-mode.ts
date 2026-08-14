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
 * Coarse RailMeet `TransportMode` values are derived from these tokens for
 * search filters and ranking summaries. Precise subtype labels must be kept
 * for Journey Details.
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

const MOTIS_TO_DOMAIN: Readonly<Record<MotisPlanMode, TransportMode | 'walk' | 'other'>> = {
  WALK: 'walk',
  BIKE: 'other',
  RENTAL: 'other',
  CAR: 'other',
  CAR_PARKING: 'other',
  CAR_DROPOFF: 'other',
  ODM: 'other',
  RIDE_SHARING: 'other',
  FLEX: 'other',
  DEBUG_BUS_ROUTE: 'bus',
  DEBUG_RAILWAY_ROUTE: 'train',
  DEBUG_FERRY_ROUTE: 'ferry',
  TRANSIT: 'other',
  TRAM: 'tram',
  SUBWAY: 'metro',
  FERRY: 'ferry',
  AIRPLANE: 'other',
  BUS: 'bus',
  COACH: 'bus',
  RAIL: 'train',
  HIGHSPEED_RAIL: 'train',
  LONG_DISTANCE: 'train',
  NIGHT_RAIL: 'train',
  REGIONAL_FAST_RAIL: 'train',
  REGIONAL_RAIL: 'train',
  SUBURBAN: 'train',
  FUNICULAR: 'other',
  AERIAL_LIFT: 'other',
  OTHER: 'other',
  AREAL_LIFT: 'other',
  METRO: 'train',
  CABLE_CAR: 'other',
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

export type JourneyLegMode = TransportMode | 'walk' | 'other';

/**
 * Coarse RailMeet domain mode for ranking / allowed-mode filters.
 * Precise MOTIS tokens must still be stored separately for UI labels.
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
  if (normalized === 'train' || normalized === 'intercity' || normalized === 'high_speed_rail') {
    return 'train';
  }
  if (normalized === 'light_rail' || normalized === 'lightrail') {
    return 'tram';
  }
  if (normalized === 'boat') {
    return 'ferry';
  }
  return 'other';
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
