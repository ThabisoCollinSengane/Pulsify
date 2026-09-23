-- Email send queue — transactional email moved off the hot request path.
-- The api/cron/email-queue cron drains this table every 15 minutes (up to 3 attempts).
CREATE TABLE IF NOT EXISTS pending_emails (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  type            text        NOT NULL,
  recipient_email text        NOT NULL,
  payload         jsonb       NOT NULL DEFAULT '{}',
  status          text        NOT NULL DEFAULT 'pending'
                              CHECK (status IN ('pending','sent','failed')),
  attempts        int         NOT NULL DEFAULT 0,
  last_error      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  sent_at         timestamptz
);

CREATE INDEX IF NOT EXISTS idx_pending_emails_status
  ON pending_emails(status, created_at);

ALTER TABLE pending_emails ENABLE ROW LEVEL SECURITY;
-- No policies — service_role only.

-- Required Data API grants (Supabase Oct 30 change)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pending_emails TO service_role;
