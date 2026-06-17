const { sb, CORS } = require('../shared');

module.exports = async (req, res) => {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Verify cron secret so only Vercel scheduler (or authorized callers) can trigger this
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.authorization || '';
  if (secret && auth !== 'Bearer ' + secret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const today = new Date().toISOString().split('T')[0];

  try {
    // Past events stay out of feed queries (which filter date_local >= today),
    // but they're left with is_active=true forever otherwise. Flip them off so
    // admin views / counts / other is_active-keyed queries don't see stale events.
    const { data, error } = await sb()
      .from('events')
      .update({ is_active: false })
      .lt('date_local', today)
      .eq('is_active', true)
      .select('id');

    if (error) return res.status(400).json({ error: error.message });

    // Map-data hygiene (#11): null out-of-SA-bounds event coords + dedupe venues.
    // Runs in one DB transaction via the cleanup_map_data() function.
    const { data: clean, error: cleanErr } = await sb().rpc('cleanup_map_data');
    if (cleanErr) console.error('[event-cleanup] cleanup_map_data failed:', cleanErr.message);

    return res.status(200).json({
      ok: true,
      deactivated: data?.length || 0,
      coords_repaired: clean?.coords_repaired ?? null,
      venues_merged:   clean?.venues_merged   ?? null,
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
