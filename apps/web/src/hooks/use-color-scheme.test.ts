/** @vitest-environment jsdom */
import { describe, expect, it } from 'vitest';

import { readDocumentColorScheme } from './use-color-scheme';

describe('readDocumentColorScheme', () => {
  it('reads the document dark class the same way mapcn does', () => {
    document.documentElement.classList.remove('dark', 'light');
    expect(readDocumentColorScheme()).toBe('light');

    document.documentElement.classList.add('dark');
    expect(readDocumentColorScheme()).toBe('dark');
  });
});
