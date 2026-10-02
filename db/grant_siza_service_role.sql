-- Lumi's tables were created without table-level grants for service_role.
-- RLS bypass doesn't help when the role has no privilege on the table at all,
-- so every server-side insert failed with "permission denied" (silently):
-- Lumi had no conversation memory, Lumi ticket orders couldn't be created and
-- organiser knowledge ingest couldn't save. Server-only access — anon and
-- authenticated get nothing (the browser never touches these tables directly).
GRANT SELECT, INSERT, UPDATE, DELETE ON public.siza_conversations   TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.siza_messages        TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.siza_orders          TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_siza_knowledge TO service_role;
