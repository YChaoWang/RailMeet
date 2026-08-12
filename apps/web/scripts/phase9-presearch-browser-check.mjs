/**
 * Pre-search transit-map browser acceptance (Phase 9 follow-up).
 * Opens /search without submitting; verifies basemap tiles, stations, terrain, traveler marker.
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'fs';

const OUT = '/tmp/phase9-verify';
mkdirSync(OUT, { recursive: true });

const VIEWPORTS = [
  { name: 'd1440', width: 1440, height: 900 },
  { name: 't768', width: 768, height: 1024 },
  { name: 'm390', width: 390, height: 844 },
];

function classifyUrl(url) {
  if (/\/api\/v1\/map\/stops/.test(url)) return 'map-stops';
  if (/\/api\/v1\/meeting-searches/.test(url) || /\/v1\/meeting-searches/.test(url))
    return 'create-search';
  if (/\/plan(\?|$)/.test(url) || /\/api\/v1\/plan/.test(url)) return 'plan';
  if (/api\.transitous\.org/.test(url)) return 'transitous-direct';
  if (/motis/.test(url) && !/openfreemap|maplibre|localhost:3000/.test(url)) return 'motis-direct';
  if (/tiles\.openfreemap\.org\/fonts/.test(url)) return 'openfreemap-font';
  if (/tiles\.openfreemap\.org.*\.pbf/.test(url)) return 'openfreemap-pbf';
  if (/elevation-tiles-prod|terrarium/.test(url)) return 'terrain-dem';
  return null;
}

async function digMap(page) {
  return page.evaluate(() => {
    const wrap = document.querySelector('[data-testid="search-map"]');
    const canvas = document.querySelector('.maplibregl-canvas');
    const sheet = document.querySelector('[data-testid="planner-sheet"], .planner-sheet, aside');
    const markers = [...document.querySelectorAll('.railmeet-map-marker-origin')].map((el) => {
      const r = el.getBoundingClientRect();
      return {
        text: el.textContent,
        x: Math.round(r.x),
        y: Math.round(r.y),
        w: Math.round(r.width),
        h: Math.round(r.height),
        visible: r.width > 0 && r.height > 0,
      };
    });
    const mapRect = canvas?.getBoundingClientRect();
    const sheetRect = sheet?.getBoundingClientRect();
    return {
      styleReady: wrap?.getAttribute('data-style-ready'),
      stationStatus: wrap?.getAttribute('data-station-status'),
      markerCount: wrap?.getAttribute('data-marker-count'),
      appliedOrigins: wrap?.getAttribute('data-applied-origin-count'),
      appliedCoords: wrap?.getAttribute('data-applied-origin-coords'),
      canvas: canvas
        ? {
            w: Math.round(mapRect.width),
            h: Math.round(mapRect.height),
            visible: mapRect.width > 40 && mapRect.height > 40,
          }
        : null,
      sheetCoversMap:
        sheetRect && mapRect
          ? sheetRect.height >= mapRect.height * 0.95 && sheetRect.width >= mapRect.width * 0.95
          : false,
      markers,
      terrainBtn: Boolean(document.querySelector('.maplibregl-ctrl-terrain')),
      attrib: Boolean(document.querySelector('.maplibregl-ctrl-attrib')),
      popup:
        document.querySelector('.maplibregl-popup-content')?.textContent?.slice(0, 120) ?? null,
      zoomIn: Boolean(document.querySelector('.maplibregl-ctrl-zoom-in')),
      autocompleteEnabled: !document
        .querySelector('input[aria-autocomplete="list"]')
        ?.hasAttribute('disabled'),
      searchEnabled: !document.querySelector('button[type="submit"]')?.hasAttribute('disabled'),
    };
  });
}

async function pickOrigin(page, query) {
  const input = page.locator('input[aria-autocomplete="list"]').first();
  await input.click();
  await input.fill('');
  await input.type(query, { delay: 25 });
  await page.locator('[role="option"]').first().waitFor({ timeout: 25000 });
  const label = await page.locator('[role="option"]').first().innerText();
  await page.locator('[role="option"]').first().click();
  await page.waitForTimeout(800);
  return label;
}

async function runViewport(browser, vp) {
  const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
  const page = await context.newPage();
  const counts = {
    'map-stops': 0,
    'create-search': 0,
    plan: 0,
    'transitous-direct': 0,
    'motis-direct': 0,
    'openfreemap-pbf': 0,
    'openfreemap-font': 0,
    'terrain-dem': 0,
  };
  const mapStopUrls = [];

  page.on('request', (r) => {
    const kind = classifyUrl(r.url());
    if (!kind) return;
    counts[kind] += 1;
    if (kind === 'map-stops') {
      mapStopUrls.push(
        r
          .url()
          .replace(/https?:\/\/[^/]+/, '')
          .slice(0, 160),
      );
    }
  });

  await page.goto('http://localhost:3000/search', {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });
  await page.waitForSelector('.maplibregl-canvas', { timeout: 45000 });
  await page.waitForFunction(
    () => document.querySelector('[data-style-ready]')?.getAttribute('data-style-ready') === '1',
    null,
    { timeout: 45000 },
  );

  // Wait for initial station request to settle (ok/error/aggregated/zoom).
  await page
    .waitForFunction(
      () => {
        const s = document
          .querySelector('[data-station-status]')
          ?.getAttribute('data-station-status');
        return s && s !== 'idle' && s !== 'loading';
      },
      null,
      { timeout: 45000 },
    )
    .catch(() => {});
  await page.waitForTimeout(2500);

  const initial = await digMap(page);
  await page.screenshot({ path: `${OUT}/${vp.name}-01-presearch-basemap.png`, fullPage: false });
  const stopsAfterInitial = counts['map-stops'];

  // Pan map a bit — should not spam station requests continuously.
  const box = await page.locator('.maplibregl-canvas').boundingBox();
  if (box) {
    await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.45);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.55, { steps: 12 });
    await page.mouse.up();
  }
  await page.waitForTimeout(1200);
  const afterPan = await digMap(page);
  const stopsAfterPan = counts['map-stops'];

  // Zoom in for individual stations
  for (let i = 0; i < 2; i += 1) {
    await page.locator('.maplibregl-ctrl-zoom-in').click({ force: true });
    await page.waitForTimeout(500);
  }
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `${OUT}/${vp.name}-02-stations-detail.png`, fullPage: false });

  // Select Paris as Traveler A — local marker; still no create-search.
  const parisOpt = await pickOrigin(page, 'Paris');
  await page.waitForTimeout(1500);
  const afterParis = await digMap(page);
  await page.screenshot({ path: `${OUT}/${vp.name}-02b-paris-marker.png`, fullPage: false });

  // Try station popup near map center (above sheet on mobile).
  if (box) {
    const clickY =
      vp.height <= 900 ? box.y + Math.min(box.height * 0.35, 220) : box.y + box.height * 0.45;
    await page.mouse.click(box.x + box.width * 0.55, clickY);
    await page.waitForTimeout(600);
  }
  const afterClick = await digMap(page);

  // Terrain toggle (class flips to maplibregl-ctrl-terrain-enabled when on)
  const terrain = page.getByRole('button', { name: /toggle terrain/i });
  await terrain.click({ force: true, timeout: 10000 });
  await page.waitForTimeout(2500);
  const afterTerrainOn = await digMap(page);
  await page.screenshot({ path: `${OUT}/${vp.name}-03-terrain-on.png`, fullPage: false });

  await terrain.click({ force: true, timeout: 10000 });
  await page.waitForTimeout(1200);
  const afterTerrainOff = await digMap(page);
  await page.screenshot({
    path: `${OUT}/${vp.name}-04-terrain-off-paris-marker.png`,
    fullPage: false,
  });

  // Second city quick check only on desktop to keep runtime down
  let londonOpt = null;
  if (vp.name === 'd1440') {
    // Add traveler B if available, else overwrite is fine for network proof
    const addBtn = page.getByRole('button', { name: /add traveler/i });
    if (await addBtn.isVisible().catch(() => false)) {
      await addBtn.click();
      await page.waitForTimeout(300);
      const inputB = page.locator('input[aria-autocomplete="list"]').nth(1);
      await inputB.click();
      await inputB.type('London', { delay: 25 });
      await page.locator('[role="option"]').first().waitFor({ timeout: 20000 });
      londonOpt = await page.locator('[role="option"]').first().innerText();
      await page.locator('[role="option"]').first().click();
      await page.waitForTimeout(1000);
    }
  }

  const finalDig = await digMap(page);
  await context.close();

  return {
    viewport: vp,
    parisOpt,
    londonOpt,
    initial,
    afterPan,
    afterParis,
    afterClick,
    afterTerrainOn,
    afterTerrainOff,
    finalDig,
    counts,
    mapStopUrls: mapStopUrls.slice(0, 8),
    stopsAfterInitial,
    stopsAfterPan,
    assertions: {
      mapVisible: Boolean(initial.canvas?.visible),
      styleReady: initial.styleReady === '1',
      pbfLoaded: counts['openfreemap-pbf'] > 0,
      fontsLoaded: counts['openfreemap-font'] > 0,
      initialStationRequest: stopsAfterInitial >= 1,
      stationStatusOk: ['ready', 'aggregated'].includes(initial.stationStatus ?? ''),
      noCreateSearch: counts['create-search'] === 0,
      noPlan: counts['plan'] === 0,
      noTransitousDirect: counts['transitous-direct'] === 0,
      noMotisDirect: counts['motis-direct'] === 0,
      travelerAVisible: afterParis.markers.some((m) => m.visible && m.text?.includes('A')),
      terrainControlPresent: initial.terrainBtn,
      terrainDemRequested: counts['terrain-dem'] > 0,
      sheetDoesNotHideMap: !finalDig.sheetCoversMap,
      autocompleteUsable: finalDig.autocompleteEnabled,
    },
  };
}

const browser = await chromium.launch({ headless: true });
const results = [];
for (const vp of VIEWPORTS) {
  console.error(`Running ${vp.name}…`);
  results.push(await runViewport(browser, vp));
}
await browser.close();

const summary = {
  generatedAt: new Date().toISOString(),
  layerIds: {
    basemapPlaceLabels: [
      'label_city',
      'label_city_capital',
      'label_town',
      'label_village',
      'label_state',
      'label_country_1',
      'label_country_2',
      'label_country_3',
    ],
    basemapRails: [
      'road_major_rail',
      'road_major_rail_hatching',
      'road_transit_rail',
      'road_transit_rail_hatching',
      'bridge_major_rail',
      'bridge_major_rail_hatching',
      'bridge_transit_rail',
      'bridge_transit_rail_hatching',
      'tunnel_major_rail',
      'tunnel_major_rail_hatching',
      'tunnel_transit_rail',
      'tunnel_transit_rail_hatching',
    ],
    basemapTransitPoi: 'poi_transit',
    stationSource: 'railmeet-viewport-stations',
    stationLayers: [
      'railmeet-viewport-stations-clusters',
      'railmeet-viewport-stations-cluster-count',
      'railmeet-viewport-stations-points',
      'railmeet-viewport-stations-labels',
    ],
    terrainSource: 'railmeet-terrain-dem',
    hillshadeLayer: 'railmeet-terrain-hillshade',
  },
  results,
};

writeFileSync(`${OUT}/presearch-report.json`, JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));

const failed = results.flatMap((r) =>
  Object.entries(r.assertions)
    .filter(([, ok]) => !ok)
    .map(([k]) => `${r.viewport.name}:${k}`),
);
if (failed.length) {
  console.error('FAILED assertions:', failed.join(', '));
  process.exit(1);
}
console.error('All viewport assertions passed.');
