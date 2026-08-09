import Link from 'next/link';

export function SiteHeader() {
  return (
    <header className="border-b border-ink-700/10 bg-white/80 backdrop-blur-sm">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4 sm:px-6">
        <Link href="/" className="font-display text-2xl tracking-tight text-primary-900">
          RailMeet
        </Link>
        <Link
          href="/search"
          className="inline-flex min-h-11 items-center rounded-xl px-3 text-sm font-medium text-primary-800 hover:bg-primary-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
        >
          New search
        </Link>
      </div>
    </header>
  );
}
