'use client';

import { EUROPE_ISO_COUNTRY_CODES, SEARCHABLE_EUROPE_COUNTRY_COUNT } from '@railmeet/shared';
import type { FillLayerSpecification } from 'maplibre-gl';

import CountUp from '@/components/ui/count-up';
import { Map, MapGeoJSON } from '@/components/ui/map';
import SpecularButton from '@/components/ui/specular-button';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { WORLD_GEOJSON } from '@/lib/use-world-data';

type FillPaint = NonNullable<FillLayerSpecification['paint']>;

function europeCoverageFillPaint(scheme: 'light' | 'dark'): FillPaint {
  const covered = scheme === 'dark' ? '#8fb3d6' : '#1e3a5f';
  const rest = scheme === 'dark' ? '#243044' : '#c8d4e0';
  return {
    'fill-color': [
      'match',
      ['coalesce', ['get', 'ISO_A2'], ''],
      [...EUROPE_ISO_COUNTRY_CODES],
      covered,
      rest,
    ],
    'fill-opacity': 0.95,
  };
}

function getStartedSpecularColors(scheme: 'light' | 'dark') {
  if (scheme === 'dark') {
    return {
      tint: '#8fb3d6',
      textColor: '#152033',
      lineColor: '#f4f7fb',
      baseColor: '#1e3a5f',
    };
  }
  return {
    tint: '#1e3a5f',
    textColor: '#f4f7fb',
    lineColor: '#e8eef5',
    baseColor: '#12263f',
  };
}

function CoverageMap() {
  const scheme = useColorScheme();
  return (
    <div className="h-[min(42vh,420px)] w-full lg:h-full lg:min-h-[28rem]">
      <Map
        blank
        center={[10, 25]}
        zoom={1.45}
        dragRotate={false}
        pitchWithRotate={false}
        className="h-full w-full"
      >
        <MapGeoJSON data={WORLD_GEOJSON} linePaint={false} fillPaint={europeCoverageFillPaint(scheme)} />
      </Map>
    </div>
  );
}

export function LandingHero() {
  const scheme = useColorScheme();
  const cta = getStartedSpecularColors(scheme);
  return (
    <div className="mx-auto grid min-h-[calc(100vh-4.5rem)] w-full max-w-6xl items-center gap-10 px-6 py-12 lg:grid-cols-[minmax(0,28rem)_minmax(0,1fr)] lg:gap-16 lg:py-0">
      <div>
        <p className="font-display text-5xl tracking-tight text-primary-900 dark:text-mist-50 sm:text-6xl">
          RailMeet
        </p>
        <h1 className="mt-6 max-w-xl text-2xl font-medium leading-snug text-ink-900 dark:text-mist-50 sm:text-3xl">
          Meet in the fairest city your trains can reach.
        </h1>
        <p className="mt-4 max-w-lg text-lg leading-relaxed text-ink-700">
          RailMeet ranks European meeting cities from real public-transport journeys — balancing
          fairness, travel time, transfers, and arrival alignment.
        </p>
        <p
          className="mt-8 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-ink-900 dark:text-mist-50"
          aria-label={`Search from ${SEARCHABLE_EUROPE_COUNTRY_COUNT} European countries`}
        >
          <CountUp
            from={0}
            to={SEARCHABLE_EUROPE_COUNTRY_COUNT}
            direction="up"
            duration={1}
            delay={0}
            className="font-display text-5xl tabular-nums tracking-tight sm:text-6xl"
          />
          <span className="max-w-[12rem] text-base leading-snug text-ink-700">
            European countries you can search from
          </span>
        </p>
        <div className="mt-10">
          <SpecularButton
            href="/search"
            size="lg"
            radius={18}
            tint={cta.tint}
            tintOpacity={1}
            blur={0}
            textColor={cta.textColor}
            lineColor={cta.lineColor}
            baseColor={cta.baseColor}
            intensity={1}
            shineSize={50}
            shineFade={40}
            thickness={1}
            speed={0.35}
            followMouse
            proximity={250}
            autoAnimate={false}
          >
            Get Started
          </SpecularButton>
        </div>
      </div>
      <div className="min-h-[min(42vh,420px)] w-full self-stretch overflow-hidden lg:min-h-[28rem]" aria-hidden>
        <CoverageMap />
      </div>
    </div>
  );
}
