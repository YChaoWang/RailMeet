import * as React from 'react';

import { cn } from '@/lib/utils';

function TimelineRoot({ className, ...props }: React.OlHTMLAttributes<HTMLOListElement>) {
  return (
    <ol
      data-slot="timeline"
      className={cn('m-0 flex min-w-0 list-none flex-col p-0', className)}
      {...props}
    />
  );
}

function TimelineItem({ className, ...props }: React.LiHTMLAttributes<HTMLLIElement>) {
  return (
    <li
      data-slot="timeline-item"
      className={cn('relative flex list-none gap-2.5', className)}
      {...props}
    />
  );
}

function TimelineLeading({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="timeline-leading"
      className={cn('w-[5.75rem] shrink-0 pt-0.5', className)}
      {...props}
    />
  );
}

function TimelineRail({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="timeline-rail"
      aria-hidden
      className={cn('relative flex w-5 shrink-0 justify-center self-stretch', className)}
      {...props}
    />
  );
}

function TimelineMarker({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      data-slot="timeline-marker"
      className={cn(
        'relative z-10 mt-1.5 size-2 shrink-0 rounded-full bg-teal-600 ring-2 ring-white',
        className,
      )}
      {...props}
    />
  );
}

function TimelineConnector({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      data-slot="timeline-connector"
      className={cn('absolute top-3.5 bottom-0 left-1/2 w-px -translate-x-1/2 bg-teal-600/70', className)}
      {...props}
    />
  );
}

function TimelineContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="timeline-content"
      className={cn('min-w-0 flex-1 pb-4', className)}
      {...props}
    />
  );
}

function TimelineCard({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="timeline-card"
      className={cn(
        'mt-2 rounded-2xl border border-ink-700/15 px-3.5 py-3',
        className,
      )}
      {...props}
    />
  );
}

export const Timeline = Object.assign(TimelineRoot, {
  Item: TimelineItem,
  Leading: TimelineLeading,
  Rail: TimelineRail,
  Marker: TimelineMarker,
  Connector: TimelineConnector,
  Content: TimelineContent,
  Card: TimelineCard,
});
