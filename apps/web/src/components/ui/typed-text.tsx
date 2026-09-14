'use client';

import { useReducedMotion } from 'motion/react';
import { useEffect, useState } from 'react';

import { cn } from '@/lib/utils';

export const TYPED_TEXT_MS_PER_CHAR = 18;
export const TYPED_TEXT_GAP_MS = 80;

export function typedTextDurationMs(text: string, delayMs = 0): number {
  return delayMs + text.length * TYPED_TEXT_MS_PER_CHAR;
}

export function TypedText({
  text,
  as: Comp = 'p',
  className,
  delayMs = 0,
  msPerChar = TYPED_TEXT_MS_PER_CHAR,
}: {
  readonly text: string;
  readonly as?: 'p' | 'h2' | 'span';
  readonly className?: string;
  readonly delayMs?: number;
  readonly msPerChar?: number;
}) {
  const reduceMotion = useReducedMotion() === true;
  const [visibleCount, setVisibleCount] = useState(reduceMotion ? text.length : 0);

  useEffect(() => {
    if (reduceMotion) {
      setVisibleCount(text.length);
      return;
    }

    setVisibleCount(0);
    let intervalId: number | undefined;
    const startId = window.setTimeout(() => {
      intervalId = window.setInterval(() => {
        setVisibleCount((count) => {
          if (count + 1 >= text.length && intervalId !== undefined) {
            window.clearInterval(intervalId);
            intervalId = undefined;
          }
          return Math.min(count + 1, text.length);
        });
      }, msPerChar);
    }, delayMs);

    return () => {
      window.clearTimeout(startId);
      if (intervalId !== undefined) {
        window.clearInterval(intervalId);
      }
    };
  }, [delayMs, msPerChar, reduceMotion, text]);

  const done = visibleCount >= text.length;

  return (
    <Comp className={cn('min-w-0', className)} data-slot="typed-text">
      {done ? (
        text
      ) : (
        <>
          <span className="sr-only">{text}</span>
          <span aria-hidden>
            {text.slice(0, visibleCount)}
            <span className="typed-text__caret" />
          </span>
        </>
      )}
    </Comp>
  );
}
