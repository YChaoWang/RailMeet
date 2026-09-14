import { Search } from 'lucide-react';
import Link from 'next/link';

import { ThemeToggle } from '@/components/theme-toggle';

export function SiteHeader() {
  return (
    <header className="border-b border-ink-700/10 bg-white/80 backdrop-blur-sm dark:border-white/10 dark:bg-[#121a26]/80">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4 sm:px-6">
        <Link
          href="/"
          className="font-display text-2xl tracking-tight text-primary-900 dark:text-mist-50"
        >
          RailMeet
        </Link>
        <div className="flex items-center gap-1">
          <ThemeToggle />
          <Link
            href="/search"
            className="inline-flex min-h-11 items-center gap-1.5 rounded-xl px-3 text-sm font-medium text-primary-800 hover:bg-primary-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:text-mist-50 dark:hover:bg-white/10"
          >
            <Search className="size-4 shrink-0" aria-hidden />
            New search
          </Link>
        </div>
      </div>
    </header>
  );
}
