-- Follow-up tasks for leads. Applied 2026-06-19.
CREATE TABLE IF NOT EXISTS lead_followups (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id    UUID NOT NULL REFERENCES scraped_leads(id) ON DELETE CASCADE,
  due_date   DATE NOT NULL,
  note       TEXT,
  completed  BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE lead_followups ENABLE ROW LEVEL SECURITY;
GRANT ALL ON lead_followups TO service_role;
CREATE POLICY admin_lead_followups ON lead_followups FOR ALL TO public
  USING (EXISTS (
    SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
  ));
