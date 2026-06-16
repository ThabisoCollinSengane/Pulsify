-- events_ranked: home-feed ranking view.
-- Adds a computed rank_score to every events row so the feed can order by a
-- blended signal instead of raw hype_score. Applied to production via the
-- Supabase migration `events_ranked_view`.
--
--   rank_score = hype + engagement + time-relevance
--     hype        : COALESCE(hype_score, 0)            (0..~100, seeded)
--     engagement  : likes + 2*comments + attendance,   capped at 100 so one
--                   viral event can't bury the whole feed
--     time-relev. : GREATEST(0, 30 - days_until_event) — sooner upcoming
--                   events score higher (up to +30), decaying by day
--
-- Proximity (the 4th term in the roadmap formula) is intentionally NOT here:
-- it depends on the viewer's location. It's handled client-side by the
-- "Near Me" toggle; default-feed proximity would need a location-parametrised
-- RPC (follow-up).
--
-- security_invoker = on so the view respects the querying role's RLS on
-- events rather than running with the view owner's privileges.

CREATE OR REPLACE VIEW public.events_ranked
WITH (security_invoker = on) AS
SELECT e.*,
  ( COALESCE(e.hype_score, 0)
  + LEAST(COALESCE(e.like_count, 0) + 2 * COALESCE(e.comment_count, 0) + COALESCE(e.attendance_count, 0), 100)
  + GREATEST(0, 30 - (e.date_local - CURRENT_DATE))
  )::int AS rank_score
FROM public.events e;

GRANT SELECT ON public.events_ranked TO anon, authenticated, service_role;
