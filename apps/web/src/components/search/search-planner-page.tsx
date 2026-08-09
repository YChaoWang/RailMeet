'use client';

import { useEffect, useMemo, useState } from 'react';

import {
  createInitialParticipants,
  SearchForm,
  type ParticipantDraft,
} from '@/components/search/search-form';
import { usePlannerMap } from '@/components/search/planner-map-context';
import { buildDraftOriginScene } from '@/lib/map-markers';

export function SearchPlannerPage() {
  const { setScene, setPanelTitle, setSheetExpanded, setCollapseSheetWhen } = usePlannerMap();
  const [participants, setParticipants] = useState<ParticipantDraft[]>(createInitialParticipants);

  const scene = useMemo(() => buildDraftOriginScene(participants), [participants]);
  const selectedOriginCount = scene.markers.length;

  useEffect(() => {
    setPanelTitle('Plan a meeting point');
    setCollapseSheetWhen(null);
    setSheetExpanded(false);
  }, [setPanelTitle, setCollapseSheetWhen, setSheetExpanded]);

  useEffect(() => {
    setScene(scene);
  }, [scene, setScene]);

  useEffect(() => {
    // Keep enough map visible while drafting origins; user can expand the sheet manually.
    if (selectedOriginCount > 0) {
      setSheetExpanded(false);
    }
  }, [selectedOriginCount, setSheetExpanded]);

  return (
    <>
      <p className="mb-4 text-sm text-ink-700" data-testid="planner-draft-copy">
        Search for each traveler’s station or city. Selected origins appear on the map immediately —
        before you start the search.
      </p>
      {selectedOriginCount > 0 ? (
        <p className="mb-3 text-xs text-teal-800" data-testid="draft-marker-status">
          Showing {selectedOriginCount} origin{selectedOriginCount === 1 ? '' : 's'} on the map
        </p>
      ) : null}
      <SearchForm participants={participants} onParticipantsChange={setParticipants} />
    </>
  );
}
