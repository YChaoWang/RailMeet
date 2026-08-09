/**
 * Copies MapLibre worker assets into `public/` so `setWorkerUrl` is same-origin.
 * Required for MapLibre GL JS v6 under Next.js (vector tiles + GeoJSON clustering).
 */
import { copyFileSync, mkdirSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const webRoot = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.dirname(require.resolve('maplibre-gl/dist/maplibre-gl.mjs'));
const outDir = path.join(webRoot, '../public/maplibre');

mkdirSync(outDir, { recursive: true });

for (const file of ['maplibre-gl-worker.mjs', 'maplibre-gl-shared.mjs']) {
  const from = path.join(distDir, file);
  const to = path.join(outDir, file);
  if (!existsSync(from)) {
    throw new Error(`Missing MapLibre asset: ${from}`);
  }
  copyFileSync(from, to);
}

console.log(`Synced MapLibre worker assets → ${outDir}`);
