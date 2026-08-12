import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

export function catalogPackageRoot(): string {
  return packageRoot;
}

/** Offline test / bootstrap fixture — never a production catalog. */
export function defaultFixturePath(): string {
  return join(packageRoot, 'data/fixtures/offline-europe-v1.json');
}

export function fixturesDir(): string {
  return join(packageRoot, 'data/fixtures');
}

export function cacheDir(): string {
  return join(packageRoot, 'data/cache');
}

export function artifactsDir(): string {
  return join(packageRoot, 'data/artifacts');
}

export function manifestsDir(): string {
  return join(packageRoot, 'data/manifests');
}

export function geonamesManifestPath(): string {
  return join(manifestsDir(), 'geonames-cities15000.json');
}

export function transitousHubsManifestPath(): string {
  return join(manifestsDir(), 'transitous-hubs.json');
}

export function geonamesCacheZipPath(): string {
  return join(cacheDir(), 'cities15000.zip');
}

export function geonamesCitiesArtifactPath(): string {
  return join(artifactsDir(), 'europe-cities-geonames-v1.json');
}

export function transitousHubsArtifactPath(): string {
  return join(artifactsDir(), 'europe-hubs-transitous-v1.json');
}

export function productionCatalogArtifactPath(): string {
  return join(artifactsDir(), 'europe-production-catalog-v1.json');
}
