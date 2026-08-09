import { setWorkerUrl } from 'maplibre-gl';

let configured = false;

/**
 * MapLibre GL JS v6 requires an explicit worker URL under bundlers (Next.js).
 * Without this, vector tiles / glyphs never load and only raster basemap fragments appear.
 */
export function ensureMapLibreWorker(): void {
  if (configured || typeof window === 'undefined') {
    return;
  }
  setWorkerUrl('/maplibre/maplibre-gl-worker.mjs');
  configured = true;
}
