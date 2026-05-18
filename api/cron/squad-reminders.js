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
    // Get all squad plans happening today
    const { data: plans, error } = await sb()
      .from('squad_plans')
      .select('id, title, plan_date, plan_time, location_name, squad_id, creator_id')
      .eq('plan_date', today);

    if (error) return res.status(400).json({ error: error.message });
    if (!plans?.length) return res.status(200).json({ ok: true, notified: 0 });

    let notified = 0;

    for (const plan of plans) {
      // Get all squad members
      const { data: members } = await sb()
        .from('squad_members')
        .select('user_id')
        .eq('squad_id', plan.squad_id);

      if (!members?.length) continue;

      const timeStr = plan.plan_time ? plan.plan_time.slice(0, 5) : '';
      const locStr  = plan.location_name ? ` at ${plan.location_name}` : '';
      const message = `🗓 Today's outing: "${plan.title}"${locStr}${timeStr ? ' · ' + timeStr : ''}`;

      const rows = members.map(m => ({
        user_id:         m.user_id,
        type:            'squad_plan',
        message,
        entity_id:       plan.id,
        entity_type:     'squad_plan',
        from_user_id:    plan.creator_id || null,
        is_read:         false,
        read:            false,
      }));

      const { error: insErr } = await sb().from('notifications').insert(rows);
      if (!insErr) notified += rows.length;
    }

    return res.status(200).json({ ok: true, plans: plans.length, notified });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
