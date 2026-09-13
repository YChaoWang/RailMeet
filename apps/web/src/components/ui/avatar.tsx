import * as React from 'react';

import { cn } from '@/lib/utils';

export function Avatar({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      data-slot="avatar"
      className={cn(
        'relative inline-flex size-8 shrink-0 rounded-full',
        className,
      )}
      {...props}
    />
  );
}

export function AvatarImage({
  className,
  alt,
  ...props
}: React.ImgHTMLAttributes<HTMLImageElement>) {
  return (
    <img
      alt={alt}
      className={cn('aspect-square size-full rounded-full object-cover', className)}
      {...props}
    />
  );
}

export function AvatarFallback({
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        'flex size-full items-center justify-center overflow-hidden rounded-full text-xs font-bold text-white',
        className,
      )}
      {...props}
    />
  );
}

export function AvatarGroup({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="avatar-group"
      className={cn('flex items-center -space-x-2', className)}
      {...props}
    />
  );
}

export function AvatarGroupCount({
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        'relative inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-mist-100 text-xs font-semibold text-ink-700 ring-2 ring-white',
        className,
      )}
      {...props}
    />
  );
}
