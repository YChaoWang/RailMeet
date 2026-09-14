/** @vitest-environment jsdom */
import { describe, expect, it } from 'vitest';

import { formatGithubStarCount } from '@/lib/format-github-star-count';

describe('formatGithubStarCount', () => {
  it('keeps small counts as plain numbers', () => {
    expect(formatGithubStarCount(0)).toBe('0');
    expect(formatGithubStarCount(42)).toBe('42');
    expect(formatGithubStarCount(999)).toBe('999');
  });

  it('compacts thousands like mapcn', () => {
    expect(formatGithubStarCount(1000)).toBe('1.0k');
    expect(formatGithubStarCount(12100)).toBe('12.1k');
    expect(formatGithubStarCount(12_150)).toBe('12.2k');
    expect(formatGithubStarCount(100_000)).toBe('100.0k');
  });
});
