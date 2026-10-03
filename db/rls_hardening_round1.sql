-- RLS hardening, round 1 — fixes found by db/tests/rls_attack.sql.
-- Trusted paths are unaffected: the API (service_role), SQL run as postgres (auth.role()
-- is null), and nested triggers (pg_trigger_depth() > 1, e.g. follower-count triggers).

-- Helpers ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_admin() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
$$;
-- true when the statement comes from a browser session (anon / signed-in user)
CREATE OR REPLACE FUNCTION public.is_client_call() RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT coalesce(auth.role(), '') IN ('anon', 'authenticated') AND pg_trigger_depth() <= 1
$$;
GRANT EXECUTE ON FUNCTION public.is_admin(), public.is_client_call() TO anon, authenticated, service_role;

-- 1. No TRUNCATE / TRIGGER / REFERENCES for browser roles (TRUNCATE ignores RLS) --------
REVOKE TRUNCATE, TRIGGER, REFERENCES ON ALL TABLES IN SCHEMA public FROM anon, authenticated;

-- 2. Profiles: private columns are no longer readable by other people -----------------
REVOKE SELECT ON public.profiles FROM anon, authenticated;
GRANT SELECT (id, username, display_name, avatar_url, bio, city, province, is_organiser,
  is_verified, follower_count, following_count, event_count, created_at, updated_at, role,
  is_page, genres, verif_status, subscription_type, trial_expires_at, suspended, social_links,
  instagram, tiktok, whatsapp, facebook, twitter, referral_code, paystack_subaccount_code,
  cover_url, whatsapp_display_number, whatsapp_verified)
  ON public.profiles TO anon, authenticated;

-- The signed-in user's own full row (email, phone, dob, bank details, prefs…)
CREATE OR REPLACE FUNCTION public.my_profile() RETURNS SETOF public.profiles
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT * FROM profiles WHERE id = auth.uid()
$$;
REVOKE ALL ON FUNCTION public.my_profile() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.my_profile() TO authenticated;

-- 3. Profiles: users can't grant themselves admin / verified / premium / counters -------
CREATE OR REPLACE FUNCTION public.guard_profile_write() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NOT is_client_call() OR is_admin() THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    IF coalesce(NEW.role, 'user') NOT IN ('user', 'organizer', 'business') THEN
      RAISE EXCEPTION 'not allowed to set role %', NEW.role USING ERRCODE = '42501';
    END IF;
    NEW.is_verified := false; NEW.subscription_type := NULL; NEW.suspended := false;
    NEW.is_trusted_submitter := false; NEW.verif_status := NULL;
    RETURN NEW;
  END IF;
  -- role: only the signup choice user → organizer / business
  IF NEW.role IS DISTINCT FROM OLD.role
     AND NOT (coalesce(OLD.role, 'user') = 'user' AND NEW.role IN ('organizer', 'business')) THEN
    RAISE EXCEPTION 'not allowed to change role' USING ERRCODE = '42501';
  END IF;
  IF NEW.is_verified IS DISTINCT FROM OLD.is_verified
     OR (NEW.verif_status IS DISTINCT FROM OLD.verif_status AND NEW.verif_status IS DISTINCT FROM 'pending')
     OR NEW.subscription_type IS DISTINCT FROM OLD.subscription_type
     OR NEW.trial_expires_at IS DISTINCT FROM OLD.trial_expires_at
     OR NEW.suspended IS DISTINCT FROM OLD.suspended
     OR NEW.is_trusted_submitter IS DISTINCT FROM OLD.is_trusted_submitter
     OR NEW.email IS DISTINCT FROM OLD.email
     OR NEW.follower_count IS DISTINCT FROM OLD.follower_count
     OR NEW.following_count IS DISTINCT FROM OLD.following_count
     OR NEW.event_count IS DISTINCT FROM OLD.event_count
     OR NEW.referral_code IS DISTINCT FROM OLD.referral_code
     OR NEW.paystack_subaccount_code IS DISTINCT FROM OLD.paystack_subaccount_code
     OR NEW.paystack_account_number IS DISTINCT FROM OLD.paystack_account_number
     OR NEW.paystack_bank_name IS DISTINCT FROM OLD.paystack_bank_name
     OR NEW.whatsapp_phone_id IS DISTINCT FROM OLD.whatsapp_phone_id
     OR NEW.whatsapp_verified IS DISTINCT FROM OLD.whatsapp_verified THEN
    RAISE EXCEPTION 'not allowed to change a protected profile field' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_guard_profile_write ON public.profiles;
CREATE TRIGGER trg_guard_profile_write BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_profile_write();

-- 4. Notifications: sender must be you (or a note to yourself); display name is real ---
DROP POLICY IF EXISTS notif_insert_authed ON public.notifications;
CREATE POLICY notif_insert_authed ON public.notifications FOR INSERT TO authenticated
  WITH CHECK (from_user_id = (SELECT auth.uid()) OR (user_id = (SELECT auth.uid()) AND from_user_id IS NULL));
-- notifications_own (ALL) would otherwise let a user insert anything addressed to themselves
-- with a spoofed sender; restrict it to read/update/delete.
DROP POLICY IF EXISTS notifications_own ON public.notifications;
CREATE POLICY notifications_own_delete ON public.notifications FOR DELETE
  USING (user_id = (SELECT auth.uid()));
CREATE OR REPLACE FUNCTION public.fill_notification_sender() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF is_client_call() AND NEW.from_user_id IS NOT NULL THEN
    SELECT coalesce(display_name, username) INTO NEW.from_display_name FROM profiles WHERE id = NEW.from_user_id;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_fill_notification_sender ON public.notifications;
CREATE TRIGGER trg_fill_notification_sender BEFORE INSERT ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION public.fill_notification_sender();

-- 5. Events: only organizers/businesses create; approval + money fields are admin-only ---
DROP POLICY IF EXISTS events_insert_own ON public.events;
CREATE POLICY events_insert_own ON public.events FOR INSERT WITH CHECK (
  organiser_id = (SELECT auth.uid())
  AND EXISTS (SELECT 1 FROM profiles WHERE id = (SELECT auth.uid()) AND role IN ('organizer', 'business', 'admin')));
CREATE OR REPLACE FUNCTION public.guard_event_write() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NOT is_client_call() OR is_admin() THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.approved := false; NEW.is_frontline := false; NEW.frontline_rank := NULL;
    NEW.tickets_sold := 0;
    NEW.commission_rate := (SELECT nullif(regexp_replace(column_default, '::.*$', ''), '')::numeric
                              FROM information_schema.columns
                             WHERE table_schema = 'public' AND table_name = 'events' AND column_name = 'commission_rate');
    RETURN NEW;
  END IF;
  IF NEW.approved IS DISTINCT FROM OLD.approved
     OR NEW.is_frontline IS DISTINCT FROM OLD.is_frontline
     OR NEW.frontline_rank IS DISTINCT FROM OLD.frontline_rank
     OR NEW.commission_rate IS DISTINCT FROM OLD.commission_rate
     OR NEW.tickets_sold IS DISTINCT FROM OLD.tickets_sold
     OR NEW.organiser_id IS DISTINCT FROM OLD.organiser_id THEN
    RAISE EXCEPTION 'not allowed to change approval, ownership or commission fields' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_guard_event_write ON public.events;
CREATE TRIGGER trg_guard_event_write BEFORE INSERT OR UPDATE ON public.events
  FOR EACH ROW EXECUTE FUNCTION public.guard_event_write();

-- 6. Organizers can read the bookings for their own events (attendee list / check-in) ---
DROP POLICY IF EXISTS bookings_organiser_read ON public.bookings;
CREATE POLICY bookings_organiser_read ON public.bookings FOR SELECT USING (
  event_id IN (SELECT id FROM events WHERE organiser_id = (SELECT auth.uid())));

-- 7. Promotions: going live is the API's call (admin / trusted submitter) --------------
CREATE OR REPLACE FUNCTION public.guard_promotion_write() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE trusted boolean;
BEGIN
  IF NOT is_client_call() OR is_admin() THEN RETURN NEW; END IF;
  SELECT coalesce(is_trusted_submitter, false) INTO trusted FROM profiles WHERE id = auth.uid();
  IF trusted THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN NEW.is_active := false; NEW.priority := 0; RETURN NEW; END IF;
  IF (NEW.is_active AND NOT coalesce(OLD.is_active, false)) OR NEW.priority IS DISTINCT FROM OLD.priority THEN
    RAISE EXCEPTION 'promotions are activated after review' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_guard_promotion_write ON public.promotions;
CREATE TRIGGER trg_guard_promotion_write BEFORE INSERT OR UPDATE ON public.promotions
  FOR EACH ROW EXECUTE FUNCTION public.guard_promotion_write();

-- 8. Squad promos: approval is admin-only ----------------------------------------------
CREATE OR REPLACE FUNCTION public.guard_squad_promo_write() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NOT is_client_call() OR is_admin() THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.approved := false; NEW.rejected := false; NEW.reject_reason := NULL;
    NEW.highlight_in_discovery := false;
    RETURN NEW;
  END IF;
  IF NEW.approved IS DISTINCT FROM OLD.approved OR NEW.rejected IS DISTINCT FROM OLD.rejected
     OR NEW.reject_reason IS DISTINCT FROM OLD.reject_reason
     OR NEW.highlight_in_discovery IS DISTINCT FROM OLD.highlight_in_discovery THEN
    RAISE EXCEPTION 'squad promos are approved by Pulsify' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_guard_squad_promo_write ON public.squad_promos;
CREATE TRIGGER trg_guard_squad_promo_write BEFORE INSERT OR UPDATE ON public.squad_promos
  FOR EACH ROW EXECUTE FUNCTION public.guard_squad_promo_write();

-- 9. Deals: businesses can actually create/edit/delete their deals (grant was missing),
--    and only business accounts may publish them.
GRANT INSERT, UPDATE, DELETE ON public.deals TO authenticated;
DROP POLICY IF EXISTS deals_insert ON public.deals;
CREATE POLICY deals_insert ON public.deals FOR INSERT WITH CHECK (
  (auth.uid())::text = business_id
  AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('business', 'admin')));

-- 10. Businesses: admin panel edits (frontline, map pin) need the UPDATE grant; the
--     biz_admin_update policy keeps it admin-only.
GRANT UPDATE ON public.businesses TO authenticated;

-- 11. Pickup orders: new orders are always 'pending', the total is computed from the real
--     menu prices, and a signed-in customer's id is recorded so they see it in My Orders.
DROP POLICY IF EXISTS pickup_orders_insert_anon ON public.pickup_orders;
CREATE POLICY pickup_orders_insert_anon ON public.pickup_orders FOR INSERT WITH CHECK (
  coalesce(status, 'pending') = 'pending'
  AND EXISTS (SELECT 1 FROM businesses b WHERE b.id::text = business_id));
CREATE OR REPLACE FUNCTION public.price_pickup_order() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE matched int; lines int; computed numeric;
BEGIN
  IF NOT is_client_call() THEN RETURN NEW; END IF;
  NEW.status := 'pending';
  NEW.user_id := auth.uid();
  -- Re-price from the menu when every cart line matches a real menu item of this business.
  SELECT count(m.id), count(*), sum(m.price * greatest(coalesce((i ->> 'qty')::int, 1), 1))
    INTO matched, lines, computed
    FROM jsonb_array_elements(coalesce(NEW.items, '[]'::jsonb)) i
    LEFT JOIN menu_items m ON m.id::text = i ->> 'id' AND m.business_id::text = NEW.business_id;
  IF lines > 0 AND matched = lines THEN NEW.total := computed; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_price_pickup_order ON public.pickup_orders;
CREATE TRIGGER trg_price_pickup_order BEFORE INSERT ON public.pickup_orders
  FOR EACH ROW EXECUTE FUNCTION public.price_pickup_order();

-- 12. Reports / location requests can't be filed in someone else's name -----------------
DROP POLICY IF EXISTS insert_event_reports ON public.event_reports;
DROP POLICY IF EXISTS insert_post_reports ON public.post_reports;
DROP POLICY IF EXISTS insert_business_reports ON public.business_reports;
DROP POLICY IF EXISTS loc_req_insert_own ON public.location_requests;
CREATE POLICY loc_req_insert_own ON public.location_requests FOR INSERT
  WITH CHECK (user_id = (SELECT auth.uid()));

-- 13. Storage: only the uploader (or an admin) can delete files in `uploads` -----------
DROP POLICY IF EXISTS uploads_owner_delete ON storage.objects;
CREATE POLICY uploads_owner_delete ON storage.objects FOR DELETE TO authenticated USING (
  bucket_id = 'uploads' AND (owner = auth.uid() OR public.is_admin()));

-- 14. Squads: joining a private squad needs an invite (the API joins with the service key)
DROP POLICY IF EXISTS sm_insert ON public.squad_members;
CREATE POLICY sm_insert ON public.squad_members FOR INSERT WITH CHECK (
  user_id = auth.uid() AND (
    EXISTS (SELECT 1 FROM squads s WHERE s.id = squad_id AND (s.is_public OR s.creator_id = auth.uid()))
    OR EXISTS (SELECT 1 FROM squad_invites i WHERE i.squad_id = squad_members.squad_id
               AND i.invitee_id = auth.uid() AND coalesce(i.status, 'pending') IN ('pending', 'accepted'))));
DROP POLICY IF EXISTS squad_invites_insert ON public.squad_invites;
CREATE POLICY squad_invites_insert ON public.squad_invites FOR INSERT WITH CHECK (
  inviter_id = auth.uid() AND public.is_squad_member(squad_id, auth.uid()));

-- 15. leads: the "Service role full access" policy was granted to public — scope it -----
DROP POLICY IF EXISTS "Service role full access" ON public.leads;
CREATE POLICY leads_service_all ON public.leads FOR ALL TO service_role USING (true) WITH CHECK (true);
