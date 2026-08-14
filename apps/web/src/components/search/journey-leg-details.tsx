import type { MotisItineraryJson } from '@railmeet/shared';

import {
  JourneyItineraryTimeline,
  JourneyRouteSummary,
} from '@/components/search/journey-itinerary-timeline';
import type { JourneyItineraryContext } from '@/lib/journey-itinerary-presentation';
import { rankingLegToMotis, type RankingLeg } from '@/lib/journey-leg-presentation';

export { JourneyItineraryTimeline, JourneyRouteSummary };

/** Provider-native itinerary with Transitous-inspired continuous timeline. */
export function JourneyItineraryDetails({
  itinerary,
  context,
}: {
  readonly itinerary: MotisItineraryJson;
  readonly context?: JourneyItineraryContext;
}) {
  return <JourneyItineraryTimeline itinerary={itinerary} context={context ?? {}} />;
}

/** Fallback when a search predates stored MOTIS itineraries (detailSource=legacy). */
export function RankingJourneyLegs({
  legs,
  context,
}: {
  readonly legs: readonly RankingLeg[];
  readonly context?: JourneyItineraryContext;
}) {
  const itinerary: MotisItineraryJson = {
    duration: legs.reduce((sum, leg) => sum + leg.durationMinutes * 60, 0),
    startTime: legs[0]?.departureAt ?? '',
    endTime: legs[legs.length - 1]?.arrivalAt ?? '',
    transfers: Math.max(0, legs.filter((leg) => rankingLegToMotis(leg).displayName).length - 1),
    legs: legs.map(rankingLegToMotis),
  };
  return (
    <div data-testid="ranking-journey-legs">
      <JourneyItineraryTimeline itinerary={itinerary} context={context ?? {}} />
    </div>
  );
}
