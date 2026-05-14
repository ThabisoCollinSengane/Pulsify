-- ============================================================
-- Notification triggers — applied to Supabase 2026-05-14
-- Source of truth for trg_notif_on_follow / _reaction / _comment.
-- Excluded from Vercel deploy (.vercelignore); re-run manually
-- in the Supabase SQL editor if the DB is rebuilt.
-- ============================================================

CREATE OR REPLACE FUNCTION public.notif_display_name(uid uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT display_name FROM public.profiles WHERE id = uid;
$$;

-- ─── FOLLOW: notify the user being followed ────────────────────
CREATE OR REPLACE FUNCTION public.trg_notif_on_follow() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NEW.follower_id = NEW.following_id THEN RETURN NEW; END IF;
  INSERT INTO public.notifications
    (user_id, from_user_id, from_display_name, type, entity_type, entity_id, message, data)
  VALUES (
    NEW.following_id,
    NEW.follower_id,
    public.notif_display_name(NEW.follower_id),
    'follow',
    'profile',
    NEW.follower_id::text,
    'started following you',
    jsonb_build_object('actor_id', NEW.follower_id)
  );
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_notif_on_follow ON public.follows;
CREATE TRIGGER trg_notif_on_follow AFTER INSERT ON public.follows
FOR EACH ROW EXECUTE FUNCTION public.trg_notif_on_follow();

-- ─── LIKE (reactions.type='like'): notify entity owner ─────────
CREATE OR REPLACE FUNCTION public.trg_notif_on_reaction() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  recipient uuid;
BEGIN
  IF NEW.type IS DISTINCT FROM 'like' THEN RETURN NEW; END IF;
  IF NEW.entity_type = 'post' THEN
    SELECT user_id INTO recipient FROM public.posts WHERE id::text = NEW.entity_id;
  ELSIF NEW.entity_type = 'event' THEN
    SELECT organiser_id INTO recipient FROM public.events WHERE id = NEW.entity_id;
  ELSIF NEW.entity_type = 'comment' THEN
    SELECT user_id INTO recipient FROM public.comments WHERE id::text = NEW.entity_id;
  END IF;
  IF recipient IS NULL OR recipient = NEW.user_id THEN RETURN NEW; END IF;
  INSERT INTO public.notifications
    (user_id, from_user_id, from_display_name, type, entity_type, entity_id, message, data)
  VALUES (
    recipient,
    NEW.user_id,
    public.notif_display_name(NEW.user_id),
    'like',
    NEW.entity_type,
    NEW.entity_id,
    'liked your ' || NEW.entity_type,
    jsonb_build_object('actor_id', NEW.user_id, 'entity_type', NEW.entity_type, 'entity_id', NEW.entity_id)
  );
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_notif_on_reaction ON public.reactions;
CREATE TRIGGER trg_notif_on_reaction AFTER INSERT ON public.reactions
FOR EACH ROW EXECUTE FUNCTION public.trg_notif_on_reaction();

-- ─── COMMENT / REPLY: notify owner or parent commenter ─────────
-- For replies, entity_id stays as the parent comment's post/event ref,
-- and the JSONB `data` field carries comment_id + parent_id so the
-- client can open the post and scroll to the right comment.
CREATE OR REPLACE FUNCTION public.trg_notif_on_comment() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  recipient uuid;
  notif_type text;
  parent_entity_type text;
  parent_entity_id   text;
BEGIN
  IF NEW.parent_id IS NOT NULL THEN
    notif_type := 'reply';
    SELECT user_id, entity_type, entity_id
      INTO recipient, parent_entity_type, parent_entity_id
      FROM public.comments WHERE id = NEW.parent_id;
  ELSE
    notif_type := 'comment';
    parent_entity_type := NEW.entity_type;
    parent_entity_id   := NEW.entity_id;
    IF NEW.entity_type = 'post' THEN
      SELECT user_id INTO recipient FROM public.posts WHERE id::text = NEW.entity_id;
    ELSIF NEW.entity_type = 'event' THEN
      SELECT organiser_id INTO recipient FROM public.events WHERE id = NEW.entity_id;
    END IF;
  END IF;
  IF recipient IS NULL OR recipient = NEW.user_id THEN RETURN NEW; END IF;
  INSERT INTO public.notifications
    (user_id, from_user_id, from_display_name, type, entity_type, entity_id, message, data)
  VALUES (
    recipient,
    NEW.user_id,
    public.notif_display_name(NEW.user_id),
    notif_type,
    parent_entity_type,
    parent_entity_id,
    CASE WHEN notif_type='reply' THEN 'replied to your comment'
         ELSE 'commented on your ' || NEW.entity_type END,
    jsonb_build_object(
      'actor_id', NEW.user_id,
      'comment_id', NEW.id,
      'parent_id', NEW.parent_id,
      'entity_type', parent_entity_type,
      'entity_id', parent_entity_id
    )
  );
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_notif_on_comment ON public.comments;
CREATE TRIGGER trg_notif_on_comment AFTER INSERT ON public.comments
FOR EACH ROW EXECUTE FUNCTION public.trg_notif_on_comment();

-- Legacy cleanup: previous session's follow trigger duplicated this
DROP TRIGGER IF EXISTS trg_notify_follow ON public.follows;
DROP FUNCTION IF EXISTS public._pulsify_notify_follow();
