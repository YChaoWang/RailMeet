'use client';

import { useMemo, useState } from 'react';

import { PlannerWorkspace } from '@/components/planner/planner-workspace';
import {
  createInitialParticipants,
  SearchForm,
  type ParticipantDraft,
} from '@/components/search/search-form';
import { buildDraftOriginScene } from '@/lib/map-markers';

export function SearchPlannerPage({ disableMap = false }: { readonly disableMap?: boolean }) {
  const [participants, setParticipants] = useState<ParticipantDraft[]>(createInitialParticipants);

  const scene = useMemo(() => buildDraftOriginScene(participants), [participants]);

  return (
    <PlannerWorkspace scene={scene} panelTitle="Plan a meeting point" disableMap={disableMap}>
      <p className="mb-4 text-sm text-ink-700">
        Search for each traveler’s station or city. RailMeet compares real public-transport journeys
        and ranks meeting points.
      </p>
      <SearchForm participants={participants} onParticipantsChange={setParticipants} />
    </PlannerWorkspace>
  );
}
