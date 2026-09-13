'use client';

import type { HTMLAttributes } from 'react';

import { cn } from '@/lib/utils';

export function ChatThread({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="chat-thread"
      role="log"
      aria-label="Search conversation"
      className={cn('flex min-w-0 flex-col gap-4', className)}
      {...props}
    />
  );
}

export function ChatUser({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex justify-end', className)} {...props} />;
}

export function ChatAssistant({ className, children, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('flex min-w-0 gap-2.5', className)} {...props}>
      <span
        className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-ink-950 text-[10px] font-bold text-white"
        aria-hidden
      >
        R
      </span>
      <div className="min-w-0 flex-1 space-y-3">
        <p className="text-[11px] font-medium uppercase tracking-wide text-ink-700">RailMeet</p>
        {children}
      </div>
    </div>
  );
}
