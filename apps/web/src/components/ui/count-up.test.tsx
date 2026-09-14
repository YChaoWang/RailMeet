/** @vitest-environment jsdom */
import { render, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('motion/react', async () => {
  const actual = await vi.importActual<typeof import('motion/react')>('motion/react');
  return {
    ...actual,
    useInView: () => true,
    useReducedMotion: () => true,
  };
});

import CountUp from '@/components/ui/count-up';

describe('CountUp', () => {
  it('shows the final value when motion is reduced', async () => {
    const { container } = render(<CountUp from={0} to={43} duration={1} />);
    await waitFor(() => {
      expect(container.querySelector('span')?.textContent).toBe('43');
    });
  });
});
