import { sql, inArray, and, eq } from 'drizzle-orm';

import { schema, type Database } from '@railmeet/database';

import { getCatalogReadiness } from './status.js';

/** Expected production counts after a full Europe catalog import. */
export const EXPECTED_PRODUCTION_GEONAMES_CITY_COUNT = 6075;
export const EXPECTED_PRODUCTION_TRANSITOUS_STATION_COUNT = 1355;

const FIXTURE_CITY_OWNERSHIP = 'fixture:offline-europe-v1' as const;
const FIXTURE_STATION_OWNERSHIP = 'catalog:hub' as const;

export type FixtureCleanupPlaceRef = {
  readonly id: string;
  readonly name: string;
  readonly kind: string;
  readonly ownership: string;
  readonly parentCityId: string | null;
  readonly provider: string | null;
  readonly providerPlaceId: string | null;
};

export type FixtureCleanupReferenceHit = {
  readonly table: string;
  readonly column: string;
  readonly placeId: string;
  readonly count: number;
};

export type FixtureCleanupOverlap = {
  readonly fixturePlaceId: string;
  readonly productionPlaceId: string;
  readonly reason: 'same_place_id' | 'same_provider_key' | 'related_geonames_id';
  readonly detail: string;
};

export type FixtureCleanupReport = {
  readonly fixtureCityCount: number;
  readonly fixtureStationCount: number;
  readonly associationCount: number;
  readonly fixtureCityIds: readonly string[];
  readonly fixtureStationIds: readonly string[];
  readonly references: readonly FixtureCleanupReferenceHit[];
  readonly overlaps: readonly FixtureCleanupOverlap[];
  readonly unsafeStations: readonly FixtureCleanupPlaceRef[];
  readonly blocking: boolean;
  readonly blockingReasons: readonly string[];
};

export type FixtureCleanupApplyResult = {
  readonly applied: true;
  readonly deletedAssociations: number;
  readonly deletedStations: number;
  readonly deletedCities: number;
  readonly deletedStationIds: readonly string[];
  readonly deletedCityIds: readonly string[];
  readonly report: FixtureCleanupReport;
  readonly validation: FixtureCleanupValidationResult;
};

export type FixtureCleanupDryRunResult = {
  readonly applied: false;
  readonly report: FixtureCleanupReport;
};

export type FixtureCleanupResult = FixtureCleanupDryRunResult | FixtureCleanupApplyResult;

export type FixtureCleanupValidationResult = {
  readonly ok: boolean;
  readonly fixtureCityCount: number;
  readonly fixtureStationCount: number;
  readonly geonamesCityCount: number;
  readonly transitousStationCount: number;
  readonly danglingParentCityCount: number;
  readonly duplicateProviderKeyCount: number;
  readonly readinessReady: boolean;
  readonly productionReadiness: string;
  readonly failures: readonly string[];
};

export type FixtureCleanupOptions = {
  /** When true, mutate. Default false (dry-run). */
  readonly apply?: boolean;
  /**
   * When true (CLI default), require geonames=6075, transitous=1355, and readiness.ready.
   * Integration tests set this false and assert relative preservation instead.
   */
  readonly strictProductionValidation?: boolean;
};

export class FixtureCleanupAbortedError extends Error {
  readonly report: FixtureCleanupReport;

  constructor(message: string, report: FixtureCleanupReport) {
    super(message);
    this.name = 'FixtureCleanupAbortedError';
    this.report = report;
  }
}

function asRows<T>(result: unknown): T[] {
  return result as T[];
}

async function loadFixtureCities(database: Database): Promise<FixtureCleanupPlaceRef[]> {
  const rows = await database.db
    .select({
      id: schema.places.id,
      name: schema.places.name,
      kind: schema.places.kind,
      ownership: schema.places.ownership,
      parentCityId: schema.places.parentCityId,
      provider: schema.places.provider,
      providerPlaceId: schema.places.providerPlaceId,
    })
    .from(schema.places)
    .where(
      and(eq(schema.places.kind, 'city'), eq(schema.places.ownership, FIXTURE_CITY_OWNERSHIP)),
    );
  return rows;
}

/**
 * Stations parented under fixture cities with ownership catalog:hub only.
 * Does not select catalog:transitous / manual / geonames rows.
 */
async function loadFixtureStations(
  database: Database,
  fixtureCityIds: readonly string[],
): Promise<FixtureCleanupPlaceRef[]> {
  if (fixtureCityIds.length === 0) {
    return [];
  }
  const rows = await database.db
    .select({
      id: schema.places.id,
      name: schema.places.name,
      kind: schema.places.kind,
      ownership: schema.places.ownership,
      parentCityId: schema.places.parentCityId,
      provider: schema.places.provider,
      providerPlaceId: schema.places.providerPlaceId,
    })
    .from(schema.places)
    .where(
      and(
        eq(schema.places.kind, 'station'),
        eq(schema.places.ownership, FIXTURE_STATION_OWNERSHIP),
        inArray(schema.places.parentCityId, [...fixtureCityIds]),
      ),
    );
  return rows;
}

async function loadUnsafeStations(
  database: Database,
  fixtureCityIds: readonly string[],
): Promise<FixtureCleanupPlaceRef[]> {
  if (fixtureCityIds.length === 0) {
    return [];
  }
  const rows = await database.db.execute(sql`
    SELECT
      id,
      name,
      kind,
      ownership,
      parent_city_id AS "parentCityId",
      provider,
      provider_place_id AS "providerPlaceId"
    FROM places
    WHERE kind = 'station'
      AND parent_city_id IN (${sql.join(
        fixtureCityIds.map((id) => sql`${id}`),
        sql`, `,
      )})
      AND ownership <> ${FIXTURE_STATION_OWNERSHIP}
  `);
  return asRows<FixtureCleanupPlaceRef>(rows);
}

async function countFixtureAssociations(
  database: Database,
  fixtureCityIds: readonly string[],
  fixtureStationIds: readonly string[],
): Promise<number> {
  if (fixtureCityIds.length === 0 && fixtureStationIds.length === 0) {
    return 0;
  }
  const cityList =
    fixtureCityIds.length > 0
      ? sql`city_place_id IN (${sql.join(
          fixtureCityIds.map((id) => sql`${id}`),
          sql`, `,
        )})`
      : sql`FALSE`;
  const hubList =
    fixtureStationIds.length > 0
      ? sql`hub_place_id IN (${sql.join(
          fixtureStationIds.map((id) => sql`${id}`),
          sql`, `,
        )})`
      : sql`FALSE`;
  const rows = await database.db.execute(sql`
    SELECT COUNT(*)::int AS count
    FROM meeting_city_hubs
    WHERE ${cityList} OR ${hubList}
  `);
  return Number(asRows<{ count: number }>(rows)[0]?.count ?? 0);
}

async function findSearchReferences(
  database: Database,
  placeIds: readonly string[],
): Promise<FixtureCleanupReferenceHit[]> {
  if (placeIds.length === 0) {
    return [];
  }
  const idList = sql.join(
    placeIds.map((id) => sql`${id}`),
    sql`, `,
  );
  const queries: Array<{ table: string; column: string; sql: ReturnType<typeof sql> }> = [
    {
      table: 'meeting_search_participants',
      column: 'origin_place_id',
      sql: sql`
        SELECT origin_place_id AS place_id, COUNT(*)::int AS count
        FROM meeting_search_participants
        WHERE origin_place_id IN (${idList})
        GROUP BY origin_place_id
      `,
    },
    {
      table: 'meeting_searches',
      column: 'recommended_destination_place_id',
      sql: sql`
        SELECT recommended_destination_place_id AS place_id, COUNT(*)::int AS count
        FROM meeting_searches
        WHERE recommended_destination_place_id IN (${idList})
        GROUP BY recommended_destination_place_id
      `,
    },
    {
      table: 'meeting_search_candidates',
      column: 'destination_place_id',
      sql: sql`
        SELECT destination_place_id AS place_id, COUNT(*)::int AS count
        FROM meeting_search_candidates
        WHERE destination_place_id IN (${idList})
        GROUP BY destination_place_id
      `,
    },
    {
      table: 'meeting_search_candidates',
      column: 'routing_hub_place_id',
      sql: sql`
        SELECT routing_hub_place_id AS place_id, COUNT(*)::int AS count
        FROM meeting_search_candidates
        WHERE routing_hub_place_id IN (${idList})
        GROUP BY routing_hub_place_id
      `,
    },
  ];

  const hits: FixtureCleanupReferenceHit[] = [];
  for (const query of queries) {
    const rows = asRows<{ place_id: string; count: number }>(
      await database.db.execute(query.sql),
    );
    for (const row of rows) {
      if (row.place_id) {
        hits.push({
          table: query.table,
          column: query.column,
          placeId: row.place_id,
          count: Number(row.count),
        });
      }
    }
  }
  return hits;
}

async function findOverlaps(
  database: Database,
  fixturePlaces: readonly FixtureCleanupPlaceRef[],
): Promise<FixtureCleanupOverlap[]> {
  if (fixturePlaces.length === 0) {
    return [];
  }
  const overlaps: FixtureCleanupOverlap[] = [];
  const fixtureIds = fixturePlaces.map((place) => place.id);

  // Same primary key cannot be both fixture and production; still report if a
  // production-owned row somehow shares an ID with the deletion set (should be empty).
  const sameIdRows = await database.db.execute(sql`
    SELECT id, ownership
    FROM places
    WHERE id IN (${sql.join(
      fixtureIds.map((id) => sql`${id}`),
      sql`, `,
    )})
      AND ownership NOT IN (${FIXTURE_CITY_OWNERSHIP}, ${FIXTURE_STATION_OWNERSHIP})
  `);
  for (const row of asRows<{ id: string; ownership: string }>(sameIdRows)) {
    overlaps.push({
      fixturePlaceId: row.id,
      productionPlaceId: row.id,
      reason: 'same_place_id',
      detail: `place id also has ownership ${row.ownership}`,
    });
  }

  const providerPairs = fixturePlaces.filter(
    (place) => place.provider && place.providerPlaceId,
  );
  if (providerPairs.length > 0) {
    const rows = await database.db.execute(sql`
      SELECT
        f.id AS fixture_id,
        p.id AS production_id,
        p.ownership AS production_ownership,
        f.provider,
        f.provider_place_id
      FROM places f
      JOIN places p
        ON p.provider = f.provider
       AND p.provider_place_id = f.provider_place_id
       AND p.id <> f.id
      WHERE f.id IN (${sql.join(
        providerPairs.map((place) => sql`${place.id}`),
        sql`, `,
      )})
        AND p.ownership IN ('catalog:geonames', 'catalog:transitous', 'manual', 'provider:motis')
    `);
    for (const row of asRows<{
      fixture_id: string;
      production_id: string;
      production_ownership: string;
      provider: string;
      provider_place_id: string;
    }>(rows)) {
      overlaps.push({
        fixturePlaceId: row.fixture_id,
        productionPlaceId: row.production_id,
        reason: 'same_provider_key',
        detail: `${row.provider}/${row.provider_place_id} also on ${row.production_ownership}`,
      });
    }
  }

  const relatedGeonames = await database.db.execute(sql`
    SELECT
      f.id AS fixture_id,
      g.id AS production_id,
      f.provider_place_id AS fixture_provider_place_id,
      g.provider_place_id AS geonames_id
    FROM places f
    JOIN places g
      ON g.kind = 'city'
     AND g.ownership = 'catalog:geonames'
     AND g.provider = 'geonames'
     AND g.provider_place_id = f.provider_place_id
    WHERE f.kind = 'city'
      AND f.ownership = ${FIXTURE_CITY_OWNERSHIP}
      AND f.provider_place_id IS NOT NULL
  `);
  for (const row of asRows<{
    fixture_id: string;
    production_id: string;
    fixture_provider_place_id: string;
    geonames_id: string;
  }>(relatedGeonames)) {
    overlaps.push({
      fixturePlaceId: row.fixture_id,
      productionPlaceId: row.production_id,
      reason: 'related_geonames_id',
      detail: `fixture provider_place_id ${row.fixture_provider_place_id} matches GeoNames ${row.geonames_id}`,
    });
  }

  return overlaps;
}

export async function inspectFixtureCleanup(database: Database): Promise<FixtureCleanupReport> {
  const cities = await loadFixtureCities(database);
  const fixtureCityIds = cities.map((city) => city.id);
  const stations = await loadFixtureStations(database, fixtureCityIds);
  const fixtureStationIds = stations.map((station) => station.id);
  const allPlaceIds = [...fixtureCityIds, ...fixtureStationIds];
  const [associationCount, references, overlaps, unsafeStations] = await Promise.all([
    countFixtureAssociations(database, fixtureCityIds, fixtureStationIds),
    findSearchReferences(database, allPlaceIds),
    findOverlaps(database, [...cities, ...stations]),
    loadUnsafeStations(database, fixtureCityIds),
  ]);

  const blockingReasons: string[] = [];
  if (references.length > 0) {
    blockingReasons.push(
      `Fixture places are referenced by non-catalog search data (${references.length} hit(s)); aborting instead of cascading.`,
    );
  }
  if (unsafeStations.length > 0) {
    blockingReasons.push(
      `${unsafeStations.length} station(s) parented under fixture cities have non-catalog:hub ownership; refusing cleanup.`,
    );
  }
  if (overlaps.some((row) => row.reason === 'same_place_id' || row.reason === 'same_provider_key')) {
    blockingReasons.push(
      'Fixture places overlap production GeoNames/Transitous/manual provider identity; refusing cleanup.',
    );
  }

  return {
    fixtureCityCount: cities.length,
    fixtureStationCount: stations.length,
    associationCount,
    fixtureCityIds,
    fixtureStationIds,
    references,
    overlaps,
    unsafeStations,
    blocking: blockingReasons.length > 0,
    blockingReasons,
  };
}

export async function validateFixtureCleanupState(
  database: Database,
  options: {
    readonly strictProductionValidation?: boolean;
    readonly expectedGeonamesCityCount?: number;
    readonly expectedTransitousStationCount?: number;
  } = {},
): Promise<FixtureCleanupValidationResult> {
  const strict = options.strictProductionValidation === true;
  const expectedGeonames =
    options.expectedGeonamesCityCount ??
    (strict ? EXPECTED_PRODUCTION_GEONAMES_CITY_COUNT : undefined);
  const expectedTransitous =
    options.expectedTransitousStationCount ??
    (strict ? EXPECTED_PRODUCTION_TRANSITOUS_STATION_COUNT : undefined);

  const countRows = await database.db.execute(sql`
    SELECT
      COUNT(*) FILTER (
        WHERE kind = 'city' AND ownership = ${FIXTURE_CITY_OWNERSHIP}
      )::int AS fixture_cities,
      COUNT(*) FILTER (
        WHERE kind = 'station'
          AND ownership = ${FIXTURE_STATION_OWNERSHIP}
          AND parent_city_id IN (
            SELECT id FROM places WHERE kind = 'city' AND ownership = ${FIXTURE_CITY_OWNERSHIP}
          )
      )::int AS fixture_stations,
      COUNT(*) FILTER (
        WHERE kind = 'city' AND ownership = 'catalog:geonames'
      )::int AS geonames_cities,
      COUNT(*) FILTER (
        WHERE kind = 'station' AND ownership = 'catalog:transitous'
      )::int AS transitous_stations
    FROM places
  `);
  const counts = asRows<{
    fixture_cities: number;
    fixture_stations: number;
    geonames_cities: number;
    transitous_stations: number;
  }>(countRows)[0]!;

  const danglingRows = await database.db.execute(sql`
    SELECT COUNT(*)::int AS count
    FROM places
    WHERE parent_city_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM places p2 WHERE p2.id = places.parent_city_id)
  `);
  const danglingParentCityCount = Number(
    asRows<{ count: number }>(danglingRows)[0]?.count ?? 0,
  );

  const dupRows = await database.db.execute(sql`
    SELECT COUNT(*)::int AS count
    FROM (
      SELECT provider, provider_place_id
      FROM places
      WHERE provider IS NOT NULL AND provider_place_id IS NOT NULL
      GROUP BY provider, provider_place_id
      HAVING COUNT(*) > 1
    ) dups
  `);
  const duplicateProviderKeyCount = Number(asRows<{ count: number }>(dupRows)[0]?.count ?? 0);

  const status = await getCatalogReadiness(database);
  const failures: string[] = [];
  const fixtureCityCount = Number(counts.fixture_cities);
  const fixtureStationCount = Number(counts.fixture_stations);
  const geonamesCityCount = Number(counts.geonames_cities);
  const transitousStationCount = Number(counts.transitous_stations);

  if (fixtureCityCount !== 0) {
    failures.push(`fixture city count is ${fixtureCityCount}, expected 0`);
  }
  if (fixtureStationCount !== 0) {
    failures.push(`associated fixture station count is ${fixtureStationCount}, expected 0`);
  }
  if (expectedGeonames !== undefined && geonamesCityCount !== expectedGeonames) {
    failures.push(`catalog:geonames city count is ${geonamesCityCount}, expected ${expectedGeonames}`);
  }
  if (expectedTransitous !== undefined && transitousStationCount !== expectedTransitous) {
    failures.push(
      `catalog:transitous station count is ${transitousStationCount}, expected ${expectedTransitous}`,
    );
  }
  if (danglingParentCityCount !== 0) {
    failures.push(`dangling parent_city_id count is ${danglingParentCityCount}`);
  }
  if (duplicateProviderKeyCount !== 0) {
    failures.push(`duplicate provider/provider_place_id groups: ${duplicateProviderKeyCount}`);
  }
  if (strict && !status.readiness.ready) {
    failures.push(`catalog readiness is not ready (${JSON.stringify(status.readiness)})`);
  }

  return {
    ok: failures.length === 0,
    fixtureCityCount,
    fixtureStationCount,
    geonamesCityCount,
    transitousStationCount,
    danglingParentCityCount,
    duplicateProviderKeyCount,
    readinessReady: status.readiness.ready,
    productionReadiness: status.productionReadiness,
    failures,
  };
}

/**
 * Dry-run or apply one-time cleanup of legacy offline fixture cities and their
 * associated catalog:hub stations. Never deletes catalog:transitous / geonames / manual wholesale.
 */
export async function cleanupOfflineFixture(
  database: Database,
  options: FixtureCleanupOptions = {},
): Promise<FixtureCleanupResult> {
  const apply = options.apply === true;
  const report = await inspectFixtureCleanup(database);

  if (!apply) {
    return { applied: false, report };
  }

  if (report.blocking) {
    throw new FixtureCleanupAbortedError(
      report.blockingReasons.join(' '),
      report,
    );
  }

  if (report.fixtureCityCount === 0 && report.fixtureStationCount === 0) {
    const validation = await validateFixtureCleanupState(database, {
      strictProductionValidation: options.strictProductionValidation === true,
    });
    return {
      applied: true,
      deletedAssociations: 0,
      deletedStations: 0,
      deletedCities: 0,
      deletedStationIds: [],
      deletedCityIds: [],
      report,
      validation,
    };
  }

  const cityIds = [...report.fixtureCityIds];
  const stationIds = [...report.fixtureStationIds];

  const deleted = await database.db.transaction(async (tx) => {
    let deletedAssociations = 0;
    if (cityIds.length > 0 || stationIds.length > 0) {
      const cityPred =
        cityIds.length > 0
          ? sql`city_place_id IN (${sql.join(
              cityIds.map((id) => sql`${id}`),
              sql`, `,
            )})`
          : sql`FALSE`;
      const hubPred =
        stationIds.length > 0
          ? sql`hub_place_id IN (${sql.join(
              stationIds.map((id) => sql`${id}`),
              sql`, `,
            )})`
          : sql`FALSE`;
      const assocResult = await tx.execute(sql`
        DELETE FROM meeting_city_hubs
        WHERE ${cityPred} OR ${hubPred}
        RETURNING city_place_id
      `);
      deletedAssociations = asRows<unknown>(assocResult).length;
    }

    let deletedStations = 0;
    if (stationIds.length > 0) {
      const stationResult = await tx
        .delete(schema.places)
        .where(inArray(schema.places.id, stationIds))
        .returning({ id: schema.places.id });
      deletedStations = stationResult.length;
    }

    let deletedCities = 0;
    if (cityIds.length > 0) {
      const cityResult = await tx
        .delete(schema.places)
        .where(inArray(schema.places.id, cityIds))
        .returning({ id: schema.places.id });
      deletedCities = cityResult.length;
    }

    return {
      deletedAssociations,
      deletedStations,
      deletedCities,
    };
  });

  const validation = await validateFixtureCleanupState(database, {
    strictProductionValidation: options.strictProductionValidation === true,
  });
  if (!validation.ok && options.strictProductionValidation === true) {
    throw new Error(
      `Fixture cleanup applied but post-validation failed: ${validation.failures.join('; ')}`,
    );
  }

  return {
    applied: true,
    deletedAssociations: deleted.deletedAssociations,
    deletedStations: deleted.deletedStations,
    deletedCities: deleted.deletedCities,
    deletedStationIds: stationIds,
    deletedCityIds: cityIds,
    report,
    validation,
  };
}

/** Count helper for tests: total places with catalog:hub (any parent). */
export async function countCatalogHubStations(database: Database): Promise<number> {
  const rows = await database.db
    .select({ id: schema.places.id })
    .from(schema.places)
    .where(and(eq(schema.places.kind, 'station'), eq(schema.places.ownership, 'catalog:hub')));
  return rows.length;
}

export async function countPlacesByOwnership(
  database: Database,
  ownership: string,
  kind?: 'city' | 'station',
): Promise<number> {
  const conditions = [eq(schema.places.ownership, ownership)];
  if (kind) {
    conditions.push(eq(schema.places.kind, kind));
  }
  const rows = await database.db
    .select({ id: schema.places.id })
    .from(schema.places)
    .where(and(...conditions));
  return rows.length;
}
