/** @vitest-environment jsdom */
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TYPED_TEXT_MS_PER_CHAR, TypedText } from './typed-text';

describe('TypedText', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps the full sentence available while characters type', () => {
    render(<TypedText text="Hello there" />);

    expect(screen.getByText('Hello there')).toHaveClass('sr-only');
    expect(document.querySelector('.typed-text__caret')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(TYPED_TEXT_MS_PER_CHAR * 5);
    });
    expect(screen.getByText('Hello there')).toHaveClass('sr-only');
    expect(document.querySelector('[aria-hidden]')?.textContent).toBe('Hello');

    act(() => {
      vi.advanceTimersByTime(TYPED_TEXT_MS_PER_CHAR * 6);
    });
    expect(screen.getByText('Hello there')).not.toHaveClass('sr-only');
    expect(document.querySelector('.typed-text__caret')).not.toBeInTheDocument();
  });
});
