'use client';

import {
  isValidElement,
  type CSSProperties,
  type HTMLAttributes,
  type ReactNode,
} from 'react';

import { cn } from '@/lib/utils';

function shimmerCopy(children: ReactNode): string {
  if (children == null || typeof children === 'boolean') {
    return '';
  }
  if (typeof children === 'string' || typeof children === 'number') {
    return String(children);
  }
  if (Array.isArray(children)) {
    return children.map(shimmerCopy).join('');
  }
  if (isValidElement<{ children?: ReactNode }>(children)) {
    return shimmerCopy(children.props.children);
  }
  return '';
}

export function TextShimmer({
  children,
  className,
  style,
  ...props
}: HTMLAttributes<HTMLSpanElement> & {
  readonly children: ReactNode;
}) {
  const copy = shimmerCopy(children);

  return (
    <span
      data-slot="text-shimmer"
      className={cn('text-shimmer relative inline-block w-fit max-w-full', className)}
      style={{ '--spread': '2.4em', ...style } as CSSProperties}
      {...props}
    >
      <span className="text-shimmer__text">{children}</span>
      {copy ? (
        <span
          aria-hidden
          className="text-shimmer__highlight"
          data-text={copy}
        />
      ) : null}
    </span>
  );
}
