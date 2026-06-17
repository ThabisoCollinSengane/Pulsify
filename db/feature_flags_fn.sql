-- feature_flags: DB-backed feature toggle table (roadmap #13).
-- A single row per flag; short in-process cache (30s TTL) in shared.js
-- means a flag change takes effect within 30s without a redeploy.
--
-- Gate helper in shared.js: flagEnabled(key) → boolean.
-- First live use: flagEnabled('paystack_live') in /ticket/init blocks
-- paid ticket initiation when the flag is false (e.g. while Paystack keys
-- are still in test mode). Flip to true once PAYSTACK_SECRET_KEY is set
-- to the live key.
--
-- RLS: anon + authenticated can SELECT (needed if the client ever gates
-- UI on a flag value); only service_role can INSERT/UPDATE/DELETE.
--
-- Applied to production via the Supabase migration `feature_flags`.

CREATE TABLE IF NOT EXISTS public.feature_flags (
  key        text PRIMARY KEY,
  enabled    boolean NOT NULL DEFAULT false,
  rollout    int     NOT NULL DEFAULT 100 CHECK (rollout BETWEEN 0 AND 100),
  notes      text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.feature_flags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "flags_select" ON public.feature_flags
  FOR SELECT USING (true);

REVOKE INSERT, UPDATE, DELETE ON public.feature_flags FROM anon, authenticated;

INSERT INTO public.feature_flags (key, enabled, notes) VALUES
  ('paystack_live',    false, 'Use live Paystack keys — flip once PAYSTACK_SECRET_KEY is the live key'),
  ('squad_promos',     true,  'Squad promo submission + admin review flow'),
  ('hype_score_cron',  true,  'Recompute hype_score via 6am cron'),
  ('event_likes',      true,  'Event like/RSVP endpoints and UI'),
  ('map_bounds_load',  true,  'Load events by map viewport bounds (?bounds=)')
ON CONFLICT (key) DO NOTHING;
