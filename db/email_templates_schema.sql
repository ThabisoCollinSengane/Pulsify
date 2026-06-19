-- DB-backed email templates with {{name}} {{business_name}} {{city}} merge vars.
-- Applied 2026-06-19. Seeded with intro / followup / convert defaults.
CREATE TABLE IF NOT EXISTS email_templates (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key        TEXT UNIQUE NOT NULL,
  name       TEXT NOT NULL,
  subject    TEXT NOT NULL,
  body       TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE email_templates ENABLE ROW LEVEL SECURITY;
GRANT ALL ON email_templates TO service_role;
CREATE POLICY admin_email_templates ON email_templates FOR ALL TO public
  USING (EXISTS (
    SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
  ));
