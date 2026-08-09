'use client';

import { PLACE_SEARCH_QUERY_MIN_LENGTH } from '@railmeet/shared';
import type { PlaceSuggestionView } from '@railmeet/validation';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { searchPlaces } from '@/lib/place-search-client';
import { cn } from '@/lib/utils';

const DEBOUNCE_MS = 300;

export type PlaceComboboxProps = {
  readonly id: string;
  readonly fieldPath: string;
  readonly valueText: string;
  readonly selected: PlaceSuggestionView | null;
  readonly disabled?: boolean;
  readonly invalid?: boolean;
  readonly onTextChange: (text: string) => void;
  readonly onSelect: (suggestion: PlaceSuggestionView) => void;
  readonly onClearSelection: () => void;
};

type LoadState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly suggestions: readonly PlaceSuggestionView[] }
  | { readonly kind: 'empty' }
  | { readonly kind: 'error'; readonly message: string };

function normalizeWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

/**
 * Accessible place autocomplete combobox backed by same-origin place search.
 * Never treats free text as a valid PlaceReference.
 */
export function PlaceCombobox({
  id,
  fieldPath,
  valueText,
  selected,
  disabled = false,
  invalid = false,
  onTextChange,
  onSelect,
  onClearSelection,
}: PlaceComboboxProps) {
  const listboxId = useId();
  const optionIdPrefix = useId();
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [loadState, setLoadState] = useState<LoadState>({ kind: 'idle' });
  const requestSeq = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const optionRefs = useRef<Array<HTMLLIElement | null>>([]);

  const queryReady = normalizeWhitespace(valueText).length >= PLACE_SEARCH_QUERY_MIN_LENGTH;

  useEffect(() => {
    if (selected) {
      setLoadState({ kind: 'idle' });
      setOpen(false);
      return;
    }
    if (!queryReady) {
      abortRef.current?.abort();
      setLoadState({ kind: 'idle' });
      setOpen(false);
      return;
    }

    const seq = ++requestSeq.current;
    const timer = window.setTimeout(() => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setLoadState({ kind: 'loading' });
      setOpen(true);

      void searchPlaces(normalizeWhitespace(valueText), { signal: controller.signal }).then(
        (result) => {
          if (seq !== requestSeq.current) {
            return;
          }
          if (!result.ok) {
            if (controller.signal.aborted) {
              return;
            }
            setLoadState({ kind: 'error', message: result.error.message });
            setOpen(true);
            return;
          }
          if (result.data.suggestions.length === 0) {
            setLoadState({ kind: 'empty' });
            setActiveIndex(-1);
            setOpen(true);
            return;
          }
          setLoadState({ kind: 'ready', suggestions: result.data.suggestions });
          setActiveIndex(0);
          setOpen(true);
        },
        (error: unknown) => {
          if (seq !== requestSeq.current) {
            return;
          }
          if (controller.signal.aborted) {
            return;
          }
          setLoadState({
            kind: 'error',
            message:
              error instanceof Error
                ? 'Place suggestions are temporarily unavailable. Try again.'
                : 'Place suggestions are temporarily unavailable. Try again.',
          });
          setOpen(true);
        },
      );
    }, DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timer);
    };
  }, [valueText, selected, queryReady]);

  useEffect(() => {
    if (activeIndex < 0) {
      return;
    }
    optionRefs.current[activeIndex]?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, loadState]);

  const suggestions = loadState.kind === 'ready' ? loadState.suggestions : [];

  const selectAt = (index: number) => {
    const suggestion = suggestions[index];
    if (!suggestion) {
      return;
    }
    if (!suggestion.countryCode) {
      setLoadState({
        kind: 'error',
        message: 'That place is missing a country code and cannot be used yet.',
      });
      return;
    }
    onSelect(suggestion);
    setOpen(false);
    setLoadState({ kind: 'idle' });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      setOpen(false);
      setActiveIndex(-1);
      return;
    }
    if (!open && (event.key === 'ArrowDown' || event.key === 'ArrowUp') && suggestions.length > 0) {
      setOpen(true);
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (suggestions.length === 0) {
        return;
      }
      setActiveIndex((current) => (current + 1) % suggestions.length);
      setOpen(true);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (suggestions.length === 0) {
        return;
      }
      setActiveIndex((current) => (current <= 0 ? suggestions.length - 1 : current - 1));
      setOpen(true);
      return;
    }
    if (event.key === 'Enter' && open && activeIndex >= 0) {
      event.preventDefault();
      selectAt(activeIndex);
    }
  };

  const activeOptionId =
    open && activeIndex >= 0 ? `${optionIdPrefix}-opt-${activeIndex}` : undefined;

  return (
    <div className="relative space-y-1.5">
      <Input
        id={id}
        role="combobox"
        data-field={fieldPath}
        value={valueText}
        disabled={disabled}
        autoComplete="off"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-activedescendant={activeOptionId}
        aria-invalid={invalid}
        placeholder="Search a station or city"
        className={cn(selected ? 'border-teal-600 bg-teal-50/40' : undefined)}
        onChange={(event) => {
          const next = event.target.value;
          onTextChange(next);
          if (selected) {
            onClearSelection();
          }
        }}
        onKeyDown={onKeyDown}
        onBlur={() => {
          // Delay close so option click registers.
          window.setTimeout(() => setOpen(false), 120);
        }}
        onFocus={() => {
          if (
            loadState.kind === 'ready' ||
            loadState.kind === 'empty' ||
            loadState.kind === 'error'
          ) {
            setOpen(true);
          }
        }}
      />
      {selected ? (
        <p className="text-xs text-teal-800" data-testid="place-selected-hint">
          Selected · {selected.secondaryLabel ?? selected.type}
        </p>
      ) : null}
      {open ? (
        <div
          className="absolute z-30 mt-1 max-h-56 w-full overflow-y-auto overflow-x-hidden rounded-lg border border-ink-700/15 bg-white shadow-lg"
          data-testid="place-suggestion-panel"
        >
          {loadState.kind === 'loading' ? (
            <p className="px-3 py-2 text-sm text-ink-700" role="status">
              Searching places…
            </p>
          ) : null}
          {loadState.kind === 'empty' ? (
            <p className="px-3 py-2 text-sm text-ink-700" role="status">
              No matching places
            </p>
          ) : null}
          {loadState.kind === 'error' ? (
            <div className="space-y-2 px-3 py-2">
              <p className="text-sm text-red-700" role="alert">
                {loadState.message}
              </p>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  onTextChange(`${valueText}`);
                  // Force effect by bumping via identical text + clear: re-run by toggling.
                  requestSeq.current += 1;
                  const controller = new AbortController();
                  abortRef.current = controller;
                  setLoadState({ kind: 'loading' });
                  void searchPlaces(normalizeWhitespace(valueText), {
                    signal: controller.signal,
                  }).then((result) => {
                    if (!result.ok) {
                      setLoadState({ kind: 'error', message: result.error.message });
                      return;
                    }
                    if (result.data.suggestions.length === 0) {
                      setLoadState({ kind: 'empty' });
                      return;
                    }
                    setLoadState({ kind: 'ready', suggestions: result.data.suggestions });
                    setActiveIndex(0);
                  });
                }}
              >
                Retry
              </Button>
            </div>
          ) : null}
          {loadState.kind === 'ready' ? (
            <ul id={listboxId} role="listbox" className="py-1">
              {suggestions.map((suggestion, index) => {
                const active = index === activeIndex;
                return (
                  <li
                    key={suggestion.providerId}
                    id={`${optionIdPrefix}-opt-${index}`}
                    role="option"
                    aria-selected={active}
                    ref={(node) => {
                      optionRefs.current[index] = node;
                    }}
                    className={cn(
                      'cursor-pointer px-3 py-2 text-sm',
                      active ? 'bg-teal-50 text-ink-950' : 'text-ink-950',
                    )}
                    onMouseDown={(event) => {
                      event.preventDefault();
                      selectAt(index);
                    }}
                    onMouseEnter={() => setActiveIndex(index)}
                  >
                    <div className="font-medium leading-snug">{suggestion.name}</div>
                    <div className="truncate text-xs text-ink-700">
                      {suggestion.secondaryLabel ?? suggestion.type}
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export const PLACE_COMBOBOX_DEBOUNCE_MS = DEBOUNCE_MS;
