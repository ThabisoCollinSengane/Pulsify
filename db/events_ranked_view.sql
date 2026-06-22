-- events_ranked: home-feed ranking view.
-- Adds a computed rank_score to every events row so the feed can order by a
-- single blended signal instead of raw hype_score. Applied to production via
-- the Supabase migration `events_ranked_view`.
--
--   rank_score = featured + hype + engagement + time-relevance + freshness
--     featured    : +35 when is_frontline (paid/featured venues) — a *bonus*,
--                   no longer a hard primary sort, so a new organiser/business
--                   post is ranked on merit instead of being buried below
--                   every frontline event.
--     hype        : COALESCE(hype_score, 0)            (0..~100, seeded)
--     engagement  : likes + 2*comments + attendance,   capped at 100 so one
--                   viral event can't bury the whole feed
--     time-relev. : GREATEST(0, 30 - days_until_event) — sooner upcoming
--                   events score higher (up to +30), decaying by day
--     freshness   : GREATEST(0, 20 - 2*days_since_created) — a fresh post gets
--                   up to +20 so it DEBUTS mid-feed (~#10-12) instead of dead
--                   last, then decays over ~10 days. Engagement is what carries
--                   it up from there.
--
-- The API must order by rank_score (NOT is_frontline first), otherwise the
-- featured bonus is meaningless and the old hard gate returns.
--
-- Proximity (the roadmap's 4th term) is intentionally NOT here: it depends on
-- the viewer's location and is handled client-side by the "Near Me" toggle.
--
-- security_invoker = on so the view respects the querying role's RLS on
-- events rather than running with the view owner's privileges.

CREATE OR REPLACE VIEW public.events_ranked
WITH (security_invoker = on) AS
SELECT e.*,
  ( (CASE WHEN e.is_frontline THEN 35 ELSE 0 END)
  + COALESCE(e.hype_score, 0)
  + LEAST(COALESCE(e.like_count, 0) + 2 * COALESCE(e.comment_count, 0) + COALESCE(e.attendance_count, 0), 100)
  + GREATEST(0, 30 - (e.date_local - CURRENT_DATE))
  + GREATEST(0, 20 - 2 * (CURRENT_DATE - e.created_at::date))
  )::int AS rank_score
FROM public.events e;

GRANT SELECT ON public.events_ranked TO anon, authenticated, service_role;
