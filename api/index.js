const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');
const { sendWelcomeEmail, sendVerifApprovedEmail, sendVerifRejectedEmail, sendPaymentConfirmEmail, sendTicketEmail } = require('./email');
const { rateLimited, captureError, corsHeaders, signQr, verifyQr, validate } = require('./shared');

const SUPA_URL  = process.env.SUPABASE_URL  || 'https://cjzewfvtdayjgjdpdmln.supabase.co';
const SUPA_ANON = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNqemV3ZnZ0ZGF5amdqZHBkbWxuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU4NTg0MjYsImV4cCI6MjA5MTQzNDQyNn0.KQ80RmaB6cfA0dkcT-pdTe53fwyUrrIBeVJtToWF_Mk';
const SUPA_SVC  = process.env.SUPABASE_SERVICE_KEY || SUPA_ANON;

const sb = () => createClient(SUPA_URL, SUPA_SVC,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

// User-scoped client: passes the caller's JWT so auth.uid() works in RLS.
// Use this for INSERT/UPDATE/DELETE on tables where RLS depends on auth.uid().
// Falls back to service-role client if no token (and SVC key may also be missing).
const sbAs = (token) => {
  if (!token) return sb();
  return createClient(SUPA_URL, SUPA_ANON, {
    global: { headers: { Authorization: 'Bearer ' + token } },
    auth: { autoRefreshToken: false, persistSession: false }
  });
};

const tokenFrom = (req) => (req.headers.authorization || '').replace('Bearer ', '').trim();

const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY || '';
const PAYSTACK_BASE   = 'https://api.paystack.co';

// SA bank name → Paystack clearing code
const SA_BANK_CODES = {
  'Absa':          '632005',
  'Capitec':       '470010',
  'FNB':           '250655',
  'Nedbank':       '198765',
  'Standard Bank': '051001',
  'Investec':      '580105',
  'TymeBank':      '678910',
  'African Bank':  '430000',
};


async function paystackPost(path, body) {
  const https = require('https');
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const opts = {
      hostname: 'api.paystack.co',
      path,
      method: 'POST',
      headers: {
        Authorization: `Bearer ${PAYSTACK_SECRET}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    };
    const r = https.request(opts, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { resolve({}); } });
    });
    r.on('error', reject);
    r.write(payload);
    r.end();
  });
}

async function paystackGet(path) {
  const https = require('https');
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'api.paystack.co',
      path,
      method: 'GET',
      headers: { Authorization: `Bearer ${PAYSTACK_SECRET}` },
    };
    const r = https.request(opts, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { resolve({}); } });
    });
    r.on('error', reject);
    r.end();
  });
}

async function createPaystackSubaccount(businessName, bankName, accountNumber, email) {
  if (!PAYSTACK_SECRET || PAYSTACK_SECRET === '') return null;
  const bankCode = SA_BANK_CODES[bankName] || '';
  if (!bankCode || !accountNumber || !businessName) return null;
  try {
    const res = await paystackPost('/subaccount', {
      business_name: businessName,
      settlement_bank: bankCode,
      account_number: accountNumber,
      percentage_charge: 0,
      primary_contact_email: email,
    });
    return res?.data?.subaccount_code || null;
  } catch(e) {
    console.error('[paystack/subaccount]', e.message);
    return null;
  }
}

function haverBox(lat, lon, km) {
  const R = 111, d = km / R, dl = km / (R * Math.cos(lat * Math.PI / 180));
  return { minLat: lat - d, maxLat: lat + d, minLon: lon - dl, maxLon: lon + dl };
}

async function verifyToken(token) {
  if (!token) return null;
  try {
    const userSb = createClient(SUPA_URL, SUPA_ANON,
      { auth: { autoRefreshToken: false, persistSession: false } });
    const { data: { user } } = await userSb.auth.getUser(token);
    return user || null;
  } catch { return null; }
}

async function authUser(req) {
  const token = tokenFrom(req);
  if (!token) return null;
  try {
    const userSb = createClient(SUPA_URL, SUPA_ANON,
      { auth: { autoRefreshToken: false, persistSession: false } });
    const { data: { user }, error } = await userSb.auth.getUser(token);
    if (error || !user) return null;
    const { data: profile } = await sb().from('profiles').select('*').eq('id', user.id).single();
    if (profile?.suspended) return null;
    return { user, profile: profile || { id: user.id, role: 'user' } };
  } catch(e) {
    return null;
  }
}

async function logAdminAction(adminId, adminName, actionType, targetId, targetName, details) {
  try {
    await sb().from('admin_activity_log').insert({
      admin_id: adminId, admin_name: adminName || 'Admin',
      action_type: actionType, target_id: String(targetId || ''),
      target_name: targetName || null, details: details || null,
    });
  } catch(e) { /* non-fatal */ }
}

module.exports = async (req, res) => {
  Object.entries(corsHeaders(req)).forEach(([k, v]) => res.setHeader(k, v));
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (rateLimited(req, res, { limit: 100, windowMs: 60000 })) return;

  const url    = (req.url || '/').split('?')[0].replace(/^\/api/, '') || '/';
  const q      = Object.fromEntries(new URL(req.url, 'http://x').searchParams);
  const today  = new Date().toISOString().split('T')[0];

  try {

    /* ─── GET /events ─────────────────────────────────────── */
    if (url === '/events' && req.method === 'GET') {
      const page   = Math.max(1, parseInt(q.page  || '1'));
      const limit  = Math.min(50, parseInt(q.limit || '10'));
      const offset = (page - 1) * limit;
      const city     = q.city     || '';
      const province = q.province || '';
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

      if (city && city !== 'all')           query = query.ilike('venue_city', `%${city}%`);
      else if (province && province !== 'all') query = query.eq('venue_province', province);
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

      res.setHeader('Cache-Control', 'public, max-age=20, stale-while-revalidate=60');
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

    /* ─── GET /deals ──────────────────────────────────────── */
    if (url === '/deals' && req.method === 'GET') {
      const limit       = Math.min(20, parseInt(q.limit || '12'));
      const business_id = q.business_id || '';
      const event_id    = q.event_id    || '';
      const now         = new Date().toISOString();

      let query = sb().from('deals')
        .select(`id,title,description,type,discount_percent,price,
          valid_from,valid_until,is_featured,business_id,event_id,
          businesses(id,name,suburb,city,lat,lon,cover_image_url,category)`)
        .eq('is_active', true)
        .or(`valid_until.is.null,valid_until.gte.${now}`)
        .order('is_featured', { ascending: false })
        .order('discount_percent', { ascending: false, nullsFirst: false })
        .limit(limit);

      if (business_id) query = query.eq('business_id', business_id);
      if (event_id)    query = query.eq('event_id', event_id);

      const { data, error } = await query;
      if (error) return res.status(400).json({ error: error.message });
      return res.status(200).json({ deals: data || [] });
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
      const token = tokenFrom(req);
      const user  = await verifyToken(token);
      if (!user) return res.status(401).json({ error: 'Unauthorized' });

      const { caption, image_url, event_id, event_name, post_type } = req.body || {};
      if (!caption && !image_url) return res.status(400).json({ error: 'caption or image_url required' });

      // Monthly post limit: free organizers/businesses get 5 posts/month during beta
      const { data: poster } = await sb().from('profiles').select('role,subscription_type').eq('id', user.id).single();
      if (poster?.subscription_type === 'free' && ['organizer', 'business'].includes(poster?.role)) {
        const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0,0,0,0);
        const { count } = await sb().from('posts').select('id', { count: 'exact', head: true })
          .eq('user_id', user.id).gte('created_at', monthStart.toISOString());
        if (count >= 5) return res.status(403).json({ error: 'POST_LIMIT_REACHED', limit: 5, used: count, message: "You've used all 5 free posts this month. Upgrade to Premium for unlimited posts." });
      }

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

    /* ─── PATCH /posts/:id (edit own post) ────────────────── */
    const editPostId = url.match(/^\/posts\/([^/]+)$/)?.[1];
    if (editPostId && req.method === 'PATCH') {
      const token = tokenFrom(req);
      const user  = await verifyToken(token);
      if (!user) return res.status(401).json({ error: 'Unauthorized' });

      // Ownership check — only the author can edit
      const { data: existing } = await sb().from('posts').select('user_id').eq('id', editPostId).single();
      if (!existing) return res.status(404).json({ error: 'Post not found' });
      if (existing.user_id !== user.id) return res.status(403).json({ error: 'Not your post' });

      const { caption, image_url, event_name } = req.body || {};
      const patch = {};
      if (caption !== undefined)    patch.caption    = caption || null;
      if (image_url !== undefined)  patch.image_url  = image_url || null;
      if (event_name !== undefined) patch.event_name = event_name || null;
      if (!Object.keys(patch).length) return res.status(400).json({ error: 'Nothing to update' });

      const { data: post, error } = await sb().from('posts').update(patch).eq('id', editPostId).select().single();
      if (error) return res.status(400).json({ error: error.message });
      return res.status(200).json({ post, success: true });
    }

    /* ─── DELETE /posts/:id (delete own post) ─────────────── */
    if (editPostId && req.method === 'DELETE') {
      const token = tokenFrom(req);
      const user  = await verifyToken(token);
      if (!user) return res.status(401).json({ error: 'Unauthorized' });

      const { data: existing } = await sb().from('posts').select('user_id').eq('id', editPostId).single();
      if (!existing) return res.status(404).json({ error: 'Post not found' });
      if (existing.user_id !== user.id) return res.status(403).json({ error: 'Not your post' });

      const { error } = await sb().from('posts').delete().eq('id', editPostId);
      if (error) return res.status(400).json({ error: error.message });
      return res.status(200).json({ success: true });
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
        sb().from('profiles').select('id,username,display_name,bio,avatar_url,cover_url,social_links,city,province,role,is_verified,genres').eq('id', profId).single(),
        sb().from('posts').select('id', { count: 'exact', head: true }).eq('user_id', profId).eq('visibility', 'public'),
        sb().from('follows').select('follower_id', { count: 'exact', head: true }).eq('following_id', profId),
        sb().from('follows').select('following_id', { count: 'exact', head: true }).eq('follower_id', profId),
        sb().from('posts').select('id,caption,image_url,post_type,like_count,comment_count,created_at').eq('user_id', profId).eq('visibility', 'public').order('created_at', { ascending: false }).limit(6),
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

    /* ─── GET /profiles/:id/followers ──────────────────────── */
    const followersMatch = url.match(/^\/profiles\/([^/]+)\/followers$/);
    if (followersMatch && req.method === 'GET') {
      const targetId = followersMatch[1];
      const { data, error } = await sb()
        .from('follows')
        .select('follower_id, created_at, profiles:follower_id(id, display_name, username, avatar_url, is_verified, role, city)')
        .eq('following_id', targetId)
        .order('created_at', { ascending: false })
        .limit(200);
      if (error) return res.status(400).json({ error: error.message });
      const users = (data || []).map(r => r.profiles).filter(Boolean);
      return res.status(200).json({ users });
    }

    /* ─── GET /profiles/:id/following ──────────────────────── */
    const followingMatch = url.match(/^\/profiles\/([^/]+)\/following$/);
    if (followingMatch && req.method === 'GET') {
      const sourceId = followingMatch[1];
      const { data, error } = await sb()
        .from('follows')
        .select('following_id, created_at, profiles:following_id(id, display_name, username, avatar_url, is_verified, role, city)')
        .eq('follower_id', sourceId)
        .order('created_at', { ascending: false })
        .limit(200);
      if (error) return res.status(400).json({ error: error.message });
      const users = (data || []).map(r => r.profiles).filter(Boolean);
      return res.status(200).json({ users });
    }

    /* ─── GET /suggestions ─────────────────────────────────── */
    if (url === '/suggestions' && req.method === 'GET') {
      const auth = await authUser(req);
      if (!auth) return res.status(401).json({ error: 'Unauthorized' });
      const limit = Math.min(50, parseInt(q.limit || '20'));
      const { data, error } = await sb().rpc('get_friend_suggestions', { p_user_id: auth.user.id, p_limit: limit });
      if (error) return res.status(400).json({ error: error.message });
      return res.status(200).json({ suggestions: data || [] });
    }

    /* ─── POST /ticket/purchase ───────────────────────────── */
    if (url === '/ticket/purchase' && req.method === 'POST') {
      const v = validate(req, res, {
        event_id:    { required: true, maxLen: 64 },
        tier_id:     { maxLen: 64 },
        quantity:    { type: 'int', min: 1, max: 10, default: 1 },
        buyer_name:  { required: true, maxLen: 120 },
        buyer_email: { type: 'email', required: true },
        buyer_phone: { maxLen: 32 },
        user_id:     { maxLen: 64 },
      });
      if (!v) return;
      const { event_id, tier_id, buyer_name, buyer_email, buyer_phone } = v;

      const [{ data: ev }, { data: tier }] = await Promise.all([
        sb().from('events').select('name,date_local,venue_name,venue_city,commission_rate').eq('id', event_id).single(),
        tier_id ? sb().from('ticket_tiers').select('*').eq('id', tier_id).single() : { data: null },
      ]);

      if (!ev) return res.status(404).json({ error: 'Event not found' });

      const qty         = v.quantity;
      const unit_price  = tier?.price || 0;
      const subtotal    = unit_price * qty;
      const commission  = unit_price > 0 ? +(subtotal * 0.08).toFixed(2) : 0;
      const psf         = unit_price > 0 ? +(subtotal * 0.015 + 1.5).toFixed(2) : 0;
      const total_paid  = +(subtotal + commission + psf).toFixed(2);
      const booking_ref = `PKF-${Date.now()}-${Math.random().toString(36).slice(2, 5).toUpperCase()}`;

      const qr_sig    = signQr(booking_ref, event_id);
      const qr_data   = `PULSIFY:${booking_ref}:${event_id}:${qr_sig}`;
      const { data: booking, error: bErr } = await sb().from('bookings').insert({
        booking_ref, event_id,
        tier_id:     tier_id || null,
        buyer_name,  buyer_email,
        buyer_phone: buyer_phone || null,
        quantity:    qty, unit_price, commission, total_paid,
        status:      'confirmed',
        qr_data,
        qr_token:    qr_sig,
        user_id:     v.user_id || null,
      }).select().single();

      if (bErr) return res.status(400).json({ error: bErr.message });

      // Send ticket email (non-blocking)
      sendTicketEmail(buyer_email, buyer_name, ev.name, ev.date_local, ev.venue_name, ev.venue_city, booking_ref, tier?.name || null, qty, total_paid, unit_price === 0, qr_data)
        .catch(e => console.error('[email/ticket]', e.message));

      // Notify the buyer if they're a registered user
      const user_id = v.user_id;
      if (user_id) {
        await sb().from('notifications').insert({
          user_id, type: 'ticket',
          from_display_name: 'Pulsefy',
          entity_id: event_id, entity_type: 'events',
          message: `Your ticket for ${ev.name} is confirmed! Ref: ${booking_ref}${unit_price > 0 ? ` · R${total_paid.toFixed(2)}` : ' · FREE'}`,
          data: { booking_ref, tier_name: tier?.name || null },
        }).catch(() => {});
      }

      return res.status(200).json({
        success:     true,
        booking_ref,
        total_paid,
        buyer_email,
        buyer_name,
        is_free:     unit_price === 0,
        qr_data,
        event_name:  ev.name,
        event_date:  ev.date_local,
        venue_name:  ev.venue_name,
        venue_city:  ev.venue_city,
        tier_name:   tier?.name || null,
        quantity:    qty,
      });
    }

    /* ─── POST /ticket/init ───────────────────────────────── */
    // For paid tickets: creates pending booking + initialises Paystack transaction with split
    if (url === '/ticket/init' && req.method === 'POST') {
      const v = validate(req, res, {
        event_id:    { required: true, maxLen: 64 },
        tier_id:     { maxLen: 64 },
        quantity:    { type: 'int', min: 1, max: 10, default: 1 },
        buyer_name:  { required: true, maxLen: 120 },
        buyer_email: { type: 'email', required: true },
        buyer_phone: { maxLen: 32 },
        user_id:     { maxLen: 64 },
      });
      if (!v) return;
      const { event_id, tier_id, buyer_name, buyer_email, buyer_phone, user_id: uid } = v;

      const [{ data: ev }, { data: tier }] = await Promise.all([
        sb().from('events').select('id,name,date_local,time_local,venue_name,venue_city,organiser_id').eq('id', event_id).single(),
        tier_id ? sb().from('ticket_tiers').select('*').eq('id', tier_id).single() : { data: null },
      ]);

      if (!ev) return res.status(404).json({ error: 'Event not found' });

      const qty        = v.quantity;
      const unit_price = tier?.price || 0;
      const subtotal   = unit_price * qty;
      const commission = unit_price > 0 ? +(subtotal * 0.08).toFixed(2) : 0;
      const psf        = unit_price > 0 ? +(subtotal * 0.015 + 1.5).toFixed(2) : 0;
      const total_paid = +(subtotal + commission + psf).toFixed(2);

      if (unit_price === 0) return res.status(400).json({ error: 'Use /ticket/purchase for free tickets' });

      const booking_ref = `PKF-${Date.now()}-${Math.random().toString(36).slice(2, 5).toUpperCase()}`;
      const qr_sig      = signQr(booking_ref, event_id);
      const qr_data     = `PULSIFY:${booking_ref}:${event_id}:${qr_sig}`;

      const { data: booking, error: bErr } = await sb().from('bookings').insert({
        booking_ref, event_id,
        tier_id:     tier_id || null,
        buyer_name,  buyer_email,
        buyer_phone: buyer_phone || null,
        quantity:    qty, unit_price, commission, total_paid,
        status:      'pending',
        qr_data,
        qr_token:    qr_sig,
        user_id:     uid || null,
      }).select().single();

      if (bErr) return res.status(400).json({ error: bErr.message });

      // Build Paystack transaction with optional split
      const amountKobo = Math.round(total_paid * 100);
      const txBody = {
        email:     buyer_email,
        amount:    amountKobo,
        currency:  'ZAR',
        reference: booking_ref,
        metadata:  { booking_id: booking.id, booking_ref, event_id, user_id: uid || null, buyer_name, type: 'ticket' },
        callback_url: `${process.env.APP_URL || 'https://pulsefy.co.za'}/tickets`,
      };

      // Add split if organizer has a subaccount
      if (ev.organiser_id) {
        const { data: orgProfile } = await sb().from('profiles').select('paystack_subaccount_code').eq('id', ev.organiser_id).single();
        if (orgProfile?.paystack_subaccount_code) {
          txBody.split = {
            type: 'percentage',
            bearer_type: 'account',
            subaccounts: [{ subaccount: orgProfile.paystack_subaccount_code, share: 92 }],
          };
        }
      }

      let paystack_ref = booking_ref;
      if (PAYSTACK_SECRET) {
        try {
          const txRes = await paystackPost('/transaction/initialize', txBody);
          if (txRes?.data?.reference) paystack_ref = txRes.data.reference;
        } catch(e) { console.error('[paystack/init]', e.message); }
      }

      return res.status(200).json({
        booking_ref,
        booking_id: booking.id,
        paystack_ref,
        amount_kobo: amountKobo,
        total_paid,
        is_free: false,
        event_name: ev.name,
        tier_name: tier?.name || null,
        quantity: qty,
      });
    }

    /* ─── GET /ticket/confirm ─────────────────────────────── */
    // Called by frontend after Paystack popup success callback.
    // Server-side verification: the client is NEVER trusted to declare a
    // payment good — we re-verify with Paystack and confirm the amount paid
    // matches the booking total before flipping status to 'confirmed'.
    if (url === '/ticket/confirm' && req.method === 'GET') {
      const ref = q.ref || q.reference;
      if (!ref) return res.status(400).json({ error: 'ref required' });

      // Load the booking first — we need its expected amount to verify against.
      const { data: booking, error: bErr } = await sb().from('bookings')
        .select('*,events(name,date_local,venue_name,venue_city),ticket_tiers(name)')
        .eq('booking_ref', ref).single();
      if (bErr || !booking) return res.status(404).json({ error: 'Booking not found' });

      // Idempotent: already confirmed → return it without re-charging logic.
      if (booking.status === 'confirmed')
        return res.status(200).json({ success: true, booking_ref: booking.booking_ref, qr_data: booking.qr_data, event_name: booking.events?.name, tier_name: booking.ticket_tiers?.name, quantity: booking.quantity, total_paid: booking.total_paid, buyer_name: booking.buyer_name, buyer_email: booking.buyer_email });
      if (booking.status !== 'pending')
        return res.status(400).json({ error: 'Booking is not payable' });

      // Re-verify with Paystack (source of truth). No secret → payments off.
      if (!PAYSTACK_SECRET) return res.status(503).json({ error: 'Payments not enabled' });
      let pd = null;
      try {
        const vr = await paystackGet(`/transaction/verify/${encodeURIComponent(ref)}`);
        pd = vr?.data || null;
      } catch(e) { console.error('[paystack/verify]', e.message); }
      if (!pd || pd.status !== 'success') return res.status(400).json({ error: 'Payment not verified' });

      // Amount + currency must match what we asked for. Guards against a
      // tampered client paying less than the ticket price.
      const expectedKobo = Math.round((booking.total_paid || 0) * 100);
      if (pd.currency !== 'ZAR' || (pd.amount || 0) < expectedKobo) {
        console.error('[paystack/verify] amount mismatch', ref, pd.amount, expectedKobo, pd.currency);
        return res.status(400).json({ error: 'Payment amount mismatch' });
      }

      // Confirm the booking (idempotent guard on status).
      const { data: confirmed } = await sb().from('bookings')
        .update({ status: 'confirmed', paystack_ref: pd.reference || ref })
        .eq('booking_ref', ref).eq('status', 'pending')
        .select('*,events(name,date_local,venue_name,venue_city),ticket_tiers(name)')
        .single();
      // Lost the idempotency race (webhook confirmed first) → return current state.
      if (!confirmed) {
        const { data: now } = await sb().from('bookings')
          .select('*,events(name,date_local,venue_name,venue_city),ticket_tiers(name)')
          .eq('booking_ref', ref).single();
        if (now) return res.status(200).json({ success: true, booking_ref: now.booking_ref, qr_data: now.qr_data, event_name: now.events?.name, tier_name: now.ticket_tiers?.name, quantity: now.quantity, total_paid: now.total_paid, buyer_name: now.buyer_name, buyer_email: now.buyer_email });
        return res.status(404).json({ error: 'Booking not found' });
      }

      // Send ticket email
      sendTicketEmail(confirmed.buyer_email, confirmed.buyer_name, confirmed.events?.name, confirmed.events?.date_local, confirmed.events?.venue_name, confirmed.events?.venue_city, confirmed.booking_ref, confirmed.ticket_tiers?.name, confirmed.quantity, confirmed.total_paid, confirmed.unit_price === 0, confirmed.qr_data)
        .catch(e => console.error('[email/ticket]', e.message));

      if (confirmed.user_id) {
        await sb().from('notifications').insert({
          user_id: confirmed.user_id, type: 'ticket',
          from_display_name: 'Pulsefy',
          entity_id: confirmed.event_id, entity_type: 'events',
          message: `Your ticket for ${confirmed.events?.name} is confirmed! Ref: ${confirmed.booking_ref} · R${confirmed.total_paid}`,
          data: { booking_ref: confirmed.booking_ref },
        }).catch(() => {});
      }

      return res.status(200).json({
        success:     true,
        booking_ref: confirmed.booking_ref,
        qr_data:     confirmed.qr_data,
        event_name:  confirmed.events?.name,
        tier_name:   confirmed.ticket_tiers?.name,
        quantity:    confirmed.quantity,
        total_paid:  confirmed.total_paid,
        buyer_name:  confirmed.buyer_name,
        buyer_email: confirmed.buyer_email,
      });
    }

    /* ─── GET /user/bookings ──────────────────────────────── */
    if (url === '/user/bookings' && req.method === 'GET') {
      const token = tokenFrom(req);
      const user  = await verifyToken(token);
      if (!user) return res.status(401).json({ error: 'Unauthorized' });
      const { data, error } = await sb().from('bookings')
        .select('id,booking_ref,event_id,tier_id,quantity,unit_price,total_paid,status,qr_data,checked_in,checked_in_at,created_at,events(name,date_local,time_local,venue_name,venue_city,image_url),ticket_tiers(name,price)')
        .eq('user_id', user.id).eq('status', 'confirmed')
        .order('created_at', { ascending: false }).limit(50);
      if (error) return res.status(400).json({ error: error.message });
      return res.status(200).json({ bookings: data || [] });
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

    /* ─── POST /validate-ticket ──────────────────────────── */
    if (url === '/validate-ticket' && req.method === 'POST') {
      const auth = await authUser(req);
      if (!auth) return res.status(401).json({ error: 'Unauthorized' });
      const { user, profile } = auth;

      const { qr_data } = req.body || {};
      if (!qr_data) return res.status(400).json({ error: 'qr_data required' });

      const parts = String(qr_data).split(':');
      if (parts.length < 4 || parts[0] !== 'PULSIFY')
        return res.status(400).json({ error: 'Invalid QR code' });

      const booking_ref = parts[1];
      const event_id    = parts[2];
      const qr_sig      = parts[3];

      // Require a valid HMAC signature — the legacy literal "VALID"
      // sentinel is no longer accepted (it let anyone forge a QR).
      if (!verifyQr(booking_ref, event_id, qr_sig))
        return res.status(400).json({ error: 'QR signature invalid' });

      const { data: booking } = await sb().from('bookings')
        .select('*,events(name,date_local,venue_name,organiser_id),ticket_tiers(name)')
        .eq('booking_ref', booking_ref).maybeSingle();

      if (!booking)                         return res.status(404).json({ error: 'Ticket not found' });
      if (booking.status !== 'confirmed')   return res.status(400).json({ error: 'Ticket is not confirmed' });
      if (booking.event_id !== event_id)    return res.status(400).json({ error: 'QR data mismatch' });
      if (profile.role === 'organizer' && booking.events?.organiser_id !== user.id)
        return res.status(403).json({ error: "This ticket is for a different organizer's event" });

      if (booking.checked_in)
        return res.status(409).json({
          error: 'Already checked in',
          checked_in_at: booking.checked_in_at,
          booking: { buyer_name: booking.buyer_name, booking_ref: booking.booking_ref },
        });

      const { error: checkinErr } = await sb().from('bookings')
        .update({ checked_in: true, checked_in_at: new Date().toISOString() })
        .eq('id', booking.id).eq('checked_in', false);
      if (checkinErr) {
        console.error('[validate-ticket] check-in write failed:', checkinErr.message);
        return res.status(500).json({ error: 'Check-in failed — please rescan.' });
      }

      return res.status(200).json({
        success:     true,
        booking_ref: booking.booking_ref,
        buyer_name:  booking.buyer_name,
        buyer_email: booking.buyer_email,
        quantity:    booking.quantity,
        tier_name:   booking.ticket_tiers?.name  || null,
        event_name:  booking.events?.name        || null,
        event_date:  booking.events?.date_local  || null,
      });
    }

    /* /paystack/webhook lives in api/payments/index.js (see vercel.json
       rewrite: /api/paystack/* → /api/payments). Don't re-add it here. */

    /* ─── POST /auth/profile ──────────────────────────────── */
    if (url === '/auth/profile' && req.method === 'POST') {
      const token = tokenFrom(req);
      if (!token) return res.status(401).json({ error: 'Unauthorized' });

      const userSb = createClient(SUPA_URL, SUPA_ANON);
      const { data: { user } } = await userSb.auth.getUser(token);
      if (!user) return res.status(401).json({ error: 'Unauthorized' });

      const { data: existing } = await sb().from('profiles').select('*').eq('id', user.id).single();
      if (existing) return res.status(200).json({ profile: existing });

      const b = req.body || {};
      const displayName = (b.display_name || user.user_metadata?.full_name || user.email?.split('@')[0] || 'Pulsefy User').slice(0, 80);
      const rawUsername = b.username || user.user_metadata?.username || '';
      const username = rawUsername.replace(/[^a-zA-Z0-9_]/g, '').slice(0, 20) || `user_${user.id.slice(0, 8)}`;
      const role = ['user', 'organizer', 'business'].includes(b.role) ? b.role : 'user';
      const genres = Array.isArray(b.genres) ? b.genres.slice(0, 10) : [];

      const { data: created } = await sb().from('profiles').insert({
        id:           user.id,
        email:        user.email,
        username,
        display_name: displayName,
        role,
        genres:       genres.length ? genres : null,
        avatar_url:   b.avatar_url || user.user_metadata?.avatar_url || null,
        bio:          b.bio ? String(b.bio).slice(0, 300) : null,
        dob:          b.dob || null,
        phone:        b.phone ? String(b.phone).slice(0, 20) : null,
        province:     b.province || null,
        city:         b.city || null,
        paystack_bank_name:     b.bank_name || null,
        paystack_account_number: b.account_number ? String(b.account_number) : null,
        paystack_business_name: b.business_name || displayName,
      }).select().single();

      // Auto-create Paystack subaccount for organizer/business
      if (['organizer','business'].includes(role) && b.bank_name && b.account_number) {
        const subCode = await createPaystackSubaccount(
          b.business_name || displayName, b.bank_name, String(b.account_number), user.email
        );
        if (subCode) {
          await sb().from('profiles').update({ paystack_subaccount_code: subCode }).eq('id', user.id);
          if (created) created.paystack_subaccount_code = subCode;
        }
      }

      // Non-blocking welcome email
      sendWelcomeEmail(user.email, displayName).catch(e => console.error('[email/welcome]', e.message));

      return res.status(200).json({ profile: created, created: true });
    }

    /* ─── PATCH /auth/profile ─────────────────────────────── */
    if (url === '/auth/profile' && req.method === 'PATCH') {
      const token = tokenFrom(req);
      if (!token) return res.status(401).json({ error: 'Unauthorized' });

      const userSb = createClient(SUPA_URL, SUPA_ANON);
      const { data: { user } } = await userSb.auth.getUser(token);
      if (!user) return res.status(401).json({ error: 'Unauthorized' });

      const b = req.body || {};
      const updates = {};
      if (b.display_name)    updates.display_name            = b.display_name;
      if (b.username)        updates.username                = b.username;
      if (b.bio)             updates.bio                     = b.bio;
      if (b.city)            updates.city                    = b.city;
      if (b.province)        updates.province                = b.province;
      if (b.avatar_url)      updates.avatar_url              = b.avatar_url;
      if (b.genres)          updates.genres                  = b.genres;
      if (b.role)            updates.role                    = b.role;
      if (b.bank_name)       updates.paystack_bank_name      = b.bank_name;
      if (b.account_number)  updates.paystack_account_number = String(b.account_number);
      if (b.business_name)   updates.paystack_business_name  = b.business_name;

      if (!Object.keys(updates).length) return res.status(400).json({ error: 'No fields to update' });

      const { data: updated, error: upErr } = await sb().from('profiles').update(updates).eq('id', user.id).select().single();
      if (upErr) return res.status(500).json({ error: upErr.message });

      // Auto-create or refresh Paystack subaccount
      let subCode = updated?.paystack_subaccount_code || null;
      if (!subCode && b.bank_name && b.account_number) {
        const { data: prof } = await sb().from('profiles').select('role,display_name,email').eq('id', user.id).single();
        if (['organizer','business'].includes(prof?.role)) {
          subCode = await createPaystackSubaccount(
            b.business_name || prof.display_name, b.bank_name, String(b.account_number), user.email || prof.email
          );
          if (subCode) await sb().from('profiles').update({ paystack_subaccount_code: subCode }).eq('id', user.id);
        }
      }

      return res.status(200).json({ ok: true, paystack_subaccount_code: subCode || null });
    }

    /* ─── POST /auth/register-business ───────────────────── */
    if (url === '/auth/register-business' && req.method === 'POST') {
      const b = req.body || {};
      const email    = (b.email || '').trim().toLowerCase();
      const password = b.password || '';
      const name     = (b.business_name || b.display_name || b.name || '').trim();
      const role     = b.role === 'organizer' ? 'organizer' : 'business';

      if (!email || !password || !name)
        return res.status(400).json({ error: 'email, password and business_name are required' });

      // Block obvious duplicates: same business name in the same city, or same phone number already on file
      const dupCity = (b.city || '').trim();
      if (role === 'business') {
        let dupQuery = sb().from('businesses').select('id').ilike('name', name);
        if (dupCity) dupQuery = dupQuery.ilike('city', dupCity);
        const { data: dupByName } = await dupQuery.limit(1);
        if (dupByName?.length) return res.status(409).json({ error: 'A business with this name already exists in this city. Contact support if this is your business.' });

        if (b.phone) {
          const { data: dupByPhone } = await sb().from('businesses').select('id').eq('phone', b.phone).limit(1);
          if (dupByPhone?.length) return res.status(409).json({ error: 'A business is already registered with this phone number.' });
        }
      }

      // Create auth user via admin API
      const adminSb = createClient(SUPA_URL, SUPA_SVC);
      const { data: newUser, error: signUpErr } = await adminSb.auth.admin.createUser({
        email, password, email_confirm: true,
        user_metadata: { full_name: name, role }
      });
      if (signUpErr) {
        if ((signUpErr.message || '').toLowerCase().includes('already registered'))
          return res.status(409).json({ error: 'An account with that email already exists.' });
        return res.status(400).json({ error: signUpErr.message });
      }
      const uid = newUser.user.id;

      // Upsert profile
      const username = (b.username || name).replace(/[^a-zA-Z0-9_]/g,'').slice(0,30) || `biz_${uid.slice(0,8)}`;
      await sb().from('profiles').upsert({
        id: uid, email, username,
        display_name: name,
        role,
        city:     b.city     || null,
        province: b.province || null,
        bio:      b.bio      ? String(b.bio).slice(0,300) : null,
        paystack_bank_name:      b.bank_name      || null,
        paystack_account_number: b.account_number ? String(b.account_number) : null,
        paystack_business_name:  name,
      });

      // Insert into businesses table. Column names must match the live
      // schema (email/phone, not contact_email/contact_phone) and category
      // is NOT NULL — a missing one breaks the row, so default it.
      if (role === 'business') {
        const { error: bizErr } = await sb().from('businesses').insert({
          owner_id:  uid,
          name,
          category:  b.category || b.type || 'other',
          city:      b.city     || null,
          province:  b.province || null,
          suburb:    b.suburb   || null,
          address:   b.address  || null,
          email,
          phone:     b.phone    || null,
          is_verified: false,
        });
        if (bizErr) console.error('[register-business] biz insert failed:', bizErr.message);
      }

      // Auto-create Paystack subaccount if bank details provided
      let subCode = null;
      if (b.bank_name && b.account_number) {
        subCode = await createPaystackSubaccount(name, b.bank_name, String(b.account_number), email);
        if (subCode) await sb().from('profiles').update({ paystack_subaccount_code: subCode }).eq('id', uid);
      }

      sendWelcomeEmail(email, name).catch(() => {});
      return res.status(200).json({ ok: true, user_id: uid, paystack_subaccount_code: subCode });
    }

    /* ─── POST /events/:id/request-map ──────────────────── */
    const reqMapMatch = url.match(/^\/events\/([^/]+)\/request-map$/);
    if (reqMapMatch && req.method === 'POST') {
      const token = tokenFrom(req);
      const user  = await verifyToken(token);
      if (!user) return res.status(401).json({ error: 'Unauthorized' });

      const eventId = reqMapMatch[1];
      const { data: ev } = await sb().from('events').select('id,name,venue_city,organiser_id').eq('id', eventId).single();
      if (!ev || ev.organiser_id !== user.id) return res.status(403).json({ error: 'Forbidden' });

      const { data: admins } = await sb().from('profiles').select('id').eq('role', 'admin');
      if (admins?.length) {
        await sb().from('notifications').insert(admins.map(a => ({
          user_id: a.id,
          type: 'map_request',
          title: '📍 Map Pin Request',
          body: `${ev.name}${ev.venue_city ? ' in ' + ev.venue_city : ''} is requesting a map pin.`,
          message: `${ev.name}${ev.venue_city ? ' in ' + ev.venue_city : ''} is requesting a map pin.`,
          data: { event_id: eventId, url: '/admin' },
          from_display_name: 'Business Request',
        })));
      }
      return res.status(200).json({ ok: true });
    }

    /* ─── GET /health ─────────────────────────────────────── */
    if (url === '/health' && req.method === 'GET') {
      return res.status(200).json({ status: 'ok', ts: new Date().toISOString() });
    }

    /* ─── GET /notifications ──────────────────────────────── */
    if (url === '/notifications' && req.method === 'GET') {
      const token = tokenFrom(req);
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
      const token = tokenFrom(req);
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
      const token = tokenFrom(req);
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
      const token = tokenFrom(req);
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
      const token = tokenFrom(req);
      const user  = await verifyToken(token);
      if (!user) return res.status(401).json({ error: 'Unauthorized' });

      const { entity_type, entity_id, type = 'like' } = req.body || {};
      if (!entity_type || !entity_id) return res.status(400).json({ error: 'entity_type and entity_id required' });

      const userClient = sbAs(token);

      const { data: existing } = await userClient.from('reactions')
        .select('user_id').eq('user_id', user.id).eq('entity_id', entity_id).eq('type', type).maybeSingle();

      if (existing) {
        await userClient.from('reactions').delete().eq('user_id', user.id).eq('entity_id', entity_id).eq('type', type);
        // DB trigger handles count decrement — just notify caller
        return res.status(200).json({ liked: false });
      }

      const { error: insErr } = await userClient.from('reactions').insert({ user_id: user.id, entity_type, entity_id, type });
      if (insErr) return res.status(400).json({ error: insErr.message });

      // DB trigger handles count increment; fire notification for posts/events
      if (entity_type === 'post') {
        const { data: p } = await sb().from('posts').select('user_id').eq('id', entity_id).single();
        if (p && p.user_id !== user.id) {
          const { data: prof } = await sb().from('profiles').select('display_name').eq('id', user.id).single();
          const name = prof?.display_name || 'Someone';
          await sb().from('notifications').insert({
            user_id: p.user_id, type: 'like', from_user_id: user.id,
            from_display_name: name, entity_id, entity_type: 'post',
            message: `${name} liked your post`,
          }).catch(() => {});
        }
      }

      return res.status(200).json({ liked: true });
    }

    /* ─── DELETE /reactions ──────────────────────────────── */
    if (url === '/reactions' && req.method === 'DELETE') {
      const token = tokenFrom(req);
      const user  = await verifyToken(token);
      if (!user) return res.status(401).json({ error: 'Unauthorized' });

      const { entity_id, type = 'like' } = req.body || {};
      if (!entity_id) return res.status(400).json({ error: 'entity_id required' });

      const userClient = sbAs(token);

      const { data: existing } = await userClient.from('reactions')
        .select('user_id').eq('user_id', user.id).eq('entity_id', entity_id).eq('type', type).maybeSingle();

      if (!existing) return res.status(200).json({ liked: false });

      await userClient.from('reactions').delete().eq('user_id', user.id).eq('entity_id', entity_id).eq('type', type);
      // DB trigger handles count decrement automatically
      return res.status(200).json({ liked: false });
    }

    /* ─── POST /follows ──────────────────────────────────── */
    if (url === '/follows' && req.method === 'POST') {
      const token = tokenFrom(req);
      const user  = await verifyToken(token);
      if (!user) return res.status(401).json({ error: 'Unauthorized' });

      const { following_id } = req.body || {};
      if (!following_id) return res.status(400).json({ error: 'following_id required' });
      if (following_id === user.id) return res.status(400).json({ error: 'Cannot follow yourself' });

      const { error } = await sbAs(token).from('follows').insert({ follower_id: user.id, following_id });
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
      const token = tokenFrom(req);
      const user  = await verifyToken(token);
      if (!user) return res.status(401).json({ error: 'Unauthorized' });

      const { following_id } = req.body || {};
      if (!following_id) return res.status(400).json({ error: 'following_id required' });

      await sb().from('follows').delete()
        .eq('follower_id', user.id).eq('following_id', following_id);

      return res.status(200).json({ following: false });
    }

    /* ─── GET /comments ──────────────────────────────────── */
    // Returns threaded comments: top-level first, replies attached as
    // `replies[]` on each parent. Production DB uses `body` column;
    // we alias it to `content` in the response so existing UI callers
    // keep working.
    if (url === '/comments' && req.method === 'GET') {
      const entity_id   = q.entity_id;
      const entity_type = q.entity_type || 'post';
      if (!entity_id) return res.status(400).json({ error: 'entity_id required' });

      const { data, error } = await sb().from('comments')
        .select('id,user_id,body,parent_id,like_count,created_at')
        .eq('entity_id', entity_id)
        .eq('entity_type', entity_type)
        .order('created_at', { ascending: true })
        .limit(200);

      if (error) return res.status(400).json({ error: error.message });

      const profileIds = [...new Set((data || []).map(c => c.user_id))];
      let profileMap = {};
      if (profileIds.length) {
        const { data: profiles } = await sb().from('profiles')
          .select('id,username,display_name,avatar_url').in('id', profileIds);
        (profiles || []).forEach(p => { profileMap[p.id] = p; });
      }

      const enriched = (data || []).map(c => ({
        ...c, content: c.body, profile: profileMap[c.user_id] || null, replies: []
      }));
      const byId = Object.fromEntries(enriched.map(c => [c.id, c]));
      const top = [];
      for (const c of enriched) {
        if (c.parent_id && byId[c.parent_id]) byId[c.parent_id].replies.push(c);
        else top.push(c);
      }
      return res.status(200).json({ comments: top, flat: enriched });
    }

    /* ─── POST /comments ─────────────────────────────────── */
    // Accepts {entity_id, entity_type, content|body, parent_id?}.
    // The DB column is `body` — we accept either name and write to body.
    // Notification creation is handled by trg_notif_on_comment (DB
    // trigger); do NOT create one here or it will double-fire.
    if (url === '/comments' && req.method === 'POST') {
      const token = tokenFrom(req);
      const user  = await verifyToken(token);
      if (!user) return res.status(401).json({ error: 'Unauthorized' });

      const { entity_id, entity_type = 'post', content, body, parent_id } = req.body || {};
      const text = (body ?? content ?? '').trim();
      if (!entity_id || !text) return res.status(400).json({ error: 'entity_id and body/content required' });
      if (text.length > 500) return res.status(400).json({ error: 'comment too long (max 500)' });

      const insertRow = { user_id: user.id, entity_id, entity_type, body: text };
      if (parent_id) insertRow.parent_id = parent_id;

      const { data: comment, error } = await sbAs(token).from('comments')
        .insert(insertRow).select().single();

      if (error) return res.status(400).json({ error: error.message });

      if (entity_type === 'post') {
        const { data: p } = await sb().from('posts').select('comment_count').eq('id', entity_id).single();
        if (p) await sb().from('posts').update({ comment_count: (p.comment_count || 0) + 1 }).eq('id', entity_id);
      }

      return res.status(200).json({ comment: { ...comment, content: comment.body }, success: true });
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
      const auth = await authUser(req);
      if (!auth || auth.profile.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
      const token = tokenFrom(req);

      const page     = Math.max(1, parseInt(q.page   || '1'));
      const limit    = Math.min(100, parseInt(q.limit || '20'));
      const offset   = (page - 1) * limit;
      const status   = q.status   || '';
      const category = q.category || '';
      const source   = q.source   || '';
      const province = q.province || '';
      const search   = q.search   || '';

      let query = sbAs(token).from('scraped_leads')
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
        sbAs(token).from('scraped_leads').select('id', { count: 'exact', head: true }).eq('status', 'new'),
        sbAs(token).from('scraped_leads').select('id', { count: 'exact', head: true }).eq('status', 'contacted'),
        sbAs(token).from('scraped_leads').select('id', { count: 'exact', head: true }).eq('status', 'converted'),
        sbAs(token).from('scraped_leads').select('id', { count: 'exact', head: true }).eq('status', 'ignored'),
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
      const auth2 = await authUser(req);
      if (!auth2 || auth2.profile.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
      const leadToken = tokenFrom(req);

      const { status, notes } = req.body || {};
      const updates = { updated_at: new Date().toISOString() };
      if (status !== undefined) updates.status = status;
      if (notes  !== undefined) updates.notes  = notes;

      const { data, error } = await sbAs(leadToken).from('scraped_leads')
        .update(updates).eq('id', leadId).select().single();

      if (error) return res.status(400).json({ error: error.message });
      return res.status(200).json({ lead: data, success: true });
    }

    /* ─── GET /leads/:id/events ─── list events for one lead ─ */
    const leadEventsListMatch = url.match(/^\/leads\/([^/]+)\/events$/);
    if (leadEventsListMatch && req.method === 'GET') {
      const auth = await authUser(req);
      if (!auth || auth.profile.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
      const token = tokenFrom(req);
      const { data, error } = await sbAs(token).from('lead_events')
        .select('*').eq('lead_id', leadEventsListMatch[1]).order('created_at', { ascending: false });
      if (error) return res.status(400).json({ error: error.message });
      return res.status(200).json({ events: data || [] });
    }

    /* ─── POST /leads/:id/events ─── add event to lead ──────── */
    if (leadEventsListMatch && req.method === 'POST') {
      const auth = await authUser(req);
      if (!auth || auth.profile.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
      const token = tokenFrom(req);
      const { title, description, genre, event_date, event_time, venue_name, venue_city, venue_address, image_url, source_url, organiser_name, is_free, price_min } = req.body || {};
      if (!title) return res.status(400).json({ error: 'title required' });
      const { data, error } = await sbAs(token).from('lead_events').insert({
        lead_id: leadEventsListMatch[1], title, description: description || null,
        genre: genre || 'nightlife', event_date: event_date || null, event_time: event_time || null,
        venue_name: venue_name || null, venue_city: venue_city || null, venue_address: venue_address || null,
        image_url: image_url || null, source_url: source_url || null,
        organiser_name: organiser_name || null, is_free: !!is_free,
        price_min: price_min || null, status: 'pending',
      }).select().single();
      if (error) return res.status(400).json({ error: error.message });
      return res.status(201).json({ event: data });
    }

    /* ─── GET /admin/lead-events ─── all pending lead events ── */
    if (url === '/admin/lead-events' && req.method === 'GET') {
      const auth = await authUser(req);
      if (!auth || auth.profile.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
      const token = tokenFrom(req);
      const status = q.status || 'pending';
      let query = sbAs(token).from('lead_events')
        .select('*, scraped_leads(id, name, category, city, email, phone, instagram, facebook, website)')
        .order('created_at', { ascending: false });
      if (status !== 'all') query = query.eq('status', status);
      const { data, error } = await query;
      if (error) return res.status(400).json({ error: error.message });
      return res.status(200).json({ events: data || [] });
    }

    /* ─── PATCH /admin/lead-events/:id ─── approve/reject ───── */
    const leadEventMatch = url.match(/^\/admin\/lead-events\/([^/]+)$/);
    if (leadEventMatch && req.method === 'PATCH') {
      const auth = await authUser(req);
      if (!auth || auth.profile.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
      const token = tokenFrom(req);
      const leId = leadEventMatch[1];
      const { action, admin_notes } = req.body || {};

      if (action === 'reject') {
        const { error } = await sbAs(token).from('lead_events')
          .update({ status: 'rejected', admin_notes: admin_notes || null, updated_at: new Date().toISOString() })
          .eq('id', leId);
        if (error) return res.status(400).json({ error: error.message });
        await logAdminAction(auth.user.id, auth.profile.display_name || 'Admin', 'lead_event_reject', leId, null, { admin_notes });
        return res.status(200).json({ success: true });
      }

      if (action === 'approve') {
        // Fetch the lead event + lead info
        const { data: le } = await sbAs(token).from('lead_events')
          .select('*, scraped_leads(name, city)').eq('id', leId).single();
        if (!le) return res.status(404).json({ error: 'Lead event not found' });

        // Publish to events table
        const eventId = 'lead_' + leId.replace(/-/g, '').slice(0, 16);
        const { error: evErr } = await sbAs(token).from('events').upsert({
          id: eventId, source: 'lead', name: le.title,
          description: le.description || null, organiser_name: le.organiser_name || le.scraped_leads?.name || null,
          genre: le.genre || 'nightlife', status: 'onsale',
          date_local: le.event_date || null, time_local: le.event_time || null,
          venue_name: le.venue_name || null, venue_city: le.venue_city || le.scraped_leads?.city || null,
          venue_address: le.venue_address || null,
          image_url: le.image_url || null, is_free: le.is_free || false,
          price_min: le.price_min || null, external_url: le.source_url || null,
          hype_score: 65, is_active: true, is_frontline: false,
          like_count: 0, comment_count: 0, approved: true,
        }, { onConflict: 'id' });
        if (evErr) return res.status(400).json({ error: evErr.message });

        // Mark lead event as approved
        await sbAs(token).from('lead_events')
          .update({ status: 'approved', published_event_id: eventId, admin_notes: admin_notes || null, updated_at: new Date().toISOString() })
          .eq('id', leId);

        await logAdminAction(auth.user.id, auth.profile.display_name || 'Admin', 'lead_event_approve', leId, le.title, { published_event_id: eventId });
        return res.status(200).json({ success: true, published_event_id: eventId });
      }

      return res.status(400).json({ error: 'action must be approve or reject' });
    }


    const adminUserMatch = url.match(/^\/admin\/users\/([^/]+)$/);
    if (adminUserMatch && req.method === 'PATCH') {
      const auth = await authUser(req);
      if (!auth || auth.profile.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
      }

      const userId = adminUserMatch[1];
      const { suspended, role, subscription_type } = req.body || {};

      const updates = {};
      if (typeof suspended === 'boolean') updates.suspended = suspended;
      if (role && ['user', 'business', 'admin', 'organizer'].includes(role)) updates.role = role;
      if (subscription_type && ['free', 'premium', 'trial'].includes(subscription_type)) {
        updates.subscription_type = subscription_type;
        if (subscription_type !== 'trial') updates.trial_expires_at = null;
      }

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

      // Log the admin action
      const adminName = auth.profile.display_name || auth.user.email || 'Admin';
      const targetName = data.display_name || data.email || userId;
      if (updates.suspended === true)  await logAdminAction(auth.user.id, adminName, 'suspend',               userId, targetName, updates);
      if (updates.suspended === false) await logAdminAction(auth.user.id, adminName, 'unsuspend',             userId, targetName, updates);
      if (updates.role)                await logAdminAction(auth.user.id, adminName, 'role_change',           userId, targetName, updates);
      if (updates.subscription_type)   await logAdminAction(auth.user.id, adminName, 'subscription_change',  userId, targetName, updates);

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
        .update({ trial_expires_at: expiresAt.toISOString(), subscription_type: 'trial' })
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
        .select('id,email,role,display_name,subscription_type,trial_expires_at,suspended,created_at')
        .order('created_at', { ascending: false });
      
      if (error) throw error;
      
      return res.status(200).json({ users: data });
    }

    /* ─── POST /auth/ensure-business-profile ────────────────── */
    if (url === '/auth/ensure-business-profile' && req.method === 'POST') {
      const token = tokenFrom(req);
      const user = await verifyToken(token);
      if (!user) return res.status(401).json({ error: 'Unauthorized' });

      const supabase = sb();
      let { data: profile, error: profileError } = await supabase.from('profiles').select('*').eq('id', user.id).single();
      
      if (profileError && profileError.code !== 'PGRST116') throw profileError;

      if (!profile) {
        const bizName = user.user_metadata?.full_name || user.email.split('@')[0];
        const { data: newProfile, error: createError } = await supabase.from('profiles').insert({
          id: user.id, email: user.email,
          display_name: bizName,
          avatar_url: user.user_metadata?.avatar_url,
          role: 'business'
        }).select().single();
        if (createError) throw createError;
        profile = newProfile;

        const { data: bizCheck } = await supabase.from('businesses').select('id').eq('id', profile.id).maybeSingle();
        if (!bizCheck) {
          await supabase.from('businesses').insert({ id: profile.id, owner_id: profile.id, name: bizName, category: 'other', is_active: true });
        }

        // Non-blocking welcome email for new business accounts
        sendWelcomeEmail(user.email, bizName).catch(e => console.error('[email/welcome-biz]', e.message));
      } else if (!['business', 'admin', 'organizer'].includes(profile.role)) {
        const { data: updatedProfile, error: updateError } = await supabase.from('profiles').update({ role: 'business' }).eq('id', user.id).select().single();
        if (updateError) throw updateError;
        profile = updatedProfile;
      }
      return res.status(200).json({ profile });
    }

    /* ─── GET /quicket-events ─────────────────────────────── */
    if (url === '/quicket-events' && req.method === 'GET') {
      const QUICKET_KEY = process.env.QUICKET_API_KEY || '7f03069e38b5802980c9ca620dd14dff';

      const city  = q.city  || 'all';   // 'all' | 'kzn' | 'jhb' | 'durban' | 'johannesburg' | ...
      const genre = q.genre || 'all';
      const free  = q.free === '1' || q.free === 'true';
      const limit = Math.min(parseInt(q.limit || '200'), 500);

      // Quicket category/keyword → Pulsefy genre
      const GENRE_MAP = {
        music:'house', concert:'house', live:'live',
        amapiano:'amapiano', gqom:'gqom',
        'hip-hop':'hiphop', hiphop:'hiphop', hip_hop:'hiphop', rap:'hiphop',
        house:'house', afrobeats:'afrobeats', afrohouse:'afrohouse',
        rock:'rock', gospel:'gospel', jazz:'jazz',
        maskandi:'maskandi', kwaito:'kwaito',
        reggae:'reggae', soul:'soul', rnb:'rnb',
        comedy:'comedy', sport:'sport', sports:'sport',
        festival:'festival', nightlife:'nightlife',
        theatre:'theatre', theater:'theatre',
        outdoor:'outdoor', adventure:'outdoor', hiking:'outdoor', camping:'outdoor',
        ceremonies:'ceremonies', ceremony:'ceremonies', wedding:'ceremonies',
        workshop:'workshop', course:'workshop', training:'workshop', class:'workshop', seminar:'workshop',
        food:'food', cuisine:'food', dining:'food', tasting:'food', shisanyama:'shisanyama',
        cultural:'cultural', heritage:'cultural', traditional:'cultural',
        business:'business', conference:'business', networking:'business', expo:'business',
        fashion:'fashion', style:'fashion',
        wellness:'wellness', yoga:'wellness', fitness:'wellness', meditation:'wellness', health:'wellness',
        art:'art', exhibition:'art', gallery:'art',
        market:'market', flea:'market', craft:'market',
        kids:'kids', family:'kids', children:'kids',
        charity:'charity', fundraiser:'charity', cause:'charity',
        technology:'tech', tech:'tech',
        film:'film', movie:'film', cinema:'film',
        dance:'dance', ballet:'dance',
      };

      // Cities to fetch — biased toward KZN + JHB metros
      const KZN = ['Durban', 'Pietermaritzburg', 'Umhlanga'];
      const JHB = ['Johannesburg', 'Sandton', 'Pretoria'];
      let citiesToFetch;
      if (city === 'all')              citiesToFetch = [...KZN, ...JHB];
      else if (city === 'kzn')         citiesToFetch = KZN;
      else if (city === 'jhb' || city === 'johannesburg') citiesToFetch = JHB;
      else if (city === 'durban')      citiesToFetch = ['Durban'];
      else                              citiesToFetch = [city];

      const PAGES_PER_CITY = 2;
      const PAGE_SIZE      = 50;

      const quicketFetch = async (fetchCity, page) => {
        // usertoken must be a query param, not a header
        const params = new URLSearchParams({
          usertoken: QUICKET_KEY,
          pagesize:  String(PAGE_SIZE),
          page:      String(page),
          location:  fetchCity,
          country:   'ZA',
          startDate: new Date().toISOString().split('T')[0],
        });
        if (genre !== 'all') params.append('search', genre);

        try {
          const resp = await fetch(`https://api.quicket.co.za/api/events?${params}`, {
            headers: { 'Accept': 'application/json' },
            signal: AbortSignal.timeout(10000),
          });
          if (!resp.ok) {
            const body = await resp.text().catch(() => '');
            console.warn(`[Quicket] ${fetchCity} p${page} → HTTP ${resp.status}`, body.slice(0, 200));
            return [];
          }
          const json = await resp.json();
          const rows = json?.data || json?.events || json?.results || (Array.isArray(json) ? json : []);
          console.log(`[Quicket] ${fetchCity} p${page} → ${rows.length} events`);
          return rows;
        } catch(e) {
          console.warn(`[Quicket] ${fetchCity} p${page} fetch error: ${e.message}`);
          return [];
        }
      };

      const normalize = (item, fetchCity) => {
        const id         = item.id || item.event_id || item.EventId;
        const title      = item.title || item.name || item.EventName;
        const venue      = item.venue?.name || item.venueName || item.venue_name || item.Venue || '';
        const cityVal    = item.venue?.city || item.city || item.venueCity || fetchCity;
        const start      = item.startDate || item.start_date || item.StartDate || item.date_local;
        const image      = item.imageUrl || item.image_url || item.bannerUrl || item.banner_url || null;
        const desc       = item.description || item.shortDescription || item.short_description || null;
        const url_       = item.url || item.eventUrl || item.event_url || `https://www.quicket.co.za/events/${id}`;
        const priceRaw   = item.minPrice ?? item.min_price ?? item.ticketMinPrice ?? item.price_min ?? 0;
        const catRaw     = (item.category || item.categories?.[0]?.name || item.genre || '').toLowerCase().replace(/\s+/g, '');
        const mappedGenre = GENRE_MAP[catRaw] || (catRaw || 'other');
        const lat        = parseFloat(item.venue?.latitude  || item.latitude  || item.lat  || 0) || null;
        const lon        = parseFloat(item.venue?.longitude || item.longitude || item.lon || 0) || null;
        const priceNum   = typeof priceRaw === 'number' ? priceRaw : parseFloat(priceRaw) || 0;

        if (!id || !title || !start) return null;

        return {
          id:            `qkt_${id}`,
          name:          title,
          date_local:    start,
          venue_name:    venue,
          venue_city:    cityVal,
          venue_lat:     lat,
          venue_lon:     lon,
          price_min:     priceNum,
          is_free:       priceNum === 0 || priceRaw === 'Free' || priceRaw === 'free',
          image_url:     image,
          genre:         mappedGenre,
          description:   desc,
          external_url:  url_,
          source:        'quicket',
          is_active:     true,
          organiser_name: item.organiser?.name || item.organiserName || item.organizer || null,
        };
      };

      try {
        const tasks = [];
        for (const c of citiesToFetch) {
          for (let p = 1; p <= PAGES_PER_CITY; p++) {
            tasks.push(quicketFetch(c, p).then(items => items.map(i => normalize(i, c)).filter(Boolean)));
          }
        }
        const batches = await Promise.all(tasks);
        const seen = new Set();
        let events = [];
        for (const batch of batches) {
          for (const ev of batch) {
            if (seen.has(ev.id)) continue;
            seen.add(ev.id);
            events.push(ev);
          }
        }
        if (free) events = events.filter(e => e.is_free);
        // Free events first, then by date ascending
        events.sort((a, b) => {
          if (a.is_free !== b.is_free) return a.is_free ? -1 : 1;
          return new Date(a.date_local) - new Date(b.date_local);
        });
        events = events.slice(0, limit);
        // Don't cache while we're debugging the integration — re-enable s-maxage=1800 once stable
        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).json({ events, total: events.length, source: 'quicket', cities_tried: citiesToFetch });
      } catch(e) {
        console.error('[Quicket]', e.message);
        return res.status(502).json({ error: 'Failed to fetch Quicket events', detail: e.message });
      }
    }

    /* /verify-request lives in api/payments/index.js (see vercel.json
       rewrite: /api/verify-request → /api/payments). Don't re-add it here. */

    /* ─── GET /admin/verifications ─────────────────────────── */
    if (url === '/admin/verifications' && req.method === 'GET') {
      const auth = await authUser(req);
      if (!auth || auth.profile.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
      }
      const { data, error } = await sb()
        .from('profiles')
        .select('id,email,display_name,role,verif_status,verif_request,is_verified,face_scan_url,id_doc_url,created_at')
        .in('verif_status', ['pending', 'approved', 'rejected'])
        .order('created_at', { ascending: false });
      if (error) return res.status(400).json({ error: error.message });
      // Sign URLs from the private verification-docs bucket so the admin browser can render them
      const signOne = async (url) => {
        if (!url || !url.includes('/verification-docs/')) return url;
        try {
          const path = url.split('/verification-docs/')[1].split('?')[0];
          const { data: s } = await sb().storage.from('verification-docs').createSignedUrl(path, 3600);
          return s?.signedUrl || url;
        } catch { return url; }
      };
      const verifications = await Promise.all((data || []).map(async (row) => ({
        ...row,
        face_scan_url: await signOne(row.face_scan_url),
        id_doc_url:    await signOne(row.id_doc_url),
      })));
      return res.status(200).json({ verifications });
    }

    /* ─── GET /admin/kyc/:userId ────────────────────────────── */
    const kycMatch = url.match(/^\/admin\/kyc\/([^/]+)$/);
    if (kycMatch && req.method === 'GET') {
      const auth = await authUser(req);
      if (!auth || auth.profile.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
      const { data: docs } = await sb().from('kyc_documents').select('*').eq('user_id', kycMatch[1]).order('uploaded_at', { ascending: false });
      // Generate a signed URL for each document
      const withSigned = await Promise.all((docs || []).map(async (d) => {
        try {
          const { data: s } = await sb().storage.from('verification-docs').createSignedUrl(d.storage_path, 86400); // 24h
          return { ...d, signed_url: s?.signedUrl || null };
        } catch { return { ...d, signed_url: null }; }
      }));
      return res.status(200).json({ documents: withSigned });
    }

    /* ─── GET /admin/events ─────────────────────────────────── */
    if (url === '/admin/events' && req.method === 'GET') {
      const auth = await authUser(req);
      if (!auth || auth.profile.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
      const filter = req.query?.filter || 'pending';
      let query = sb().from('events').select('id,name,venue_name,venue_city,date_local,genre,organiser_id,organiser_name,approved,created_at').order('created_at', { ascending: false });
      if (filter === 'pending') query = query.eq('approved', false);
      const { data, error } = await query;
      if (error) return res.status(400).json({ error: error.message });
      return res.status(200).json({ events: data || [] });
    }

    /* ─── PATCH /admin/events/:id ───────────────────────────── */
    const adminEventMatch = url.match(/^\/admin\/events\/([^/]+)$/);
    if (adminEventMatch && req.method === 'PATCH') {
      const auth = await authUser(req);
      if (!auth || auth.profile.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
      const eventId = adminEventMatch[1];
      const { approved } = req.body || {};
      const { data: evtRow } = await sb().from('events').select('name,organiser_name,organiser_id').eq('id', eventId).single();
      const adminName = auth.profile.display_name || auth.user.email || 'Admin';
      if (approved === false) {
        const { error } = await sb().from('events').delete().eq('id', eventId);
        if (error) return res.status(400).json({ error: error.message });
        await logAdminAction(auth.user.id, adminName, 'event_reject', eventId, evtRow?.name || eventId, {});
        if (evtRow?.organiser_id) {
          await sb().from('notifications').insert({
            user_id: evtRow.organiser_id, type: 'event_rejected',
            entity_id: eventId, entity_type: 'event',
            from_display_name: 'Pulsefy Admin',
            message: `Your event "${evtRow.name}" was not approved. Please review and resubmit, or contact support.`,
          }).catch(() => {});
        }
        return res.status(200).json({ success: true, deleted: true });
      }
      const { data, error } = await sb().from('events').update({ approved: true }).eq('id', eventId).select().single();
      if (error) return res.status(400).json({ error: error.message });
      await logAdminAction(auth.user.id, adminName, 'event_approve', eventId, evtRow?.name || eventId, {});
      if (evtRow?.organiser_id) {
        await sb().from('notifications').insert({
          user_id: evtRow.organiser_id, type: 'event_approved',
          entity_id: eventId, entity_type: 'event',
          from_display_name: 'Pulsefy Admin',
          message: `🎉 Your event "${evtRow.name}" has been approved and is now live on the map!`,
        }).catch(() => {});
      }
      return res.status(200).json({ success: true, event: data });
    }

    /* ─── POST /admin/events ── admin manually adds an event to the map ── */
    if (url === '/admin/events' && req.method === 'POST') {
      const token = tokenFrom(req);
      const auth = await authUser(req);
      if (!auth || auth.profile.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
      const b = req.body || {};
      if (!b.name || !b.date_local || !b.venue_name || !b.venue_city) return res.status(400).json({ error: 'name, date_local, venue_name and venue_city are required' });
      const lat = Number(b.venue_lat), lon = Number(b.venue_lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return res.status(400).json({ error: 'venue_lat and venue_lon are required so the event shows on the map' });
      if (lat < -35 || lat > -22 || lon < 16 || lon > 33) return res.status(400).json({ error: 'Coordinates outside South Africa (lat -35 to -22, lon 16 to 33)' });
      const id = 'adm_' + Date.now();
      // Use the admin's own JWT — events RLS requires organiser_id = auth.uid()
      // and the server falls back to the anon key when no service key is set.
      const { data, error } = await sbAs(token).from('events').insert({
        id,
        organiser_id: auth.user.id,
        name: b.name,
        date_local: b.date_local,
        time_local: b.time_local || null,
        venue_name: b.venue_name,
        venue_city: b.venue_city,
        venue_lat: lat,
        venue_lon: lon,
        genre: b.genre || 'other',
        description: b.description || null,
        image_url: b.image_url || null,
        price_min: b.price_min != null && b.price_min !== '' ? Number(b.price_min) : null,
        is_free: !!b.is_free,
        organiser_name: b.organiser_name || 'Pulsefy',
        source: 'admin',
        is_active: true,
        approved: true,
      }).select().single();
      if (error) return res.status(400).json({ error: error.message });
      await logAdminAction(auth.user.id, auth.profile.display_name || auth.user.email || 'Admin', 'event_add', id, b.name, {});
      return res.status(200).json({ success: true, event: data });
    }

    /* ─── POST /admin/businesses ── admin manually adds a place to the map ── */
    if (url === '/admin/businesses' && req.method === 'POST') {
      const token = tokenFrom(req);
      const auth = await authUser(req);
      if (!auth || auth.profile.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
      const b = req.body || {};
      if (!b.name || !b.category || !b.city) return res.status(400).json({ error: 'name, category and city are required' });
      const lat = Number(b.lat), lon = Number(b.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return res.status(400).json({ error: 'lat and lon are required so the place shows on the map' });
      if (lat < -35 || lat > -22 || lon < 16 || lon > 33) return res.status(400).json({ error: 'Coordinates outside South Africa (lat -35 to -22, lon 16 to 33)' });
      const { data, error } = await sbAs(token).from('businesses').insert({
        name: b.name,
        category: b.category,
        subcategory: b.subcategory || null,
        tagline: b.tagline || null,
        description: b.description || null,
        city: b.city,
        suburb: b.suburb || null,
        address: b.address || null,
        lat, lon,
        phone: b.phone || null,
        whatsapp: b.whatsapp || null,
        cover_image_url: b.cover_image_url || null,
        is_active: true,
      }).select().single();
      if (error) return res.status(400).json({ error: error.message });
      await logAdminAction(auth.user.id, auth.profile.display_name || auth.user.email || 'Admin', 'business_add', data.id, b.name, {});
      return res.status(200).json({ success: true, business: data });
    }

    /* ─── PATCH /admin/verifications/:id ───────────────────── */
    const verifMatch = url.match(/^\/admin\/verifications\/([^/]+)$/);
    if (verifMatch && req.method === 'PATCH') {
      const auth = await authUser(req);
      if (!auth || auth.profile.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
      }
      const targetId = verifMatch[1];
      const { action, notes } = req.body || {};
      if (!['approve', 'reject'].includes(action)) {
        return res.status(400).json({ error: 'action must be approve or reject' });
      }
      const updates = {
        verif_status: action === 'approve' ? 'approved' : 'rejected',
        is_verified:  action === 'approve',
      };
      const { data, error } = await sb().from('profiles').update(updates).eq('id', targetId).select().single();
      if (error) return res.status(400).json({ error: error.message });

      // Notify the user about verification result
      const adminName = auth.profile.display_name || 'Pulsefy Admin';
      const msg = action === 'approve'
        ? '🎉 Your profile has been verified! Your Pulsefy verified badge is now active.'
        : `Your verification application was not approved. ${notes ? 'Reason: ' + notes : 'Please re-apply with complete and accurate information.'}`;
      await sb().from('notifications').insert({
        user_id:           targetId,
        type:              'verification',
        from_user_id:      auth.user.id,
        from_display_name: adminName,
        message:           msg,
        entity_type:       'profile',
        entity_id:         targetId,
        data:              { action, notes: notes || null },
        read:              false,
      });
      await logAdminAction(auth.user.id, adminName, action === 'approve' ? 'verif_approve' : 'verif_reject', targetId, data?.display_name || targetId, { notes });

      // Non-blocking verification result email
      const targetEmail = data?.email;
      const targetName  = data?.display_name;
      if (targetEmail) {
        if (action === 'approve') {
          sendVerifApprovedEmail(targetEmail, targetName).catch(e => console.error('[email/verif]', e.message));
        } else {
          sendVerifRejectedEmail(targetEmail, targetName, notes).catch(e => console.error('[email/verif]', e.message));
        }
      }

      return res.status(200).json({ success: true, profile: data });
    }


    /* ─── POST /admin/scrape ── OSM venue scraper (no API key needed) ─ */
    if (url === '/admin/scrape' && req.method === 'POST') {
      const auth = await authUser(req);
      if (!auth || auth.profile.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });

      const cities = q.cities ? q.cities.split(',') : ['Durban','Johannesburg'];
      const results = { inserted: 0, skipped: 0, errors: 0, cities_done: [] };

      // Venue type queries for OSM Overpass
      const VENUE_TYPES = [
        { filter: '["amenity"="nightclub"]',  category: 'club',        label: 'Club/Nightclub' },
        { filter: '["amenity"="bar"]',         category: 'bar',         label: 'Bar/Tavern' },
        { filter: '["amenity"="restaurant"]["cuisine"~"braai|shisa|grill|south_african|african",i]', category: 'shisanyama', label: 'Shisanyama/Braai' },
        { filter: '["tourism"="guest_house"]', category: 'bnb',         label: 'Guest House/BnB' },
        { filter: '["tourism"="hostel"]',      category: 'bnb',         label: 'Hostel' },
        { filter: '["tourism"="hotel"]',       category: 'hotel',       label: 'Hotel' },
        { filter: '["amenity"="events_venue"]',category: 'venue',       label: 'Events Venue' },
        { filter: '["leisure"="dance"]',        category: 'dance_venue', label: 'Dance Venue' },
      ];

      // Bounding boxes: [south, west, north, east]
      const CITY_BOXES = {
        'Durban':         '-30.1,30.7,-29.6,31.2',
        'Johannesburg':   '-26.4,27.8,-25.9,28.3',
        'Cape Town':      '-34.2,18.3,-33.7,18.7',
        'Pretoria':       '-25.9,28.0,-25.6,28.4',
        'Sandton':        '-26.2,28.0,-26.0,28.2',
        'KwaMashu':       '-29.8,30.9,-29.7,31.0',
        'Umlazi':         '-29.97,30.87,-29.87,30.97',
      };

      const overpassFetch = async (query) => {
        const body = 'data=' + encodeURIComponent(query);
        try {
          const r = await fetch('https://overpass-api.de/api/interpreter', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'Pulsefy/1.0' },
            body,
            signal: AbortSignal.timeout(20000),
          });
          if (!r.ok) return [];
          const j = await r.json();
          return j.elements || [];
        } catch { return []; }
      };

      for (const city of cities) {
        const bbox = CITY_BOXES[city];
        if (!bbox) continue;
        const province = { 'Durban':'KZN','KwaMashu':'KZN','Umlazi':'KZN','Johannesburg':'GP','Sandton':'GP','Cape Town':'WC','Pretoria':'GP' }[city] || null;

        for (const vt of VENUE_TYPES) {
          const overpassQuery = `[out:json][timeout:20];(node${vt.filter}(${bbox});way${vt.filter}(${bbox}););out body;`;
          const elements = await overpassFetch(overpassQuery);

          for (const el of elements) {
            const tags = el.tags || {};
            const name = tags.name || tags['name:en'];
            if (!name) continue;

            // skip if already in DB
            const { count } = await sb().from('scraped_leads')
              .select('id', { count: 'exact', head: true }).eq('name', name).eq('city', city);
            if (count > 0) { results.skipped++; continue; }

            const { error } = await sb().from('scraped_leads').insert({
              name,
              category:  vt.category,
              city,
              province,
              phone:     tags.phone || tags['contact:phone'] || null,
              website:   tags.website || tags['contact:website'] || null,
              instagram: tags['contact:instagram'] || null,
              facebook:  tags['contact:facebook'] || null,
              description: tags.description || `${vt.label} in ${city}`,
              source:    'osm',
              status:    'new',
            });

            if (error) results.errors++;
            else results.inserted++;
          }
        }
        results.cities_done.push(city);
      }

      await logAdminAction(auth.user.id, auth.profile.display_name || 'Admin', 'scrape_osm', null, null, results);
      return res.status(200).json({ success: true, ...results });
    }

    /* ─── GET /admin/banners ─────────────────────────────── */
    if (url === '/admin/banners' && req.method === 'GET') {
      const auth = await authUser(req);
      if (!auth || auth.profile.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
      const token = tokenFrom(req);
      const { data, error } = await sbAs(token).from('banners').select('*').order('created_at', { ascending: false });
      if (error) return res.status(400).json({ error: error.message });
      return res.status(200).json({ banners: data });
    }

    /* ─── POST /admin/banners ────────────────────────────── */
    if (url === '/admin/banners' && req.method === 'POST') {
      const auth = await authUser(req);
      if (!auth || auth.profile.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
      const { title, subtitle, target_url, target_type, image_url, bg_color, expires_at } = req.body || {};
      if (!title) return res.status(400).json({ error: 'title is required' });
      const token = tokenFrom(req);
      const { data, error } = await sbAs(token).from('banners').insert({
        title, subtitle: subtitle || null, target_url: target_url || null,
        target_type: target_type || 'external', image_url: image_url || null,
        bg_color: bg_color || '#FF5C00', is_active: true,
        expires_at: expires_at || null,
      }).select().single();
      if (error) return res.status(400).json({ error: error.message });
      return res.status(201).json({ banner: data });
    }

    /* ─── PATCH /admin/banners/:id ───────────────────────── */
    const bannerMatch = url.match(/^\/admin\/banners\/([^/]+)$/);
    if (bannerMatch && req.method === 'PATCH') {
      const auth = await authUser(req);
      if (!auth || auth.profile.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
      const { data, error } = await sb().from('banners').update(req.body).eq('id', bannerMatch[1]).select().single();
      if (error) return res.status(400).json({ error: error.message });
      return res.status(200).json({ banner: data });
    }

    /* ─── DELETE /admin/banners/:id ──────────────────────── */
    if (bannerMatch && req.method === 'DELETE') {
      const auth = await authUser(req);
      if (!auth || auth.profile.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
      const { error } = await sb().from('banners').delete().eq('id', bannerMatch[1]);
      if (error) return res.status(400).json({ error: error.message });
      return res.status(200).json({ success: true });
    }

    /* ─── GET /banners (public — active only) ────────────── */
    if (url === '/banners' && req.method === 'GET') {
      const now = new Date().toISOString();
      const { data, error } = await sb().from('banners')
        .select('id,title,subtitle,target_url,target_type,image_url,bg_color')
        .eq('is_active', true)
        .or(`expires_at.is.null,expires_at.gte.${now}`)
        .order('created_at', { ascending: false });
      if (error) return res.status(400).json({ error: error.message });
      return res.status(200).json({ banners: data });
    }

    /* ─── GET /push/vapid-public-key ────────────────────── */
    if (url === '/push/vapid-public-key' && req.method === 'GET') {
      return res.status(200).json({ key: process.env.VAPID_PUBLIC_KEY || null });
    }

    /* ─── POST /push/subscribe ──────────────────────────── */
    if (url === '/push/subscribe' && req.method === 'POST') {
      const token = tokenFrom(req);
      const user  = await verifyToken(token);
      if (!user) return res.status(401).json({ error: 'Unauthorized' });
      const { subscription, city, genres } = req.body || {};
      if (!subscription?.endpoint) return res.status(400).json({ error: 'subscription required' });
      await sb().from('push_subscriptions').upsert({
        user_id:  user.id,
        endpoint: subscription.endpoint,
        p256dh:   subscription.keys?.p256dh || null,
        auth:     subscription.keys?.auth   || null,
        city:     city   || null,
        genres:   genres || [],
      }, { onConflict: 'endpoint' });
      return res.status(200).json({ ok: true });
    }

    /* ─── POST /admin/notify ─────────────────────────────── */
    if (url === '/admin/notify' && req.method === 'POST') {
      const auth = await authUser(req);
      if (!auth || auth.profile?.role !== 'admin') return res.status(403).json({ error: 'Admin only' });

      const { title, body: msgBody, url: targetUrl = '/', target = 'all' } = req.body || {};
      if (!title || !msgBody) return res.status(400).json({ error: 'title and body required' });

      // Resolve target users
      let uq = sb().from('profiles').select('id,city,genres');
      if (target.startsWith('city:'))  uq = uq.ilike('city', target.slice(5));
      if (target.startsWith('genre:')) uq = uq.contains('genres', [target.slice(6)]);
      if (target.startsWith('user:'))  uq = uq.eq('id', target.slice(5));
      const { data: users } = await uq;
      if (!users?.length) return res.status(200).json({ notif_sent: 0, push_sent: 0 });

      // Batch-insert in-app notifications
      const notifs = users.map(u => ({
        user_id: u.id, type: 'broadcast',
        title, body: msgBody, message: msgBody,
        data: { url: targetUrl },
        from_display_name: 'Pulsefy',
      }));
      await sb().from('notifications').insert(notifs);

      // Web push (only if VAPID keys configured)
      let push_sent = 0;
      const VPUB = process.env.VAPID_PUBLIC_KEY;
      const VPRIV = process.env.VAPID_PRIVATE_KEY;
      if (VPUB && VPRIV) {
        try {
          const webpush = require('web-push');
          webpush.setVapidDetails('mailto:admin@pulsefy.co.za', VPUB, VPRIV);
          const ids = users.map(u => u.id);
          const { data: subs } = await sb().from('push_subscriptions').select('*').in('user_id', ids);
          const payload = JSON.stringify({ title, body: msgBody, url: targetUrl });
          await Promise.all((subs || []).map(s =>
            webpush.sendNotification(
              { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
              payload
            ).then(() => push_sent++).catch(() => {})
          ));
        } catch(e) { /* web-push not installed or keys invalid */ }
      }

      const adminName2 = auth.profile.display_name || auth.user.email || 'Admin';
      await logAdminAction(auth.user.id, adminName2, 'notification_broadcast', null, title, { target, recipients: notifs.length });
      return res.status(200).json({ notif_sent: notifs.length, push_sent });
    }

    /* ─── GET /promotions ───────────────────────────────── */
    if (url === '/promotions' && req.method === 'GET') {
      const city  = (q.city  || '').toLowerCase();
      const genre = (q.genre || '').toLowerCase();
      const now   = new Date().toISOString();

      const { data, error } = await sb().from('promotions')
        .select('*')
        .eq('is_active', true)
        .lte('starts_at', now)
        .or(`ends_at.is.null,ends_at.gt.${now}`)
        .order('priority', { ascending: false });

      if (error) return res.status(400).json({ error: error.message });

      const promos = (data || []).filter(p => {
        const cityOk  = !p.city_targets?.length  || !city  || p.city_targets.some(c => city.includes(c.toLowerCase()) || c.toLowerCase().includes(city));
        const genreOk = !p.genre_targets?.length || !genre || p.genre_targets.some(g => genre.includes(g.toLowerCase()) || g.toLowerCase().includes(genre));
        return cityOk && genreOk;
      });

      const featured  = promos.filter(p => p.placement === 'featured_weekend' || p.placement === 'both').slice(0, 5);
      const injected  = promos.filter(p => p.placement === 'feed_inject'      || p.placement === 'both').slice(0, 4);

      return res.status(200).json({ featured, injected });
    }

    /* ─── POST /promotions/create ────────────────────────── */
    if (url === '/promotions/create' && req.method === 'POST') {
      const _promoToken = tokenFrom(req);
      const auth = await authUser(req);
      if (!auth) return res.status(401).json({ error: 'Unauthorized' });
      const { role } = auth.profile;
      // Use user's JWT for RLS so auth.uid() matches owner_id in the insert policy
      const _promoDB = _promoToken ? sbAs(_promoToken) : sb();
      if (!['organizer','business','admin'].includes(role)) return res.status(403).json({ error: 'Organizer or business account required' });

      const {
        title, organiser_name, venue_name, venue_city, date_local, time_local,
        price_min, is_free, image_url, genre, external_url,
        city_targets, genre_targets, placement, duration_days, event_id,
      } = req.body || {};

      if (!title) return res.status(400).json({ error: 'title is required' });
      if (!['featured_weekend','feed_inject','both'].includes(placement))
        return res.status(400).json({ error: 'placement must be featured_weekend, feed_inject, or both' });

      // If event_id provided, verify ownership
      if (event_id) {
        const { data: ev } = await sb().from('events').select('organiser_id').eq('id', event_id).single();
        if (!ev) return res.status(404).json({ error: 'Event not found' });
        if (role !== 'admin' && ev.organiser_id !== auth.user.id)
          return res.status(403).json({ error: 'You do not own this event' });
      }

      const days = Math.min(Math.max(parseInt(duration_days) || 7, 1), 90);
      const ends_at = new Date(Date.now() + days * 86400000).toISOString();

      // Trusted submitters (or admins) bypass the approval queue
      const autoApprove = role === 'admin' || !!auth.profile.is_trusted_submitter;

      const { data: promo, error } = await _promoDB.from('promotions').insert({
        title, organiser_name: organiser_name || auth.profile.display_name || null,
        venue_name: venue_name || null, venue_city: venue_city || null,
        date_local: date_local || null, time_local: time_local || null,
        price_min: price_min ?? null, is_free: !!is_free,
        image_url: image_url || null, genre: genre || null,
        external_url: external_url || null,
        city_targets: Array.isArray(city_targets) ? city_targets : [],
        genre_targets: Array.isArray(genre_targets) ? genre_targets : [],
        placement, priority: 0,
        is_active: autoApprove,
        starts_at: new Date().toISOString(), ends_at,
        owner_id: auth.user.id, owner_role: role,
        event_id: event_id || null,
      }).select().single();

      if (error) return res.status(400).json({ error: error.message });
      return res.status(201).json({ promotion: promo, auto_approved: autoApprove });
    }

    /* ─── GET /promotions/mine ───────────────────────────── */
    if (url === '/promotions/mine' && req.method === 'GET') {
      const auth = await authUser(req);
      if (!auth) return res.status(401).json({ error: 'Unauthorized' });
      const { data, error } = await sb().from('promotions')
        .select('*').eq('owner_id', auth.user.id)
        .order('created_at', { ascending: false });
      if (error) return res.status(400).json({ error: error.message });
      return res.status(200).json({ promotions: data || [] });
    }

    /* ─── PATCH /promotions/:id ──────────────────────────── */
    const promoOwnMatch = url.match(/^\/promotions\/([^/]+)$/);
    if (promoOwnMatch && req.method === 'PATCH') {
      const auth = await authUser(req);
      if (!auth) return res.status(401).json({ error: 'Unauthorized' });
      const promoId = promoOwnMatch[1];
      const { data: existing } = await sb().from('promotions').select('owner_id').eq('id', promoId).single();
      if (!existing) return res.status(404).json({ error: 'Promotion not found' });
      if (auth.profile.role !== 'admin' && existing.owner_id !== auth.user.id)
        return res.status(403).json({ error: 'Not your promotion' });
      const allowed = ['title','organiser_name','venue_name','venue_city','date_local','time_local',
        'price_min','is_free','image_url','genre','external_url','city_targets','genre_targets',
        'placement','is_active','ends_at'];
      const updates = Object.fromEntries(Object.entries(req.body || {}).filter(([k]) => allowed.includes(k)));
      if (!Object.keys(updates).length) return res.status(400).json({ error: 'No valid fields to update' });
      const { data, error } = await sb().from('promotions').update(updates).eq('id', promoId).select().single();
      if (error) return res.status(400).json({ error: error.message });
      return res.status(200).json({ promotion: data });
    }

    /* ─── DELETE /promotions/:id ─────────────────────────── */
    if (promoOwnMatch && req.method === 'DELETE') {
      const auth = await authUser(req);
      if (!auth) return res.status(401).json({ error: 'Unauthorized' });
      const promoId = promoOwnMatch[1];
      const { data: existing } = await sb().from('promotions').select('owner_id').eq('id', promoId).single();
      if (!existing) return res.status(404).json({ error: 'Promotion not found' });
      if (auth.profile.role !== 'admin' && existing.owner_id !== auth.user.id)
        return res.status(403).json({ error: 'Not your promotion' });
      const { error } = await sb().from('promotions').delete().eq('id', promoId);
      if (error) return res.status(400).json({ error: error.message });
      return res.status(200).json({ ok: true });
    }

    /* ─── GET /admin/promotions ──────────────────────────── */
    if (url === '/admin/promotions' && req.method === 'GET') {
      const auth = await authUser(req);
      if (!auth || auth.profile.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
      const token = tokenFrom(req);
      const statusFilter = q.status || 'pending';
      let query = sbAs(token).from('promotions').select('*').order('created_at', { ascending: false });
      if (statusFilter === 'pending')  query = query.eq('is_active', false);
      else if (statusFilter === 'active') query = query.eq('is_active', true);
      const { data, error } = await query;
      if (error) return res.status(400).json({ error: error.message });
      return res.status(200).json({ promotions: data || [] });
    }

    /* ─── PATCH /admin/promotions/:id ────────────────────── */
    const adminPromoMatch = url.match(/^\/admin\/promotions\/([^/]+)$/);
    if (adminPromoMatch && req.method === 'PATCH') {
      const auth = await authUser(req);
      if (!auth || auth.profile.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
      const { is_active, priority, placement } = req.body || {};
      const updates = {};
      if (is_active !== undefined) updates.is_active = is_active;
      if (priority  !== undefined) updates.priority  = parseInt(priority);
      if (placement !== undefined) updates.placement = placement;
      const { data, error } = await sb().from('promotions').update(updates).eq('id', adminPromoMatch[1]).select().single();
      if (error) return res.status(400).json({ error: error.message });
      return res.status(200).json({ promotion: data });
    }

    /* ─── DELETE /admin/promotions/:id ───────────────────── */
    if (adminPromoMatch && req.method === 'DELETE') {
      const auth = await authUser(req);
      if (!auth || auth.profile.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
      const { error } = await sb().from('promotions').delete().eq('id', adminPromoMatch[1]);
      if (error) return res.status(400).json({ error: error.message });
      return res.status(200).json({ ok: true });
    }

    /* ─── GET /admin/trusted-submitters ──────────────────── */
    if (url === '/admin/trusted-submitters' && req.method === 'GET') {
      const auth = await authUser(req);
      if (!auth || auth.profile.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
      const { data, error } = await sb().from('profiles')
        .select('id, display_name, username, role, is_trusted_submitter, avatar_url')
        .in('role', ['business','organizer'])
        .order('is_trusted_submitter', { ascending: false })
        .order('display_name', { ascending: true })
        .limit(200);
      if (error) return res.status(400).json({ error: error.message });
      return res.status(200).json({ submitters: data || [] });
    }

    /* ─── PATCH /admin/trusted-submitters/:userId ────────── */
    const trustedMatch = url.match(/^\/admin\/trusted-submitters\/([^/]+)$/);
    if (trustedMatch && req.method === 'PATCH') {
      const auth = await authUser(req);
      if (!auth || auth.profile.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
      const { is_trusted_submitter } = req.body || {};
      const { data, error } = await sb().from('profiles')
        .update({ is_trusted_submitter: !!is_trusted_submitter })
        .eq('id', trustedMatch[1])
        .select('id, is_trusted_submitter').single();
      if (error) return res.status(400).json({ error: error.message });
      return res.status(200).json({ profile: data });
    }


    /* ─── POST /report-event | /report-business | /report-post ── */
    const REPORT_TABLES = {
      event:    { table: 'event_reports',    idCol: 'event_id',    nameCol: 'event_name' },
      business: { table: 'business_reports', idCol: 'business_id', nameCol: 'business_name' },
      post:     { table: 'post_reports',     idCol: 'post_id',     nameCol: 'post_caption' },
    };
    const reportPostMatch = url.match(/^\/report-(event|business|post)$/);
    if (reportPostMatch && req.method === 'POST') {
      const type   = reportPostMatch[1];
      const cfg    = REPORT_TABLES[type];
      const token = tokenFrom(req);
      const user   = token ? await verifyToken(token) : null;
      const body   = req.body || {};
      const targetId = body[cfg.idCol] ?? body.target_id ?? body.id;
      const targetName = body[cfg.nameCol] ?? body.target_name ?? body.name;
      const { reason, detail } = body;
      const validReasons = ['fake_event','stolen_content','i_am_owner','doesnt_exist','inappropriate','other'];
      if (!targetId || !validReasons.includes(reason)) return res.status(400).json({ error: `${cfg.idCol} and valid reason required` });
      const client = token ? sbAs(token) : sb();
      const { error } = await client.from(cfg.table).insert({
        [cfg.idCol]: targetId,
        [cfg.nameCol]: targetName || null,
        reporter_id: user?.id || null,
        reason, detail: detail?.trim() || null,
      });
      if (error) return res.status(400).json({ error: error.message });
      return res.status(201).json({ ok: true });
    }

    /* ─── GET /admin/reports?type=event|business|post|all ───── */
    if (url === '/admin/reports' && req.method === 'GET') {
      const auth = await authUser(req);
      if (!auth || auth.profile.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
      const status = req.query?.status || 'pending';
      const type   = req.query?.type   || 'event';
      const types  = type === 'all' ? ['event','business','post'] : [type];
      if (types.some(t => !REPORT_TABLES[t])) return res.status(400).json({ error: 'invalid type' });
      const token = tokenFrom(req);
      const results = await Promise.all(types.map(async (t) => {
        const cfg = REPORT_TABLES[t];
        let q = sbAs(token).from(cfg.table).select('*').order('created_at', { ascending: false });
        if (status !== 'all') q = q.eq('status', status);
        const { data, error } = await q;
        if (error) throw error;
        return (data || []).map(r => ({
          ...r,
          report_type: t,
          target_id:   r[cfg.idCol],
          target_name: r[cfg.nameCol],
        }));
      })).catch(err => ({ _error: err.message }));
      if (results._error) return res.status(400).json({ error: results._error });
      const reports = results.flat().sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      return res.status(200).json({ reports });
    }

    /* ─── PATCH /admin/reports/:type/:id (preferred) or /admin/reports/:id (legacy event) ── */
    const reportTypedMatch  = url.match(/^\/admin\/reports\/(event|business|post)\/([^/]+)$/);
    const reportLegacyMatch = url.match(/^\/admin\/reports\/([^/]+)$/);
    if ((reportTypedMatch || reportLegacyMatch) && req.method === 'PATCH') {
      const auth = await authUser(req);
      if (!auth || auth.profile.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
      const { status } = req.body || {};
      if (!['reviewed','dismissed'].includes(status)) return res.status(400).json({ error: 'status must be reviewed or dismissed' });
      const type = reportTypedMatch ? reportTypedMatch[1] : 'event';
      const id   = reportTypedMatch ? reportTypedMatch[2] : reportLegacyMatch[1];
      const { error } = await sb().from(REPORT_TABLES[type].table).update({ status }).eq('id', id);
      if (error) return res.status(400).json({ error: error.message });
      return res.status(200).json({ ok: true });
    }

    /* ─── SQUADS ─────────────────────────────────────────── */

    // GET /squads — list current user's squads
    if (url === '/squads' && req.method === 'GET') {
      const auth = await authUser(req);
      if (!auth) return res.status(401).json({ error: 'Unauthorized' });
      const { data: memberships } = await sb()
        .from('squad_members')
        .select('squad_id, role, joined_at, squads(id, name, description, avatar_url, is_public, member_count, total_points, template_type, created_at)')
        .eq('user_id', auth.user.id);
      return res.status(200).json({ squads: (memberships || []).map(m => ({ ...m.squads, role: m.role, joined_at: m.joined_at })) });
    }

    // POST /squads — create a squad
    if (url === '/squads' && req.method === 'POST') {
      const token = tokenFrom(req);
      const auth = await authUser(req);
      if (!auth) return res.status(401).json({ error: 'Unauthorized' });
      const { name, description, is_public = true, template_type = 'general' } = req.body || {};
      if (!name || !name.trim()) return res.status(400).json({ error: 'name is required' });
      const userClient = sbAs(token);
      const { data: squad, error } = await userClient
        .from('squads')
        .insert({ name: name.trim(), description: description?.trim() || null, creator_id: auth.user.id, is_public, template_type })
        .select('id, name, description, avatar_url, is_public, member_count, total_points, template_type, template_config, created_at')
        .single();
      if (error) return res.status(400).json({ error: error.message });
      await userClient.from('squad_members').insert({ squad_id: squad.id, user_id: auth.user.id, role: 'admin' });
      return res.status(201).json({ squad });
    }

    // GET /squads/leaderboard — top squads by total_points
    if (url === '/squads/leaderboard' && req.method === 'GET') {
      const { data } = await sb()
        .from('squads')
        .select('id, name, avatar_url, member_count, total_points')
        .eq('is_public', true)
        .order('total_points', { ascending: false })
        .limit(10);
      return res.status(200).json({ leaderboard: data || [] });
    }

    // POST /squads/checkin — squad check-in awards 20 pts
    if (url === '/squads/checkin' && req.method === 'POST') {
      const token = tokenFrom(req);
      const auth = await authUser(req);
      if (!auth) return res.status(401).json({ error: 'Unauthorized' });
      const { squad_id, event_id } = req.body || {};
      if (!squad_id) return res.status(400).json({ error: 'squad_id required' });
      const userClient = sbAs(token);
      const { data: membership } = await userClient
        .from('squad_members')
        .select('role')
        .eq('squad_id', squad_id)
        .eq('user_id', auth.user.id)
        .single();
      if (!membership) return res.status(403).json({ error: 'Not a squad member' });
      await userClient.from('squad_points').insert({ squad_id, user_id: auth.user.id, activity_type: 'squad_checkin', points: 20, event_id: event_id || null });
      await userClient.from('squad_activity').insert({ squad_id, user_id: auth.user.id, activity_type: 'squad_checkin', description: 'Squad check-in at event', data: event_id ? { event_id } : null });
      const { data: updated } = await sb().from('squads').select('total_points').eq('id', squad_id).single();
      return res.status(200).json({ ok: true, total_points: updated?.total_points });
    }

    // GET /squads/invites — pending invites for current user
    if (url === '/squads/invites' && req.method === 'GET') {
      const auth = await authUser(req);
      if (!auth) return res.status(401).json({ error: 'Unauthorized' });
      const { data: invites } = await sb()
        .from('squad_invites')
        .select('id, squad_id, inviter_id, status, created_at, squads(id, name, avatar_url), profiles!squad_invites_inviter_id_fkey(display_name, username, avatar_url)')
        .eq('invitee_id', auth.user.id)
        .eq('status', 'pending')
        .order('created_at', { ascending: false });
      return res.status(200).json({ invites: invites || [] });
    }

    const squadInviteActionMatch = url.match(/^\/squads\/invites\/([^/]+)\/(accept|reject)$/);

    // POST /squads/invites/:id/accept
    if (squadInviteActionMatch && squadInviteActionMatch[2] === 'accept' && req.method === 'POST') {
      const auth = await authUser(req);
      if (!auth) return res.status(401).json({ error: 'Unauthorized' });
      const inviteId = squadInviteActionMatch[1];
      const { data: invite } = await sb().from('squad_invites').select('id, squad_id, status').eq('id', inviteId).eq('invitee_id', auth.user.id).single();
      if (!invite) return res.status(404).json({ error: 'Invite not found' });
      if (invite.status !== 'pending') return res.status(400).json({ error: 'Invite already processed' });
      await sb().from('squad_invites').delete().eq('id', inviteId);
      const { error } = await sb().from('squad_members').insert({ squad_id: invite.squad_id, user_id: auth.user.id, role: 'member' });
      if (error && !error.message.includes('duplicate')) return res.status(400).json({ error: error.message });
      const { data: squad } = await sb().from('squads').select('member_count').eq('id', invite.squad_id).single();
      await sb().from('squads').update({ member_count: (squad?.member_count || 1) + 1 }).eq('id', invite.squad_id);
      return res.status(200).json({ ok: true });
    }

    // POST /squads/invites/:id/reject
    if (squadInviteActionMatch && squadInviteActionMatch[2] === 'reject' && req.method === 'POST') {
      const auth = await authUser(req);
      if (!auth) return res.status(401).json({ error: 'Unauthorized' });
      const inviteId = squadInviteActionMatch[1];
      await sb().from('squad_invites').delete().eq('id', inviteId).eq('invitee_id', auth.user.id);
      return res.status(200).json({ ok: true });
    }

    const squadPlanRsvpMatch = url.match(/^\/squads\/([^/]+)\/plans\/([^/]+)\/rsvp$/);
    const squadPlanDetailMatch = url.match(/^\/squads\/([^/]+)\/plans\/([^/]+)$/);
    const squadPlansMatch = url.match(/^\/squads\/([^/]+)\/plans$/);

    // POST /squads/:id/plans/:planId/rsvp
    if (squadPlanRsvpMatch && req.method === 'POST') {
      const token = tokenFrom(req);
      const auth = await authUser(req);
      if (!auth) return res.status(401).json({ error: 'Unauthorized' });
      const [, , planId] = squadPlanRsvpMatch;
      const { status: rsvpStatus } = req.body || {};
      if (!['going','maybe','not_going'].includes(rsvpStatus)) return res.status(400).json({ error: 'status must be going|maybe|not_going' });
      const { error } = await sbAs(token).from('squad_plan_rsvps').upsert({ plan_id: planId, user_id: auth.user.id, status: rsvpStatus }, { onConflict: 'plan_id,user_id' });
      if (error) return res.status(400).json({ error: error.message });
      return res.status(200).json({ ok: true });
    }

    // PATCH /squads/:id/plans/:planId — update plan (creator only)
    if (squadPlanDetailMatch && req.method === 'PATCH') {
      const token = tokenFrom(req);
      const auth = await authUser(req);
      if (!auth) return res.status(401).json({ error: 'Unauthorized' });
      const [, , planId] = squadPlanDetailMatch;
      const { title, notes, plan_date, plan_time, location_name, event_id } = req.body || {};
      const updates = {};
      if (title) updates.title = title.trim();
      if (notes !== undefined) updates.notes = notes;
      if (plan_date) updates.plan_date = plan_date;
      if (plan_time !== undefined) updates.plan_time = plan_time || null;
      if (location_name !== undefined) updates.location_name = location_name;
      if (event_id !== undefined) updates.event_id = event_id || null;
      const { error } = await sbAs(token).from('squad_plans').update(updates).eq('id', planId).eq('creator_id', auth.user.id);
      if (error) return res.status(400).json({ error: error.message });
      return res.status(200).json({ ok: true });
    }

    // DELETE /squads/:id/plans/:planId — delete plan (creator only)
    if (squadPlanDetailMatch && req.method === 'DELETE') {
      const token = tokenFrom(req);
      const auth = await authUser(req);
      if (!auth) return res.status(401).json({ error: 'Unauthorized' });
      const [, , planId] = squadPlanDetailMatch;
      const { error } = await sbAs(token).from('squad_plans').delete().eq('id', planId).eq('creator_id', auth.user.id);
      if (error) return res.status(400).json({ error: error.message });
      return res.status(200).json({ ok: true });
    }

    // GET /squads/:id/plans — list all plans with RSVPs
    if (squadPlansMatch && req.method === 'GET') {
      const auth = await authUser(req);
      if (!auth) return res.status(401).json({ error: 'Unauthorized' });
      const squadId = squadPlansMatch[1];
      const { data: membership } = await sb().from('squad_members').select('role').eq('squad_id', squadId).eq('user_id', auth.user.id).single();
      if (!membership) return res.status(403).json({ error: 'Not a squad member' });
      const { data: plans } = await sb()
        .from('squad_plans')
        .select('id, title, notes, plan_date, plan_time, location_name, event_id, creator_id, created_at, profiles!squad_plans_creator_id_fkey(display_name, avatar_url)')
        .eq('squad_id', squadId)
        .order('plan_date', { ascending: true });
      const planIds = (plans || []).map(p => p.id);
      let rsvpMap = {};
      if (planIds.length > 0) {
        const { data: rsvps } = await sb().from('squad_plan_rsvps').select('plan_id, user_id, status').in('plan_id', planIds);
        (rsvps || []).forEach(r => { if (!rsvpMap[r.plan_id]) rsvpMap[r.plan_id] = []; rsvpMap[r.plan_id].push(r); });
      }
      const result = (plans || []).map(p => ({ ...p, rsvps: rsvpMap[p.id] || [], my_rsvp: (rsvpMap[p.id] || []).find(r => r.user_id === auth.user.id)?.status || null }));
      return res.status(200).json({ plans: result });
    }

    // POST /squads/:id/plans — create a plan + notify members
    if (squadPlansMatch && req.method === 'POST') {
      const token = tokenFrom(req);
      const auth = await authUser(req);
      if (!auth) return res.status(401).json({ error: 'Unauthorized' });
      const squadId = squadPlansMatch[1];
      const { title, notes, plan_date, plan_time, location_name, event_id, outing_type, budget_per_person } = req.body || {};
      if (!title?.trim() || !plan_date) return res.status(400).json({ error: 'title and plan_date are required' });
      const { data: membership } = await sb().from('squad_members').select('role').eq('squad_id', squadId).eq('user_id', auth.user.id).single();
      if (!membership) return res.status(403).json({ error: 'Not a squad member' });
      const { data: plan, error } = await sbAs(token).from('squad_plans')
        .insert({ squad_id: squadId, creator_id: auth.user.id, title: title.trim(), notes: notes || null, plan_date, plan_time: plan_time || null, location_name: location_name || null, event_id: event_id || null, outing_type: outing_type || 'general', budget_per_person: budget_per_person ? parseInt(budget_per_person) : null })
        .select('id, title, plan_date').single();
      if (error) return res.status(400).json({ error: error.message });
      const { data: members } = await sb().from('squad_members').select('user_id').eq('squad_id', squadId).neq('user_id', auth.user.id);
      const { data: planner } = await sb().from('profiles').select('display_name').eq('id', auth.user.id).single();
      const plannerName = planner?.display_name || 'Someone';
      const dateStr = new Date(plan_date + 'T00:00:00').toLocaleDateString('en-ZA', { month: 'short', day: 'numeric' });
      if (members && members.length > 0) {
        const notifs = members.map(m => ({ user_id: m.user_id, type: 'squad_plan', from_user_id: auth.user.id, from_display_name: plannerName, entity_id: plan.id, entity_type: 'squad_plan', message: `${plannerName} planned "${title.trim()}" for ${dateStr}`, data: { squad_id: squadId, plan_id: plan.id } }));
        await sb().from('notifications').insert(notifs);
      }
      return res.status(201).json({ plan });
    }

    const squadDetailMatch = url.match(/^\/squads\/([^/]+)$/);
    const squadActionMatch = url.match(/^\/squads\/([^/]+)\/(join|leave|invite)$/);

    // POST /squads/:id/join
    if (squadActionMatch && squadActionMatch[2] === 'join' && req.method === 'POST') {
      const token = tokenFrom(req);
      const auth = await authUser(req);
      if (!auth) return res.status(401).json({ error: 'Unauthorized' });
      const squadId = squadActionMatch[1];
      const { data: squad } = await sb().from('squads').select('id, is_public, member_count').eq('id', squadId).single();
      if (!squad) return res.status(404).json({ error: 'Squad not found' });
      if (!squad.is_public) return res.status(403).json({ error: 'Squad is private' });
      const { error } = await sbAs(token).from('squad_members').insert({ squad_id: squadId, user_id: auth.user.id, role: 'member' });
      if (error) return res.status(400).json({ error: error.message });
      await sb().from('squads').update({ member_count: squad.member_count + 1 }).eq('id', squadId);
      return res.status(200).json({ ok: true });
    }

    // POST /squads/:id/leave
    if (squadActionMatch && squadActionMatch[2] === 'leave' && req.method === 'POST') {
      const token = tokenFrom(req);
      const auth = await authUser(req);
      if (!auth) return res.status(401).json({ error: 'Unauthorized' });
      const squadId = squadActionMatch[1];
      const { data: squad } = await sb().from('squads').select('id, member_count, creator_id').eq('id', squadId).single();
      if (!squad) return res.status(404).json({ error: 'Squad not found' });
      await sbAs(token).from('squad_members').delete().eq('squad_id', squadId).eq('user_id', auth.user.id);
      const newCount = Math.max(0, squad.member_count - 1);
      if (newCount === 0) {
        await sb().from('squads').delete().eq('id', squadId);
      } else {
        await sb().from('squads').update({ member_count: newCount }).eq('id', squadId);
        if (squad.creator_id === auth.user.id) {
          const { data: nextAdmin } = await sb().from('squad_members').select('user_id').eq('squad_id', squadId).limit(1).single();
          if (nextAdmin) await sb().from('squad_members').update({ role: 'admin' }).eq('squad_id', squadId).eq('user_id', nextAdmin.user_id);
        }
      }
      return res.status(200).json({ ok: true });
    }

    // POST /squads/:id/invite — send invite (pending, notifies invitee)
    if (squadActionMatch && squadActionMatch[2] === 'invite' && req.method === 'POST') {
      const token = tokenFrom(req);
      const auth = await authUser(req);
      if (!auth) return res.status(401).json({ error: 'Unauthorized' });
      const squadId = squadActionMatch[1];
      const { user_id: inviteeId } = req.body || {};
      if (!inviteeId) return res.status(400).json({ error: 'user_id required' });
      const { data: membership } = await sb().from('squad_members').select('role').eq('squad_id', squadId).eq('user_id', auth.user.id).single();
      if (!membership) return res.status(403).json({ error: 'Not a squad member' });
      const { data: alreadyMember } = await sb().from('squad_members').select('user_id').eq('squad_id', squadId).eq('user_id', inviteeId).single();
      if (alreadyMember) return res.status(400).json({ error: 'User is already a member' });
      const { data: pendingInvite } = await sb().from('squad_invites').select('id').eq('squad_id', squadId).eq('invitee_id', inviteeId).eq('status', 'pending').maybeSingle();
      if (pendingInvite) return res.status(200).json({ ok: true, status: 'already_invited' });
      const { error } = await sb().from('squad_invites').insert({ squad_id: squadId, inviter_id: auth.user.id, invitee_id: inviteeId, status: 'pending' });
      if (error) return res.status(400).json({ error: error.message });
      const [{ data: squad }, { data: inviter }] = await Promise.all([
        sb().from('squads').select('name').eq('id', squadId).single(),
        sb().from('profiles').select('display_name').eq('id', auth.user.id).single()
      ]);
      await sb().from('notifications').insert({ user_id: inviteeId, type: 'squad_invite', from_user_id: auth.user.id, from_display_name: inviter?.display_name || 'Someone', entity_id: squadId, entity_type: 'squad', message: `${inviter?.display_name || 'Someone'} invited you to join ${squad?.name || 'a squad'}`, data: { squad_id: squadId } });
      await sbAs(token).from('squad_points').insert({ squad_id: squadId, user_id: auth.user.id, activity_type: 'invite', points: 5 }).catch(() => {});
      return res.status(200).json({ ok: true });
    }

    // PATCH /squads/:id — update squad config (admin only)
    if (squadDetailMatch && req.method === 'PATCH') {
      const auth = await authUser(req);
      if (!auth) return res.status(401).json({ error: 'Unauthorized' });
      const squadId = squadDetailMatch[1];
      const { data: membership } = await sb().from('squad_members').select('role').eq('squad_id', squadId).eq('user_id', auth.user.id).single();
      if (!membership || membership.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
      const { name, description, is_public, template_config } = req.body || {};
      const updates = {};
      if (name) updates.name = name.trim();
      if (description !== undefined) updates.description = description;
      if (is_public !== undefined) updates.is_public = is_public;
      if (template_config) updates.template_config = template_config;
      const { error } = await sb().from('squads').update(updates).eq('id', squadId);
      if (error) return res.status(400).json({ error: error.message });
      return res.status(200).json({ ok: true });
    }

    // GET /squads/:id/public — unauthenticated preview for invite landing page
    if (squadDetailMatch && url.endsWith('/public') && req.method === 'GET') {
      const { data } = await sb().from('squads')
        .select('id, name, avatar_url, member_count, is_public')
        .eq('id', squadDetailMatch[1]).single();
      return res.status(data ? 200 : 404).json(data || { error: 'Not found' });
    }

    // GET /squads/:id — squad detail with per-member points
    if (squadDetailMatch && req.method === 'GET') {
      const auth = await authUser(req);
      const squadId = squadDetailMatch[1];
      const { data: squad } = await sb().from('squads').select('id, name, description, avatar_url, is_public, member_count, total_points, template_type, template_config, creator_id, created_at').eq('id', squadId).single();
      if (!squad) return res.status(404).json({ error: 'Squad not found' });
      const [{ data: members }, { data: memberCheck }, { data: allPoints }] = await Promise.all([
        sb().from('squad_members').select('user_id, role, joined_at, profiles(id, display_name, username, avatar_url)').eq('squad_id', squadId),
        auth ? sb().from('squad_members').select('user_id').eq('squad_id', squadId).eq('user_id', auth.user.id).maybeSingle() : Promise.resolve({ data: null }),
        sb().from('squad_points').select('user_id, points').eq('squad_id', squadId),
      ]);
      const { data: activity } = await sb().from('squad_activity').select('id, activity_type, description, created_at, profiles(display_name, avatar_url)').eq('squad_id', squadId).order('created_at', { ascending: false }).limit(10);
      const memberPoints = {};
      (allPoints || []).forEach(p => { memberPoints[p.user_id] = (memberPoints[p.user_id] || 0) + p.points; });
      const isMember = !!memberCheck;
      return res.status(200).json({ squad, members: members || [], activity: activity || [], isMember, memberPoints });
    }

    /* ─── GET /admin/activity-log ───────────────────────── */
    if (url === '/admin/activity-log' && req.method === 'GET') {
      const auth = await authUser(req);
      if (!auth || auth.profile.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
      const limit = Math.min(parseInt(q.limit) || 100, 500);
      const { data, error } = await sb().from('admin_activity_log')
        .select('*').order('created_at', { ascending: false }).limit(limit);
      if (error) return res.status(400).json({ error: error.message });
      return res.status(200).json({ log: data || [] });
    }

    /* ─── GET /admin/user-notifications/:userId ─────────── */
    const adminUserNotifsMatch = url.match(/^\/admin\/user-notifications\/([^/]+)$/);
    if (adminUserNotifsMatch && req.method === 'GET') {
      const auth = await authUser(req);
      if (!auth || auth.profile.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
      const targetUserId = adminUserNotifsMatch[1];
      const { data, error } = await sb().from('notifications')
        .select('id,type,title,message,body,read,created_at,from_display_name,entity_type,entity_id')
        .eq('user_id', targetUserId)
        .order('created_at', { ascending: false }).limit(50);
      if (error) return res.status(400).json({ error: error.message });
      return res.status(200).json({ notifications: data || [] });
    }

    /* ─── GET /health ────────────────────────────────────── */
    if (url === '/health' && req.method === 'GET') {
      return res.status(200).json({ ok: true, ts: Date.now(), url: SUPA_URL });
    }

    /* ─── PATCH /profile/socials ──────────────────────────── */
    if (url === '/profile/socials' && req.method === 'PATCH') {
      const auth = await authUser(req);
      if (!auth) return res.status(401).json({ error: 'Unauthorized' });
      const { social_links } = req.body || {};
      if (!social_links || typeof social_links !== 'object') return res.status(400).json({ error: 'social_links object required' });
      const allowed = ['whatsapp','instagram','tiktok','facebook','x'];
      const clean = {};
      for (const k of allowed) clean[k] = (social_links[k] || '').trim().slice(0, 500);
      const { data, error } = await sb().from('profiles').update({ social_links: clean }).eq('id', auth.user.id).select('social_links').single();
      if (error) return res.status(400).json({ error: error.message });
      return res.status(200).json({ social_links: data.social_links });
    }

    /* ─── GET /admin/app-settings ─────────────────────────── */
    if (url === '/admin/app-settings' && req.method === 'GET') {
      const auth = await authUser(req);
      if (!auth || auth.profile.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
      const { data } = await sb().from('app_settings').select('*');
      const settings = Object.fromEntries((data || []).map(r => [r.key, r.value]));
      return res.status(200).json({ settings });
    }

    /* ─── PATCH /admin/app-settings ───────────────────────── */
    if (url === '/admin/app-settings' && req.method === 'PATCH') {
      const auth = await authUser(req);
      if (!auth || auth.profile.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
      const { key, value } = req.body || {};
      if (!key || value === undefined) return res.status(400).json({ error: 'key and value required' });
      const { data, error } = await sb().from('app_settings')
        .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' })
        .select().single();
      if (error) return res.status(400).json({ error: error.message });
      return res.status(200).json({ setting: data });
    }

    /* ─── GET /config ─────────────────────────────────────── */
    if (url === '/config' && req.method === 'GET') {
      return res.status(200).json({
        paystackPublicKey: process.env.PAYSTACK_PUBLIC_KEY || '',
        appName: 'Pulsefy',
      });
    }

    /* ─── POST /payments/initiate ─────────────────────────── */
    if (url === '/payments/initiate' && req.method === 'POST') {
      const auth = await authUser(req);
      if (!auth) return res.status(401).json({ error: 'Unauthorized' });
      const { user, profile } = auth;
      const { type, entity_id, amount, email } = req.body || {};
      if (!type || !amount || !email) return res.status(400).json({ error: 'type, amount, and email required' });
      if (!['ticket','subscription_organizer','subscription_business','promotion'].includes(type))
        return res.status(400).json({ error: 'Invalid payment type' });
      if (!Number.isInteger(amount) || amount < 1) return res.status(400).json({ error: 'amount must be a positive integer in cents' });

      const psRes = await fetch('https://api.paystack.co/transaction/initialize', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${process.env.PAYSTACK_SECRET_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, amount, currency: 'ZAR', metadata: { user_id: user.id, type, entity_id: entity_id || null, display_name: profile.display_name } }),
      });
      if (!psRes.ok) { const b = await psRes.json().catch(() => ({})); return res.status(502).json({ error: b.message || 'Paystack error' }); }
      const psData = await psRes.json();
      if (!psData.status) return res.status(502).json({ error: psData.message || 'Paystack error' });

      const { reference, authorization_url } = psData.data;
      const { error: dbErr } = await sb().from('payments').insert({
        user_id: user.id, reference, amount, currency: 'ZAR', type,
        entity_id: entity_id || null, status: 'pending', metadata: { email },
      });
      if (dbErr) return res.status(400).json({ error: dbErr.message });
      return res.status(200).json({ reference, authorization_url });
    }

    /* ─── GET /payments/verify ────────────────────────────── */
    if (url === '/payments/verify' && req.method === 'GET') {
      const auth = await authUser(req);
      if (!auth) return res.status(401).json({ error: 'Unauthorized' });
      const { user, profile } = auth;
      const ref = q.ref || '';
      if (!ref) return res.status(400).json({ error: 'ref query parameter required' });

      const { data: payment } = await sb().from('payments').select('*').eq('reference', ref).eq('user_id', user.id).single();
      if (!payment) return res.status(404).json({ error: 'Payment not found' });
      if (payment.status === 'success') return res.status(200).json({ success: true, payment });

      const psRes = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(ref)}`, {
        headers: { 'Authorization': `Bearer ${process.env.PAYSTACK_SECRET_KEY}` },
      });
      if (!psRes.ok) { const b = await psRes.json().catch(() => ({})); return res.status(502).json({ error: b.message || 'Paystack verify error' }); }
      const psData = await psRes.json();
      const newStatus = psData.data?.status === 'success' ? 'success' : 'failed';
      const now = new Date().toISOString();

      const { data: updated } = await sb().from('payments')
        .update({ status: newStatus, completed_at: now, metadata: { ...payment.metadata, paystack: psData.data } })
        .eq('id', payment.id).select().single();

      if (newStatus === 'success') {
        if (['subscription_organizer','subscription_business'].includes(payment.type)) {
          await sb().from('profiles').update({ subscription_type: 'premium' }).eq('id', user.id);
        }
        await sb().from('notifications').insert({
          user_id: user.id, type: 'payment', from_user_id: user.id, from_display_name: 'Pulsefy',
          entity_id: payment.id, entity_type: 'payment',
          message: `Payment of R${(payment.amount / 100).toFixed(2)} confirmed ✅`,
        });
        await logAdminAction(user.id, profile.display_name || user.email, 'payment_success', payment.id,
          `${payment.type} — R${(payment.amount / 100).toFixed(2)}`, { reference: ref });
        const userEmail = profile.email || user.email;
        if (userEmail) sendPaymentConfirmEmail(userEmail, profile.display_name, payment.amount, payment.type).catch(() => {});
      }
      return res.status(200).json({ success: newStatus === 'success', payment: updated });
    }

    /* ─── POST /payments/webhook ──────────────────────────── */
    if (url === '/payments/webhook' && req.method === 'POST') {
      const sig  = req.headers['x-paystack-signature'] || '';
      const hash = crypto.createHmac('sha512', process.env.PAYSTACK_SECRET_KEY || '')
        .update(JSON.stringify(req.body)).digest('hex');
      if (sig !== hash) return res.status(401).json({ error: 'Invalid signature' });
      res.status(200).json({ received: true });

      if (req.body?.event === 'charge.success') {
        const ref  = req.body.data?.reference;
        const meta = req.body.data?.metadata || {};
        if (!ref) return;
        const { data: payment } = await sb().from('payments').select('*').eq('reference', ref).maybeSingle();
        if (!payment || payment.status === 'success') return;
        const now = new Date().toISOString();
        await sb().from('payments').update({
          status: 'success', completed_at: now, metadata: { ...payment.metadata, paystack: req.body.data },
        }).eq('id', payment.id);

        if (['subscription_organizer','subscription_business'].includes(payment.type)) {
          await sb().from('profiles').update({ subscription_type: 'premium' }).eq('id', payment.user_id);
        }
        await sb().from('notifications').insert({
          user_id: payment.user_id, type: 'payment', from_user_id: payment.user_id, from_display_name: 'Pulsefy',
          entity_id: payment.id, entity_type: 'payment',
          message: `Payment of R${(payment.amount / 100).toFixed(2)} confirmed ✅`,
        });
        await logAdminAction(payment.user_id, meta.display_name || 'User', 'payment_success', payment.id,
          `${payment.type} — R${(payment.amount / 100).toFixed(2)}`, { reference: ref });
        const { data: prof } = await sb().from('profiles').select('email,display_name').eq('id', payment.user_id).single();
        if (prof?.email) sendPaymentConfirmEmail(prof.email, prof.display_name, payment.amount, payment.type).catch(() => {});
      }
      return;
    }

    /* ─── GET /businesses/:id/menu ──────────────────────── */
    const menuBizId = url.match(/^\/businesses\/([^/]+)\/menu$/)?.[1];
    if (menuBizId && req.method === 'GET') {
      const { data, error } = await sb().from('menu_items').select('*').eq('business_id', menuBizId).eq('is_available', true).order('category').order('sort_order');
      if (error) return res.status(400).json({ error: error.message });
      return res.status(200).json({ items: data || [] });
    }

    /* ─── POST /pickup-orders ────────────────────────────── */
    if (url === '/pickup-orders' && req.method === 'POST') {
      const { business_id, customer_name, customer_phone, items, notes, pickup_time, total } = req.body || {};
      if (!business_id || !customer_name || !customer_phone || !items?.length)
        return res.status(400).json({ error: 'business_id, customer_name, customer_phone, items required' });
      const order_ref = `ORD-${Date.now()}-${Math.random().toString(36).slice(2, 5).toUpperCase()}`;
      // capture user_id if the caller is authenticated
      let placing_user_id = null;
      const placingToken = tokenFrom(req);
      if (placingToken) {
        try {
          const { data: { user } } = await createClient(SUPA_URL, SUPA_ANON).auth.getUser(placingToken);
          if (user) placing_user_id = user.id;
        } catch(_) {}
      }
      const { data: order, error: oErr } = await sb().from('pickup_orders').insert({
        order_ref, business_id, customer_name, customer_phone,
        items, notes: notes || null, pickup_time: pickup_time || null,
        total: +total || 0, status: 'pending',
        ...(placing_user_id ? { user_id: placing_user_id } : {}),
      }).select().single();
      if (oErr) return res.status(400).json({ error: oErr.message });
      const { data: biz } = await sb().from('businesses').select('owner_id,name').eq('id', business_id).maybeSingle();
      if (biz?.owner_id) {
        await sb().from('notifications').insert({
          user_id: biz.owner_id, type: 'order',
          from_display_name: customer_name,
          entity_id: order.id, entity_type: 'pickup_order',
          message: `${customer_name} placed a pickup order — R${(+total || 0).toFixed(2)} · Ref: ${order_ref}`,
        }).catch(() => {});
      }
      return res.status(200).json({ success: true, order_ref, order_id: order.id });
    }

    /* ─── GET /pickup-order-status/:ref ─────────────────── */
    const orderStatusRef = url.match(/^\/pickup-order-status\/([^/]+)$/)?.[1];
    if (orderStatusRef && req.method === 'GET') {
      const { data, error } = await sb().from('pickup_orders')
        .select('order_ref,status,customer_name,items,total,pickup_time,created_at,business_id')
        .eq('order_ref', orderStatusRef).maybeSingle();
      if (error || !data) return res.status(404).json({ error: 'Order not found' });
      const { data: biz } = await sb().from('businesses').select('name').eq('id', data.business_id).maybeSingle();
      return res.status(200).json({ ...data, business_name: biz?.name || '' });
    }

    /* ─── GET /user/pickup-orders ────────────────────────── */
    if (url === '/user/pickup-orders' && req.method === 'GET') {
      const token = tokenFrom(req);
      if (!token) return res.status(401).json({ error: 'Unauthorised' });
      const { data: { user } } = await createClient(SUPA_URL, SUPA_ANON).auth.getUser(token);
      if (!user) return res.status(401).json({ error: 'Unauthorised' });
      const { data: orders, error } = await sb().from('pickup_orders')
        .select('order_ref,status,items,total,pickup_time,created_at,business_id')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(30);
      if (error) return res.status(400).json({ error: error.message });
      // attach business names in one shot
      const bizIds = [...new Set((orders || []).map(o => o.business_id).filter(Boolean))];
      let bizMap = {};
      if (bizIds.length) {
        const { data: bizRows } = await sb().from('businesses').select('id,name').in('id', bizIds);
        (bizRows || []).forEach(b => { bizMap[b.id] = b.name; });
      }
      return res.status(200).json({ orders: (orders || []).map(o => ({ ...o, business_name: bizMap[o.business_id] || '' })) });
    }

    /* ─── GET /squad-promos ──────────────────────────────── */
    if (url === '/squad-promos' && req.method === 'GET') {
      const city = (q.city || '').toLowerCase();
      const { data, error } = await sb().from('squad_promos')
        .select('*').eq('approved', true).eq('is_active', true)
        .order('created_at', { ascending: false });
      if (error) return res.status(400).json({ error: error.message });
      const promos = city
        ? (data || []).filter(p => !p.location_city || p.location_city.toLowerCase().includes(city) || city.includes(p.location_city.toLowerCase()))
        : (data || []);
      return res.status(200).json({ promos });
    }

    /* ─── POST /squad-promos ─────────────────────────────── */
    if (url === '/squad-promos' && req.method === 'POST') {
      const token = tokenFrom(req);
      const auth = await authUser(req);
      if (!auth) return res.status(401).json({ error: 'Unauthorized' });
      const { role } = auth.profile;
      if (!['organizer','business','admin'].includes(role))
        return res.status(403).json({ error: 'Organizer or business account required' });
      const { title, description, deal_type, venue_name, location_city,
              squad_min, squad_max, total_price, valid_days,
              valid_from, valid_to, image_url } = req.body || {};
      if (!title || !venue_name) return res.status(400).json({ error: 'title and venue_name are required' });
      const { data: promo, error } = await sbAs(token).from('squad_promos').insert({
        title, description: description || null,
        deal_type: deal_type || 'food', venue_name,
        location_city: location_city || null,
        squad_min: parseInt(squad_min) || 2, squad_max: parseInt(squad_max) || 10,
        total_price: total_price ? parseFloat(total_price) : null,
        valid_days: valid_days || null,
        valid_from: valid_from || null, valid_to: valid_to || null,
        image_url: image_url || null,
        owner_id: auth.user.id, owner_role: role,
        approved: role === 'admin',
      }).select().single();
      if (error) return res.status(400).json({ error: error.message });
      return res.status(201).json({ promo });
    }

    /* ─── GET /squad-promos/mine ─────────────────────────── */
    if (url === '/squad-promos/mine' && req.method === 'GET') {
      const auth = await authUser(req);
      if (!auth) return res.status(401).json({ error: 'Unauthorized' });
      const { data, error } = await sb().from('squad_promos')
        .select('*').eq('owner_id', auth.user.id)
        .order('created_at', { ascending: false });
      if (error) return res.status(400).json({ error: error.message });
      return res.status(200).json({ promos: data || [] });
    }

    /* ─── PATCH /squad-promos/:id/approve|reject ─────────── */
    const sqPromoAction = url.match(/^\/squad-promos\/([^/]+)\/(approve|reject)$/);
    if (sqPromoAction && req.method === 'PATCH') {
      const auth = await authUser(req);
      if (!auth || auth.profile.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
      const [, promoId, action] = sqPromoAction;
      const updates = action === 'approve'
        ? { approved: true, rejected: false }
        : { approved: false, rejected: true, reject_reason: req.body?.reason || null };
      const { data, error } = await sb().from('squad_promos').update(updates).eq('id', promoId).select().single();
      if (error) return res.status(400).json({ error: error.message });
      return res.status(200).json({ promo: data });
    }

    /* ─── POST /claim-profile ─────────────────────────────── */
    if (url === '/claim-profile' && req.method === 'POST') {
      const { business_id, business_name, claimant_name, claimant_email, claimant_phone, reason } = req.body || {};
      if (!claimant_name || !claimant_email || !claimant_phone || !reason || !business_name)
        return res.status(400).json({ error: 'All fields are required' });
      const { data, error } = await sb().from('profile_claims').insert({
        business_id: business_id || null,
        business_name,
        claimant_name,
        claimant_email,
        claimant_phone,
        reason,
      }).select().single();
      if (error) return res.status(400).json({ error: error.message });
      // Notify all admins
      const { data: admins } = await sb().from('profiles').select('id').eq('role', 'admin');
      for (const admin of admins || []) {
        await sb().from('notifications').insert({
          user_id: admin.id, type: 'system',
          from_display_name: 'Pulsefy System',
          message: `New profile claim submitted for "${business_name}" by ${claimant_name} (${claimant_email}).`,
          entity_type: 'claim', entity_id: data.id,
          read: false,
        }).catch(() => {});
      }
      return res.status(201).json({ success: true, claim_id: data.id });
    }

    /* ─── GET /admin/claims ──────────────────────────────── */
    if (url === '/admin/claims' && req.method === 'GET') {
      const auth = await authUser(req);
      if (!auth || auth.profile.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
      const filter = req.query?.filter || 'all';
      let q = sb().from('profile_claims').select('*').order('created_at', { ascending: false });
      if (filter !== 'all') q = q.eq('status', filter);
      const { data, error } = await q;
      if (error) return res.status(400).json({ error: error.message });
      return res.status(200).json({ claims: data || [] });
    }

    /* ─── PATCH /admin/claims/:id ────────────────────────── */
    const claimMatch = url.match(/^\/admin\/claims\/([^/]+)$/);
    if (claimMatch && req.method === 'PATCH') {
      const auth = await authUser(req);
      if (!auth || auth.profile.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
      const { status, admin_notes } = req.body || {};
      const { data, error } = await sb().from('profile_claims').update({ status, admin_notes }).eq('id', claimMatch[1]).select().single();
      if (error) return res.status(400).json({ error: error.message });
      return res.status(200).json({ claim: data });
    }

    /* ─── POST /location-request ─────────────────────────── */
    if (url === '/location-request' && req.method === 'POST') {
      const auth = await authUser(req);
      if (!auth) return res.status(401).json({ error: 'Unauthorized' });
      const { entity_type, entity_id, entity_name, lat, lon } = req.body || {};
      if (!entity_type || !entity_id || lat == null || lon == null)
        return res.status(400).json({ error: 'entity_type, entity_id, lat, lon required' });
      const latN = parseFloat(lat), lonN = parseFloat(lon);
      if (latN < -35 || latN > -22 || lonN < 16 || lonN > 33)
        return res.status(400).json({ error: 'Coordinates must be within South Africa (lat −35 to −22, lon 16 to 33)' });
      // Cancel any existing pending request for this entity so there's only one at a time
      await sb().from('location_requests')
        .update({ status: 'rejected', notes: 'Superseded by new request' })
        .eq('entity_id', entity_id).eq('entity_type', entity_type).eq('status', 'pending');
      const { data, error } = await sb().from('location_requests')
        .insert({ entity_type, entity_id, entity_name: entity_name || null, user_id: auth.user.id, lat: latN, lon: lonN })
        .select().single();
      if (error) return res.status(400).json({ error: error.message });
      return res.status(200).json({ request: data });
    }

    /* ─── GET /admin/location-requests ───────────────────── */
    if (url.startsWith('/admin/location-requests') && req.method === 'GET') {
      const auth = await authUser(req);
      if (!auth || auth.profile.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
      const qs = url.includes('?') ? url.split('?')[1] : '';
      const status = new URLSearchParams(qs).get('status') || 'pending';
      let q = sb().from('location_requests').select('*').order('created_at', { ascending: false }).limit(100);
      if (status !== 'all') q = q.eq('status', status);
      const { data, error } = await q;
      if (error) return res.status(400).json({ error: error.message });
      return res.status(200).json({ requests: data || [] });
    }

    /* ─── PATCH /admin/location-requests/:id ─────────────── */
    const locReqMatch = url.match(/^\/admin\/location-requests\/([^/]+)$/);
    if (locReqMatch && req.method === 'PATCH') {
      const auth = await authUser(req);
      if (!auth || auth.profile.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
      const { status, notes } = req.body || {};
      if (!['approved','rejected'].includes(status)) return res.status(400).json({ error: 'status must be approved or rejected' });
      const { data: lr } = await sb().from('location_requests').select('*').eq('id', locReqMatch[1]).single();
      if (!lr) return res.status(404).json({ error: 'Not found' });
      await sb().from('location_requests')
        .update({ status, notes: notes || null, reviewed_at: new Date().toISOString() })
        .eq('id', locReqMatch[1]);
      if (status === 'approved') {
        if (lr.entity_type === 'business')
          await sb().from('businesses').update({ lat: lr.lat, lon: lr.lon }).eq('id', lr.entity_id);
        else if (lr.entity_type === 'event')
          await sb().from('events').update({ venue_lat: lr.lat, venue_lon: lr.lon }).eq('id', lr.entity_id);
      }
      return res.status(200).json({ success: true });
    }

    /* ─── GET /geocode?venue=&city= ─────────────────────────── */
    if (url === '/geocode' && req.method === 'GET') {
      const venue = (q.venue || '').trim();
      const city  = (q.city  || '').trim();
      if (!venue && !city) return res.status(400).json({ error: 'venue or city required' });

      const MAPBOX_TOKEN = process.env.MAPBOX_TOKEN || 'pk.eyJ1IjoidGhhY29sbGluMiIsImEiOiJjbW51Mm95cHEwYm8xMnJyMXEzaXgxMDBmIn0.nF80wBOn-jxhjpAIus9anw';
      const q2 = encodeURIComponent([venue, city, 'South Africa'].filter(Boolean).join(', '));
      const mbUrl = `https://api.mapbox.com/geocoding/v5/mapbox.places/${q2}.json?access_token=${MAPBOX_TOKEN}&country=za&types=poi,address,place&limit=1`;

      const https = require('https');
      const result = await new Promise((resolve) => {
        https.get(mbUrl, (r) => {
          let d = '';
          r.on('data', c => d += c);
          r.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve(null); } });
        }).on('error', () => resolve(null));
      });

      const feat = result?.features?.[0];
      if (!feat) return res.status(200).json({ lat: null, lon: null });

      const [lon, lat] = feat.center;
      if (lat < -35 || lat > -22 || lon < 16 || lon > 33) {
        return res.status(200).json({ lat: null, lon: null });
      }
      return res.status(200).json({ lat, lon, place_name: feat.place_name, confidence: 80 });
    }

    return res.status(404).json({ error: `Route not found: ${req.method} ${url}` });

  } catch (err) {
    console.error('[Pulsify API]', err.message);
    captureError(err, { url: req.url });
    return res.status(500).json({ error: 'Server error', detail: err.message });
  }
};
