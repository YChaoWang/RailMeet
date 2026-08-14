import type { MeetingSearchJourneyDetailData } from '@railmeet/validation';

import { fetchMeetingSearchJourneyDetail } from '@/lib/meeting-search-client';

type CacheEntry =
  | { readonly status: 'loading'; readonly promise: Promise<MeetingSearchJourneyDetailData> }
  | { readonly status: 'ready'; readonly data: MeetingSearchJourneyDetailData }
  | { readonly status: 'error'; readonly message: string };

const cache = new Map<string, CacheEntry>();

export function journeyDetailCacheKey(searchId: string, journeyId: string): string {
  return `${searchId}\0${journeyId}`;
}

/** Test helper — clears in-memory journey detail cache. */
export function clearJourneyDetailCache(): void {
  cache.clear();
}

export function peekJourneyDetailCache(
  searchId: string,
  journeyId: string,
): CacheEntry | undefined {
  return cache.get(journeyDetailCacheKey(searchId, journeyId));
}

/**
 * Fetch journey detail with dedupe by journeyId. Concurrent callers share one promise.
 * Does not prefetch; only called when Journey Details is expanded.
 *
 * In-flight fetches are not aborted when a caller unmounts — only the caller ignores
 * the result — so Strict Mode remounts and shared journeyIds across ranking modes
 * still resolve from one network request.
 */
export async function loadJourneyDetailCached(
  searchId: string,
  journeyId: string,
  signal?: AbortSignal,
): Promise<MeetingSearchJourneyDetailData> {
  const key = journeyDetailCacheKey(searchId, journeyId);
  const existing = cache.get(key);
  if (existing?.status === 'ready') {
    return existing.data;
  }
  if (existing?.status === 'loading') {
    const data = await existing.promise;
    if (signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }
    return data;
  }

  const promise = fetchMeetingSearchJourneyDetail(searchId, journeyId).then((result) => {
    if (!result.ok) {
      const message = result.error.message || 'Could not load journey details';
      cache.set(key, { status: 'error', message });
      throw new Error(message);
    }
    cache.set(key, { status: 'ready', data: result.data });
    return result.data;
  });

  cache.set(key, { status: 'loading', promise });
  const data = await promise;
  if (signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }
  return data;
}

export function invalidateJourneyDetailCache(searchId: string, journeyId: string): void {
  cache.delete(journeyDetailCacheKey(searchId, journeyId));
}
