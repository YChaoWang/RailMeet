import { cva, type VariantProps } from 'class-variance-authority';
import { Slot } from '@radix-ui/react-slot';
import * as React from 'react';

import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 min-h-11 px-4 py-2',
  {
    variants: {
      variant: {
        default: 'bg-primary-700 text-white hover:bg-primary-800',
        secondary: 'bg-mist-100 text-ink-900 hover:bg-mist-50 border border-ink-700/10',
        outline: 'border border-ink-700/20 bg-white hover:bg-mist-50 text-ink-900',
        ghost: 'hover:bg-mist-100 text-ink-900',
        link: 'text-primary-700 underline-offset-4 hover:underline min-h-0 px-0',
      },
      size: {
        default: 'min-h-11 px-4',
        sm: 'min-h-10 rounded-lg px-3',
        lg: 'min-h-12 rounded-xl px-6 text-base',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
    );
  },
);
Button.displayName = 'Button';
