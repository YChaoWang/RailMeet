/**
 * Place / catalog ownership namespaces.
 * Catalog imports must not overwrite higher-priority ownership without an explicit policy.
 */
export const PLACE_OWNERSHIPS = [
  'manual',
  'catalog:bootstrap',
  'catalog:geonames',
  'catalog:hub',
  'catalog:transitous',
  'fixture:offline-europe-v1',
  'provider:motis',
] as const;

export type PlaceOwnership = (typeof PLACE_OWNERSHIPS)[number];

export function isPlaceOwnership(value: string): value is PlaceOwnership {
  return (PLACE_OWNERSHIPS as readonly string[]).includes(value);
}

/** Ownership values that the catalog importer may create or refresh. */
export const CATALOG_MANAGED_OWNERSHIPS = [
  'catalog:bootstrap',
  'catalog:geonames',
  'catalog:hub',
  'catalog:transitous',
  'fixture:offline-europe-v1',
] as const;

export type CatalogManagedOwnership = (typeof CATALOG_MANAGED_OWNERSHIPS)[number];

export function isCatalogManagedOwnership(value: string): value is CatalogManagedOwnership {
  return (CATALOG_MANAGED_OWNERSHIPS as readonly string[]).includes(value);
}

/** Cities that count toward production catalog readiness (not fixtures/bootstrap). */
export const PRODUCTION_CITY_OWNERSHIPS = ['catalog:geonames'] as const;

/** Hubs that count toward production catalog readiness. */
export const PRODUCTION_HUB_OWNERSHIPS = ['catalog:transitous', 'catalog:hub'] as const;

export function isProductionCityOwnership(value: string): boolean {
  return (PRODUCTION_CITY_OWNERSHIPS as readonly string[]).includes(value);
}

export function isFixtureCityOwnership(value: string): boolean {
  return value.startsWith('fixture:') || value === 'catalog:bootstrap';
}
