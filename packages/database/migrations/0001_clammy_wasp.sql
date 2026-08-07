CREATE TABLE "outbox_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_type" text NOT NULL,
	"aggregate_type" text NOT NULL,
	"aggregate_id" uuid NOT NULL,
	"schema_version" integer NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	CONSTRAINT "outbox_events_aggregate_event_uid" UNIQUE("aggregate_type","aggregate_id","event_type"),
	CONSTRAINT "outbox_events_event_type_chk" CHECK ("outbox_events"."event_type" IN ('meeting-search.requested')),
	CONSTRAINT "outbox_events_aggregate_type_chk" CHECK ("outbox_events"."aggregate_type" IN ('meeting-search')),
	CONSTRAINT "outbox_events_schema_version_chk" CHECK ("outbox_events"."schema_version" >= 1 AND (
        "outbox_events"."event_type" <> 'meeting-search.requested'
        OR "outbox_events"."schema_version" = 1
      )),
	CONSTRAINT "outbox_events_meeting_search_payload_chk" CHECK ((
        "outbox_events"."event_type" <> 'meeting-search.requested'
        OR (
          "outbox_events"."aggregate_type" = 'meeting-search'
          AND "outbox_events"."payload" = jsonb_build_object('searchId', "outbox_events"."aggregate_id"::text)
        )
      ))
);
--> statement-breakpoint
ALTER TABLE "outbox_events" ADD CONSTRAINT "outbox_events_aggregate_id_meeting_searches_id_fk" FOREIGN KEY ("aggregate_id") REFERENCES "public"."meeting_searches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "outbox_events_unpublished_created_at_idx" ON "outbox_events" USING btree ("created_at") WHERE "outbox_events"."published_at" IS NULL;