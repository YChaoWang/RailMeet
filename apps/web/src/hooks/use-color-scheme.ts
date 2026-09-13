'use client';

import { useEffect, useState } from 'react';

export type ColorScheme = 'light' | 'dark';

export function readDocumentColorScheme(): ColorScheme {
  if (typeof document === 'undefined') {
    return 'light';
  }
  const root = document.documentElement;
  if (root.classList.contains('dark')) {
    return 'dark';
  }
  if (root.classList.contains('light')) {
    return 'light';
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/** mapcn-style theme detection: document class, then system preference. */
export function useColorScheme(): ColorScheme {
  const [scheme, setScheme] = useState<ColorScheme>('light');

  useEffect(() => {
    const sync = () => setScheme(readDocumentColorScheme());
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    });
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    media.addEventListener('change', sync);
    return () => {
      observer.disconnect();
      media.removeEventListener('change', sync);
    };
  }, []);

  return scheme;
}
