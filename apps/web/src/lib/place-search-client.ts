import type { PlaceSearchData, PlaceSuggestionView } from '@railmeet/validation';
import { placeSearchDataSchema } from '@railmeet/validation';

export type PlaceSearchClientResult =
  | { readonly ok: true; readonly data: PlaceSearchData }
  | {
      readonly ok: false;
      readonly error: {
        readonly code: string;
        readonly message: string;
      };
    };

export async function searchPlaces(
  query: string,
  options?: { readonly signal?: AbortSignal },
): Promise<PlaceSearchClientResult> {
  const params = new URLSearchParams({ q: query });
  const response = await fetch(`/api/v1/places/search?${params.toString()}`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    ...(options?.signal ? { signal: options.signal } : {}),
  });

  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error =
      body &&
      typeof body === 'object' &&
      'error' in body &&
      body.error &&
      typeof body.error === 'object'
        ? (body.error as { code?: string; message?: string })
        : null;
    return {
      ok: false,
      error: {
        code: error?.code ?? 'SERVICE_UNAVAILABLE',
        message: error?.message ?? 'Place suggestions are temporarily unavailable.',
      },
    };
  }

  const envelope = body as { data?: unknown };
  const parsed = placeSearchDataSchema.safeParse(envelope.data);
  if (!parsed.success) {
    return {
      ok: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Place suggestions response was invalid.',
      },
    };
  }
  return { ok: true, data: parsed.data };
}

export type { PlaceSuggestionView };
