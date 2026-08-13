import { existsSync } from 'node:fs';

import { schema, type Database } from '@railmeet/database';
import { eq, sql } from 'drizzle-orm';

import { buildCatalogStatusReport } from './readiness.js';
import { geonamesCacheZipPath, geonamesManifestPath } from './paths.js';
import { loadSourceManifest } from './geonames-download.js';

export async function loadCatalogStatus(database: Database) {
  const cityRows = await database.db.execute(sql`
    SELECT
      COUNT(*) FILTER (
        WHERE kind = 'city' AND active = true
          AND ownership IN ('catalog:bootstrap', 'catalog:geonames', 'fixture:offline-europe-v1', 'manual')
      )::int AS active_city_count,
      COUNT(*) FILTER (
        WHERE kind = 'city' AND active = true
          AND ownership IN ('fixture:offline-europe-v1', 'catalog:bootstrap')
      )::int AS fixture_city_count,
      COUNT(*) FILTER (
        WHERE kind = 'city' AND active = true AND ownership = 'catalog:geonames'
      )::int AS production_city_count,
      COUNT(*) FILTER (
        WHERE kind = 'city' AND active = false
          AND ownership IN ('catalog:geonames', 'fixture:offline-europe-v1', 'catalog:bootstrap', 'catalog:hub', 'catalog:transitous')
      )::int AS deactivated_count,
      COUNT(*) FILTER (
        WHERE kind = 'city' AND active = true AND ownership = 'manual'
      )::int AS manual_override_count
    FROM places
  `);
  const hubRows = await database.db.execute(sql`
    SELECT
      COUNT(*) FILTER (
        WHERE kind = 'station' AND active = true
          AND ownership IN ('catalog:hub', 'catalog:transitous')
      )::int AS active_hub_count,
      COUNT(*) FILTER (
        WHERE kind = 'station' AND active = true AND ownership = 'catalog:transitous'
      )::int AS production_hub_count,
      COUNT(*) FILTER (
        WHERE kind = 'station' AND active = true
          AND ownership IN ('catalog:hub', 'catalog:transitous')
          AND provider = 'motis' AND provider_place_id IS NOT NULL
      )::int AS hubs_with_provider_stop_id
    FROM places
  `);
  const linkedRows = await database.db.execute(sql`
    SELECT COUNT(DISTINCT city_place_id)::int AS count
    FROM meeting_city_hubs
    WHERE active = true
  `);
  const assocRows = await database.db.execute(sql`
    SELECT COUNT(*)::int AS count FROM meeting_city_hubs WHERE active = true
  `);
  const withoutHubRows = await database.db.execute(sql`
    SELECT COUNT(*)::int AS count
    FROM places c
    WHERE c.kind = 'city' AND c.active = true
      AND c.ownership IN ('catalog:geonames', 'fixture:offline-europe-v1', 'catalog:bootstrap', 'manual')
      AND NOT EXISTS (
        SELECT 1 FROM meeting_city_hubs h
        WHERE h.city_place_id = c.id AND h.active = true
      )
  `);
  const eligibilityRows = await database.db.execute(sql`
    SELECT
      COUNT(*) FILTER (
        WHERE kind = 'city' AND active = true AND ownership = 'catalog:geonames'
          AND (feature_code IN ('PPLC', 'PPLA', 'PPLA2') OR COALESCE(population, 0) >= 100000)
      )::int AS tier_eligible,
      COUNT(*) FILTER (
        WHERE kind = 'city' AND active = true AND ownership = 'catalog:geonames'
          AND (feature_code IN ('PPLC', 'PPLA', 'PPLA2') OR COALESCE(population, 0) >= 100000)
          AND EXISTS (
            SELECT 1 FROM meeting_city_hubs h
            JOIN places hp ON hp.id = h.hub_place_id
            WHERE h.city_place_id = places.id AND h.active = true
              AND hp.active = true AND hp.ownership = 'catalog:transitous'
              AND hp.provider = 'motis' AND hp.provider_place_id IS NOT NULL
          )
      )::int AS hubbed_eligible,
      (SELECT COUNT(DISTINCT hub_place_id)::int FROM meeting_city_hubs WHERE active = true) AS unique_hubs,
      (SELECT COUNT(*)::int FROM meeting_city_hubs WHERE active = true AND regional = true) AS regional_assocs
    FROM places
  `);
  const countryRows = await database.db.execute(sql`
    SELECT country_code, COUNT(*)::int AS count
    FROM places
    WHERE kind = 'city' AND active = true
      AND ownership IN ('catalog:geonames', 'fixture:offline-europe-v1', 'catalog:bootstrap', 'manual')
    GROUP BY country_code
    ORDER BY country_code
  `);
  const city = (cityRows as unknown as Array<Record<string, number>>)[0] ?? {};
  const hub = (hubRows as unknown as Array<Record<string, number>>)[0] ?? {};
  const eligibility = (eligibilityRows as unknown as Array<Record<string, number>>)[0] ?? {};
  const countsByCountry: Record<string, number> = {};
  for (const row of countryRows as unknown as Array<{ country_code: string; count: number }>) {
    countsByCountry[row.country_code] = Number(row.count);
  }

  const tierEligible = Number(eligibility['tier_eligible'] ?? 0);
  const hubbedEligible = Number(eligibility['hubbed_eligible'] ?? 0);

  const versionRows = await database.db.execute(sql`
    SELECT DISTINCT source_version
    FROM places
    WHERE active = true
      AND ownership = 'catalog:geonames'
      AND source_version IS NOT NULL
    ORDER BY source_version ASC
  `);
  const versions = (versionRows as unknown as Array<{ source_version: string }>).map(
    (row) => row.source_version,
  );
  const newest = versions.at(-1) ?? null;
  const oldest = versions[0] ?? null;

  const runRows = await database.db
    .select({ sourceVersion: schema.catalogImportRuns.sourceVersion })
    .from(schema.catalogImportRuns)
    .where(eq(schema.catalogImportRuns.status, 'succeeded'))
    .orderBy(sql`${schema.catalogImportRuns.completedAt} DESC NULLS LAST`)
    .limit(1);
  const latestImportVersion = runRows[0]?.sourceVersion ?? newest;

  let manifestChecksum: string | null = null;
  let selectionPolicyVersion: string | null = null;
  if (existsSync(geonamesManifestPath())) {
    const manifest = loadSourceManifest(geonamesManifestPath());
    manifestChecksum = manifest.sha256;
    selectionPolicyVersion = manifest.selectionPolicyVersion;
  }

  return {
    activeCityCount: Number(city['active_city_count'] ?? 0),
    activeHubCount: Number(hub['active_hub_count'] ?? 0),
    citiesWithActiveHubs: Number(
      (linkedRows as unknown as Array<{ count: number }>)[0]?.count ?? 0,
    ),
    sourceVersion: latestImportVersion,
    fixtureCityCount: Number(city['fixture_city_count'] ?? 0),
    productionCityCount: Number(city['production_city_count'] ?? 0),
    productionHubCount: Number(hub['production_hub_count'] ?? 0),
    hubsWithProviderStopId: Number(hub['hubs_with_provider_stop_id'] ?? 0),
    associationCount: Number((assocRows as unknown as Array<{ count: number }>)[0]?.count ?? 0),
    countsByCountry,
    citiesWithoutHubs: Number(
      (withoutHubRows as unknown as Array<{ count: number }>)[0]?.count ?? 0,
    ),
    deactivatedCount: Number(city['deactivated_count'] ?? 0),
    manualOverrideCount: Number(city['manual_override_count'] ?? 0),
    oldestSourceVersion: oldest,
    newestSourceVersion: newest,
    manifestChecksum,
    selectionPolicyVersion,
    artifactDownloaded: existsSync(geonamesCacheZipPath()),
    productionImported: Number(city['production_city_count'] ?? 0) > 0,
    tierEligibleCityCount: tierEligible,
    eligibleHubbedCityCount: hubbedEligible,
    tierEligibleWithoutHubCount: Math.max(0, tierEligible - hubbedEligible),
    centroidFallbackOnlyCityCount: Number(
      (withoutHubRows as unknown as Array<{ count: number }>)[0]?.count ?? 0,
    ),
    uniqueProductionHubCount: Number(eligibility['unique_hubs'] ?? 0),
    regionalSharedHubAssociationCount: Number(eligibility['regional_assocs'] ?? 0),
  };
}

export async function getCatalogReadiness(database: Database) {
  const counts = await loadCatalogStatus(database);
  return buildCatalogStatusReport(counts);
}
