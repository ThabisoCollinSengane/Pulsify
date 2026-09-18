// Cron: search TikTok public hashtags for Durban event posts and save to tiktok_leads
// Runs daily. TikTok has no public API — uses the public web/oembed discovery approach.
// Real implementation requires a RapidAPI TikTok scraper or Apify actor with a key.
import { getSB } from '../shared.js';

const HASHTAGS = ['DurbanEvents', 'DurbanParty', 'KZNEvents', 'DurbanNightlife', 'DurbanVibes'];

// Uses RapidAPI "TikTok Scraper" (host: tiktok-scraper7.p.rapidapi.com)
// Set RAPIDAPI_KEY in Vercel env vars.
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

export default async function handler(req, res) {
  // Allow only GET (cron trigger) or internal calls
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const sb = getSB();
  if (!sb) return res.status(500).json({ error: 'No Supabase client' });

  let inserted = 0;
  let errors = [];

  for (const tag of HASHTAGS) {
    try {
      const posts = await fetchHashtagPosts(tag);
      for (const post of posts) {
        if (!post.url) continue;
        const { error } = await sb.from('tiktok_leads').upsert(
          { url: post.url, caption: post.caption, author_handle: post.author_handle, thumbnail_url: post.thumbnail_url },
          { onConflict: 'url', ignoreDuplicates: true }
        );
        if (!error) inserted++;
      }
    } catch (e) {
      errors.push({ tag, error: e.message });
    }
  }

  return res.status(200).json({ ok: true, inserted, errors });
}
