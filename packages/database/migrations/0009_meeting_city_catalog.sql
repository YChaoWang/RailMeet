-- Phase 9 catalog readiness: ownership/active on places, city↔hub associations,
-- and per-candidate routing targets. Preserves 0008 bootstrap cities (immutable).

ALTER TABLE "places" ADD COLUMN "ownership" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "places" ADD COLUMN "source_version" text;--> statement-breakpoint
ALTER TABLE "places" ADD COLUMN "normalized_name" text;--> statement-breakpoint
ALTER TABLE "places" ADD COLUMN "active" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "places" ADD CONSTRAINT "places_ownership_chk" CHECK ("ownership" IN ('manual', 'catalog:bootstrap', 'catalog:geonames', 'catalog:hub', 'provider:motis'));--> statement-breakpoint

UPDATE "places"
SET
  "ownership" = 'catalog:bootstrap',
  "normalized_name" = lower(trim("name")),
  "source_version" = 'bootstrap:0008'
WHERE "provider" = 'railmeet-catalog';--> statement-breakpoint

UPDATE "places"
SET
  "ownership" = 'provider:motis',
  "normalized_name" = lower(trim("name"))
WHERE "provider" = 'motis';--> statement-breakpoint

UPDATE "places"
SET "normalized_name" = lower(trim("name"))
WHERE "normalized_name" IS NULL;--> statement-breakpoint

CREATE INDEX "places_active_kind_gix" ON "places" USING gist ("location") WHERE "active" = true AND "kind" = 'city';--> statement-breakpoint
CREATE INDEX "places_ownership_active_idx" ON "places" ("ownership", "active");--> statement-breakpoint

CREATE TABLE "meeting_city_hubs" (
  "city_place_id" text NOT NULL,
  "hub_place_id" text NOT NULL,
  "priority" integer NOT NULL,
  "match_method" text NOT NULL,
  "source" text NOT NULL,
  "source_version" text,
  "regional" boolean DEFAULT false NOT NULL,
  "distance_meters" double precision,
  "active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "meeting_city_hubs_pk" PRIMARY KEY ("city_place_id", "hub_place_id"),
  CONSTRAINT "meeting_city_hubs_city_place_id_places_id_fk" FOREIGN KEY ("city_place_id") REFERENCES "places"("id") ON DELETE restrict,
  CONSTRAINT "meeting_city_hubs_hub_place_id_places_id_fk" FOREIGN KEY ("hub_place_id") REFERENCES "places"("id") ON DELETE restrict,
  CONSTRAINT "meeting_city_hubs_priority_chk" CHECK ("priority" >= 0),
  CONSTRAINT "meeting_city_hubs_distance_chk" CHECK ("distance_meters" IS NULL OR "distance_meters" >= 0),
  CONSTRAINT "meeting_city_hubs_city_ne_hub_chk" CHECK ("city_place_id" <> "hub_place_id")
);--> statement-breakpoint

CREATE UNIQUE INDEX "meeting_city_hubs_city_priority_uid"
  ON "meeting_city_hubs" ("city_place_id", "priority")
  WHERE "active" = true;--> statement-breakpoint

CREATE INDEX "meeting_city_hubs_hub_idx" ON "meeting_city_hubs" ("hub_place_id");--> statement-breakpoint

ALTER TABLE "meeting_search_candidates" ADD COLUMN "routing_hub_place_id" text;--> statement-breakpoint
ALTER TABLE "meeting_search_candidates" ADD COLUMN "routing_target_reason" text;--> statement-breakpoint
ALTER TABLE "meeting_search_candidates" ADD CONSTRAINT "meeting_search_candidates_routing_hub_place_id_places_id_fk" FOREIGN KEY ("routing_hub_place_id") REFERENCES "places"("id") ON DELETE restrict;--> statement-breakpoint
ALTER TABLE "meeting_search_candidates" ADD CONSTRAINT "meeting_search_candidates_routing_target_reason_chk" CHECK (
  ("routing_target_reason" IS NULL AND "routing_hub_place_id" IS NULL)
  OR ("routing_target_reason" IN ('hub', 'centroid_fallback') AND (
    ("routing_target_reason" = 'hub' AND "routing_hub_place_id" IS NOT NULL)
    OR ("routing_target_reason" = 'centroid_fallback')
  ))
);--> statement-breakpoint

CREATE TABLE "catalog_import_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "source" text NOT NULL,
  "source_version" text NOT NULL,
  "checksum" text,
  "status" text NOT NULL,
  "city_count" integer DEFAULT 0 NOT NULL,
  "hub_count" integer DEFAULT 0 NOT NULL,
  "association_count" integer DEFAULT 0 NOT NULL,
  "rejected_count" integer DEFAULT 0 NOT NULL,
  "deactivated_count" integer DEFAULT 0 NOT NULL,
  "diagnostics" jsonb,
  "started_at" timestamp with time zone DEFAULT now() NOT NULL,
  "completed_at" timestamp with time zone,
  CONSTRAINT "catalog_import_runs_status_chk" CHECK ("status" IN ('succeeded', 'failed'))
);
