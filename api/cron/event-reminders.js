const { sb, CORS } = require('../shared');

module.exports = async (req, res) => {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));
  if (req.method === 'OPTIONS') return res.status(200).end();

  const secret = process.env.CRON_SECRET;
  const auth   = req.headers.authorization || '';
  if (secret && auth !== 'Bearer ' + secret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // tomorrow's date in YYYY-MM-DD (UTC+2 SAST offset)
  const now = new Date();
  now.setUTCHours(now.getUTCHours() + 2); // shift to SAST
  now.setUTCDate(now.getUTCDate() + 1);
  const tomorrow = now.toISOString().split('T')[0];

  try {
    // confirmed bookings for events happening tomorrow
    const { data: bookings, error } = await sb()
      .from('bookings')
      .select('user_id, booking_ref, events(id, name, date_local, time_local, venue_name, venue_city)')
      .eq('status', 'confirmed')
      .eq('events.date_local', tomorrow);

    if (error) return res.status(400).json({ error: error.message });

    // filter out rows where the join produced no event (wrong date)
    const relevant = (bookings || []).filter(b => b.events?.date_local === tomorrow);
    if (!relevant.length) return res.status(200).json({ ok: true, notified: 0 });

    // build in-app notification rows (one per booking)
    const notifRows = relevant.map(b => {
      const ev    = b.events;
      const time  = ev.time_local ? ` · ${ev.time_local.slice(0, 5)}` : '';
      const venue = ev.venue_name ? ` at ${ev.venue_name}${ev.venue_city ? ', ' + ev.venue_city : ''}` : '';
      return {
        user_id:     b.user_id,
        type:        'event_reminder',
        message:     `🎟 Tomorrow: "${ev.name}"${venue}${time}`,
        entity_id:   ev.id,
        entity_type: 'event',
        is_read:     false,
        read:        false,
      };
    });

    const { error: insErr } = await sb().from('notifications').insert(notifRows);
    if (insErr) return res.status(400).json({ error: insErr.message });

    // web push (optional — only if VAPID keys are set)
    let push_sent = 0;
    const VPUB  = process.env.VAPID_PUBLIC_KEY;
    const VPRIV = process.env.VAPID_PRIVATE_KEY;
    if (VPUB && VPRIV) {
      try {
        const webpush = require('web-push');
        webpush.setVapidDetails('mailto:admin@pulsefy.co.za', VPUB, VPRIV);
        const userIds = [...new Set(relevant.map(b => b.user_id))];
        const { data: subs } = await sb().from('push_subscriptions').select('*').in('user_id', userIds);
        // one push per subscription, using the first event for that user
        await Promise.all((subs || []).map(s => {
          const booking = relevant.find(b => b.user_id === s.user_id);
          if (!booking) return Promise.resolve();
          const ev      = booking.events;
          const payload = JSON.stringify({
            title: 'Event tomorrow 🎟',
            body:  `"${ev.name}" – don't forget!`,
            url:   '/',
          });
          return webpush.sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            payload
          ).then(() => push_sent++).catch(() => {});
        }));
      } catch (_) { /* web-push not installed or VAPID keys invalid */ }
    }

    return res.status(200).json({ ok: true, notified: notifRows.length, push_sent });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
