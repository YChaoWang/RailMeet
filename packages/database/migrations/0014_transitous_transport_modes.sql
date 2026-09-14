-- Match Transitous planner filters. Keep train/metro/flight for existing rows.

ALTER TABLE "meeting_search_transport_modes" DROP CONSTRAINT "meeting_search_transport_modes_mode_chk";--> statement-breakpoint
ALTER TABLE "meeting_search_transport_modes" ADD CONSTRAINT "meeting_search_transport_modes_mode_chk" CHECK ("meeting_search_transport_modes"."mode" IN (
  'airplane',
  'highspeed_rail',
  'long_distance',
  'night_rail',
  'coach',
  'ride_sharing',
  'regional_rail',
  'suburban',
  'subway',
  'tram',
  'bus',
  'ferry',
  'odm',
  'funicular',
  'aerial_lift',
  'other',
  'train',
  'metro',
  'flight'
));
