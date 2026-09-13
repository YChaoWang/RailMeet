'use client';

import { Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';

import { cn } from '@/lib/utils';

export function ThemeToggle({ className }: { readonly className?: string }) {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const dark = mounted && resolvedTheme === 'dark';

  return (
    <button
      type="button"
      className={cn(
        'inline-flex size-11 shrink-0 items-center justify-center rounded-lg text-ink-950 hover:bg-ink-950/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-950 dark:text-mist-50 dark:hover:bg-white/10 dark:focus-visible:ring-mist-50',
        className,
      )}
      aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
      data-testid="theme-toggle"
      onClick={() => setTheme(dark ? 'light' : 'dark')}
    >
      {dark ? <Sun className="size-4" aria-hidden /> : <Moon className="size-4" aria-hidden />}
    </button>
  );
}
