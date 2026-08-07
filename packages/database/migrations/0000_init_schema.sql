CREATE EXTENSION IF NOT EXISTS postgis;
--> statement-breakpoint
CREATE TABLE "meeting_search_allowed_countries" (
	"meeting_search_id" uuid NOT NULL,
	"country_code" text NOT NULL,
	CONSTRAINT "meeting_search_allowed_countries_pk" PRIMARY KEY("meeting_search_id","country_code"),
	CONSTRAINT "meeting_search_allowed_countries_code_chk" CHECK ("meeting_search_allowed_countries"."country_code" ~ '^[A-Z]{2}$')
);
--> statement-breakpoint
CREATE TABLE "meeting_search_participants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"meeting_search_id" uuid NOT NULL,
	"participant_id" text NOT NULL,
	"display_name" text NOT NULL,
	"origin_place_id" text NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "meeting_search_participants_search_participant_uid" UNIQUE("meeting_search_id","participant_id"),
	CONSTRAINT "meeting_search_participants_search_position_uid" UNIQUE("meeting_search_id","position"),
	CONSTRAINT "meeting_search_participants_participant_id_length_chk" CHECK (char_length("meeting_search_participants"."participant_id") >= 1 AND char_length("meeting_search_participants"."participant_id") <= 64),
	CONSTRAINT "meeting_search_participants_display_name_length_chk" CHECK (char_length("meeting_search_participants"."display_name") >= 1 AND char_length("meeting_search_participants"."display_name") <= 80),
	CONSTRAINT "meeting_search_participants_position_chk" CHECK ("meeting_search_participants"."position" >= 0)
);
--> statement-breakpoint
CREATE TABLE "meeting_search_transport_modes" (
	"meeting_search_id" uuid NOT NULL,
	"mode" text NOT NULL,
	CONSTRAINT "meeting_search_transport_modes_pk" PRIMARY KEY("meeting_search_id","mode"),
	CONSTRAINT "meeting_search_transport_modes_mode_chk" CHECK ("meeting_search_transport_modes"."mode" IN ('train', 'bus', 'tram', 'metro', 'ferry'))
);
--> statement-breakpoint
CREATE TABLE "meeting_searches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"travel_date" date NOT NULL,
	"earliest_departure_time" time NOT NULL,
	"latest_arrival_time" time NOT NULL,
	"arrival_day_offset" smallint DEFAULT 0 NOT NULL,
	"max_journey_duration_minutes" integer NOT NULL,
	"max_transfers" integer NOT NULL,
	"min_transfer_duration_minutes" integer NOT NULL,
	"ranking_mode" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "meeting_searches_status_chk" CHECK ("meeting_searches"."status" IN ('queued', 'running', 'partially-completed', 'completed', 'failed', 'cancelling', 'cancelled')),
	CONSTRAINT "meeting_searches_ranking_mode_chk" CHECK ("meeting_searches"."ranking_mode" IN ('fairest', 'fastest-overall', 'fewest-transfers', 'arrive-together')),
	CONSTRAINT "meeting_searches_arrival_day_offset_chk" CHECK ("meeting_searches"."arrival_day_offset" >= 0 AND "meeting_searches"."arrival_day_offset" <= 1),
	CONSTRAINT "meeting_searches_max_journey_duration_chk" CHECK ("meeting_searches"."max_journey_duration_minutes" >= 1 AND "meeting_searches"."max_journey_duration_minutes" <= 1440),
	CONSTRAINT "meeting_searches_max_transfers_chk" CHECK ("meeting_searches"."max_transfers" >= 0 AND "meeting_searches"."max_transfers" <= 5),
	CONSTRAINT "meeting_searches_min_transfer_duration_chk" CHECK ("meeting_searches"."min_transfer_duration_minutes" >= 1 AND "meeting_searches"."min_transfer_duration_minutes" <= 120)
);
--> statement-breakpoint
CREATE TABLE "places" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"country_code" text NOT NULL,
	"timezone" text NOT NULL,
	"location" geometry(Point, 4326) NOT NULL,
	"parent_city_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "places_id_length_chk" CHECK (char_length("places"."id") >= 1 AND char_length("places"."id") <= 128),
	CONSTRAINT "places_name_length_chk" CHECK (char_length("places"."name") >= 1 AND char_length("places"."name") <= 200),
	CONSTRAINT "places_kind_chk" CHECK ("places"."kind" IN ('city', 'station')),
	CONSTRAINT "places_country_code_chk" CHECK ("places"."country_code" ~ '^[A-Z]{2}$'),
	CONSTRAINT "places_timezone_length_chk" CHECK (char_length("places"."timezone") >= 1 AND char_length("places"."timezone") <= 64),
	CONSTRAINT "places_location_srid_chk" CHECK (ST_SRID("location") = 4326)
);
--> statement-breakpoint
ALTER TABLE "meeting_search_allowed_countries" ADD CONSTRAINT "meeting_search_allowed_countries_meeting_search_id_meeting_searches_id_fk" FOREIGN KEY ("meeting_search_id") REFERENCES "public"."meeting_searches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_search_participants" ADD CONSTRAINT "meeting_search_participants_meeting_search_id_meeting_searches_id_fk" FOREIGN KEY ("meeting_search_id") REFERENCES "public"."meeting_searches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_search_participants" ADD CONSTRAINT "meeting_search_participants_origin_place_id_places_id_fk" FOREIGN KEY ("origin_place_id") REFERENCES "public"."places"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_search_transport_modes" ADD CONSTRAINT "meeting_search_transport_modes_meeting_search_id_meeting_searches_id_fk" FOREIGN KEY ("meeting_search_id") REFERENCES "public"."meeting_searches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "places" ADD CONSTRAINT "places_parent_city_id_fkey" FOREIGN KEY ("parent_city_id") REFERENCES "public"."places"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "places_location_gix" ON "places" USING gist ("location");