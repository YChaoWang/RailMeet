-- Deactivate pre-catalog fixture cities that lack hubs and collide with catalog cities.
UPDATE places
SET active = false, updated_at = now()
WHERE id IN ('place:paris', 'place:berlin')
  AND (provider IS NULL OR provider = '');
