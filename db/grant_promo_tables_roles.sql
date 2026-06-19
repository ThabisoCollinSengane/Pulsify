-- Grants for the Discover promo tables: squad_promos, deals, banners
-- Applied 2026-06-19.
--
-- Symptom: home-feed "Squad Deals" strip + squad-overlay "Deals" tab showed
-- nothing; API logs showed repeated 403 "permission denied for table
-- squad_promos / deals / banners" on /rest/v1/* calls (user-agent node = the
-- api/index.js server using sb()).
--
-- Root cause: these three tables were created without Supabase's default role
-- grants. The admin API client sb() uses the SERVICE key (role=service_role).
-- service_role has rolbypassrls=true, which bypasses RLS policies but NOT the
-- table-level ACL grant — so the query was denied at the privilege layer before
-- any RLS policy ran. squad_promos even had a service_role RLS policy, which was
-- dead weight without the matching GRANT.
--
-- Fix: grant table privileges to every role the app uses.
--   anon / authenticated → public read (RLS still narrows the rows)
--   service_role         → full access for the admin API + cron

GRANT SELECT ON public.squad_promos TO anon, authenticated;
GRANT SELECT ON public.deals        TO anon, authenticated;
GRANT SELECT ON public.banners      TO anon, authenticated;

GRANT ALL ON public.squad_promos TO service_role;
GRANT ALL ON public.deals        TO service_role;
GRANT ALL ON public.banners      TO service_role;
