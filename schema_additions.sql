-- ═══════════════════════════════════════════════════════════
-- PULSIFY — schema_additions.sql
-- Run in Supabase SQL Editor AFTER the original schema.sql
-- Adds tables needed for unified backend (v2)
-- ═══════════════════════════════════════════════════════════

-- Posts (user + organizer feed)
CREATE TABLE IF NOT EXISTS posts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID REFERENCES profiles(id) ON DELETE CASCADE,
  caption         TEXT,
  image_url       TEXT,
  event_id        UUID REFERENCES events(id) ON DELETE SET NULL,
  event_name      TEXT,
  post_type       TEXT DEFAULT 'attended_photo', -- 'attended_photo' | 'organizer'
  visibility      TEXT DEFAULT 'public',         -- 'public' | 'followers' | 'private'
  like_count      INTEGER DEFAULT 0,
  comment_count   INTEGER DEFAULT 0,
  repost_count    INTEGER DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_posts_user     ON posts(user_id);
CREATE INDEX IF NOT EXISTS idx_posts_event    ON posts(event_id);
CREATE INDEX IF NOT EXISTS idx_posts_created  ON posts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_visible  ON posts(visibility);

-- Reposts
CREATE TABLE IF NOT EXISTS reposts (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID REFERENCES profiles(id) ON DELETE CASCADE,
  post_id    UUID REFERENCES posts(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, post_id)
);

-- Reactions (likes on posts, events, businesses)
CREATE TABLE IF NOT EXISTS reactions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID REFERENCES profiles(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL, -- 'post' | 'event' | 'business'
  entity_id   UUID NOT NULL,
  type        TEXT DEFAULT 'like',
  created_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, entity_id, type)
);
CREATE INDEX IF NOT EXISTS idx_reactions_entity ON reactions(entity_id);

-- Comments (on posts, events)
CREATE TABLE IF NOT EXISTS comments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID REFERENCES profiles(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,
  entity_id   UUID NOT NULL,
  content     TEXT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_comments_entity ON comments(entity_type, entity_id);

-- Follows
CREATE TABLE IF NOT EXISTS follows (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  follower_id  UUID REFERENCES profiles(id) ON DELETE CASCADE,
  following_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ DEFAULT now(),
  UNIQUE(follower_id, following_id)
);
CREATE INDEX IF NOT EXISTS idx_follows_follower  ON follows(follower_id);
CREATE INDEX IF NOT EXISTS idx_follows_following ON follows(following_id);

-- Event attendances
CREATE TABLE IF NOT EXISTS event_attendances (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID REFERENCES profiles(id) ON DELETE CASCADE,
  event_id    UUID REFERENCES events(id) ON DELETE CASCADE,
  attended_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, event_id)
);

-- Saved items
CREATE TABLE IF NOT EXISTS saved_items (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID REFERENCES profiles(id) ON DELETE CASCADE,
  item_id    UUID NOT NULL,
  item_type  TEXT DEFAULT 'event', -- 'event' | 'business'
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, item_id)
);

-- Menu items (for businesses)
CREATE TABLE IF NOT EXISTS menu_items (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id  UUID REFERENCES businesses(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  description  TEXT,
  price        NUMERIC(10,2) NOT NULL,
  category     TEXT DEFAULT 'General',
  image_url    TEXT,
  is_available BOOLEAN DEFAULT true,
  sort_order   INTEGER DEFAULT 0,
  created_at   TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_menu_business ON menu_items(business_id);

-- Pickup orders
CREATE TABLE IF NOT EXISTS pickup_orders (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_ref     TEXT UNIQUE NOT NULL,
  business_id   UUID REFERENCES businesses(id) ON DELETE CASCADE,
  customer_name TEXT NOT NULL,
  customer_phone TEXT,
  items         JSONB NOT NULL,
  notes         TEXT,
  pickup_time   TEXT,
  total         NUMERIC(10,2),
  status        TEXT DEFAULT 'pending', -- pending|confirmed|ready|completed|cancelled
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_orders_business ON pickup_orders(business_id);
CREATE INDEX IF NOT EXISTS idx_orders_status   ON pickup_orders(status);

-- Business hours
CREATE TABLE IF NOT EXISTS business_hours (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
  day_index   INTEGER NOT NULL, -- 0=Monday
  day         TEXT NOT NULL,
  is_open     BOOLEAN DEFAULT true,
  open_time   TEXT DEFAULT '10:00',
  close_time  TEXT DEFAULT '18:00',
  UNIQUE(business_id, day_index)
);

-- Notifications
CREATE TABLE IF NOT EXISTS notifications (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID REFERENCES profiles(id) ON DELETE CASCADE,
  type       TEXT NOT NULL, -- 'like' | 'comment' | 'follow' | 'booking' | 'event'
  title      TEXT,
  body       TEXT,
  data       JSONB,
  read       BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, read);

-- Add extra columns to profiles if not present
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS role       TEXT DEFAULT 'user';
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_page    BOOLEAN DEFAULT false;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_verified BOOLEAN DEFAULT false;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS province   TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS phone      TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS dob        DATE;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS genres     TEXT[] DEFAULT '{}';
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS bio        TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS email      TEXT;

-- RLS policies
ALTER TABLE posts             ENABLE ROW LEVEL SECURITY;
ALTER TABLE reposts           ENABLE ROW LEVEL SECURITY;
ALTER TABLE reactions         ENABLE ROW LEVEL SECURITY;
ALTER TABLE comments          ENABLE ROW LEVEL SECURITY;
ALTER TABLE follows           ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_attendances ENABLE ROW LEVEL SECURITY;
ALTER TABLE saved_items       ENABLE ROW LEVEL SECURITY;
ALTER TABLE menu_items        ENABLE ROW LEVEL SECURITY;
ALTER TABLE pickup_orders     ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications     ENABLE ROW LEVEL SECURITY;

-- Service role gets full access
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;

-- Public read on posts
CREATE POLICY IF NOT EXISTS "public_posts_read" ON posts FOR SELECT USING (visibility = 'public');
CREATE POLICY IF NOT EXISTS "service_all_posts" ON posts USING (auth.role() = 'service_role');
CREATE POLICY IF NOT EXISTS "public_menu_read" ON menu_items FOR SELECT USING (is_available = true);
CREATE POLICY IF NOT EXISTS "service_all" ON menu_items USING (auth.role() = 'service_role');
