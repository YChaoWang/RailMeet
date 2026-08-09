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
};

export type MapMissingGeometryNote = {
  readonly participantId: string;
  readonly legIndex: number;
  readonly mode: string;
};

export type MapScene = {
  readonly markers: readonly MapMarker[];
  /** Decoded route segments for the selected candidate only — never fabricated. */
  readonly routeLines: readonly MapRouteSegment[];
  readonly missingGeometry: readonly MapMissingGeometryNote[];
};

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

export function candidateSelectionKey(mode: RankingMode, rank: number, placeId: string): string {
  return `${mode}:${rank}:${placeId}`;
}

function isWalkMode(mode: string): boolean {
  const normalized = mode.trim().toLowerCase();
  return normalized === 'walk' || normalized === 'foot';
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
      });
    }
  }

  if (!input.results) {
    return { markers, routeLines, missingGeometry };
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
    markers.push({
      kind: 'candidate',
      id: `candidate:${key}`,
      placeId: candidate.destination.placeId,
      label: candidate.destination.name ?? candidate.destination.placeId,
      rank: candidate.rank,
      selected: input.selectedKey === key,
      longitude: candidate.destination.longitude,
      latitude: candidate.destination.latitude,
    });
  }

  if (!input.selectedKey) {
    return { markers, routeLines, missingGeometry };
  }

  const selected = rankingsForMode(input.results, input.rankingMode).find((candidate) => {
    const key = candidateSelectionKey(
      candidate.rankingMode,
      candidate.rank,
      candidate.destination.placeId,
    );
    return key === input.selectedKey;
  });

  if (!selected) {
    return { markers, routeLines, missingGeometry };
  }

  for (const journey of selected.journeys) {
    const color = travelerColorAt(journey.participantPosition);
    const letter = travelerLetterAt(journey.participantPosition);
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
        });
      } catch {
        missingGeometry.push({
          participantId: journey.participantId,
          legIndex,
          mode: leg.mode,
        });
      }
    }

    // Transfer points from consecutive decoded leg endpoints (no fabricated midpoints).
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

  return { markers, routeLines, missingGeometry };
}

/** Origin markers for the create-search form after place selection (coords from suggestion). */
export function buildDraftOriginScene(
  participants: ReadonlyArray<{
    readonly key: string;
    readonly id: string;
    readonly displayName: string;
    readonly originSelected: {
      readonly name: string;
      readonly latitude: number;
      readonly longitude: number;
    } | null;
  }>,
): MapScene {
  const markers: MapMarker[] = [];
  for (const [index, participant] of participants.entries()) {
    const selected = participant.originSelected;
    if (!selected) {
      continue;
    }
    markers.push({
      kind: 'origin',
      id: `draft-origin:${participant.key}`,
      participantId: participant.id,
      label: participant.displayName.trim() || selected.name,
      letter: travelerLetterAt(index),
      color: travelerColorAt(index),
      longitude: selected.longitude,
      latitude: selected.latitude,
    });
  }
  return { markers, routeLines: [], missingGeometry: [] };
}
