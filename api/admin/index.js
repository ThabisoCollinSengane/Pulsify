const { sb, sbAs, authUser, tokenFrom, corsHeaders, verifyToken, logAdminAction, rateLimited, captureError } = require('../shared');
const { sendVerifApprovedEmail, sendVerifRejectedEmail, sendLeadEmail, SMTP_CONFIGURED } = require('../email');

module.exports = async (req, res) => {
  Object.entries(corsHeaders(req)).forEach(([k, v]) => res.setHeader(k, v));
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (rateLimited(req, res, { limit: 100, windowMs: 60000 })) return;

  const url = (req.url || '/').split('?')[0].replace(/^\/api/, '') || '/';
  const q   = Object.fromEntries(new URL(req.url, 'http://x').searchParams);

  try {

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

      // Auto-log status changes and note additions to activity timeline
      if (status !== undefined) {
        sb().from('lead_activities').insert({ lead_id: leadId, type: 'status_changed', summary: `Status → ${status}`, data: { status } }).then(() => {}).catch(() => {});
      }
      if (Array.isArray(notes) && notes.length > 0) {
        const last = notes[notes.length - 1];
        const text = (last?.text || String(last)).slice(0, 120);
        sb().from('lead_activities').insert({ lead_id: leadId, type: 'note_added', summary: `Note: ${text}`, data: { note: last } }).then(() => {}).catch(() => {});
      }

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
      return res.status(200).json({ verifications: data || [] });
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
      const { data: evtRow } = await sb().from('events').select('name,organiser_name').eq('id', eventId).single();
      const adminName = auth.profile.display_name || auth.user.email || 'Admin';
      if (approved === false) {
        const { error } = await sb().from('events').delete().eq('id', eventId);
        if (error) return res.status(400).json({ error: error.message });
        await logAdminAction(auth.user.id, adminName, 'event_reject', eventId, evtRow?.name || eventId, {});
        return res.status(200).json({ success: true, deleted: true });
      }
      const { data, error } = await sb().from('events').update({ approved: true }).eq('id', eventId).select().single();
      if (error) return res.status(400).json({ error: error.message });
      await logAdminAction(auth.user.id, adminName, 'event_approve', eventId, evtRow?.name || eventId, {});
      return res.status(200).json({ success: true, event: data });
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

    /* ─── GET /admin/notify/audience (preview recipient count) ── */
    if (url === '/admin/notify/audience' && req.method === 'GET') {
      const auth = await authUser(req);
      if (!auth || auth.profile?.role !== 'admin') return res.status(403).json({ error: 'Admin only' });

      const target = q.target || 'all';
      let uq = sb().from('profiles').select('id', { count: 'exact', head: true });
      if (target.startsWith('city:'))  uq = uq.ilike('city', target.slice(5));
      if (target.startsWith('genre:')) uq = uq.contains('genres', [target.slice(6)]);
      if (target.startsWith('user:'))  uq = uq.eq('id', target.slice(5));
      const { count, error } = await uq;
      if (error) return res.status(400).json({ error: error.message });
      return res.status(200).json({ count: count || 0, target });
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
      const token  = (req.headers.authorization || '').replace('Bearer ', '').trim();
      const user   = token ? await verifyToken(token) : null;
      const body   = req.body || {};
      const targetId = body[cfg.idCol] ?? body.target_id ?? body.id;
      const targetName = body[cfg.nameCol] ?? body.target_name ?? body.name;
      const { reason, detail } = body;
      const validReasons = ['fake_event','stolen_content','i_am_owner','doesnt_exist','inappropriate','other'];
      if (!targetId || !validReasons.includes(reason)) return res.status(400).json({ error: `${cfg.idCol} and valid reason required` });
      const { error } = await sb().from(cfg.table).insert({
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
      const REPORT_TABLES_INNER = {
        event:    { table: 'event_reports',    idCol: 'event_id',    nameCol: 'event_name' },
        business: { table: 'business_reports', idCol: 'business_id', nameCol: 'business_name' },
        post:     { table: 'post_reports',     idCol: 'post_id',     nameCol: 'post_caption' },
      };
      const status = req.query?.status || 'pending';
      const type   = req.query?.type   || 'event';
      const types  = type === 'all' ? ['event','business','post'] : [type];
      if (types.some(t => !REPORT_TABLES_INNER[t])) return res.status(400).json({ error: 'invalid type' });
      const token = tokenFrom(req);
      const results = await Promise.all(types.map(async (t) => {
        const cfg = REPORT_TABLES_INNER[t];
        let qr = sbAs(token).from(cfg.table).select('*').order('created_at', { ascending: false });
        if (status !== 'all') qr = qr.eq('status', status);
        const { data, error } = await qr;
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
      const REPORT_TABLES_INNER2 = {
        event:    { table: 'event_reports',    idCol: 'event_id',    nameCol: 'event_name' },
        business: { table: 'business_reports', idCol: 'business_id', nameCol: 'business_name' },
        post:     { table: 'post_reports',     idCol: 'post_id',     nameCol: 'post_caption' },
      };
      const { status } = req.body || {};
      if (!['reviewed','dismissed'].includes(status)) return res.status(400).json({ error: 'status must be reviewed or dismissed' });
      const type = reportTypedMatch ? reportTypedMatch[1] : 'event';
      const id   = reportTypedMatch ? reportTypedMatch[2] : reportLegacyMatch[1];
      const { error } = await sb().from(REPORT_TABLES_INNER2[type].table).update({ status }).eq('id', id);
      if (error) return res.status(400).json({ error: error.message });
      return res.status(200).json({ ok: true });
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

    /* ─── POST /leads/bulk-email ─── Resend batch (inert without key) ─── */
    if (url === '/leads/bulk-email' && req.method === 'POST') {
      const auth = await authUser(req);
      if (!auth || auth.profile.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });

      const { lead_ids, subject, body: emailBody } = req.body || {};
      if (!lead_ids?.length || !subject || !emailBody) return res.status(400).json({ error: 'lead_ids, subject, body required' });

      if (!SMTP_CONFIGURED) return res.status(200).json({ sent: 0, skipped: lead_ids.length, warning: 'SMTP not configured — email sending is disabled. Set SMTP_HOST / SMTP_PASS to enable.' });

      const { data: leads } = await sb().from('scraped_leads').select('id,name,email,city').in('id', lead_ids);
      let sent = 0, skipped = 0;
      const acts = [];
      const sentIds = [];

      for (const lead of (leads || [])) {
        const sub  = subject.replace(/\{\{name\}\}/g, lead.name).replace(/\{\{business_name\}\}/g, lead.name).replace(/\{\{city\}\}/g, lead.city || '');
        const bod  = emailBody.replace(/\{\{name\}\}/g, lead.name).replace(/\{\{business_name\}\}/g, lead.name).replace(/\{\{city\}\}/g, lead.city || '');
        if (!lead.email) { skipped++; acts.push({ lead_id: lead.id, type: 'email_sent', summary: `Email skipped — no address`, data: { subject: sub } }); continue; }
        const ok = await sendLeadEmail(lead.email, sub, bod);
        if (ok) { sent++; sentIds.push(lead.id); acts.push({ lead_id: lead.id, type: 'email_sent', summary: `Email sent: ${sub}`, data: { subject: sub, to: lead.email } }); }
        else { skipped++; acts.push({ lead_id: lead.id, type: 'email_sent', summary: `Email failed (SMTP error)`, data: { subject: sub } }); }
      }

      if (acts.length) await sb().from('lead_activities').insert(acts);
      if (sentIds.length) await sb().from('scraped_leads').update({ status: 'contacted', updated_at: new Date().toISOString() }).in('id', sentIds);

      return res.status(200).json({ sent, skipped });
    }

    /* ─── GET /leads/followups ─── all pending follow-ups ─────────── */
    if (url === '/leads/followups' && req.method === 'GET') {
      const auth = await authUser(req);
      if (!auth || auth.profile.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
      const { data, error } = await sb().from('lead_followups')
        .select('*, scraped_leads(id, name, city)').eq('completed', false).order('due_date', { ascending: true });
      if (error) return res.status(400).json({ error: error.message });
      return res.status(200).json({ followups: data || [] });
    }

    /* ─── POST /leads/follow-up ─── schedule follow-up ────────────── */
    if (url === '/leads/follow-up' && req.method === 'POST') {
      const auth = await authUser(req);
      if (!auth || auth.profile.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
      const { lead_id, due_date, note } = req.body || {};
      if (!lead_id || !due_date) return res.status(400).json({ error: 'lead_id and due_date required' });
      const { data, error } = await sb().from('lead_followups').insert({ lead_id, due_date, note: note || null }).select().single();
      if (error) return res.status(400).json({ error: error.message });
      try { await sb().from('lead_activities').insert({ lead_id, type: 'follow_up_scheduled', summary: `Follow-up scheduled for ${due_date}${note ? ': ' + note.slice(0, 80) : ''}`, data: { due_date, note } }); } catch {}
      return res.status(201).json({ followup: data });
    }

    /* ─── PATCH /leads/followups/:id ─── mark complete ─────────────── */
    const followupIdMatch = url.match(/^\/leads\/followups\/([^/]+)$/);
    if (followupIdMatch && req.method === 'PATCH') {
      const auth = await authUser(req);
      if (!auth || auth.profile.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
      const { data, error } = await sb().from('lead_followups').update({ completed: true }).eq('id', followupIdMatch[1]).select().single();
      if (error) return res.status(400).json({ error: error.message });
      if (data?.lead_id) {
        try { await sb().from('lead_activities').insert({ lead_id: data.lead_id, type: 'follow_up_completed', summary: `Follow-up completed (was due ${data.due_date})`, data: { followup_id: data.id } }); } catch {}
      }
      return res.status(200).json({ followup: data });
    }

    /* ─── GET /leads/:id/activity ─── activity timeline ──────────── */
    const leadActivityMatch = url.match(/^\/leads\/([^/]+)\/activity$/);
    if (leadActivityMatch && req.method === 'GET') {
      const auth = await authUser(req);
      if (!auth || auth.profile.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
      const { data, error } = await sb().from('lead_activities')
        .select('*').eq('lead_id', leadActivityMatch[1]).order('created_at', { ascending: false }).limit(50);
      if (error) return res.status(400).json({ error: error.message });
      return res.status(200).json({ activities: data || [] });
    }

    /* ─── POST /leads/:id/activity ─── log manual activity ─────────── */
    if (leadActivityMatch && req.method === 'POST') {
      const auth = await authUser(req);
      if (!auth || auth.profile.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
      const { type, summary, data: actData } = req.body || {};
      if (!type) return res.status(400).json({ error: 'type required' });
      const { data, error } = await sb().from('lead_activities').insert({ lead_id: leadActivityMatch[1], type, summary: summary || null, data: actData || {} }).select().single();
      if (error) return res.status(400).json({ error: error.message });
      return res.status(201).json({ activity: data });
    }

    /* ─── GET /admin/email-templates ─── list saved templates ─────── */
    if (url === '/admin/email-templates' && req.method === 'GET') {
      const auth = await authUser(req);
      if (!auth || auth.profile.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
      const { data, error } = await sb().from('email_templates').select('*').order('created_at', { ascending: true });
      if (error) return res.status(400).json({ error: error.message });
      return res.status(200).json({ templates: data || [] });
    }

    /* ─── POST /admin/email-templates ─── create or update template ── */
    if (url === '/admin/email-templates' && req.method === 'POST') {
      const auth = await authUser(req);
      if (!auth || auth.profile.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
      const { key, name, subject, body: tplBody } = req.body || {};
      if (!key || !name || !subject || !tplBody) return res.status(400).json({ error: 'key, name, subject, body required' });
      const { data, error } = await sb().from('email_templates')
        .upsert({ key, name, subject, body: tplBody, updated_at: new Date().toISOString() }, { onConflict: 'key' })
        .select().single();
      if (error) return res.status(400).json({ error: error.message });
      return res.status(200).json({ template: data });
    }

    /* ─── DELETE /admin/email-templates/:id ─── delete template ───── */
    const emailTplMatch = url.match(/^\/admin\/email-templates\/([^/]+)$/);
    if (emailTplMatch && req.method === 'DELETE') {
      const auth = await authUser(req);
      if (!auth || auth.profile.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
      const { error } = await sb().from('email_templates').delete().eq('id', emailTplMatch[1]);
      if (error) return res.status(400).json({ error: error.message });
      return res.status(200).json({ success: true });
    }

    return res.status(404).json({ error: 'Not found' });
  } catch (e) {
    captureError(e, { url });
    return res.status(500).json({ error: e.message });
  }
};
