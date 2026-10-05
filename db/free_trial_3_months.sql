-- Launch offer: every new organizer / business account gets premium free for its first 3 months.
-- Granted by trigger so every signup path (API register, ensure-business-profile, a user
-- switching role in the app) gets it. It runs after trg_guard_profile_write (triggers fire in
-- name order), so the guard still blocks clients from setting their own plan.
-- Expired trials are downgraded to 'free' by the daily event-cleanup cron.
CREATE OR REPLACE FUNCTION public.start_free_trial() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.role IN ('organizer', 'business')
     AND coalesce(NEW.subscription_type, 'free') = 'free'
     AND NEW.trial_expires_at IS NULL
     AND (TG_OP = 'INSERT' OR OLD.role IS DISTINCT FROM NEW.role) THEN
    NEW.subscription_type := 'trial';
    NEW.trial_expires_at  := now() + interval '3 months';
  END IF;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.start_free_trial() FROM public, anon, authenticated;

DROP TRIGGER IF EXISTS trg_start_free_trial ON public.profiles;
CREATE TRIGGER trg_start_free_trial BEFORE INSERT OR UPDATE OF role ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.start_free_trial();

-- Existing organizer/business accounts still on the free plan get the same 3 months from today.
UPDATE public.profiles
   SET subscription_type = 'trial', trial_expires_at = now() + interval '3 months'
 WHERE role IN ('organizer', 'business')
   AND coalesce(subscription_type, 'free') = 'free'
   AND trial_expires_at IS NULL;
