-- Run in Supabase SQL Editor (or apply as a migration)
-- Reconstructed from live DB 2026-06-19; table was created directly in Supabase.
CREATE TABLE IF NOT EXISTS lead_events (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  lead_id            UUID NOT NULL REFERENCES scraped_leads(id) ON DELETE CASCADE,
  title              TEXT NOT NULL,
  description        TEXT,
  genre              TEXT DEFAULT 'nightlife',
  event_date         DATE,
  event_time         TIME,
  venue_name         TEXT,
  venue_city         TEXT,
  venue_address      TEXT,
  image_url          TEXT,
  source_url         TEXT,
  organiser_name     TEXT,
  is_free            BOOLEAN DEFAULT false,
  price_min          NUMERIC,
  status             TEXT DEFAULT 'pending',  -- 'pending'|'approved'|'rejected'
  admin_notes        TEXT,
  published_event_id TEXT,  -- set to events.id when approved
  created_at         TIMESTAMPTZ DEFAULT now(),
  updated_at         TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE lead_events ENABLE ROW LEVEL SECURITY;

-- Admin-only access via authenticated JWT
CREATE POLICY admin_lead_events ON lead_events
  FOR ALL TO public
  USING (EXISTS (
    SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
  ));

-- service_role needs explicit table grant (rolbypassrls bypasses RLS but NOT ACL)
GRANT ALL ON public.lead_events TO service_role;
