CREATE TABLE "meeting_search_candidate_generations" (
	"search_id" uuid PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "meeting_search_candidate_generations_status_chk" CHECK ("meeting_search_candidate_generations"."status" IN ('pending', 'running', 'succeeded', 'failed_permanent'))
);
--> statement-breakpoint
CREATE TABLE "meeting_search_candidates" (
	"search_id" uuid NOT NULL,
	"destination_place_id" text NOT NULL,
	"ordinal" integer NOT NULL,
	"distance_meters" double precision NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "meeting_search_candidates_pk" PRIMARY KEY("search_id","destination_place_id"),
	CONSTRAINT "meeting_search_candidates_search_ordinal_uid" UNIQUE("search_id","ordinal"),
	CONSTRAINT "meeting_search_candidates_ordinal_chk" CHECK ("meeting_search_candidates"."ordinal" >= 0),
	CONSTRAINT "meeting_search_candidates_distance_chk" CHECK ("meeting_search_candidates"."distance_meters" >= 0)
);
--> statement-breakpoint
CREATE TABLE "meeting_search_journeys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"routing_work_id" uuid NOT NULL,
	"journey_ordinal" integer NOT NULL,
	"departure_at" timestamp with time zone NOT NULL,
	"arrival_at" timestamp with time zone NOT NULL,
	"duration_minutes" integer NOT NULL,
	"transfers" integer NOT NULL,
	"transport_modes" text[] NOT NULL,
	"legs" jsonb NOT NULL,
	"provider_reference" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "meeting_search_journeys_work_ordinal_uid" UNIQUE("routing_work_id","journey_ordinal"),
	CONSTRAINT "meeting_search_journeys_ordinal_chk" CHECK ("meeting_search_journeys"."journey_ordinal" >= 0),
	CONSTRAINT "meeting_search_journeys_duration_chk" CHECK ("meeting_search_journeys"."duration_minutes" >= 0),
	CONSTRAINT "meeting_search_journeys_transfers_chk" CHECK ("meeting_search_journeys"."transfers" >= 0),
	CONSTRAINT "meeting_search_journeys_arrival_after_departure_chk" CHECK ("meeting_search_journeys"."arrival_at" >= "meeting_search_journeys"."departure_at")
);
--> statement-breakpoint
CREATE TABLE "meeting_search_routing_work" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"search_id" uuid NOT NULL,
	"participant_id" text NOT NULL,
	"destination_place_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "meeting_search_routing_work_logical_uid" UNIQUE("search_id","participant_id","destination_place_id"),
	CONSTRAINT "meeting_search_routing_work_status_chk" CHECK ("meeting_search_routing_work"."status" IN ('pending', 'running', 'succeeded', 'no_journeys', 'exhausted')),
	CONSTRAINT "meeting_search_routing_work_participant_id_length_chk" CHECK (char_length("meeting_search_routing_work"."participant_id") >= 1 AND char_length("meeting_search_routing_work"."participant_id") <= 64)
);
--> statement-breakpoint
ALTER TABLE "outbox_events" DROP CONSTRAINT "outbox_events_aggregate_event_uid";--> statement-breakpoint
ALTER TABLE "outbox_events" DROP CONSTRAINT "outbox_events_event_type_chk";--> statement-breakpoint
ALTER TABLE "outbox_events" DROP CONSTRAINT "outbox_events_schema_version_chk";--> statement-breakpoint
ALTER TABLE "outbox_events" DROP CONSTRAINT "outbox_events_meeting_search_payload_chk";--> statement-breakpoint
ALTER TABLE "outbox_events" ADD COLUMN "dedupe_key" text DEFAULT 'default' NOT NULL;--> statement-breakpoint
ALTER TABLE "meeting_search_candidate_generations" ADD CONSTRAINT "meeting_search_candidate_generations_search_id_meeting_searches_id_fk" FOREIGN KEY ("search_id") REFERENCES "public"."meeting_searches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_search_candidates" ADD CONSTRAINT "meeting_search_candidates_search_id_meeting_searches_id_fk" FOREIGN KEY ("search_id") REFERENCES "public"."meeting_searches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_search_candidates" ADD CONSTRAINT "meeting_search_candidates_destination_place_id_places_id_fk" FOREIGN KEY ("destination_place_id") REFERENCES "public"."places"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_search_journeys" ADD CONSTRAINT "meeting_search_journeys_routing_work_id_meeting_search_routing_work_id_fk" FOREIGN KEY ("routing_work_id") REFERENCES "public"."meeting_search_routing_work"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_search_routing_work" ADD CONSTRAINT "meeting_search_routing_work_search_id_meeting_searches_id_fk" FOREIGN KEY ("search_id") REFERENCES "public"."meeting_searches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_search_routing_work" ADD CONSTRAINT "meeting_search_routing_work_candidate_fkey" FOREIGN KEY ("search_id","destination_place_id") REFERENCES "public"."meeting_search_candidates"("search_id","destination_place_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "meeting_search_routing_work_search_status_idx" ON "meeting_search_routing_work" USING btree ("search_id","status");--> statement-breakpoint
ALTER TABLE "outbox_events" ADD CONSTRAINT "outbox_events_aggregate_event_dedupe_uid" UNIQUE("aggregate_type","aggregate_id","event_type","dedupe_key");--> statement-breakpoint
ALTER TABLE "outbox_events" ADD CONSTRAINT "outbox_events_event_type_chk" CHECK ("outbox_events"."event_type" IN ('meeting-search.requested', 'meeting-search.candidates-requested', 'routing.requested'));--> statement-breakpoint
ALTER TABLE "outbox_events" ADD CONSTRAINT "outbox_events_schema_version_chk" CHECK ("outbox_events"."schema_version" >= 1 AND (
        (
          "outbox_events"."event_type" = 'meeting-search.requested'
          AND "outbox_events"."schema_version" = 1
        ) OR (
          "outbox_events"."event_type" = 'meeting-search.candidates-requested'
          AND "outbox_events"."schema_version" = 1
        ) OR (
          "outbox_events"."event_type" = 'routing.requested'
          AND "outbox_events"."schema_version" = 1
        )
      ));--> statement-breakpoint
ALTER TABLE "outbox_events" ADD CONSTRAINT "outbox_events_meeting_search_payload_chk" CHECK ((
        (
          "outbox_events"."event_type" = 'meeting-search.requested'
          AND "outbox_events"."aggregate_type" = 'meeting-search'
          AND "outbox_events"."dedupe_key" = 'default'
          AND "outbox_events"."payload" = jsonb_build_object('searchId', "outbox_events"."aggregate_id"::text)
        ) OR (
          "outbox_events"."event_type" = 'meeting-search.candidates-requested'
          AND "outbox_events"."aggregate_type" = 'meeting-search'
          AND "outbox_events"."dedupe_key" = 'default'
          AND "outbox_events"."payload" = jsonb_build_object('searchId', "outbox_events"."aggregate_id"::text)
        ) OR (
          "outbox_events"."event_type" = 'routing.requested'
          AND "outbox_events"."aggregate_type" = 'meeting-search'
          AND "outbox_events"."dedupe_key" = ("outbox_events"."payload"->>'routingWorkId')
          AND ("outbox_events"."payload"->>'searchId') = "outbox_events"."aggregate_id"::text
          AND ("outbox_events"."payload"->>'routingWorkId') IS NOT NULL
        )
      ));