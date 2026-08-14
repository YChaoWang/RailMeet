import type { PlaceSuggestionView } from '@railmeet/validation';

import {
  placeSuggestionLocalityLine,
  placeSuggestionModeChips,
  placeSuggestionModeIcon,
  placeSuggestionModeOverflowCount,
  placeSuggestionTypeBadgeClass,
  placeSuggestionTypeIcon,
  placeSuggestionTypeLabel,
} from '@/lib/place-suggestion-presentation';
import { cn } from '@/lib/utils';

export type PlaceSuggestionOptionProps = {
  readonly suggestion: PlaceSuggestionView;
  readonly compact?: boolean;
  readonly className?: string;
  readonly 'data-testid'?: string;
};

export function PlaceSuggestionOption({
  suggestion,
  compact = false,
  className,
  'data-testid': dataTestId,
}: PlaceSuggestionOptionProps) {
  const TypeIcon = placeSuggestionTypeIcon(suggestion.type);
  const typeLabel = placeSuggestionTypeLabel(suggestion.type);
  const locality = placeSuggestionLocalityLine(suggestion);
  const modeChips = placeSuggestionModeChips(suggestion.modes);
  const modeOverflow = placeSuggestionModeOverflowCount(suggestion.modes);
  const badgeSize = compact ? 'h-7 w-7' : 'h-9 w-9';
  const iconSize = compact ? 'h-3.5 w-3.5' : 'h-4 w-4';

  return (
    <div className={cn('flex min-w-0 gap-3', className)} data-testid={dataTestId}>
      <div
        className={cn(
          'flex shrink-0 items-center justify-center rounded-lg',
          badgeSize,
          placeSuggestionTypeBadgeClass(suggestion.type),
        )}
        aria-hidden
      >
        <TypeIcon className={iconSize} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <span className={cn('font-medium leading-snug text-ink-950', compact && 'text-sm')}>
            {suggestion.name}
          </span>
          <span className="shrink-0 pt-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink-500">
            {typeLabel}
          </span>
        </div>
        {locality ? (
          <p className={cn('truncate text-ink-600', compact ? 'text-[11px]' : 'text-xs')}>
            {locality}
          </p>
        ) : null}
        {modeChips.length > 0 ? (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {modeChips.map((chip) => {
              const ModeIcon = placeSuggestionModeIcon(chip.iconKind);
              return (
                <span
                  key={chip.mode}
                  className="inline-flex max-w-full items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium leading-none"
                  style={{ backgroundColor: chip.backgroundColor, color: chip.textColor }}
                >
                  <ModeIcon className="h-3 w-3 shrink-0" aria-hidden />
                  <span className="truncate">{chip.label}</span>
                </span>
              );
            })}
            {modeOverflow > 0 ? (
              <span className="inline-flex items-center rounded-full bg-ink-100 px-1.5 py-0.5 text-[10px] font-medium text-ink-700">
                +{modeOverflow} more
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
