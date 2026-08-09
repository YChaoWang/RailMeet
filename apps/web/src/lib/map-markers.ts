import type { MeetingSearchDetailData, MeetingSearchResultsData } from '@railmeet/validation';
import type { RankingMode } from '@railmeet/shared';

import { decodeEncodedPolyline, type LonLat } from '@/lib/polyline';
import { rankingsForMode } from '@/lib/search-view-model';
import { travelerColorAt, travelerLetterAt } from '@/lib/traveler-identity';

export type MapOriginMarker = {
  readonly kind: 'origin';
  readonly id: string;
  readonly participantId: string;
  readonly label: string;
  readonly letter: string;
  readonly color: string;
  readonly longitude: number;
  readonly latitude: number;
  /** Journey summary for the selected candidate, when available. */
  readonly popup: MapTravelerPopup | null;
};

export type MapCandidateMarker = {
  readonly kind: 'candidate';
  readonly id: string;
  readonly placeId: string;
  readonly label: string;
  readonly rank: number;
  readonly selected: boolean;
  readonly longitude: number;
  readonly latitude: number;
  readonly popup: MapMeetingPopup | null;
};

export type MapTransferMarker = {
  readonly kind: 'transfer';
  readonly id: string;
  readonly participantId: string;
  readonly letter: string;
  readonly color: string;
  readonly longitude: number;
  readonly latitude: number;
};

export type MapMarker = MapOriginMarker | MapCandidateMarker | MapTransferMarker;

export type MapTravelerPopup = {
  readonly participantId: string;
  readonly displayName: string;
  readonly letter: string;
  readonly color: string;
  readonly originLabel: string;
  readonly departureAt: string;
  readonly arrivalAt: string;
  readonly durationMinutes: number;
  readonly transfers: number;
};

export type MapMeetingPopup = {
  readonly placeId: string;
  readonly name: string;
  readonly rank: number;
  readonly earliestArrivalAt: string;
  readonly latestArrivalAt: string;
  readonly arrivalSpreadMs: number;
};

export type MapRouteSegment = {
  readonly id: string;
  readonly participantId: string;
  readonly participantPosition: number;
  readonly letter: string;
  readonly color: string;
  readonly emphasized: boolean;
  readonly legIndex: number;
  readonly mode: string;
  readonly style: 'transit' | 'walk';
  readonly coordinates: readonly LonLat[];
  readonly popup: MapTravelerPopup;
};

export type MapMissingGeometryNote = {
  readonly participantId: string;
  readonly legIndex: number;
  readonly mode: string;
};

export type MapLegendEntry = {
  readonly participantId: string;
  readonly displayName: string;
  readonly letter: string;
  readonly color: string;
};

export type MapScene = {
  readonly markers: readonly MapMarker[];
  /** Decoded route segments for the selected candidate only — never fabricated. */
  readonly routeLines: readonly MapRouteSegment[];
  readonly missingGeometry: readonly MapMissingGeometryNote[];
  /** Stable traveler legend entries (letter + color + name). */
  readonly legend: readonly MapLegendEntry[];
  /**
   * Identity of geometry that should trigger an automatic camera fit.
   * Excludes emphasis / highlight so pan/zoom is not reset on traveler focus.
   */
  readonly cameraKey: string;
};

export const EMPTY_MAP_SCENE: MapScene = {
  markers: [],
  routeLines: [],
  missingGeometry: [],
  legend: [],
  cameraKey: '',
};

/** GeoJSON properties for the traveler-origin MapLibre source. */
export type TravelerOriginProperties = {
  readonly travelerId: string;
  readonly travelerLabel: string;
  readonly travelerName: string;
  readonly placeId: string;
  readonly placeLabel: string;
  readonly color: string;
};

export function originsToGeoJson(scene: MapScene): {
  type: 'FeatureCollection';
  features: Array<{
    type: 'Feature';
    id: string;
    properties: TravelerOriginProperties;
    geometry: { type: 'Point'; coordinates: [number, number] };
  }>;
} {
  return {
    type: 'FeatureCollection',
    features: scene.markers
      .filter((marker): marker is MapOriginMarker => marker.kind === 'origin')
      .map((marker) => ({
        type: 'Feature' as const,
        id: marker.id,
        properties: {
          travelerId: marker.participantId,
          travelerLabel: marker.letter,
          travelerName: marker.label,
          placeId: marker.id,
          placeLabel: marker.label,
          color: marker.color,
        },
        geometry: {
          type: 'Point' as const,
          coordinates: [marker.longitude, marker.latitude] as [number, number],
        },
      })),
  };
}

function hasCoords(place: {
  longitude?: number | undefined;
  latitude?: number | undefined;
}): place is { longitude: number; latitude: number } {
  return (
    typeof place.longitude === 'number' &&
    Number.isFinite(place.longitude) &&
    typeof place.latitude === 'number' &&
    Number.isFinite(place.latitude)
  );
}

function placeLabel(place: { placeId: string; name?: string | undefined }): string {
  return place.name ?? place.placeId;
}

export function candidateSelectionKey(mode: RankingMode, rank: number, placeId: string): string {
  return `${mode}:${rank}:${placeId}`;
}

function isWalkMode(mode: string): boolean {
  const normalized = mode.trim().toLowerCase();
  return normalized === 'walk' || normalized === 'foot';
}

function sceneCameraKey(
  markers: readonly MapMarker[],
  routeLines: readonly MapRouteSegment[],
): string {
  const markerPart = markers
    .map((marker) => {
      if (marker.kind === 'candidate') {
        return `${marker.id}:${marker.selected ? 1 : 0}:${marker.longitude}:${marker.latitude}`;
      }
      return `${marker.id}:${marker.longitude}:${marker.latitude}`;
    })
    .join('|');
  const routePart = routeLines
    .map(
      (segment) =>
        `${segment.id}:${segment.style}:${segment.coordinates.length}:${segment.coordinates[0]?.[0]}:${segment.coordinates[segment.coordinates.length - 1]?.[1]}`,
    )
    .join('|');
  return `${markerPart}::${routePart}`;
}

/** Lon/lat pairs used for fitBounds — origins, candidates, transfers, and every route vertex. */
export function collectSceneCoordinates(scene: MapScene): readonly LonLat[] {
  const points: LonLat[] = [];
  for (const marker of scene.markers) {
    points.push([marker.longitude, marker.latitude]);
  }
  for (const segment of scene.routeLines) {
    for (const coordinate of segment.coordinates) {
      points.push(coordinate);
    }
  }
  return points;
}

/**
 * Derive map markers and selected-candidate route segments strictly from API payloads.
 * Never invents coordinates or straight-line fallbacks for missing geometry.
 */
export function buildMapScene(input: {
  readonly summary: MeetingSearchDetailData | null;
  readonly results: MeetingSearchResultsData | null;
  readonly rankingMode: RankingMode;
  readonly selectedKey: string | null;
  readonly emphasizedParticipantId?: string | null;
}): MapScene {
  const markers: MapMarker[] = [];
  const routeLines: MapRouteSegment[] = [];
  const missingGeometry: MapMissingGeometryNote[] = [];
  const legend: MapLegendEntry[] = [];
  const travelerPopups = new Map<string, MapTravelerPopup>();

  if (input.summary) {
    for (const [index, participant] of input.summary.participants.entries()) {
      legend.push({
        participantId: participant.id,
        displayName: participant.displayName,
        letter: travelerLetterAt(index),
        color: travelerColorAt(index),
      });
    }
  }

  if (!input.results) {
    if (input.summary) {
      for (const [index, participant] of input.summary.participants.entries()) {
        if (!hasCoords(participant.origin)) {
          continue;
        }
        markers.push({
          kind: 'origin',
          id: `origin:${participant.id}`,
          participantId: participant.id,
          label: participant.displayName,
          letter: travelerLetterAt(index),
          color: travelerColorAt(index),
          longitude: participant.origin.longitude,
          latitude: participant.origin.latitude,
          popup: null,
        });
      }
    }
    return {
      markers,
      routeLines,
      missingGeometry,
      legend,
      cameraKey: sceneCameraKey(markers, routeLines),
    };
  }

  for (const candidate of rankingsForMode(input.results, input.rankingMode)) {
    if (!hasCoords(candidate.destination)) {
      continue;
    }
    const key = candidateSelectionKey(
      candidate.rankingMode,
      candidate.rank,
      candidate.destination.placeId,
    );
    const selected = input.selectedKey === key;
    markers.push({
      kind: 'candidate',
      id: `candidate:${key}`,
      placeId: candidate.destination.placeId,
      label: candidate.destination.name ?? candidate.destination.placeId,
      rank: candidate.rank,
      selected,
      longitude: candidate.destination.longitude,
      latitude: candidate.destination.latitude,
      popup: selected
        ? {
            placeId: candidate.destination.placeId,
            name: candidate.destination.name ?? candidate.destination.placeId,
            rank: candidate.rank,
            earliestArrivalAt: candidate.earliestArrivalAt,
            latestArrivalAt: candidate.latestArrivalAt,
            arrivalSpreadMs: candidate.arrivalSpreadMs,
          }
        : null,
    });
  }

  const selected = input.selectedKey
    ? rankingsForMode(input.results, input.rankingMode).find((candidate) => {
        const key = candidateSelectionKey(
          candidate.rankingMode,
          candidate.rank,
          candidate.destination.placeId,
        );
        return key === input.selectedKey;
      })
    : undefined;

  if (selected) {
    for (const journey of selected.journeys) {
      const color = travelerColorAt(journey.participantPosition);
      const letter = travelerLetterAt(journey.participantPosition);
      const popup: MapTravelerPopup = {
        participantId: journey.participantId,
        displayName: journey.participantDisplayName,
        letter,
        color,
        originLabel: placeLabel(journey.origin),
        departureAt: journey.departureAt,
        arrivalAt: journey.arrivalAt,
        durationMinutes: journey.durationMinutes,
        transfers: journey.transfers,
      };
      travelerPopups.set(journey.participantId, popup);

      const emphasized =
        !input.emphasizedParticipantId || input.emphasizedParticipantId === journey.participantId;

      for (const [legIndex, leg] of journey.legs.entries()) {
        if (!leg.geometry) {
          missingGeometry.push({
            participantId: journey.participantId,
            legIndex,
            mode: leg.mode,
          });
          continue;
        }
        try {
          const coordinates = decodeEncodedPolyline(leg.geometry.points, leg.geometry.precision);
          if (coordinates.length < 2) {
            missingGeometry.push({
              participantId: journey.participantId,
              legIndex,
              mode: leg.mode,
            });
            continue;
          }
          routeLines.push({
            id: `route:${selected.destination.placeId}:${journey.participantId}:${legIndex}`,
            participantId: journey.participantId,
            participantPosition: journey.participantPosition,
            letter,
            color,
            emphasized,
            legIndex,
            mode: leg.mode,
            style: isWalkMode(leg.mode) ? 'walk' : 'transit',
            coordinates,
            popup,
          });
        } catch {
          missingGeometry.push({
            participantId: journey.participantId,
            legIndex,
            mode: leg.mode,
          });
        }
      }

      const journeySegments = routeLines.filter(
        (segment) => segment.participantId === journey.participantId,
      );
      for (let index = 0; index < journeySegments.length - 1; index += 1) {
        const current = journeySegments[index]!;
        const next = journeySegments[index + 1]!;
        if (current.legIndex + 1 !== next.legIndex) {
          continue;
        }
        const end = current.coordinates[current.coordinates.length - 1];
        if (!end) {
          continue;
        }
        markers.push({
          kind: 'transfer',
          id: `transfer:${selected.destination.placeId}:${journey.participantId}:${current.legIndex}`,
          participantId: journey.participantId,
          letter,
          color,
          longitude: end[0],
          latitude: end[1],
        });
      }
    }
  }

  if (input.summary) {
    for (const [index, participant] of input.summary.participants.entries()) {
      if (!hasCoords(participant.origin)) {
        continue;
      }
      markers.push({
        kind: 'origin',
        id: `origin:${participant.id}`,
        participantId: participant.id,
        label: participant.displayName,
        letter: travelerLetterAt(index),
        color: travelerColorAt(index),
        longitude: participant.origin.longitude,
        latitude: participant.origin.latitude,
        popup: travelerPopups.get(participant.id) ?? null,
      });
    }
  }

  return {
    markers,
    routeLines,
    missingGeometry,
    legend,
    cameraKey: sceneCameraKey(markers, routeLines),
  };
}

/** Origin markers for the create-search form after place selection (coords from suggestion). */
export function buildDraftOriginScene(
  participants: ReadonlyArray<{
    readonly key: string;
    readonly id: string;
    readonly displayName: string;
    /** Stable letter assigned when the traveler row was created — not array index. */
    readonly letter: string;
    readonly color: string;
    readonly originSelected: {
      readonly name: string;
      readonly latitude: number;
      readonly longitude: number;
      readonly providerId?: string;
    } | null;
  }>,
): MapScene {
  const markers: MapMarker[] = [];
  const legend: MapLegendEntry[] = [];
  for (const participant of participants) {
    const letter = participant.letter;
    const color = participant.color;
    legend.push({
      participantId: participant.id,
      displayName: participant.displayName.trim() || `Traveler ${letter}`,
      letter,
      color,
    });
    const selected = participant.originSelected;
    if (!selected) {
      continue;
    }
    if (
      !Number.isFinite(selected.latitude) ||
      !Number.isFinite(selected.longitude) ||
      Math.abs(selected.latitude) > 90 ||
      Math.abs(selected.longitude) > 180
    ) {
      continue;
    }
    markers.push({
      kind: 'origin',
      id: `draft-origin:${participant.key}`,
      participantId: participant.id,
      label: participant.displayName.trim() || selected.name,
      letter,
      color,
      longitude: selected.longitude,
      latitude: selected.latitude,
      popup: null,
    });
  }
  return {
    markers,
    routeLines: [],
    missingGeometry: [],
    legend,
    cameraKey: sceneCameraKey(markers, []),
  };
}
