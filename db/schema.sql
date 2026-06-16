-- ============================================================
-- PULSIFY — COMPLETE SUPABASE SCHEMA
-- Run this entire file in Supabase SQL Editor
-- ============================================================

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- ============================================================
-- 1. PROFILES
-- ============================================================
CREATE TABLE IF NOT EXISTS profiles (
  id              UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username        TEXT UNIQUE,
  display_name    TEXT,
  avatar_url      TEXT,
  bio             TEXT,
  city            TEXT DEFAULT 'Durban',
  province        TEXT DEFAULT 'KZN',
  is_organiser    BOOLEAN DEFAULT FALSE,
  is_verified     BOOLEAN DEFAULT FALSE,
  follower_count  INT DEFAULT 0,
  following_count INT DEFAULT 0,
  event_count     INT DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 2. EVENTS
-- ============================================================
CREATE TABLE IF NOT EXISTS events (
  id               TEXT PRIMARY KEY DEFAULT uuid_generate_v4()::TEXT,
  source           TEXT DEFAULT 'manual', -- manual | eventbrite | ticketmaster
  external_id      TEXT,
  external_url     TEXT,
  name             TEXT NOT NULL,
  description      TEXT,
  organiser_id     UUID REFERENCES profiles(id) ON DELETE SET NULL,
  organiser_name   TEXT,
  genre            TEXT,
  subgenre         TEXT,
  status           TEXT DEFAULT 'onsale', -- onsale | cancelled | postponed | sold_out
  date_local       DATE NOT NULL,
  time_local       TIME,
  end_date_local   DATE,
  end_time_local   TIME,
  venue_name       TEXT,
  venue_city       TEXT,
  venue_address    TEXT,
  venue_province   TEXT,
  venue_lat        NUMERIC(10,7),
  venue_lon        NUMERIC(10,7),
  image_url        TEXT,
  is_free          BOOLEAN DEFAULT FALSE,
  price_min        NUMERIC(10,2),
  price_max        NUMERIC(10,2),
  lineup           JSONB DEFAULT '[]',
  dress_code       TEXT,
  age_restriction  TEXT,
  capacity         INT,
  tickets_sold     INT DEFAULT 0,
  hype_score       INT DEFAULT 50,
  like_count       INT DEFAULT 0,
  comment_count    INT DEFAULT 0,
  share_count      INT DEFAULT 0,
  attendance_count INT DEFAULT 0,
  is_frontline     BOOLEAN DEFAULT FALSE,
  frontline_rank   INT,
  commission_rate  NUMERIC(5,2) DEFAULT 8,
  is_active        BOOLEAN DEFAULT TRUE,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT events_source_check CHECK (source IN ('manual','eventbrite','ticketmaster')),
  CONSTRAINT events_status_check CHECK (status IN ('onsale','cancelled','postponed','sold_out','draft'))
);

-- ============================================================
-- 3. TICKET TIERS
-- ============================================================
CREATE TABLE IF NOT EXISTS ticket_tiers (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_id    TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  description TEXT,
  price       NUMERIC(10,2) NOT NULL DEFAULT 0,
  capacity    INT,
  sold        INT DEFAULT 0,
  is_free     BOOLEAN GENERATED ALWAYS AS (price = 0) STORED,
  sold_out    BOOLEAN GENERATED ALWAYS AS (capacity IS NOT NULL AND sold >= capacity) STORED,
  sale_start  TIMESTAMPTZ,
  sale_end    TIMESTAMPTZ,
  sort_order  INT DEFAULT 1,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 4. BOOKINGS
-- ============================================================
CREATE TABLE IF NOT EXISTS bookings (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  booking_ref  TEXT UNIQUE NOT NULL,
  event_id     TEXT NOT NULL REFERENCES events(id) ON DELETE RESTRICT,
  tier_id      UUID REFERENCES ticket_tiers(id) ON DELETE SET NULL,
  user_id      UUID REFERENCES profiles(id) ON DELETE SET NULL,
  buyer_name   TEXT NOT NULL,
  buyer_email  TEXT NOT NULL,
  buyer_phone  TEXT,
  quantity     INT NOT NULL DEFAULT 1,
  unit_price   NUMERIC(10,2) NOT NULL DEFAULT 0,
  commission   NUMERIC(10,2) DEFAULT 0,
  total_paid   NUMERIC(10,2) NOT NULL DEFAULT 0,
  status       TEXT DEFAULT 'pending', -- pending | confirmed | cancelled | refunded
  paystack_ref TEXT,
  qr_data      TEXT,
  checked_in   BOOLEAN DEFAULT FALSE,
  checked_in_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT bookings_status_check CHECK (status IN ('pending','confirmed','cancelled','refunded'))
);

-- ============================================================
-- 5. BUSINESSES
-- ============================================================
CREATE TABLE IF NOT EXISTS businesses (
  id               TEXT PRIMARY KEY DEFAULT uuid_generate_v4()::TEXT,
  name             TEXT NOT NULL,
  slug             TEXT UNIQUE,
  category         TEXT NOT NULL, -- shisanyama | bar | club | restaurant | hotel | bnb | venue
  subcategory      TEXT,
  tagline          TEXT,
  description      TEXT,
  owner_id         UUID REFERENCES profiles(id) ON DELETE SET NULL,
  city             TEXT,
  suburb           TEXT,
  province         TEXT DEFAULT 'KZN',
  address          TEXT,
  lat              NUMERIC(10,7),
  lon              NUMERIC(10,7),
  phone            TEXT,
  whatsapp         TEXT,
  email            TEXT,
  website          TEXT,
  facebook         TEXT,
  instagram        TEXT,
  cover_image_url  TEXT,
  gallery_urls     JSONB DEFAULT '[]',
  hours            JSONB DEFAULT '[]',
  tags             JSONB DEFAULT '[]',
  amenities        JSONB DEFAULT '[]',
  price_range      TEXT DEFAULT 'R', -- R | RR | RRR | RRRR
  rating           NUMERIC(3,1),
  review_count     INT DEFAULT 0,
  is_frontline     BOOLEAN DEFAULT FALSE,
  frontline_rank   INT,
  is_verified      BOOLEAN DEFAULT FALSE,
  is_active        BOOLEAN DEFAULT TRUE,
  claim_status     TEXT DEFAULT 'unclaimed', -- unclaimed | pending | claimed
  like_count       INT DEFAULT 0,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT businesses_category_check CHECK (category IN ('shisanyama','bar','club','restaurant','hotel','bnb','venue','other'))
);

-- ============================================================
-- 6. FOLLOWS (Vibe Social)
-- ============================================================
CREATE TABLE IF NOT EXISTS follows (
  follower_id  UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  following_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (follower_id, following_id),
  CONSTRAINT no_self_follow CHECK (follower_id != following_id)
);

-- ============================================================
-- 7. EVENT ATTENDANCES (RSVPs)
-- ============================================================
CREATE TABLE IF NOT EXISTS event_attendances (
  user_id    UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  event_id   TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  status     TEXT DEFAULT 'going', -- going | interested | not_going
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, event_id)
);

-- ============================================================
-- 8. EVENT PHOTOS (Memories)
-- ============================================================
CREATE TABLE IF NOT EXISTS event_photos (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_id   TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id    UUID REFERENCES profiles(id) ON DELETE SET NULL,
  url        TEXT NOT NULL,
  caption    TEXT,
  lat        NUMERIC(10,7),
  lon        NUMERIC(10,7),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 9. COMMENTS
-- ============================================================
CREATE TABLE IF NOT EXISTS comments (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id       UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  entity_type   TEXT NOT NULL, -- event | business
  entity_id     TEXT NOT NULL,
  body          TEXT NOT NULL CHECK (char_length(body) <= 500),
  like_count    INT DEFAULT 0,
  parent_id     UUID REFERENCES comments(id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 10. REACTIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS reactions (
  user_id     UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,
  entity_id   TEXT NOT NULL,
  type        TEXT NOT NULL DEFAULT 'like', -- like | fire | bookmark
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, entity_type, entity_id, type)
);

-- ============================================================
-- 11. SAVED ITEMS
-- ============================================================
CREATE TABLE IF NOT EXISTS saved_items (
  user_id     UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL, -- event | business
  entity_id   TEXT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, entity_type, entity_id)
);

-- ============================================================
-- 12. SQUADS
-- ============================================================
CREATE TABLE IF NOT EXISTS squads (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        TEXT NOT NULL,
  description TEXT,
  avatar_url  TEXT,
  creator_id  UUID REFERENCES profiles(id) ON DELETE SET NULL,
  is_public   BOOLEAN DEFAULT TRUE,
  member_count INT DEFAULT 1,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 13. SQUAD MEMBERS
-- ============================================================
CREATE TABLE IF NOT EXISTS squad_members (
  squad_id   UUID NOT NULL REFERENCES squads(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role       TEXT DEFAULT 'member', -- admin | member
  joined_at  TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (squad_id, user_id)
);

-- ============================================================
-- 14. SQUAD MESSAGES
-- ============================================================
CREATE TABLE IF NOT EXISTS squad_messages (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  squad_id   UUID NOT NULL REFERENCES squads(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  body       TEXT NOT NULL CHECK (char_length(body) <= 1000),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 15. PAYMENTS
-- ============================================================
CREATE TABLE IF NOT EXISTS payments (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  paystack_ref TEXT UNIQUE NOT NULL,
  booking_id   UUID REFERENCES bookings(id) ON DELETE SET NULL,
  amount_kobo  INT NOT NULL,
  currency     TEXT DEFAULT 'ZAR',
  status       TEXT DEFAULT 'pending', -- pending | success | failed | refunded
  type         TEXT DEFAULT 'ticket',
  metadata     JSONB DEFAULT '{}',
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 16. PUSH SUBSCRIPTIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID REFERENCES profiles(id) ON DELETE CASCADE,
  endpoint   TEXT NOT NULL,
  p256dh     TEXT,
  auth       TEXT,
  city       TEXT,
  genres     JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 17. ADMIN LOGS
-- ============================================================
CREATE TABLE IF NOT EXISTS admin_logs (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  admin_id   UUID REFERENCES profiles(id),
  action     TEXT NOT NULL,
  entity     TEXT,
  entity_id  TEXT,
  details    JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- INDEXES — performance on query patterns
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_events_date       ON events(date_local);
CREATE INDEX IF NOT EXISTS idx_events_city       ON events(venue_city);
CREATE INDEX IF NOT EXISTS idx_events_genre      ON events(genre);
CREATE INDEX IF NOT EXISTS idx_events_hype       ON events(hype_score DESC);
CREATE INDEX IF NOT EXISTS idx_events_frontline  ON events(is_frontline, frontline_rank);
CREATE INDEX IF NOT EXISTS idx_events_active     ON events(is_active, status, date_local);
CREATE INDEX IF NOT EXISTS idx_events_source     ON events(source);
CREATE INDEX IF NOT EXISTS idx_events_lat_lon    ON events(venue_lat, venue_lon);

CREATE INDEX IF NOT EXISTS idx_biz_city          ON businesses(city);
CREATE INDEX IF NOT EXISTS idx_biz_category      ON businesses(category);
CREATE INDEX IF NOT EXISTS idx_biz_frontline     ON businesses(is_frontline, frontline_rank);
CREATE INDEX IF NOT EXISTS idx_biz_rating        ON businesses(rating DESC);
CREATE INDEX IF NOT EXISTS idx_biz_lat_lon       ON businesses(lat, lon);
CREATE INDEX IF NOT EXISTS idx_biz_active        ON businesses(is_active);

CREATE INDEX IF NOT EXISTS idx_bookings_email    ON bookings(buyer_email);
CREATE INDEX IF NOT EXISTS idx_bookings_event    ON bookings(event_id);
CREATE INDEX IF NOT EXISTS idx_bookings_user     ON bookings(user_id);
CREATE INDEX IF NOT EXISTS idx_bookings_ref      ON bookings(booking_ref);

CREATE INDEX IF NOT EXISTS idx_tiers_event       ON ticket_tiers(event_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_comments_entity   ON comments(entity_type, entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reactions_entity  ON reactions(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_saved_user        ON saved_items(user_id, entity_type);
CREATE INDEX IF NOT EXISTS idx_follows_follower  ON follows(follower_id);
CREATE INDEX IF NOT EXISTS idx_follows_following ON follows(following_id);
CREATE INDEX IF NOT EXISTS idx_squad_msgs        ON squad_messages(squad_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_photos_event      ON event_photos(event_id, created_at DESC);

-- Full text search on events
CREATE INDEX IF NOT EXISTS idx_events_fts ON events 
  USING gin(to_tsvector('english', coalesce(name,'') || ' ' || coalesce(description,'') || ' ' || coalesce(venue_name,'') || ' ' || coalesce(venue_city,'')));

-- Full text search on businesses  
CREATE INDEX IF NOT EXISTS idx_biz_fts ON businesses
  USING gin(to_tsvector('english', coalesce(name,'') || ' ' || coalesce(tagline,'') || ' ' || coalesce(description,'') || ' ' || coalesce(city,'')));

-- ============================================================
-- TRIGGERS
-- ============================================================

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO profiles (id, display_name, avatar_url, username)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email,'@',1)),
    NEW.raw_user_meta_data->>'avatar_url',
    'user_' || substr(NEW.id::text, 1, 8)
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- Update follow counts
CREATE OR REPLACE FUNCTION update_follow_counts()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE profiles SET following_count = following_count + 1 WHERE id = NEW.follower_id;
    UPDATE profiles SET follower_count = follower_count + 1 WHERE id = NEW.following_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE profiles SET following_count = GREATEST(0, following_count - 1) WHERE id = OLD.follower_id;
    UPDATE profiles SET follower_count = GREATEST(0, follower_count - 1) WHERE id = OLD.following_id;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_follow_counts ON follows;
CREATE TRIGGER trg_follow_counts
  AFTER INSERT OR DELETE ON follows
  FOR EACH ROW EXECUTE FUNCTION update_follow_counts();

-- Update attendance count on events
CREATE OR REPLACE FUNCTION update_attendance_count()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE events SET attendance_count = attendance_count + 1 WHERE id = NEW.event_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE events SET attendance_count = GREATEST(0, attendance_count - 1) WHERE id = OLD.event_id;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_attendance_count ON event_attendances;
CREATE TRIGGER trg_attendance_count
  AFTER INSERT OR DELETE ON event_attendances
  FOR EACH ROW EXECUTE FUNCTION update_attendance_count();

-- Update tickets sold on booking confirm
CREATE OR REPLACE FUNCTION update_tickets_sold()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'confirmed' AND (OLD.status IS NULL OR OLD.status != 'confirmed') THEN
    UPDATE ticket_tiers SET sold = sold + NEW.quantity WHERE id = NEW.tier_id;
    UPDATE events SET tickets_sold = tickets_sold + NEW.quantity WHERE id = NEW.event_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_tickets_sold ON bookings;
CREATE TRIGGER trg_tickets_sold
  AFTER INSERT OR UPDATE ON bookings
  FOR EACH ROW EXECUTE FUNCTION update_tickets_sold();

-- Updated_at timestamps
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_profiles_updated ON profiles;
CREATE TRIGGER trg_profiles_updated BEFORE UPDATE ON profiles FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS trg_events_updated ON events;
CREATE TRIGGER trg_events_updated BEFORE UPDATE ON events FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS trg_businesses_updated ON businesses;
CREATE TRIGGER trg_businesses_updated BEFORE UPDATE ON businesses FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS trg_bookings_updated ON bookings;
CREATE TRIGGER trg_bookings_updated BEFORE UPDATE ON bookings FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- VIEWS
-- ============================================================
CREATE OR REPLACE VIEW events_upcoming AS
  SELECT * FROM events
  WHERE is_active = TRUE
    AND status NOT IN ('cancelled','postponed')
    AND date_local >= CURRENT_DATE
  ORDER BY is_frontline DESC, hype_score DESC, date_local ASC;

CREATE OR REPLACE VIEW events_tonight AS
  SELECT * FROM events
  WHERE is_active = TRUE
    AND status NOT IN ('cancelled','postponed')
    AND date_local = CURRENT_DATE
  ORDER BY hype_score DESC;

CREATE OR REPLACE VIEW frontline_businesses AS
  SELECT * FROM businesses
  WHERE is_active = TRUE AND is_frontline = TRUE
  ORDER BY frontline_rank ASC NULLS LAST, rating DESC NULLS LAST;

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
ALTER TABLE profiles         ENABLE ROW LEVEL SECURITY;
ALTER TABLE events           ENABLE ROW LEVEL SECURITY;
ALTER TABLE ticket_tiers     ENABLE ROW LEVEL SECURITY;
ALTER TABLE bookings         ENABLE ROW LEVEL SECURITY;
ALTER TABLE businesses       ENABLE ROW LEVEL SECURITY;
ALTER TABLE follows          ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_attendances ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_photos     ENABLE ROW LEVEL SECURITY;
ALTER TABLE comments         ENABLE ROW LEVEL SECURITY;
ALTER TABLE reactions        ENABLE ROW LEVEL SECURITY;
ALTER TABLE saved_items      ENABLE ROW LEVEL SECURITY;
ALTER TABLE squads           ENABLE ROW LEVEL SECURITY;
ALTER TABLE squad_members    ENABLE ROW LEVEL SECURITY;
ALTER TABLE squad_messages   ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments         ENABLE ROW LEVEL SECURITY;
ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;

-- Public read for events and businesses
CREATE POLICY "events_public_read" ON events FOR SELECT USING (is_active = TRUE);
CREATE POLICY "tiers_public_read"  ON ticket_tiers FOR SELECT USING (TRUE);
CREATE POLICY "biz_public_read"    ON businesses FOR SELECT USING (is_active = TRUE);
CREATE POLICY "photos_public_read" ON event_photos FOR SELECT USING (TRUE);
CREATE POLICY "comments_public_read" ON comments FOR SELECT USING (TRUE);

-- Service role bypass (for API)
CREATE POLICY "events_service_all"    ON events            FOR ALL TO service_role USING (TRUE);
CREATE POLICY "tiers_service_all"     ON ticket_tiers      FOR ALL TO service_role USING (TRUE);
CREATE POLICY "bookings_service_all"  ON bookings          FOR ALL TO service_role USING (TRUE);
CREATE POLICY "biz_service_all"       ON businesses        FOR ALL TO service_role USING (TRUE);
CREATE POLICY "profiles_service_all"  ON profiles          FOR ALL TO service_role USING (TRUE);
CREATE POLICY "payments_service_all"  ON payments          FOR ALL TO service_role USING (TRUE);
CREATE POLICY "photos_service_all"    ON event_photos      FOR ALL TO service_role USING (TRUE);
CREATE POLICY "comments_service_all"  ON comments          FOR ALL TO service_role USING (TRUE);
CREATE POLICY "reactions_service_all" ON reactions         FOR ALL TO service_role USING (TRUE);
CREATE POLICY "saved_service_all"     ON saved_items       FOR ALL TO service_role USING (TRUE);
CREATE POLICY "follows_service_all"   ON follows           FOR ALL TO service_role USING (TRUE);
CREATE POLICY "attend_service_all"    ON event_attendances FOR ALL TO service_role USING (TRUE);
CREATE POLICY "squads_service_all"    ON squads            FOR ALL TO service_role USING (TRUE);
CREATE POLICY "smembers_service_all"  ON squad_members     FOR ALL TO service_role USING (TRUE);
CREATE POLICY "smsgs_service_all"     ON squad_messages    FOR ALL TO service_role USING (TRUE);
CREATE POLICY "push_service_all"      ON push_subscriptions FOR ALL TO service_role USING (TRUE);
CREATE POLICY "admin_service_all"     ON admin_logs        FOR ALL TO service_role USING (TRUE);

-- User self-access
CREATE POLICY "profiles_own" ON profiles FOR ALL USING (auth.uid() = id);
CREATE POLICY "bookings_own" ON bookings FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "saved_own"    ON saved_items FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "reactions_own" ON reactions FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "follows_own"  ON follows FOR ALL USING (auth.uid() = follower_id);
CREATE POLICY "attend_own"   ON event_attendances FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "comments_own" ON comments FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "comments_delete_own" ON comments FOR DELETE USING (auth.uid() = user_id);
CREATE POLICY "photos_own"   ON event_photos FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "squads_read"  ON squads FOR SELECT USING (is_public = TRUE OR EXISTS (SELECT 1 FROM squad_members WHERE squad_id = squads.id AND user_id = auth.uid()));
CREATE POLICY "smsgs_read"   ON squad_messages FOR SELECT USING (EXISTS (SELECT 1 FROM squad_members WHERE squad_id = squad_messages.squad_id AND user_id = auth.uid()));
CREATE POLICY "smsgs_insert" ON squad_messages FOR INSERT WITH CHECK (EXISTS (SELECT 1 FROM squad_members WHERE squad_id = squad_messages.squad_id AND user_id = auth.uid()));

-- ============================================================
-- STORAGE BUCKETS
-- ============================================================
INSERT INTO storage.buckets (id, name, public) VALUES
  ('event-images',    'event-images',    TRUE),
  ('business-images', 'business-images', TRUE),
  ('memories',        'memories',        TRUE),
  ('avatars',         'avatars',         TRUE)
ON CONFLICT (id) DO NOTHING;

-- Storage policies
CREATE POLICY "public_read_event_images"    ON storage.objects FOR SELECT USING (bucket_id = 'event-images');
CREATE POLICY "public_read_biz_images"      ON storage.objects FOR SELECT USING (bucket_id = 'business-images');
CREATE POLICY "public_read_memories"        ON storage.objects FOR SELECT USING (bucket_id = 'memories');
CREATE POLICY "public_read_avatars"         ON storage.objects FOR SELECT USING (bucket_id = 'avatars');
CREATE POLICY "auth_upload_memories"        ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'memories' AND auth.role() = 'authenticated');
CREATE POLICY "auth_upload_avatars"         ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'avatars' AND auth.role() = 'authenticated');
CREATE POLICY "service_upload_event_images" ON storage.objects FOR INSERT TO service_role WITH CHECK (bucket_id = 'event-images');
CREATE POLICY "service_upload_biz_images"   ON storage.objects FOR INSERT TO service_role WITH CHECK (bucket_id = 'business-images');

-- Enable Realtime on squad messages
ALTER PUBLICATION supabase_realtime ADD TABLE squad_messages;
ALTER PUBLICATION supabase_realtime ADD TABLE event_attendances;

-- Done
SELECT 'PULSIFY SCHEMA COMPLETE — ' || COUNT(*) || ' tables created' AS result
FROM information_schema.tables 
WHERE table_schema = 'public' AND table_type = 'BASE TABLE';
