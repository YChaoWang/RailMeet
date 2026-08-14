/**
 * Sanitized Transitous MOTIS v5 `/api/v5/plan` itinerary captured 2026-08-13
 * for Berlin Hbf → München Hbf (future timetable date 2026-09-15).
 *
 * Confirmed field mapping against motis@2.10.2:
 * - ICE service identity → `displayName` / `tripShortName` ("ICE 1007")
 * - operator → `agencyName` ("DB Fernverkehr AG"), not inferred from DE/Berlin
 * - rail subtype → `mode` ("HIGHSPEED_RAIL")
 * - destination → `headsign` ("München Hbf")
 * - platforms → Place.`track`
 *
 * Geometry and feed `source`/`tripId` truncated; agency and service strings
 * are unchanged from the provider response.
 */
export const TRANSITOUS_BERLIN_MUNICH_ICE_PLAN = {
  itineraries: [
    {
      duration: 15180,
      startTime: '2026-09-15T08:37:00Z',
      endTime: '2026-09-15T12:50:00Z',
      transfers: 0,
      legs: [
        {
          mode: 'WALK',
          startTime: '2026-09-15T08:37:00Z',
          endTime: '2026-09-15T08:37:00Z',
          duration: 0,
          distance: 0,
          from: { name: 'START', lat: 52.525589, lon: 13.369548 },
          to: { name: 'S+U Berlin Hauptbahnhof', lat: 52.525589, lon: 13.369548 },
        },
        {
          mode: 'HIGHSPEED_RAIL',
          startTime: '2026-09-15T08:47:00Z',
          endTime: '2026-09-15T12:39:00Z',
          duration: 13920,
          headsign: 'München Hbf',
          agencyName: 'DB Fernverkehr AG',
          agencyId: '12681',
          agencyUrl: '',
          routeShortName: '29',
          routeLongName: '',
          tripShortName: 'ICE 1007',
          displayName: 'ICE 1007',
          from: { name: 'S+U Berlin Hauptbahnhof', lat: 52.525, lon: 13.369 },
          to: { name: 'München Hbf', lat: 48.1402, lon: 11.5583, track: '22', scheduledTrack: '22' },
          intermediateStops: [{ name: 'Erfurt Hbf' }, { name: 'Bamberg' }, { name: 'Nürnberg Hbf' }, { name: 'Ingolstadt Hbf' }, { name: 'München-Pasing' }],
        },
        {
          mode: 'WALK',
          startTime: '2026-09-15T12:39:00Z',
          endTime: '2026-09-15T12:50:00Z',
          duration: 660,
          distance: 173,
          from: { name: 'München Hbf', track: '22', scheduledTrack: '22', lat: 48.1402, lon: 11.5583 },
          to: { name: 'END', lat: 48.140228, lon: 11.558338 },
        },
      ],
    },
  ],
} as const;

/**
 * Sanitized mixed German itinerary: S-Bahn Berlin + ODEG regional rail.
 * Demonstrates that a German train is not labeled Deutsche Bahn when the
 * provider agency is a regional operator.
 */
export const TRANSITOUS_BERLIN_MAGDEBURG_ODEG_PLAN = {
  itineraries: [
    {
      duration: 10800,
      startTime: '2026-09-15T08:00:00Z',
      endTime: '2026-09-15T11:00:00Z',
      transfers: 1,
      legs: [
        {
          mode: 'SUBURBAN',
          startTime: '2026-09-15T08:04:00Z',
          endTime: '2026-09-15T08:22:00Z',
          duration: 1080,
          headsign: 'S Spandau Bhf (Berlin)',
          agencyName: 'S-Bahn Berlin GmbH',
          agencyId: '1',
          routeShortName: 'S3',
          tripShortName: '3084',
          displayName: 'S3',
          from: { name: 'S+U Berlin Hauptbahnhof', track: '16', lat: 52.525, lon: 13.369 },
          to: { name: 'S Charlottenburg Bhf (Berlin)', track: '8', lat: 52.5048, lon: 13.3038 },
          intermediateStops: [{ name: 'S Bellevue' }, { name: 'S Tiergarten' }, { name: 'S Zoologischer Garten' }, { name: 'S Savignyplatz' }],
        },
        {
          mode: 'WALK',
          startTime: '2026-09-15T08:22:00Z',
          endTime: '2026-09-15T08:27:00Z',
          duration: 300,
          distance: 80,
          from: { name: 'S Charlottenburg Bhf (Berlin)', track: '8' },
          to: { name: 'S Charlottenburg Bhf (Berlin)', track: '4' },
        },
        {
          mode: 'REGIONAL_RAIL',
          startTime: '2026-09-15T08:32:00Z',
          endTime: '2026-09-15T10:55:00Z',
          duration: 8580,
          headsign: 'Hauptbahnhof',
          agencyName: 'ODEG Ostdeutsche Eisenbahn GmbH',
          agencyId: '731',
          routeShortName: 'RE1',
          tripShortName: '73728',
          displayName: 'RE1',
          from: { name: 'S Charlottenburg Bhf (Berlin)', track: '4', lat: 52.5048, lon: 13.3038 },
          to: { name: 'Magdeburg, Hauptbahnhof', lat: 52.1307, lon: 11.6269 },
          intermediateStops: Array.from({ length: 12 }, (_, index) => ({ name: `Stop ${index + 1}` })),
        },
      ],
    },
  ],
} as const;
