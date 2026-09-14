import { SiteHeader } from '@/components/layout/site-header';
import { LandingHero } from '@/components/landing/landing-hero';

export default function HomePage() {
  return (
    <div className="min-h-screen">
      <SiteHeader />
      <main>
        <LandingHero />
      </main>
    </div>
  );
}
