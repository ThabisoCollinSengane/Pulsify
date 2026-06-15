-- Security & scaling hardening — applied to Supabase project cjzewfvtdayjgjdpdmln
-- via MCP migrations on 2026-06-15. Kept here for reproducibility/record.
-- Items: #1 (RLS / function lockdown) and #5 (storage bucket limits).
--
-- Migration 1: harden_function_execute_and_insert_policies
-- Migration 2: revoke_function_execute_from_public
-- Plus a storage.buckets UPDATE (DML, run via execute_sql).

-- ── Trigger-only functions: never meant to be called via RPC ──
revoke execute on function public._pulsify_notify_post_comment() from public, anon, authenticated;
revoke execute on function public._pulsify_notify_post_like()    from public, anon, authenticated;
revoke execute on function public._sync_comment_count()          from public, anon, authenticated;
revoke execute on function public._sync_like_count()             from public, anon, authenticated;
revoke execute on function public._update_squad_member_count()   from public, anon, authenticated;
revoke execute on function public._update_squad_total_points()   from public, anon, authenticated;
revoke execute on function public.notifications_respect_prefs()  from public, anon, authenticated;
revoke execute on function public.trg_notif_on_comment()         from public, anon, authenticated;
revoke execute on function public.trg_notif_on_follow()          from public, anon, authenticated;
revoke execute on function public.trg_notif_on_reaction()        from public, anon, authenticated;
revoke execute on function public.handle_new_user()              from public, anon, authenticated;

-- ── Login-required RPCs: block anon/public, keep authenticated ──
revoke execute on function public.get_friend_suggestions(uuid, integer) from public, anon;
grant  execute on function public.get_friend_suggestions(uuid, integer) to authenticated;
revoke execute on function public.get_squad_plans(uuid, uuid)           from public, anon;
grant  execute on function public.get_squad_plans(uuid, uuid)           to authenticated;
revoke execute on function public.is_squad_member(uuid, uuid)           from public, anon;
grant  execute on function public.is_squad_member(uuid, uuid)           to authenticated;
revoke execute on function public.insert_squad_invite(uuid, uuid, uuid) from public, anon;
grant  execute on function public.insert_squad_invite(uuid, uuid, uuid) to authenticated;
revoke execute on function public.notif_display_name(uuid)              from public, anon;
grant  execute on function public.notif_display_name(uuid)              to authenticated;
-- NOTE: increment_poi_votes(text) intentionally left callable by anon (public map voting).

-- ── Require auth to insert notifications and reports (block anon spam) ──
drop policy if exists notif_insert_any on public.notifications;
create policy notif_insert_authed on public.notifications
  for insert to authenticated with check ((select auth.uid()) is not null);

drop policy if exists insert_business_reports on public.business_reports;
create policy insert_business_reports on public.business_reports
  for insert to authenticated with check ((select auth.uid()) is not null);
drop policy if exists insert_event_reports on public.event_reports;
create policy insert_event_reports on public.event_reports
  for insert to authenticated with check ((select auth.uid()) is not null);
drop policy if exists insert_post_reports on public.post_reports;
create policy insert_post_reports on public.post_reports
  for insert to authenticated with check ((select auth.uid()) is not null);

-- ── #5 Storage: enforce type + size on public image buckets (server-side) ──
update storage.buckets
set file_size_limit = 5242880, -- 5 MB
    allowed_mime_types = array['image/jpeg','image/jpg','image/png','image/webp']
where id in ('avatars','business-images','event-images','event-photos','memories','post-images');

-- ── Deferred (need usage review / dashboard action) ──
-- * leads INSERT/UPDATE USING(true)        — CRM table; scope to admins once confirmed.
-- * profile_claims INSERT/ALL USING(true)  — claim flow; review before tightening.
-- * pickup_orders INSERT anon              — intentional guest checkout; left as-is.
-- * Auth → Leaked Password Protection      — enable in Supabase dashboard (1 click).
-- * pg_trgm extension in public schema     — low risk; move schema later.
