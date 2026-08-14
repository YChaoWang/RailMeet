/** @vitest-environment jsdom */
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PLACE_COMBOBOX_DEBOUNCE_MS, PlaceCombobox } from './place-combobox';

const berlinStop = {
  providerId: 'de:berlin-hbf',
  name: 'Berlin Hbf',
  type: 'STOP' as const,
  latitude: 52.525,
  longitude: 13.369,
  countryCode: 'DE',
  timezone: 'Europe/Berlin',
  modes: ['RAIL'],
  secondaryLabel: 'Station · Berlin, DE',
};

const berlinCity = {
  providerId: 'node/berlin',
  name: 'Berlin',
  type: 'PLACE' as const,
  latitude: 52.52,
  longitude: 13.4,
  countryCode: 'DE',
  timezone: 'Europe/Berlin',
  modes: [] as string[],
  secondaryLabel: 'City · DE',
};

describe('PlaceCombobox', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('debounces, ignores stale responses, and selects with keyboard', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const onSelect = vi.fn();
    const onTextChange = vi.fn();
    const onClearSelection = vi.fn();

    let resolveFirst: ((value: unknown) => void) | undefined;
    let resolveSecond: ((value: unknown) => void) | undefined;
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveSecond = resolve;
          }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const view = render(
      <PlaceCombobox
        id="origin"
        fieldPath="participants.0.origin"
        valueText=""
        selected={null}
        onTextChange={onTextChange}
        onSelect={onSelect}
        onClearSelection={onClearSelection}
      />,
    );

    const input = screen.getByRole('combobox');
    await user.type(input, 'Be');
    expect(fetchMock).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(PLACE_COMBOBOX_DEBOUNCE_MS);
    });
    // Re-render with controlled text after typed chars (simulate parent).
    view.rerender(
      <PlaceCombobox
        id="origin"
        fieldPath="participants.0.origin"
        valueText="Be"
        selected={null}
        onTextChange={onTextChange}
        onSelect={onSelect}
        onClearSelection={onClearSelection}
      />,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PLACE_COMBOBOX_DEBOUNCE_MS);
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    view.rerender(
      <PlaceCombobox
        id="origin"
        fieldPath="participants.0.origin"
        valueText="Berlin"
        selected={null}
        onTextChange={onTextChange}
        onSelect={onSelect}
        onClearSelection={onClearSelection}
      />,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PLACE_COMBOBOX_DEBOUNCE_MS);
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    // Resolve stale first response after second request started.
    await act(async () => {
      resolveFirst?.({
        ok: true,
        json: async () => ({ data: { query: 'Be', suggestions: [berlinCity] } }),
      });
    });
    expect(screen.queryByText('Berlin')).not.toBeInTheDocument();

    await act(async () => {
      resolveSecond?.({
        ok: true,
        json: async () => ({
          data: { query: 'Berlin', suggestions: [berlinStop, berlinCity] },
        }),
      });
    });

    await waitFor(() => expect(screen.getByText('Berlin Hbf')).toBeInTheDocument());
    expect(screen.getByText('Berlin, DE')).toBeInTheDocument();
    expect(screen.getByText('DE')).toBeInTheDocument();
    expect(screen.getAllByText('Station').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('City')).toBeInTheDocument();
    expect(screen.getByText('Rail')).toBeInTheDocument();

    await user.keyboard('{ArrowDown}{Enter}');
    expect(onSelect).toHaveBeenCalledWith(berlinCity);
  });

  it('shows retryable upstream errors and no-results', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({
        error: {
          code: 'SERVICE_UNAVAILABLE',
          message: 'Place suggestions are temporarily unavailable. Try again.',
        },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const view = render(
      <PlaceCombobox
        id="origin"
        fieldPath="participants.0.origin"
        valueText="Paris"
        selected={null}
        onTextChange={vi.fn()}
        onSelect={vi.fn()}
        onClearSelection={vi.fn()}
      />,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PLACE_COMBOBOX_DEBOUNCE_MS);
    });
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: { query: 'Paris', suggestions: [] } }),
    });
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.getByText(/No matching places/i)).toBeInTheDocument());
    view.unmount();
  });
});
