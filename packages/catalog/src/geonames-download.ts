import { createHash } from 'node:crypto';
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as NodeWebReadableStream } from 'node:stream/web';
import { spawn } from 'node:child_process';

import type { SourceManifest } from './types.js';
import { cacheDir, geonamesCacheZipPath, geonamesManifestPath } from './paths.js';
import { CITY_SELECTION_POLICY_VERSION } from './europe-scope.js';

export const GEONAMES_CITIES15000_URL = 'https://download.geonames.org/export/dump/cities15000.zip';
export const GEONAMES_LICENSE_URL = 'https://creativecommons.org/licenses/by/4.0/';
export const GEONAMES_ATTRIBUTION = 'GeoNames https://www.geonames.org/ (CC BY 4.0)';

/**
 * Official GeoNames dump: all cities with population > 15000 or capitals.
 * Format: ZIP containing cities15000.txt (tab-delimited UTF-8, 19 columns).
 * Update cadence: GeoNames regenerates dumps approximately daily.
 */
export const GEONAMES_SOURCE_DEFAULTS = {
  source: 'geonames',
  artifactUrl: GEONAMES_CITIES15000_URL,
  license: 'Creative Commons Attribution 4.0',
  licenseUrl: GEONAMES_LICENSE_URL,
  attribution: GEONAMES_ATTRIBUTION,
  format: 'zip/tab-delimited-utf8 cities15000.txt (19 columns)',
  coverage: 'Worldwide cities15000; RailMeet filters to EUROPE_ISO_COUNTRY_CODES',
  selectionPolicyVersion: CITY_SELECTION_POLICY_VERSION,
} as const;

function sha256File(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(path);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

export function loadSourceManifest(path: string): SourceManifest {
  return JSON.parse(readFileSync(path, 'utf8')) as SourceManifest;
}

export function writeSourceManifest(path: string, manifest: SourceManifest): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  renameSync(tmp, path);
}

/**
 * Manually invoked GeoNames cities15000 downloader.
 * Never runs during migrate/startup/test/typecheck/build.
 */
export async function downloadGeonamesCities15000(options?: {
  readonly expectedSha256?: string;
}): Promise<{ readonly path: string; readonly sha256: string; readonly manifestPath: string }> {
  mkdirSync(cacheDir(), { recursive: true });
  const dest = geonamesCacheZipPath();
  const partial = `${dest}.partial`;
  if (existsSync(partial)) {
    unlinkSync(partial);
  }

  const response = await fetch(GEONAMES_CITIES15000_URL);
  if (!response.ok || !response.body) {
    throw new Error(`GeoNames download failed: HTTP ${response.status} ${response.statusText}`);
  }

  const fileStream = createWriteStream(partial);
  await pipeline(Readable.fromWeb(response.body as NodeWebReadableStream), fileStream);

  const sha256 = await sha256File(partial);
  if (options?.expectedSha256 && options.expectedSha256 !== sha256) {
    unlinkSync(partial);
    throw new Error(
      `GeoNames checksum mismatch: expected ${options.expectedSha256}, got ${sha256}`,
    );
  }

  renameSync(partial, dest);

  const retrievedAt = new Date().toISOString();
  const manifest: SourceManifest = {
    source: GEONAMES_SOURCE_DEFAULTS.source,
    artifactUrl: GEONAMES_SOURCE_DEFAULTS.artifactUrl,
    retrievedAt,
    version: `cities15000@${retrievedAt.slice(0, 10)}`,
    sha256,
    expectedSha256: options?.expectedSha256 ?? sha256,
    license: GEONAMES_SOURCE_DEFAULTS.license,
    attribution: GEONAMES_SOURCE_DEFAULTS.attribution,
    format: GEONAMES_SOURCE_DEFAULTS.format,
    coverage: GEONAMES_SOURCE_DEFAULTS.coverage,
    selectionPolicyVersion: GEONAMES_SOURCE_DEFAULTS.selectionPolicyVersion,
  };
  writeSourceManifest(geonamesManifestPath(), manifest);
  return { path: dest, sha256, manifestPath: geonamesManifestPath() };
}

export async function verifyGeonamesChecksum(expected?: string): Promise<{
  readonly ok: boolean;
  readonly sha256: string | null;
  readonly message: string;
}> {
  const dest = geonamesCacheZipPath();
  if (!existsSync(dest)) {
    return { ok: false, sha256: null, message: 'GeoNames cache zip absent' };
  }
  const sha256 = await sha256File(dest);
  let expectedSha = expected;
  if (!expectedSha && existsSync(geonamesManifestPath())) {
    expectedSha = loadSourceManifest(geonamesManifestPath()).expectedSha256 ?? undefined;
  }
  if (expectedSha && expectedSha !== sha256) {
    return {
      ok: false,
      sha256,
      message: `Checksum mismatch: expected ${expectedSha}, got ${sha256}`,
    };
  }
  return { ok: true, sha256, message: 'Checksum ok' };
}

/** Extract cities15000.txt from zip using system unzip (no extra dep). */
export async function extractGeonamesTxt(zipPath: string, outTxtPath: string): Promise<void> {
  mkdirSync(dirname(outTxtPath), { recursive: true });
  await new Promise<void>((resolve, reject) => {
    const child = spawn('unzip', ['-p', zipPath, 'cities15000.txt'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const out = createWriteStream(outTxtPath);
    child.stdout.pipe(out);
    let err = '';
    child.stderr.on('data', (chunk: Buffer) => {
      err += chunk.toString('utf8');
    });
    child.on('error', reject);
    out.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`unzip failed (${code}): ${err}`));
        return;
      }
      resolve();
    });
  });
}
