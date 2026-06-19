-- RLS policies and grants for squad_promos table
-- Applied 2026-06-19: table had RLS on but no policies/grants, causing
-- the anon API key to get permission denied → "Could not load deals"

GRANT SELECT ON public.squad_promos TO anon, authenticated;
GRANT INSERT, UPDATE ON public.squad_promos TO authenticated;

-- Public can read approved, active deals
CREATE POLICY "public read approved squad_promos"
  ON public.squad_promos FOR SELECT
  TO anon, authenticated
  USING (approved = true AND is_active = true);

-- Owners can see their own regardless of approval status
CREATE POLICY "owner read own squad_promos"
  ON public.squad_promos FOR SELECT
  TO authenticated
  USING (auth.uid() = owner_id);

-- Owners can create and update their own deals
CREATE POLICY "owner insert squad_promos"
  ON public.squad_promos FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "owner update own squad_promos"
  ON public.squad_promos FOR UPDATE
  TO authenticated
  USING (auth.uid() = owner_id);

-- service_role (admin API, cron) has unrestricted access
CREATE POLICY "service_role full access squad_promos"
  ON public.squad_promos FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);
