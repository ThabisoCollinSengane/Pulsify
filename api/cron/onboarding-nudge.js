const { sb, CORS } = require('../shared');
const { sendNudgeDay2Email, sendNudgeDay7Email } = require('../email');

module.exports = async (req, res) => {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));
  if (req.method === 'OPTIONS') return res.status(200).end();

  const secret = process.env.CRON_SECRET;
  const auth = req.headers.authorization || '';
  if (secret && auth !== 'Bearer ' + secret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const now = new Date();

  // Window helpers: profiles created "N days ago" (±12h to survive cron drift)
  function window(days) {
    const mid = new Date(now - days * 86400000);
    return {
      gte: new Date(mid - 12 * 3600000).toISOString(),
      lt:  new Date(mid + 12 * 3600000).toISOString(),
    };
  }

  const w2 = window(2);
  const w7 = window(7);

  try {
    // Fetch organiser + business profiles in each window
    const [{ data: day2Profiles }, { data: day7Profiles }] = await Promise.all([
      sb().from('profiles').select('id, display_name, role').in('role', ['organizer', 'business']).gte('created_at', w2.gte).lt('created_at', w2.lt),
      sb().from('profiles').select('id, display_name, role').in('role', ['organizer', 'business']).gte('created_at', w7.gte).lt('created_at', w7.lt),
    ]);

    let sent2 = 0, sent7 = 0, skipped = 0;

    // Day-2 nudges
    for (const profile of (day2Profiles || [])) {
      const { data: { user }, error } = await sb().auth.admin.getUserById(profile.id);
      if (error || !user?.email) { skipped++; continue; }
      const ok = await sendNudgeDay2Email(user.email, profile.display_name, profile.role);
      if (ok) sent2++; else skipped++;
    }

    // Day-7 nudges
    for (const profile of (day7Profiles || [])) {
      const { data: { user }, error } = await sb().auth.admin.getUserById(profile.id);
      if (error || !user?.email) { skipped++; continue; }
      const ok = await sendNudgeDay7Email(user.email, profile.display_name, profile.role);
      if (ok) sent7++; else skipped++;
    }

    console.log(`[onboarding-nudge] day2=${sent2} day7=${sent7} skipped=${skipped}`);
    return res.status(200).json({ sent_day2: sent2, sent_day7: sent7, skipped });
  } catch (e) {
    console.error('[onboarding-nudge]', e.message);
    return res.status(500).json({ error: e.message });
  }
};
