/**
 * Port of Transitous `ui/src/lib/modeStyle.ts` (motis-project/motis master).
 *
 * Divergence: unknown future MOTIS modes use a neutral “other” style.
 * Transitous falls through to a train icon/color; RailMeet must never do that.
 */

export type MotisColorable = {
  readonly mode: string;
  readonly routeColor?: string;
  readonly routeTextColor?: string;
  readonly rental?: { readonly formFactor?: string };
};

export type MotisModeIconKind =
  | 'walk'
  | 'bike'
  | 'cargo_bike'
  | 'car'
  | 'moped'
  | 'scooter'
  | 'seated_scooter'
  | 'taxi'
  | 'bus'
  | 'tram'
  | 'train'
  | 'metro'
  | 'ship'
  | 'plane'
  | 'funicular'
  | 'aerial_lift'
  | 'other';

function token(mode: string): string {
  return mode.trim().toUpperCase().replace(/[\s-]+/g, '_');
}

/**
 * Returns [icon kind, default background, default text].
 * Matches Transitous `getModeStyle` for known modes.
 */
export function getMotisModeStyle(leg: MotisColorable): readonly [MotisModeIconKind, string, string] {
  const mode = token(leg.mode);
  switch (mode) {
    case 'WALK':
      return ['walk', 'hsl(var(--foreground) / 1)', 'hsl(var(--background) / 1)'];
    case 'BIKE':
      return ['bike', 'hsl(var(--foreground) / 1)', 'hsl(var(--background) / 1)'];
    case 'RENTAL': {
      switch (leg.rental?.formFactor) {
        case 'BICYCLE':
          return ['bike', '#075985', 'white'];
        case 'CARGO_BICYCLE':
          return ['cargo_bike', '#075985', 'white'];
        case 'CAR':
          return ['car', '#4c4947', 'white'];
        case 'MOPED':
          return ['moped', '#075985', 'white'];
        case 'SCOOTER_SEATED':
          return ['seated_scooter', '#075985', 'white'];
        case 'SCOOTER_STANDING':
          return ['scooter', '#075985', 'white'];
        default:
          return ['other', '#075985', 'white'];
      }
    }
    case 'RIDE_SHARING':
      return ['car', '#217edb', 'white'];
    case 'CAR':
    case 'CAR_PARKING':
    case 'CAR_DROPOFF':
      return ['car', '#4c4947', 'white'];
    case 'FLEX':
    case 'ODM':
      return ['taxi', '#fdb813', 'white'];
    case 'TRANSIT':
    case 'BUS':
      return ['bus', '#ff9800', 'white'];
    case 'COACH':
      return ['bus', '#9ccc65', 'black'];
    case 'TRAM':
      return ['tram', '#edce00', 'white'];
    case 'SUBURBAN':
      return ['train', '#4caf50', 'white'];
    case 'SUBWAY':
      return ['metro', '#3f51b5', 'white'];
    case 'FERRY':
      return ['ship', '#00acc1', 'white'];
    case 'AIRPLANE':
      return ['plane', '#90a4ae', 'white'];
    case 'HIGHSPEED_RAIL':
      return ['train', '#9c27b0', 'white'];
    case 'LONG_DISTANCE':
      return ['train', '#e91e63', 'white'];
    case 'NIGHT_RAIL':
      return ['train', '#1a237e', 'white'];
    case 'REGIONAL_FAST_RAIL':
    case 'REGIONAL_RAIL':
    case 'RAIL':
      return ['train', '#f44336', 'white'];
    case 'FUNICULAR':
      return ['funicular', '#795548', 'white'];
    case 'CABLE_CAR':
      return ['tram', '#795548', 'white'];
    case 'AERIAL_LIFT':
    case 'AREAL_LIFT':
      return ['aerial_lift', '#795548', 'white'];
    case 'METRO':
      return ['train', '#4caf50', 'white'];
    case 'OTHER':
      return ['other', '#607d8b', 'white'];
    default:
      return ['other', '#607d8b', 'white'];
  }
}

const HEX_COLOR_RE = /^#?([0-9A-Fa-f]{6})$/;

/** Accept only RRGGBB / #RRGGBB. Reject CSS injection and named colors. */
export function sanitizeMotisHexColor(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const trimmed = value.trim();
  const match = HEX_COLOR_RE.exec(trimmed);
  if (!match) {
    return undefined;
  }
  return `#${match[1]!.toLowerCase()}`;
}

/** Neutral slate used when a mode default is not a literal hex color. */
const MODE_FALLBACK_COLOR = '#607d8b';

function channelLuminance(component: number): number {
  const channel = component / 255;
  return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

/**
 * WCAG relative luminance split for readable text over an arbitrary provider color.
 * Only `#rrggbb` (already sanitized) is accepted; anything else defaults to white.
 */
export function contrastTextForBackground(background: string): string {
  const sanitized = sanitizeMotisHexColor(background);
  if (!sanitized) {
    return '#ffffff';
  }
  const red = Number.parseInt(sanitized.slice(1, 3), 16);
  const green = Number.parseInt(sanitized.slice(3, 5), 16);
  const blue = Number.parseInt(sanitized.slice(5, 7), 16);
  const luminance =
    0.2126 * channelLuminance(red) +
    0.7152 * channelLuminance(green) +
    0.0722 * channelLuminance(blue);
  return luminance > 0.179 ? '#000000' : '#ffffff';
}

/**
 * Transitous `getColor`: prefer valid provider routeColor / routeTextColor.
 * When the provider gives a color but no usable text color, contrast against
 * that color instead of the mode default (which may be unreadable on it).
 */
export function getMotisRouteColors(leg: MotisColorable): readonly [string, string] {
  const [, defaultColor, defaultTextColor] = getMotisModeStyle(leg);
  const routeColor = sanitizeMotisHexColor(leg.routeColor);
  if (!routeColor) {
    return [defaultColor, defaultTextColor];
  }
  const text = sanitizeMotisHexColor(leg.routeTextColor);
  return [routeColor, text ?? contrastTextForBackground(routeColor)];
}

function hexFromModeTextColor(value: string): string | undefined {
  if (value === 'white') {
    return '#ffffff';
  }
  if (value === 'black') {
    return '#000000';
  }
  return sanitizeMotisHexColor(value);
}

export type MotisRoutePaint = {
  readonly color: string;
  readonly textColor: string;
  readonly colorSource: 'provider' | 'mode-fallback';
};

/**
 * Map-safe paint for one leg. `mode-fallback` marks legs where the provider
 * published no usable routeColor, so the UI can flag it instead of implying
 * the color is official.
 */
export function resolveMapRoutePaint(leg: MotisColorable): MotisRoutePaint {
  const [color, textColor] = getMotisRouteColors(leg);
  const providerColor = sanitizeMotisHexColor(leg.routeColor);
  if (!providerColor) {
    const [, fallbackColor, fallbackTextColor] = getMotisModeStyle(leg);
    // Mode defaults may be CSS custom properties (walk/bike) or the literals
    // "white"/"black"; resolve to hex so MapLibre paint never receives
    // `hsl(var(--…))` while keeping the Transitous palette pairing intact.
    const safeColor = sanitizeMotisHexColor(fallbackColor) ?? MODE_FALLBACK_COLOR;
    return {
      color: safeColor,
      textColor: hexFromModeTextColor(fallbackTextColor) ?? contrastTextForBackground(safeColor),
      colorSource: 'mode-fallback',
    };
  }
  return { color, textColor, colorSource: 'provider' };
}
