/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { PlannerWorkspace } from './planner-workspace';
import { buildMapScene } from '@/lib/map-markers';

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock('@/components/map/search-map', () => ({
  SearchMap: ({ scene }: { scene: { markers: unknown[]; routeLines: unknown[] } }) => (
    <div
      data-testid="search-map-stub"
      data-marker-count={scene.markers.length}
      data-route-line-count={scene.routeLines.length}
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
    expect(screen.getByTestId('planner-panel')).toHaveAttribute('data-sheet-state', 'expanded');
    expect(screen.getByText('Panel body')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Collapse search panel' }));
    expect(screen.getByTestId('planner-panel')).toHaveAttribute('data-sheet-state', 'collapsed');
    await user.click(screen.getByRole('button', { name: 'Expand search panel' }));
    expect(screen.getByTestId('planner-panel')).toHaveAttribute('data-sheet-state', 'expanded');
  });
});
