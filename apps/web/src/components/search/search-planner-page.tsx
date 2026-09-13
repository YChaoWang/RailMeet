'use client';

import { useEffect, useMemo, useState } from 'react';

import {
  createInitialParticipants,
  SearchForm,
  type ParticipantDraft,
} from '@/components/search/search-form';
import { usePlannerMap } from '@/components/search/planner-map-context';
import { ChatAssistant, ChatThread, ChatWaterfallItem } from '@/components/ui/chat';
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
    <ChatThread>
      <ChatAssistant>
        <ChatWaterfallItem index={0}>
          <p className="text-sm text-ink-950">
            Hi! I'm your travel planner. I'll find a meeting city. Add each traveler's starting place and when you can travel.
          </p>
        </ChatWaterfallItem>
        <ChatWaterfallItem index={1}>
          <p className="text-sm text-ink-700" data-testid="planner-draft-copy">
            Search for each traveler’s station or city. Selected origins appear on the map
            immediately — before you start the search.
          </p>
        </ChatWaterfallItem>
        {selectedOriginCount > 0 ? (
          <ChatWaterfallItem index={2}>
            <p className="text-xs text-ink-700" data-testid="draft-marker-status">
              Showing {selectedOriginCount} origin{selectedOriginCount === 1 ? '' : 's'} on the
              map
            </p>
          </ChatWaterfallItem>
        ) : null}
      </ChatAssistant>
      <SearchForm
        participants={participants}
        onParticipantsChange={setParticipants}
        waterfallStart={2}
      />
    </ChatThread>
  );
}
