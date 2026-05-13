-- ============================================================
-- Pulsify — Full RLS Policy Fix (canonical, session 2026-05-13)
-- Safe to re-run: all DROP IF EXISTS before CREATE
-- Apply via: Supabase Dashboard → SQL Editor, or MCP execute_sql
-- ============================================================

-- ── EVENTS ──────────────────────────────────────────────────
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "events_public_read"  ON events;
DROP POLICY IF EXISTS "events_service_all"  ON events;
CREATE POLICY "events_public_read"  ON events FOR SELECT USING (true);
CREATE POLICY "events_service_all"  ON events FOR ALL   USING (auth.jwt() ->> 'role' = 'service_role');

-- ── BUSINESSES ───────────────────────────────────────────────
ALTER TABLE businesses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "biz_public_read" ON businesses;
DROP POLICY IF EXISTS "biz_service_all" ON businesses;
CREATE POLICY "biz_public_read" ON businesses FOR SELECT USING (true);
CREATE POLICY "biz_service_all" ON businesses FOR ALL   USING (auth.jwt() ->> 'role' = 'service_role');

-- ── BUSINESS_HOURS ────────────────────────────────────────────
ALTER TABLE business_hours ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "biz_hours_select_public" ON business_hours;
CREATE POLICY "biz_hours_select_public" ON business_hours FOR SELECT USING (true);
-- Writes go through service_role in the API (bypasses RLS)

-- ── MENU_ITEMS ────────────────────────────────────────────────
ALTER TABLE menu_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "menu_items_select_public" ON menu_items;
CREATE POLICY "menu_items_select_public" ON menu_items FOR SELECT USING (true);
-- Writes go through service_role in the API (bypasses RLS)

-- ── PICKUP_ORDERS ─────────────────────────────────────────────
ALTER TABLE pickup_orders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "pickup_orders_insert_anon" ON pickup_orders;
CREATE POLICY "pickup_orders_insert_anon" ON pickup_orders FOR INSERT WITH CHECK (true);
-- SELECT/UPDATE via service_role only (business dashboard uses service key)

-- ── POSTS ────────────────────────────────────────────────────
ALTER TABLE posts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "posts_read_public" ON posts;
DROP POLICY IF EXISTS "posts_insert_own"  ON posts;
DROP POLICY IF EXISTS "posts_delete_own"  ON posts;
CREATE POLICY "posts_read_public" ON posts FOR SELECT USING (true);
CREATE POLICY "posts_insert_own"  ON posts FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "posts_delete_own"  ON posts FOR DELETE USING  (auth.uid() = user_id);

-- ── PROFILES ─────────────────────────────────────────────────
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "profiles_read_all"   ON profiles;
DROP POLICY IF EXISTS "profiles_insert_own" ON profiles;
DROP POLICY IF EXISTS "profiles_update_own" ON profiles;
CREATE POLICY "profiles_read_all"   ON profiles FOR SELECT USING (true);
CREATE POLICY "profiles_insert_own" ON profiles FOR INSERT WITH CHECK (auth.uid() = id);
CREATE POLICY "profiles_update_own" ON profiles FOR UPDATE USING  (auth.uid() = id);

-- ── FOLLOWS ──────────────────────────────────────────────────
ALTER TABLE follows ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "follows_select"     ON follows;
DROP POLICY IF EXISTS "follows_insert_own" ON follows;
DROP POLICY IF EXISTS "follows_delete_own" ON follows;
CREATE POLICY "follows_select"     ON follows FOR SELECT USING (true);
CREATE POLICY "follows_insert_own" ON follows FOR INSERT WITH CHECK (auth.uid() = follower_id);
CREATE POLICY "follows_delete_own" ON follows FOR DELETE USING  (auth.uid() = follower_id);

-- ── NOTIFICATIONS ─────────────────────────────────────────────
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "notif_service_all"  ON notifications;
DROP POLICY IF EXISTS "notif_insert_any"   ON notifications;
DROP POLICY IF EXISTS "notif_select_own"   ON notifications;
DROP POLICY IF EXISTS "notif_update_own"   ON notifications;
CREATE POLICY "notif_service_all" ON notifications FOR ALL    USING (auth.jwt() ->> 'role' = 'service_role');
CREATE POLICY "notif_insert_any"  ON notifications FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "notif_select_own"  ON notifications FOR SELECT USING  (auth.uid() = user_id);
CREATE POLICY "notif_update_own"  ON notifications FOR UPDATE USING  (auth.uid() = user_id);

-- ── COMMENTS ─────────────────────────────────────────────────
ALTER TABLE comments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "comments_read_all"   ON comments;
DROP POLICY IF EXISTS "comments_insert_own" ON comments;
DROP POLICY IF EXISTS "comments_delete_own" ON comments;
CREATE POLICY "comments_read_all"   ON comments FOR SELECT USING (true);
CREATE POLICY "comments_insert_own" ON comments FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "comments_delete_own" ON comments FOR DELETE USING  (auth.uid() = user_id);

-- ── REACTIONS ─────────────────────────────────────────────────
ALTER TABLE reactions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "reactions_read_all"   ON reactions;
DROP POLICY IF EXISTS "reactions_insert_own" ON reactions;
DROP POLICY IF EXISTS "reactions_delete_own" ON reactions;
CREATE POLICY "reactions_read_all"   ON reactions FOR SELECT USING (true);
CREATE POLICY "reactions_insert_own" ON reactions FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "reactions_delete_own" ON reactions FOR DELETE USING  (auth.uid() = user_id);

-- ── SAVED_ITEMS ───────────────────────────────────────────────
ALTER TABLE saved_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "saved_items_select_own" ON saved_items;
DROP POLICY IF EXISTS "saved_items_insert_own" ON saved_items;
DROP POLICY IF EXISTS "saved_items_delete_own" ON saved_items;
CREATE POLICY "saved_items_select_own" ON saved_items FOR SELECT USING  (auth.uid() = user_id);
CREATE POLICY "saved_items_insert_own" ON saved_items FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "saved_items_delete_own" ON saved_items FOR DELETE USING  (auth.uid() = user_id);

-- ── SCRAPED_LEADS ─────────────────────────────────────────────
-- Authenticated users only (leads dashboard); heavy writes via service_role
ALTER TABLE scraped_leads ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth read leads"   ON scraped_leads;
DROP POLICY IF EXISTS "auth update leads" ON scraped_leads;
CREATE POLICY "auth read leads"   ON scraped_leads FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "auth update leads" ON scraped_leads FOR UPDATE USING (auth.uid() IS NOT NULL);

-- ── ADD MISSING COLUMNS (safe) ────────────────────────────────
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS verif_status      TEXT    DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS verif_request     TEXT,
  ADD COLUMN IF NOT EXISTS is_verified       BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS subscription_type TEXT    DEFAULT 'free',
  ADD COLUMN IF NOT EXISTS trial_expires_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS suspended         BOOLEAN DEFAULT false;

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS approved BOOLEAN DEFAULT true;

-- ── VERIFY ────────────────────────────────────────────────────
-- SELECT tablename, count(*) FROM pg_policies WHERE schemaname='public' GROUP BY tablename ORDER BY tablename;
