ALTER TABLE "places" ADD COLUMN "provider" text;--> statement-breakpoint
ALTER TABLE "places" ADD COLUMN "provider_place_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "places_provider_place_uid" ON "places" USING btree ("provider","provider_place_id") WHERE "places"."provider" IS NOT NULL AND "places"."provider_place_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "places" ADD CONSTRAINT "places_provider_pair_chk" CHECK (("places"."provider" IS NULL AND "places"."provider_place_id" IS NULL) OR ("places"."provider" IS NOT NULL AND "places"."provider_place_id" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "places" ADD CONSTRAINT "places_provider_place_id_length_chk" CHECK ("places"."provider_place_id" IS NULL OR (char_length("places"."provider_place_id") >= 1 AND char_length("places"."provider_place_id") <= 512));
