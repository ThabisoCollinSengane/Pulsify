const { sb, corsHeaders, haverBox, rateLimited, authUser, captureError } = require('../shared');

module.exports = async (req, res) => {
  Object.entries(corsHeaders(req)).forEach(([k, v]) => res.setHeader(k, v));
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (rateLimited(req, res, { limit: 120, windowMs: 60000 })) return;

  const url   = (req.url || '/').split('?')[0].replace(/^\/api/, '') || '/';
  const q     = Object.fromEntries(new URL(req.url, 'http://x').searchParams);
  const today = new Date().toISOString().split('T')[0];

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
      const to_date   = q.to_date   || '';

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

      if (to_date)                 query = query.lte('date_local', to_date);
      if (city && city !== 'all')  query = query.ilike('venue_city', `%${city}%`);
      if (genre === 'free')        query = query.eq('is_free', true);
      else if (genre && genre !== 'all') {
        const genres = genre.split(',').map(g => g.trim()).filter(Boolean);
        if (genres.length > 1) query = query.or(genres.map(g => `genre.ilike.%${g}%`).join(','));
        else if (genres.length === 1) query = query.ilike('genre', `%${genres[0]}%`);
      }
      if (search) query = query.textSearch('id', search, { type: 'websearch', config: 'english' });
      if (q.bounds) {
        const [bw, bs, be, bn] = q.bounds.split(',').map(parseFloat);
        if (!isNaN(bw) && !isNaN(bs) && !isNaN(be) && !isNaN(bn)) {
          query = query
            .gte('venue_lat', bs).lte('venue_lat', bn)
            .gte('venue_lon', bw).lte('venue_lon', be);
        }
      } else if (lat && lon) {
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

    /* ─── POST /events (organizer creates event) ─────────── */
    if (url === '/events' && req.method === 'POST') {
      const auth = await authUser(req);
      if (!auth) return res.status(401).json({ error: 'Unauthorized' });
      if (auth.profile.role !== 'organizer') return res.status(403).json({ error: 'Organizer role required' });

      const b = req.body || {};
      const name = (b.name || '').trim();
      const date_local = (b.date_local || '').trim();
      const venue_name = (b.venue_name || '').trim();
      const venue_city = (b.venue_city || '').trim();
      if (!name || !date_local || !venue_name || !venue_city) {
        return res.status(400).json({ error: 'name, date_local, venue_name and venue_city are required' });
      }

      let venue_lat = b.venue_lat != null ? parseFloat(b.venue_lat) : null;
      let venue_lon = b.venue_lon != null ? parseFloat(b.venue_lon) : null;
      if (venue_lat != null && (isNaN(venue_lat) || venue_lat < -35 || venue_lat > -22)) venue_lat = null;
      if (venue_lon != null && (isNaN(venue_lon) || venue_lon < 16 || venue_lon > 33)) venue_lon = null;
      if (venue_lat == null || venue_lon == null) { venue_lat = null; venue_lon = null; }

      const tiers = Array.isArray(b.tiers) && b.tiers.length
        ? b.tiers.map((t, i) => ({
            name: (t.name || 'General Admission').trim(),
            price: Math.max(0, parseFloat(t.price) || 0),
            capacity: (Number.isFinite(parseInt(t.capacity, 10)) && parseInt(t.capacity, 10) > 0) ? parseInt(t.capacity, 10) : null,
            sort_order: i,
          }))
        : [{ name: 'General Admission', price: 0, capacity: null, sort_order: 0 }];

      const price_min = Math.min(...tiers.map(t => t.price));
      const price_max = Math.max(...tiers.map(t => t.price));
      const is_free = tiers.every(t => t.price === 0);

      // approved is decided server-side from the organizer's subscription — never trust the client for this.
      const approved = auth.profile.subscription_type === 'premium' || auth.profile.subscription_type === 'trial';

      const eventId = 'org_' + auth.user.id.slice(0, 8) + '_' + Date.now();

      const { error } = await sb().from('events').insert({
        id: eventId,
        name,
        date_local,
        time_local: b.time_local || null,
        venue_name,
        venue_city,
        venue_province: b.venue_province || null,
        image_url: b.image_url || null,
        genre: b.genre || 'other',
        description: b.description || null,
        price_min, price_max, is_free,
        organiser_name: auth.profile.display_name || auth.user.email?.split('@')[0],
        organiser_id: auth.user.id,
        is_active: true,
        source: 'organizer',
        venue_lat, venue_lon,
        location_confidence: b.location_confidence || (venue_lat ? 80 : 0),
        approved,
      });
      if (error) return res.status(400).json({ error: error.message });

      const tierRows = tiers.map(t => ({ event_id: eventId, name: t.name, price: t.price, capacity: t.capacity, sort_order: t.sort_order }));
      const { error: tierErr } = await sb().from('ticket_tiers').insert(tierRows);

      return res.status(200).json({ id: eventId, approved, tier_error: tierErr ? tierErr.message : null });
    }

    /* ─── PATCH /events/:id (organizer edits own event) ──── */
    const editEvId = url.match(/^\/events\/([^/]+)$/)?.[1];
    if (editEvId && req.method === 'PATCH') {
      const auth = await authUser(req);
      if (!auth) return res.status(401).json({ error: 'Unauthorized' });

      const { data: existing } = await sb().from('events').select('organiser_id').eq('id', editEvId).single();
      if (!existing) return res.status(404).json({ error: 'Event not found' });
      if (existing.organiser_id !== auth.user.id) return res.status(403).json({ error: 'Not your event' });

      const b = req.body || {};
      const patch = {};
      const allowed = ['name', 'date_local', 'time_local', 'venue_name', 'venue_city', 'venue_province', 'image_url', 'genre', 'description'];
      for (const k of allowed) if (b[k] !== undefined) patch[k] = b[k] || null;
      if (b.venue_lat != null && b.venue_lon != null) {
        const lat = parseFloat(b.venue_lat), lon = parseFloat(b.venue_lon);
        if (lat >= -35 && lat <= -22 && lon >= 16 && lon <= 33) { patch.venue_lat = lat; patch.venue_lon = lon; }
      }
      if (!Object.keys(patch).length) return res.status(400).json({ error: 'Nothing to update' });

      const { error } = await sb().from('events').update(patch).eq('id', editEvId);
      if (error) return res.status(400).json({ error: error.message });
      return res.status(200).json({ success: true });
    }

    /* ─── DELETE /events/:id (organizer deletes own event) ── */
    if (editEvId && req.method === 'DELETE') {
      const auth = await authUser(req);
      if (!auth) return res.status(401).json({ error: 'Unauthorized' });

      const { data: existing } = await sb().from('events').select('organiser_id').eq('id', editEvId).single();
      if (!existing) return res.status(404).json({ error: 'Event not found' });
      if (existing.organiser_id !== auth.user.id) return res.status(403).json({ error: 'Not your event' });

      const { error } = await sb().from('events').delete().eq('id', editEvId);
      if (error) return res.status(400).json({ error: error.message });
      return res.status(200).json({ success: true });
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

    /* ─── PATCH /businesses/:id (owner updates own listing) ── */
    if (bizId && req.method === 'PATCH') {
      const auth = await authUser(req);
      if (!auth) return res.status(401).json({ error: 'Unauthorized' });

      const { data: existing } = await sb().from('businesses').select('owner_id').eq('id', bizId).single();
      if (!existing) return res.status(404).json({ error: 'Business not found' });
      if (existing.owner_id !== auth.user.id) return res.status(403).json({ error: 'Not your business' });

      const { hours } = req.body || {};
      if (!Array.isArray(hours)) return res.status(400).json({ error: 'hours array required' });

      const { error } = await sb().from('businesses').update({ hours }).eq('id', bizId);
      if (error) return res.status(400).json({ error: error.message });
      return res.status(200).json({ success: true });
    }

    /* ─── POST /businesses/:id/menu-items (owner adds item) ── */
    const menuBizId = url.match(/^\/businesses\/([^/]+)\/menu-items$/)?.[1];
    if (menuBizId && req.method === 'POST') {
      const auth = await authUser(req);
      if (!auth) return res.status(401).json({ error: 'Unauthorized' });

      let owned = menuBizId === auth.user.id;
      if (!owned) {
        const { data: biz } = await sb().from('businesses').select('owner_id').eq('id', menuBizId).maybeSingle();
        owned = biz?.owner_id === auth.user.id;
      }
      if (!owned) return res.status(403).json({ error: 'Not your business' });

      const b = req.body || {};
      const name = (b.name || '').trim();
      const price = parseFloat(b.price);
      if (!name || isNaN(price) || price < 0) return res.status(400).json({ error: 'name and a valid price are required' });

      if (auth.profile.subscription_type !== 'premium' && auth.profile.subscription_type !== 'trial') {
        const { count } = await sb().from('menu_items').select('id', { count: 'exact', head: true }).eq('business_id', menuBizId);
        if ((count || 0) >= 10) return res.status(403).json({ error: 'MENU_LIMIT_REACHED', limit: 10, message: 'Free plan limit: 10 items. Upgrade to premium for unlimited.' });
      }

      const { data: item, error } = await sb().from('menu_items').insert({
        business_id: menuBizId, name, price,
        description: b.description || null,
        category: b.category || 'General',
        image_url: b.image_url || null,
        is_available: b.is_available !== false,
      }).select().single();
      if (error) return res.status(400).json({ error: error.message });
      return res.status(200).json({ item, success: true });
    }

    /* ─── PATCH/DELETE /businesses/:id/menu-items/:itemId ──── */
    const menuItemMatch = url.match(/^\/businesses\/([^/]+)\/menu-items\/([^/]+)$/);
    if (menuItemMatch && (req.method === 'PATCH' || req.method === 'DELETE')) {
      const [, mBizId, itemId] = menuItemMatch;
      const auth = await authUser(req);
      if (!auth) return res.status(401).json({ error: 'Unauthorized' });

      let owned = mBizId === auth.user.id;
      if (!owned) {
        const { data: biz } = await sb().from('businesses').select('owner_id').eq('id', mBizId).maybeSingle();
        owned = biz?.owner_id === auth.user.id;
      }
      if (!owned) return res.status(403).json({ error: 'Not your business' });

      if (req.method === 'DELETE') {
        const { error } = await sb().from('menu_items').delete().eq('id', itemId).eq('business_id', mBizId);
        if (error) return res.status(400).json({ error: error.message });
        return res.status(200).json({ success: true });
      }

      const b = req.body || {};
      const patch = {};
      for (const k of ['name', 'description', 'category', 'image_url']) if (b[k] !== undefined) patch[k] = b[k] || null;
      if (b.price !== undefined) patch.price = parseFloat(b.price) || 0;
      if (b.is_available !== undefined) patch.is_available = !!b.is_available;
      if (!Object.keys(patch).length) return res.status(400).json({ error: 'Nothing to update' });

      const { error } = await sb().from('menu_items').update(patch).eq('id', itemId).eq('business_id', mBizId);
      if (error) return res.status(400).json({ error: error.message });
      return res.status(200).json({ success: true });
    }

    return res.status(404).json({ error: 'Not found' });
  } catch (e) {
    captureError(e, { url });
    return res.status(500).json({ error: e.message });
  }
};
