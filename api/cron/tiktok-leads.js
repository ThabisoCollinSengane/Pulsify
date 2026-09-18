// Cron: scrape Durban event TikTok creators → scraped_leads + HubSpot
// Runs daily at 9am via Vercel cron (vercel.json). Requires RAPIDAPI_KEY env var.
// RapidAPI product: "TikTok Scraper" (tiktok-scraper7.p.rapidapi.com)
import { getSB } from '../shared.js';
import { syncBusinessRegistration } from '../../lib/hubspot.js';

const RAPIDAPI_HOST = 'tiktok-scraper2.p.rapidapi.com';

// Hashtags ordered by specificity — event-organizer signals first
const HASHTAGS = [
  'DurbanEventOrganizer',
  'DurbanEventPlanner',
  'DurbanEvents',
  'DurbanNightlife',
  'DurbanParty',
  'KZNEvents',
  'KZNNightlife',
  'DurbanVibes',
  'DurbanEntertainment',
];

const EMAIL_RE = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/;

// Bio keywords that signal an actual event organizer / promoter
const ORGANIZER_KEYWORDS = [
  'organis', 'organiz', 'promoter', 'promotions', 'events',
  'booking', 'bookings', 'tickets', 'entertainment', 'nightlife',
  'parties', 'party', 'venue', 'host', 'hosting', 'management',
  'productions', 'collective', 'agency',
];

// Location signals — at least one must appear in bio or handle
const DURBAN_KEYWORDS = ['durban', 'dbn', 'kzn', 'kwazulu', 'natal', 'umhlanga', 'pinetown', 'umlazi'];

const MIN_FOLLOWERS = 500; // ignore micro-accounts with no reach

function rapidHeaders() {
  return {
    'X-RapidAPI-Key': process.env.RAPIDAPI_KEY || '',
    'X-RapidAPI-Host': RAPIDAPI_HOST,
  };
}

// Returns up to `count` video objects for a hashtag.
async function fetchHashtagPosts(tag, count = 30) {
  if (!process.env.RAPIDAPI_KEY) return [];
  try {
    const url = `https://${RAPIDAPI_HOST}/hashtag/posts?name=${encodeURIComponent(tag)}&count=${count}`;
    const res = await fetch(url, { headers: rapidHeaders() });
    if (!res.ok) return [];
    const json = await res.json();
    return json?.data?.videos || [];
  } catch {
    return [];
  }
}

// Returns { follower_count, bio } for a TikTok handle, or null on failure.
async function fetchUserProfile(handle) {
  if (!process.env.RAPIDAPI_KEY) return null;
  try {
    const url = `https://${RAPIDAPI_HOST}/user/info?unique_id=${encodeURIComponent(handle)}`;
    const res = await fetch(url, { headers: rapidHeaders() });
    if (!res.ok) return null;
    const json = await res.json();
    const user = json?.data?.user || json?.userInfo?.user;
    if (!user) return null;
    return {
      follower_count: json?.data?.stats?.followerCount ?? json?.userInfo?.stats?.followerCount ?? null,
      bio: user.signature || null,
    };
  } catch {
    return null;
  }
}

// Score 0–100: how likely this profile is a Durban event organizer.
// Returns null if the profile clearly doesn't qualify (below floor).
function scoreProfile(handle, bio, follower_count) {
  const text = `${handle} ${bio || ''}`.toLowerCase();

  // Must have Durban/KZN signal somewhere
  const hasDurban = DURBAN_KEYWORDS.some(k => text.includes(k));
  if (!hasDurban) return null;

  // Must meet minimum follower threshold
  if (follower_count !== null && follower_count < MIN_FOLLOWERS) return null;

  // Organizer keyword score (0–60)
  const orgMatches = ORGANIZER_KEYWORDS.filter(k => text.includes(k)).length;
  const orgScore = Math.min(orgMatches * 15, 60);

  // Follower score (0–30): log scale up to 100k
  const fc = follower_count || 0;
  const followerScore = fc > 0 ? Math.min(Math.log10(fc / MIN_FOLLOWERS + 1) * 20, 30) : 0;

  // Email in bio bonus (0–10)
  const emailBonus = EMAIL_RE.test(bio || '') ? 10 : 0;

  const total = Math.round(orgScore + followerScore + emailBonus);

  // Require at least one organizer keyword to be considered
  if (orgMatches === 0) return null;

  return total;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const sb = getSB();
  if (!sb) return res.status(500).json({ error: 'No Supabase client' });

  if (!process.env.RAPIDAPI_KEY) {
    return res.status(200).json({ ok: false, reason: 'RAPIDAPI_KEY not set', inserted: 0, skipped: 0, found: 0, qualified: 0 });
  }

  // Collect unique author handles across all hashtags
  const authorMap = new Map(); // handle → { handle }
  for (const tag of HASHTAGS) {
    const posts = await fetchHashtagPosts(tag);
    for (const v of posts) {
      const handle = v.author?.unique_id;
      if (handle && !authorMap.has(handle)) {
        authorMap.set(handle, { handle });
      }
    }
  }

  const found = authorMap.size;
  let inserted = 0;
  let skipped = 0;
  let disqualified = 0;

  for (const [handle] of authorMap) {
    // Check if already in DB before hitting the profile API
    const { data: existing } = await sb
      .from('scraped_leads')
      .select('id')
      .eq('tiktok', handle)
      .maybeSingle();
    if (existing) { skipped++; continue; }

    // Fetch profile for follower count + bio
    const profile = await fetchUserProfile(handle);
    const bio = profile?.bio || null;
    const follower_count = profile?.follower_count || null;

    // Filter: must look like a Durban event organizer
    const score = scoreProfile(handle, bio, follower_count);
    if (score === null) { disqualified++; continue; }

    const email = bio ? (EMAIL_RE.exec(bio)?.[0] || null) : null;

    const row = {
      name: handle,
      tiktok: handle,
      source: 'tiktok',
      city: 'Durban',
      province: 'KwaZulu-Natal',
      category: 'event_organizer',
      status: 'new',
      follower_count,
      description: bio,
      score,
      ...(email ? { email } : {}),
    };

    const { error } = await sb.from('scraped_leads').insert(row);
    if (error) {
      // Unique constraint violation = already exists (race), treat as skipped
      if (error.code === '23505') { skipped++; continue; }
      console.error('[tiktok-leads] insert error', handle, error.message);
      skipped++;
      continue;
    }
    inserted++;

    // Push to HubSpot as a company/organizer if we have an email
    if (email) {
      syncBusinessRegistration({
        name: handle,
        email,
        city: 'Durban',
        province: 'KwaZulu-Natal',
        category: 'event_organizer',
      });
    }
  }

  return res.status(200).json({ ok: true, found, qualified: found - disqualified, inserted, skipped, disqualified });
}
