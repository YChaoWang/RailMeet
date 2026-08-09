import Link from 'next/link';

import { SiteHeader } from '@/components/layout/site-header';
import { Button } from '@/components/ui/button';

export default function HomePage() {
  return (
    <div className="min-h-screen">
      <SiteHeader />
      <main className="mx-auto flex min-h-[calc(100vh-4.5rem)] max-w-3xl flex-col justify-center px-6 py-16">
        <p className="font-display text-5xl tracking-tight text-primary-900 sm:text-6xl">
          RailMeet
        </p>
        <h1 className="mt-6 max-w-xl text-2xl font-medium leading-snug text-ink-900 sm:text-3xl">
          Meet in the fairest city your trains can reach.
        </h1>
        <p className="mt-4 max-w-lg text-lg leading-relaxed text-ink-700">
          RailMeet ranks European meeting cities from real public-transport journeys — balancing
          fairness, travel time, transfers, and arrival alignment.
        </p>
        <div className="mt-10">
          <Button asChild size="lg">
            <Link href="/search">Start a search</Link>
          </Button>
        </div>
      </main>
    </div>
  );
}
