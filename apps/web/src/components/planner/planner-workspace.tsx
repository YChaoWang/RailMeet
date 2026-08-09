'use client';

import Link from 'next/link';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';

import { SearchMap, type MapFitPadding } from '@/components/map/search-map';
import type { MapScene } from '@/lib/map-markers';
import { cn } from '@/lib/utils';

type PlannerWorkspaceProps = {
  readonly children: ReactNode;
  readonly scene: MapScene;
  readonly panelTitle: string;
  readonly className?: string;
  readonly disableMap?: boolean;
  /** Controlled sheet expansion (provider owns state so draft/results share one shell). */
  readonly sheetExpanded?: boolean;
  readonly onSheetExpandedChange?: (expanded: boolean) => void;
  /** Prefer collapsed on results so routes stay visible on small screens. */
  readonly initialSheetExpanded?: boolean;
  /** When this value becomes truthy, collapse the mobile sheet once (results ready). */
  readonly collapseSheetWhen?: string | null;
  readonly onCandidateSelect?: (selectionKey: string) => void;
  readonly onTravelerSelect?: (participantId: string | null) => void;
};

const DESKTOP_PANEL_WIDTH = 400;
const MOBILE_COLLAPSED_VH = 0.38;
const MOBILE_EXPANDED_VH = 0.72;

/**
 * Full-viewport map-first shell.
 * One panel instance serves desktop (left overlay) and mobile (bottom sheet).
 */
export function PlannerWorkspace({
  children,
  scene,
  panelTitle,
  className,
  disableMap = false,
  sheetExpanded: sheetExpandedProp,
  onSheetExpandedChange,
  initialSheetExpanded = false,
  collapseSheetWhen = null,
  onCandidateSelect,
  onTravelerSelect,
}: PlannerWorkspaceProps) {
  const [uncontrolledExpanded, setUncontrolledExpanded] = useState(initialSheetExpanded);
  const sheetExpanded = sheetExpandedProp ?? uncontrolledExpanded;
  const setSheetExpanded = onSheetExpandedChange ?? setUncontrolledExpanded;
  const [isDesktop, setIsDesktop] = useState(false);
  const [viewportHeight, setViewportHeight] = useState(800);
  const [dragOffsetPx, setDragOffsetPx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const collapsedForRef = useRef<string | null>(null);

  useEffect(() => {
    const sync = () => {
      setIsDesktop(window.matchMedia('(min-width: 768px)').matches);
      setViewportHeight(window.innerHeight);
    };
    sync();
    window.addEventListener('resize', sync);
    return () => window.removeEventListener('resize', sync);
  }, []);

  useEffect(() => {
    if (!collapseSheetWhen || collapsedForRef.current === collapseSheetWhen) {
      return;
    }
    collapsedForRef.current = collapseSheetWhen;
    setSheetExpanded(false);
  }, [collapseSheetWhen, setSheetExpanded]);

  const fitPadding: MapFitPadding = isDesktop
    ? {
        top: 48,
        right: 56,
        bottom: 56,
        left: DESKTOP_PANEL_WIDTH + 48,
      }
    : {
        top: 56,
        right: 48,
        bottom:
          Math.round(
            viewportHeight * (sheetExpanded ? MOBILE_EXPANDED_VH : MOBILE_COLLAPSED_VH) * 0.85,
          ) + 24,
        left: 48,
      };

  const onHandlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (isDesktop) {
        return;
      }
      event.currentTarget.setPointerCapture(event.pointerId);
      setDragging(true);
      setDragOffsetPx(0);
      const startY = event.clientY;

      const onMove = (moveEvent: PointerEvent) => {
        setDragOffsetPx(moveEvent.clientY - startY);
      };
      const onUp = (upEvent: PointerEvent) => {
        const delta = upEvent.clientY - startY;
        setDragging(false);
        setDragOffsetPx(0);
        if (delta > 48) {
          setSheetExpanded(false);
        } else if (delta < -48) {
          setSheetExpanded(true);
        }
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    },
    [isDesktop, setSheetExpanded],
  );

  return (
    <div
      className={cn('relative h-[100dvh] w-full overflow-hidden bg-[#d9e2ec]', className)}
      data-testid="planner-workspace"
      data-desktop={isDesktop ? 'true' : 'false'}
    >
      <div className="absolute inset-0 z-0" data-testid="planner-map-region">
        <SearchMap
          scene={scene}
          className="h-full w-full"
          disabled={disableMap}
          fitPadding={fitPadding}
          {...(onCandidateSelect ? { onCandidateSelect } : {})}
          {...(onTravelerSelect ? { onTravelerSelect } : {})}
        />
      </div>

      <div className="pointer-events-none absolute left-3 top-3 z-20 rounded-xl border border-ink-700/10 bg-white px-3 py-2 shadow-sm md:hidden">
        <Link
          href="/search"
          className="pointer-events-auto font-display text-lg text-ink-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600"
        >
          RailMeet
        </Link>
      </div>

      <aside
        className={cn(
          'pointer-events-auto absolute z-10 flex flex-col overflow-hidden border border-ink-700/15 bg-white shadow-lg',
          'md:bottom-3 md:left-3 md:top-3 md:w-[400px] md:rounded-2xl md:max-h-none',
          'inset-x-0 bottom-0 rounded-t-2xl md:inset-x-auto',
          'pb-[max(0.5rem,env(safe-area-inset-bottom))]',
          sheetExpanded
            ? 'max-md:h-[min(72dvh,680px)]'
            : 'max-md:h-auto max-md:max-h-[min(38dvh,320px)]',
        )}
        style={
          dragging && !isDesktop
            ? { transform: `translateY(${Math.max(0, Math.min(120, dragOffsetPx))}px)` }
            : undefined
        }
        data-testid="planner-panel"
        data-sheet-state={sheetExpanded ? 'expanded' : 'collapsed'}
        data-fit-bottom={fitPadding.bottom}
        data-fit-left={fitPadding.left}
        aria-label={panelTitle}
      >
        <div className="flex items-center justify-center border-b border-ink-700/10 px-4 py-2 md:hidden">
          <button
            type="button"
            className="h-1.5 w-10 touch-none rounded-full bg-ink-700/25"
            aria-label={sheetExpanded ? 'Collapse search panel' : 'Expand search panel'}
            aria-expanded={sheetExpanded}
            onClick={() => setSheetExpanded(!sheetExpanded)}
            onPointerDown={onHandlePointerDown}
          />
        </div>

        <div className="flex items-center justify-between gap-2 border-b border-ink-700/10 px-4 py-3">
          <div className="min-w-0">
            <Link
              href="/search"
              className="hidden font-display text-xl tracking-tight text-ink-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 md:inline"
            >
              RailMeet
            </Link>
            <p className="truncate text-sm font-semibold text-ink-950 md:mt-0.5 md:text-xs md:font-medium md:text-ink-700">
              {panelTitle}
            </p>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              className="min-h-11 rounded-lg px-3 text-sm font-medium text-teal-800 hover:bg-teal-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 md:hidden"
              aria-expanded={sheetExpanded}
              onClick={() => setSheetExpanded(!sheetExpanded)}
            >
              {sheetExpanded ? 'Collapse' : 'Expand'}
            </button>
            <Link
              href="/search"
              className="hidden rounded-lg px-2 py-1 text-xs font-medium text-teal-800 hover:bg-teal-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 md:inline"
            >
              New search
            </Link>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">{children}</div>
        <p
          className="border-t border-ink-700/10 px-4 py-2 text-[10px] leading-snug text-ink-700"
          data-testid="panel-attribution"
        >
          Map © OpenStreetMap · Journey data © Transitous
        </p>
      </aside>
    </div>
  );
}
