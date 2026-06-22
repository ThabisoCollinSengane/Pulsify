-- biz_admin_update_policy.sql — Run in Supabase SQL Editor (also applied via migration)
-- ═══════════════════════════════════════════════════════════
-- Lets admins UPDATE any business row from the admin dashboard.
--
-- The admin dashboard (apps/admin/index.html) uses the ANON key + the admin's
-- JWT, so every sb.from('businesses').update(...) is subject to RLS. Production
-- only had: biz_service_all (service_role), biz_admin_insert (admin INSERT),
-- and two public SELECT policies — NO admin UPDATE policy.
--
-- Result: saveCoords / clearCoords / toggleFeatured / runBulkGeocode matched
-- 0 rows under RLS and PostgREST returned error:null, so the UI showed
-- "✅ Saved successfully" while nothing was written. On refresh the edit was gone.
--
-- This mirrors the existing biz_admin_insert policy (EXISTS on profiles.role).
-- ═══════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "biz_admin_update" ON public.businesses;
CREATE POLICY "biz_admin_update" ON public.businesses
  FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM public.profiles
    WHERE profiles.id = (SELECT auth.uid()) AND profiles.role = 'admin'
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.profiles
    WHERE profiles.id = (SELECT auth.uid()) AND profiles.role = 'admin'
  ));
