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

  try {
    const { error } = await sb().rpc('recompute_hype_scores');
    if (error) return res.status(400).json({ error: error.message });
    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
