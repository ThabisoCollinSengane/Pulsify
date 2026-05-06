const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

const sb = () => createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
};

function haverBox(lat, lon, km) {
  const R = 111, d = km / R, dl = km / (R * Math.cos(lat * Math.PI / 180));
  return { minLat: lat - d, maxLat: lat + d, minLon: lon - dl, maxLon: lon + dl };
}

async function verifyToken(token) {
  if (!token) return null;
  try {
    const userSb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY,
      { auth: { autoRefreshToken: false, persistSession: false } });
    const { data: { user } } = await userSb.auth.getUser(token);
    return user || null;
  } catch { return null; }
}

module.exports = async (req, res) => {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));
  if (req.method === 'OPTIONS') return res.status(200).end();

  const url    = (req.url || '/').split('?')[0].replace(/^\/api/, '') || '/';
  const q      = Object.fromEntries(new URL(req.url, 'http://x').searchParams);
  const today  = new Date().toISOString().split('T')[0];

  try {

    /* ─── GET /events ─────────────────────────────────────── */
    if (url === '/events' && req.method === 'GET') {
      const page   = Math.max(1, parseInt(q.page  || '1'));
      const limit  = Math.min(50, parseInt(q.limit || '10'));
      const offset = (page - 1) * limit;
      const city   = q.city   || '';
      const genre  = q.genre  || '';
      const search = q.search || '';
      const lat    = parseFloat(q.lat)       || null;
      const lon    = parseFloat(q.lon)       || null;
      const km     = parseFloat(q.radius_km) || 100;
      const from_date = q.from_date || today;

      let query = sb().from('events')
        .select(`id,name,date_local,time_local,venue_name,venue_city,venue_address,
          venue_lat,venue_lon,price_min,is_free,image_url,genre,hype_score,
          like_count,comment_count,is_frontline,frontline_rank,external_url,
          source,status,description,lineup,dress_code,age_restriction,
          attendance_count,organiser_name,capacity,tickets_sold`, { count: 'exact' })
        .gte('date_local', from_date)
        .eq('is_active', true)
        .not('status', 'in', '(cancelled,postponed)')
        .order('is_frontline',   { ascending: false })
        .order('hype_score',     { ascending: false, nullsFirst: false })
        .order('date_local',     { ascending: true })
        .range(offset, offset + limit - 1);

      if (city && city !== 'all')  query = query.ilike('venue_city', `%${city}%`);
      if (genre === 'free')        query = query.eq('is_free', true);
      else if (genre && genre !== 'all') query = query.ilike('genre', `%${genre}%`);
      if (search) query = query.textSearch('id', search, { type: 'websearch', config: 'english' });
      if (lat && lon) {
        const b = haverBox(lat, lon, km);
        query = query
          .gte('venue_lat', b.minLat).lte('venue_lat', b.maxLat)
          .gte('venue_lon', b.minLon).lte('venue_lon', b.maxLon);
      }

      const { data, error, count } = await query;
      if (error) return res.status(400).json({ error: error.message });

      return res.status(200).json({
        events: data || [],
        total:  count || 0,
        page, limit, offset,
        total_pages: Math.ceil((count || 0) / limit),
        has_next: offset + limit < (count || 0),
        has_prev: page > 1,
      });
    }

    /* ─── GET /events/search ──────────────────────────────── */
    if (url === '/events/search' && req.method === 'GET') {
      const term  = q.q || '';
      const limit = Math.min(20, parseInt(q.limit || '10'));
      if (!term) return res.status(200).json({ results: [] });

      const { data, error } = await sb().from('events')
        .select('id,name,venue_city,date_local,genre,image_url,is_free,price_min')
        .gte('date_local', today)
        .eq('is_active', true)
        .or(`name.ilike.%${term}%,venue_city.ilike.%${term}%,genre.ilike.%${term}%,venue_name.ilike.%${term}%`)
        .order('hype_score', { ascending: false })
        .limit(limit);

      if (error) return res.status(400).json({ error: error.message });
      return res.status(200).json({ results: data || [] });
    }

    /* ─── GET /events/:id ─────────────────────────────────── */
    const evId = url.match(/^\/events\/([^/]+)$/)?.[1];
    if (evId && req.method === 'GET') {
      const [{ data: ev, error: evErr }, { data: tiers }, { data: photos }] = await Promise.all([
        sb().from('events').select('*').eq('id', evId).single(),
        sb().from('ticket_tiers').select('*').eq('event_id', evId).order('sort_order'),
        sb().from('event_photos').select('*').eq('event_id', evId).order('created_at', { ascending: false }).limit(12),
      ]);
      if (evErr || !ev) return res.status(404).json({ error: 'Event not found' });
      return res.status(200).json({ event: ev, tiers: tiers || [], photos: photos || [] });
    }

    /* ─── GET /businesses ─────────────────────────────────── */
    if (url === '/businesses' && req.method === 'GET') {
      const show_all  = q.show_all === 'true';
      const page      = Math.max(1, parseInt(q.page || '1'));
      const limit     = show_all ? Math.min(50, parseInt(q.limit || '20')) : Math.min(8, parseInt(q.limit || '6'));
      const offset    = (page - 1) * limit;
      const city      = q.city     || '';
      const category  = q.category || '';
      const lat       = parseFloat(q.lat) || null;
      const lon       = parseFloat(q.lon) || null;
      const km        = parseFloat(q.radius_km) || 100;

      let query = sb().from('businesses')
        .select(`id,name,category,suburb,city,lat,lon,rating,review_count,
          price_range,cover_image_url,is_frontline,frontline_rank,tagline,
          phone,website,hours,tags,description,is_verified,gallery_urls`, { count: 'exact' })
        .eq('is_active', true)
        .order('is_frontline',   { ascending: false })
        .order('frontline_rank', { ascending: true,  nullsFirst: false })
        .order('rating',         { ascending: false, nullsFirst: false })
        .range(offset, offset + limit - 1);

      if (city && city !== 'all')              query = query.ilike('city', `%${city}%`);
      if (category && category !== 'all')      query = query.eq('category', category);
      if (lat && lon) {
        const b = haverBox(lat, lon, km);
        query = query
          .gte('lat', b.minLat).lte('lat', b.maxLat)
          .gte('lon', b.minLon).lte('lon', b.maxLon);
      }

      const { data, error, count } = await query;
      if (error) return res.status(400).json({ error: error.message });

      return res.status(200).json({
        businesses: data || [],
        total: count || 0,
        page, limit,
        has_more: !show_all && (count || 0) > offset + limit,
        has_next: show_all && offset + limit < (count || 0),
      });
    }

    /* ─── GET /businesses/:id ─────────────────────────────── */
    const bizId = url.match(/^\/businesses\/([^/]+)$/)?.[1];
    if (bizId && req.method === 'GET') {
      const { data: biz, error } = await sb().from('businesses').select('*').eq('id', bizId).single();
      if (error || !biz) return res.status(404).json({ error: 'Business not found' });
      return res.status(200).json({ business: biz });
    }

    /* ─── GET /posts ──────────────────────────────────────── */
    if (url === '/posts' && req.method === 'GET') {
      const page       = Math.max(1, parseInt(q.page || '1'));
      const limit      = Math.min(20, parseInt(q.limit || '10'));
      const offset     = (page - 1) * limit;
      const filter     = q.filter || 'all';
      const userId     = q.user_id || null;
      const followerId = q.follower_id || null;

      let query = sb().from('posts')
        .select('*', { count: 'exact' })
        .or('visibility.eq.public,visibility.is.null')
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (userId) query = query.eq('user_id', userId);
      if (filter === 'organizers') query = query.in('post_type', ['organizer', 'business_update']);
      if (filter === 'community')  query = query.eq('post_type', 'attended_photo');
      if (filter === 'following' && followerId) {
        const { data: fws } = await sb().from('follows').select('following_id').eq('follower_id', followerId);
        const ids = (fws || []).map(f => f.following_id);
        if (!ids.length) return res.status(200).json({ posts: [], total: 0, page, limit, has_next: false });
        query = query.in('user_id', ids);
      }

      const { data: posts, error, count } = await query;
      if (error) return res.status(400).json({ error: error.message });

      const profileIds = [...new Set((posts || []).map(p => p.user_id).filter(Boolean))];
      let profileMap = {};
      if (profileIds.length) {
        const { data: profiles } = await sb().from('profiles')
          .select('id,username,display_name,avatar_url,role,is_verified')
          .in('id', profileIds);
        (profiles || []).forEach(p => { profileMap[p.id] = p; });
      }

      const result = (posts || []).map(p => ({ ...p, profile: profileMap[p.user_id] || null }));
      return res.status(200).json({ posts: result, total: count || 0, page, limit, has_next: offset + limit < (count || 0) });
    }

    /* ─── POST /posts ─────────────────────────────────────── */
    if (url === '/posts' && req.method === 'POST') {
      const token = (req.headers.authorization || '').replace('Bearer ', '');
      const user  = await verifyToken(token);
      if (!user) return res.status(401).json({ error: 'Unauthorized' });

      const { caption, image_url, event_id, event_name, post_type } = req.body || {};
      if (!caption && !image_url) return res.status(400).json({ error: 'caption or image_url required' });

      const { data: post, error } = await sb().from('posts').insert({
        user_id: user.id, caption: caption || null, image_url: image_url || null,
        event_id: event_id || null, event_name: event_name || null,
        post_type: post_type || 'attended_photo', visibility: 'public',
      }).select().single();

      if (error) return res.status(400).json({ error: error.message });

      // Notify followers about new business/organizer post
      if (['business_update', 'organizer'].includes(post_type)) {
        const { data: followers } = await sb().from('follows').select('follower_id').eq('following_id', user.id);
        if (followers && followers.length) {
          const { data: prof } = await sb().from('profiles').select('display_name').eq('id', user.id).single();
          const name = prof?.display_name || 'Someone';
          const notifs = followers.map(f => ({
            user_id: f.follower_id, type: 'business_post', from_user_id: user.id,
            from_display_name: name, entity_id: post.id, entity_type: 'post',
            message: `${name} posted an update`,
          }));
          await sb().from('notifications').insert(notifs);
        }
      }

      return res.status(200).json({ post, success: true });
    }

    /* ─── GET /profiles/:id ───────────────────────────────── */
    const profId = url.match(/^\/profiles\/([^/]+)$/)?.[1];
    if (profId && req.method === 'GET') {
      const [
        { data: profile },
        { count: postsCount },
        { count: followersCount },
        { count: followingCount },
        { data: recentPosts },
      ] = await Promise.all([
        sb().from('profiles').select('id,username,display_name,bio,avatar_url,city,province,role,is_verified,genres').eq('id', profId).single(),
        sb().from('posts').select('id', { count: 'exact', head: true }).eq('user_id', profId).eq('visibility', 'public'),
        sb().from('follows').select('id', { count: 'exact', head: true }).eq('following_id', profId),
        sb().from('follows').select('id', { count: 'exact', head: true }).eq('follower_id', profId),
        sb().from('posts').select('id,caption,image_url,post_type,likes_count,comments_count,created_at').eq('user_id', profId).eq('visibility', 'public').order('created_at', { ascending: false }).limit(6),
      ]);

      if (!profile) return res.status(404).json({ error: 'Profile not found' });

      return res.status(200).json({
        profile,
        posts_count:     postsCount    || 0,
        followers_count: followersCount || 0,
        following_count: followingCount || 0,
        recent_posts:    recentPosts   || [],
      });
    }

    /* ─── POST /ticket/purchase ───────────────────────────── */
    if (url === '/ticket/purchase' && req.method === 'POST') {
      const body = req.body || {};
      const { event_id, tier_id, quantity = 1, buyer_name, buyer_email, buyer_phone } = body;

      if (!event_id || !buyer_name || !buyer_email)
        return res.status(400).json({ error: 'event_id, buyer_name and buyer_email required' });

      const [{ data: ev }, { data: tier }] = await Promise.all([
        sb().from('events').select('name,commission_rate').eq('id', event_id).single(),
        tier_id ? sb().from('ticket_tiers').select('*').eq('id', tier_id).single() : { data: null },
      ]);

      if (!ev) return res.status(404).json({ error: 'Event not found' });

      const qty         = Math.max(1, parseInt(quantity));
      const unit_price  = tier?.price || 0;
      const subtotal    = unit_price * qty;
      const commission  = unit_price > 0 ? +(subtotal * 0.08).toFixed(2) : 0;
      const psf         = unit_price > 0 ? +(subtotal * 0.015 + 1.5).toFixed(2) : 0;
      const total_paid  = +(subtotal + commission + psf).toFixed(2);
      const booking_ref = `PKF-${Date.now()}-${Math.random().toString(36).slice(2, 5).toUpperCase()}`;

      const { data: booking, error: bErr } = await sb().from('bookings').insert({
        booking_ref, event_id,
        tier_id:     tier_id || null,
        buyer_name,  buyer_email,
        buyer_phone: buyer_phone || null,
        quantity:    qty, unit_price, commission, total_paid,
        status:      'confirmed', // Paystack disabled — auto-confirm all
        qr_data:     `PULSIFY:${booking_ref}:${event_id}:VALID`,
      }).select().single();

      if (bErr) return res.status(400).json({ error: bErr.message });

      return res.status(200).json({
        success:     true,
        booking_ref,
        total_paid,
        buyer_email,
        buyer_name,
        is_free:     unit_price === 0,
        qr_data:     booking.qr_data,
        event_name:  ev.name,
        tier_name:   tier?.name || null,
        quantity:    qty,
      });
    }

    /* ─── GET /booking/:ref ───────────────────────────────── */
    const bookRef = url.match(/^\/booking\/([^/]+)$/)?.[1];
    if (bookRef && req.method === 'GET') {
      const { data } = await sb().from('bookings')
        .select('*,events(name,date_local,time_local,venue_name,venue_city)')
        .eq('booking_ref', bookRef).single();
      if (!data) return res.status(404).json({ error: 'Booking not found' });
      return res.status(200).json({ booking: data });
    }

    /* ─── POST /paystack/webhook ──────────────────────────── */
    if (url === '/paystack/webhook' && req.method === 'POST') {
      const sig  = req.headers['x-paystack-signature'] || '';
      const hash = crypto.createHmac('sha512', process.env.PAYSTACK_SECRET_KEY || '')
        .update(JSON.stringify(req.body)).digest('hex');
      if (sig !== hash) return res.status(401).json({ error: 'Invalid signature' });

      if (req.body?.event === 'charge.success') {
        const ref  = req.body.data?.reference;
        const meta = req.body.data?.metadata || {};
        if (meta.booking_id) {
          await Promise.all([
            sb().from('bookings').update({ status: 'confirmed', paystack_ref: ref }).eq('id', meta.booking_id),
            sb().from('payments').upsert({
              paystack_ref: ref, booking_id: meta.booking_id, type: 'ticket',
              amount_kobo: req.body.data?.amount, status: 'success', metadata: meta,
            }, { onConflict: 'paystack_ref' }),
          ]);
        }
      }
      return res.status(200).json({ received: true });
    }

    /* ─── POST /auth/profile ──────────────────────────────── */
    if (url === '/auth/profile' && req.method === 'POST') {
      const token = (req.headers.authorization || '').replace('Bearer ', '');
      if (!token) return res.status(401).json({ error: 'Unauthorized' });

      const { createClient: make } = require('@supabase/supabase-js');
      const userSb = make(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
      const { data: { user } } = await userSb.auth.getUser(token);
      if (!user) return res.status(401).json({ error: 'Unauthorized' });

      const { data: existing } = await sb().from('profiles').select('*').eq('id', user.id).single();
      if (existing) return res.status(200).json({ profile: existing });

      const { data: created } = await sb().from('profiles').insert({
        id:           user.id,
        username:     `user_${user.id.slice(0, 8)}`,
        display_name: user.user_metadata?.full_name || user.email?.split('@')[0] || 'Pulsify User',
        avatar_url:   user.user_metadata?.avatar_url || null,
        city:         'Durban',
      }).select().single();

      return res.status(200).json({ profile: created, created: true });
    }

    /* ─── GET /health ─────────────────────────────────────── */
    if (url === '/health' && req.method === 'GET') {
      return res.status(200).json({ status: 'ok', ts: new Date().toISOString() });
    }

    /* ─── GET /notifications ──────────────────────────────── */
    if (url === '/notifications' && req.method === 'GET') {
      const token = (req.headers.authorization || '').replace('Bearer ', '');
      const user  = await verifyToken(token);
      if (!user) return res.status(401).json({ error: 'Unauthorized' });

      const page   = Math.max(1, parseInt(q.page  || '1'));
      const limit  = Math.min(50, parseInt(q.limit || '20'));
      const offset = (page - 1) * limit;

      const { data, error, count } = await sb().from('notifications')
        .select('*', { count: 'exact' })
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (error) return res.status(400).json({ error: error.message });
      return res.status(200).json({ notifications: data || [], total: count || 0, page, limit });
    }

    /* ─── GET /notifications/count ───────────────────────── */
    if (url === '/notifications/count' && req.method === 'GET') {
      const token = (req.headers.authorization || '').replace('Bearer ', '');
      const user  = await verifyToken(token);
      if (!user) return res.status(401).json({ error: 'Unauthorized' });

      const { count, error } = await sb().from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('read', false);

      if (error) return res.status(400).json({ error: error.message });
      return res.status(200).json({ count: count || 0 });
    }

    /* ─── PATCH /notifications/:id/read ──────────────────── */
    const notifId = url.match(/^\/notifications\/([^/]+)\/read$/)?.[1];
    if (notifId && req.method === 'PATCH') {
      const token = (req.headers.authorization || '').replace('Bearer ', '');
      const user  = await verifyToken(token);
      if (!user) return res.status(401).json({ error: 'Unauthorized' });

      const { error } = await sb().from('notifications')
        .update({ read: true })
        .eq('id', notifId)
        .eq('user_id', user.id);

      if (error) return res.status(400).json({ error: error.message });
      return res.status(200).json({ success: true });
    }

    /* ─── POST /notifications/mark-all-read ──────────────── */
    if (url === '/notifications/mark-all-read' && req.method === 'POST') {
      const token = (req.headers.authorization || '').replace('Bearer ', '');
      const user  = await verifyToken(token);
      if (!user) return res.status(401).json({ error: 'Unauthorized' });

      const { error } = await sb().from('notifications')
        .update({ read: true })
        .eq('user_id', user.id)
        .eq('read', false);

      if (error) return res.status(400).json({ error: error.message });
      return res.status(200).json({ success: true });
    }

    /* ─── POST /reactions ────────────────────────────────── */
    if (url === '/reactions' && req.method === 'POST') {
      const token = (req.headers.authorization || '').replace('Bearer ', '');
      const user  = await verifyToken(token);
      if (!user) return res.status(401).json({ error: 'Unauthorized' });

      const { entity_type, entity_id, type = 'like' } = req.body || {};
      if (!entity_type || !entity_id) return res.status(400).json({ error: 'entity_type and entity_id required' });

      const { data: existing } = await sb().from('reactions')
        .select('id').eq('user_id', user.id).eq('entity_id', entity_id).eq('type', type).maybeSingle();

      if (existing) {
        await sb().from('reactions').delete().eq('id', existing.id);
        if (entity_type === 'post') {
          const { data: p } = await sb().from('posts').select('likes_count').eq('id', entity_id).single();
          await sb().from('posts').update({ likes_count: Math.max(0, (p?.likes_count || 1) - 1) }).eq('id', entity_id);
        }
        return res.status(200).json({ liked: false });
      }

      await sb().from('reactions').insert({ user_id: user.id, entity_type, entity_id, type });

      if (entity_type === 'post') {
        const { data: p } = await sb().from('posts').select('user_id,likes_count').eq('id', entity_id).single();
        if (p) {
          await sb().from('posts').update({ likes_count: (p.likes_count || 0) + 1 }).eq('id', entity_id);
          if (p.user_id !== user.id) {
            const { data: prof } = await sb().from('profiles').select('display_name').eq('id', user.id).single();
            const name = prof?.display_name || 'Someone';
            await sb().from('notifications').insert({
              user_id: p.user_id, type: 'like', from_user_id: user.id,
              from_display_name: name, entity_id, entity_type: 'post',
              message: `${name} liked your post`,
            });
          }
        }
      }

      return res.status(200).json({ liked: true });
    }

    /* ─── DELETE /reactions ──────────────────────────────── */
    if (url === '/reactions' && req.method === 'DELETE') {
      const token = (req.headers.authorization || '').replace('Bearer ', '');
      const user  = await verifyToken(token);
      if (!user) return res.status(401).json({ error: 'Unauthorized' });

      const { entity_id, type = 'like' } = req.body || {};
      if (!entity_id) return res.status(400).json({ error: 'entity_id required' });

      const { data: existing } = await sb().from('reactions')
        .select('id,entity_type').eq('user_id', user.id).eq('entity_id', entity_id).eq('type', type).maybeSingle();

      if (!existing) return res.status(200).json({ liked: false });

      await sb().from('reactions').delete().eq('id', existing.id);
      if (existing.entity_type === 'post') {
        const { data: p } = await sb().from('posts').select('likes_count').eq('id', entity_id).single();
        await sb().from('posts').update({ likes_count: Math.max(0, (p?.likes_count || 1) - 1) }).eq('id', entity_id);
      }
      return res.status(200).json({ liked: false });
    }

    /* ─── POST /follows ──────────────────────────────────── */
    if (url === '/follows' && req.method === 'POST') {
      const token = (req.headers.authorization || '').replace('Bearer ', '');
      const user  = await verifyToken(token);
      if (!user) return res.status(401).json({ error: 'Unauthorized' });

      const { following_id } = req.body || {};
      if (!following_id) return res.status(400).json({ error: 'following_id required' });
      if (following_id === user.id) return res.status(400).json({ error: 'Cannot follow yourself' });

      const { error } = await sb().from('follows').insert({ follower_id: user.id, following_id });
      if (error && error.code !== '23505') return res.status(400).json({ error: error.message });

      if (!error) {
        const { data: prof } = await sb().from('profiles').select('display_name').eq('id', user.id).single();
        const name = prof?.display_name || 'Someone';
        await sb().from('notifications').insert({
          user_id: following_id, type: 'follow', from_user_id: user.id,
          from_display_name: name, entity_id: user.id, entity_type: 'profile',
          message: `${name} started following you`,
        });
      }

      return res.status(200).json({ following: true });
    }

    /* ─── DELETE /follows ────────────────────────────────── */
    if (url === '/follows' && req.method === 'DELETE') {
      const token = (req.headers.authorization || '').replace('Bearer ', '');
      const user  = await verifyToken(token);
      if (!user) return res.status(401).json({ error: 'Unauthorized' });

      const { following_id } = req.body || {};
      if (!following_id) return res.status(400).json({ error: 'following_id required' });

      await sb().from('follows').delete()
        .eq('follower_id', user.id).eq('following_id', following_id);

      return res.status(200).json({ following: false });
    }

    /* ─── GET /comments ──────────────────────────────────── */
    if (url === '/comments' && req.method === 'GET') {
      const entity_id   = q.entity_id;
      const entity_type = q.entity_type || 'post';
      if (!entity_id) return res.status(400).json({ error: 'entity_id required' });

      const { data, error } = await sb().from('comments')
        .select('id,user_id,content,created_at')
        .eq('entity_id', entity_id)
        .eq('entity_type', entity_type)
        .order('created_at', { ascending: true })
        .limit(50);

      if (error) return res.status(400).json({ error: error.message });

      const profileIds = [...new Set((data || []).map(c => c.user_id))];
      let profileMap = {};
      if (profileIds.length) {
        const { data: profiles } = await sb().from('profiles')
          .select('id,username,display_name,avatar_url').in('id', profileIds);
        (profiles || []).forEach(p => { profileMap[p.id] = p; });
      }

      return res.status(200).json({ comments: (data || []).map(c => ({ ...c, profile: profileMap[c.user_id] || null })) });
    }

    /* ─── POST /comments ─────────────────────────────────── */
    if (url === '/comments' && req.method === 'POST') {
      const token = (req.headers.authorization || '').replace('Bearer ', '');
      const user  = await verifyToken(token);
      if (!user) return res.status(401).json({ error: 'Unauthorized' });

      const { entity_id, entity_type = 'post', content } = req.body || {};
      if (!entity_id || !content?.trim()) return res.status(400).json({ error: 'entity_id and content required' });

      const { data: comment, error } = await sb().from('comments')
        .insert({ user_id: user.id, entity_id, entity_type, content: content.trim() })
        .select().single();

      if (error) return res.status(400).json({ error: error.message });

      if (entity_type === 'post') {
        const { data: p } = await sb().from('posts').select('user_id,comments_count').eq('id', entity_id).single();
        if (p) {
          await sb().from('posts').update({ comments_count: (p.comments_count || 0) + 1 }).eq('id', entity_id);
          if (p.user_id !== user.id) {
            const { data: prof } = await sb().from('profiles').select('display_name').eq('id', user.id).single();
            const name = prof?.display_name || 'Someone';
            await sb().from('notifications').insert({
              user_id: p.user_id, type: 'comment', from_user_id: user.id,
              from_display_name: name, entity_id, entity_type: 'post',
              message: `${name} commented on your post`,
            });
          }
        }
      }

      return res.status(200).json({ comment, success: true });
    }

    /* ─── POST /leads/ingest ────────────────────────────── */
    if (url === '/leads/ingest' && req.method === 'POST') {
      const key = req.headers['x-ingest-key'];
      if (!key || key !== process.env.INGEST_SECRET)
        return res.status(401).json({ error: 'Unauthorized' });

      const leads = req.body?.leads || [];
      if (!leads.length) return res.status(400).json({ error: 'No leads provided' });

      let inserted = 0, skipped = 0;
      for (const lead of leads) {
        if (!lead.name) continue;
        const { count } = await sb().from('scraped_leads')
          .select('id', { count: 'exact', head: true })
          .eq('name', lead.name).eq('source', lead.source || 'manual');
        if (count > 0) { skipped++; continue; }
        await sb().from('scraped_leads').insert({
          name:           lead.name,
          category:       lead.category       || 'organizer',
          province:       lead.province       || null,
          city:           lead.city           || null,
          email:          lead.email          || null,
          phone:          lead.phone          || null,
          website:        lead.website        || null,
          instagram:      lead.instagram      || null,
          facebook:       lead.facebook       || null,
          tiktok:         lead.tiktok         || null,
          source:         lead.source         || 'manual',
          description:    lead.description    || null,
          follower_count: lead.follower_count || null,
          status:         'new',
        });
        inserted++;
      }
      return res.status(200).json({ inserted, skipped });
    }

    /* ─── GET /leads ─────────────────────────────────────── */
    if (url === '/leads' && req.method === 'GET') {
      const token = (req.headers.authorization || '').replace('Bearer ', '');
      const user  = await verifyToken(token);
      if (!user) return res.status(401).json({ error: 'Unauthorized' });

      const page     = Math.max(1, parseInt(q.page   || '1'));
      const limit    = Math.min(100, parseInt(q.limit || '20'));
      const offset   = (page - 1) * limit;
      const status   = q.status   || '';
      const category = q.category || '';
      const source   = q.source   || '';
      const province = q.province || '';
      const search   = q.search   || '';

      let query = sb().from('scraped_leads')
        .select('*', { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (status   && status   !== 'all') query = query.eq('status',   status);
      if (category && category !== 'all') query = query.eq('category', category);
      if (source   && source   !== 'all') query = query.eq('source',   source);
      if (province && province !== 'all') query = query.eq('province', province);
      if (search) query = query.or(`name.ilike.%${search}%,city.ilike.%${search}%,email.ilike.%${search}%`);

      const { data, error, count } = await query;
      if (error) return res.status(400).json({ error: error.message });

      const [
        { count: newCount },
        { count: contactedCount },
        { count: convertedCount },
        { count: ignoredCount },
      ] = await Promise.all([
        sb().from('scraped_leads').select('id', { count: 'exact', head: true }).eq('status', 'new'),
        sb().from('scraped_leads').select('id', { count: 'exact', head: true }).eq('status', 'contacted'),
        sb().from('scraped_leads').select('id', { count: 'exact', head: true }).eq('status', 'converted'),
        sb().from('scraped_leads').select('id', { count: 'exact', head: true }).eq('status', 'ignored'),
      ]);

      return res.status(200).json({
        leads: data || [],
        total: count || 0,
        page, limit,
        has_next: offset + limit < (count || 0),
        stats: {
          total: (newCount || 0) + (contactedCount || 0) + (convertedCount || 0) + (ignoredCount || 0),
          new: newCount || 0,
          contacted: contactedCount || 0,
          converted: convertedCount || 0,
          ignored: ignoredCount || 0,
        },
      });
    }

    /* ─── PATCH /leads/:id ───────────────────────────────── */
    const leadId = url.match(/^\/leads\/([^/]+)$/)?.[1];
    if (leadId && req.method === 'PATCH') {
      const token = (req.headers.authorization || '').replace('Bearer ', '');
      const user  = await verifyToken(token);
      if (!user) return res.status(401).json({ error: 'Unauthorized' });

      const { status, notes } = req.body || {};
      const updates = { updated_at: new Date().toISOString() };
      if (status !== undefined) updates.status = status;
      if (notes  !== undefined) updates.notes  = notes;

      const { data, error } = await sb().from('scraped_leads')
        .update(updates).eq('id', leadId).select().single();

      if (error) return res.status(400).json({ error: error.message });
      return res.status(200).json({ lead: data, success: true });
    }

    return res.status(404).json({ error: `Route not found: ${req.method} ${url}` });

  } catch (err) {
    console.error('[Pulsify API]', err.message);
    return res.status(500).json({ error: 'Server error', detail: err.message });
  }
};
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

const sb = () => createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
};

function haverBox(lat, lon, km) {
  const R = 111, d = km / R, dl = km / (R * Math.cos(lat * Math.PI / 180));
  return { minLat: lat - d, maxLat: lat + d, minLon: lon - dl, maxLon: lon + dl };
}

async function verifyToken(token) {
  if (!token) return null;
  try {
    const userSb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY,
      { auth: { autoRefreshToken: false, persistSession: false } });
    const { data: { user } } = await userSb.auth.getUser(token);
    return user || null;
  } catch { return null; }
}

// Auth helper for admin routes
async function authUser(req) {
  const token = (req.headers.authorization || '').replace('Bearer ', '').trim();
  if (!token) return null;
  try {
    const userSb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY,
      { auth: { autoRefreshToken: false, persistSession: false } });
    const { data: { user }, error } = await userSb.auth.getUser(token);
    if (error || !user) return null;
    const { data: profile } = await sb().from('profiles').select('*').eq('id', user.id).single();
    return { user, profile: profile || { id: user.id, role: 'user' } };
  } catch(e) {
    return null;
  }
}

// Middleware to check admin role
async function requireAdmin(req, res, next) {
  const auth = await authUser(req);
  if (!auth || auth.profile.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  req.auth = auth;
  next();
}

module.exports = async (req, res) => {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));
  if (req.method === 'OPTIONS') return res.status(200).end();

  const url    = (req.url || '/').split('?')[0].replace(/^\/api/, '') || '/';
  const q      = Object.fromEntries(new URL(req.url, 'http://x').searchParams);
  const today  = new Date().toISOString().split('T')[0];

  try {

    /* ═══════════════════════════════════════════════════════════════════════════════ */
    /* ADMIN ROUTES */
    /* ═══════════════════════════════════════════════════════════════════════════════ */

    // PATCH /admin/users/:id - Update user (suspend/activate, change role)
    const adminUserMatch = url.match(/^\/admin\/users\/([^/]+)$/);
    if (adminUserMatch && req.method === 'PATCH') {
      const auth = await authUser(req);
      if (!auth || auth.profile.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
      }

      const userId = adminUserMatch[1];
      const { suspended, role } = req.body || {};
      
      const updates = {};
      if (typeof suspended === 'boolean') updates.suspended = suspended;
      if (role && ['user', 'business', 'admin'].includes(role)) updates.role = role;
      
      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ error: 'No valid updates provided' });
      }
      
      const { data, error } = await sb()
        .from('profiles')
        .update(updates)
        .eq('id', userId)
        .select()
        .single();
      
      if (error) throw error;
      
      return res.status(200).json({ success: true, profile: data });
    }

    // POST /admin/users/:id/trial - Grant free trial
    const adminTrialMatch = url.match(/^\/admin\/users\/([^/]+)\/trial$/);
    if (adminTrialMatch && req.method === 'POST') {
      const auth = await authUser(req);
      if (!auth || auth.profile.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
      }

      const userId = adminTrialMatch[1];
      const { months } = req.body || {};
      
      if (![1, 2, 3].includes(months)) {
        return res.status(400).json({ error: 'Months must be 1, 2, or 3' });
      }
      
      const expiresAt = new Date();
      expiresAt.setMonth(expiresAt.getMonth() + months);
      
      const { data, error } = await sb()
        .from('profiles')
        .update({ trial_expires_at: expiresAt.toISOString() })
        .eq('id', userId)
        .select()
        .single();
      
      if (error) throw error;
      
      return res.status(200).json({ success: true, trial_expires_at: data.trial_expires_at });
    }

    // GET /admin/users - List all users
    if (url === '/admin/users' && req.method === 'GET') {
      const auth = await authUser(req);
      if (!auth || auth.profile.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
      }

      const { data, error } = await sb()
        .from('profiles')
        .select('id,email,role,full_name,trial_expires_at,suspended,created_at')
        .order('created_at', { ascending: false });
      
      if (error) throw error;
      
      return res.status(200).json({ users: data });
    }

    /* ═══════════════════════════════════════════════════════════════════════════════ */
    /* PUBLIC ROUTES */
    /* ═══════════════════════════════════════════════════════════════════════════════ */

    /* ─── GET /events ─────────────────────────────────────── */
    if (url === '/events' && req.method === 'GET') {
      const page   = Math.max(1, parseInt(q.page  || '1'));
      const limit  = Math.min(50, parseInt(q.limit || '10'));
      const offset = (page - 1) * limit;
      const city   = q.city   || '';
      const genre  = q.genre  || '';
      const search = q.search || '';
      const lat    = parseFloat(q.lat)       || null;
      const lon    = parseFloat(q.lon)       || null;
      const km     = parseFloat(q.radius_km) || 100;
      const from_date = q.from_date || today;

      let query = sb().from('events')
        .select(`id,name,date_local,time_local,venue_name,venue_city,venue_address,
          venue_lat,venue_lon,price_min,is_free,image_url,genre,hype_score,
          like_count,comment_count,is_frontline,frontline_rank,external_url,
          source,status,description,lineup,dress_code,age_restriction,
          attendance_count,organiser_name,capacity,tickets_sold`, { count: 'exact' })
        .gte('date_local', from_date)
        .eq('is_active', true)
        .not('status', 'in', '(cancelled,postponed)')
        .order('is_frontline',   { ascending: false })
        .order('hype_score',     { ascending: false, nullsFirst: false })
        .order('date_local',     { ascending: true })
        .range(offset, offset + limit - 1);

      if (city && city !== 'all')  query = query.ilike('venue_city', `%${city}%`);
      if (genre === 'free')        query = query.eq('is_free', true);
      else if (genre && genre !== 'all') query = query.ilike('genre', `%${genre}%`);
      if (search) query = query.textSearch('id', search, { type: 'websearch', config: 'english' });
      if (lat && lon) {
        const b = haverBox(lat, lon, km);
        query = query
          .gte('venue_lat', b.minLat).lte('venue_lat', b.maxLat)
          .gte('venue_lon', b.minLon).lte('venue_lon', b.maxLon);
      }

      const { data, error, count } = await query;
      if (error) return res.status(400).json({ error: error.message });

      return res.status(200).json({
        events: data || [],
        total:  count || 0,
        page, limit, offset,
        total_pages: Math.ceil((count || 0) / limit),
        has_next: offset + limit < (count || 0),
        has_prev: page > 1,
      });
    }

    /* ─── GET /events/search ──────────────────────────────── */
    if (url === '/events/search' && req.method === 'GET') {
      const term  = q.q || '';
      const limit = Math.min(20, parseInt(q.limit || '10'));
      if (!term) return res.status(200).json({ results: [] });

      const { data, error } = await sb().from('events')
        .select('id,name,venue_city,date_local,genre,image_url,is_free,price_min')
        .gte('date_local', today)
        .eq('is_active', true)
        .or(`name.ilike.%${term}%,venue_city.ilike.%${term}%,genre.ilike.%${term}%,venue_name.ilike.%${term}%`)
        .order('hype_score', { ascending: false })
        .limit(limit);

      if (error) return res.status(400).json({ error: error.message });
      return res.status(200).json({ results: data || [] });
    }

    /* ─── GET /events/:id ─────────────────────────────────── */
    const evId = url.match(/^\/events\/([^/]+)$/)?.[1];
    if (evId && req.method === 'GET') {
      const [{ data: ev, error: evErr }, { data: tiers }, { data: photos }] = await Promise.all([
        sb().from('events').select('*').eq('id', evId).single(),
        sb().from('ticket_tiers').select('*').eq('event_id', evId).order('sort_order'),
        sb().from('event_photos').select('*').eq('event_id', evId).order('created_at', { ascending: false }).limit(12),
      ]);
      if (evErr || !ev) return res.status(404).json({ error: 'Event not found' });
      return res.status(200).json({ event: ev, tiers: tiers || [], photos: photos || [] });
    }

    /* ─── GET /businesses ─────────────────────────────────── */
    if (url === '/businesses' && req.method === 'GET') {
      const show_all  = q.show_all === 'true';
      const page      = Math.max(1, parseInt(q.page || '1'));
      const limit     = show_all ? Math.min(50, parseInt(q.limit || '20')) : Math.min(8, parseInt(q.limit || '6'));
      const offset    = (page - 1) * limit;
      const city      = q.city     || '';
      const category  = q.category || '';
      const lat       = parseFloat(q.lat) || null;
      const lon       = parseFloat(q.lon) || null;
      const km        = parseFloat(q.radius_km) || 100;

      let query = sb().from('businesses')
        .select(`id,name,category,suburb,city,lat,lon,rating,review_count,
          price_range,cover_image_url,is_frontline,frontline_rank,tagline,
          phone,website,hours,tags,description,is_verified,gallery_urls`, { count: 'exact' })
        .eq('is_active', true)
        .order('is_frontline',   { ascending: false })
        .order('frontline_rank', { ascending: true,  nullsFirst: false })
        .order('rating',         { ascending: false, nullsFirst: false })
        .range(offset, offset + limit - 1);

      if (city && city !== 'all')              query = query.ilike('city', `%${city}%`);
      if (category && category !== 'all')      query = query.eq('category', category);
      if (lat && lon) {
        const b = haverBox(lat, lon, km);
        query = query
          .gte('lat', b.minLat).lte('lat', b.maxLat)
          .gte('lon', b.minLon).lte('lon', b.maxLon);
      }

      const { data, error, count } = await query;
      if (error) return res.status(400).json({ error: error.message });

      return res.status(200).json({
        businesses: data || [],
        total: count || 0,
        page, limit,
        has_more: !show_all && (count || 0) > offset + limit,
        has_next: show_all && offset + limit < (count || 0),
      });
    }

    /* ─── GET /businesses/:id ─────────────────────────────── */
    const bizId = url.match(/^\/businesses\/([^/]+)$/)?.[1];
    if (bizId && req.method === 'GET') {
      const { data: biz, error } = await sb().from('businesses').select('*').eq('id', bizId).single();
      if (error || !biz) return res.status(404).json({ error: 'Business not found' });
      return res.status(200).json({ business: biz });
    }

    /* ─── GET /posts ──────────────────────────────────────── */
    if (url === '/posts' && req.method === 'GET') {
      const page       = Math.max(1, parseInt(q.page || '1'));
      const limit      = Math.min(20, parseInt(q.limit || '10'));
      const offset     = (page - 1) * limit;
      const filter     = q.filter || 'all';
      const userId     = q.user_id || null;
      const followerId = q.follower_id || null;

      let query = sb().from('posts')
        .select('*', { count: 'exact' })
        .eq('visibility', 'public')
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (userId) query = query.eq('user_id', userId);
      if (filter === 'organizers') query = query.in('post_type', ['organizer', 'business_update']);
      if (filter === 'community')  query = query.eq('post_type', 'attended_photo');
      if (filter === 'following' && followerId) {
        const { data: fws } = await sb().from('follows').select('following_id').eq('follower_id', followerId);
        const ids = (fws || []).map(f => f.following_id);
        if (!ids.length) return res.status(200).json({ posts: [], total: 0, page, limit, has_next: false });
        query = query.in('user_id', ids);
      }

      const { data: posts, error, count } = await query;
      if (error) return res.status(400).json({ error: error.message });

      const profileIds = [...new Set((posts || []).map(p => p.user_id).filter(Boolean))];
      let profileMap = {};
      if (profileIds.length) {
        const { data: profiles } = await sb().from('profiles')
          .select('id,username,display_name,avatar_url,role,is_verified')
          .in('id', profileIds);
        (profiles || []).forEach(p => { profileMap[p.id] = p; });
      }

      const result = (posts || []).map(p => ({ ...p, profile: profileMap[p.user_id] || null }));
      return res.status(200).json({ posts: result, total: count || 0, page, limit, has_next: offset + limit < (count || 0) });
    }

    /* ─── POST /posts ─────────────────────────────────────── */
    if (url === '/posts' && req.method === 'POST') {
      const token = (req.headers.authorization || '').replace('Bearer ', '');
      const user  = await verifyToken(token);
      if (!user) return res.status(401).json({ error: 'Unauthorized' });

      const { caption, image_url, event_id, event_name, post_type } = req.body || {};
      if (!caption && !image_url) return res.status(400).json({ error: 'caption or image_url required' });

      const { data: post, error } = await sb().from('posts').insert({
        user_id: user.id, caption: caption || null, image_url: image_url || null,
        event_id: event_id || null, event_name: event_name || null,
        post_type: post_type || 'attended_photo', visibility: 'public',
      }).select().single();

      if (error) return res.status(400).json({ error: error.message });

      // Notify followers about new business/organizer post
      if (['business_update', 'organizer'].includes(post_type)) {
        const { data: followers } = await sb().from('follows').select('follower_id').eq('following_id', user.id);
        if (followers && followers.length) {
          const { data: prof } = await sb().from('profiles').select('display_name').eq('id', user.id).single();
          const name = prof?.display_name || 'Someone';
          const notifs = followers.map(f => ({
            user_id: f.follower_id, type: 'business_post', from_user_id: user.id,
            from_display_name: name, entity_id: post.id, entity_type: 'post',
            message: `${name} posted an update`,
          }));
          await sb().from('notifications').insert(notifs);
        }
      }

      return res.status(200).json({ post, success: true });
    }

    /* ─── GET /profiles/:id ───────────────────────────────── */
    const profId = url.match(/^\/profiles\/([^/]+)$/)?.[1];
    if (profId && req.method === 'GET') {
      const [
        { data: profile },
        { count: postsCount },
        { count: followersCount },
        { count: followingCount },
        { data: recentPosts },
      ] = await Promise.all([
        sb().from('profiles').select('id,username,display_name,bio,avatar_url,city,province,role,is_verified,genres').eq('id', profId).single(),
        sb().from('posts').select('id', { count: 'exact', head: true }).eq('user_id', profId).eq('visibility', 'public'),
        sb().from('follows').select('id', { count: 'exact', head: true }).eq('following_id', profId),
        sb().from('follows').select('id', { count: 'exact', head: true }).eq('follower_id', profId),
        sb().from('posts').select('id,caption,image_url,post_type,likes_count,comments_count,created_at').eq('user_id', profId).eq('visibility', 'public').order('created_at', { ascending: false }).limit(6),
      ]);

      if (!profile) return res.status(404).json({ error: 'Profile not found' });

      return res.status(200).json({
        profile,
        posts_count:     postsCount    || 0,
        followers_count: followersCount || 0,
        following_count: followingCount || 0,
        recent_posts:    recentPosts   || [],
      });
    }

    /* ─── POST /ticket/purchase ───────────────────────────── */
    if (url === '/ticket/purchase' && req.method === 'POST') {
      const body = req.body || {};
      const { event_id, tier_id, quantity = 1, buyer_name, buyer_email, buyer_phone } = body;

      if (!event_id || !buyer_name || !buyer_email)
        return res.status(400).json({ error: 'event_id, buyer_name and buyer_email required' });

      const [{ data: ev }, { data: tier }] = await Promise.all([
        sb().from('events').select('name,commission_rate').eq('id', event_id).single(),
        tier_id ? sb().from('ticket_tiers').select('*').eq('id', tier_id).single() : { data: null },
      ]);

      if (!ev) return res.status(404).json({ error: 'Event not found' });

      const qty         = Math.max(1, parseInt(quantity));
      const unit_price  = tier?.price || 0;
      const subtotal    = unit_price * qty;
      const commission  = unit_price > 0 ? +(subtotal * 0.08).toFixed(2) : 0;
      const psf         = unit_price > 0 ? +(subtotal * 0.015 + 1.5).toFixed(2) : 0;
      const total_paid  = +(subtotal + commission + psf).toFixed(2);
      const booking_ref = `PKF-${Date.now()}-${Math.random().toString(36).slice(2, 5).toUpperCase()}`;

      const { data: booking, error: bErr } = await sb().from('bookings').insert({
        booking_ref, event_id,
        tier_id:     tier_id || null,
        buyer_name,  buyer_email,
        buyer_phone: buyer_phone || null,
        quantity:    qty, unit_price, commission, total_paid,
        status:      'confirmed', // Paystack disabled — auto-confirm all
        qr_data:     `PULSIFY:${booking_ref}:${event_id}:VALID`,
      }).select().single();

      if (bErr) return res.status(400).json({ error: bErr.message });

      return res.status(200).json({
        success:     true,
        booking_ref,
        total_paid,
        buyer_email,
        buyer_name,
        is_free:     unit_price === 0,
        qr_data:     booking.qr_data,
        event_name:  ev.name,
        tier_name:   tier?.name || null,
        quantity:    qty,
      });
    }

    /* ─── GET /booking/:ref ───────────────────────────────── */
    const bookRef = url.match(/^\/booking\/([^/]+)$/)?.[1];
    if (bookRef && req.method === 'GET') {
      const { data } = await sb().from('bookings')
        .select('*,events(name,date_local,time_local,venue_name,venue_city)')
        .eq('booking_ref', bookRef).single();
      if (!data) return res.status(404).json({ error: 'Booking not found' });
      return res.status(200).json({ booking: data });
    }

    /* ─── POST /paystack/webhook ──────────────────────────── */
    if (url === '/paystack/webhook' && req.method === 'POST') {
      const sig  = req.headers['x-paystack-signature'] || '';
      const hash = crypto.createHmac('sha512', process.env.PAYSTACK_SECRET_KEY || '')
        .update(JSON.stringify(req.body)).digest('hex');
      if (sig !== hash) return res.status(401).json({ error: 'Invalid signature' });

      if (req.body?.event === 'charge.success') {
        const ref  = req.body.data?.reference;
        const meta = req.body.data?.metadata || {};
        if (meta.booking_id) {
          await Promise.all([
            sb().from('bookings').update({ status: 'confirmed', paystack_ref: ref }).eq('id', meta.booking_id),
            sb().from('payments').upsert({
              paystack_ref: ref, booking_id: meta.booking_id, type: 'ticket',
              amount_kobo: req.body.data?.amount, status: 'success', metadata: meta,
            }, { onConflict: 'paystack_ref' }),
          ]);
        }
      }
      return res.status(200).json({ received: true });
    }

    /* ─── POST /auth/profile ──────────────────────────────── */
    if (url === '/auth/profile' && req.method === 'POST') {
      const token = (req.headers.authorization || '').replace('Bearer ', '');
      if (!token) return res.status(401).json({ error: 'Unauthorized' });

      const { createClient: make } = require('@supabase/supabase-js');
      const userSb = make(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
      const { data: { user } } = await userSb.auth.getUser(token);
      if (!user) return res.status(401).json({ error: 'Unauthorized' });

      const pData = req.body?.profile || {};

      const { data: existing } = await sb().from('profiles').select('*').eq('id', user.id).single();
      if (existing) {
        const u = {};
        if (pData.role && pData.role !== 'user' && pData.role !== existing.role) u.role = pData.role;
        if (pData.is_page && !existing.is_page) u.is_page = true;
        if (Object.keys(u).length) {
          const { data: upd } = await sb().from('profiles').update(u).eq('id', user.id).select().single();
          return res.status(200).json({ profile: upd || existing });
        }
        return res.status(200).json({ profile: existing });
      }

      let username = pData.username || `user_${user.id.slice(0, 8)}`;
      const { data: uCheck } = await sb().from('profiles').select('id').eq('username', username).maybeSingle();
      if (uCheck) username = `user_${user.id.slice(0, 8)}`;

      const { data: created } = await sb().from('profiles').insert({
        id:           user.id,
        username,
        display_name: pData.display_name || user.user_metadata?.full_name || user.email?.split('@')[0] || 'Pulsify User',
        avatar_url:   pData.avatar_url || user.user_metadata?.avatar_url || null,
        email:        user.email,
        role:         pData.role || 'user',
        is_page:      pData.is_page || false,
        city:         pData.city || null,
        province:     pData.province || null,
        bio:          pData.bio || '',
        phone:        pData.phone || null,
      }).select().single();

      return res.status(200).json({ profile: created, created: true });
    }

    /* ─── POST /auth/ensure-business-profile ────────────────── */
    if (url === '/auth/ensure-business-profile' && req.method === 'POST') {
      const token = (req.headers.authorization || '').replace('Bearer ', '');
      const user = await verifyToken(token);
      if (!user) return res.status(401).json({ error: 'Unauthorized' });

      const supabase = sb();
      let { data: profile, error: profileError } = await supabase.from('profiles').select('*').eq('id', user.id).single();
      
      if (profileError && profileError.code !== 'PGRST116') throw profileError;

      if (!profile) {
        const { data: newProfile, error: createError } = await supabase.from('profiles').insert({
          id: user.id, email: user.email,
          display_name: user.user_metadata?.full_name || user.email.split('@')[0],
          avatar_url: user.user_metadata?.avatar_url,
          role: 'business'
        }).select().single();
        if (createError) throw createError;
        profile = newProfile;
        
        const { data: bizCheck } = await supabase.from('businesses').select('id').eq('id', profile.id).maybeSingle();
        if (!bizCheck) {
          await supabase.from('businesses').insert({ id: profile.id, owner_id: profile.id, name: profile.display_name, category: 'other', is_active: true });
        }
      } else if (!['business', 'admin', 'organizer'].includes(profile.role)) {
        const { data: updatedProfile, error: updateError } = await supabase.from('profiles').update({ role: 'business' }).eq('id', user.id).select().single();
        if (updateError) throw updateError;
        profile = updatedProfile;
      }
      return res.status(200).json({ profile });
    }

    /* ─── GET /health ─────────────────────────────────────── */
    if (url === '/health' && req.method === 'GET') {
      return res.status(200).json({ status: 'ok', ts: new Date().toISOString() });
    }

    return res.status(404).json({ error: `Route not found: ${req.method} ${url}` });

  } catch (err) {
    console.error('[Pulsify API]', err.message);
    return res.status(500).json({ error: 'Server error', detail: err.message });
  }
};
