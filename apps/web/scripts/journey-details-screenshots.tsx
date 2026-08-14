/**
 * Captures real React Journey Details screenshots for Manchester→York.
 * Run: pnpm --filter @railmeet/web exec tsx ./scripts/journey-details-screenshots.tsx
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import type { MotisItineraryJson } from '@railmeet/shared';

import {
  JourneyItineraryDetails,
  JourneyRouteSummary,
} from '../src/components/search/journey-leg-details.tsx';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '../../..');
const outDir = resolve(repoRoot, 'tmp/journey-details-screenshots');

const fixture = JSON.parse(
  readFileSync(
    resolve(repoRoot, 'packages/routing/src/fixtures/transitous-manchester-york.json'),
    'utf8',
  ),
) as MotisItineraryJson;

const summaryMarkup = renderToStaticMarkup(
  createElement(
    'section',
    {
      id: 'summary',
      className: 'rounded-xl border border-ink-700/10 px-3 py-3',
      style: { maxWidth: 420 },
    },
    createElement('p', { className: 'text-xs text-ink-700' }, 'Rank 1'),
    createElement('p', { className: 'text-base font-semibold text-ink-950' }, 'York'),
    createElement(
      'p',
      { className: 'mt-2 text-xs text-ink-700' },
      'Spread 0 min · 1 h 43 min combined · 2 transfers',
    ),
    createElement(JourneyRouteSummary, { itinerary: fixture }),
    createElement('p', { className: 'mt-1 text-xs text-ink-700' }, 'Alex 1 h 43 min'),
  ),
);

const detailsMarkup = renderToStaticMarkup(
  createElement(
    'section',
    {
      id: 'details',
      className: 'rounded-xl border border-ink-700/10 px-3 py-2',
      style: { maxWidth: 420 },
    },
    createElement('p', { className: 'py-2 text-sm font-medium' }, 'Journey details'),
    createElement(JourneyItineraryDetails, { itinerary: fixture }),
  ),
);

const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>RailMeet Journey Details</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script>
    tailwind.config = {
      theme: {
        extend: {
          colors: {
            ink: { 700: '#4b5563', 900: '#111827', 950: '#0a0f1a' },
            mist: { 100: '#f3f4f6' },
            teal: { 50: '#f0fdfa', 600: '#0d9488', 800: '#115e59' },
          },
        },
      },
    };
  </script>
  <style>body{margin:24px;background:#fff}</style>
</head>
<body>
  <h1 class="mb-4 text-lg font-semibold text-ink-950">Manchester → York (fixture)</h1>
  ${summaryMarkup}
  <div class="h-4"></div>
  ${detailsMarkup}
</body>
</html>`;

mkdirSync(outDir, { recursive: true });
const htmlPath = resolve(outDir, 'fixture.html');
writeFileSync(htmlPath, html);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 480, height: 1100 } });
await page.goto(`file://${htmlPath}`);
await page.waitForTimeout(300);
await page.locator('#summary').screenshot({ path: resolve(outDir, '01-list-summary.png') });
await page.locator('#details').screenshot({
  path: resolve(outDir, '02-journey-details-expanded.png'),
});
await browser.close();

console.log(`Wrote screenshots to ${outDir}`);
