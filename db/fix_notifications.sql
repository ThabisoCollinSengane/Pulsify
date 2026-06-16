-- ================================================================
-- fix_notifications.sql
-- Run in Supabase SQL Editor to fix notifications not working
-- ================================================================

-- 1. Add missing columns the API expects
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS from_user_id      UUID REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS from_display_name TEXT;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS entity_id         TEXT;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS entity_type       TEXT;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS message           TEXT;

-- 2. RLS policies for notifications
--    Service role (API) can do everything
DROP POLICY IF EXISTS "notif_service_all"  ON notifications;
CREATE POLICY "notif_service_all"
  ON notifications
  USING (auth.role() = 'service_role');

--    Authenticated users can read their own notifications (needed for realtime)
DROP POLICY IF EXISTS "notif_select_own"   ON notifications;
CREATE POLICY "notif_select_own"
  ON notifications FOR SELECT
  USING (auth.uid() = user_id);

--    Authenticated users can mark their own notifications read
DROP POLICY IF EXISTS "notif_update_own"   ON notifications;
CREATE POLICY "notif_update_own"
  ON notifications FOR UPDATE
  USING (auth.uid() = user_id);
