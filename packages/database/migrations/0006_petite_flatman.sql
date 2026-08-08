CREATE TABLE "meeting_search_candidate_evaluations" (
	"search_id" uuid NOT NULL,
	"destination_place_id" text NOT NULL,
	"feasibility" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "meeting_search_candidate_evaluations_pk" PRIMARY KEY("search_id","destination_place_id"),
	CONSTRAINT "meeting_search_candidate_evaluations_feasibility_chk" CHECK ("meeting_search_candidate_evaluations"."feasibility" IN ('feasible', 'participant_no_journeys', 'routing_incomplete', 'technical_failure', 'invariant_violation'))
);
--> statement-breakpoint
CREATE TABLE "meeting_search_candidate_ranking_journeys" (
	"search_id" uuid NOT NULL,
	"ranking_mode" text NOT NULL,
	"destination_place_id" text NOT NULL,
	"participant_id" text NOT NULL,
	"journey_id" uuid NOT NULL,
	"ranking_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "meeting_search_candidate_ranking_journeys_pk" PRIMARY KEY("search_id","ranking_mode","destination_place_id","participant_id"),
	CONSTRAINT "meeting_search_candidate_ranking_journeys_mode_chk" CHECK ("meeting_search_candidate_ranking_journeys"."ranking_mode" IN ('fairest', 'fastest-overall', 'fewest-transfers', 'arrive-together')),
	CONSTRAINT "meeting_search_candidate_ranking_journeys_participant_id_length_chk" CHECK (char_length("meeting_search_candidate_ranking_journeys"."participant_id") >= 1 AND char_length("meeting_search_candidate_ranking_journeys"."participant_id") <= 64)
);
--> statement-breakpoint
CREATE TABLE "meeting_search_candidate_rankings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"search_id" uuid NOT NULL,
	"ranking_mode" text NOT NULL,
	"destination_place_id" text NOT NULL,
	"rank" integer NOT NULL,
	"total_duration_minutes" integer NOT NULL,
	"max_duration_minutes" integer NOT NULL,
	"duration_range_minutes" integer NOT NULL,
	"total_transfers" integer NOT NULL,
	"max_transfers" integer NOT NULL,
	"earliest_arrival_at" timestamp with time zone NOT NULL,
	"latest_arrival_at" timestamp with time zone NOT NULL,
	"arrival_spread_ms" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "meeting_search_candidate_rankings_mode_candidate_uid" UNIQUE("search_id","ranking_mode","destination_place_id"),
	CONSTRAINT "meeting_search_candidate_rankings_mode_rank_uid" UNIQUE("search_id","ranking_mode","rank"),
	CONSTRAINT "meeting_search_candidate_rankings_mode_chk" CHECK ("meeting_search_candidate_rankings"."ranking_mode" IN ('fairest', 'fastest-overall', 'fewest-transfers', 'arrive-together')),
	CONSTRAINT "meeting_search_candidate_rankings_rank_chk" CHECK ("meeting_search_candidate_rankings"."rank" >= 1),
	CONSTRAINT "meeting_search_candidate_rankings_duration_chk" CHECK ("meeting_search_candidate_rankings"."total_duration_minutes" >= 0 AND "meeting_search_candidate_rankings"."max_duration_minutes" >= 0 AND "meeting_search_candidate_rankings"."duration_range_minutes" >= 0),
	CONSTRAINT "meeting_search_candidate_rankings_transfers_chk" CHECK ("meeting_search_candidate_rankings"."total_transfers" >= 0 AND "meeting_search_candidate_rankings"."max_transfers" >= 0),
	CONSTRAINT "meeting_search_candidate_rankings_spread_chk" CHECK ("meeting_search_candidate_rankings"."arrival_spread_ms" >= 0),
	CONSTRAINT "meeting_search_candidate_rankings_arrival_order_chk" CHECK ("meeting_search_candidate_rankings"."latest_arrival_at" >= "meeting_search_candidate_rankings"."earliest_arrival_at")
);
--> statement-breakpoint
ALTER TABLE "outbox_events" DROP CONSTRAINT "outbox_events_event_type_chk";--> statement-breakpoint
ALTER TABLE "outbox_events" DROP CONSTRAINT "outbox_events_schema_version_chk";--> statement-breakpoint
ALTER TABLE "outbox_events" DROP CONSTRAINT "outbox_events_meeting_search_payload_chk";--> statement-breakpoint
ALTER TABLE "meeting_searches" ADD COLUMN "completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "meeting_searches" ADD COLUMN "failed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "meeting_searches" ADD COLUMN "completion_outcome" text;--> statement-breakpoint
ALTER TABLE "meeting_searches" ADD COLUMN "failure_code" text;--> statement-breakpoint
ALTER TABLE "meeting_searches" ADD COLUMN "recommended_destination_place_id" text;--> statement-breakpoint
ALTER TABLE "meeting_search_candidate_evaluations" ADD CONSTRAINT "meeting_search_candidate_evaluations_candidate_fkey" FOREIGN KEY ("search_id","destination_place_id") REFERENCES "public"."meeting_search_candidates"("search_id","destination_place_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_search_candidate_ranking_journeys" ADD CONSTRAINT "meeting_search_candidate_ranking_journeys_journey_id_meeting_search_journeys_id_fk" FOREIGN KEY ("journey_id") REFERENCES "public"."meeting_search_journeys"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_search_candidate_ranking_journeys" ADD CONSTRAINT "meeting_search_candidate_ranking_journeys_ranking_id_meeting_search_candidate_rankings_id_fk" FOREIGN KEY ("ranking_id") REFERENCES "public"."meeting_search_candidate_rankings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_search_candidate_ranking_journeys" ADD CONSTRAINT "meeting_search_candidate_ranking_journeys_ranking_fkey" FOREIGN KEY ("search_id","ranking_mode","destination_place_id") REFERENCES "public"."meeting_search_candidate_rankings"("search_id","ranking_mode","destination_place_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_search_candidate_rankings" ADD CONSTRAINT "meeting_search_candidate_rankings_search_id_meeting_searches_id_fk" FOREIGN KEY ("search_id") REFERENCES "public"."meeting_searches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_search_candidate_rankings" ADD CONSTRAINT "meeting_search_candidate_rankings_candidate_fkey" FOREIGN KEY ("search_id","destination_place_id") REFERENCES "public"."meeting_search_candidates"("search_id","destination_place_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_searches" ADD CONSTRAINT "meeting_searches_recommended_destination_place_id_fkey" FOREIGN KEY ("recommended_destination_place_id") REFERENCES "public"."places"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_searches" ADD CONSTRAINT "meeting_searches_completion_outcome_chk" CHECK ("meeting_searches"."completion_outcome" IS NULL OR "meeting_searches"."completion_outcome" IN ('no_candidates', 'ranked', 'no_feasible_candidates'));--> statement-breakpoint
ALTER TABLE "meeting_searches" ADD CONSTRAINT "meeting_searches_completion_pairing_chk" CHECK ((
        (
          "meeting_searches"."status" = 'completed'
          AND "meeting_searches"."completion_outcome" IS NOT NULL
          AND "meeting_searches"."failed_at" IS NULL
          AND "meeting_searches"."failure_code" IS NULL
          AND (
            ("meeting_searches"."completion_outcome" = 'ranked' AND "meeting_searches"."recommended_destination_place_id" IS NOT NULL)
            OR ("meeting_searches"."completion_outcome" <> 'ranked' AND "meeting_searches"."recommended_destination_place_id" IS NULL)
          )
        )
        OR (
          "meeting_searches"."status" = 'failed'
          AND "meeting_searches"."failure_code" IS NOT NULL
          AND "meeting_searches"."completion_outcome" IS NULL
          AND "meeting_searches"."completed_at" IS NULL
          AND "meeting_searches"."recommended_destination_place_id" IS NULL
        )
        OR (
          "meeting_searches"."status" NOT IN ('completed', 'failed')
          AND "meeting_searches"."completion_outcome" IS NULL
          AND "meeting_searches"."failure_code" IS NULL
          AND "meeting_searches"."completed_at" IS NULL
          AND "meeting_searches"."failed_at" IS NULL
          AND "meeting_searches"."recommended_destination_place_id" IS NULL
        )
      ));--> statement-breakpoint
ALTER TABLE "outbox_events" ADD CONSTRAINT "outbox_events_event_type_chk" CHECK ("outbox_events"."event_type" IN ('meeting-search.requested', 'meeting-search.candidates-requested', 'routing.requested', 'meeting-search.finalization-requested'));--> statement-breakpoint
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
        ) OR (
          "outbox_events"."event_type" = 'meeting-search.finalization-requested'
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
        ) OR (
          "outbox_events"."event_type" = 'meeting-search.finalization-requested'
          AND "outbox_events"."aggregate_type" = 'meeting-search'
          AND "outbox_events"."payload" = jsonb_build_object('searchId', "outbox_events"."aggregate_id"::text)
          AND (
            "outbox_events"."dedupe_key" LIKE 'candidate-generation:%'
            OR "outbox_events"."dedupe_key" LIKE 'routing-work:%'
          )
        )
      ));