-- Organiser payouts: ticket money is held in Pulsify's Paystack balance and paid out
-- 2 business days after the event by lib/payouts.js (run from api/cron/event-cleanup.js).
-- Gated by the `payouts_auto` feature flag; while it's off the cron only reports what's due.

CREATE TABLE IF NOT EXISTS public.organiser_payouts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id      text NOT NULL REFERENCES public.events(id),
  organiser_id  uuid NOT NULL REFERENCES public.profiles(id),
  amount        numeric(12,2) NOT NULL CHECK (amount > 0),
  status        text NOT NULL DEFAULT 'processing' CHECK (status IN ('processing','paid','failed')),
  reference     text UNIQUE NOT NULL,
  transfer_code text,
  error         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_organiser_payouts_organiser ON public.organiser_payouts(organiser_id);
CREATE INDEX IF NOT EXISTS idx_organiser_payouts_event ON public.organiser_payouts(event_id);

ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS payout_id uuid REFERENCES public.organiser_payouts(id);
CREATE INDEX IF NOT EXISTS idx_bookings_payout ON public.bookings(payout_id);

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS paystack_recipient_code text;

-- Organisers can see their own payouts; only the service role writes.
ALTER TABLE public.organiser_payouts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.organiser_payouts FROM anon, authenticated;
GRANT SELECT ON public.organiser_payouts TO authenticated;
DROP POLICY IF EXISTS organiser_payouts_read_own ON public.organiser_payouts;
CREATE POLICY organiser_payouts_read_own ON public.organiser_payouts FOR SELECT TO authenticated
  USING (organiser_id = (SELECT auth.uid()) OR public.is_admin());

INSERT INTO public.feature_flags (key, enabled, notes)
VALUES ('payouts_auto', false, 'When on, the daily cron sends organiser payouts via Paystack Transfers 2 business days after each event. Off = report only.')
ON CONFLICT (key) DO NOTHING;
