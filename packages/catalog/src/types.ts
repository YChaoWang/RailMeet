import { z } from 'zod';

export const catalogCityOwnershipSchema = z.enum([
  'catalog:bootstrap',
  'catalog:geonames',
  'fixture:offline-europe-v1',
]);

export const catalogCitySchema = z
  .object({
    id: z.string().min(1).max(128),
    externalId: z.string().min(1).max(512),
    geonamesId: z.number().int().positive().nullable().optional(),
    name: z.string().min(1).max(200),
    countryCode: z.string().regex(/^[A-Z]{2}$/),
    timezone: z.string().min(1).max(64),
    latitude: z.number().finite().gte(-90).lte(90),
    longitude: z.number().finite().gte(-180).lte(180),
    ownership: catalogCityOwnershipSchema,
    population: z.number().int().nonnegative().optional(),
    featureClass: z.string().min(1).max(1).optional(),
    featureCode: z.string().min(1).max(10).optional(),
  })
  .strict();

export const catalogHubSchema = z
  .object({
    id: z.string().min(1).max(128),
    externalId: z.string().min(1).max(512),
    name: z.string().min(1).max(200),
    countryCode: z.string().regex(/^[A-Z]{2}$/),
    timezone: z.string().min(1).max(64),
    latitude: z.number().finite().gte(-90).lte(90),
    longitude: z.number().finite().gte(-180).lte(180),
    cityId: z.string().min(1).max(128),
    priority: z.number().int().nonnegative(),
    matchMethod: z.string().min(1).max(128),
    regional: z.boolean(),
    /** Real provider stop id when known; never invent MOTIS IDs. */
    providerStopId: z.string().min(1).max(512).nullable().optional(),
    hubSource: z.string().min(1).max(128).optional(),
    confidence: z.enum(['high', 'medium', 'low', 'rejected']).optional(),
  })
  .strict();

export const catalogArtifactSchema = z
  .object({
    schemaVersion: z.literal(1),
    source: z.string().min(1),
    sourceVersion: z.string().min(1),
    license: z.string().min(1),
    attribution: z.string().min(1),
    retrievedAt: z.string().min(1),
    coverage: z.string().min(1),
    artifactKind: z
      .enum(['offline-test-fixture', 'development-bootstrap-seed', 'production-catalog'])
      .optional(),
    selectionPolicyVersion: z.string().min(1).optional(),
    cities: z.array(catalogCitySchema).min(1),
    hubs: z.array(catalogHubSchema),
  })
  .strict();

export type CatalogCity = z.infer<typeof catalogCitySchema>;
export type CatalogHub = z.infer<typeof catalogHubSchema>;
export type CatalogArtifact = z.infer<typeof catalogArtifactSchema>;

export type CatalogValidationReport = {
  readonly source: string;
  readonly sourceVersion: string;
  readonly artifactKind: string | null;
  readonly selectionPolicyVersion: string | null;
  readonly importedCityCount: number;
  readonly activeCityCount: number;
  readonly activeHubCount: number;
  readonly countriesCovered: readonly string[];
  readonly countsByCountry: Readonly<Record<string, number>>;
  readonly citiesWithoutHubs: readonly string[];
  readonly citiesWithMultiplePrimaryHubs: readonly string[];
  readonly citiesUsingCentroidFallbackEligible: readonly string[];
  readonly invalidTimeZones: readonly string[];
  readonly invalidCoordinates: readonly string[];
  readonly duplicateExternalIds: readonly string[];
  readonly ambiguousMatches: readonly string[];
  readonly rejectedRecords: readonly string[];
  readonly fixtureRecordCount: number;
  readonly productionCityCount: number;
  readonly hubsWithProviderStopId: number;
  readonly ok: boolean;
};

export type CatalogReadiness =
  | { readonly ready: true; readonly activeCityCount: number; readonly activeHubCount: number }
  | {
      readonly ready: false;
      readonly code: 'CANDIDATE_CATALOG_NOT_READY' | 'CANDIDATES_HAVE_NO_ROUTING_TARGET';
      readonly activeCityCount: number;
      readonly activeHubCount: number;
      readonly message: string;
    };

export type ProductionReadinessKind =
  | 'fixture-only-catalog'
  | 'production-catalog-absent'
  | 'production-artifact-downloaded'
  | 'production-catalog-imported'
  | 'production-catalog-partial'
  | 'production-catalog-operational-with-fallback'
  | 'production-catalog-unusable'
  | 'production-catalog-stale'
  | 'production-catalog-ready'
  /** @deprecated alias retained for older status snapshots */
  | 'production-artifact-downloaded-not-imported'
  | 'catalog-imported-but-unusable'
  | 'catalog-ready'
  | 'catalog-stale-or-source-version-mismatch';

export type SourceManifest = {
  readonly source: string;
  readonly artifactUrl: string;
  readonly retrievedAt: string | null;
  readonly version: string | null;
  readonly sha256: string | null;
  readonly expectedSha256: string | null;
  readonly license: string;
  readonly attribution: string;
  readonly format: string;
  readonly coverage: string;
  readonly selectionPolicyVersion: string;
};
