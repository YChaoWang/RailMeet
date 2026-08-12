import { CATALOG_MIN_ACTIVE_CITIES } from '@railmeet/shared';

import { MEETING_CITY_POLICY_VERSION } from './eligibility.js';
import type { CatalogReadiness, ProductionReadinessKind } from './types.js';

export type CatalogStatusCounts = {
  readonly activeCityCount: number;
  readonly activeHubCount: number;
  readonly citiesWithActiveHubs: number;
  readonly sourceVersion: string | null;
  readonly fixtureCityCount?: number;
  readonly productionCityCount?: number;
  readonly productionHubCount?: number;
  readonly hubsWithProviderStopId?: number;
  readonly associationCount?: number;
  readonly countsByCountry?: Readonly<Record<string, number>>;
  readonly citiesWithoutHubs?: number;
  readonly deactivatedCount?: number;
  readonly manualOverrideCount?: number;
  readonly oldestSourceVersion?: string | null;
  readonly newestSourceVersion?: string | null;
  readonly manifestChecksum?: string | null;
  readonly selectionPolicyVersion?: string | null;
  readonly artifactDownloaded?: boolean;
  readonly productionImported?: boolean;
  /** Cities passing meeting-city tier policy (admin/population), ignoring hubs. */
  readonly tierEligibleCityCount?: number;
  /** Tier-eligible cities that also have an authoritative primary hub. */
  readonly eligibleHubbedCityCount?: number;
  /** Tier-eligible cities lacking a primary hub. */
  readonly tierEligibleWithoutHubCount?: number;
  /** Cities that would only be routable via centroid (no hub). */
  readonly centroidFallbackOnlyCityCount?: number;
  readonly uniqueProductionHubCount?: number;
  readonly regionalSharedHubAssociationCount?: number;
  readonly ambiguousAssociationCount?: number;
  readonly rejectedAssociationCount?: number;
};

export type CatalogStatusReport = {
  readonly counts: CatalogStatusCounts;
  /** Whether the worker may schedule routing (requires hubbed eligible cities). */
  readonly readiness: CatalogReadiness;
  readonly productionReadiness: ProductionReadinessKind;
  readonly readinessReasons: readonly string[];
  readonly meetingCityPolicyVersion: string;
};

/**
 * Worker scheduling gate.
 * Requires a non-trivial set of tier-eligible cities with authoritative hubs.
 * Does NOT treat centroid fallback or fixture cities as ready.
 */
export function evaluateCatalogReadiness(counts: CatalogStatusCounts): CatalogReadiness {
  const fixtureCities = counts.fixtureCityCount ?? 0;
  const productionCities = counts.productionCityCount ?? 0;
  const hubbedEligible = counts.eligibleHubbedCityCount ?? 0;
  const hubsWithIds = counts.hubsWithProviderStopId ?? 0;

  if (productionCities === 0 && fixtureCities > 0) {
    return {
      ready: false,
      code: 'CANDIDATE_CATALOG_NOT_READY',
      activeCityCount: counts.activeCityCount,
      activeHubCount: counts.activeHubCount,
      message: `Fixture-only catalog (${fixtureCities} fixture cities); production GeoNames cities absent.`,
    };
  }

  if (productionCities === 0) {
    return {
      ready: false,
      code: 'CANDIDATE_CATALOG_NOT_READY',
      activeCityCount: counts.activeCityCount,
      activeHubCount: counts.activeHubCount,
      message: 'Production GeoNames catalog is absent.',
    };
  }

  if (hubsWithIds === 0 || hubbedEligible === 0) {
    return {
      ready: false,
      code: 'CANDIDATES_HAVE_NO_ROUTING_TARGET',
      activeCityCount: counts.activeCityCount,
      activeHubCount: counts.activeHubCount,
      message:
        'No tier-eligible meeting cities have an authoritative primary hub; centroid fallback is not production-ready.',
    };
  }

  if (hubbedEligible < CATALOG_MIN_ACTIVE_CITIES) {
    return {
      ready: false,
      code: 'CANDIDATE_CATALOG_NOT_READY',
      activeCityCount: counts.activeCityCount,
      activeHubCount: counts.activeHubCount,
      message: `Only ${hubbedEligible} hubbed eligible meeting cities; need at least ${CATALOG_MIN_ACTIVE_CITIES}.`,
    };
  }

  return {
    ready: true,
    activeCityCount: counts.activeCityCount,
    activeHubCount: counts.activeHubCount,
  };
}

/**
 * Honest production readiness classification.
 * `production-catalog-ready` requires every tier-eligible city to have a primary hub.
 * Partial hub coverage (e.g. ~242 / thousands) must never report ready.
 */
export function classifyProductionReadiness(counts: CatalogStatusCounts): {
  readonly kind: ProductionReadinessKind;
  readonly reasons: readonly string[];
} {
  const reasons: string[] = [];
  const productionCities = counts.productionCityCount ?? 0;
  const fixtureCities = counts.fixtureCityCount ?? 0;
  const hubsWithIds = counts.hubsWithProviderStopId ?? 0;
  const tierEligible = counts.tierEligibleCityCount ?? 0;
  const hubbedEligible = counts.eligibleHubbedCityCount ?? 0;
  const tierWithoutHub =
    counts.tierEligibleWithoutHubCount ?? Math.max(0, tierEligible - hubbedEligible);
  const withoutHubs = counts.citiesWithoutHubs ?? 0;

  if (fixtureCities > 0 && productionCities === 0) {
    reasons.push('Only fixture/bootstrap cities are active');
    return { kind: 'fixture-only-catalog', reasons };
  }
  if (productionCities === 0) {
    if (counts.artifactDownloaded && !counts.productionImported) {
      reasons.push('Production GeoNames artifact downloaded but not imported');
      return { kind: 'production-artifact-downloaded', reasons };
    }
    reasons.push('No production GeoNames cities imported');
    return { kind: 'production-catalog-absent', reasons };
  }

  if (
    counts.oldestSourceVersion &&
    counts.newestSourceVersion &&
    counts.oldestSourceVersion !== counts.newestSourceVersion
  ) {
    reasons.push(
      `Active production source versions differ (${counts.oldestSourceVersion} vs ${counts.newestSourceVersion})`,
    );
    return { kind: 'production-catalog-stale', reasons };
  }

  if (hubsWithIds === 0 || hubbedEligible === 0) {
    reasons.push(
      `GeoNames imported (${productionCities}) but no authoritative hubbed eligible meeting cities`,
    );
    reasons.push(`${withoutHubs} imported cities lack hubs`);
    return { kind: 'production-catalog-unusable', reasons };
  }

  if (tierWithoutHub > 0 || withoutHubs > hubbedEligible) {
    reasons.push(
      `Partial hub coverage: ${hubbedEligible} hubbed eligible / ${tierEligible || productionCities} tier-eligible (or imported) cities`,
    );
    reasons.push(`${tierWithoutHub} tier-eligible cities lack an authoritative primary hub`);
    reasons.push(`${withoutHubs} imported cities have no hub association`);
    reasons.push('Centroid fallback must not count as authoritative hub coverage');
    reasons.push(
      `Meeting-city policy ${MEETING_CITY_POLICY_VERSION}; selection ${counts.selectionPolicyVersion ?? 'unknown'}`,
    );
    // Operational searches may still run if evaluateCatalogReadiness passes.
    if (evaluateCatalogReadiness(counts).ready) {
      return { kind: 'production-catalog-partial', reasons };
    }
    return { kind: 'production-catalog-unusable', reasons };
  }

  if (hubbedEligible < CATALOG_MIN_ACTIVE_CITIES) {
    reasons.push(
      `Only ${hubbedEligible} hubbed eligible cities (need ${CATALOG_MIN_ACTIVE_CITIES})`,
    );
    return { kind: 'production-catalog-unusable', reasons };
  }

  reasons.push(
    `All ${tierEligible} tier-eligible meeting cities have authoritative primary hubs (${hubbedEligible})`,
  );
  return { kind: 'production-catalog-ready', reasons };
}

export function buildCatalogStatusReport(counts: CatalogStatusCounts): CatalogStatusReport {
  const { kind, reasons } = classifyProductionReadiness(counts);
  return {
    counts,
    readiness: evaluateCatalogReadiness(counts),
    productionReadiness: kind,
    readinessReasons: reasons,
    meetingCityPolicyVersion: MEETING_CITY_POLICY_VERSION,
  };
}
