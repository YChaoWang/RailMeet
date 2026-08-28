import type { MeetingSearchDetailData, MeetingSearchResultsData } from '@railmeet/validation';
import type { RankingMode } from '@railmeet/shared';
import { formatJourneyServiceLabel, resolveMapRoutePaint } from '@railmeet/shared';

import { rankingLegMotisMode } from '@/lib/journey-leg-presentation';
import { decodeEncodedPolyline, type LonLat } from '@/lib/polyline';
import { rankingsForMode } from '@/lib/search-view-model';
import { travelerColorAt, travelerLetterAt } from '@/lib/traveler-identity';

/** Walking is never rendered in a traveler or route color — always neutral gray dashes. */
export const MAP_WALK_COLOR = '#6b7280';

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

export type MapStopRole = 'origin-station' | 'intermediate' | 'transfer' | 'meeting';

/**
 * Collision ranking for the stop label symbol layer. MapLibre uses a lower
 * `symbol-sort-key` for higher-priority labels when placements collide.
 */
export const STOP_LABEL_PRIORITY: Record<MapStopRole, number> = {
  meeting: 400,
  transfer: 300,
  'origin-station': 200,
  intermediate: 100,
};

/**
 * A real transit stop from the provider itinerary (leg.from / intermediateStops / leg.to).
 * Only emitted when MOTIS supplied finite coordinates — positions are never fabricated.
 */
export type MapStopMarker = {
  readonly kind: 'stop';
  readonly id: string;
  readonly participantId: string;
  readonly letter: string;
  readonly role: MapStopRole;
  readonly name: string;
  /** Route color of the service calling here, so the marker matches its polyline. */
  readonly color: string;
  /** Primary stroke: the departing service, falling back to the calling service. */
  readonly borderColor: string;
  /** Outer ring drawn at a transfer, painted in the arriving service's color. */
  readonly ringColor?: string;
  readonly textColor: string;
  readonly longitude: number;
  readonly latitude: number;
  readonly arrivalAt?: string;
  readonly departureAt?: string;
  readonly track?: string;
  /** Service arriving at / departing from this stop. Both are set at a transfer. */
  readonly arrivingService?: string;
  readonly departingService?: string;
  /** False when another traveler's journey is focused. */
  readonly emphasized: boolean;
  /** Whether the symbol layer should try to keep a permanent name here. */
  readonly showLabel: boolean;
  readonly labelPriority: number;
};

export type MapMarker = MapOriginMarker | MapCandidateMarker | MapStopMarker;

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

export type MapRouteColorSource = 'provider' | 'mode-fallback';

export type MapRouteSegment = {
  readonly id: string;
  readonly participantId: string;
  readonly participantPosition: number;
  readonly letter: string;
  /** Transitous routeColor for transit legs; neutral gray for walking. Never a traveler color. */
  readonly color: string;
  readonly textColor: string;
  readonly colorSource: MapRouteColorSource;
  readonly emphasized: boolean;
  readonly legIndex: number;
  readonly mode: string;
  readonly motisMode: string;
  readonly style: 'transit' | 'walk';
  readonly serviceLabel: string;
  readonly displayName?: string;
  readonly routeShortName?: string;
  readonly tripShortName?: string;
  readonly agencyName?: string;
  readonly headsign?: string;
  readonly fromName?: string;
  readonly toName?: string;
  readonly departureAt: string;
  readonly arrivalAt: string;
  readonly intermediateStopCount: number;
  readonly coordinates: readonly LonLat[];
  readonly popup: MapTravelerPopup;
};

export type MapMissingGeometryNote = {
  readonly participantId: string;
  readonly legIndex: number;
  readonly mode: string;
};

/** One transit service inside a traveler's legend group, painted in its route color. */
export type MapLegendService = {
  readonly color: string;
  readonly textColor: string;
  readonly mode: string;
  readonly displayName: string;
  readonly colorSource: MapRouteColorSource;
};

export type MapLegendEntry = {
  readonly participantId: string;
  readonly displayName: string;
  readonly letter: string;
  /** Traveler identity color — used for origin markers and the legend badge only. */
  readonly color: string;
  readonly services: readonly MapLegendService[];
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

/** GeoJSON properties for the route-stop circle, ring, and label layers. */
export type RouteStopProperties = {
  readonly stopId: string;
  readonly name: string;
  readonly role: MapStopRole;
  readonly color: string;
  readonly borderColor: string;
  /** Empty string when this stop has no arriving service to ring. */
  readonly ringColor: string;
  readonly textColor: string;
  /** Darkened route tint painted along each station-name glyph outline. */
  readonly labelBackgroundColor: string;
  readonly emphasized: boolean;
  readonly showLabel: boolean;
  readonly labelPriority: number;
  readonly roleRank: number;
  readonly participantId: string;
  readonly letter: string;
  readonly arrivalAt: string;
  readonly departureAt: string;
  readonly arrivingService: string;
  readonly departingService: string;
  readonly track: string;
};

/** Slightly darken a provider route hex for station name halos. */
export function shadeRouteLabelBackground(routeColor: string): string {
  const normalized = routeColor.trim().replace(/^#/, '');
  if (!/^[\da-f]{6}$/i.test(normalized)) {
    return routeColor;
  }
  const shade = (channel: number) => Math.max(0, Math.round(channel * 0.82));
  const red = shade(Number.parseInt(normalized.slice(0, 2), 16));
  const green = shade(Number.parseInt(normalized.slice(2, 4), 16));
  const blue = shade(Number.parseInt(normalized.slice(4, 6), 16));
  return `#${red.toString(16).padStart(2, '0')}${green.toString(16).padStart(2, '0')}${blue.toString(16).padStart(2, '0')}`;
}

export function routeStopsToGeoJson(scene: MapScene): {
  type: 'FeatureCollection';
  features: Array<{
    type: 'Feature';
    id: string;
    properties: RouteStopProperties;
    geometry: { type: 'Point'; coordinates: [number, number] };
  }>;
} {
  return {
    type: 'FeatureCollection',
    features: scene.markers
      .filter((marker): marker is MapStopMarker => marker.kind === 'stop')
      .map((marker) => ({
        type: 'Feature' as const,
        id: marker.id,
        properties: {
          stopId: marker.id,
          name: marker.name,
          role: marker.role,
          color: marker.color,
          borderColor: marker.borderColor,
          ringColor: marker.ringColor ?? '',
          textColor: marker.textColor,
          labelBackgroundColor: shadeRouteLabelBackground(marker.borderColor),
          emphasized: marker.emphasized,
          showLabel: marker.showLabel,
          labelPriority: marker.labelPriority,
          roleRank: marker.labelPriority,
          participantId: marker.participantId,
          letter: marker.letter,
          arrivalAt: marker.arrivalAt ?? '',
          departureAt: marker.departureAt ?? '',
          arrivingService: marker.arrivingService ?? '',
          departingService: marker.departingService ?? '',
          track: marker.track ?? '',
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

type ResultsJourney = MeetingSearchResultsData['rankings'][number]['journeys'][number];
type ResultsLeg = ResultsJourney['legs'][number];
type ResultsStop = NonNullable<ResultsLeg['from']>;
type ResultsIntermediateStop = NonNullable<ResultsLeg['intermediateStops']>[number];

type LegPaint = {
  readonly color: string;
  readonly textColor: string;
  readonly colorSource: MapRouteColorSource;
};

/** MOTIS uses these synthetic names for the raw request coordinates, not real stops. */
function isSyntheticStopName(name: string): boolean {
  return name === 'START' || name === 'END';
}

function legIsWalk(leg: ResultsLeg, motisMode: string): boolean {
  return isWalkMode(leg.mode) || isWalkMode(motisMode);
}

/**
 * Transit legs are painted with the Transitous route color (or the MOTIS mode
 * default when the feed publishes none). Walking is always neutral gray.
 */
function legPaint(leg: ResultsLeg, motisMode: string): LegPaint {
  if (legIsWalk(leg, motisMode)) {
    return { color: MAP_WALK_COLOR, textColor: '#ffffff', colorSource: 'mode-fallback' };
  }
  return resolveMapRoutePaint({
    mode: motisMode,
    ...(leg.routeColor ? { routeColor: leg.routeColor } : {}),
    ...(leg.routeTextColor ? { routeTextColor: leg.routeTextColor } : {}),
  });
}

function legServiceLabel(leg: ResultsLeg, motisMode: string): string {
  return formatJourneyServiceLabel({
    motisMode,
    ...(leg.displayName ? { displayName: leg.displayName } : {}),
    ...(leg.routeShortName ? { routeShortName: leg.routeShortName } : {}),
    ...(leg.tripShortName ? { tripShortName: leg.tripShortName } : {}),
    ...(leg.agencyName ? { agencyName: leg.agencyName } : {}),
  });
}

const STOP_ROLE_PRECEDENCE: Record<MapStopRole, number> = {
  intermediate: 0,
  transfer: 1,
  'origin-station': 2,
  meeting: 3,
};

type StopDraft = {
  key: string;
  role: MapStopRole;
  name: string;
  longitude: number;
  latitude: number;
  color: string;
  textColor: string;
  /** Set once by a transit leg so a walking leg cannot overwrite the route color. */
  colored: boolean;
  arrivingColor: string | undefined;
  departingColor: string | undefined;
  arrivalAt: string | undefined;
  departureAt: string | undefined;
  track: string | undefined;
  arrivingService: string | undefined;
  departingService: string | undefined;
};

/** Which side of a leg called at this stop, so transfer paint can be split. */
type StopCallDirection = 'arriving' | 'departing' | 'calling';

function normalizeStopName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Stable dedupe key when provider stop IDs are unavailable. Five decimals ≈ 1 m.
 * The normalized name keeps distinct platforms/stations separate at one coordinate.
 */
function stopKey(longitude: number, latitude: number, name: string): string {
  return `geo:${longitude.toFixed(5)},${latitude.toFixed(5)}|${normalizeStopName(name)}`;
}

function coordsMatchStop(
  longitude: number,
  latitude: number,
  destination: { readonly longitude: number; readonly latitude: number },
): boolean {
  return (
    longitude.toFixed(5) === destination.longitude.toFixed(5) &&
    latitude.toFixed(5) === destination.latitude.toFixed(5)
  );
}

/**
 * Real stop markers for one traveler's selected journey. Only stops the provider
 * gave coordinates for are emitted; the two sides of a transfer collapse into a
 * single marker carrying both the arriving and departing service.
 */
function collectJourneyStops(journey: ResultsJourney): readonly StopDraft[] {
  const drafts = new Map<string, StopDraft>();
  const order: string[] = [];

  const upsert = (
    stop: ResultsStop | ResultsIntermediateStop,
    role: MapStopRole,
    paint: LegPaint,
    isTransit: boolean,
    direction: StopCallDirection,
    detail: {
      readonly arrivalAt?: string | undefined;
      readonly departureAt?: string | undefined;
      readonly arrivingService?: string | undefined;
      readonly departingService?: string | undefined;
    },
  ): void => {
    const { longitude, latitude } = stop;
    if (
      typeof longitude !== 'number' ||
      typeof latitude !== 'number' ||
      !Number.isFinite(longitude) ||
      !Number.isFinite(latitude) ||
      isSyntheticStopName(stop.name)
    ) {
      return;
    }
    const arrivingColor = isTransit && direction === 'arriving' ? paint.color : undefined;
    const departingColor =
      isTransit && (direction === 'departing' || direction === 'calling') ? paint.color : undefined;
    const key = stopKey(longitude, latitude, stop.name);
    const existing = drafts.get(key);
    if (!existing) {
      drafts.set(key, {
        key,
        role,
        name: stop.name,
        longitude,
        latitude,
        color: paint.color,
        textColor: paint.textColor,
        colored: isTransit,
        arrivingColor,
        departingColor,
        arrivalAt: detail.arrivalAt,
        departureAt: detail.departureAt,
        track: stop.track,
        arrivingService: detail.arrivingService,
        departingService: detail.departingService,
      });
      order.push(key);
      return;
    }
    if (STOP_ROLE_PRECEDENCE[role] > STOP_ROLE_PRECEDENCE[existing.role]) {
      existing.role = role;
    }
    if (isTransit && !existing.colored) {
      existing.color = paint.color;
      existing.textColor = paint.textColor;
      existing.colored = true;
    }
    if (arrivingColor) {
      existing.arrivingColor = arrivingColor;
    }
    if (departingColor) {
      existing.departingColor = departingColor;
    }
    existing.arrivalAt ??= detail.arrivalAt;
    existing.departureAt ??= detail.departureAt;
    existing.track ??= stop.track;
    existing.arrivingService ??= detail.arrivingService;
    existing.departingService ??= detail.departingService;
  };

  const legs = journey.legs;
  const motisModes = legs.map((leg) => rankingLegMotisMode(leg));
  const transitIndexes = legs
    .map((leg, index) => (legIsWalk(leg, motisModes[index]!) ? -1 : index))
    .filter((index) => index >= 0);
  const firstTransitIndex = transitIndexes[0] ?? -1;
  const lastTransitIndex = transitIndexes[transitIndexes.length - 1] ?? -1;
  const lastLegIndex = legs.length - 1;

  for (const [legIndex, leg] of legs.entries()) {
    const motisMode = motisModes[legIndex]!;
    const isTransit = !legIsWalk(leg, motisMode);
    const paint = legPaint(leg, motisMode);
    const service = isTransit ? legServiceLabel(leg, motisMode) : undefined;

    if (leg.from) {
      const role: MapStopRole =
        legIndex === 0 || legIndex === firstTransitIndex ? 'origin-station' : 'transfer';
      upsert(leg.from, role, paint, isTransit, 'departing', {
        departureAt: leg.departureAt,
        departingService: service,
      });
    }
    for (const stop of leg.intermediateStops ?? []) {
      upsert(stop, 'intermediate', paint, isTransit, 'calling', {
        arrivalAt: stop.arrivalAt ?? stop.scheduledArrivalAt,
        departureAt: stop.departureAt ?? stop.scheduledDepartureAt,
      });
    }
    if (leg.to) {
      const role: MapStopRole =
        legIndex === lastLegIndex || legIndex === lastTransitIndex ? 'meeting' : 'transfer';
      upsert(leg.to, role, paint, isTransit, 'arriving', {
        arrivalAt: leg.arrivalAt,
        arrivingService: service,
      });
    }
  }

  return order.map((key) => drafts.get(key)!);
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

/** One legend chip per distinct transit service drawn for a traveler, in journey order. */
function legendServicesFor(
  routeLines: readonly MapRouteSegment[],
  participantId: string,
): readonly MapLegendService[] {
  const services: MapLegendService[] = [];
  const seen = new Set<string>();
  for (const segment of routeLines) {
    if (segment.participantId !== participantId || segment.style !== 'transit') {
      continue;
    }
    const key = `${segment.color}:${segment.motisMode}:${segment.serviceLabel}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    services.push({
      color: segment.color,
      textColor: segment.textColor,
      mode: segment.motisMode,
      displayName: segment.serviceLabel,
      colorSource: segment.colorSource,
    });
  }
  return services;
}

/** Lon/lat pairs used for fitBounds — origins, candidates, stops, and every route vertex. */
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

function coordLabelKey(longitude: number, latitude: number): string {
  return `${longitude.toFixed(5)},${latitude.toFixed(5)}`;
}

/** One visible station name per coordinate — highest labelPriority wins; ties keep the first marker. */
function suppressDuplicateStopLabels(markers: MapMarker[]): void {
  const winnerByCoord = new Map<string, number>();

  for (let index = 0; index < markers.length; index++) {
    const marker = markers[index];
    if (marker?.kind !== 'stop' || !marker.showLabel) {
      continue;
    }
    const stop = marker;
    const coordKey = coordLabelKey(stop.longitude, stop.latitude);
    const winnerIndex = winnerByCoord.get(coordKey);
    if (winnerIndex === undefined) {
      winnerByCoord.set(coordKey, index);
      continue;
    }
    const winner = markers[winnerIndex];
    if (winner?.kind !== 'stop') {
      winnerByCoord.set(coordKey, index);
      continue;
    }
    if (stop.labelPriority > winner.labelPriority) {
      markers[winnerIndex] = { ...winner, showLabel: false };
      winnerByCoord.set(coordKey, index);
      continue;
    }
    markers[index] = { ...stop, showLabel: false };
  }
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
        services: [],
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
          const motisMode = rankingLegMotisMode(leg);
          const walk = legIsWalk(leg, motisMode);
          const paint = legPaint(leg, motisMode);
          routeLines.push({
            id: `route:${selected.destination.placeId}:${journey.participantId}:${legIndex}`,
            participantId: journey.participantId,
            participantPosition: journey.participantPosition,
            letter,
            color: paint.color,
            textColor: paint.textColor,
            colorSource: paint.colorSource,
            emphasized,
            legIndex,
            mode: leg.mode,
            motisMode,
            style: walk ? 'walk' : 'transit',
            serviceLabel: legServiceLabel(leg, motisMode),
            ...(leg.displayName ? { displayName: leg.displayName } : {}),
            ...(leg.routeShortName ? { routeShortName: leg.routeShortName } : {}),
            ...(leg.tripShortName ? { tripShortName: leg.tripShortName } : {}),
            ...(leg.agencyName ? { agencyName: leg.agencyName } : {}),
            ...(leg.headsign ? { headsign: leg.headsign } : {}),
            ...(leg.from ? { fromName: leg.from.name } : {}),
            ...(leg.to ? { toName: leg.to.name } : {}),
            departureAt: leg.departureAt,
            arrivalAt: leg.arrivalAt,
            intermediateStopCount:
              leg.intermediateStopCount ?? leg.intermediateStops?.length ?? 0,
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

      for (const stop of collectJourneyStops(journey)) {
        // The selected candidate marker is the visible meeting affordance at the destination.
        if (
          stop.role === 'meeting' &&
          hasCoords(selected.destination) &&
          coordsMatchStop(stop.longitude, stop.latitude, selected.destination)
        ) {
          continue;
        }
        const showLabel = stop.role !== 'intermediate' ? true : emphasized;
        const borderColor = stop.departingColor ?? stop.arrivingColor ?? stop.color;
        const ringColor =
          stop.arrivingColor && stop.departingColor ? stop.arrivingColor : undefined;
        markers.push({
          kind: 'stop',
          id: `stop:${selected.destination.placeId}:${journey.participantId}:${stop.key}`,
          participantId: journey.participantId,
          letter,
          role: stop.role,
          name: stop.name,
          color: stop.color,
          borderColor,
          ...(ringColor ? { ringColor } : {}),
          textColor: stop.textColor,
          longitude: stop.longitude,
          latitude: stop.latitude,
          ...(stop.arrivalAt ? { arrivalAt: stop.arrivalAt } : {}),
          ...(stop.departureAt ? { departureAt: stop.departureAt } : {}),
          ...(stop.track ? { track: stop.track } : {}),
          ...(stop.arrivingService ? { arrivingService: stop.arrivingService } : {}),
          ...(stop.departingService ? { departingService: stop.departingService } : {}),
          emphasized,
          showLabel,
          labelPriority: STOP_LABEL_PRIORITY[stop.role],
        });
      }
    }
  }

  for (const [index, entry] of legend.entries()) {
    legend[index] = { ...entry, services: legendServicesFor(routeLines, entry.participantId) };
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

  suppressDuplicateStopLabels(markers);

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
      services: [],
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
