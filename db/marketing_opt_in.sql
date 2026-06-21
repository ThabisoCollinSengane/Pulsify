-- Marketing email consent on profiles (applied via Supabase migration
-- add_marketing_opt_in_to_profiles).
--
-- Default true for account holders; the one-click unsubscribe link in every
-- marketing email (GET /api/unsubscribe?e=&t=) flips this to false. Transactional
-- email (tickets, orders, password resets) ignores this flag — it always sends.
-- POPIA: unsubscribe must always work; we never re-subscribe automatically.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS marketing_opt_in boolean NOT NULL DEFAULT true;

-- Partial index keeps the admin audience query (marketing_opt_in = true) fast.
CREATE INDEX IF NOT EXISTS idx_profiles_marketing_opt_in
  ON public.profiles (marketing_opt_in)
  WHERE marketing_opt_in = true;
