import * as React from 'react';

import { cn } from '@/lib/utils';

export function Badge({
  className,
  variant = 'default',
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { variant?: 'default' | 'success' | 'muted' }) {
  return (
    <div
      className={cn(
        'inline-flex items-center rounded-lg border px-2.5 py-1 text-xs font-medium',
        variant === 'default' && 'border-primary-700/20 bg-primary-50 text-primary-800',
        variant === 'success' && 'border-teal-600/20 bg-teal-50 text-teal-800',
        variant === 'muted' && 'border-ink-700/10 bg-mist-100 text-ink-700',
        className,
      )}
      {...props}
    />
  );
}
