/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { SEARCHABLE_EUROPE_COUNTRY_COUNT } from '@railmeet/shared';

vi.mock('@/components/ui/map', () => ({
  Map: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="landing-coverage-map">{children}</div>
  ),
  MapGeoJSON: () => null,
}));

vi.mock('motion/react', async () => {
  const actual = await vi.importActual<typeof import('motion/react')>('motion/react');
  return {
    ...actual,
    useInView: () => true,
    useReducedMotion: () => true,
  };
});

import { LandingHero } from './landing-hero';

describe('LandingHero', () => {
  it('states how many European countries can be searched', () => {
    render(<LandingHero />);
    expect(
      screen.getByLabelText(
        `Search from ${SEARCHABLE_EUROPE_COUNTRY_COUNT} European countries`,
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(/European countries you can search from/i)).toBeInTheDocument();
    const cta = screen.getByRole('link', { name: /get started/i });
    expect(cta).toHaveAttribute('href', '/search');
    expect(cta.getAttribute('style')).toContain('--sb-text-color: #f4f7fb');
    expect(cta.getAttribute('style')).toContain('--sb-tint: #1e3a5f');
    expect(screen.getByTestId('landing-coverage-map')).toBeInTheDocument();
  });
});
