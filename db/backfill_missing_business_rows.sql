-- Backfill missing businesses rows for business-role profiles.
--
-- Bug: the business dashboard's order list, order-status updates, and menu
-- management are gated by RLS that resolves the owner's business via
--   business_id IN (SELECT id FROM businesses WHERE owner_id = auth.uid())
-- (pickup_orders_select_owner / _update_owner, menu_items_*_owner). A
-- business owner whose profile exists but who has NO businesses row therefore
-- sees zero orders and cannot manage their menu — it presents as a
-- "database permissions" failure.
--
-- Root cause: POST /auth/ensure-business-profile only created the businesses
-- row inside the `if (!profile)` (brand-new profile) branch. Profiles that
-- already existed with role='business' (e.g. created via /auth/register-business
-- where the businesses insert failed, or role set elsewhere) never got one.
-- The endpoint is now fixed to ensure the row for ANY business-role profile;
-- this migration backfills the rows that were already missing.
--
-- Shape mirrors the endpoint: id = owner_id = profile.id (businesses.id is
-- text, owner_id is uuid). category is NOT NULL → default 'other'.
--
-- Applied to production via the Supabase migration `backfill_missing_business_rows`.

INSERT INTO public.businesses (id, owner_id, name, category, city, province, is_active)
SELECT p.id,
       p.id::uuid,
       COALESCE(NULLIF(btrim(p.display_name), ''), split_part(p.email, '@', 1), 'Business'),
       'other',
       p.city,
       COALESCE(p.province, 'KZN'),
       true
FROM public.profiles p
WHERE p.role = 'business'
  AND NOT EXISTS (SELECT 1 FROM public.businesses b WHERE b.owner_id = p.id)
ON CONFLICT (id) DO NOTHING;
