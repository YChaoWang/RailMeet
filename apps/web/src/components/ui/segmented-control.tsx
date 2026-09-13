'use client';

import { useLayoutEffect, useRef, useState } from 'react';

import { cn } from '@/lib/utils';

export type SegmentedControlItem<T extends string> = {
  readonly value: T;
  readonly label: string;
};

export function SegmentedControl<T extends string>({
  value,
  items,
  onValueChange,
  'aria-label': ariaLabel,
  className,
}: {
  readonly value: T;
  readonly items: readonly SegmentedControlItem<T>[];
  readonly onValueChange: (value: T) => void;
  readonly 'aria-label': string;
  readonly className?: string;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const [indicator, setIndicator] = useState({ left: 0, width: 0 });

  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) {
      return;
    }

    const update = () => {
      const selected = list.querySelector<HTMLElement>('[aria-selected="true"]');
      if (!selected) {
        return;
      }
      setIndicator({
        left: selected.offsetLeft,
        width: selected.offsetWidth,
      });
    };

    update();
    const observer = new ResizeObserver(update);
    observer.observe(list);
    return () => observer.disconnect();
  }, [value, items]);

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label={ariaLabel}
      className={cn(
        'relative grid w-full min-w-0 rounded-xl bg-ink-950/8 p-1',
        className,
      )}
      style={{ gridTemplateColumns: `repeat(${Math.max(items.length, 1)}, minmax(0, 1fr))` }}
    >
      <span
        aria-hidden
        data-slot="segmented-indicator"
        className="pointer-events-none absolute top-1 z-0 rounded-lg bg-white shadow-sm transition-[left,width] duration-300 ease-out motion-reduce:transition-none"
        style={{ left: indicator.left, width: indicator.width, height: 'calc(100% - 0.5rem)' }}
      />
      {items.map((item) => {
        const selected = item.value === value;
        return (
          <button
            key={item.value}
            type="button"
            role="tab"
            aria-selected={selected}
            className={cn(
              'relative z-10 inline-flex min-h-11 min-w-0 items-center justify-center px-1 text-center text-[11px] font-medium leading-tight transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-950',
              selected ? 'text-ink-950' : 'text-ink-700 hover:text-ink-950',
            )}
            onClick={() => onValueChange(item.value)}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
