-- Migration: add user_id to pickup_orders
-- Run in Supabase SQL Editor
ALTER TABLE pickup_orders ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES profiles(id);
CREATE INDEX IF NOT EXISTS idx_orders_user ON pickup_orders(user_id);
