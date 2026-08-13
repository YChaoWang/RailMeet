import { createHash } from 'node:crypto';

import { PLACE_ID_MAX_LENGTH } from '@railmeet/shared';

/** Hex length of the content hash embedded in catalog hub place IDs. */
export const CATALOG_HUB_ID_HASH_LENGTH = 16;

const MOTIS_PREFIX = 'place:hub:motis:';

/**
 * Deterministic, globally unique, length-safe place ID for a Transitous/MOTIS stop.
 *
 * Format: `place:hub:motis:{readableSlug}-{sha256[:16]}` where the hash covers
 * `provider` + NUL + `providerPlaceId` (never truncation alone).
 *
 * The same provider stop always yields the same ID; different stops never collide
 * within {@link PLACE_ID_MAX_LENGTH}.
 */
export function buildCatalogHubPlaceId(provider: string, providerPlaceId: string): string {
  if (!provider.trim() || !providerPlaceId.trim()) {
    throw new Error('buildCatalogHubPlaceId requires non-empty provider and providerPlaceId');
  }

  const digest = createHash('sha256')
    .update(`${provider}\0${providerPlaceId}`, 'utf8')
    .digest('hex')
    .slice(0, CATALOG_HUB_ID_HASH_LENGTH);

  const prefix = provider === 'motis' ? MOTIS_PREFIX : `place:hub:${provider}:`;
  const hashSuffix = `-${digest}`;
  const maxSlugLength = PLACE_ID_MAX_LENGTH - prefix.length - hashSuffix.length;
  if (maxSlugLength < 1) {
    const fallback = `${prefix}${digest}`;
    if (fallback.length > PLACE_ID_MAX_LENGTH) {
      throw new Error(
        `Cannot build hub place ID within PLACE_ID_MAX_LENGTH=${PLACE_ID_MAX_LENGTH}`,
      );
    }
    return fallback;
  }

  const sanitized = providerPlaceId.replace(/[^a-zA-Z0-9._:-]+/g, '_');
  const slug = sanitized.slice(0, maxSlugLength).replace(/[_:-]+$/g, '') || digest.slice(0, 8);
  const id = `${prefix}${slug}${hashSuffix}`;
  if (id.length > PLACE_ID_MAX_LENGTH) {
    throw new Error(`Generated hub place ID exceeds PLACE_ID_MAX_LENGTH: ${id.length}`);
  }
  return id;
}

/**
 * Legacy truncated ID scheme (collision-prone). Used only to detect whether an
 * existing artifact ID is still valid under the new rules.
 */
export function legacyTruncatedCatalogHubPlaceId(providerPlaceId: string): string {
  const stableId = providerPlaceId.replace(/[^a-zA-Z0-9._:-]+/g, '_');
  return `place:hub:motis:${stableId}`.slice(0, PLACE_ID_MAX_LENGTH);
}

/**
 * Remap hub rows to length-safe IDs.
 * Preserves an existing ID when it already equals the deterministic new ID.
 * Associations keep working because `cityId` is unchanged and `id` is updated in place.
 */
export function remapCatalogHubIds<
  T extends { id: string; providerStopId?: string | null | undefined },
>(hubs: readonly T[]): T[] {
  return hubs.map((hub) => {
    if (!hub.providerStopId) {
      return hub;
    }
    const nextId = buildCatalogHubPlaceId('motis', hub.providerStopId);
    if (hub.id === nextId) {
      return hub;
    }
    return { ...hub, id: nextId };
  });
}

export type HubIdCollisionReport = {
  readonly duplicatedIdCount: number;
  readonly affectedStationCount: number;
  readonly countries: readonly string[];
  readonly providers: readonly string[];
  readonly examples: readonly {
    readonly id: string;
    readonly count: number;
    readonly stations: readonly {
      readonly cityId: string;
      readonly name: string;
      readonly countryCode: string;
      readonly providerStopId: string | null;
    }[];
  }[];
};

type HubCollisionRow = {
  readonly id: string;
  readonly cityId: string;
  readonly name: string;
  readonly countryCode: string;
  readonly providerStopId?: string | null | undefined;
  readonly hubSource?: string | undefined;
};

export function findHubIdCollisions(hubs: ReadonlyArray<HubCollisionRow>): HubIdCollisionReport {
  const byId = new Map<string, HubCollisionRow[]>();
  for (const hub of hubs) {
    const list = byId.get(hub.id) ?? [];
    list.push(hub);
    byId.set(hub.id, list);
  }
  const collisions = [...byId.entries()].filter(([, list]) => list.length > 1);
  const countries = new Set<string>();
  const providers = new Set<string>();
  for (const [, list] of collisions) {
    for (const hub of list) {
      countries.add(hub.countryCode);
      providers.add(hub.providerStopId ? 'motis' : (hub.hubSource ?? 'unknown'));
    }
  }
  return {
    duplicatedIdCount: collisions.length,
    affectedStationCount: collisions.reduce((sum, [, list]) => sum + list.length, 0),
    countries: [...countries].sort(),
    providers: [...providers].sort(),
    examples: collisions.slice(0, 10).map(([id, list]) => ({
      id,
      count: list.length,
      stations: list.map((hub) => ({
        cityId: hub.cityId,
        name: hub.name,
        countryCode: hub.countryCode,
        providerStopId: hub.providerStopId ?? null,
      })),
    })),
  };
}
