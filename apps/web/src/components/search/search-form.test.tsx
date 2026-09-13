/** @vitest-environment jsdom */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const push = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn(), prefetch: vi.fn() }),
}));

vi.mock('@/components/search/place-combobox', () => ({
  PlaceCombobox: ({
    fieldPath,
    valueText,
    selected,
    onTextChange,
    onSelect,
    onClearSelection,
  }: {
    fieldPath: string;
    valueText: string;
    selected: { providerId: string; name: string } | null;
    onTextChange: (text: string) => void;
    onSelect: (suggestion: unknown) => void;
    onClearSelection: () => void;
  }) => (
    <div>
      <input
        data-field={fieldPath}
        role="combobox"
        aria-expanded={false}
        aria-controls={`${fieldPath}-listbox`}
        value={valueText}
        aria-label={fieldPath}
        onChange={(event) => {
          onTextChange(event.target.value);
          if (selected) {
            onClearSelection();
          }
        }}
      />
      <button
        type="button"
        onClick={() =>
          onSelect({
            providerId: `${fieldPath}-id`,
            name: valueText || 'Selected place',
            type: 'STOP',
            latitude: 52.5,
            longitude: 13.4,
            countryCode: 'DE',
            timezone: 'Europe/Berlin',
            modes: ['RAIL'],
            secondaryLabel: 'Station · DE',
          })
        }
      >
        Pick suggestion for {fieldPath}
      </button>
      {selected ? <span data-testid={`${fieldPath}-selected`}>{selected.name}</span> : null}
    </div>
  ),
  PLACE_COMBOBOX_DEBOUNCE_MS: 300,
}));

import { createInitialParticipants, SearchForm, type ParticipantDraft } from './search-form';

function Harness({
  initial,
}: {
  readonly initial?: ParticipantDraft[];
}) {
  const [participants, setParticipants] = useState(
    () => initial ?? createInitialParticipants(),
  );
  return <SearchForm participants={participants} onParticipantsChange={setParticipants} />;
}

describe('SearchForm place selection', () => {
  beforeEach(() => {
    push.mockReset();
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('defaults to two travelers and can add more', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const form = screen.getByRole('form', { name: 'Meeting search' });
    expect(form.querySelectorAll('[data-slot="chat-waterfall-item"]')).toHaveLength(29);
    expect(within(form).getAllByTestId('search-form-traveler-row')).toHaveLength(2);
    expect(within(form).queryByRole('textbox', { name: /Traveler [A-Z] name/i })).not.toBeInTheDocument();
    expect(within(form).getByRole('button', { name: 'Add a name for traveler A' })).toBeInTheDocument();
    expect(within(form).getByText('2 of 6')).toBeInTheDocument();
    expect(within(form).getByRole('button', { name: 'Add traveler' })).toBeEnabled();
    expect(within(form).getByRole('button', { name: 'Remove traveler A' })).toBeDisabled();
    await user.click(within(form).getByRole('button', { name: 'Add traveler' }));
    expect(within(form).getAllByTestId('search-form-traveler-row')).toHaveLength(3);
    expect(within(form).getByRole('button', { name: 'Add a name for traveler C' })).toBeInTheDocument();
    expect(within(form).getByText('3 of 6')).toBeInTheDocument();
  });

  it('reveals the name field with save and undo, then returns after save', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const form = screen.getByRole('form', { name: 'Meeting search' });
    await user.click(within(form).getByRole('button', { name: 'Add a name for traveler A' }));
    expect(within(form).getByRole('textbox', { name: 'Traveler A name' })).toBeInTheDocument();
    expect(within(form).getByRole('button', { name: 'Save name for traveler A' })).toBeInTheDocument();
    expect(within(form).getByRole('button', { name: 'Undo name for traveler A' })).toBeInTheDocument();
    await user.type(within(form).getByRole('textbox', { name: 'Traveler A name' }), 'Alex');
    await user.click(within(form).getByRole('button', { name: 'Save name for traveler A' }));
    expect(within(form).queryByRole('textbox', { name: 'Traveler A name' })).not.toBeInTheDocument();
    expect(within(form).getByRole('button', { name: 'Edit name for traveler A, Alex' })).toBeInTheDocument();
  });

  it('discards an in-progress name with undo', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const form = screen.getByRole('form', { name: 'Meeting search' });
    await user.click(within(form).getByRole('button', { name: 'Add a name for traveler A' }));
    await user.type(within(form).getByRole('textbox', { name: 'Traveler A name' }), 'Alex');
    await user.click(within(form).getByRole('button', { name: 'Undo name for traveler A' }));
    expect(within(form).queryByRole('textbox', { name: 'Traveler A name' })).not.toBeInTheDocument();
    expect(within(form).getByRole('button', { name: 'Add a name for traveler A' })).toBeInTheDocument();
  });

  it('adds up to 6 travelers and removes a specific row without going below 2', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const form = screen.getByRole('form', { name: 'Meeting search' });
    const add = () => within(form).getByRole('button', { name: 'Add traveler' });
    await user.click(add());
    await user.click(add());
    await user.click(add());
    await user.click(add());
    expect(within(form).getAllByTestId('search-form-traveler-row')).toHaveLength(6);
    expect(add()).toBeDisabled();
    await user.click(within(form).getByRole('button', { name: 'Remove traveler C' }));
    expect(within(form).getAllByTestId('search-form-traveler-row')).toHaveLength(5);
    expect(within(form).queryByRole('button', { name: 'Add a name for traveler C' })).not.toBeInTheDocument();
    expect(within(form).getByRole('button', { name: 'Add a name for traveler A' })).toBeInTheDocument();
    expect(within(form).getByRole('button', { name: 'Add a name for traveler B' })).toBeInTheDocument();
    await user.click(within(form).getByRole('button', { name: 'Remove traveler D' }));
    await user.click(within(form).getByRole('button', { name: 'Remove traveler E' }));
    await user.click(within(form).getByRole('button', { name: 'Remove traveler F' }));
    expect(within(form).getAllByTestId('search-form-traveler-row')).toHaveLength(2);
    expect(within(form).getByRole('button', { name: 'Remove traveler A' })).toBeDisabled();
    expect(within(form).getByRole('button', { name: 'Remove traveler B' })).toBeDisabled();
  });

  it('picks a travel date from the calendar popover', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const form = screen.getByRole('form', { name: 'Meeting search' });
    await user.click(within(form).getByRole('button', { name: /Travel date, September 15th, 2026/i }));
    const calendar = await screen.findByRole('grid');
    await user.click(within(calendar).getByRole('button', { name: /16/ }));
    expect(
      within(form).getByRole('button', { name: /Travel date, September 16th, 2026/i }),
    ).toBeInTheDocument();
  });

  it('cannot submit arbitrary text and submits selected provider identity', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 202,
      json: async () => ({
        data: {
          searchId: '44444444-4444-4444-8444-444444444444',
          status: 'queued',
          createdAt: '2026-06-01T12:00:00.000Z',
        },
        meta: { requestId: 'r1' },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<Harness />);

    const form = screen.getByRole('form', { name: 'Meeting search' });
    expect(within(form).getByRole('button', { name: 'Find a meeting point' })).toBeDisabled();

    await user.click(within(form).getByRole('button', { name: 'Add a name for traveler A' }));
    await user.type(within(form).getByRole('textbox', { name: 'Traveler A name' }), 'Alex');
    await user.click(within(form).getByRole('button', { name: 'Add a name for traveler B' }));
    await user.type(within(form).getByRole('textbox', { name: 'Traveler B name' }), 'Blake');
    fireEvent.change(document.querySelector('[data-field="participants.0.origin"]')!, {
      target: { value: 'Berlin' },
    });
    fireEvent.change(document.querySelector('[data-field="participants.1.origin"]')!, {
      target: { value: 'Paris' },
    });
    expect(within(form).getByRole('button', { name: 'Find a meeting point' })).toBeDisabled();

    await user.click(
      screen.getByRole('button', { name: /Pick suggestion for participants.0.origin/i }),
    );
    await user.click(
      screen.getByRole('button', { name: /Pick suggestion for participants.1.origin/i }),
    );

    await user.click(within(form).getByRole('button', { name: 'Find a meeting point' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain('/api/v1/meeting-searches');
    expect(String(url)).not.toMatch(/transitous|\/plan/);
    const body = JSON.parse(String((init as RequestInit).body));
    expect(body.participants[0].origin.providerId).toBe('participants.0.origin-id');
    expect(body.participants[0].origin.latitude).toBeCloseTo(52.5);
    expect(body.participants[0].origin.placeId).toBeUndefined();
    expect(body.participants[0].displayName).toBe('Alex');
    expect(body.participants[1].displayName).toBe('Blake');
    await waitFor(() =>
      expect(push).toHaveBeenCalledWith('/search/44444444-4444-4444-8444-444444444444'),
    );
  });

  it('defaults traveler names when left blank', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 202,
      json: async () => ({
        data: {
          searchId: '44444444-4444-4444-8444-444444444444',
          status: 'queued',
          createdAt: '2026-06-01T12:00:00.000Z',
        },
        meta: { requestId: 'r1' },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<Harness />);

    await user.click(
      screen.getByRole('button', { name: /Pick suggestion for participants.0.origin/i }),
    );
    await user.click(
      screen.getByRole('button', { name: /Pick suggestion for participants.1.origin/i }),
    );
    await user.click(screen.getByRole('button', { name: 'Find a meeting point' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const body = JSON.parse(String((fetchMock.mock.calls[0]![1] as RequestInit).body));
    expect(body.participants[0].displayName).toBe('Traveler A');
    expect(body.participants[1].displayName).toBe('Traveler B');
    expect(body.allowedTransportModes).toEqual([
      'airplane',
      'highspeed_rail',
      'long_distance',
      'night_rail',
      'coach',
      'ride_sharing',
      'regional_rail',
      'suburban',
      'subway',
      'tram',
      'bus',
      'ferry',
      'odm',
      'funicular',
      'aerial_lift',
      'other',
    ]);
    expect(body.participants[0].id).toBe('traveler-1');
    expect(screen.queryByLabelText(/Participant ID/i)).not.toBeInTheDocument();
  });

  it('editing selected text clears the selection and blocks submit', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(
      screen.getByRole('button', { name: /Pick suggestion for participants.0.origin/i }),
    );
    await user.click(
      screen.getByRole('button', { name: /Pick suggestion for participants.1.origin/i }),
    );
    expect(screen.getByTestId('participants.0.origin-selected')).toBeInTheDocument();

    fireEvent.change(document.querySelector('[data-field="participants.0.origin"]')!, {
      target: { value: 'Berlin edited' },
    });
    await waitFor(() => {
      expect(screen.queryByTestId('participants.0.origin-selected')).not.toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: 'Find a meeting point' })).toBeDisabled();
  });
});
