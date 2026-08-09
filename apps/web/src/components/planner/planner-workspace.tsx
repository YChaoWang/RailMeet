'use client';

import Link from 'next/link';
import { useState, type ReactNode } from 'react';

import { SearchMap } from '@/components/map/search-map';
import type { MapScene } from '@/lib/map-markers';
import { cn } from '@/lib/utils';

type PlannerWorkspaceProps = {
  readonly children: ReactNode;
  readonly scene: MapScene;
  readonly panelTitle: string;
  readonly className?: string;
  readonly disableMap?: boolean;
  readonly onCandidateSelect?: (selectionKey: string) => void;
};

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
  onCandidateSelect,
}: PlannerWorkspaceProps) {
  const [sheetExpanded, setSheetExpanded] = useState(true);

  return (
    <div
      className={cn('relative h-[100dvh] w-full overflow-hidden bg-[#d9e2ec]', className)}
      data-testid="planner-workspace"
    >
      <div className="absolute inset-0 z-0" data-testid="planner-map-region">
        <SearchMap
          scene={scene}
          className="h-full w-full"
          disabled={disableMap}
          {...(onCandidateSelect ? { onCandidateSelect } : {})}
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
          // Desktop: left overlay panel
          'md:bottom-3 md:left-3 md:top-3 md:w-[400px] md:rounded-2xl',
          // Mobile: bottom sheet
          'inset-x-0 bottom-0 rounded-t-2xl md:inset-x-auto',
          'pb-[max(0.5rem,env(safe-area-inset-bottom))]',
          sheetExpanded ? 'max-md:h-[min(78dvh,720px)]' : 'max-md:h-auto max-md:max-h-[42dvh]',
        )}
        data-testid="planner-panel"
        data-sheet-state={sheetExpanded ? 'expanded' : 'collapsed'}
        aria-label={panelTitle}
      >
        <div className="flex items-center justify-center border-b border-ink-700/10 px-4 py-2 md:hidden">
          <button
            type="button"
            className="h-1.5 w-10 rounded-full bg-ink-700/25"
            aria-label={sheetExpanded ? 'Collapse search panel' : 'Expand search panel'}
            aria-expanded={sheetExpanded}
            onClick={() => setSheetExpanded((value) => !value)}
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
              onClick={() => setSheetExpanded((value) => !value)}
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
        <p className="border-t border-ink-700/10 px-4 py-2 text-[10px] leading-snug text-ink-700">
          Map © OpenStreetMap · Journey data © Transitous
        </p>
      </aside>
    </div>
  );
}
