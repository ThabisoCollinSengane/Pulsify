-- cleanup_map_data: daily map-data hygiene (roadmap #11).
-- Called by api/cron/event-cleanup.js after it deactivates past events.
--
-- (1) Repairs event coordinates that fall outside South-Africa bounds
--     (lat -35..-22, lon 16..33) by nulling both lat/lon, so a garbage coord
--     can never render an ocean marker. The client only plots in-bounds
--     coords anyway, and a marker needs BOTH lat and lon, so nulling is a
--     safe normalization rather than data loss.
-- (2) Dedupes venues by normalized (name, city): keeps the best survivor per
--     group (verified, then highest location_confidence, then oldest created_at),
--     repoints events.venue_id to the survivor, and deletes the losers. Only
--     events.venue_id references venues (ON DELETE SET NULL), so repoint-then-
--     delete is the complete and safe merge.
--
-- Atomic (one function body = one transaction). Returns counts as jsonb.
-- EXECUTE is locked to service_role (the cron) — anon/authenticated cannot run it.
--
-- Applied to production via the Supabase migration `cleanup_map_data_fn`.

CREATE OR REPLACE FUNCTION public.cleanup_map_data()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_coords int := 0;
  v_merged int := 0;
BEGIN
  -- 1) out-of-SA-bounds event coordinates -> null
  UPDATE events
     SET venue_lat = null, venue_lon = null
   WHERE venue_lat IS NOT NULL AND venue_lon IS NOT NULL
     AND (venue_lat < -35 OR venue_lat > -22 OR venue_lon < 16 OR venue_lon > 33);
  GET DIAGNOSTICS v_coords = ROW_COUNT;

  -- 2) venue dedupe
  CREATE TEMPORARY TABLE _venue_dups ON COMMIT DROP AS
  SELECT id,
         first_value(id) OVER (
           PARTITION BY lower(trim(name)), coalesce(lower(trim(city)), '')
           ORDER BY verified DESC, location_confidence DESC, created_at ASC
         ) AS keep_id
  FROM venues;

  UPDATE events e
     SET venue_id = d.keep_id
    FROM _venue_dups d
   WHERE e.venue_id = d.id AND d.id <> d.keep_id;

  DELETE FROM venues v
   USING _venue_dups d
   WHERE v.id = d.id AND d.id <> d.keep_id;
  GET DIAGNOSTICS v_merged = ROW_COUNT;

  RETURN jsonb_build_object('coords_repaired', v_coords, 'venues_merged', v_merged);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.cleanup_map_data() FROM public, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.cleanup_map_data() TO service_role;
