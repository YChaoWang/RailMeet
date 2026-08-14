import type {
  CreateMeetingSearchRequest,
  MeetingSearchDetailData,
  MeetingSearchJourneyDetailData,
  MeetingSearchResultsData,
} from '@railmeet/validation';

export type ApiErrorBody = {
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly requestId: string;
    readonly details?: readonly { readonly path: string; readonly message: string }[];
  };
};

export type ClientResult<T> =
  | { readonly ok: true; readonly status: number; readonly data: T }
  | { readonly ok: false; readonly status: number; readonly error: ApiErrorBody['error'] };

async function parseJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function requestInit(signal?: AbortSignal, init?: RequestInit): RequestInit {
  return signal ? { ...init, signal } : { ...init };
}

function failureResult(
  response: Response,
  json: unknown,
  fallbackMessage: string,
): ClientResult<never> {
  return {
    ok: false,
    status: response.status,
    error:
      json && typeof json === 'object' && json !== null && 'error' in json
        ? (json as ApiErrorBody).error
        : {
            code: 'INTERNAL_ERROR',
            message: fallbackMessage,
            requestId: 'unknown',
          },
  };
}

export async function createMeetingSearch(
  body: CreateMeetingSearchRequest,
  signal?: AbortSignal,
): Promise<ClientResult<{ searchId: string; status: 'queued'; createdAt: string }>> {
  const response = await fetch(
    '/api/v1/meeting-searches',
    requestInit(signal, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
  const json = (await parseJson(response)) as
    | { data: { searchId: string; status: 'queued'; createdAt: string } }
    | ApiErrorBody
    | null;
  if (!response.ok || !json || !('data' in json)) {
    return failureResult(response, json, 'Could not create the search');
  }
  return { ok: true, status: response.status, data: json.data };
}

export async function fetchMeetingSearch(
  searchId: string,
  signal?: AbortSignal,
): Promise<ClientResult<MeetingSearchDetailData>> {
  const response = await fetch(
    `/api/v1/meeting-searches/${encodeURIComponent(searchId)}`,
    requestInit(signal),
  );
  const json = (await parseJson(response)) as
    | { data: MeetingSearchDetailData }
    | ApiErrorBody
    | null;
  if (!response.ok || !json || !('data' in json)) {
    return failureResult(response, json, 'Could not load the search');
  }
  return { ok: true, status: response.status, data: json.data };
}

export async function fetchMeetingSearchResults(
  searchId: string,
  signal?: AbortSignal,
): Promise<ClientResult<MeetingSearchResultsData>> {
  const response = await fetch(
    `/api/v1/meeting-searches/${encodeURIComponent(searchId)}/results`,
    requestInit(signal),
  );
  const json = (await parseJson(response)) as
    | { data: MeetingSearchResultsData }
    | ApiErrorBody
    | null;
  if (!response.ok || !json || !('data' in json)) {
    return failureResult(response, json, 'Could not load results');
  }
  return { ok: true, status: response.status, data: json.data };
}

export async function fetchMeetingSearchJourneyDetail(
  searchId: string,
  journeyId: string,
  signal?: AbortSignal,
): Promise<ClientResult<MeetingSearchJourneyDetailData>> {
  const response = await fetch(
    `/api/v1/meeting-searches/${encodeURIComponent(searchId)}/journeys/${encodeURIComponent(journeyId)}`,
    requestInit(signal),
  );
  const json = (await parseJson(response)) as
    | { data: MeetingSearchJourneyDetailData }
    | ApiErrorBody
    | null;
  if (!response.ok || !json || !('data' in json)) {
    return failureResult(response, json, 'Could not load journey details');
  }
  return { ok: true, status: response.status, data: json.data };
}
