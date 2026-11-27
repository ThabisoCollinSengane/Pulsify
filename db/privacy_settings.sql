-- Privacy settings: make the profile-settings privacy controls real and enforced (27 Nov 2026).
--   profile_visibility  'public' | 'followers'  — followers-only hides posts + attended events
--   comment_permission  'everyone' | 'followers' | 'nobody' — who may comment on your posts
--   show_attended       boolean — show the events you attended on your profile
-- Following stays instant (no follow requests yet). "Show email" was dropped: emails are never public.
-- The new columns are NOT added to the anon/authenticated column SELECT grant; owners read their
-- own values through my_profile(), everyone else through get_profile_privacy().

alter table public.profiles
  add column if not exists profile_visibility text not null default 'public'
    check (profile_visibility in ('public', 'followers')),
  add column if not exists comment_permission text not null default 'everyone'
    check (comment_permission in ('everyone', 'followers', 'nobody')),
  add column if not exists show_attended boolean not null default true;

-- Can the current viewer (auth.uid(), null for anon) see p_owner's private content?
create or replace function public.can_view_private(p_owner uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    p_owner = (select auth.uid())
    or coalesce((select profile_visibility from profiles where id = p_owner), 'public') = 'public'
    or exists (select 1 from follows where follower_id = (select auth.uid()) and following_id = p_owner),
  false);
$$;

-- Can the current viewer see p_owner's attended events? (Used by the event_attendances policy;
-- security definer because show_attended is not in the client column grant.)
create or replace function public.can_view_attended(p_owner uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    p_owner = (select auth.uid())
    or (coalesce((select show_attended from profiles where id = p_owner), true)
        and public.can_view_private(p_owner)),
  false);
$$;

-- Can the current viewer comment on p_owner's posts?
create or replace function public.can_comment_on(p_owner uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    (select auth.uid()) is not null and (
      p_owner = (select auth.uid())
      or case coalesce((select comment_permission from profiles where id = p_owner), 'everyone')
           when 'everyone'  then true
           when 'followers' then exists (select 1 from follows
                                         where follower_id = (select auth.uid()) and following_id = p_owner)
           else false
         end),
  false);
$$;

-- One call for profile pages and comment sheets.
create or replace function public.get_profile_privacy(p_owner uuid)
returns table (can_view boolean, show_attended boolean, can_comment boolean)
language sql stable security definer set search_path = public as $$
  select public.can_view_private(p_owner),
         public.can_view_attended(p_owner),
         public.can_comment_on(p_owner);
$$;

revoke all on function public.can_view_private(uuid), public.can_view_attended(uuid),
                       public.can_comment_on(uuid), public.get_profile_privacy(uuid) from public;
grant execute on function public.can_view_private(uuid), public.can_view_attended(uuid),
                          public.can_comment_on(uuid), public.get_profile_privacy(uuid) to anon, authenticated, service_role;

-- Posts: replace the two read policies ("public read posts" was USING (true), which also exposed
-- non-public posts) with one that respects profile_visibility. Authors always see their own.
drop policy if exists "public read posts" on public.posts;
drop policy if exists posts_read_public on public.posts;
create policy posts_select on public.posts for select using (
  user_id = (select auth.uid())
  or (visibility = 'public' and public.can_view_private(user_id))
);

-- Attended events: own rows always (attend_own also covers this); others only when the owner
-- shows them and the viewer may see the profile.
drop policy if exists attendances_select on public.event_attendances;
create policy attendances_select on public.event_attendances for select using (
  public.can_view_attended(user_id)
);

-- Comments: enforce comment_permission on post comments inside the database.
create or replace function public.enforce_comment_permission()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_owner uuid;
begin
  if not is_client_call() or new.entity_type <> 'post' then return new; end if;
  select user_id into v_owner from posts where id::text = new.entity_id;
  if v_owner is not null and not public.can_comment_on(v_owner) then
    raise exception 'COMMENTS_NOT_ALLOWED' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function public.enforce_comment_permission() from public, anon, authenticated;

drop trigger if exists trg_enforce_comment_permission on public.comments;
create trigger trg_enforce_comment_permission before insert on public.comments
  for each row execute function public.enforce_comment_permission();

-- ── Round 2 (review fixes) ──────────────────────────────────────────────────
-- Commenting also requires being able to see the post (followers-only author).
create or replace function public.can_comment_on(p_owner uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    (select auth.uid()) is not null and public.can_view_private(p_owner) and (
      p_owner = (select auth.uid())
      or case coalesce((select comment_permission from profiles where id = p_owner), 'everyone')
           when 'everyone'  then true
           when 'followers' then exists (select 1 from follows
                                         where follower_id = (select auth.uid()) and following_id = p_owner)
           else false
         end),
  false);
$$;

-- Comments on a followers-only author's post are hidden like the post itself.
create or replace function public.can_view_post(p_post text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select public.can_view_private(user_id) from posts where id::text = p_post), true);
$$;
revoke all on function public.can_view_post(text) from public;
grant execute on function public.can_view_post(text) to anon, authenticated, service_role;

drop policy if exists cmt_select on public.comments;
create policy cmt_select on public.comments for select using (
  entity_type <> 'post' or user_id = (select auth.uid()) or public.can_view_post(entity_id)
);
