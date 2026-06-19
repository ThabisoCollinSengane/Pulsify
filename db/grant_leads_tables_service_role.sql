-- Applied 2026-06-19: service_role was missing table-level grants on lead_events
-- and profile_claims. rolbypassrls bypasses RLS but NOT ACL checks — same root
-- cause as the squad_promos/deals/banners 403 fixed in PR #92.
GRANT ALL ON public.lead_events    TO service_role;
GRANT ALL ON public.profile_claims TO service_role;
