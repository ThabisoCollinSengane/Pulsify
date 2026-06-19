-- Activity timeline for all CRM actions on a lead.
-- Applied 2026-06-19.
CREATE TABLE IF NOT EXISTS lead_activities (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id    UUID NOT NULL REFERENCES scraped_leads(id) ON DELETE CASCADE,
  type       TEXT NOT NULL,
  -- 'email_sent'|'whatsapp_sent'|'status_changed'|'note_added'
  -- 'follow_up_scheduled'|'follow_up_completed'|'event_created'
  summary    TEXT,
  data       JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE lead_activities ENABLE ROW LEVEL SECURITY;
GRANT ALL ON lead_activities TO service_role;
CREATE POLICY admin_lead_activities ON lead_activities FOR ALL TO public
  USING (EXISTS (
    SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
  ));
