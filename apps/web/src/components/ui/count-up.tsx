'use client';

import { useInView, useMotionValue, useReducedMotion, useSpring } from 'motion/react';
import { useCallback, useEffect, useRef } from 'react';

interface CountUpProps {
  to: number;
  from?: number;
  direction?: 'up' | 'down';
  delay?: number;
  duration?: number;
  className?: string;
  startWhen?: boolean;
  separator?: string;
  onStart?: () => void;
  onEnd?: () => void;
}

export default function CountUp({
  to,
  from = 0,
  direction = 'up',
  delay = 0,
  duration = 2,
  className = '',
  startWhen = true,
  separator = '',
  onStart,
  onEnd,
}: CountUpProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const reduceMotion = useReducedMotion() === true;
  const startValue = direction === 'down' ? to : from;
  const endValue = direction === 'down' ? from : to;
  const motionValue = useMotionValue(startValue);
  const damping = 20 + 40 * (1 / duration);
  const stiffness = 100 * (1 / duration);
  const springValue = useSpring(motionValue, {
    damping,
    stiffness,
  });
  const isInView = useInView(ref, { once: true, margin: '0px' });

  const getDecimalPlaces = (num: number): number => {
    const str = num.toString();
    if (str.includes('.')) {
      const decimals = str.split('.')[1];
      if (decimals && parseInt(decimals, 10) !== 0) {
        return decimals.length;
      }
    }
    return 0;
  };

  const maxDecimals = Math.max(getDecimalPlaces(from), getDecimalPlaces(to));

  const formatValue = useCallback(
    (latest: number) => {
      const hasDecimals = maxDecimals > 0;
      const options: Intl.NumberFormatOptions = {
        useGrouping: Boolean(separator),
        minimumFractionDigits: hasDecimals ? maxDecimals : 0,
        maximumFractionDigits: hasDecimals ? maxDecimals : 0,
      };
      const formattedNumber = Intl.NumberFormat('en-US', options).format(latest);
      return separator ? formattedNumber.replace(/,/g, separator) : formattedNumber;
    },
    [maxDecimals, separator],
  );

  useEffect(() => {
    if (ref.current) {
      ref.current.textContent = formatValue(startValue);
    }
  }, [formatValue, startValue]);

  useEffect(() => {
    if (!isInView || !startWhen) {
      return;
    }
    if (reduceMotion) {
      if (ref.current) {
        ref.current.textContent = formatValue(endValue);
      }
      onStart?.();
      onEnd?.();
      return;
    }
    onStart?.();
    const timeoutId = window.setTimeout(() => {
      motionValue.set(endValue);
    }, delay * 1000);
    const durationTimeoutId = window.setTimeout(() => {
      onEnd?.();
    }, delay * 1000 + duration * 1000);
    return () => {
      window.clearTimeout(timeoutId);
      window.clearTimeout(durationTimeoutId);
    };
  }, [
    isInView,
    startWhen,
    motionValue,
    delay,
    onStart,
    onEnd,
    duration,
    reduceMotion,
    endValue,
    formatValue,
  ]);

  useEffect(() => {
    if (reduceMotion) {
      return;
    }
    const unsubscribe = springValue.on('change', (latest: number) => {
      if (ref.current) {
        ref.current.textContent = formatValue(latest);
      }
    });
    return () => unsubscribe();
  }, [springValue, formatValue, reduceMotion]);

  return (
    <span className={className} ref={ref}>
      {formatValue(startValue)}
    </span>
  );
}
