// Cron: search TikTok public hashtags for Durban event posts and save to tiktok_leads
// Runs daily. TikTok has no public API — uses a RapidAPI TikTok scraper for discovery.
// Set RAPIDAPI_KEY in Vercel env vars (real fetches are skipped when it's unset).
const { sb, CORS } = require('../../lib/shared');

const HASHTAGS = ['DurbanEvents', 'DurbanParty', 'KZNEvents', 'DurbanNightlife', 'DurbanVibes'];

// Uses RapidAPI "TikTok Scraper" (host: tiktok-scraper7.p.rapidapi.com)
async function fetchHashtagPosts(tag) {
  const key = process.env.RAPIDAPI_KEY;
  if (!key) return [];
  const url = `https://tiktok-scraper7.p.rapidapi.com/hashtag/posts?name=${encodeURIComponent(tag)}&count=20`;
  const res = await fetch(url, {
    headers: {
      'X-RapidAPI-Key': key,
      'X-RapidAPI-Host': 'tiktok-scraper7.p.rapidapi.com',
    },
  });
  if (!res.ok) return [];
  const json = await res.json();
  // RapidAPI scraper returns { data: { videos: [...] } }
  return (json?.data?.videos || []).map(v => ({
    url: `https://www.tiktok.com/@${v.author?.unique_id || 'unknown'}/video/${v.video_id || v.id}`,
    caption: (v.title || v.desc || '').slice(0, 500),
    author_handle: v.author?.unique_id || null,
    thumbnail_url: v.cover || v.origin_cover || null,
  }));
}

module.exports = async (req, res) => {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Verify cron secret so only Vercel scheduler (or authorized callers) can trigger this
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.authorization || '';
  if (secret && auth !== 'Bearer ' + secret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  let inserted = 0;
  const errors = [];

  for (const tag of HASHTAGS) {
    try {
      const posts = (await fetchHashtagPosts(tag)).filter(p => p.url);
      if (!posts.length) continue;
      // ignoreDuplicates + select returns only the rows actually inserted, so the count is accurate.
      const { data, error } = await sb()
        .from('tiktok_leads')
        .upsert(posts, { onConflict: 'url', ignoreDuplicates: true })
        .select('id');
      if (error) { errors.push({ tag, error: error.message }); continue; }
      inserted += (data || []).length;
    } catch (e) {
      errors.push({ tag, error: e.message });
    }
  }

  console.log(`[tiktok-leads] inserted=${inserted} errors=${errors.length}`);
  return res.status(200).json({ ok: true, inserted, errors });
};
