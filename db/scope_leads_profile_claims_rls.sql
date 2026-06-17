-- Scope the over-permissive RLS on `leads` and `profile_claims` (roadmap §E).
--
-- Usage review (why this is safe):
--   * No client reads/writes either table directly — there is no
--     .from('leads') or .from('profile_claims') anywhere in apps/.
--   * The lead-gen app (apps/leads) uses the Supabase client for AUTH only;
--     all lead data flows through /api/leads, which operates on a DIFFERENT
--     table, `scraped_leads`.
--   * `profile_claims` is created by POST /claim-profile and read/updated by
--     the admin claim routes — all via the service-role client (sb()), which
--     is exempt from RLS. So removing the anon/authenticated policies cannot
--     break the app.
--
-- What was wrong:
--   * leads: "Auth read leads" (SELECT) and "Auth update leads" (UPDATE) both
--     had qual=true for the `authenticated` role — ANY logged-in user could
--     read and modify every lead (name/email/phone). "Auth insert leads" was
--     likewise unscoped.
--   * profile_claims: "claims_service_all" was granted to the `public` role
--     (not service_role) with cmd=ALL/qual=true — anyone, including anon, could
--     SELECT/UPDATE/DELETE all claims. "claims_public_insert" was unused.
--
-- Fix: enable RLS (idempotent) and drop the permissive policies, leaving zero
-- policies so anon/authenticated have no direct access while service_role keeps
-- full (RLS-exempt) access.
--
-- Applied to production via the Supabase migration `scope_leads_profile_claims_rls`.

ALTER TABLE public.leads          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profile_claims ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Auth read leads"   ON public.leads;
DROP POLICY IF EXISTS "Auth update leads" ON public.leads;
DROP POLICY IF EXISTS "Auth insert leads" ON public.leads;

DROP POLICY IF EXISTS "claims_service_all"   ON public.profile_claims;
DROP POLICY IF EXISTS "claims_public_insert" ON public.profile_claims;
