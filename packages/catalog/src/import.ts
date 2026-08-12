import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { schema, type Database } from '@railmeet/database';
import { and, eq, inArray, sql } from 'drizzle-orm';

import { haversineMeters, parseCatalogArtifact, validateCatalogArtifact } from './validate.js';
import type { CatalogArtifact, CatalogValidationReport } from './types.js';

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
};

function checksumOf(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
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

async function findByProviderPair(tx: Database['db'], provider: string, providerPlaceId: string) {
  return tx.query.places.findFirst({
    where: and(
      eq(schema.places.provider, provider),
      eq(schema.places.providerPlaceId, providerPlaceId),
    ),
  });
}

/**
 * Idempotent catalog import. Refreshes catalog-managed places and hub associations.
 * Upserts on stable provider + provider_place_id (and preserves that row's internal ID).
 * Does not overwrite `manual` ownership rows.
 * Runs in a single transaction — validation failure or DB error leaves no partial state.
 */
export async function importCatalogArtifact(
  database: Database,
  raw: unknown,
  rawTextForChecksum: string,
): Promise<CatalogImportResult> {
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
    };
  }

  const artifact = parseCatalogArtifact(raw);
  const now = new Date();
  let deactivatedCount = 0;
  let createdCount = 0;
  let updatedCount = 0;
  let unchangedCount = 0;
  let stableInternalIdsPreserved = true;
  const cityIdMap = new Map<string, string>();
  const hubIdMap = new Map<string, string>();

  await database.db.transaction(async (tx) => {
    const cityOwnerships = [...new Set(artifact.cities.map((city) => city.ownership))] as Array<
      CatalogArtifact['cities'][number]['ownership']
    >;

    for (const city of artifact.cities) {
      const provider = providerForCity(city.ownership);
      const providerPlaceId = providerPlaceIdForCity(city);
      const byProvider = await findByProviderPair(tx, provider, providerPlaceId);
      const byId = byProvider
        ? null
        : await tx.query.places.findFirst({ where: eq(schema.places.id, city.id) });
      const existing = byProvider ?? byId;
      if (existing?.ownership === 'manual') {
        cityIdMap.set(city.id, existing.id);
        unchangedCount += 1;
        continue;
      }

      const stableId = existing?.id ?? city.id;
      cityIdMap.set(city.id, stableId);
      if (existing && existing.id !== city.id) {
        // Provider-key upsert preserved a different stable internal id.
        stableInternalIdsPreserved = true;
      }

      if (existing) {
        const same =
          existing.name === city.name &&
          existing.countryCode === city.countryCode &&
          existing.timezone === city.timezone &&
          existing.active === true &&
          existing.population === (city.population ?? null) &&
          existing.featureCode === (city.featureCode ?? null);
        if (same) {
          unchangedCount += 1;
        } else {
          updatedCount += 1;
        }
        await tx
          .update(schema.places)
          .set({
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
            updatedAt: now,
          })
          .where(eq(schema.places.id, stableId));
      } else {
        createdCount += 1;
        await tx.insert(schema.places).values({
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
        });
      }
    }

    for (const hub of artifact.hubs) {
      const ownership = hubOwnership(hub);
      const { provider, providerPlaceId } = hubProviderFields(hub);
      const byProvider = await findByProviderPair(tx, provider, providerPlaceId);
      const byId = byProvider
        ? null
        : await tx.query.places.findFirst({ where: eq(schema.places.id, hub.id) });
      const existing = byProvider ?? byId;
      if (existing?.ownership === 'manual') {
        hubIdMap.set(hub.id, existing.id);
        continue;
      }

      const stableId = existing?.id ?? hub.id;
      hubIdMap.set(hub.id, stableId);
      const parentCityId = cityIdMap.get(hub.cityId) ?? hub.cityId;

      if (existing) {
        await tx
          .update(schema.places)
          .set({
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
            active: true,
            updatedAt: now,
          })
          .where(eq(schema.places.id, stableId));
      } else {
        await tx.insert(schema.places).values({
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
          active: true,
          createdAt: now,
          updatedAt: now,
        });
      }
    }

    // Priority uniqueness is per active city. Clear prior active associations for
    // cities we are refreshing so new deterministic priorities can be written.
    const cityPlaceIdsWithHubs = [
      ...new Set(artifact.hubs.map((hub) => cityIdMap.get(hub.cityId) ?? hub.cityId)),
    ];
    if (cityPlaceIdsWithHubs.length > 0) {
      await tx
        .update(schema.meetingCityHubs)
        .set({ active: false, updatedAt: now })
        .where(
          and(
            sql`${schema.meetingCityHubs.cityPlaceId} IN (${sql.join(
              cityPlaceIdsWithHubs.map((id) => sql`${id}`),
              sql`, `,
            )})`,
            eq(schema.meetingCityHubs.active, true),
          ),
        );
    }

    for (const hub of artifact.hubs) {
      const cityArtifact = artifact.cities.find((entry) => entry.id === hub.cityId);
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
      await tx
        .insert(schema.meetingCityHubs)
        .values({
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
        })
        .onConflictDoUpdate({
          target: [schema.meetingCityHubs.cityPlaceId, schema.meetingCityHubs.hubPlaceId],
          set: {
            priority: hub.priority,
            matchMethod: hub.matchMethod,
            source: artifact.source,
            sourceVersion: artifact.sourceVersion,
            regional: hub.regional,
            distanceMeters: distance,
            active: true,
            updatedAt: now,
          },
        });
    }

    const importedCityIds = [...new Set(cityIdMap.values())];
    const importedHubIds = [...new Set(hubIdMap.values())];

    if (importedCityIds.length > 0) {
      const staleCities = await tx
        .update(schema.places)
        .set({ active: false, updatedAt: now })
        .where(
          and(
            inArray(schema.places.ownership, cityOwnerships),
            sql`${schema.places.id} NOT IN (${sql.join(
              importedCityIds.map((id) => sql`${id}`),
              sql`, `,
            )})`,
            eq(schema.places.active, true),
          ),
        )
        .returning({ id: schema.places.id });
      deactivatedCount += staleCities.length;
    }

    if (importedHubIds.length > 0) {
      const staleHubs = await tx
        .update(schema.places)
        .set({ active: false, updatedAt: now })
        .where(
          and(
            inArray(schema.places.ownership, ['catalog:hub', 'catalog:transitous']),
            sql`${schema.places.id} NOT IN (${sql.join(
              importedHubIds.map((id) => sql`${id}`),
              sql`, `,
            )})`,
            eq(schema.places.active, true),
          ),
        )
        .returning({ id: schema.places.id });
      deactivatedCount += staleHubs.length;

      await tx
        .update(schema.meetingCityHubs)
        .set({ active: false, updatedAt: now })
        .where(
          and(
            eq(schema.meetingCityHubs.source, artifact.source),
            sql`${schema.meetingCityHubs.hubPlaceId} NOT IN (${sql.join(
              importedHubIds.map((id) => sql`${id}`),
              sql`, `,
            )})`,
            eq(schema.meetingCityHubs.active, true),
          ),
        );
    }

    await tx.insert(schema.catalogImportRuns).values({
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
  });

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
  };
}

export function loadCatalogArtifactFile(path: string): {
  readonly artifact: unknown;
  readonly text: string;
} {
  const text = readFileSync(path, 'utf8');
  return { artifact: JSON.parse(text) as unknown, text };
}
