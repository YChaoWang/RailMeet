import {
  getMotisModeStyle,
  motisPlanModeLabel,
  type MotisModeIconKind,
} from '@railmeet/shared';
import type { PlaceSuggestionView } from '@railmeet/validation';
import {
  Building2,
  Bus,
  CableCar,
  Car,
  CircleHelp,
  Footprints,
  MapPin,
  Plane,
  Ship,
  TrainFront,
  type LucideIcon,
} from 'lucide-react';

export type PlaceSuggestionType = PlaceSuggestionView['type'];

const TYPE_LABEL: Record<PlaceSuggestionType, string> = {
  STOP: 'Station',
  PLACE: 'City',
  ADDRESS: 'Address',
};

const TYPE_ICON: Record<PlaceSuggestionType, LucideIcon> = {
  STOP: TrainFront,
  PLACE: Building2,
  ADDRESS: MapPin,
};

const TYPE_BADGE_CLASS: Record<PlaceSuggestionType, string> = {
  STOP: 'bg-teal-100 text-teal-800',
  PLACE: 'bg-sky-100 text-sky-800',
  ADDRESS: 'bg-ink-100 text-ink-700',
};

const MODE_ICONS: Record<MotisModeIconKind, LucideIcon> = {
  walk: Footprints,
  bike: Footprints,
  cargo_bike: Footprints,
  car: Car,
  moped: Car,
  scooter: Footprints,
  seated_scooter: Footprints,
  taxi: Car,
  bus: Bus,
  tram: CableCar,
  train: TrainFront,
  metro: TrainFront,
  ship: Ship,
  plane: Plane,
  funicular: CableCar,
  aerial_lift: CableCar,
  other: CircleHelp,
};

export function placeSuggestionTypeLabel(type: PlaceSuggestionType): string {
  return TYPE_LABEL[type];
}

export function placeSuggestionTypeIcon(type: PlaceSuggestionType): LucideIcon {
  return TYPE_ICON[type];
}

export function placeSuggestionTypeBadgeClass(type: PlaceSuggestionType): string {
  return TYPE_BADGE_CLASS[type];
}

/** Locality / country line without the leading type prefix from secondaryLabel. */
export function placeSuggestionLocalityLine(suggestion: PlaceSuggestionView): string | null {
  const secondary = suggestion.secondaryLabel?.trim();
  if (!secondary) {
    return null;
  }
  const prefix = `${TYPE_LABEL[suggestion.type]} · `;
  if (secondary.startsWith(prefix)) {
    const locality = secondary.slice(prefix.length).trim();
    return locality.length > 0 ? locality : null;
  }
  return secondary;
}

export type PlaceSuggestionModeChip = {
  readonly mode: string;
  readonly label: string;
  readonly iconKind: MotisModeIconKind;
  readonly backgroundColor: string;
  readonly textColor: string;
};

const PLACE_SUGGESTION_MODE_LIMIT = 4;

export function placeSuggestionModeChips(
  modes: readonly string[],
): readonly PlaceSuggestionModeChip[] {
  const seen = new Set<string>();
  const chips: PlaceSuggestionModeChip[] = [];

  for (const rawMode of modes) {
    const mode = rawMode.trim();
    if (!mode || seen.has(mode)) {
      continue;
    }
    seen.add(mode);
    const [iconKind, backgroundColor, textColor] = getMotisModeStyle({ mode });
    chips.push({
      mode,
      label: motisPlanModeLabel(mode),
      iconKind,
      backgroundColor,
      textColor,
    });
    if (chips.length >= PLACE_SUGGESTION_MODE_LIMIT) {
      break;
    }
  }

  return chips;
}

export function placeSuggestionModeOverflowCount(modes: readonly string[]): number {
  const unique = new Set(modes.map((mode) => mode.trim()).filter((mode) => mode.length > 0));
  return Math.max(0, unique.size - PLACE_SUGGESTION_MODE_LIMIT);
}

export function placeSuggestionModeIcon(kind: MotisModeIconKind): LucideIcon {
  return MODE_ICONS[kind];
}

/** Screen-reader label for listbox options (icons and chips are decorative). */
export function placeSuggestionOptionAriaLabel(suggestion: PlaceSuggestionView): string {
  const parts = [suggestion.name, placeSuggestionTypeLabel(suggestion.type)];
  const locality = placeSuggestionLocalityLine(suggestion);
  if (locality) {
    parts.push(locality);
  }
  const modeLabels = placeSuggestionModeChips(suggestion.modes).map((chip) => chip.label);
  if (modeLabels.length > 0) {
    parts.push(modeLabels.join(', '));
  }
  return parts.join(', ');
}
