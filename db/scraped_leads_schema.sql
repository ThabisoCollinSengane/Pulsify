-- Run in Supabase SQL Editor
CREATE TABLE IF NOT EXISTS scraped_leads (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name           TEXT NOT NULL,
  category       TEXT DEFAULT 'organizer',  -- 'organizer' | 'business'
  province       TEXT,
  city           TEXT,
  email          TEXT,
  phone          TEXT,
  website        TEXT,
  instagram      TEXT,
  facebook       TEXT,
  tiktok         TEXT,
  source         TEXT DEFAULT 'manual',     -- 'facebook'|'instagram'|'tiktok'|'manual'
  status         TEXT DEFAULT 'new',        -- 'new'|'contacted'|'converted'|'ignored'
  notes          JSONB DEFAULT '[]',
  description    TEXT,
  follower_count INTEGER,
  created_at     TIMESTAMPTZ DEFAULT now(),
  updated_at     TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_leads_status   ON scraped_leads(status);
CREATE INDEX IF NOT EXISTS idx_leads_category ON scraped_leads(category);
CREATE INDEX IF NOT EXISTS idx_leads_province ON scraped_leads(province);
ALTER TABLE scraped_leads ENABLE ROW LEVEL SECURITY;
GRANT ALL ON scraped_leads TO service_role;
