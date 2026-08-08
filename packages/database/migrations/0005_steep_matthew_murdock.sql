DO $$
DECLARE
	bad_count integer;
	bad_ids text;
BEGIN
	SELECT count(*)::int, coalesce(string_agg(id, ', ' ORDER BY id), '')
	INTO bad_count, bad_ids
	FROM places
	WHERE location IS NULL
		OR GeometryType(location) <> 'POINT'
		OR ST_IsEmpty(location)
		OR ST_X(location) IS NULL
		OR ST_Y(location) IS NULL
		OR ST_X(location) < -180
		OR ST_X(location) > 180
		OR ST_Y(location) < -90
		OR ST_Y(location) > 90
		OR ST_SRID(location) <> 4326
		OR ST_X(location) <> ST_X(location)
		OR ST_Y(location) <> ST_Y(location);
	IF bad_count > 0 THEN
		RAISE EXCEPTION
			'places.location has % invalid row(s); refusing places geo constraints. ids=%',
			bad_count,
			bad_ids;
	END IF;
END $$;--> statement-breakpoint
ALTER TABLE "places" ADD CONSTRAINT "places_location_point_chk" CHECK (GeometryType("location") = 'POINT');--> statement-breakpoint
ALTER TABLE "places" ADD CONSTRAINT "places_location_not_empty_chk" CHECK (NOT ST_IsEmpty("location"));--> statement-breakpoint
ALTER TABLE "places" ADD CONSTRAINT "places_location_longitude_chk" CHECK (ST_X("location") >= -180 AND ST_X("location") <= 180);--> statement-breakpoint
ALTER TABLE "places" ADD CONSTRAINT "places_location_latitude_chk" CHECK (ST_Y("location") >= -90 AND ST_Y("location") <= 90);
