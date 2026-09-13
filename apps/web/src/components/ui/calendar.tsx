'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { DayPicker, type DayPickerProps } from 'react-day-picker';

import { cn } from '@/lib/utils';

export type CalendarProps = DayPickerProps;

const navButtonClass =
  'inline-flex size-9 items-center justify-center rounded-lg text-ink-950 hover:bg-mist-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 disabled:opacity-40';

export function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  ...props
}: CalendarProps) {
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn('w-fit p-3', className)}
      classNames={{
        months: 'relative flex flex-col',
        month: 'flex flex-col gap-3',
        month_caption: 'flex h-9 items-center justify-center px-9',
        caption_label: 'text-sm font-semibold text-ink-950',
        nav: 'absolute inset-x-0 top-0 flex items-center justify-between',
        button_previous: navButtonClass,
        button_next: navButtonClass,
        month_grid: 'w-full border-collapse',
        weekdays: 'flex',
        weekday: 'w-9 text-center text-[0.75rem] font-medium text-ink-700',
        week: 'mt-1 flex w-full',
        day: 'p-0 text-center',
        day_button:
          'inline-flex size-9 items-center justify-center rounded-lg text-sm text-ink-950 hover:bg-mist-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600',
        selected:
          '[&>button]:bg-teal-600 [&>button]:text-white [&>button]:hover:bg-teal-800',
        today: '[&>button]:bg-mist-100 [&>button]:font-semibold',
        outside: '[&>button]:text-ink-700/40',
        disabled: '[&>button]:text-ink-700/30 [&>button]:hover:bg-transparent',
        hidden: 'invisible',
        ...classNames,
      }}
      components={{
        Chevron: ({ orientation, className: chevronClass, ...chevronProps }) =>
          orientation === 'left' ? (
            <ChevronLeft className={cn('size-4', chevronClass)} {...chevronProps} />
          ) : (
            <ChevronRight className={cn('size-4', chevronClass)} {...chevronProps} />
          ),
      }}
      {...props}
    />
  );
}
