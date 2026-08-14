/**
 * MOTIS itinerary/leg JSON as returned by `/api/v5/plan`.
 * Extra provider fields are retained (index signature) — do not narrow this
 * to a RailMeet-only subset before persistence or Journey Details rendering.
 */

export type MotisPlaceJson = {
  readonly name?: string;
  readonly lat?: number;
  readonly lon?: number;
  readonly tz?: string;
  readonly track?: string;
  readonly scheduledTrack?: string;
  readonly stopId?: string;
  readonly arrival?: string;
  readonly departure?: string;
  readonly scheduledArrival?: string;
  readonly scheduledDeparture?: string;
  readonly pickupType?: string;
  readonly dropoffType?: string;
  readonly vertexType?: string;
  readonly flex?: string;
  /** Set when joining interlined legs (Transitous `switchTo`). */
  readonly switchTo?: MotisLegJson;
  readonly [key: string]: unknown;
};

export type MotisStepJson = {
  readonly relativeDirection?: string;
  readonly distance?: number;
  readonly streetName?: string;
  readonly [key: string]: unknown;
};

export type MotisAlertJson = {
  readonly headerText?: string;
  readonly descriptionText?: string;
  readonly cause?: string;
  readonly effect?: string;
  readonly [key: string]: unknown;
};

export type MotisLegJson = {
  readonly mode: string;
  readonly startTime: string;
  readonly endTime: string;
  readonly scheduledStartTime?: string;
  readonly scheduledEndTime?: string;
  readonly duration: number;
  readonly realTime?: boolean;
  readonly scheduled?: boolean;
  readonly cancelled?: boolean;
  readonly distance?: number;
  readonly displayName?: string;
  readonly agencyName?: string;
  readonly agencyId?: string;
  readonly agencyUrl?: string;
  readonly routeShortName?: string;
  readonly routeLongName?: string;
  readonly tripShortName?: string;
  readonly headsign?: string;
  readonly tripTo?: MotisPlaceJson;
  readonly from?: MotisPlaceJson;
  readonly to?: MotisPlaceJson;
  readonly intermediateStops?: readonly MotisPlaceJson[] | null;
  readonly alternatives?: readonly MotisLegJson[][] | null;
  readonly steps?: readonly MotisStepJson[] | null;
  readonly routeColor?: string;
  readonly routeTextColor?: string;
  readonly routeUrl?: string;
  readonly ticketUrls?: { readonly web?: string; readonly [key: string]: unknown };
  readonly interlineWithPreviousLeg?: boolean;
  readonly reservation?: string;
  readonly bikesAllowed?: boolean;
  readonly wheelchairAccessible?: string;
  readonly alerts?: readonly MotisAlertJson[] | null;
  readonly rental?: { readonly formFactor?: string; readonly systemName?: string; readonly [key: string]: unknown };
  readonly legGeometry?: { readonly points?: string; readonly precision?: number; readonly length?: number };
  readonly [key: string]: unknown;
};

export type MotisItineraryJson = {
  readonly duration: number;
  readonly startTime: string;
  readonly endTime: string;
  readonly transfers: number;
  readonly id?: string;
  readonly legs: readonly MotisLegJson[];
  readonly fareTransfers?: unknown;
  readonly [key: string]: unknown;
};

export const MOTIS_PLAN_ITINERARY_FORMAT = 'motis-plan-itinerary-v1' as const;

/**
 * Versioned payload stored beside ranking legs. RailMeet remains on MOTIS
 * `/api/v5/plan`; Transitous current OpenAPI documents `/api/v6/plan`.
 */
export type MotisPlanItineraryPayload = {
  readonly format: typeof MOTIS_PLAN_ITINERARY_FORMAT;
  readonly motisPlanApiVersion: 'v5';
  readonly motisOpenApiPin: string;
  readonly itinerary: MotisItineraryJson;
};

function optionalText(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** Transitous ConnectionDetail: a transit leg is identified by `displayName`. */
export function isMotisTransitLeg(leg: MotisLegJson): boolean {
  return Boolean(optionalText(leg.displayName));
}

export function isMotisWalkLeg(leg: MotisLegJson): boolean {
  return String(leg.mode).toUpperCase() === 'WALK';
}

/**
 * Join stay-seated `interlineWithPreviousLeg` legs the way Transitous
 * `preprocessItinerary.joinInterlinedLegs` does for display: the previous
 * arrival stop is kept as an intermediate with `switchTo`, and the user sees
 * “Continues as” instead of a transfer.
 */
export function joinInterlinedMotisLegs(legs: readonly MotisLegJson[]): MotisLegJson[] {
  const joined: MotisLegJson[] = [];
  for (const current of legs) {
    if (current.interlineWithPreviousLeg && joined.length > 0) {
      const pred = joined[joined.length - 1]!;
      const predStops = [...(pred.intermediateStops ?? [])];
      if (pred.to) {
        predStops.push({ ...pred.to, switchTo: current });
      }
      predStops.push(...(current.intermediateStops ?? []));
      let next: MotisLegJson = {
        ...pred,
        duration: pred.duration + current.duration,
        endTime: current.endTime,
        realTime: Boolean(pred.realTime || current.realTime),
        intermediateStops: predStops,
      };
      if (current.to) {
        next = { ...next, to: current.to };
      }
      if (current.scheduledEndTime) {
        next = { ...next, scheduledEndTime: current.scheduledEndTime };
      }
      joined[joined.length - 1] = next;
    } else {
      joined.push({ ...current, intermediateStops: current.intermediateStops ?? [] });
    }
  }
  return joined;
}

export function motisLegDisplayName(leg: MotisLegJson): string | undefined {
  return optionalText(leg.displayName);
}

export function motisLegAgencyName(leg: MotisLegJson): string | undefined {
  return optionalText(leg.agencyName);
}

export function motisPlaceName(place: MotisPlaceJson | undefined): string | undefined {
  return optionalText(place?.name);
}

export function motisPlaceTrack(place: MotisPlaceJson | undefined): string | undefined {
  return optionalText(place?.track) ?? optionalText(place?.scheduledTrack);
}

export function motisDirectionLabel(leg: MotisLegJson): string | undefined {
  const headsign = optionalText(leg.headsign);
  const tripTo = motisPlaceName(leg.tripTo);
  if (headsign && tripTo && headsign.toLowerCase() !== tripTo.toLowerCase()) {
    return `${headsign} (${tripTo})`;
  }
  return headsign ?? tripTo;
}
