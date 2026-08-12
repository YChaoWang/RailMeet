-- Meeting-city eligibility fields for production candidate filtering.
-- GeoNames population + feature_code are source-owned; used by meeting-city-v2 policy.

ALTER TABLE "places" ADD COLUMN "population" integer;--> statement-breakpoint
ALTER TABLE "places" ADD COLUMN "feature_code" text;--> statement-breakpoint
ALTER TABLE "places" ADD CONSTRAINT "places_population_chk" CHECK ("population" IS NULL OR "population" >= 0);--> statement-breakpoint
CREATE INDEX "places_feature_code_idx" ON "places" ("feature_code") WHERE "feature_code" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "places_population_idx" ON "places" ("population") WHERE "population" IS NOT NULL;
