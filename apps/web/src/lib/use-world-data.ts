'use client';

import type { FeatureCollection, Geometry } from 'geojson';
import { useEffect, useState } from 'react';

/** Natural Earth 110m countries — public-domain outlines used by mapcn's world example. */
export const WORLD_GEOJSON =
  'https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@v5.1.2/geojson/ne_110m_admin_0_countries.geojson';

export type WorldFeatureProperties = {
  NAME_LONG: string;
  ISO_A2?: string;
};

export type WorldData = FeatureCollection<Geometry, WorldFeatureProperties>;

export function useWorldData(url: string = WORLD_GEOJSON): WorldData | null {
  const [data, setData] = useState<WorldData | null>(null);

  useEffect(() => {
    let active = true;
    void fetch(url)
      .then((response) => response.json() as Promise<WorldData>)
      .then((world) => {
        if (active) {
          setData(world);
        }
      });
    return () => {
      active = false;
    };
  }, [url]);

  return data;
}
