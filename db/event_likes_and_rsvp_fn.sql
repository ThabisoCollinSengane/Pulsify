-- event_likes_and_rsvp: wires real engagement into recompute_hype_scores (#15).
-- Previously like_count was seeded static and attendance_count was always 0
-- (RSVP button was cosmetic). This migration adds:
--
-- 1) event_likes table — one row per (user, event) like, RLS public-read /
--    own-row insert+delete. trg_like_count trigger keeps events.like_count in sync
--    on INSERT/DELETE (same pattern as trg_attendance_count on event_attendances).
--
-- 2) RLS policies on event_attendances — table and trg_attendance_count trigger
--    already existed with RLS enabled but ZERO policies (service_role only).
--    Adds select/insert/delete/update policies so authenticated users can manage
--    their own RSVPs via the API (/events/:id/rsvp endpoint).
--
-- Applied to production via the Supabase migration `event_likes_and_rsvp`.

CREATE TABLE IF NOT EXISTS public.event_likes (
  user_id   uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_id  text        NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, event_id)
);

ALTER TABLE public.event_likes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "event_likes_select" ON public.event_likes
  FOR SELECT USING (true);

CREATE POLICY "event_likes_insert" ON public.event_likes
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "event_likes_delete" ON public.event_likes
  FOR DELETE USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.trg_like_count()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE events SET like_count = COALESCE(like_count, 0) + 1 WHERE id = NEW.event_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE events SET like_count = GREATEST(0, COALESCE(like_count, 0) - 1) WHERE id = OLD.event_id;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_like_count ON public.event_likes;
CREATE TRIGGER trg_like_count
  AFTER INSERT OR DELETE ON public.event_likes
  FOR EACH ROW EXECUTE FUNCTION public.trg_like_count();

-- RLS policies for event_attendances (table + trigger pre-existed; no policies existed)
CREATE POLICY "attendances_select" ON public.event_attendances
  FOR SELECT USING (true);

CREATE POLICY "attendances_insert" ON public.event_attendances
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "attendances_delete" ON public.event_attendances
  FOR DELETE USING (auth.uid() = user_id);

CREATE POLICY "attendances_update" ON public.event_attendances
  FOR UPDATE USING (auth.uid() = user_id);
