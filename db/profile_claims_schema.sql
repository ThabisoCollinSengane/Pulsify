-- Run in Supabase SQL Editor (or apply as a migration)
-- Reconstructed from live DB 2026-06-19; table was created directly in Supabase.
-- Flow: public "claim your business" form → admin reviews → status update.
CREATE TABLE IF NOT EXISTS profile_claims (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id     TEXT,                   -- references businesses.id (text PK)
  business_name   TEXT NOT NULL,
  claimant_name   TEXT NOT NULL,
  claimant_email  TEXT NOT NULL,
  claimant_phone  TEXT NOT NULL,
  reason          TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending',  -- 'pending'|'approved'|'rejected'
  admin_notes     TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE profile_claims ENABLE ROW LEVEL SECURITY;

-- No authenticated/anon policies: all access goes through service_role (API only).
-- service_role needs explicit table grant (rolbypassrls bypasses RLS but NOT ACL).
GRANT ALL ON public.profile_claims TO service_role;
