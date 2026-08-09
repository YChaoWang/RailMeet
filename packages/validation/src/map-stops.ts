import {
  MAP_STOPS_DETAILED_MAX_SPAN_DEG,
  MAP_STOPS_DETAILED_ZOOM_MIN,
  PLACE_NAME_MAX_LENGTH,
  PROVIDER_PLACE_ID_MAX_LENGTH,
} from '@railmeet/shared';
import { z } from 'zod';

export const stationKindSchema = z.enum(['rail', 'metro', 'tram', 'bus', 'ferry', 'other']);

export const stationImportanceSchema = z.enum(['major', 'regional', 'local']);

export const stationFeaturePropertiesSchema = z
  .object({
    stopId: z
      .string()
      .min(1)
      .max(PROVIDER_PLACE_ID_MAX_LENGTH),
    name: z.string().min(1).max(PLACE_NAME_MAX_LENGTH),
    kind: stationKindSchema,
    importance: stationImportanceSchema,
    modes: z.array(z.string().min(1).max(64)).max(32),
    parentId: z.string().min(1).max(PROVIDER_PLACE_ID_MAX_LENGTH).nullable(),
  })
  .strict();

export const stationFeatureSchema = z
  .object({
    type: z.literal('Feature'),
    geometry: z
      .object({
        type: z.literal('Point'),
        /** GeoJSON order: [longitude, latitude]. */
        coordinates: z.tuple([
          z.number().finite().min(-180).max(180),
          z.number().finite().min(-90).max(90),
        ]),
      })
      .strict(),
    properties: stationFeaturePropertiesSchema,
  })
  .strict();

export const stationFeatureCollectionMetadataSchema = z
  .object({
    truncated: z.boolean(),
    aggregated: z.boolean(),
    minimumDetailZoom: z.number().finite().nonnegative().nullable(),
    sourceFeatureCount: z.number().int().nonnegative(),
  })
  .strict();

export const stationFeatureCollectionSchema = z
  .object({
    type: z.literal('FeatureCollection'),
    features: z.array(stationFeatureSchema),
    metadata: stationFeatureCollectionMetadataSchema,
  })
  .strict();

const coordinateSchema = z.coerce.number().finite();

export const mapStopsQuerySchema = z
  .object({
    minLon: coordinateSchema.min(-180).max(180),
    minLat: coordinateSchema.min(-90).max(90),
    maxLon: coordinateSchema.min(-180).max(180),
    maxLat: coordinateSchema.min(-90).max(90),
    zoom: z.coerce.number().finite().min(0).max(24),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (!(value.minLat < value.maxLat)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'minLat must be less than maxLat',
        path: ['minLat'],
      });
    }
    if (!(value.minLon < value.maxLon)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'minLon must be less than maxLon',
        path: ['minLon'],
      });
    }
    const latSpan = value.maxLat - value.minLat;
    const lonSpan = value.maxLon - value.minLon;
    if (
      value.zoom >= MAP_STOPS_DETAILED_ZOOM_MIN &&
      (latSpan > MAP_STOPS_DETAILED_MAX_SPAN_DEG || lonSpan > MAP_STOPS_DETAILED_MAX_SPAN_DEG)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `At zoom >= ${MAP_STOPS_DETAILED_ZOOM_MIN}, viewport span must be at most ${MAP_STOPS_DETAILED_MAX_SPAN_DEG} degrees`,
        path: ['zoom'],
      });
    }
  });

export type StationKind = z.output<typeof stationKindSchema>;
export type StationImportance = z.output<typeof stationImportanceSchema>;
export type StationFeatureProperties = z.output<typeof stationFeaturePropertiesSchema>;
export type StationFeature = z.output<typeof stationFeatureSchema>;
export type StationFeatureCollectionMetadata = z.output<
  typeof stationFeatureCollectionMetadataSchema
>;
export type StationFeatureCollection = z.output<typeof stationFeatureCollectionSchema>;
export type MapStopsQuery = z.output<typeof mapStopsQuerySchema>;
