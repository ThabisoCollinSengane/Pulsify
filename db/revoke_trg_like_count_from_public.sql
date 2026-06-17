-- Close the RPC exposure on trg_like_count() (advisor 0028/0029).
--
-- trg_like_count() is a SECURITY DEFINER trigger function (keeps
-- events.like_count in sync on event_likes INSERT/DELETE). Postgres grants
-- EXECUTE to PUBLIC by default, so anon/authenticated could invoke it directly
-- via PostgREST (/rest/v1/rpc/trg_like_count). A trigger fn should never be a
-- public RPC. Revoking from PUBLIC leaves only postgres with EXECUTE.
--
-- Trigger firing is UNAFFECTED — the engine runs trigger functions without
-- consulting EXECUTE privileges. Verified after applying: the trg_like_count
-- trigger is still attached to public.event_likes and enabled.
--
-- Applied to production via the Supabase migration
-- `revoke_trg_like_count_from_public`.

REVOKE EXECUTE ON FUNCTION public.trg_like_count() FROM PUBLIC;
