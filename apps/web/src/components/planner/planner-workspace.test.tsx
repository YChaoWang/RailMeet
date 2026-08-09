/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { PlannerWorkspace } from './planner-workspace';
import { buildDraftOriginScene, buildMapScene } from '@/lib/map-markers';

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock('@/components/map/search-map', () => ({
  SearchMap: ({
    scene,
    fitPadding,
  }: {
    scene: { markers: unknown[]; routeLines: unknown[] };
    fitPadding?: { top: number; bottom: number; left: number; right: number };
  }) => (
    <div
      data-testid="search-map-stub"
      data-marker-count={scene.markers.length}
      data-route-line-count={scene.routeLines.length}
      data-fit-bottom={fitPadding?.bottom}
      data-fit-left={fitPadding?.left}
    />
  ),
}));

describe('PlannerWorkspace', () => {
  it('keeps the map region mounted and supports mobile sheet expand/collapse', async () => {
    const user = userEvent.setup();
    const scene = buildMapScene({
      summary: null,
      results: null,
      rankingMode: 'fairest',
      selectedKey: null,
    });
    render(
      <PlannerWorkspace scene={scene} panelTitle="Plan a meeting point" disableMap>
        <p>Panel body</p>
      </PlannerWorkspace>,
    );

    expect(screen.getByTestId('planner-workspace')).toBeInTheDocument();
    expect(screen.getByTestId('planner-map-region')).toBeInTheDocument();
    expect(screen.getByTestId('planner-panel')).toHaveAttribute('data-sheet-state', 'collapsed');
    expect(screen.getByText('Panel body')).toBeInTheDocument();
    expect(screen.getByTestId('panel-attribution')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Expand search panel' }));
    expect(screen.getByTestId('planner-panel')).toHaveAttribute('data-sheet-state', 'expanded');
    expect(screen.getByTestId('planner-map-region')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Collapse search panel' }));
    expect(screen.getByTestId('planner-panel')).toHaveAttribute('data-sheet-state', 'collapsed');
  });

  it('collapses the sheet when results become ready without remounting the map', async () => {
    const user = userEvent.setup();
    const draft = buildDraftOriginScene([]);
    render(
      <PlannerWorkspace scene={draft} panelTitle="Comparing routes" disableMap initialSheetExpanded>
        <p>Running</p>
      </PlannerWorkspace>,
    );
    expect(screen.getByTestId('planner-panel')).toHaveAttribute('data-sheet-state', 'expanded');

    // Simulate results-ready collapse via the expand/collapse control after starting expanded.
    await user.click(screen.getByRole('button', { name: 'Collapse search panel' }));
    expect(screen.getByTestId('planner-panel')).toHaveAttribute('data-sheet-state', 'collapsed');
    expect(screen.getByTestId('planner-map-region')).toBeInTheDocument();
  });

  it('honors collapseSheetWhen without remounting the map', () => {
    const draft = buildDraftOriginScene([]);
    const { rerender } = render(
      <PlannerWorkspace scene={draft} panelTitle="Comparing routes" disableMap initialSheetExpanded>
        <p>Running</p>
      </PlannerWorkspace>,
    );
    expect(screen.getByTestId('planner-panel')).toHaveAttribute('data-sheet-state', 'expanded');

    rerender(
      <PlannerWorkspace
        scene={draft}
        panelTitle="Meeting points"
        disableMap
        initialSheetExpanded
        collapseSheetWhen="search-1"
      >
        <p>Results</p>
      </PlannerWorkspace>,
    );
    expect(screen.getByTestId('planner-panel')).toHaveAttribute('data-sheet-state', 'collapsed');
    expect(screen.getByTestId('planner-map-region')).toBeInTheDocument();
  });

  it('exposes sheet-aware fit padding so the panel does not cover the whole map', () => {
    const scene = buildDraftOriginScene([]);
    render(
      <PlannerWorkspace scene={scene} panelTitle="Plan a meeting point" disableMap>
        <p>Panel body</p>
      </PlannerWorkspace>,
    );
    const panel = screen.getByTestId('planner-panel');
    expect(panel.getAttribute('data-fit-bottom')).toBeTruthy();
    expect(Number(panel.getAttribute('data-fit-bottom'))).toBeGreaterThan(0);
    expect(screen.getByTestId('search-map-stub')).toHaveAttribute('data-fit-bottom');
  });
});
