-- Add `user_id` to pickup_orders so signed-in customers can see their own orders.
--
-- Why: the API already reads and writes this column, but it was never added to
-- the table (see db/schema_additions.sql, which creates pickup_orders without
-- user_id). As a result both paths silently fail today:
--   * POST /pickup-order (api/index.js) inserts `user_id: placing_user_id`
--     whenever the order is placed with a logged-in token.
--   * GET /user/pickup-orders (api/index.js) filters `.eq('user_id', user.id)`
--     to list a customer's own order history.
-- Without the column, PostgREST rejects the insert key / filter on an unknown
-- column, so a customer's orders can never be linked to or listed for them.
--
-- ON DELETE SET NULL (not CASCADE, which the app uses for engagement rows like
-- likes/follows): a pickup order is a transactional record the *business* owns
-- and must keep for its own order history. Deleting the customer's profile must
-- not erase the business's order. The column is nullable regardless — guest
-- checkouts (no token) legitimately store user_id = NULL.
--
-- RLS: unchanged. pickup_orders' reads/writes go through the service-role
-- client (sb()), which is RLS-exempt, so no new policy is needed here.
--
-- Idempotent: safe to run more than once.

ALTER TABLE pickup_orders
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_orders_user ON pickup_orders(user_id);
