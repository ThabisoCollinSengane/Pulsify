-- Photo posts must go through the API (28 Nov 2026).
-- The API (POST /posts, PATCH /posts/:id) checks that a regular user is within 150 m of a
-- listed business or tonight's event venue before saving a photo. RLS posts_insert_own /
-- posts_update_own would let a browser write posts.image_url directly and skip that check,
-- so client writes that add or change a photo are refused here.
-- Unaffected: the API (service_role), SQL run as postgres, nested triggers, text-only
-- posts, and client updates that leave image_url alone (business dashboard caption edit,
-- user-profile like_count).

create or replace function public.guard_post_photo_write()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not is_client_call() then return new; end if;
  if (tg_op = 'INSERT' and new.image_url is not null)
     or (tg_op = 'UPDATE' and new.image_url is distinct from old.image_url and new.image_url is not null) then
    raise exception 'PHOTO_POSTS_VIA_API' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function public.guard_post_photo_write() from public, anon, authenticated;

drop trigger if exists trg_guard_post_photo_write on public.posts;
create trigger trg_guard_post_photo_write before insert or update on public.posts
  for each row execute function public.guard_post_photo_write();

-- ── Test (run as postgres; everything rolls back) ───────────────────────────────────────
-- Replace <USER_ID> with a real profiles.id and <POST_ID> with one of that user's posts.
-- do $$
-- declare ok boolean;
-- begin
--   perform set_config('request.jwt.claims', '{"sub":"<USER_ID>","role":"authenticated"}', true);
--   set local role authenticated;
--
--   -- 1. direct photo insert → blocked
--   ok := false;
--   begin
--     insert into public.posts (user_id, caption, image_url) values ('<USER_ID>', 't', 'https://x/y.jpg');
--   exception when insufficient_privilege then ok := sqlerrm = 'PHOTO_POSTS_VIA_API'; end;
--   raise notice '1 photo insert blocked: %', ok;
--
--   -- 2. direct text-only insert → allowed
--   insert into public.posts (user_id, caption) values ('<USER_ID>', 'text only');
--   raise notice '2 text insert ok';
--
--   -- 3. caption / like_count update on an existing post → allowed
--   update public.posts set caption = 'edited', like_count = like_count where id = '<POST_ID>';
--   raise notice '3 caption update ok';
--
--   -- 4. direct image_url change → blocked
--   ok := false;
--   begin
--     update public.posts set image_url = 'https://x/new.jpg' where id = '<POST_ID>';
--   exception when insufficient_privilege then ok := sqlerrm = 'PHOTO_POSTS_VIA_API'; end;
--   raise notice '4 photo update blocked: %', ok;
--
--   -- 5. removing the photo (image_url → null) → allowed
--   update public.posts set image_url = null where id = '<POST_ID>';
--   raise notice '5 photo removal ok';
--
--   raise exception 'rollback test';
-- end $$;
