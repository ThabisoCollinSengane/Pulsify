/* ═══════════════════════════════════════════════════════════
   PULSIFY API  v2 — Unified backend
   All routes in one handler. Supabase service key used for
   admin operations; anon key used to validate user JWTs.
   ═══════════════════════════════════════════════════════════ */

const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

/* ── Supabase clients ─────────────────────────────────────── */
const sb = () => createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

/* Validate a user JWT and return { user, profile } or null */
async function authUser(req) {
  const token = (req.headers.authorization || '').replace('Bearer ', '').trim();
  if (!token) return null;
  try {
    const { createClient: make } = require('@supabase/supabase-js');
    const userSb = make(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
    const { data: { user }, error } = await userSb.auth.getUser(token);
    if (error || !user) return null;
    const { data: profile } = await sb().from('profiles').select('*').eq('id', user.id).single();
    return { user, profile: profile || { id: user.id, role: 'user' } };
  } catch { return null; }
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
};

function haverBox(lat, lon, km) {
  const R = 111, d = km / R, dl = km / (R * Math.cos(lat * Math.PI / 180));
  return { minLat: lat - d, maxLat: lat + d, minLon: lon - dl, maxLon: lon + dl };
}

function haverDist(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

module.exports = async (req, res) => {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));
  if (req.method === 'OPTIONS') return res.status(200).end();

  const url   = (req.url || '/').split('?')[0].replace(/^\/api/, '') || '/';
  const q     = Object.fromEntries(new URL(req.url, 'http://x').searchParams);
  const today = new Date().toISOString().split('T')[0];
  const body  = req.body || {};

  try {

    /* ═══════════════════════════════════════════════════════
       EVENTS
       ═══════════════════════════════════════════════════════ */
    if (url === '/events' && req.method === 'GET') {
      const page      = Math.max(1, parseInt(q.page  || '1'));
      const limit     = Math.min(50, parseInt(q.limit || '10'));
      const offset    = (page - 1) * limit;
      const city      = q.city   || '';
      const genre     = q.genre  || '';
      const search    = q.search || '';
      const lat       = parseFloat(q.lat) || null;
      const lon       = parseFloat(q.lon) || null;
      const km        = parseFloat(q.radius_km) || 100;
      const from_date = q.from_date || today;

      let query = sb().from('events')
        .select(`id,name,date_local,time_local,venue_name,venue_city,venue_address,
          venue_lat,venue_lon,price_min,is_free,image_url,genre,hype_score,
          like_count,comment_count,is_frontline,frontline_rank,external_url,
          source,status,description,lineup,dress_code,age_restriction,
          attendance_count,organiser_name,capacity,tickets_sold`, { count: 'exact' })
        .gte('date_local', from_date).eq('is_active', true)
        .not('status', 'in', '(cancelled,postponed)')
        .order('is_frontline',  { ascending: false })
        .order('hype_score',    { ascending: false, nullsFirst: false })
        .order('date_local',    { ascending: true })
        .range(offset, offset + limit - 1);

      if (city && city !== 'all')         query = query.ilike('venue_city', `%${city}%`);
      if (genre === 'free')               query = query.eq('is_free', true);
      else if (genre && genre !== 'all')  query = query.ilike('genre', `%${genre}%`);
      if (search) query = query.or(`name.ilike.%${search}%,venue_name.ilike.%${search}%,genre.ilike.%${search}%`);
      if (lat && lon) {
        const b = haverBox(lat, lon, km);
        query = query.gte('venue_lat', b.minLat).lte('venue_lat', b.maxLat)
          .gte('venue_lon', b.minLon).lte('venue_lon', b.maxLon);
      }

      const { data, error, count } = await query;
      if (error) return res.status(400).json({ error: error.message });
      return res.status(200).json({
        events: data || [], total: count || 0, page, limit, offset,
        total_pages: Math.ceil((count || 0) / limit),
        has_next: offset + limit < (count || 0), has_prev: page > 1,
      });
    }

    if (url === '/events/search' && req.method === 'GET') {
      const term  = q.q || '';
      const limit = Math.min(20, parseInt(q.limit || '10'));
      if (!term) return res.status(200).json({ results: [] });
      const { data, error } = await sb().from('events')
        .select('id,name,venue_city,date_local,genre,image_url,is_free,price_min')
        .gte('date_local', today).eq('is_active', true)
        .or(`name.ilike.%${term}%,venue_city.ilike.%${term}%,genre.ilike.%${term}%,venue_name.ilike.%${term}%`)
        .order('hype_score', { ascending: false }).limit(limit);
      if (error) return res.status(400).json({ error: error.message });
      return res.status(200).json({ results: data || [] });
    }

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

    /* ═══════════════════════════════════════════════════════
       BUSINESSES
       ═══════════════════════════════════════════════════════ */
    if (url === '/businesses' && req.method === 'GET') {
      const show_all = q.show_all === 'true';
      const page     = Math.max(1, parseInt(q.page || '1'));
      const limit    = show_all ? Math.min(50, parseInt(q.limit || '20')) : Math.min(8, parseInt(q.limit || '6'));
      const offset   = (page - 1) * limit;
      const city     = q.city || '';
      const category = q.category || '';
      const lat      = parseFloat(q.lat) || null;
      const lon      = parseFloat(q.lon) || null;
      const km       = parseFloat(q.radius_km) || 100;

      let query = sb().from('businesses')
        .select(`id,name,category,suburb,city,lat,lon,rating,review_count,
          price_range,cover_image_url,is_frontline,frontline_rank,tagline,
          phone,website,hours,tags,description,is_verified,gallery_urls`, { count: 'exact' })
        .eq('is_active', true)
        .order('is_frontline',   { ascending: false })
        .order('frontline_rank', { ascending: true,  nullsFirst: false })
        .order('rating',         { ascending: false, nullsFirst: false })
        .range(offset, offset + limit - 1);

      if (city && city !== 'all')         query = query.ilike('city', `%${city}%`);
      if (category && category !== 'all') query = query.eq('category', category);
      if (lat && lon) {
        const b = haverBox(lat, lon, km);
        query = query.gte('lat', b.minLat).lte('lat', b.maxLat).gte('lon', b.minLon).lte('lon', b.maxLon);
      }

      const { data, error, count } = await query;
      if (error) return res.status(400).json({ error: error.message });
      return res.status(200).json({
        businesses: data || [], total: count || 0, page, limit,
        has_more: !show_all && (count || 0) > offset + limit,
        has_next: show_all && offset + limit < (count || 0),
      });
    }

    const bizId = url.match(/^\/businesses\/([^/]+)$/)?.[1];
    if (bizId && req.method === 'GET') {
      const { data: biz, error } = await sb().from('businesses').select('*').eq('id', bizId).single();
      if (error || !biz) return res.status(404).json({ error: 'Business not found' });
      return res.status(200).json({ business: biz });
    }

    /* ═══════════════════════════════════════════════════════
       POSTS — user + organizer feed
       ═══════════════════════════════════════════════════════ */
    if (url === '/posts' && req.method === 'GET') {
      const page   = Math.max(1, parseInt(q.page  || '1'));
      const limit  = Math.min(20, parseInt(q.limit || '10'));
      const offset = (page - 1) * limit;
      const filter = q.filter || 'all'; // all | following | organizers | community
      const auth   = await authUser(req);
      const uid    = auth?.user?.id || null;

      let query = sb().from('posts')
        .select(`id,user_id,caption,image_url,event_id,event_name,post_type,
          visibility,created_at,like_count,comment_count,repost_count,
          profiles(username,display_name,avatar_url,role,is_verified)`, { count: 'exact' })
        .eq('visibility', 'public')
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (filter === 'organizers' || filter === 'community') {
        const role = filter === 'organizers' ? ['organizer','business'] : ['user'];
        // join via profiles role — filter after fetch if needed
      }

      if (filter === 'following' && uid) {
        const { data: follows } = await sb().from('follows')
          .select('following_id').eq('follower_id', uid);
        const ids = (follows || []).map(f => f.following_id);
        if (ids.length) query = query.in('user_id', ids);
        else return res.status(200).json({ posts: [], total: 0, page, limit, has_next: false });
      }

      const { data, error, count } = await query;
      if (error) return res.status(400).json({ error: error.message });

      let posts = data || [];

      // Filter by role on organizers/community after fetch (profiles is joined)
      if (filter === 'organizers') posts = posts.filter(p => ['organizer','business'].includes(p.profiles?.role));
      if (filter === 'community')  posts = posts.filter(p => p.profiles?.role === 'user');

      // Mark liked/reposted for current user
      if (uid && posts.length) {
        const postIds = posts.map(p => p.id);
        const [{ data: liked }, { data: reposted }] = await Promise.all([
          sb().from('reactions').select('entity_id').eq('user_id', uid).eq('type','like').in('entity_id', postIds),
          sb().from('reposts').select('post_id').eq('user_id', uid).in('post_id', postIds),
        ]);
        const likedSet    = new Set((liked    || []).map(r => r.entity_id));
        const repostedSet = new Set((reposted || []).map(r => r.post_id));
        posts = posts.map(p => ({ ...p, is_liked: likedSet.has(p.id), is_reposted: repostedSet.has(p.id) }));
      }

      return res.status(200).json({
        posts, total: count || 0, page, limit,
        has_next: offset + limit < (count || 0),
        total_pages: Math.ceil((count || 0) / limit),
      });
    }

    if (url === '/posts' && req.method === 'POST') {
      const auth = await authUser(req);
      if (!auth) return res.status(401).json({ error: 'Unauthorized' });

      const { caption, image_url, event_id, event_name, post_type, lat, lon, visibility = 'public' } = body;
      const uid     = auth.user.id;
      const role    = auth.profile?.role || 'user';
      const isOrg   = ['organizer','business','admin'].includes(role);

      // Regular users must provide an image
      if (!isOrg && !image_url) return res.status(400).json({ error: 'Users must upload a photo to post' });

      // If event_id provided and user has lat/lon, check 100m radius
      if (event_id && lat && lon) {
        const { data: ev } = await sb().from('events').select('venue_lat,venue_lon').eq('id', event_id).single();
        if (ev?.venue_lat && ev?.venue_lon) {
          const dist = haverDist(parseFloat(lat), parseFloat(lon), parseFloat(ev.venue_lat), parseFloat(ev.venue_lon));
          if (dist > 100) return res.status(400).json({ error: 'You must be within 100m of the event venue to post' });
        }
        // Mark attendance
        await sb().from('event_attendances').upsert({ user_id: uid, event_id, attended_at: new Date().toISOString() }, { onConflict: 'user_id,event_id' });
      }

      const { data: post, error } = await sb().from('posts').insert({
        user_id: uid, caption: caption || '', image_url: image_url || null,
        event_id: event_id || null, event_name: event_name || null,
        post_type: post_type || (isOrg ? 'organizer' : 'attended_photo'),
        visibility, like_count: 0, comment_count: 0, repost_count: 0,
      }).select().single();

      if (error) return res.status(400).json({ error: error.message });
      return res.status(201).json({ post });
    }

    const postDeleteId = url.match(/^\/posts\/([^/]+)$/)?.[1];
    if (postDeleteId && req.method === 'DELETE') {
      const auth = await authUser(req);
      if (!auth) return res.status(401).json({ error: 'Unauthorized' });
      const { error } = await sb().from('posts')
        .delete().eq('id', postDeleteId).eq('user_id', auth.user.id);
      if (error) return res.status(400).json({ error: error.message });
      return res.status(200).json({ success: true });
    }

    /* ═══════════════════════════════════════════════════════
       REACTIONS (like/unlike)
       ═══════════════════════════════════════════════════════ */
    if (url === '/reactions' && req.method === 'POST') {
      const auth = await authUser(req);
      if (!auth) return res.status(401).json({ error: 'Unauthorized' });
      const { entity_type = 'post', entity_id, type = 'like' } = body;
      const uid = auth.user.id;

      const { data: existing } = await sb().from('reactions')
        .select('id').eq('user_id', uid).eq('entity_id', entity_id).eq('type', type).single();

      if (existing) {
        await sb().from('reactions').delete().eq('id', existing.id);
        // Decrement count
        await sb().from(entity_type === 'post' ? 'posts' : 'events')
          .update({ like_count: sb().raw('like_count - 1') }).eq('id', entity_id);
        return res.status(200).json({ liked: false });
      } else {
        await sb().from('reactions').insert({ user_id: uid, entity_type, entity_id, type });
        await sb().from(entity_type === 'post' ? 'posts' : 'events')
          .update({ like_count: sb().raw('like_count + 1') }).eq('id', entity_id);
        return res.status(200).json({ liked: true });
      }
    }

    /* ═══════════════════════════════════════════════════════
       REPOSTS
       ═══════════════════════════════════════════════════════ */
    const repostId = url.match(/^\/posts\/([^/]+)\/repost$/)?.[1];
    if (repostId && req.method === 'POST') {
      const auth = await authUser(req);
      if (!auth) return res.status(401).json({ error: 'Unauthorized' });
      const uid = auth.user.id;

      const { data: existing } = await sb().from('reposts')
        .select('id').eq('user_id', uid).eq('post_id', repostId).single();

      if (existing) {
        await sb().from('reposts').delete().eq('id', existing.id);
        await sb().from('posts').update({ repost_count: sb().raw('repost_count - 1') }).eq('id', repostId);
        return res.status(200).json({ reposted: false });
      } else {
        await sb().from('reposts').insert({ user_id: uid, post_id: repostId });
        await sb().from('posts').update({ repost_count: sb().raw('repost_count + 1') }).eq('id', repostId);
        return res.status(200).json({ reposted: true });
      }
    }

    /* ═══════════════════════════════════════════════════════
       COMMENTS
       ═══════════════════════════════════════════════════════ */
    const cmtMatch = url.match(/^\/comments\/([^/]+)\/([^/]+)$/);
    if (cmtMatch && req.method === 'GET') {
      const [, entity_type, entity_id] = cmtMatch;
      const { data, error } = await sb().from('comments')
        .select('*,profiles(username,display_name,avatar_url)')
        .eq('entity_type', entity_type).eq('entity_id', entity_id)
        .order('created_at', { ascending: true }).limit(50);
      if (error) return res.status(400).json({ error: error.message });
      return res.status(200).json({ comments: data || [] });
    }

    if (url === '/comments' && req.method === 'POST') {
      const auth = await authUser(req);
      if (!auth) return res.status(401).json({ error: 'Unauthorized' });
      const { entity_type = 'post', entity_id, content } = body;
      if (!content?.trim()) return res.status(400).json({ error: 'Comment cannot be empty' });

      const { data, error } = await sb().from('comments').insert({
        user_id: auth.user.id, entity_type, entity_id, content: content.trim(),
      }).select('*,profiles(username,display_name,avatar_url)').single();

      if (error) return res.status(400).json({ error: error.message });
      // Update comment count
      if (entity_type === 'post') await sb().from('posts')
        .update({ comment_count: sb().raw('comment_count + 1') }).eq('id', entity_id);
      return res.status(201).json({ comment: data });
    }

    /* ═══════════════════════════════════════════════════════
       FOLLOWS
       ═══════════════════════════════════════════════════════ */
    const followId = url.match(/^\/follow\/([^/]+)$/)?.[1];
    if (followId && req.method === 'POST') {
      const auth = await authUser(req);
      if (!auth) return res.status(401).json({ error: 'Unauthorized' });
      const uid = auth.user.id;
      if (uid === followId) return res.status(400).json({ error: 'Cannot follow yourself' });

      const { data: existing } = await sb().from('follows')
        .select('id').eq('follower_id', uid).eq('following_id', followId).single();

      if (existing) {
        await sb().from('follows').delete().eq('id', existing.id);
        return res.status(200).json({ following: false });
      } else {
        await sb().from('follows').insert({ follower_id: uid, following_id: followId });
        return res.status(200).json({ following: true });
      }
    }

    if (url === '/following' && req.method === 'GET') {
      const auth = await authUser(req);
      if (!auth) return res.status(401).json({ error: 'Unauthorized' });
      const { data, error } = await sb().from('follows')
        .select('following_id,profiles!follows_following_id_fkey(username,display_name,avatar_url,role)')
        .eq('follower_id', auth.user.id);
      if (error) return res.status(400).json({ error: error.message });
      return res.status(200).json({ following: (data || []).map(f => ({ id: f.following_id, ...f.profiles })) });
    }

    const followersUid = url.match(/^\/followers\/([^/]+)$/)?.[1];
    if (followersUid && req.method === 'GET') {
      const { data, count } = await sb().from('follows')
        .select('follower_id', { count: 'exact' }).eq('following_id', followersUid);
      return res.status(200).json({ count: count || 0, followers: (data || []).map(f => f.follower_id) });
    }

    /* ═══════════════════════════════════════════════════════
       ATTENDED EVENTS
       ═══════════════════════════════════════════════════════ */
    if (url === '/user/attended' && req.method === 'GET') {
      const auth = await authUser(req);
      if (!auth) return res.status(401).json({ error: 'Unauthorized' });
      const { data, error } = await sb().from('event_attendances')
        .select('attended_at,events(id,name,venue_city,date_local,image_url,genre)')
        .eq('user_id', auth.user.id)
        .order('attended_at', { ascending: false }).limit(50);
      if (error) return res.status(400).json({ error: error.message });
      return res.status(200).json({ attended: (data || []).map(r => ({ ...r.events, attended_at: r.attended_at })) });
    }

    /* ═══════════════════════════════════════════════════════
       SAVED ITEMS
       ═══════════════════════════════════════════════════════ */
    if (url === '/saved' && req.method === 'GET') {
      const auth = await authUser(req);
      if (!auth) return res.status(401).json({ error: 'Unauthorized' });
      const type = q.type || 'event';
      const { data } = await sb().from('saved_items')
        .select('item_id,item_type,created_at').eq('user_id', auth.user.id).eq('item_type', type);
      return res.status(200).json({ saved: data || [] });
    }

    if (url === '/saved' && req.method === 'POST') {
      const auth = await authUser(req);
      if (!auth) return res.status(401).json({ error: 'Unauthorized' });
      const { item_id, item_type = 'event' } = body;
      const uid = auth.user.id;
      const { data: existing } = await sb().from('saved_items')
        .select('id').eq('user_id', uid).eq('item_id', item_id).single();
      if (existing) {
        await sb().from('saved_items').delete().eq('id', existing.id);
        return res.status(200).json({ saved: false });
      } else {
        await sb().from('saved_items').insert({ user_id: uid, item_id, item_type });
        return res.status(200).json({ saved: true });
      }
    }

    /* ═══════════════════════════════════════════════════════
       BUSINESS — MENU
       ═══════════════════════════════════════════════════════ */
    const menuBizId = url.match(/^\/menu\/([^/]+)$/)?.[1];
    if (menuBizId && req.method === 'GET') {
      const { data, error } = await sb().from('menu_items')
        .select('*').eq('business_id', menuBizId).eq('is_available', true)
        .order('category').order('sort_order');
      if (error) return res.status(400).json({ error: error.message });
      return res.status(200).json({ menu: data || [] });
    }

    if (url === '/menu' && req.method === 'POST') {
      const auth = await authUser(req);
      if (!auth || !['business','organizer','admin'].includes(auth.profile?.role))
        return res.status(403).json({ error: 'Business account required' });
      const { business_id, name, description, price, category, image_url, is_available = true } = body;
      if (!business_id || !name || price === undefined)
        return res.status(400).json({ error: 'business_id, name and price required' });
      const { data, error } = await sb().from('menu_items').insert({
        business_id, name, description, price: parseFloat(price),
        category: category || 'General', image_url, is_available,
      }).select().single();
      if (error) return res.status(400).json({ error: error.message });
      return res.status(201).json({ item: data });
    }

    const menuItemId = url.match(/^\/menu\/item\/([^/]+)$/)?.[1];
    if (menuItemId && req.method === 'PUT') {
      const auth = await authUser(req);
      if (!auth || !['business','organizer','admin'].includes(auth.profile?.role))
        return res.status(403).json({ error: 'Business account required' });
      const { data, error } = await sb().from('menu_items')
        .update(body).eq('id', menuItemId).select().single();
      if (error) return res.status(400).json({ error: error.message });
      return res.status(200).json({ item: data });
    }

    if (menuItemId && req.method === 'DELETE') {
      const auth = await authUser(req);
      if (!auth || !['business','organizer','admin'].includes(auth.profile?.role))
        return res.status(403).json({ error: 'Business account required' });
      await sb().from('menu_items').delete().eq('id', menuItemId);
      return res.status(200).json({ success: true });
    }

    /* ═══════════════════════════════════════════════════════
       BUSINESS — ORDERS
       ═══════════════════════════════════════════════════════ */
    const ordersBizId = url.match(/^\/orders\/([^/]+)$/)?.[1];
    if (ordersBizId && req.method === 'GET') {
      const auth = await authUser(req);
      if (!auth || !['business','organizer','admin'].includes(auth.profile?.role))
        return res.status(403).json({ error: 'Business account required' });
      const status = q.status || null;
      let query = sb().from('pickup_orders').select('*')
        .eq('business_id', ordersBizId).order('created_at', { ascending: false }).limit(50);
      if (status) query = query.eq('status', status);
      const { data, error } = await query;
      if (error) return res.status(400).json({ error: error.message });
      return res.status(200).json({ orders: data || [] });
    }

    if (url === '/orders' && req.method === 'POST') {
      const { business_id, customer_name, customer_phone, items, notes, pickup_time } = body;
      if (!business_id || !customer_name || !items?.length)
        return res.status(400).json({ error: 'business_id, customer_name and items required' });
      const total = items.reduce((s, i) => s + (i.price * i.quantity), 0);
      const order_ref = `ORD-${Date.now()}-${Math.random().toString(36).slice(2,5).toUpperCase()}`;
      const { data, error } = await sb().from('pickup_orders').insert({
        order_ref, business_id, customer_name, customer_phone,
        items: JSON.stringify(items), notes, pickup_time, total, status: 'pending',
      }).select().single();
      if (error) return res.status(400).json({ error: error.message });
      return res.status(201).json({ order: data, order_ref });
    }

    const orderStatusId = url.match(/^\/orders\/([^/]+)\/status$/)?.[1];
    if (orderStatusId && req.method === 'PUT') {
      const auth = await authUser(req);
      if (!auth || !['business','organizer','admin'].includes(auth.profile?.role))
        return res.status(403).json({ error: 'Business account required' });
      const { status } = body;
      const valid = ['pending','confirmed','ready','completed','cancelled'];
      if (!valid.includes(status)) return res.status(400).json({ error: 'Invalid status' });
      const { data, error } = await sb().from('pickup_orders')
        .update({ status, updated_at: new Date().toISOString() }).eq('id', orderStatusId).select().single();
      if (error) return res.status(400).json({ error: error.message });
      return res.status(200).json({ order: data });
    }

    /* ═══════════════════════════════════════════════════════
       BUSINESS — HOURS
       ═══════════════════════════════════════════════════════ */
    const hoursBizId = url.match(/^\/hours\/([^/]+)$/)?.[1];
    if (hoursBizId && req.method === 'GET') {
      const { data } = await sb().from('business_hours').select('*').eq('business_id', hoursBizId).order('day_index');
      return res.status(200).json({ hours: data || [] });
    }

    if (url === '/hours' && req.method === 'PUT') {
      const auth = await authUser(req);
      if (!auth || !['business','organizer','admin'].includes(auth.profile?.role))
        return res.status(403).json({ error: 'Business account required' });
      const { business_id, hours } = body;
      if (!business_id || !Array.isArray(hours)) return res.status(400).json({ error: 'business_id and hours array required' });
      await sb().from('business_hours').delete().eq('business_id', business_id);
      const rows = hours.map((h, i) => ({ ...h, business_id, day_index: i }));
      const { data, error } = await sb().from('business_hours').insert(rows).select();
      if (error) return res.status(400).json({ error: error.message });
      return res.status(200).json({ hours: data });
    }

    /* ═══════════════════════════════════════════════════════
       NOTIFICATIONS
       ═══════════════════════════════════════════════════════ */
    if (url === '/notifications' && req.method === 'GET') {
      const auth = await authUser(req);
      if (!auth) return res.status(401).json({ error: 'Unauthorized' });
      const { data } = await sb().from('notifications').select('*')
        .eq('user_id', auth.user.id).order('created_at', { ascending: false }).limit(30);
      return res.status(200).json({ notifications: data || [] });
    }

    const notifReadId = url.match(/^\/notifications\/read\/([^/]+)$/)?.[1];
    if (notifReadId && req.method === 'POST') {
      const auth = await authUser(req);
      if (!auth) return res.status(401).json({ error: 'Unauthorized' });
      await sb().from('notifications').update({ read: true }).eq('id', notifReadId).eq('user_id', auth.user.id);
      return res.status(200).json({ success: true });
    }

    /* ═══════════════════════════════════════════════════════
       AUTH — profile upsert
       ═══════════════════════════════════════════════════════ */
    if (url === '/auth/profile' && req.method === 'POST') {
      const token = (req.headers.authorization || '').replace('Bearer ', '');
      if (!token) return res.status(401).json({ error: 'Unauthorized' });
      const { createClient: make } = require('@supabase/supabase-js');
      const userSb = make(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
      const { data: { user } } = await userSb.auth.getUser(token);
      if (!user) return res.status(401).json({ error: 'Unauthorized' });

      const meta = body.profile || {};
      const { data: existing } = await sb().from('profiles').select('*').eq('id', user.id).single();
      if (existing) {
        // Update any new fields
        const updates = {};
        if (meta.username)     updates.username     = meta.username;
        if (meta.display_name) updates.display_name = meta.display_name;
        if (meta.province)     updates.province     = meta.province;
        if (meta.city)         updates.city         = meta.city;
        if (meta.phone)        updates.phone        = meta.phone;
        if (meta.dob)          updates.dob          = meta.dob;
        if (meta.genres)       updates.genres       = meta.genres;
        if (meta.bio)          updates.bio          = meta.bio;
        if (meta.role)         updates.role         = meta.role;
        if (meta.avatar_url)   updates.avatar_url   = meta.avatar_url;
        if (Object.keys(updates).length) {
          await sb().from('profiles').update(updates).eq('id', user.id);
        }
        return res.status(200).json({ profile: { ...existing, ...updates } });
      }

      // Create new profile
      const { data: created, error } = await sb().from('profiles').insert({
        id:           user.id,
        username:     meta.username || `user_${user.id.slice(0, 8)}`,
        display_name: meta.display_name || user.user_metadata?.full_name || user.email?.split('@')[0] || 'Pulsify User',
        avatar_url:   meta.avatar_url || user.user_metadata?.avatar_url || null,
        email:        user.email,
        role:         meta.role || 'user',
        is_page:      meta.role === 'organizer' || meta.role === 'business',
        province:     meta.province || '',
        city:         meta.city || 'Durban',
        phone:        meta.phone || null,
        dob:          meta.dob || null,
        genres:       meta.genres || [],
        bio:          '',
      }).select().single();

      if (error) return res.status(400).json({ error: error.message });
      return res.status(201).json({ profile: created, created: true });
    }

    if (url === '/auth/profile' && req.method === 'GET') {
      const auth = await authUser(req);
      if (!auth) return res.status(401).json({ error: 'Unauthorized' });
      return res.status(200).json({ profile: auth.profile });
    }

    /* ═══════════════════════════════════════════════════════
       TICKETS
       ═══════════════════════════════════════════════════════ */
    if (url === '/ticket/purchase' && req.method === 'POST') {
      const { event_id, tier_id, quantity = 1, buyer_name, buyer_email, buyer_phone } = body;
      if (!event_id || !buyer_name || !buyer_email)
        return res.status(400).json({ error: 'event_id, buyer_name and buyer_email required' });

      const [{ data: ev }, { data: tier }] = await Promise.all([
        sb().from('events').select('name,commission_rate').eq('id', event_id).single(),
        tier_id ? sb().from('ticket_tiers').select('*').eq('id', tier_id).single() : { data: null },
      ]);
      if (!ev) return res.status(404).json({ error: 'Event not found' });

      const qty        = Math.max(1, parseInt(quantity));
      const unit_price = tier?.price || 0;
      const subtotal   = unit_price * qty;
      const commission = unit_price > 0 ? +(subtotal * 0.08).toFixed(2) : 0;
      const psf        = unit_price > 0 ? +(subtotal * 0.015 + 1.5).toFixed(2) : 0;
      const total_paid = +(subtotal + commission + psf).toFixed(2);
      const booking_ref = `PKF-${Date.now()}-${Math.random().toString(36).slice(2, 5).toUpperCase()}`;

      const { data: booking, error: bErr } = await sb().from('bookings').insert({
        booking_ref, event_id, tier_id: tier_id || null,
        buyer_name, buyer_email, buyer_phone: buyer_phone || null,
        quantity: qty, unit_price, commission, total_paid,
        status: unit_price === 0 ? 'confirmed' : 'pending',
        qr_data: `PULSIFY:${booking_ref}:${event_id}:VALID`,
      }).select().single();

      if (bErr) return res.status(400).json({ error: bErr.message });
      return res.status(200).json({
        success: true, booking_ref,
        total_kobo: Math.round(total_paid * 100), total_paid, buyer_email,
        is_free: unit_price === 0, qr_data: booking.qr_data, event_name: ev.name,
        metadata: { booking_id: booking.id, event_id, type: 'ticket' },
      });
    }

    if (url === '/user/bookings' && req.method === 'GET') {
      const auth = await authUser(req);
      if (!auth) return res.status(401).json({ error: 'Unauthorized' });
      const { data } = await sb().from('bookings')
        .select('*,events(name,date_local,time_local,venue_name,venue_city,image_url)')
        .eq('buyer_email', auth.user.email)
        .order('created_at', { ascending: false }).limit(20);
      return res.status(200).json({ bookings: data || [] });
    }

    const bookRef = url.match(/^\/booking\/([^/]+)$/)?.[1];
    if (bookRef && req.method === 'GET') {
      const { data } = await sb().from('bookings')
        .select('*,events(name,date_local,time_local,venue_name,venue_city)')
        .eq('booking_ref', bookRef).single();
      if (!data) return res.status(404).json({ error: 'Booking not found' });
      return res.status(200).json({ booking: data });
    }

    /* ═══════════════════════════════════════════════════════
       PAYSTACK WEBHOOK
       ═══════════════════════════════════════════════════════ */
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

    /* ═══════════════════════════════════════════════════════
       HEALTH
       ═══════════════════════════════════════════════════════ */
    if (url === '/health' && req.method === 'GET') {
      return res.status(200).json({ status: 'ok', version: '2.0', ts: new Date().toISOString() });
    }

    return res.status(404).json({ error: `Route not found: ${req.method} ${url}` });

  } catch (err) {
    console.error('[Pulsify API]', err.message);
    return res.status(500).json({ error: 'Server error', detail: err.message });
  }
};
