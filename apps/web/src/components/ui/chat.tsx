'use client';

import { motion, useReducedMotion } from 'motion/react';
import type { HTMLAttributes, ReactNode } from 'react';

import { cn } from '@/lib/utils';

const CHAT_WATERFALL_STEP_MS = 200;

type ChatWaterfallItemProps = {
  readonly index?: number;
  readonly as?: 'div' | 'li';
  readonly className?: string;
  readonly children?: ReactNode;
  readonly 'data-testid'?: string;
};

export function ChatWaterfallItem({
  index = 0,
  as = 'div',
  className,
  children,
  'data-testid': dataTestId,
}: ChatWaterfallItemProps) {
  const reduceMotion = useReducedMotion() === true;
  const Comp = as === 'li' ? motion.li : motion.div;

  return (
    <Comp
      data-slot="chat-waterfall-item"
      {...(dataTestId ? { 'data-testid': dataTestId } : {})}
      className={cn('min-w-0', className)}
      initial={reduceMotion ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={
        reduceMotion
          ? { duration: 0 }
          : {
              delay: index * (CHAT_WATERFALL_STEP_MS / 1000),
              duration: 0.45,
              ease: 'easeOut',
            }
      }
    >
      {children}
    </Comp>
  );
}

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
