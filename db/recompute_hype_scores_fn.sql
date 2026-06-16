-- recompute_hype_scores: engagement-driven hype_score (roadmap #15).
-- hype_score used to be a static seeded value (DEFAULT 50, schema.sql:64),
-- set once at event creation and never updated. This function recomputes it
-- from real engagement (likes/comments/attendance) for all active events,
-- called periodically by api/cron/hype-score.js.
--
-- Floor of 20 keeps brand-new/low-engagement events from disappearing
-- entirely from the events_ranked feed (rank_score = hype + engagement +
-- time-relevance — a hype of 0 would only leave the other two terms).
-- Cap of 100 matches the existing hype_score column convention.
--
-- Applied to production via the Supabase migration `recompute_hype_scores_fn`.

CREATE OR REPLACE FUNCTION public.recompute_hype_scores()
RETURNS void
LANGUAGE sql
AS $$
  UPDATE public.events
  SET hype_score = GREATEST(20, LEAST(100,
        20 + COALESCE(like_count, 0) * 2
           + COALESCE(comment_count, 0) * 3
           + COALESCE(attendance_count, 0)
      ))
  WHERE is_active = true;
$$;

GRANT EXECUTE ON FUNCTION public.recompute_hype_scores() TO service_role;
