-- ============================================================
-- Pulsify — Full RLS Policy Fix
-- Run this in: Supabase Dashboard → SQL Editor → New Query
-- ============================================================
-- Root cause: RLS is enabled on all tables but no SELECT
-- policies exist for anon/authenticated, so every read returns 403.
-- This script adds the minimum policies needed for the app to work.
-- ============================================================

-- ── EVENTS ──────────────────────────────────────────────────
-- Public: anyone can read events (landing page, map)
-- Auth: organizers/businesses can insert their own events
-- Auth: owner can update/delete their own events

ALTER TABLE events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "events_select_public" ON events;
DROP POLICY IF EXISTS "events_insert_auth" ON events;
DROP POLICY IF EXISTS "events_update_own" ON events;
DROP POLICY IF EXISTS "events_delete_own" ON events;

CREATE POLICY "events_select_public"
  ON events FOR SELECT
  USING (true);

CREATE POLICY "events_insert_auth"
  ON events FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "events_update_own"
  ON events FOR UPDATE
  USING (auth.uid()::text = organiser_id::text);

CREATE POLICY "events_delete_own"
  ON events FOR DELETE
  USING (auth.uid()::text = organiser_id::text);

-- ── BUSINESSES ───────────────────────────────────────────────
-- Public: anyone can read businesses (map, discovery)
-- Auth: owner can update their own business listing

ALTER TABLE businesses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "businesses_select_public" ON businesses;
DROP POLICY IF EXISTS "businesses_update_own" ON businesses;

CREATE POLICY "businesses_select_public"
  ON businesses FOR SELECT
  USING (true);

CREATE POLICY "businesses_update_own"
  ON businesses FOR UPDATE
  USING (auth.uid()::text = owner_id::text);

-- ── POSTS ────────────────────────────────────────────────────
-- Auth: any logged-in user can read all posts (community feed)
-- Auth: any logged-in user can insert their own posts
-- Auth: owner can delete their own posts

ALTER TABLE posts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "posts_select_auth" ON posts;
DROP POLICY IF EXISTS "posts_insert_own" ON posts;
DROP POLICY IF EXISTS "posts_delete_own" ON posts;

CREATE POLICY "posts_select_auth"
  ON posts FOR SELECT
  USING (true);

CREATE POLICY "posts_insert_own"
  ON posts FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "posts_delete_own"
  ON posts FOR DELETE
  USING (auth.uid() = user_id);

-- ── PROFILES ─────────────────────────────────────────────────
-- Auth: any logged-in user can read all profiles (social features)
-- Auth: user can update only their own profile

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "profiles_select_auth" ON profiles;
DROP POLICY IF EXISTS "profiles_update_own" ON profiles;
DROP POLICY IF EXISTS "profiles_insert_own" ON profiles;

CREATE POLICY "profiles_select_auth"
  ON profiles FOR SELECT
  USING (true);

CREATE POLICY "profiles_insert_own"
  ON profiles FOR INSERT
  WITH CHECK (auth.uid() = id);

CREATE POLICY "profiles_update_own"
  ON profiles FOR UPDATE
  USING (auth.uid() = id);

-- ── FOLLOWS ──────────────────────────────────────────────────
-- Auth: any logged-in user can see all follows (follower counts)
-- Auth: user can insert/delete their own follows

ALTER TABLE follows ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "follows_select_auth" ON follows;
DROP POLICY IF EXISTS "follows_insert_own" ON follows;
DROP POLICY IF EXISTS "follows_delete_own" ON follows;

CREATE POLICY "follows_select_auth"
  ON follows FOR SELECT
  USING (true);

CREATE POLICY "follows_insert_own"
  ON follows FOR INSERT
  WITH CHECK (auth.uid() = follower_id);

CREATE POLICY "follows_delete_own"
  ON follows FOR DELETE
  USING (auth.uid() = follower_id);

-- ── NOTIFICATIONS ─────────────────────────────────────────────
-- Auth: user can only read their own notifications
-- Auth: any authenticated user can INSERT notifications (to notify others)
-- Auth: user can update (mark read) only their own notifications

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "notifications_select_own" ON notifications;
DROP POLICY IF EXISTS "notifications_insert_auth" ON notifications;
DROP POLICY IF EXISTS "notifications_update_own" ON notifications;

CREATE POLICY "notifications_select_own"
  ON notifications FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "notifications_insert_auth"
  ON notifications FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "notifications_update_own"
  ON notifications FOR UPDATE
  USING (auth.uid() = user_id);

-- ── COMMENTS ─────────────────────────────────────────────────
-- Auth: any logged-in user can read comments on public posts
-- Auth: user can insert/delete their own comments

ALTER TABLE comments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "comments_select_auth" ON comments;
DROP POLICY IF EXISTS "comments_insert_own" ON comments;
DROP POLICY IF EXISTS "comments_delete_own" ON comments;

CREATE POLICY "comments_select_auth"
  ON comments FOR SELECT
  USING (true);

CREATE POLICY "comments_insert_own"
  ON comments FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "comments_delete_own"
  ON comments FOR DELETE
  USING (auth.uid() = user_id);

-- ── LIKES ────────────────────────────────────────────────────
-- (if table exists)

DO $$ BEGIN
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'likes') THEN
    ALTER TABLE likes ENABLE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS "likes_select_auth" ON likes;
    DROP POLICY IF EXISTS "likes_insert_own" ON likes;
    DROP POLICY IF EXISTS "likes_delete_own" ON likes;

    CREATE POLICY "likes_select_auth"
      ON likes FOR SELECT USING (true);

    CREATE POLICY "likes_insert_own"
      ON likes FOR INSERT
      WITH CHECK (auth.uid() = user_id);

    CREATE POLICY "likes_delete_own"
      ON likes FOR DELETE
      USING (auth.uid() = user_id);
  END IF;
END $$;

-- ── SAVED_POSTS ──────────────────────────────────────────────
-- (if table exists)

DO $$ BEGIN
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'saved_posts') THEN
    ALTER TABLE saved_posts ENABLE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS "saved_select_own" ON saved_posts;
    DROP POLICY IF EXISTS "saved_insert_own" ON saved_posts;
    DROP POLICY IF EXISTS "saved_delete_own" ON saved_posts;

    CREATE POLICY "saved_select_own"
      ON saved_posts FOR SELECT USING (auth.uid() = user_id);

    CREATE POLICY "saved_insert_own"
      ON saved_posts FOR INSERT WITH CHECK (auth.uid() = user_id);

    CREATE POLICY "saved_delete_own"
      ON saved_posts FOR DELETE USING (auth.uid() = user_id);
  END IF;
END $$;

-- ── EVENT_PHOTOS ─────────────────────────────────────────────
-- (if table exists)

DO $$ BEGIN
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'event_photos') THEN
    ALTER TABLE event_photos ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "event_photos_select_public" ON event_photos;
    CREATE POLICY "event_photos_select_public"
      ON event_photos FOR SELECT USING (true);
  END IF;
END $$;

-- ── TICKET_TIERS ─────────────────────────────────────────────
-- (if table exists)

DO $$ BEGIN
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'ticket_tiers') THEN
    ALTER TABLE ticket_tiers ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "ticket_tiers_select_public" ON ticket_tiers;
    CREATE POLICY "ticket_tiers_select_public"
      ON ticket_tiers FOR SELECT USING (true);
  END IF;
END $$;

-- ── SCRAPED_LEADS ─────────────────────────────────────────────
-- Admin only — no anon or user access. API uses service_role key.

DO $$ BEGIN
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'scraped_leads') THEN
    ALTER TABLE scraped_leads ENABLE ROW LEVEL SECURITY;
    -- No public policies — only service_role (used in api/index.js) can access
  END IF;
END $$;

-- ============================================================
-- ADD MISSING COLUMNS (safe — uses IF NOT EXISTS)
-- ============================================================

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS verif_status TEXT DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS verif_request TEXT,
  ADD COLUMN IF NOT EXISTS is_verified BOOLEAN DEFAULT false;

-- ============================================================
-- STORAGE: allow anon to read public post images
-- ============================================================
-- Run this separately in Supabase Dashboard → Storage → Policies
-- if post images aren't loading:
--
-- Policy: "Public read on post-images bucket"
-- Bucket: post-images
-- Operation: SELECT
-- Policy: true   (allows everyone)
-- ============================================================

-- Done. Verify by running:
-- SELECT schemaname, tablename, policyname, cmd, qual FROM pg_policies WHERE schemaname = 'public' ORDER BY tablename;
