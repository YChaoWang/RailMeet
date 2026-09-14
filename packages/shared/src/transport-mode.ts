/**
 * Transitous planner public-transport filters, in planner order.
 * `train` / `metro` / `flight` are accepted only when reading older searches.
 */
export const TRANSPORT_MODES = [
  'airplane',
  'highspeed_rail',
  'long_distance',
  'night_rail',
  'coach',
  'ride_sharing',
  'regional_rail',
  'suburban',
  'subway',
  'tram',
  'bus',
  'ferry',
  'odm',
  'funicular',
  'aerial_lift',
  'other',
] as const;

const LEGACY_TRANSPORT_MODES = ['train', 'metro', 'flight'] as const;

export const PERSISTED_TRANSPORT_MODES = [
  ...TRANSPORT_MODES,
  ...LEGACY_TRANSPORT_MODES,
] as const;

export type TransportMode = (typeof TRANSPORT_MODES)[number];
export type PersistedTransportMode = (typeof PERSISTED_TRANSPORT_MODES)[number];

export const TRANSPORT_MODE_LABELS: Readonly<Record<TransportMode, string>> = {
  airplane: 'Airplane',
  highspeed_rail: 'High-speed rail',
  long_distance: 'Intercity rail',
  night_rail: 'Night rail',
  coach: 'Coach',
  ride_sharing: 'Ride sharing',
  regional_rail: 'Regional rail',
  suburban: 'Suburban rail',
  subway: 'Subway',
  tram: 'Tram',
  bus: 'Bus',
  ferry: 'Ferry',
  odm: 'On-demand',
  funicular: 'Funicular',
  aerial_lift: 'Aerial lift',
  other: 'Other',
};

const TRANSPORT_MODE_SET: ReadonlySet<string> = new Set(TRANSPORT_MODES);
const PERSISTED_TRANSPORT_MODE_SET: ReadonlySet<string> = new Set(PERSISTED_TRANSPORT_MODES);

export function isTransportMode(value: string): value is PersistedTransportMode {
  return PERSISTED_TRANSPORT_MODE_SET.has(value);
}

function isSelectableTransportMode(value: string): value is TransportMode {
  return TRANSPORT_MODE_SET.has(value);
}

function expandTransportModes(modes: readonly string[]): readonly TransportMode[] {
  const selected = new Set<TransportMode>();
  for (const mode of modes) {
    if (mode === 'train') {
      selected.add('highspeed_rail');
      selected.add('long_distance');
      selected.add('night_rail');
      selected.add('regional_rail');
      selected.add('suburban');
      continue;
    }
    if (mode === 'metro') {
      selected.add('subway');
      continue;
    }
    if (mode === 'flight') {
      selected.add('airplane');
      continue;
    }
    if (isSelectableTransportMode(mode)) {
      selected.add(mode);
    }
  }
  return TRANSPORT_MODES.filter((mode) => selected.has(mode));
}

/**
 * Transitous `transitModes` query value.
 * Every current filter (or an omitted list) → `TRANSIT`.
 */
export function transitousTransitModesQuery(modes: readonly string[] | undefined): string {
  const expanded = expandTransportModes(modes && modes.length > 0 ? modes : TRANSPORT_MODES);
  if (expanded.length === TRANSPORT_MODES.length) {
    return 'TRANSIT';
  }
  return expanded.map((mode) => mode.toUpperCase()).join(',');
}
