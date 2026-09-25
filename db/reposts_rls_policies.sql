-- Reposts RLS policies (clean reset)
-- Writes go through the server (POST /api/reposts, service role), but the
-- profile timeline reads the reposts table directly from the browser client,
-- so a clean, purely-permissive policy set is required for SELECT. Drop every
-- prior policy (including earlier duplicates that may have been restrictive)
-- and recreate a known-good set: public SELECT, owner-only INSERT/DELETE,
-- service-role full access.

DROP POLICY IF EXISTS "public_reposts_read"  ON reposts;
DROP POLICY IF EXISTS "own_reposts_insert"   ON reposts;
DROP POLICY IF EXISTS "own_reposts_delete"   ON reposts;
DROP POLICY IF EXISTS "service_all_reposts"  ON reposts;
DROP POLICY IF EXISTS "reposts_read_all"     ON reposts;
DROP POLICY IF EXISTS "reposts_insert_own"   ON reposts;
DROP POLICY IF EXISTS "reposts_delete_own"   ON reposts;

CREATE POLICY "public_reposts_read" ON reposts
  AS PERMISSIVE FOR SELECT USING (true);

CREATE POLICY "own_reposts_insert" ON reposts
  AS PERMISSIVE FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "own_reposts_delete" ON reposts
  AS PERMISSIVE FOR DELETE USING (auth.uid() = user_id);

CREATE POLICY "service_all_reposts" ON reposts
  AS PERMISSIVE FOR ALL USING (auth.role() = 'service_role');
