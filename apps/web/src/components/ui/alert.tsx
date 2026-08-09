import * as React from 'react';

import { cn } from '@/lib/utils';

export function Alert({
  className,
  variant = 'default',
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { variant?: 'default' | 'destructive' | 'warning' }) {
  return (
    <div
      role="alert"
      className={cn(
        'rounded-xl border px-4 py-3 text-sm',
        variant === 'default' && 'border-primary-700/15 bg-primary-50 text-ink-900',
        variant === 'destructive' && 'border-red-200 bg-red-50 text-red-900',
        variant === 'warning' && 'border-amber-200 bg-amber-50 text-amber-950',
        className,
      )}
      {...props}
    />
  );
}

export function AlertTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h4 className={cn('mb-1 font-medium', className)} {...props} />;
}

export function AlertDescription({
  className,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>) {
  return <div className={cn('text-sm opacity-90 [&_p]:leading-relaxed', className)} {...props} />;
}
