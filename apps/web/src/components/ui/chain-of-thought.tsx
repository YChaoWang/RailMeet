'use client';

import * as Collapsible from '@radix-ui/react-collapsible';
import { Brain, ChevronDown } from 'lucide-react';
import {
  createContext,
  useContext,
  useId,
  useState,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type LiHTMLAttributes,
  type OlHTMLAttributes,
  type ReactNode,
} from 'react';

import { TextShimmer } from '@/components/ui/text-shimmer';
import { cn } from '@/lib/utils';

type ChainOfThoughtContextValue = {
  readonly open: boolean;
  readonly setOpen: (open: boolean) => void;
  readonly isStreaming: boolean;
  readonly contentId: string;
};

const ChainOfThoughtContext = createContext<ChainOfThoughtContextValue | null>(null);

function useChainOfThought() {
  const context = useContext(ChainOfThoughtContext);
  if (!context) {
    throw new Error('ChainOfThought parts must be used within ChainOfThought');
  }
  return context;
}

function ChainOfThoughtRoot({
  children,
  className,
  isStreaming = false,
  defaultExpanded = false,
  isExpanded,
  onExpandedChange,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  readonly isStreaming?: boolean;
  readonly defaultExpanded?: boolean;
  readonly isExpanded?: boolean;
  readonly onExpandedChange?: (open: boolean) => void;
}) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultExpanded);
  const open = isExpanded ?? uncontrolledOpen;
  const setOpen = (next: boolean) => {
    if (isExpanded === undefined) {
      setUncontrolledOpen(next);
    }
    onExpandedChange?.(next);
  };
  const contentId = useId();

  return (
    <ChainOfThoughtContext.Provider value={{ open, setOpen, isStreaming, contentId }}>
      <Collapsible.Root open={open} onOpenChange={setOpen} asChild>
        <div
          data-slot="chain-of-thought"
          className={cn('chain-of-thought min-w-0', className)}
          aria-busy={isStreaming || undefined}
          {...props}
        >
          {children}
        </div>
      </Collapsible.Root>
    </ChainOfThoughtContext.Provider>
  );
}

function ChainOfThoughtTrigger({
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  const { isStreaming, contentId } = useChainOfThought();
  return (
    <Collapsible.Trigger asChild>
      <button
        type="button"
        data-slot="chain-of-thought-trigger"
        className={cn(
          'chain-of-thought__trigger inline-flex min-h-11 w-full items-center gap-2 rounded-lg px-1 text-left text-sm font-medium text-ink-950',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-950',
          '[&[data-state=open]>svg:last-child]:rotate-180',
          className,
        )}
        aria-controls={contentId}
        {...props}
      >
        <Brain className="size-4 shrink-0 text-ink-700" aria-hidden />
        {isStreaming ? (
          <span className="min-w-0 flex-1">
            <TextShimmer className="chain-of-thought__streaming-text text-sm font-medium text-ink-950">
              {children}
            </TextShimmer>
          </span>
        ) : (
          <span className="min-w-0 flex-1">{children}</span>
        )}
        <ChevronDown
          className="size-4 shrink-0 text-ink-700 transition-transform motion-reduce:transition-none"
          aria-hidden
        />
      </button>
    </Collapsible.Trigger>
  );
}

function ChainOfThoughtContent({
  className,
  children,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  const { contentId } = useChainOfThought();
  return (
    <Collapsible.Content
      id={contentId}
      data-slot="chain-of-thought-content"
      className={cn(
        'chain-of-thought__content overflow-hidden data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down',
        className,
      )}
      {...props}
    >
      <div className="pt-1">{children}</div>
    </Collapsible.Content>
  );
}

function ChainOfThoughtSteps({ className, ...props }: OlHTMLAttributes<HTMLOListElement>) {
  return (
    <ol
      data-slot="chain-of-thought-steps"
      className={cn('chain-of-thought__steps m-0 flex list-none flex-col p-0', className)}
      {...props}
    />
  );
}

function ChainOfThoughtStep({
  label,
  status = 'complete',
  className,
  children,
  ...props
}: LiHTMLAttributes<HTMLLIElement> & {
  readonly label?: ReactNode;
  readonly status?: 'complete' | 'active' | 'pending';
}) {
  const { isStreaming } = useChainOfThought();
  const streamingLabel = isStreaming && status === 'active';
  return (
    <li
      data-slot="chain-of-thought-step"
      data-status={status}
      aria-current={status === 'active' ? 'step' : undefined}
      className={cn(
        'chain-of-thought__step relative flex gap-3 motion-safe:animate-cot-in',
        status === 'pending' && 'opacity-50',
        className,
      )}
      {...props}
    >
      <div className="relative flex w-4 shrink-0 justify-center self-stretch" aria-hidden>
        <span
          className={cn(
            'relative z-10 mt-1.5 size-2 rounded-full ring-2 ring-white',
            status === 'complete' && 'bg-ink-700',
            status === 'active' && 'bg-ink-950 motion-safe:animate-pulse',
            status === 'pending' && 'bg-ink-700/35',
          )}
        />
        <span className="absolute top-3.5 bottom-0 left-1/2 w-px -translate-x-1/2 bg-ink-700/15 [[data-slot=chain-of-thought-step]:last-child_&]:hidden" />
      </div>
      <div className="min-w-0 flex-1 pb-4">
        {label ? (
          <p
            className={cn(
              'chain-of-thought__step-label w-fit max-w-full text-sm font-medium',
              streamingLabel ? 'chain-of-thought__streaming-text text-ink-950' : 'text-ink-950',
            )}
          >
            {streamingLabel ? <TextShimmer className="text-ink-950">{label}</TextShimmer> : label}
          </p>
        ) : null}
        {children ? (
          <div className="chain-of-thought__step-content mt-0.5 text-sm text-ink-700">{children}</div>
        ) : null}
      </div>
    </li>
  );
}

function ChainOfThoughtStreamingText({
  className,
  children,
  ...props
}: HTMLAttributes<HTMLSpanElement>) {
  const { isStreaming } = useChainOfThought();
  if (!isStreaming) {
    return (
      <span className={className} {...props}>
        {children}
      </span>
    );
  }
  return (
    <TextShimmer className={cn('chain-of-thought__streaming-text text-ink-700', className)} {...props}>
      {children}
    </TextShimmer>
  );
}

export const ChainOfThought = Object.assign(ChainOfThoughtRoot, {
  Trigger: ChainOfThoughtTrigger,
  Content: ChainOfThoughtContent,
  Steps: ChainOfThoughtSteps,
  Step: ChainOfThoughtStep,
  StreamingText: ChainOfThoughtStreamingText,
});
