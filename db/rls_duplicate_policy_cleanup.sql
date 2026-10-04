-- NOT YET APPLIED (Supabase asks a person to confirm DROP statements).
-- Removes exact-duplicate / subsumed permissive RLS policies + one duplicate index.
-- Access is unchanged: every dropped policy is identical to, or covered by, one that stays.
-- service_role bypasses RLS, so "auth.role() = 'service_role'" policies are no-ops.
-- Run in Supabase → SQL Editor, then re-run db/tests/rls_attack.sql.
DROP POLICY IF EXISTS own_reposts_delete ON public.reposts;
DROP POLICY IF EXISTS own_reposts_insert ON public.reposts;
DROP POLICY IF EXISTS public_reposts_read ON public.reposts;
DROP POLICY IF EXISTS service_all_reposts ON public.reposts;
DROP POLICY IF EXISTS reactions_delete_own ON public.reactions;
DROP POLICY IF EXISTS reactions_insert_own ON public.reactions;
DROP POLICY IF EXISTS reactions_read_all ON public.reactions;
DROP POLICY IF EXISTS attend_own ON public.event_attendances;
DROP POLICY IF EXISTS siza_knowledge_organizer ON public.event_siza_knowledge;
DROP POLICY IF EXISTS siza_knowledge_service ON public.event_siza_knowledge;
DROP POLICY IF EXISTS events_service_all ON public.events;
DROP POLICY IF EXISTS notif_service_all ON public.notifications;
DROP POLICY IF EXISTS tiers_service_all ON public.ticket_tiers;
DROP POLICY IF EXISTS public_banners ON public.banners;
DROP POLICY IF EXISTS banners_delete_service ON public.banners;
DROP POLICY IF EXISTS banners_insert_service ON public.banners;
DROP POLICY IF EXISTS banners_update_service ON public.banners;
DROP POLICY IF EXISTS "public read active promotions" ON public.promotions;
DROP POLICY IF EXISTS public_promotions ON public.promotions;
DROP POLICY IF EXISTS "owner insert squad_promos" ON public.squad_promos;
DROP POLICY IF EXISTS "public read approved squad_promos" ON public.squad_promos;
DROP POLICY IF EXISTS "owner read own squad_promos" ON public.squad_promos;
DROP POLICY IF EXISTS owners_update_pending ON public.squad_promos;
DROP POLICY IF EXISTS scraped_leads_select_admin ON public.scraped_leads;
DROP POLICY IF EXISTS scraped_leads_update_admin ON public.scraped_leads;
DROP POLICY IF EXISTS squad_points_select ON public.squad_points;

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT (array_agg(i.indexrelid::regclass::text ORDER BY i.indexrelid::regclass::text))[2] AS dupe
      FROM pg_index i
     WHERE i.indrelid = 'public.event_siza_knowledge'::regclass AND NOT i.indisprimary AND NOT i.indisunique
     GROUP BY i.indkey::text, coalesce(i.indexprs::text,''), coalesce(i.indpred::text,'')
    HAVING count(*) > 1
  LOOP
    EXECUTE format('DROP INDEX IF EXISTS %s', r.dupe);
  END LOOP;
END $$;
