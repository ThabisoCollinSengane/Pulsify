-- Run ONLY after the app update that reads its own profile via my_profile() is live on
-- production. Hides private profile columns (email, phone, dob, bank details, KYC links…)
-- from everyone else; owners read them through public.my_profile().
REVOKE SELECT ON public.profiles FROM anon, authenticated;
GRANT SELECT (id, username, display_name, avatar_url, bio, city, province, is_organiser,
  is_verified, follower_count, following_count, event_count, created_at, updated_at, role,
  is_page, genres, verif_status, subscription_type, trial_expires_at, suspended, social_links,
  instagram, tiktok, whatsapp, facebook, twitter, referral_code, paystack_subaccount_code,
  cover_url, whatsapp_display_number, whatsapp_verified)
  ON public.profiles TO anon, authenticated;

