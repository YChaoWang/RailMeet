import { isPlaceKind, type PlaceKind } from '@railmeet/shared';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import type { CreatePlaceCommand, PlaceRecord, UpsertProviderPlaceCommand } from '../models.js';
import { placeIdForProviderPlace } from '../place-identity.js';
import type * as schema from '../schema/index.js';
import { places } from '../schema/tables.js';

type Db = PostgresJsDatabase<typeof schema>;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

function assertPlaceKind(value: string): PlaceKind {
  if (!isPlaceKind(value)) {
    throw new Error(`Unexpected place kind from database: ${value}`);
  }
  return value;
}

function mapPlace(row: typeof places.$inferSelect): PlaceRecord {
  return {
    id: row.id,
    name: row.name,
    kind: assertPlaceKind(row.kind),
    countryCode: row.countryCode,
    timezone: row.timezone,
    location: {
      longitude: row.location.x,
      latitude: row.location.y,
    },
    parentCityId: row.parentCityId,
    provider: row.provider,
    providerPlaceId: row.providerPlaceId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export type PlaceRepository = {
  create: (command: CreatePlaceCommand) => Promise<PlaceRecord>;
  findById: (id: string) => Promise<PlaceRecord | null>;
  findManyByIds: (ids: readonly string[]) => Promise<PlaceRecord[]>;
  findByProviderPlace: (provider: string, providerPlaceId: string) => Promise<PlaceRecord | null>;
  upsertFromProvider: (
    command: UpsertProviderPlaceCommand,
    executor?: Db | Tx,
  ) => Promise<PlaceRecord>;
  deleteById: (id: string) => Promise<boolean>;
  hasSpatialIndex: () => Promise<boolean>;
};

export function createPlaceRepository(db: Db): PlaceRepository {
  return {
    async create(command) {
      const [row] = await db
        .insert(places)
        .values({
          id: command.id,
          name: command.name,
          kind: command.kind,
          countryCode: command.countryCode,
          timezone: command.timezone,
          location: { x: command.location.longitude, y: command.location.latitude },
          parentCityId: command.parentCityId ?? null,
          provider: command.provider ?? null,
          providerPlaceId: command.providerPlaceId ?? null,
        })
        .returning();

      if (!row) {
        throw new Error('Failed to insert place');
      }

      return mapPlace(row);
    },

    async findById(id) {
      const row = await db.query.places.findFirst({
        where: eq(places.id, id),
      });
      return row ? mapPlace(row) : null;
    },

    async findManyByIds(ids) {
      if (ids.length === 0) {
        return [];
      }
      const rows = await db
        .select()
        .from(places)
        .where(inArray(places.id, [...ids]));
      const byId = new Map(rows.map((row) => [row.id, mapPlace(row)]));
      return ids.flatMap((id) => {
        const place = byId.get(id);
        return place ? [place] : [];
      });
    },

    async findByProviderPlace(provider, providerPlaceId) {
      const row = await db.query.places.findFirst({
        where: and(eq(places.provider, provider), eq(places.providerPlaceId, providerPlaceId)),
      });
      return row ? mapPlace(row) : null;
    },

    async upsertFromProvider(command, executor = db) {
      const id = placeIdForProviderPlace(command.provider, command.providerPlaceId);
      const now = new Date();
      const [row] = await executor
        .insert(places)
        .values({
          id,
          name: command.name,
          kind: command.kind,
          countryCode: command.countryCode,
          timezone: command.timezone,
          location: { x: command.location.longitude, y: command.location.latitude },
          parentCityId: null,
          provider: command.provider,
          providerPlaceId: command.providerPlaceId,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [places.provider, places.providerPlaceId],
          targetWhere: sql`${places.provider} IS NOT NULL AND ${places.providerPlaceId} IS NOT NULL`,
          set: {
            name: command.name,
            kind: command.kind,
            countryCode: command.countryCode,
            timezone: command.timezone,
            location: { x: command.location.longitude, y: command.location.latitude },
            updatedAt: now,
          },
        })
        .returning();

      if (!row) {
        throw new Error('Failed to upsert provider place');
      }
      return mapPlace(row);
    },

    async deleteById(id) {
      const deleted = await db.delete(places).where(eq(places.id, id)).returning({ id: places.id });
      return deleted.length > 0;
    },

    async hasSpatialIndex() {
      const result = await db.execute(sql`
        SELECT EXISTS (
          SELECT 1
          FROM pg_indexes
          WHERE schemaname = 'public'
            AND tablename = 'places'
            AND indexname = 'places_location_gix'
        ) AS exists
      `);
      const rows = result as unknown as Array<{ exists: boolean }>;
      return Boolean(rows[0]?.exists);
    },
  };
}

export async function assertPostgisInstalled(db: Db): Promise<boolean> {
  const result = await db.execute(sql`
    SELECT EXISTS (
      SELECT 1 FROM pg_extension WHERE extname = 'postgis'
    ) AS installed
  `);
  const rows = result as unknown as Array<{ installed: boolean }>;
  return Boolean(rows[0]?.installed);
}
