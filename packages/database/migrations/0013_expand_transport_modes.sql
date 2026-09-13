-- Expand meeting-search commute modes: suburban, coach, and flight.
-- Existing rows stay on train/bus/tram/metro/ferry.

ALTER TABLE "meeting_search_transport_modes" DROP CONSTRAINT "meeting_search_transport_modes_mode_chk";--> statement-breakpoint
ALTER TABLE "meeting_search_transport_modes" ADD CONSTRAINT "meeting_search_transport_modes_mode_chk" CHECK ("meeting_search_transport_modes"."mode" IN (
  'train',
  'suburban',
  'bus',
  'coach',
  'tram',
  'metro',
  'ferry',
  'flight'
));
