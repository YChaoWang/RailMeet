ALTER TABLE "outbox_events" ADD COLUMN "failure_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "outbox_events" ADD COLUMN "next_attempt_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "outbox_events" ADD COLUMN "lease_token" uuid;--> statement-breakpoint
ALTER TABLE "outbox_events" ADD COLUMN "leased_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "outbox_events" ADD COLUMN "last_error_code" text;--> statement-breakpoint
ALTER TABLE "outbox_events" ADD COLUMN "dead_lettered_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "outbox_events_due_claim_idx" ON "outbox_events" USING btree ("created_at","id") WHERE "outbox_events"."published_at" IS NULL AND "outbox_events"."dead_lettered_at" IS NULL;--> statement-breakpoint
ALTER TABLE "outbox_events" ADD CONSTRAINT "outbox_events_failure_count_chk" CHECK ("outbox_events"."failure_count" >= 0);--> statement-breakpoint
ALTER TABLE "outbox_events" ADD CONSTRAINT "outbox_events_lease_pair_chk" CHECK ((
        ("outbox_events"."lease_token" IS NULL AND "outbox_events"."leased_until" IS NULL)
        OR ("outbox_events"."lease_token" IS NOT NULL AND "outbox_events"."leased_until" IS NOT NULL)
      ));