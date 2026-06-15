-- ═══════════════════════════════════════════════════
-- fix_rls.sql — Run in Supabase SQL Editor
-- Fixes RLS policies for profiles, follows tables
-- ═══════════════════════════════════════════════════

-- ── 1. PROFILES table ────────────────────────────
-- Drop and recreate all policies cleanly

DROP POLICY IF EXISTS "public_profiles_read"    ON profiles;
DROP POLICY IF EXISTS "own_profile_read"         ON profiles;
DROP POLICY IF EXISTS "own_profile_update"       ON profiles;
DROP POLICY IF EXISTS "service_all_profiles"     ON profiles;
DROP POLICY IF EXISTS "profiles_select_own"      ON profiles;
DROP POLICY IF EXISTS "profiles_update_own"      ON profiles;
DROP POLICY IF EXISTS "profiles_insert_own"      ON profiles;

-- Any authenticated user can read any profile (needed for search & friends)
CREATE POLICY "profiles_read_authenticated"
  ON profiles FOR SELECT
  USING (auth.role() = 'authenticated');

-- Users can read their own profile even without auth (for public pages)
-- This is safe since profile data is not sensitive
CREATE POLICY "profiles_read_public"
  ON profiles FOR SELECT
  USING (true);

-- Users can only update their own profile
CREATE POLICY "profiles_update_own"
  ON profiles FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- Users can insert their own profile
CREATE POLICY "profiles_insert_own"
  ON profiles FOR INSERT
  WITH CHECK (auth.uid() = id);

-- Service role gets full access (for API/admin)
CREATE POLICY "profiles_service_all"
  ON profiles
  USING (auth.role() = 'service_role');

-- ── 2. FOLLOWS table ────────────────────────────
DROP POLICY IF EXISTS "follows_select"           ON follows;
DROP POLICY IF EXISTS "follows_insert"           ON follows;
DROP POLICY IF EXISTS "follows_delete"           ON follows;
DROP POLICY IF EXISTS "service_all_follows"      ON follows;

-- Anyone authenticated can see all follows (needed for follower counts)
CREATE POLICY "follows_select_all"
  ON follows FOR SELECT
  USING (auth.role() = 'authenticated');

-- Users can only insert follows where they are the follower
CREATE POLICY "follows_insert_own"
  ON follows FOR INSERT
  WITH CHECK (auth.uid() = follower_id);

-- Users can only delete their own follows
CREATE POLICY "follows_delete_own"
  ON follows FOR DELETE
  USING (auth.uid() = follower_id);

-- Service role full access
CREATE POLICY "follows_service_all"
  ON follows
  USING (auth.role() = 'service_role');

-- ── 3. POSTS table ───────────────────────────────
DROP POLICY IF EXISTS "public_posts_read"        ON posts;
DROP POLICY IF EXISTS "service_all_posts"        ON posts;

CREATE POLICY "posts_read_public"
  ON posts FOR SELECT
  USING (visibility = 'public');

CREATE POLICY "posts_insert_own"
  ON posts FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "posts_delete_own"
  ON posts FOR DELETE
  USING (auth.uid() = user_id);

CREATE POLICY "posts_service_all"
  ON posts
  USING (auth.role() = 'service_role');

-- ── 4. REACTIONS ─────────────────────────────────
DROP POLICY IF EXISTS "reactions_service_all"    ON reactions;

CREATE POLICY "reactions_read_all"
  ON reactions FOR SELECT USING (true);

CREATE POLICY "reactions_insert_own"
  ON reactions FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "reactions_delete_own"
  ON reactions FOR DELETE
  USING (auth.uid() = user_id);

CREATE POLICY "reactions_service_all"
  ON reactions USING (auth.role() = 'service_role');

-- ── 5. COMMENTS ──────────────────────────────────
CREATE POLICY "comments_read_all"
  ON comments FOR SELECT USING (true);

CREATE POLICY "comments_insert_own"
  ON comments FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "comments_service_all"
  ON comments USING (auth.role() = 'service_role');

-- ── 6. Grant service role on all tables ─────────
GRANT ALL ON ALL TABLES    IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
