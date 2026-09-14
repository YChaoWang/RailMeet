'use client';

import Link from 'next/link';
import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from 'react';

import { cn } from '@/lib/utils';

function PromptSuggestionRoot({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="prompt-suggestion"
      className={cn('prompt-suggestion min-w-0 space-y-2', className)}
      {...props}
    />
  );
}

function PromptSuggestionHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('prompt-suggestion__header space-y-0.5', className)} {...props} />;
}

function PromptSuggestionTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3
      className={cn('prompt-suggestion__title text-sm font-semibold text-ink-950', className)}
      {...props}
    />
  );
}

function PromptSuggestionDescription({
  className,
  ...props
}: HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p
      className={cn('prompt-suggestion__description text-xs text-ink-700', className)}
      {...props}
    />
  );
}

function PromptSuggestionItems({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('prompt-suggestion__items grid grid-cols-1 gap-2', className)} {...props} />
  );
}

const itemClassName = (className?: string) =>
  cn(
    'prompt-suggestion__item flex min-h-11 w-full min-w-0 flex-col items-start rounded-xl border border-ink-700/10 bg-white px-3 py-2 text-left transition-colors',
    'hover:bg-ink-950/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-950 dark:border-white/10 dark:hover:bg-white/10 dark:focus-visible:ring-mist-50',
    className,
  );

function PromptSuggestionItem({ className, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" className={itemClassName(className)} {...props} />;
}

function PromptSuggestionItemLink({
  className,
  href,
  children,
}: {
  readonly href: string;
  readonly className?: string;
  readonly children?: ReactNode;
}) {
  return (
    <Link href={href} className={itemClassName(className)}>
      {children}
    </Link>
  );
}

function PromptSuggestionItemTitle({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn('prompt-suggestion__item-title text-sm font-medium text-ink-950', className)}
      {...props}
    />
  );
}

function PromptSuggestionItemDescription({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn('prompt-suggestion__item-description mt-0.5 text-xs text-ink-700', className)}
      {...props}
    />
  );
}

function PromptSuggestionItemMeta({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <span className={cn('prompt-suggestion__item-meta text-[11px] text-ink-700', className)}>
      {children}
    </span>
  );
}

function PromptSuggestionItemTags({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('prompt-suggestion__item-tags mt-1 flex flex-wrap gap-1', className)}
      {...props}
    />
  );
}

function PromptSuggestionItemFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('prompt-suggestion__item-footer mt-1', className)} {...props} />;
}

export const PromptSuggestion = Object.assign(PromptSuggestionRoot, {
  Header: PromptSuggestionHeader,
  Title: PromptSuggestionTitle,
  Description: PromptSuggestionDescription,
  Items: PromptSuggestionItems,
  Item: PromptSuggestionItem,
  ItemLink: PromptSuggestionItemLink,
  ItemTitle: PromptSuggestionItemTitle,
  ItemDescription: PromptSuggestionItemDescription,
  ItemMeta: PromptSuggestionItemMeta,
  ItemTags: PromptSuggestionItemTags,
  ItemFooter: PromptSuggestionItemFooter,
});
