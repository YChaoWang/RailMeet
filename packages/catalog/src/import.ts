import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { schema, type Database } from '@railmeet/database';
import { and, eq, inArray, notInArray, or, sql } from 'drizzle-orm';

import { haversineMeters, parseCatalogArtifact, validateCatalogArtifact } from './validate.js';
import type { CatalogArtifact, CatalogValidationReport } from './types.js';

/** Default rows per write batch (Neon-friendly; keeps statements under size limits). */
export const CATALOG_IMPORT_BATCH_SIZE = 500;

export type CatalogImportProgressPhase = 'cities' | 'hubs' | 'associations';

export type CatalogImportProgress = {
  readonly phase: CatalogImportProgressPhase;
  readonly done: number;
  readonly total: number;
};

export type CatalogImportStats = {
  readonly preloadQueries: number;
  readonly writeQueries: number;
  readonly totalQueries: number;
  readonly durationMs: number;
  readonly batchSize: number;
  readonly cityBatches: number;
  readonly hubBatches: number;
  readonly associationBatches: number;
};

export type CatalogImportOptions = {
  /** Rows per INSERT/UPDATE batch. Defaults to {@link CATALOG_IMPORT_BATCH_SIZE}. */
  readonly batchSize?: number;
  /** Progress reporter (CLI prints `cities 500/6075` style lines). */
  readonly onProgress?: (progress: CatalogImportProgress) => void;
  /**
   * Test-only: throw after this many successful city write batches to simulate interrupt.
   * Retrying the full import must remain safe.
   */
  readonly failAfterCityBatches?: number;
};

export type CatalogImportResult = {
  readonly ok: boolean;
  readonly report: CatalogValidationReport;
  readonly checksum: string;
  readonly cityCount: number;
  readonly hubCount: number;
  readonly associationCount: number;
  readonly deactivatedCount: number;
  readonly createdCount: number;
  readonly updatedCount: number;
  readonly unchangedCount: number;
  readonly stableInternalIdsPreserved: boolean;
  readonly stats: CatalogImportStats;
};

type PlaceRow = {
  readonly id: string;
  readonly name: string;
  readonly kind: string;
  readonly countryCode: string;
  readonly timezone: string;
  readonly location: { x: number; y: number };
  readonly parentCityId: string | null;
  readonly provider: string | null;
  readonly providerPlaceId: string | null;
  readonly ownership: string;
  readonly population: number | null;
  readonly featureCode: string | null;
  readonly active: boolean;
};

type PlaceWrite = {
  readonly id: string;
  readonly name: string;
  readonly kind: 'city' | 'station';
  readonly countryCode: string;
  readonly timezone: string;
  readonly location: { x: number; y: number };
  readonly parentCityId: string | null;
  readonly provider: string;
  readonly providerPlaceId: string;
  readonly ownership: string;
  readonly sourceVersion: string;
  readonly normalizedName: string;
  readonly population: number | null;
  readonly featureCode: string | null;
  readonly active: true;
  readonly createdAt: Date;
  readonly updatedAt: Date;
};

type AssociationWrite = {
  readonly cityPlaceId: string;
  readonly hubPlaceId: string;
  readonly priority: number;
  readonly matchMethod: string;
  readonly source: string;
  readonly sourceVersion: string;
  readonly regional: boolean;
  readonly distanceMeters: number;
  readonly active: true;
  readonly createdAt: Date;
  readonly updatedAt: Date;
};

function checksumOf(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

function providerKey(provider: string, providerPlaceId: string): string {
  return `${provider}\0${providerPlaceId}`;
}

function providerForCity(ownership: CatalogArtifact['cities'][number]['ownership']): string {
  switch (ownership) {
    case 'catalog:geonames':
      return 'geonames';
    case 'fixture:offline-europe-v1':
      return 'railmeet-fixture';
    case 'catalog:bootstrap':
      return 'railmeet-catalog';
    default: {
      const _exhaustive: never = ownership;
      return _exhaustive;
    }
  }
}

function providerPlaceIdForCity(city: CatalogArtifact['cities'][number]): string {
  if (city.ownership === 'catalog:geonames') {
    return city.externalId.replace(/^geonames:/, '');
  }
  if (city.ownership === 'fixture:offline-europe-v1') {
    return city.externalId.replace(/^railmeet-catalog:/, '').replace(/^fixture:/, '');
  }
  return city.externalId.replace(/^railmeet-catalog:/, '');
}

function hubOwnership(hub: CatalogArtifact['hubs'][number]): 'catalog:hub' | 'catalog:transitous' {
  if (hub.hubSource === 'catalog:transitous' || hub.providerStopId) {
    return 'catalog:transitous';
  }
  return 'catalog:hub';
}

function hubProviderFields(hub: CatalogArtifact['hubs'][number]): {
  readonly provider: string;
  readonly providerPlaceId: string;
} {
  if (hub.providerStopId) {
    return { provider: 'motis', providerPlaceId: hub.providerStopId };
  }
  return {
    provider: 'railmeet-hub',
    providerPlaceId: hub.externalId.replace(/^railmeet-hub:/, '').replace(/^motis:/, ''),
  };
}

function chunkArray<T>(items: readonly T[], size: number): T[][] {
  if (items.length === 0) {
    return [];
  }
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function reportProgress(
  onProgress: CatalogImportOptions['onProgress'],
  phase: CatalogImportProgressPhase,
  done: number,
  total: number,
): void {
  onProgress?.({ phase, done, total });
}

function emptyStats(batchSize: number, durationMs = 0): CatalogImportStats {
  return {
    preloadQueries: 0,
    writeQueries: 0,
    totalQueries: 0,
    durationMs,
    batchSize,
    cityBatches: 0,
    hubBatches: 0,
    associationBatches: 0,
  };
}

function cityUnchanged(existing: PlaceRow, city: CatalogArtifact['cities'][number]): boolean {
  return (
    existing.name === city.name &&
    existing.countryCode === city.countryCode &&
    existing.timezone === city.timezone &&
    existing.active === true &&
    existing.population === (city.population ?? null) &&
    existing.featureCode === (city.featureCode ?? null)
  );
}

function hubUnchanged(
  existing: PlaceRow,
  hub: CatalogArtifact['hubs'][number],
  parentCityId: string,
  ownership: string,
  provider: string,
  providerPlaceId: string,
): boolean {
  return (
    existing.name === hub.name &&
    existing.countryCode === hub.countryCode &&
    existing.timezone === hub.timezone &&
    existing.active === true &&
    existing.parentCityId === parentCityId &&
    existing.ownership === ownership &&
    existing.provider === provider &&
    existing.providerPlaceId === providerPlaceId
  );
}

async function upsertPlaceBatch(database: Database, rows: readonly PlaceWrite[]): Promise<void> {
  if (rows.length === 0) {
    return;
  }
  await database.db
    .insert(schema.places)
    .values([...rows])
    .onConflictDoUpdate({
      target: schema.places.id,
      set: {
        name: sql`excluded.name`,
        kind: sql`excluded.kind`,
        countryCode: sql`excluded.country_code`,
        timezone: sql`excluded.timezone`,
        location: sql`excluded.location`,
        parentCityId: sql`excluded.parent_city_id`,
        provider: sql`excluded.provider`,
        providerPlaceId: sql`excluded.provider_place_id`,
        ownership: sql`excluded.ownership`,
        sourceVersion: sql`excluded.source_version`,
        normalizedName: sql`excluded.normalized_name`,
        population: sql`excluded.population`,
        featureCode: sql`excluded.feature_code`,
        active: sql`excluded.active`,
        updatedAt: sql`excluded.updated_at`,
      },
    });
}

async function upsertAssociationBatch(
  database: Database,
  rows: readonly AssociationWrite[],
): Promise<void> {
  if (rows.length === 0) {
    return;
  }
  await database.db
    .insert(schema.meetingCityHubs)
    .values([...rows])
    .onConflictDoUpdate({
      target: [schema.meetingCityHubs.cityPlaceId, schema.meetingCityHubs.hubPlaceId],
      set: {
        priority: sql`excluded.priority`,
        matchMethod: sql`excluded.match_method`,
        source: sql`excluded.source`,
        sourceVersion: sql`excluded.source_version`,
        regional: sql`excluded.regional`,
        distanceMeters: sql`excluded.distance_meters`,
        active: sql`excluded.active`,
        updatedAt: sql`excluded.updated_at`,
      },
    });
}

/**
 * Idempotent catalog import with bounded preload + batched upserts.
 *
 * Transaction boundary: each write batch commits independently so a long Neon import
 * remains resumable. Re-running after interrupt is safe because places upsert on stable
 * primary key / provider identity and associations upsert on (city, hub).
 * Validation failures never write place rows (only a failed import-run audit row).
 */
export async function importCatalogArtifact(
  database: Database,
  raw: unknown,
  rawTextForChecksum: string,
  options: CatalogImportOptions = {},
): Promise<CatalogImportResult> {
  const started = Date.now();
  const batchSize = Math.min(500, Math.max(250, options.batchSize ?? CATALOG_IMPORT_BATCH_SIZE));
  const onProgress = options.onProgress;
  const report = validateCatalogArtifact(raw);
  const checksum = checksumOf(rawTextForChecksum);

  if (!report.ok) {
    await database.db.insert(schema.catalogImportRuns).values({
      source: report.source,
      sourceVersion: report.sourceVersion,
      checksum,
      status: 'failed',
      rejectedCount: report.rejectedRecords.length,
      diagnostics: report,
      completedAt: new Date(),
    });
    return {
      ok: false,
      report,
      checksum,
      cityCount: 0,
      hubCount: 0,
      associationCount: 0,
      deactivatedCount: 0,
      createdCount: 0,
      updatedCount: 0,
      unchangedCount: 0,
      stableInternalIdsPreserved: true,
      stats: emptyStats(batchSize, Date.now() - started),
    };
  }

  const artifact = parseCatalogArtifact(raw);
  const now = new Date();
  let deactivatedCount = 0;
  let createdCount = 0;
  let updatedCount = 0;
  let unchangedCount = 0;
  let stableInternalIdsPreserved = true;
  let preloadQueries = 0;
  let writeQueries = 0;
  let cityBatches = 0;
  let hubBatches = 0;
  let associationBatches = 0;

  const cityIdMap = new Map<string, string>();
  const hubIdMap = new Map<string, string>();

  const cityOwnerships = [...new Set(artifact.cities.map((city) => city.ownership))] as Array<
    CatalogArtifact['cities'][number]['ownership']
  >;
  const catalogOwnerships = [
    ...new Set([...cityOwnerships, 'catalog:hub', 'catalog:transitous', 'catalog:bootstrap']),
  ];

  // Bounded preload: all catalog-managed rows + any provider-keyed place (covers manual
  // provider collisions without per-record SELECTs).
  const existingRows = (await database.db
    .select({
      id: schema.places.id,
      name: schema.places.name,
      kind: schema.places.kind,
      countryCode: schema.places.countryCode,
      timezone: schema.places.timezone,
      location: schema.places.location,
      parentCityId: schema.places.parentCityId,
      provider: schema.places.provider,
      providerPlaceId: schema.places.providerPlaceId,
      ownership: schema.places.ownership,
      population: schema.places.population,
      featureCode: schema.places.featureCode,
      active: schema.places.active,
    })
    .from(schema.places)
    .where(
      or(
        inArray(schema.places.ownership, catalogOwnerships),
        sql`${schema.places.provider} IS NOT NULL`,
      ),
    )) as PlaceRow[];
  preloadQueries += 1;

  const byId = new Map<string, PlaceRow>();
  const byProvider = new Map<string, PlaceRow>();
  for (const row of existingRows) {
    byId.set(row.id, row);
    if (row.provider && row.providerPlaceId) {
      byProvider.set(providerKey(row.provider, row.providerPlaceId), row);
    }
  }

  const cityWritesById = new Map<string, PlaceWrite>();
  for (const city of artifact.cities) {
    const provider = providerForCity(city.ownership);
    const providerPlaceId = providerPlaceIdForCity(city);
    const byProviderHit = byProvider.get(providerKey(provider, providerPlaceId));
    const byIdHit = byProviderHit ? undefined : byId.get(city.id);
    const existing = byProviderHit ?? byIdHit;

    if (existing?.ownership === 'manual') {
      cityIdMap.set(city.id, existing.id);
      unchangedCount += 1;
      continue;
    }

    const stableId = existing?.id ?? city.id;
    cityIdMap.set(city.id, stableId);
    if (existing && existing.id !== city.id) {
      stableInternalIdsPreserved = true;
    }

    if (existing && cityUnchanged(existing, city) && !cityWritesById.has(stableId)) {
      unchangedCount += 1;
      continue;
    }

    if (cityWritesById.has(stableId)) {
      const previous = cityWritesById.get(stableId)!;
      if (previous.providerPlaceId !== providerPlaceId) {
        throw new Error(
          `Duplicate city place id ${stableId} for different providers (${previous.providerPlaceId} vs ${providerPlaceId})`,
        );
      }
    }

    if (existing && !cityWritesById.has(stableId)) {
      updatedCount += 1;
    } else if (!existing && !cityWritesById.has(stableId)) {
      createdCount += 1;
    }

    const write: PlaceWrite = {
      id: stableId,
      name: city.name,
      kind: 'city',
      countryCode: city.countryCode,
      timezone: city.timezone,
      location: { x: city.longitude, y: city.latitude },
      parentCityId: null,
      provider,
      providerPlaceId,
      ownership: city.ownership,
      sourceVersion: artifact.sourceVersion,
      normalizedName: city.name.trim().toLowerCase(),
      population: city.population ?? null,
      featureCode: city.featureCode ?? null,
      active: true,
      createdAt: now,
      updatedAt: now,
    };
    cityWritesById.set(stableId, write);
    byId.set(stableId, {
      id: stableId,
      name: city.name,
      kind: 'city',
      countryCode: city.countryCode,
      timezone: city.timezone,
      location: { x: city.longitude, y: city.latitude },
      parentCityId: null,
      provider,
      providerPlaceId,
      ownership: city.ownership,
      population: city.population ?? null,
      featureCode: city.featureCode ?? null,
      active: true,
    });
    byProvider.set(providerKey(provider, providerPlaceId), byId.get(stableId)!);
  }

  const cityWrites = [...cityWritesById.values()];
  const citiesAlreadySettled = artifact.cities.length - cityWrites.length;
  let citiesWritten = 0;
  const cityChunks = chunkArray(cityWrites, batchSize);
  for (const chunk of cityChunks) {
    await upsertPlaceBatch(database, chunk);
    writeQueries += 1;
    cityBatches += 1;
    citiesWritten += chunk.length;
    reportProgress(
      onProgress,
      'cities',
      citiesAlreadySettled + citiesWritten,
      artifact.cities.length,
    );
    if (options.failAfterCityBatches !== undefined && cityBatches >= options.failAfterCityBatches) {
      throw new Error(`Simulated catalog import interrupt after ${cityBatches} city batch(es)`);
    }
  }
  reportProgress(onProgress, 'cities', artifact.cities.length, artifact.cities.length);

  const hubWritesById = new Map<string, PlaceWrite>();
  for (const hub of artifact.hubs) {
    const ownership = hubOwnership(hub);
    const { provider, providerPlaceId } = hubProviderFields(hub);
    const byProviderHit = byProvider.get(providerKey(provider, providerPlaceId));
    const byIdHit = byProviderHit ? undefined : byId.get(hub.id);
    const existing = byProviderHit ?? byIdHit;

    if (existing?.ownership === 'manual') {
      hubIdMap.set(hub.id, existing.id);
      continue;
    }

    const stableId = existing?.id ?? hub.id;
    hubIdMap.set(hub.id, stableId);
    const parentCityId = cityIdMap.get(hub.cityId) ?? hub.cityId;

    if (
      existing &&
      hubUnchanged(existing, hub, parentCityId, ownership, provider, providerPlaceId) &&
      !hubWritesById.has(stableId)
    ) {
      continue;
    }

    if (hubWritesById.has(stableId)) {
      const previous = hubWritesById.get(stableId)!;
      if (previous.providerPlaceId !== providerPlaceId) {
        throw new Error(
          `Duplicate hub place id ${stableId} for different provider stops (${previous.providerPlaceId} vs ${providerPlaceId})`,
        );
      }
    }

    const write: PlaceWrite = {
      id: stableId,
      name: hub.name,
      kind: 'station',
      countryCode: hub.countryCode,
      timezone: hub.timezone,
      location: { x: hub.longitude, y: hub.latitude },
      parentCityId,
      provider,
      providerPlaceId,
      ownership,
      sourceVersion: artifact.sourceVersion,
      normalizedName: hub.name.trim().toLowerCase(),
      population: null,
      featureCode: null,
      active: true,
      createdAt: now,
      updatedAt: now,
    };
    hubWritesById.set(stableId, write);
    byId.set(stableId, {
      id: stableId,
      name: hub.name,
      kind: 'station',
      countryCode: hub.countryCode,
      timezone: hub.timezone,
      location: { x: hub.longitude, y: hub.latitude },
      parentCityId,
      provider,
      providerPlaceId,
      ownership,
      population: null,
      featureCode: null,
      active: true,
    });
    byProvider.set(providerKey(provider, providerPlaceId), byId.get(stableId)!);
  }

  const hubWrites = [...hubWritesById.values()];
  const hubChunks = chunkArray(hubWrites, batchSize);
  const hubsAlreadySettled = artifact.hubs.length - hubWrites.length;
  let hubsWritten = 0;
  for (const chunk of hubChunks) {
    await upsertPlaceBatch(database, chunk);
    writeQueries += 1;
    hubBatches += 1;
    hubsWritten += chunk.length;
    reportProgress(onProgress, 'hubs', hubsAlreadySettled + hubsWritten, artifact.hubs.length);
  }
  reportProgress(onProgress, 'hubs', artifact.hubs.length, artifact.hubs.length);

  const cityPlaceIdsWithHubs = [
    ...new Set(artifact.hubs.map((hub) => cityIdMap.get(hub.cityId) ?? hub.cityId)),
  ];
  if (cityPlaceIdsWithHubs.length > 0) {
    for (const cityIdChunk of chunkArray(cityPlaceIdsWithHubs, batchSize)) {
      await database.db
        .update(schema.meetingCityHubs)
        .set({ active: false, updatedAt: now })
        .where(
          and(
            inArray(schema.meetingCityHubs.cityPlaceId, cityIdChunk),
            eq(schema.meetingCityHubs.active, true),
          ),
        );
      writeQueries += 1;
    }
  }

  const cityByArtifactId = new Map(artifact.cities.map((city) => [city.id, city]));
  const associationWritesByKey = new Map<string, AssociationWrite>();
  for (const hub of artifact.hubs) {
    const cityArtifact = cityByArtifactId.get(hub.cityId);
    if (!cityArtifact) {
      continue;
    }
    const cityPlaceId = cityIdMap.get(hub.cityId) ?? hub.cityId;
    const hubPlaceId = hubIdMap.get(hub.id) ?? hub.id;
    const distance = haversineMeters(
      cityArtifact.latitude,
      cityArtifact.longitude,
      hub.latitude,
      hub.longitude,
    );
    associationWritesByKey.set(`${cityPlaceId}\0${hubPlaceId}`, {
      cityPlaceId,
      hubPlaceId,
      priority: hub.priority,
      matchMethod: hub.matchMethod,
      source: artifact.source,
      sourceVersion: artifact.sourceVersion,
      regional: hub.regional,
      distanceMeters: distance,
      active: true,
      createdAt: now,
      updatedAt: now,
    });
  }

  const associationWrites = [...associationWritesByKey.values()];
  const associationChunks = chunkArray(associationWrites, batchSize);
  for (const [index, chunk] of associationChunks.entries()) {
    await upsertAssociationBatch(database, chunk);
    writeQueries += 1;
    associationBatches += 1;
    reportProgress(
      onProgress,
      'associations',
      Math.min((index + 1) * batchSize, associationWrites.length),
      associationWrites.length,
    );
  }
  reportProgress(onProgress, 'associations', associationWrites.length, associationWrites.length);

  const importedCityIds = [...new Set(cityIdMap.values())];
  const importedHubIds = [...new Set(hubIdMap.values())];

  if (importedCityIds.length > 0) {
    const staleCities = await database.db
      .update(schema.places)
      .set({ active: false, updatedAt: now })
      .where(
        and(
          inArray(schema.places.ownership, cityOwnerships),
          eq(schema.places.active, true),
          notInArray(schema.places.id, importedCityIds),
        ),
      )
      .returning({ id: schema.places.id });
    writeQueries += 1;
    deactivatedCount += staleCities.length;
  }

  if (importedHubIds.length > 0) {
    const staleHubs = await database.db
      .update(schema.places)
      .set({ active: false, updatedAt: now })
      .where(
        and(
          inArray(schema.places.ownership, ['catalog:hub', 'catalog:transitous']),
          eq(schema.places.active, true),
          notInArray(schema.places.id, importedHubIds),
        ),
      )
      .returning({ id: schema.places.id });
    writeQueries += 1;
    deactivatedCount += staleHubs.length;

    await database.db
      .update(schema.meetingCityHubs)
      .set({ active: false, updatedAt: now })
      .where(
        and(
          eq(schema.meetingCityHubs.source, artifact.source),
          eq(schema.meetingCityHubs.active, true),
          notInArray(schema.meetingCityHubs.hubPlaceId, importedHubIds),
        ),
      );
    writeQueries += 1;
  }

  await database.db.insert(schema.catalogImportRuns).values({
    source: artifact.source,
    sourceVersion: artifact.sourceVersion,
    checksum,
    status: 'succeeded',
    cityCount: artifact.cities.length,
    hubCount: artifact.hubs.length,
    associationCount: artifact.hubs.length,
    rejectedCount: 0,
    deactivatedCount,
    diagnostics: report,
    completedAt: now,
  });
  writeQueries += 1;

  const durationMs = Date.now() - started;
  return {
    ok: true,
    report,
    checksum,
    cityCount: artifact.cities.length,
    hubCount: artifact.hubs.length,
    associationCount: artifact.hubs.length,
    deactivatedCount,
    createdCount,
    updatedCount,
    unchangedCount,
    stableInternalIdsPreserved,
    stats: {
      preloadQueries,
      writeQueries,
      totalQueries: preloadQueries + writeQueries,
      durationMs,
      batchSize,
      cityBatches,
      hubBatches,
      associationBatches,
    },
  };
}

/** Default CLI progress printer: `cities 500/6075`. */
export function printCatalogImportProgress(progress: CatalogImportProgress): void {
  console.error(`${progress.phase} ${progress.done}/${progress.total}`);
}

export function loadCatalogArtifactFile(path: string): {
  readonly artifact: unknown;
  readonly text: string;
} {
  const text = readFileSync(path, 'utf8');
  return { artifact: JSON.parse(text) as unknown, text };
}
