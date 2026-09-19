-- Add score column to scraped_leads (used by tiktok-leads cron)
ALTER TABLE scraped_leads ADD COLUMN IF NOT EXISTS score INTEGER;
CREATE INDEX IF NOT EXISTS idx_scraped_leads_score ON scraped_leads(score DESC);
