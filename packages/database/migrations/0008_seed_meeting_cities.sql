-- Seed a Europe-wide meeting-city catalog for candidate generation.
-- Origins upserted as STOP stations never populate this pool; without a city
-- catalog, searches collapse onto whatever city rows already exist (e.g. Paris/Berlin).
-- IDs are stable RailMeet catalog places (not Motis). ON CONFLICT DO NOTHING keeps
-- any already-present rows (including legacy place:berlin / place:paris fixtures).

INSERT INTO places (id, name, kind, country_code, timezone, location, provider, provider_place_id)
VALUES
  -- United Kingdom
  ('place:catalog:london', 'London', 'city', 'GB', 'Europe/London', ST_SetSRID(ST_MakePoint(-0.1276, 51.5072), 4326), 'railmeet-catalog', 'london'),
  ('place:catalog:edinburgh', 'Edinburgh', 'city', 'GB', 'Europe/London', ST_SetSRID(ST_MakePoint(-3.1883, 55.9533), 4326), 'railmeet-catalog', 'edinburgh'),
  ('place:catalog:glasgow', 'Glasgow', 'city', 'GB', 'Europe/London', ST_SetSRID(ST_MakePoint(-4.2518, 55.8609), 4326), 'railmeet-catalog', 'glasgow'),
  ('place:catalog:york', 'York', 'city', 'GB', 'Europe/London', ST_SetSRID(ST_MakePoint(-1.0873, 53.9591), 4326), 'railmeet-catalog', 'york'),
  ('place:catalog:leeds', 'Leeds', 'city', 'GB', 'Europe/London', ST_SetSRID(ST_MakePoint(-1.5491, 53.8008), 4326), 'railmeet-catalog', 'leeds'),
  ('place:catalog:newcastle', 'Newcastle', 'city', 'GB', 'Europe/London', ST_SetSRID(ST_MakePoint(-1.6178, 54.9783), 4326), 'railmeet-catalog', 'newcastle'),
  ('place:catalog:manchester', 'Manchester', 'city', 'GB', 'Europe/London', ST_SetSRID(ST_MakePoint(-2.2426, 53.4808), 4326), 'railmeet-catalog', 'manchester'),
  ('place:catalog:birmingham', 'Birmingham', 'city', 'GB', 'Europe/London', ST_SetSRID(ST_MakePoint(-1.8904, 52.4862), 4326), 'railmeet-catalog', 'birmingham'),
  ('place:catalog:peterborough', 'Peterborough', 'city', 'GB', 'Europe/London', ST_SetSRID(ST_MakePoint(-0.2500, 52.5695), 4326), 'railmeet-catalog', 'peterborough'),
  ('place:catalog:sheffield', 'Sheffield', 'city', 'GB', 'Europe/London', ST_SetSRID(ST_MakePoint(-1.4701, 53.3811), 4326), 'railmeet-catalog', 'sheffield'),
  ('place:catalog:nottingham', 'Nottingham', 'city', 'GB', 'Europe/London', ST_SetSRID(ST_MakePoint(-1.1581, 52.9548), 4326), 'railmeet-catalog', 'nottingham'),
  ('place:catalog:liverpool', 'Liverpool', 'city', 'GB', 'Europe/London', ST_SetSRID(ST_MakePoint(-2.9916, 53.4084), 4326), 'railmeet-catalog', 'liverpool'),
  ('place:catalog:preston', 'Preston', 'city', 'GB', 'Europe/London', ST_SetSRID(ST_MakePoint(-2.7045, 53.7632), 4326), 'railmeet-catalog', 'preston'),
  ('place:catalog:carlisle', 'Carlisle', 'city', 'GB', 'Europe/London', ST_SetSRID(ST_MakePoint(-2.9440, 54.8951), 4326), 'railmeet-catalog', 'carlisle'),
  ('place:catalog:doncaster', 'Doncaster', 'city', 'GB', 'Europe/London', ST_SetSRID(ST_MakePoint(-1.1285, 53.5228), 4326), 'railmeet-catalog', 'doncaster'),
  -- Ireland / Benelux / France / Germany / CH / AT / IT / ES / Nordics / CE
  ('place:catalog:dublin', 'Dublin', 'city', 'IE', 'Europe/Dublin', ST_SetSRID(ST_MakePoint(-6.2603, 53.3498), 4326), 'railmeet-catalog', 'dublin'),
  ('place:catalog:brussels', 'Brussels', 'city', 'BE', 'Europe/Brussels', ST_SetSRID(ST_MakePoint(4.3517, 50.8503), 4326), 'railmeet-catalog', 'brussels'),
  ('place:catalog:amsterdam', 'Amsterdam', 'city', 'NL', 'Europe/Amsterdam', ST_SetSRID(ST_MakePoint(4.9041, 52.3676), 4326), 'railmeet-catalog', 'amsterdam'),
  ('place:catalog:rotterdam', 'Rotterdam', 'city', 'NL', 'Europe/Amsterdam', ST_SetSRID(ST_MakePoint(4.4777, 51.9244), 4326), 'railmeet-catalog', 'rotterdam'),
  ('place:catalog:luxembourg', 'Luxembourg', 'city', 'LU', 'Europe/Luxembourg', ST_SetSRID(ST_MakePoint(6.1319, 49.6116), 4326), 'railmeet-catalog', 'luxembourg'),
  ('place:catalog:paris', 'Paris', 'city', 'FR', 'Europe/Paris', ST_SetSRID(ST_MakePoint(2.3522, 48.8566), 4326), 'railmeet-catalog', 'paris'),
  ('place:catalog:lyon', 'Lyon', 'city', 'FR', 'Europe/Paris', ST_SetSRID(ST_MakePoint(4.8357, 45.7640), 4326), 'railmeet-catalog', 'lyon'),
  ('place:catalog:lille', 'Lille', 'city', 'FR', 'Europe/Paris', ST_SetSRID(ST_MakePoint(3.0573, 50.6292), 4326), 'railmeet-catalog', 'lille'),
  ('place:catalog:berlin', 'Berlin', 'city', 'DE', 'Europe/Berlin', ST_SetSRID(ST_MakePoint(13.4050, 52.5200), 4326), 'railmeet-catalog', 'berlin'),
  ('place:catalog:hamburg', 'Hamburg', 'city', 'DE', 'Europe/Berlin', ST_SetSRID(ST_MakePoint(9.9937, 53.5511), 4326), 'railmeet-catalog', 'hamburg'),
  ('place:catalog:cologne', 'Cologne', 'city', 'DE', 'Europe/Berlin', ST_SetSRID(ST_MakePoint(6.9603, 50.9375), 4326), 'railmeet-catalog', 'cologne'),
  ('place:catalog:frankfurt', 'Frankfurt', 'city', 'DE', 'Europe/Berlin', ST_SetSRID(ST_MakePoint(8.6821, 50.1109), 4326), 'railmeet-catalog', 'frankfurt'),
  ('place:catalog:munich', 'Munich', 'city', 'DE', 'Europe/Berlin', ST_SetSRID(ST_MakePoint(11.5820, 48.1351), 4326), 'railmeet-catalog', 'munich'),
  ('place:catalog:zurich', 'Zurich', 'city', 'CH', 'Europe/Zurich', ST_SetSRID(ST_MakePoint(8.5417, 47.3769), 4326), 'railmeet-catalog', 'zurich'),
  ('place:catalog:vienna', 'Vienna', 'city', 'AT', 'Europe/Vienna', ST_SetSRID(ST_MakePoint(16.3738, 48.2082), 4326), 'railmeet-catalog', 'vienna'),
  ('place:catalog:prague', 'Prague', 'city', 'CZ', 'Europe/Prague', ST_SetSRID(ST_MakePoint(14.4378, 50.0755), 4326), 'railmeet-catalog', 'prague'),
  ('place:catalog:milan', 'Milan', 'city', 'IT', 'Europe/Rome', ST_SetSRID(ST_MakePoint(9.1900, 45.4642), 4326), 'railmeet-catalog', 'milan'),
  ('place:catalog:madrid', 'Madrid', 'city', 'ES', 'Europe/Madrid', ST_SetSRID(ST_MakePoint(-3.7038, 40.4168), 4326), 'railmeet-catalog', 'madrid'),
  ('place:catalog:barcelona', 'Barcelona', 'city', 'ES', 'Europe/Madrid', ST_SetSRID(ST_MakePoint(2.1734, 41.3851), 4326), 'railmeet-catalog', 'barcelona'),
  ('place:catalog:copenhagen', 'Copenhagen', 'city', 'DK', 'Europe/Copenhagen', ST_SetSRID(ST_MakePoint(12.5683, 55.6761), 4326), 'railmeet-catalog', 'copenhagen'),
  ('place:catalog:stockholm', 'Stockholm', 'city', 'SE', 'Europe/Stockholm', ST_SetSRID(ST_MakePoint(18.0686, 59.3293), 4326), 'railmeet-catalog', 'stockholm'),
  ('place:catalog:warsaw', 'Warsaw', 'city', 'PL', 'Europe/Warsaw', ST_SetSRID(ST_MakePoint(21.0122, 52.2297), 4326), 'railmeet-catalog', 'warsaw')
ON CONFLICT (id) DO NOTHING;
