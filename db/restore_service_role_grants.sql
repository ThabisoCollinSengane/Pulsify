-- Restore lost table grants (28 Nov 2026).
-- Postgres logs showed the API (service_role) getting "permission denied" on feature_flags,
-- so flagEnabled() failed closed and every feature flag read as OFF. A check found
-- service_role had no privileges at all on 19 public tables (payments, pending_emails,
-- event_likes, promotions, venues, post_reposts, report tables, leads, tiktok_leads,
-- admin_activity_log, feature_flags, ...), so every API route touching them failed.
-- service_role is server-only and bypasses RLS by design; this is Supabase's default grant.

grant all on all tables in schema public to service_role;
alter default privileges for role postgres in schema public grant all on tables to service_role;

-- Grants the repo already defines but which were missing live:
grant select on public.feature_flags to anon, authenticated;   -- db/feature_flags_fn.sql
grant select on public.reactions to anon;                      -- db/schema_additions.sql (like counts for signed-out visitors)
-- Signed-out visitors opening a profile (followers, going-to, reposts). RLS still applies:
-- attendances_select → can_view_attended() hides history for users who turned it off.
grant select on public.follows to anon;                        -- db/schema_additions.sql:183
grant select on public.event_attendances to anon;              -- db/schema_additions.sql:186
grant select on public.reposts to anon;                        -- db/schema_additions.sql:177
