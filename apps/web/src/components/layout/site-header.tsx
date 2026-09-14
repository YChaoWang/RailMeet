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
        <ThemeToggle />
      </div>
    </header>
  );
}
