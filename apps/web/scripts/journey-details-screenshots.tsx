/**
 * Captures Journey Details screenshots for visual comparison.
 * Run: pnpm --filter @railmeet/web exec tsx ./scripts/journey-details-screenshots.tsx
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium, type Page } from 'playwright';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import type { MotisItineraryJson } from '@railmeet/shared';
import type { RankingLeg } from '../src/lib/journey-leg-presentation.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '../../..');
const outDir = resolve(repoRoot, 'tmp/journey-details-screenshots');
const fixtureDir = resolve(repoRoot, 'packages/routing/src/fixtures');

function loadFixture(name: string): MotisItineraryJson {
  return JSON.parse(readFileSync(resolve(fixtureDir, name), 'utf8')) as MotisItineraryJson;
}

function renderPage(title: string, body: string): string {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${title}</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script>
    tailwind.config = {
      theme: {
        extend: {
          colors: {
            ink: { 700: '#4b5563', 900: '#111827', 950: '#0a0f1a' },
            mist: { 50: '#f9fafb', 100: '#f3f4f6' },
            teal: { 50: '#f0fdfa', 600: '#0d9488', 800: '#115e59' },
          },
        },
      },
    };
  </script>
  <style>body{margin:24px;background:#fff;font-family:system-ui,sans-serif}</style>
</head>
<body>${body}</body>
</html>`;
}

async function screenshotSection(page: Page, selector: string, path: string) {
  await page.locator(selector).screenshot({ path });
}

const stationChangeItinerary: MotisItineraryJson = {
  duration: 7200,
  startTime: '2026-08-09T18:00:00Z',
  endTime: '2026-08-10T00:00:00Z',
  transfers: 1,
  legs: [
    {
      mode: 'COACH',
      displayName: 'FlixBus N814',
      agencyName: 'FlixBus',
      routeColor: '#73d700',
      routeTextColor: '#000000',
      startTime: '2026-08-09T18:00:00Z',
      endTime: '2026-08-09T22:00:00Z',
      duration: 14_400,
      from: { name: 'London Victoria Coach Station', tz: 'Europe/London' },
      to: { name: 'London Victoria Coach Station', tz: 'Europe/London' },
    },
    {
      mode: 'REGIONAL_RAIL',
      displayName: 'Southeastern',
      agencyName: 'Southeastern',
      routeColor: '#00a4e0',
      startTime: '2026-08-09T22:30:00Z',
      endTime: '2026-08-10T00:00:00Z',
      duration: 5400,
      from: { name: 'London St Pancras International', track: '5', tz: 'Europe/London' },
      to: { name: 'London Bridge', track: '2', tz: 'Europe/London' },
    },
  ],
};

const delayedItinerary: MotisItineraryJson = {
  duration: 600,
  startTime: '2026-09-15T10:05:00Z',
  endTime: '2026-09-15T10:15:00Z',
  transfers: 0,
  legs: [
    {
      mode: 'REGIONAL_RAIL',
      displayName: 'Northern',
      agencyName: 'Northern Rail',
      startTime: '2026-09-15T10:05:00Z',
      scheduledStartTime: '2026-09-15T10:00:00Z',
      endTime: '2026-09-15T10:15:00Z',
      scheduledEndTime: '2026-09-15T10:12:00Z',
      duration: 600,
      realTime: true,
      from: { name: 'Leeds', track: '3', tz: 'Europe/London' },
      to: { name: 'York', track: '5', tz: 'Europe/London' },
    },
  ],
};

const legacyLegs: RankingLeg[] = [
  {
    mode: 'train',
    departureAt: '2026-06-15T08:00:00.000Z',
    arrivalAt: '2026-06-15T09:00:00.000Z',
    durationMinutes: 60,
    geometry: null,
  },
];

type Scenario = {
  id: string;
  width: number;
  height: number;
  title: string;
  render: (
    JourneyItineraryDetails: typeof import('../src/components/search/journey-leg-details.tsx').JourneyItineraryDetails,
    RankingJourneyLegs: typeof import('../src/components/search/journey-leg-details.tsx').RankingJourneyLegs,
  ) => ReturnType<typeof createElement>;
};

const scenarios: Scenario[] = [
  {
    id: 'berlin-york-desktop',
    width: 1280,
    height: 1600,
    title: 'Berlin Hbf → York (Transitous fixture)',
    render: (JourneyItineraryDetails) =>
      createElement(JourneyItineraryDetails, {
        itinerary: loadFixture('transitous-berlin-york.json'),
        context: {
          participantDisplayName: 'David',
          originLabel: 'Berlin Hbf',
          destinationLabel: 'York',
        },
      }),
  },
  {
    id: 'berlin-york-mobile',
    width: 390,
    height: 2200,
    title: 'Berlin Hbf → York mobile',
    render: (JourneyItineraryDetails) =>
      createElement(JourneyItineraryDetails, {
        itinerary: loadFixture('transitous-berlin-york.json'),
        context: {
          participantDisplayName: 'David',
          originLabel: 'Berlin Hbf',
          destinationLabel: 'York',
        },
      }),
  },
  {
    id: 'manchester-york-direct',
    width: 480,
    height: 1200,
    title: 'Manchester → York',
    render: (JourneyItineraryDetails) =>
      createElement(JourneyItineraryDetails, {
        itinerary: loadFixture('transitous-manchester-york.json'),
        context: { originLabel: 'Manchester', destinationLabel: 'York' },
      }),
  },
  {
    id: 'station-change-transfer',
    width: 480,
    height: 900,
    title: 'Station-changing transfer',
    render: (JourneyItineraryDetails) =>
      createElement(JourneyItineraryDetails, {
        itinerary: stationChangeItinerary,
        context: { originLabel: 'London Victoria', destinationLabel: 'London Bridge' },
      }),
  },
  {
    id: 'delayed-service',
    width: 480,
    height: 700,
    title: 'Delayed service',
    render: (JourneyItineraryDetails) =>
      createElement(JourneyItineraryDetails, { itinerary: delayedItinerary }),
  },
  {
    id: 'legacy-fallback',
    width: 480,
    height: 700,
    title: 'Legacy fallback journey',
    render: (_JourneyItineraryDetails, RankingJourneyLegs) =>
      createElement(RankingJourneyLegs, {
        legs: legacyLegs,
        context: { originLabel: 'Berlin Hbf', destinationLabel: 'Munich Hbf' },
      }),
  },
];

async function main() {
  // tsx SSR loads components compiled without the Next.js JSX runtime.
  (globalThis as typeof globalThis & { React: typeof React }).React = React;
  const { JourneyItineraryDetails, RankingJourneyLegs } = await import(
    '../src/components/search/journey-leg-details.tsx'
  );

  mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch();

  for (const scenario of scenarios) {
    const markup = renderToStaticMarkup(
      createElement(
        'section',
        { id: 'journey', className: 'mx-auto max-w-md rounded-xl border border-ink-700/10 px-3 py-2' },
        scenario.render(JourneyItineraryDetails, RankingJourneyLegs),
      ),
    );
    const htmlPath = resolve(outDir, `${scenario.id}.html`);
    writeFileSync(htmlPath, renderPage(scenario.title, markup));

    const page = await browser.newPage({
      viewport: { width: scenario.width, height: scenario.height },
    });
    await page.goto(`file://${htmlPath}`);
    await page.waitForTimeout(300);
    await screenshotSection(page, '#journey', resolve(outDir, `${scenario.id}.png`));
    await page.close();
  }

  await browser.close();
  console.log(`Wrote screenshots to ${outDir}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
