import { CATALOG_MAX_HUBS_PER_CANDIDATE } from '@railmeet/shared';

export type HubCandidate = {
  readonly hubPlaceId: string;
  readonly priority: number;
  readonly distanceMeters: number | null;
  readonly regional: boolean;
};

export type RoutingTargetSelection =
  | {
      readonly reason: 'hub';
      readonly hubPlaceId: string;
      readonly priority: number;
    }
  | {
      readonly reason: 'centroid_fallback';
      readonly hubPlaceId: null;
    }
  | {
      /** Production path: no authoritative hub and centroid fallback disabled. */
      readonly reason: 'no_routing_target';
      readonly hubPlaceId: null;
    };

/**
 * Deterministic primary routing target for a meeting city.
 * Production candidate generation must pass `{ allowCentroidFallback: false }`.
 * Centroid fallback is fixture/dev only and never counts as authoritative hub coverage.
 */
export function selectRoutingTarget(
  hubs: readonly HubCandidate[],
  options?: { readonly allowCentroidFallback?: boolean },
): RoutingTargetSelection {
  const allowCentroid = options?.allowCentroidFallback ?? false;
  const ordered = [...hubs].sort(
    (a, b) =>
      a.priority - b.priority ||
      (a.distanceMeters ?? Number.POSITIVE_INFINITY) -
        (b.distanceMeters ?? Number.POSITIVE_INFINITY) ||
      (a.hubPlaceId < b.hubPlaceId ? -1 : a.hubPlaceId > b.hubPlaceId ? 1 : 0),
  );
  const limited = ordered.slice(0, CATALOG_MAX_HUBS_PER_CANDIDATE);
  const primary = limited[0];
  if (primary) {
    return { reason: 'hub', hubPlaceId: primary.hubPlaceId, priority: primary.priority };
  }
  if (allowCentroid) {
    return { reason: 'centroid_fallback', hubPlaceId: null };
  }
  return { reason: 'no_routing_target', hubPlaceId: null };
}
