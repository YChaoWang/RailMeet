'use client';

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { PlannerWorkspace } from '@/components/planner/planner-workspace';
import { EMPTY_MAP_SCENE, type MapScene } from '@/lib/map-markers';

type CandidateHandler = ((selectionKey: string) => void) | null;
type TravelerHandler = ((participantId: string | null) => void) | null;

export type PlannerMapApi = {
  readonly setScene: (scene: MapScene) => void;
  readonly setPanelTitle: (title: string) => void;
  readonly setCollapseSheetWhen: (token: string | null) => void;
  readonly setSheetExpanded: (expanded: boolean) => void;
  readonly setCandidateSelectHandler: (handler: CandidateHandler) => void;
  readonly setTravelerSelectHandler: (handler: TravelerHandler) => void;
};

const PlannerMapContext = createContext<PlannerMapApi | null>(null);

export function usePlannerMap(): PlannerMapApi {
  const value = useContext(PlannerMapContext);
  if (!value) {
    throw new Error('usePlannerMap must be used within PlannerMapProvider');
  }
  return value;
}

type PlannerMapProviderProps = {
  readonly children: ReactNode;
  readonly disableMap?: boolean;
};

/**
 * Owns the single MapLibre shell for `/search` and `/search/[searchId]`.
 * Page content publishes scenes; navigating between draft and results does not remount the map.
 */
export function PlannerMapProvider({ children, disableMap = false }: PlannerMapProviderProps) {
  const [scene, setSceneState] = useState<MapScene>(EMPTY_MAP_SCENE);
  const [panelTitle, setPanelTitle] = useState('RailMeet');
  const [collapseSheetWhen, setCollapseSheetWhen] = useState<string | null>(null);
  const [sheetExpanded, setSheetExpanded] = useState(false);
  const candidateHandlerRef = useRef<CandidateHandler>(null);
  const travelerHandlerRef = useRef<TravelerHandler>(null);

  const setScene = useCallback((next: MapScene) => {
    setSceneState(next);
  }, []);

  const setCandidateSelectHandler = useCallback((handler: CandidateHandler) => {
    candidateHandlerRef.current = handler;
  }, []);

  const setTravelerSelectHandler = useCallback((handler: TravelerHandler) => {
    travelerHandlerRef.current = handler;
  }, []);

  const api = useMemo<PlannerMapApi>(
    () => ({
      setScene,
      setPanelTitle,
      setCollapseSheetWhen,
      setSheetExpanded,
      setCandidateSelectHandler,
      setTravelerSelectHandler,
    }),
    [setScene, setCandidateSelectHandler, setTravelerSelectHandler],
  );

  return (
    <PlannerMapContext.Provider value={api}>
      <PlannerWorkspace
        scene={scene}
        panelTitle={panelTitle}
        disableMap={disableMap}
        sheetExpanded={sheetExpanded}
        onSheetExpandedChange={setSheetExpanded}
        collapseSheetWhen={collapseSheetWhen}
        onCandidateSelect={(key) => candidateHandlerRef.current?.(key)}
        onTravelerSelect={(id) => travelerHandlerRef.current?.(id)}
      >
        {children}
      </PlannerWorkspace>
    </PlannerMapContext.Provider>
  );
}
