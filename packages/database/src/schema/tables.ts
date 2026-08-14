import {
  ARRIVAL_DAY_OFFSET_MAX,
  ARRIVAL_DAY_OFFSET_MIN,
  MAX_JOURNEY_DURATION_MINUTES_UPPER_BOUND,
  MAX_TRANSFERS_UPPER_BOUND,
  MIN_TRANSFER_DURATION_MINUTES_UPPER_BOUND,
  PARTICIPANT_ID_MAX_LENGTH,
  PARTICIPANT_NAME_MAX_LENGTH,
  PLACE_ID_MAX_LENGTH,
  PLACE_KINDS,
  PLACE_NAME_MAX_LENGTH,
  PLACE_OWNERSHIPS,
  IANA_TIMEZONE_MAX_LENGTH,
  RANKING_MODES,
  SEARCH_COMPLETION_OUTCOMES,
  SEARCH_STATUSES,
  TRANSPORT_MODES,
} from '@railmeet/shared';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  doublePrecision,
  foreignKey,
  geometry,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  time,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  date,
} from 'drizzle-orm/pg-core';

import {
  MEETING_SEARCH_AGGREGATE_TYPE,
  MEETING_SEARCH_CANDIDATES_REQUESTED_EVENT_TYPE,
  MEETING_SEARCH_CANDIDATES_REQUESTED_SCHEMA_VERSION,
  MEETING_SEARCH_FINALIZATION_REQUESTED_EVENT_TYPE,
  MEETING_SEARCH_FINALIZATION_REQUESTED_SCHEMA_VERSION,
  MEETING_SEARCH_REQUESTED_EVENT_TYPE,
  MEETING_SEARCH_REQUESTED_SCHEMA_VERSION,
  OUTBOX_AGGREGATE_TYPES,
  OUTBOX_DEDUPE_KEY_DEFAULT,
  OUTBOX_EVENT_TYPES,
  ROUTING_REQUESTED_EVENT_TYPE,
  ROUTING_REQUESTED_SCHEMA_VERSION,
  type OutboxPayload,
} from '../outbox.js';

export const CANDIDATE_GENERATION_STATUSES = [
  'pending',
  'running',
  'succeeded',
  'failed_permanent',
] as const;

export const ROUTING_WORK_STATUSES = [
  'pending',
  'running',
  'succeeded',
  'no_journeys',
  'exhausted',
] as const;

export { SEARCH_COMPLETION_OUTCOMES };

export const CANDIDATE_FEASIBILITY_REASONS = [
  'feasible',
  'participant_no_journeys',
  'routing_incomplete',
  'technical_failure',
  'invariant_violation',
] as const;

const candidateGenerationStatusSqlList = CANDIDATE_GENERATION_STATUSES.map(
  (value) => `'${value}'`,
).join(', ');
const routingWorkStatusSqlList = ROUTING_WORK_STATUSES.map((value) => `'${value}'`).join(', ');
const completionOutcomeSqlList = SEARCH_COMPLETION_OUTCOMES.map((value) => `'${value}'`).join(', ');
const feasibilityReasonSqlList = CANDIDATE_FEASIBILITY_REASONS.map((value) => `'${value}'`).join(
  ', ',
);

const placeKindSqlList = PLACE_KINDS.map((value) => `'${value}'`).join(', ');
const placeOwnershipSqlList = PLACE_OWNERSHIPS.map((value) => `'${value}'`).join(', ');
const rankingModeSqlList = RANKING_MODES.map((value) => `'${value}'`).join(', ');
const searchStatusSqlList = SEARCH_STATUSES.map((value) => `'${value}'`).join(', ');
const transportModeSqlList = TRANSPORT_MODES.map((value) => `'${value}'`).join(', ');

/**
 * Canonical RailMeet places.
 * Coordinates are authoritative PostGIS points (lon/lat, SRID 4326).
 * Optional Motis/Transitous provider identity supports autocomplete upserts without
 * storing raw geocode payloads.
 */
export const places = pgTable(
  'places',
  {
    id: text('id').primaryKey().notNull(),
    name: text('name').notNull(),
    kind: text('kind').notNull(),
    countryCode: text('country_code').notNull(),
    timezone: text('timezone').notNull(),
    location: geometry('location', { type: 'point', mode: 'xy', srid: 4326 }).notNull(),
    parentCityId: text('parent_city_id'),
    /** Provider namespace when this place was resolved from autocomplete (e.g. motis). */
    provider: text('provider'),
    /** Stable provider location id (MOTIS Match.id). Paired with provider. */
    providerPlaceId: text('provider_place_id'),
    /**
     * Record ownership. Catalog imports refresh catalog:* rows;
     * manual and provider:motis rows are not overwritten by catalog refresh.
     */
    ownership: text('ownership').notNull().default('manual'),
    sourceVersion: text('source_version'),
    normalizedName: text('normalized_name'),
    /** GeoNames population when known (source-owned). */
    population: integer('population'),
    /** GeoNames feature code when known (source-owned), e.g. PPLC. */
    featureCode: text('feature_code'),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    index('places_location_gix').using('gist', table.location),
    index('places_ownership_active_idx').on(table.ownership, table.active),
    uniqueIndex('places_provider_place_uid')
      .on(table.provider, table.providerPlaceId)
      .where(sql`${table.provider} IS NOT NULL AND ${table.providerPlaceId} IS NOT NULL`),
    foreignKey({
      columns: [table.parentCityId],
      foreignColumns: [table.id],
      name: 'places_parent_city_id_fkey',
    }).onDelete('restrict'),
    check(
      'places_id_length_chk',
      sql`char_length(${table.id}) >= 1 AND char_length(${table.id}) <= ${sql.raw(String(PLACE_ID_MAX_LENGTH))}`,
    ),
    check(
      'places_name_length_chk',
      sql`char_length(${table.name}) >= 1 AND char_length(${table.name}) <= ${sql.raw(String(PLACE_NAME_MAX_LENGTH))}`,
    ),
    check('places_kind_chk', sql`${table.kind} IN (${sql.raw(placeKindSqlList)})`),
    check('places_ownership_chk', sql`${table.ownership} IN (${sql.raw(placeOwnershipSqlList)})`),
    check('places_country_code_chk', sql`${table.countryCode} ~ '^[A-Z]{2}$'`),
    check(
      'places_timezone_length_chk',
      sql`char_length(${table.timezone}) >= 1 AND char_length(${table.timezone}) <= ${sql.raw(String(IANA_TIMEZONE_MAX_LENGTH))}`,
    ),
    check(
      'places_provider_pair_chk',
      sql`(${table.provider} IS NULL AND ${table.providerPlaceId} IS NULL) OR (${table.provider} IS NOT NULL AND ${table.providerPlaceId} IS NOT NULL)`,
    ),
    check(
      'places_provider_place_id_length_chk',
      sql`${table.providerPlaceId} IS NULL OR (char_length(${table.providerPlaceId}) >= 1 AND char_length(${table.providerPlaceId}) <= 512)`,
    ),
    // Keep SQL text aligned with migrations (`ST_SRID("location")` / GeometryType)
    // so drizzle-kit does not emit a spurious ALTER on every generate.
    check('places_location_srid_chk', sql`ST_SRID("location") = 4326`),
    check('places_location_point_chk', sql`GeometryType("location") = 'POINT'`),
    check('places_location_not_empty_chk', sql`NOT ST_IsEmpty("location")`),
    check(
      'places_location_longitude_chk',
      sql`ST_X("location") >= -180 AND ST_X("location") <= 180`,
    ),
    check('places_location_latitude_chk', sql`ST_Y("location") >= -90 AND ST_Y("location") <= 90`),
  ],
);

/**
 * Deterministic meeting-city → representative transit-hub associations.
 * Candidate discovery remains city-based; routing uses the selected hub.
 */
export const meetingCityHubs = pgTable(
  'meeting_city_hubs',
  {
    cityPlaceId: text('city_place_id')
      .notNull()
      .references(() => places.id, { onDelete: 'restrict' }),
    hubPlaceId: text('hub_place_id')
      .notNull()
      .references(() => places.id, { onDelete: 'restrict' }),
    priority: integer('priority').notNull(),
    matchMethod: text('match_method').notNull(),
    source: text('source').notNull(),
    sourceVersion: text('source_version'),
    regional: boolean('regional').notNull().default(false),
    distanceMeters: doublePrecision('distance_meters'),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({
      name: 'meeting_city_hubs_pk',
      columns: [table.cityPlaceId, table.hubPlaceId],
    }),
    uniqueIndex('meeting_city_hubs_city_priority_uid')
      .on(table.cityPlaceId, table.priority)
      .where(sql`${table.active} = true`),
    index('meeting_city_hubs_hub_idx').on(table.hubPlaceId),
    check('meeting_city_hubs_priority_chk', sql`${table.priority} >= 0`),
    check(
      'meeting_city_hubs_distance_chk',
      sql`${table.distanceMeters} IS NULL OR ${table.distanceMeters} >= 0`,
    ),
    check('meeting_city_hubs_city_ne_hub_chk', sql`${table.cityPlaceId} <> ${table.hubPlaceId}`),
  ],
);

/** Audit log for catalog import runs (not used during normal search runtime). */
export const catalogImportRuns = pgTable(
  'catalog_import_runs',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),
    source: text('source').notNull(),
    sourceVersion: text('source_version').notNull(),
    checksum: text('checksum'),
    status: text('status').notNull(),
    cityCount: integer('city_count').notNull().default(0),
    hubCount: integer('hub_count').notNull().default(0),
    associationCount: integer('association_count').notNull().default(0),
    rejectedCount: integer('rejected_count').notNull().default(0),
    deactivatedCount: integer('deactivated_count').notNull().default(0),
    diagnostics: jsonb('diagnostics'),
    startedAt: timestamp('started_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true, mode: 'date' }),
  },
  (table) => [
    check('catalog_import_runs_status_chk', sql`${table.status} IN ('succeeded', 'failed')`),
  ],
);

/**
 * Meeting-search header row.
 * Travel date is a calendar date; wall-clock times are `time without time zone`.
 * Timezone resolution happens later per origin/candidate place — not on this row.
 */
export const meetingSearches = pgTable(
  'meeting_searches',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),
    status: text('status').notNull().default('queued'),
    travelDate: date('travel_date', { mode: 'string' }).notNull(),
    earliestDepartureTime: time('earliest_departure_time', { withTimezone: false }).notNull(),
    latestArrivalTime: time('latest_arrival_time', { withTimezone: false }).notNull(),
    arrivalDayOffset: smallint('arrival_day_offset').notNull().default(0),
    maxJourneyDurationMinutes: integer('max_journey_duration_minutes').notNull(),
    maxTransfers: integer('max_transfers').notNull(),
    minTransferDurationMinutes: integer('min_transfer_duration_minutes').notNull(),
    rankingMode: text('ranking_mode').notNull(),
    /**
     * Set once when the search first transitions queued → running.
     * Never updated on duplicate kickoff deliveries.
     */
    startedAt: timestamp('started_at', { withTimezone: true, mode: 'date' }),
    /** Set once on running → completed (Phase 8). */
    completedAt: timestamp('completed_at', { withTimezone: true, mode: 'date' }),
    /** Set once on running → failed (Phase 8). */
    failedAt: timestamp('failed_at', { withTimezone: true, mode: 'date' }),
    /** Domain completion outcome when status is completed. */
    completionOutcome: text('completion_outcome'),
    /** Sanitized internal failure code when status is failed. */
    failureCode: text('failure_code'),
    /** Primary recommendation for the requested ranking mode when outcome is ranked. */
    recommendedDestinationPlaceId: text('recommended_destination_place_id'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    check('meeting_searches_status_chk', sql`${table.status} IN (${sql.raw(searchStatusSqlList)})`),
    check(
      'meeting_searches_ranking_mode_chk',
      sql`${table.rankingMode} IN (${sql.raw(rankingModeSqlList)})`,
    ),
    check(
      'meeting_searches_arrival_day_offset_chk',
      sql`${table.arrivalDayOffset} >= ${sql.raw(String(ARRIVAL_DAY_OFFSET_MIN))} AND ${table.arrivalDayOffset} <= ${sql.raw(String(ARRIVAL_DAY_OFFSET_MAX))}`,
    ),
    check(
      'meeting_searches_max_journey_duration_chk',
      sql`${table.maxJourneyDurationMinutes} >= 1 AND ${table.maxJourneyDurationMinutes} <= ${sql.raw(String(MAX_JOURNEY_DURATION_MINUTES_UPPER_BOUND))}`,
    ),
    check(
      'meeting_searches_max_transfers_chk',
      sql`${table.maxTransfers} >= 0 AND ${table.maxTransfers} <= ${sql.raw(String(MAX_TRANSFERS_UPPER_BOUND))}`,
    ),
    check(
      'meeting_searches_min_transfer_duration_chk',
      sql`${table.minTransferDurationMinutes} >= 1 AND ${table.minTransferDurationMinutes} <= ${sql.raw(String(MIN_TRANSFER_DURATION_MINUTES_UPPER_BOUND))}`,
    ),
    check(
      'meeting_searches_completion_outcome_chk',
      sql`${table.completionOutcome} IS NULL OR ${table.completionOutcome} IN (${sql.raw(completionOutcomeSqlList)})`,
    ),
    check(
      'meeting_searches_completion_pairing_chk',
      sql`(
        (
          ${table.status} = 'completed'
          AND ${table.completionOutcome} IS NOT NULL
          AND ${table.failedAt} IS NULL
          AND ${table.failureCode} IS NULL
          AND (
            (${table.completionOutcome} = 'ranked' AND ${table.recommendedDestinationPlaceId} IS NOT NULL)
            OR (${table.completionOutcome} <> 'ranked' AND ${table.recommendedDestinationPlaceId} IS NULL)
          )
        )
        OR (
          ${table.status} = 'failed'
          AND ${table.failureCode} IS NOT NULL
          AND ${table.completionOutcome} IS NULL
          AND ${table.completedAt} IS NULL
          AND ${table.recommendedDestinationPlaceId} IS NULL
        )
        OR (
          ${table.status} NOT IN ('completed', 'failed')
          AND ${table.completionOutcome} IS NULL
          AND ${table.failureCode} IS NULL
          AND ${table.completedAt} IS NULL
          AND ${table.failedAt} IS NULL
          AND ${table.recommendedDestinationPlaceId} IS NULL
        )
      )`,
    ),
    foreignKey({
      columns: [table.recommendedDestinationPlaceId],
      foreignColumns: [places.id],
      name: 'meeting_searches_recommended_destination_place_id_fkey',
    }).onDelete('restrict'),
  ],
);

export const meetingSearchParticipants = pgTable(
  'meeting_search_participants',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),
    meetingSearchId: uuid('meeting_search_id')
      .notNull()
      .references(() => meetingSearches.id, { onDelete: 'cascade' }),
    participantId: text('participant_id').notNull(),
    displayName: text('display_name').notNull(),
    originPlaceId: text('origin_place_id')
      .notNull()
      .references(() => places.id, { onDelete: 'restrict' }),
    position: integer('position').notNull(),
  },
  (table) => [
    unique('meeting_search_participants_search_participant_uid').on(
      table.meetingSearchId,
      table.participantId,
    ),
    unique('meeting_search_participants_search_position_uid').on(
      table.meetingSearchId,
      table.position,
    ),
    check(
      'meeting_search_participants_participant_id_length_chk',
      sql`char_length(${table.participantId}) >= 1 AND char_length(${table.participantId}) <= ${sql.raw(String(PARTICIPANT_ID_MAX_LENGTH))}`,
    ),
    check(
      'meeting_search_participants_display_name_length_chk',
      sql`char_length(${table.displayName}) >= 1 AND char_length(${table.displayName}) <= ${sql.raw(String(PARTICIPANT_NAME_MAX_LENGTH))}`,
    ),
    check('meeting_search_participants_position_chk', sql`${table.position} >= 0`),
  ],
);

export const meetingSearchTransportModes = pgTable(
  'meeting_search_transport_modes',
  {
    meetingSearchId: uuid('meeting_search_id')
      .notNull()
      .references(() => meetingSearches.id, { onDelete: 'cascade' }),
    mode: text('mode').notNull(),
  },
  (table) => [
    primaryKey({
      name: 'meeting_search_transport_modes_pk',
      columns: [table.meetingSearchId, table.mode],
    }),
    check(
      'meeting_search_transport_modes_mode_chk',
      sql`${table.mode} IN (${sql.raw(transportModeSqlList)})`,
    ),
  ],
);

export const meetingSearchAllowedCountries = pgTable(
  'meeting_search_allowed_countries',
  {
    meetingSearchId: uuid('meeting_search_id')
      .notNull()
      .references(() => meetingSearches.id, { onDelete: 'cascade' }),
    countryCode: text('country_code').notNull(),
  },
  (table) => [
    primaryKey({
      name: 'meeting_search_allowed_countries_pk',
      columns: [table.meetingSearchId, table.countryCode],
    }),
    check('meeting_search_allowed_countries_code_chk', sql`${table.countryCode} ~ '^[A-Z]{2}$'`),
  ],
);

const outboxEventTypeSqlList = OUTBOX_EVENT_TYPES.map((value) => `'${value}'`).join(', ');
const outboxAggregateTypeSqlList = OUTBOX_AGGREGATE_TYPES.map((value) => `'${value}'`).join(', ');

/**
 * Minimal transactional outbox.
 * Search create writes unpublished events; the worker dispatcher claims and publishes them.
 *
 * Deletion policy: outbox rows for a meeting search cascade when the search is deleted.
 * dedupe_key allows multiple routing.requested events per search (one per routing work item).
 */
export const outboxEvents = pgTable(
  'outbox_events',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),
    eventType: text('event_type').notNull(),
    aggregateType: text('aggregate_type').notNull(),
    aggregateId: uuid('aggregate_id')
      .notNull()
      .references(() => meetingSearches.id, { onDelete: 'cascade' }),
    schemaVersion: integer('schema_version').notNull(),
    payload: jsonb('payload').$type<OutboxPayload>().notNull(),
    dedupeKey: text('dedupe_key').notNull().default(OUTBOX_DEDUPE_KEY_DEFAULT),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    publishedAt: timestamp('published_at', { withTimezone: true, mode: 'date' }),
    failureCount: integer('failure_count').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true, mode: 'date' }),
    leaseToken: uuid('lease_token'),
    leasedUntil: timestamp('leased_until', { withTimezone: true, mode: 'date' }),
    lastErrorCode: text('last_error_code'),
    deadLetteredAt: timestamp('dead_lettered_at', { withTimezone: true, mode: 'date' }),
  },
  (table) => [
    unique('outbox_events_aggregate_event_dedupe_uid').on(
      table.aggregateType,
      table.aggregateId,
      table.eventType,
      table.dedupeKey,
    ),
    index('outbox_events_unpublished_created_at_idx')
      .on(table.createdAt)
      .where(sql`${table.publishedAt} IS NULL`),
    index('outbox_events_due_claim_idx')
      .on(table.createdAt, table.id)
      .where(sql`${table.publishedAt} IS NULL AND ${table.deadLetteredAt} IS NULL`),
    check(
      'outbox_events_event_type_chk',
      sql`${table.eventType} IN (${sql.raw(outboxEventTypeSqlList)})`,
    ),
    check(
      'outbox_events_aggregate_type_chk',
      sql`${table.aggregateType} IN (${sql.raw(outboxAggregateTypeSqlList)})`,
    ),
    check(
      'outbox_events_schema_version_chk',
      sql`${table.schemaVersion} >= 1 AND (
        (
          ${table.eventType} = ${sql.raw(`'${MEETING_SEARCH_REQUESTED_EVENT_TYPE}'`)}
          AND ${table.schemaVersion} = ${sql.raw(String(MEETING_SEARCH_REQUESTED_SCHEMA_VERSION))}
        ) OR (
          ${table.eventType} = ${sql.raw(`'${MEETING_SEARCH_CANDIDATES_REQUESTED_EVENT_TYPE}'`)}
          AND ${table.schemaVersion} = ${sql.raw(String(MEETING_SEARCH_CANDIDATES_REQUESTED_SCHEMA_VERSION))}
        ) OR (
          ${table.eventType} = ${sql.raw(`'${ROUTING_REQUESTED_EVENT_TYPE}'`)}
          AND ${table.schemaVersion} = ${sql.raw(String(ROUTING_REQUESTED_SCHEMA_VERSION))}
        ) OR (
          ${table.eventType} = ${sql.raw(`'${MEETING_SEARCH_FINALIZATION_REQUESTED_EVENT_TYPE}'`)}
          AND ${table.schemaVersion} = ${sql.raw(String(MEETING_SEARCH_FINALIZATION_REQUESTED_SCHEMA_VERSION))}
        )
      )`,
    ),
    check(
      'outbox_events_meeting_search_payload_chk',
      sql`(
        (
          ${table.eventType} = ${sql.raw(`'${MEETING_SEARCH_REQUESTED_EVENT_TYPE}'`)}
          AND ${table.aggregateType} = ${sql.raw(`'${MEETING_SEARCH_AGGREGATE_TYPE}'`)}
          AND ${table.dedupeKey} = ${sql.raw(`'${OUTBOX_DEDUPE_KEY_DEFAULT}'`)}
          AND ${table.payload} = jsonb_build_object('searchId', ${table.aggregateId}::text)
        ) OR (
          ${table.eventType} = ${sql.raw(`'${MEETING_SEARCH_CANDIDATES_REQUESTED_EVENT_TYPE}'`)}
          AND ${table.aggregateType} = ${sql.raw(`'${MEETING_SEARCH_AGGREGATE_TYPE}'`)}
          AND ${table.dedupeKey} = ${sql.raw(`'${OUTBOX_DEDUPE_KEY_DEFAULT}'`)}
          AND ${table.payload} = jsonb_build_object('searchId', ${table.aggregateId}::text)
        ) OR (
          ${table.eventType} = ${sql.raw(`'${ROUTING_REQUESTED_EVENT_TYPE}'`)}
          AND ${table.aggregateType} = ${sql.raw(`'${MEETING_SEARCH_AGGREGATE_TYPE}'`)}
          AND ${table.dedupeKey} = (${table.payload}->>'routingWorkId')
          AND (${table.payload}->>'searchId') = ${table.aggregateId}::text
          AND (${table.payload}->>'routingWorkId') IS NOT NULL
        ) OR (
          ${table.eventType} = ${sql.raw(`'${MEETING_SEARCH_FINALIZATION_REQUESTED_EVENT_TYPE}'`)}
          AND ${table.aggregateType} = ${sql.raw(`'${MEETING_SEARCH_AGGREGATE_TYPE}'`)}
          AND ${table.payload} = jsonb_build_object('searchId', ${table.aggregateId}::text)
          AND (
            ${table.dedupeKey} LIKE 'candidate-generation:%'
            OR ${table.dedupeKey} LIKE 'routing-work:%'
          )
        )
      )`,
    ),
    check('outbox_events_failure_count_chk', sql`${table.failureCount} >= 0`),
    check(
      'outbox_events_lease_pair_chk',
      sql`(
        (${table.leaseToken} IS NULL AND ${table.leasedUntil} IS NULL)
        OR (${table.leaseToken} IS NOT NULL AND ${table.leasedUntil} IS NOT NULL)
      )`,
    ),
  ],
);

/**
 * One durable candidate-generation claim per search (Phase 7).
 */
export const meetingSearchCandidateGenerations = pgTable(
  'meeting_search_candidate_generations',
  {
    searchId: uuid('search_id')
      .primaryKey()
      .notNull()
      .references(() => meetingSearches.id, { onDelete: 'cascade' }),
    status: text('status').notNull().default('pending'),
    startedAt: timestamp('started_at', { withTimezone: true, mode: 'date' }),
    completedAt: timestamp('completed_at', { withTimezone: true, mode: 'date' }),
    errorCode: text('error_code'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    check(
      'meeting_search_candidate_generations_status_chk',
      sql`${table.status} IN (${sql.raw(candidateGenerationStatusSqlList)})`,
    ),
  ],
);

/**
 * Deterministic candidate cities for a running search (not final ranking).
 */
export const meetingSearchCandidates = pgTable(
  'meeting_search_candidates',
  {
    searchId: uuid('search_id')
      .notNull()
      .references(() => meetingSearches.id, { onDelete: 'cascade' }),
    destinationPlaceId: text('destination_place_id')
      .notNull()
      .references(() => places.id, { onDelete: 'restrict' }),
    ordinal: integer('ordinal').notNull(),
    distanceMeters: doublePrecision('distance_meters').notNull(),
    /** Representative hub used for routing; null when centroid fallback. */
    routingHubPlaceId: text('routing_hub_place_id').references(() => places.id, {
      onDelete: 'restrict',
    }),
    /** `hub` | `centroid_fallback` once candidate generation attaches a target. */
    routingTargetReason: text('routing_target_reason'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({
      name: 'meeting_search_candidates_pk',
      columns: [table.searchId, table.destinationPlaceId],
    }),
    unique('meeting_search_candidates_search_ordinal_uid').on(table.searchId, table.ordinal),
    check('meeting_search_candidates_ordinal_chk', sql`${table.ordinal} >= 0`),
    check('meeting_search_candidates_distance_chk', sql`${table.distanceMeters} >= 0`),
    check(
      'meeting_search_candidates_routing_target_reason_chk',
      sql`(
        (${table.routingTargetReason} IS NULL AND ${table.routingHubPlaceId} IS NULL)
        OR (
          ${table.routingTargetReason} IN ('hub', 'centroid_fallback')
          AND (
            (${table.routingTargetReason} = 'hub' AND ${table.routingHubPlaceId} IS NOT NULL)
            OR (${table.routingTargetReason} = 'centroid_fallback')
          )
        )
      )`,
    ),
  ],
);

/**
 * One routing work item per participant × candidate destination.
 */
export const meetingSearchRoutingWork = pgTable(
  'meeting_search_routing_work',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),
    searchId: uuid('search_id')
      .notNull()
      .references(() => meetingSearches.id, { onDelete: 'cascade' }),
    participantId: text('participant_id').notNull(),
    destinationPlaceId: text('destination_place_id').notNull(),
    status: text('status').notNull().default('pending'),
    startedAt: timestamp('started_at', { withTimezone: true, mode: 'date' }),
    completedAt: timestamp('completed_at', { withTimezone: true, mode: 'date' }),
    errorCode: text('error_code'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    unique('meeting_search_routing_work_logical_uid').on(
      table.searchId,
      table.participantId,
      table.destinationPlaceId,
    ),
    foreignKey({
      columns: [table.searchId, table.destinationPlaceId],
      foreignColumns: [
        meetingSearchCandidates.searchId,
        meetingSearchCandidates.destinationPlaceId,
      ],
      name: 'meeting_search_routing_work_candidate_fkey',
    }).onDelete('cascade'),
    check(
      'meeting_search_routing_work_status_chk',
      sql`${table.status} IN (${sql.raw(routingWorkStatusSqlList)})`,
    ),
    check(
      'meeting_search_routing_work_participant_id_length_chk',
      sql`char_length(${table.participantId}) >= 1 AND char_length(${table.participantId}) <= ${sql.raw(String(PARTICIPANT_ID_MAX_LENGTH))}`,
    ),
    index('meeting_search_routing_work_search_status_idx').on(table.searchId, table.status),
  ],
);

export type NormalizedEncodedRouteGeometryJson = {
  readonly points: string;
  readonly precision: number;
  readonly length: number;
};

export const STORED_JOURNEY_LEGS_FORMAT = 'motis-plan-itinerary-v1' as const;

export type StoredMotisPlanItineraryDocument = {
  readonly format: typeof STORED_JOURNEY_LEGS_FORMAT;
  readonly motisPlanApiVersion: 'v5';
  readonly motisOpenApiPin: string;
  readonly itinerary: unknown;
  readonly rankingLegs: readonly NormalizedJourneyLegJson[];
};

export type StoredJourneyLegsJson =
  | readonly NormalizedJourneyLegJson[]
  | StoredMotisPlanItineraryDocument;

export type NormalizedJourneyLegJson = {
  readonly mode: string;
  readonly departureAt: string;
  readonly arrivalAt: string;
  readonly durationMinutes: number;
  readonly providerReference?: string;
  /**
   * Google Encoded Polyline from MOTIS. All three fields are present together, or the
   * property is omitted. Never store partial geometry objects.
   */
  readonly geometry?: NormalizedEncodedRouteGeometryJson;
  readonly motisMode?: string;
  readonly displayName?: string;
  readonly routeShortName?: string;
  readonly routeLongName?: string;
  readonly tripShortName?: string;
  readonly headsign?: string;
  readonly agencyName?: string;
  readonly agencyId?: string;
  readonly agencyUrl?: string;
  readonly routeColor?: string;
  readonly routeTextColor?: string;
  readonly from?: { readonly name: string; readonly track?: string };
  readonly to?: { readonly name: string; readonly track?: string };
  readonly intermediateStopCount?: number;
  readonly distanceMeters?: number;
};

/**
 * Provider-neutral ranking fields plus a versioned MOTIS itinerary snapshot in `legs` jsonb.
 */
export const meetingSearchJourneys = pgTable(
  'meeting_search_journeys',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),
    routingWorkId: uuid('routing_work_id')
      .notNull()
      .references(() => meetingSearchRoutingWork.id, { onDelete: 'cascade' }),
    journeyOrdinal: integer('journey_ordinal').notNull(),
    departureAt: timestamp('departure_at', { withTimezone: true, mode: 'date' }).notNull(),
    arrivalAt: timestamp('arrival_at', { withTimezone: true, mode: 'date' }).notNull(),
    durationMinutes: integer('duration_minutes').notNull(),
    transfers: integer('transfers').notNull(),
    transportModes: text('transport_modes').array().notNull(),
    legs: jsonb('legs').$type<StoredJourneyLegsJson>().notNull(),
    providerReference: text('provider_reference'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    unique('meeting_search_journeys_work_ordinal_uid').on(
      table.routingWorkId,
      table.journeyOrdinal,
    ),
    check('meeting_search_journeys_ordinal_chk', sql`${table.journeyOrdinal} >= 0`),
    check('meeting_search_journeys_duration_chk', sql`${table.durationMinutes} >= 0`),
    check('meeting_search_journeys_transfers_chk', sql`${table.transfers} >= 0`),
    check(
      'meeting_search_journeys_arrival_after_departure_chk',
      sql`${table.arrivalAt} >= ${table.departureAt}`,
    ),
  ],
);

/**
 * Phase 8 feasibility evaluation for every candidate (including infeasible).
 */
export const meetingSearchCandidateEvaluations = pgTable(
  'meeting_search_candidate_evaluations',
  {
    searchId: uuid('search_id').notNull(),
    destinationPlaceId: text('destination_place_id').notNull(),
    feasibility: text('feasibility').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({
      name: 'meeting_search_candidate_evaluations_pk',
      columns: [table.searchId, table.destinationPlaceId],
    }),
    foreignKey({
      columns: [table.searchId, table.destinationPlaceId],
      foreignColumns: [
        meetingSearchCandidates.searchId,
        meetingSearchCandidates.destinationPlaceId,
      ],
      name: 'meeting_search_candidate_evaluations_candidate_fkey',
    }).onDelete('cascade'),
    check(
      'meeting_search_candidate_evaluations_feasibility_chk',
      sql`${table.feasibility} IN (${sql.raw(feasibilityReasonSqlList)})`,
    ),
  ],
);

/**
 * Phase 8 ranking row per search × ranking mode × feasible candidate.
 * Duration metrics use integer minutes (same unit as meeting_search_journeys.duration_minutes).
 * Arrival spread uses milliseconds between earliest and latest selected arrivals.
 */
export const meetingSearchCandidateRankings = pgTable(
  'meeting_search_candidate_rankings',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),
    searchId: uuid('search_id')
      .notNull()
      .references(() => meetingSearches.id, { onDelete: 'cascade' }),
    rankingMode: text('ranking_mode').notNull(),
    destinationPlaceId: text('destination_place_id').notNull(),
    rank: integer('rank').notNull(),
    totalDurationMinutes: integer('total_duration_minutes').notNull(),
    maxDurationMinutes: integer('max_duration_minutes').notNull(),
    durationRangeMinutes: integer('duration_range_minutes').notNull(),
    totalTransfers: integer('total_transfers').notNull(),
    maxTransfers: integer('max_transfers').notNull(),
    earliestArrivalAt: timestamp('earliest_arrival_at', {
      withTimezone: true,
      mode: 'date',
    }).notNull(),
    latestArrivalAt: timestamp('latest_arrival_at', { withTimezone: true, mode: 'date' }).notNull(),
    arrivalSpreadMs: integer('arrival_spread_ms').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    unique('meeting_search_candidate_rankings_mode_candidate_uid').on(
      table.searchId,
      table.rankingMode,
      table.destinationPlaceId,
    ),
    unique('meeting_search_candidate_rankings_mode_rank_uid').on(
      table.searchId,
      table.rankingMode,
      table.rank,
    ),
    foreignKey({
      columns: [table.searchId, table.destinationPlaceId],
      foreignColumns: [
        meetingSearchCandidates.searchId,
        meetingSearchCandidates.destinationPlaceId,
      ],
      name: 'meeting_search_candidate_rankings_candidate_fkey',
    }).onDelete('cascade'),
    check(
      'meeting_search_candidate_rankings_mode_chk',
      sql`${table.rankingMode} IN (${sql.raw(rankingModeSqlList)})`,
    ),
    check('meeting_search_candidate_rankings_rank_chk', sql`${table.rank} >= 1`),
    check(
      'meeting_search_candidate_rankings_duration_chk',
      sql`${table.totalDurationMinutes} >= 0 AND ${table.maxDurationMinutes} >= 0 AND ${table.durationRangeMinutes} >= 0`,
    ),
    check(
      'meeting_search_candidate_rankings_transfers_chk',
      sql`${table.totalTransfers} >= 0 AND ${table.maxTransfers} >= 0`,
    ),
    check('meeting_search_candidate_rankings_spread_chk', sql`${table.arrivalSpreadMs} >= 0`),
    check(
      'meeting_search_candidate_rankings_arrival_order_chk',
      sql`${table.latestArrivalAt} >= ${table.earliestArrivalAt}`,
    ),
  ],
);

/**
 * Selected journey for each participant of a ranked candidate under a ranking mode.
 */
export const meetingSearchCandidateRankingJourneys = pgTable(
  'meeting_search_candidate_ranking_journeys',
  {
    searchId: uuid('search_id').notNull(),
    rankingMode: text('ranking_mode').notNull(),
    destinationPlaceId: text('destination_place_id').notNull(),
    participantId: text('participant_id').notNull(),
    journeyId: uuid('journey_id')
      .notNull()
      .references(() => meetingSearchJourneys.id, { onDelete: 'restrict' }),
    rankingId: uuid('ranking_id')
      .notNull()
      .references(() => meetingSearchCandidateRankings.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({
      name: 'meeting_search_candidate_ranking_journeys_pk',
      columns: [table.searchId, table.rankingMode, table.destinationPlaceId, table.participantId],
    }),
    foreignKey({
      columns: [table.searchId, table.rankingMode, table.destinationPlaceId],
      foreignColumns: [
        meetingSearchCandidateRankings.searchId,
        meetingSearchCandidateRankings.rankingMode,
        meetingSearchCandidateRankings.destinationPlaceId,
      ],
      name: 'meeting_search_candidate_ranking_journeys_ranking_fkey',
    }).onDelete('cascade'),
    check(
      'meeting_search_candidate_ranking_journeys_mode_chk',
      sql`${table.rankingMode} IN (${sql.raw(rankingModeSqlList)})`,
    ),
    check(
      'meeting_search_candidate_ranking_journeys_participant_id_length_chk',
      sql`char_length(${table.participantId}) >= 1 AND char_length(${table.participantId}) <= ${sql.raw(String(PARTICIPANT_ID_MAX_LENGTH))}`,
    ),
  ],
);
