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

-- Comments: canonical definition lives in schema.sql (uses `body` column,
-- TEXT entity_id, has parent_id for threading + like_count). Do NOT
-- re-declare here — the older `content`/UUID variant caused a schema split
-- in 2026-05-14 (likes/comments writing to wrong table). Production already
-- has the correct shape; keep schema.sql as the source of truth.

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
  user_id       UUID REFERENCES profiles(id),
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
CREATE INDEX IF NOT EXISTS idx_orders_user     ON pickup_orders(user_id);

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

-- ═══════════════════════════════════════════════════════════
-- SIZA AI ASSISTANT TABLES
-- ═══════════════════════════════════════════════════════════

-- Enable pgvector for semantic search
CREATE EXTENSION IF NOT EXISTS vector;

-- Toggle Siza on events
ALTER TABLE events ADD COLUMN IF NOT EXISTS siza_enabled BOOLEAN DEFAULT false;

-- Knowledge base per event (parsed from organizer's pasted text)
CREATE TABLE IF NOT EXISTS event_siza_knowledge (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id      TEXT REFERENCES events(id) ON DELETE CASCADE,
  organizer_id  UUID REFERENCES profiles(id) ON DELETE CASCADE,
  kind          TEXT CHECK (kind IN ('product','faq','policy','hours')) NOT NULL,
  title         TEXT NOT NULL,
  body          TEXT NOT NULL,
  price_cents   INTEGER,
  in_stock      BOOLEAN DEFAULT true,
  embedding     VECTOR(768),
  created_at    TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_siza_knowledge_event ON event_siza_knowledge(event_id);
CREATE INDEX IF NOT EXISTS idx_siza_knowledge_org   ON event_siza_knowledge(organizer_id);

-- Conversations (web + WhatsApp)
CREATE TABLE IF NOT EXISTS siza_conversations (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id            TEXT REFERENCES events(id) ON DELETE SET NULL,
  customer_session_id TEXT,
  customer_name       TEXT,
  customer_email      TEXT,
  customer_phone      TEXT,
  channel             TEXT CHECK (channel IN ('web','whatsapp')) NOT NULL DEFAULT 'web',
  state               TEXT CHECK (state IN ('bot','escalated','closed')) NOT NULL DEFAULT 'bot',
  last_message_at     TIMESTAMPTZ,
  created_at          TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_siza_conv_event   ON siza_conversations(event_id);
CREATE INDEX IF NOT EXISTS idx_siza_conv_session ON siza_conversations(customer_session_id);

-- Messages within conversations
CREATE TABLE IF NOT EXISTS siza_messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID REFERENCES siza_conversations(id) ON DELETE CASCADE NOT NULL,
  direction       TEXT CHECK (direction IN ('in','out')) NOT NULL,
  body            TEXT NOT NULL,
  is_ai           BOOLEAN DEFAULT true,
  created_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_siza_msg_conv ON siza_messages(conversation_id);

-- Orders initiated through Siza
CREATE TABLE IF NOT EXISTS siza_orders (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id            TEXT REFERENCES events(id) ON DELETE SET NULL,
  conversation_id     UUID REFERENCES siza_conversations(id) ON DELETE SET NULL,
  customer_name       TEXT,
  customer_phone      TEXT,
  customer_email      TEXT,
  quantity            INTEGER NOT NULL DEFAULT 1,
  total_cents         INTEGER NOT NULL,
  state               TEXT CHECK (state IN ('pending','paid','failed')) NOT NULL DEFAULT 'pending',
  paystack_reference  TEXT,
  created_at          TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_siza_orders_event ON siza_orders(event_id);
CREATE INDEX IF NOT EXISTS idx_siza_orders_ref   ON siza_orders(paystack_reference);

-- RLS
ALTER TABLE event_siza_knowledge ENABLE ROW LEVEL SECURITY;
ALTER TABLE siza_conversations   ENABLE ROW LEVEL SECURITY;
ALTER TABLE siza_messages        ENABLE ROW LEVEL SECURITY;
ALTER TABLE siza_orders          ENABLE ROW LEVEL SECURITY;

-- Organizers can manage their own knowledge
CREATE POLICY IF NOT EXISTS "siza_knowledge_organizer" ON event_siza_knowledge
  USING (organizer_id = auth.uid());

-- Service role full access to all Siza tables
CREATE POLICY IF NOT EXISTS "siza_knowledge_service"  ON event_siza_knowledge USING (auth.role() = 'service_role');
CREATE POLICY IF NOT EXISTS "siza_conv_service"       ON siza_conversations   USING (auth.role() = 'service_role');
CREATE POLICY IF NOT EXISTS "siza_msg_service"        ON siza_messages        USING (auth.role() = 'service_role');
CREATE POLICY IF NOT EXISTS "siza_orders_service"     ON siza_orders          USING (auth.role() = 'service_role');

-- pgvector similarity search for Siza knowledge retrieval
CREATE OR REPLACE FUNCTION siza_match_knowledge(
  p_event_id  TEXT,
  p_embedding VECTOR(768),
  p_limit     INT DEFAULT 3
)
RETURNS TABLE (
  id          UUID,
  kind        TEXT,
  title       TEXT,
  body        TEXT,
  price_cents INTEGER,
  similarity  FLOAT
)
LANGUAGE sql STABLE
AS $$
  SELECT
    k.id, k.kind, k.title, k.body, k.price_cents,
    1 - (k.embedding <=> p_embedding) AS similarity
  FROM event_siza_knowledge k
  WHERE k.event_id = p_event_id
    AND k.in_stock = true
    AND k.embedding IS NOT NULL
  ORDER BY k.embedding <=> p_embedding
  LIMIT p_limit;
$$;

-- Public read on posts
CREATE POLICY IF NOT EXISTS "public_posts_read" ON posts FOR SELECT USING (visibility = 'public');
CREATE POLICY IF NOT EXISTS "service_all_posts" ON posts USING (auth.role() = 'service_role');
CREATE POLICY IF NOT EXISTS "public_menu_read" ON menu_items FOR SELECT USING (is_available = true);
CREATE POLICY IF NOT EXISTS "service_all" ON menu_items USING (auth.role() = 'service_role');
