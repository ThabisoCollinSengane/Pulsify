-- Reposts RLS policies
-- `reposts` had RLS ENABLED but no policies, so authenticated INSERT/DELETE
-- were blocked (reposts never persisted) and SELECT returned 0 rows (repost
-- button never showed active, reposts never surfaced on a user's timeline).
-- Reposts are public social signals (like retweets): readable by everyone,
-- writable only by their owner.

DROP POLICY IF EXISTS "public_reposts_read"  ON reposts;
DROP POLICY IF EXISTS "own_reposts_insert"   ON reposts;
DROP POLICY IF EXISTS "own_reposts_delete"   ON reposts;
DROP POLICY IF EXISTS "service_all_reposts"  ON reposts;

CREATE POLICY "public_reposts_read" ON reposts
  FOR SELECT USING (true);

CREATE POLICY "own_reposts_insert" ON reposts
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "own_reposts_delete" ON reposts
  FOR DELETE USING (auth.uid() = user_id);

CREATE POLICY "service_all_reposts" ON reposts
  USING (auth.role() = 'service_role');
