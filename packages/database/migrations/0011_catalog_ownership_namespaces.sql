-- Extend place ownership for fixture vs production catalog namespaces.

ALTER TABLE "places" DROP CONSTRAINT "places_ownership_chk";--> statement-breakpoint
ALTER TABLE "places" ADD CONSTRAINT "places_ownership_chk" CHECK ("ownership" IN (
  'manual',
  'catalog:bootstrap',
  'catalog:geonames',
  'catalog:hub',
  'catalog:transitous',
  'fixture:offline-europe-v1',
  'provider:motis'
));
