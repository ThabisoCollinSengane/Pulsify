// Cron: scrape Durban event TikTok creators via Playwright → scraped_leads + HubSpot
// Runs daily at 9am via Vercel cron (vercel.json).
// Uses playwright-core + @sparticuz/chromium (serverless-compatible Chromium).
const { sb: getSB, CORS } = require('../../lib/shared');
const { syncBusinessRegistration } = require('../../lib/hubspot');

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

const ORGANIZER_KEYWORDS = [
  'organis', 'organiz', 'promoter', 'promotions', 'events',
  'booking', 'bookings', 'tickets', 'entertainment', 'nightlife',
  'parties', 'party', 'venue', 'host', 'hosting', 'management',
  'productions', 'collective', 'agency',
];

const DURBAN_KEYWORDS = ['durban', 'dbn', 'kzn', 'kwazulu', 'natal', 'umhlanga', 'pinetown', 'umlazi'];

const MIN_FOLLOWERS = 500;

// Launch a serverless-compatible Chromium browser
async function launchBrowser() {
  let executablePath;
  let chromiumArgs;

  try {
    const chromium = require('@sparticuz/chromium');
    executablePath = await chromium.executablePath();
    chromiumArgs = chromium.args;
  } catch {
    // Local dev fallback — use system Playwright browser
    executablePath = undefined;
    chromiumArgs = [];
  }

  const { chromium: pw } = require('playwright-core');
  return pw.launch({
    args: [
      ...chromiumArgs,
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled',
    ],
    executablePath,
    headless: true,
  });
}

// Scrape creator handles from a TikTok hashtag page by intercepting API responses.
// Falls back to DOM extraction if the API interception yields nothing.
async function scrapeHashtag(browser, tag) {
  const handles = new Set();
  const page = await browser.newPage();

  try {
    // Spoof user-agent to reduce bot detection
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9',
    });
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
    );

    // Intercept TikTok's internal API response for hashtag item lists
    page.on('response', async resp => {
      try {
        if (resp.url().includes('/api/challenge/item_list') || resp.url().includes('/api/post/item_list')) {
          const json = await resp.json().catch(() => null);
          const items = json?.itemList || json?.item_list || [];
          for (const item of items) {
            const handle = item?.author?.uniqueId || item?.author?.unique_id;
            if (handle) handles.add(handle);
          }
        }
      } catch { /* ignore parse errors */ }
    });

    const url = `https://www.tiktok.com/tag/${encodeURIComponent(tag)}?lang=en`;
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 }).catch(() =>
      page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 })
    );

    // Scroll once to trigger loading more content
    await page.evaluate(() => window.scrollBy(0, 800)).catch(() => {});
    await page.waitForTimeout(3000);

    // DOM fallback: extract author links from video cards
    if (handles.size === 0) {
      const domHandles = await page.evaluate(() => {
        const links = Array.from(document.querySelectorAll('a[href*="/@"]'));
        return links.map(a => {
          const m = a.href.match(/\/@([^/?#]+)/);
          return m ? m[1] : null;
        }).filter(Boolean);
      }).catch(() => []);
      for (const h of domHandles) handles.add(h);
    }
  } catch (err) {
    console.error(`[tiktok-leads] scrapeHashtag(${tag}) error:`, err.message);
  } finally {
    await page.close().catch(() => {});
  }

  return handles;
}

// Fetch bio + follower count from a TikTok user profile page.
async function scrapeProfile(browser, handle) {
  const page = await browser.newPage();
  let result = null;

  try {
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
    );

    // Intercept user info API
    page.on('response', async resp => {
      try {
        if (resp.url().includes('/api/user/detail') || resp.url().includes('/node/share/user')) {
          const json = await resp.json().catch(() => null);
          if (!json) return;
          const user = json?.userInfo?.user || json?.user;
          const stats = json?.userInfo?.stats || json?.stats;
          if (user) {
            result = {
              bio: user.signature || null,
              follower_count: stats?.followerCount ?? null,
            };
          }
        }
      } catch { /* ignore */ }
    });

    await page.goto(`https://www.tiktok.com/@${encodeURIComponent(handle)}`, {
      waitUntil: 'networkidle',
      timeout: 20000,
    }).catch(() => {});

    // DOM fallback for bio and follower count
    if (!result) {
      result = await page.evaluate(() => {
        const bio = document.querySelector('h2[data-e2e="user-bio"]')?.textContent?.trim()
          || document.querySelector('[class*="ShareDesc"]')?.textContent?.trim()
          || null;
        const fcEl = document.querySelector('[data-e2e="followers-count"]')
          || document.querySelector('[title*="Followers"]');
        const fcText = fcEl?.textContent?.trim() || '';
        // Parse "1.2M" / "45.6K" / "1234"
        let follower_count = null;
        if (fcText) {
          const n = parseFloat(fcText);
          if (!isNaN(n)) {
            if (fcText.toUpperCase().includes('M')) follower_count = Math.round(n * 1_000_000);
            else if (fcText.toUpperCase().includes('K')) follower_count = Math.round(n * 1_000);
            else follower_count = Math.round(n);
          }
        }
        return { bio, follower_count };
      }).catch(() => null);
    }
  } catch (err) {
    console.error(`[tiktok-leads] scrapeProfile(${handle}) error:`, err.message);
  } finally {
    await page.close().catch(() => {});
  }

  return result;
}

function scoreProfile(handle, bio, follower_count) {
  const text = `${handle} ${bio || ''}`.toLowerCase();
  const hasDurban = DURBAN_KEYWORDS.some(k => text.includes(k));
  if (!hasDurban) return null;
  if (follower_count !== null && follower_count < MIN_FOLLOWERS) return null;
  const orgMatches = ORGANIZER_KEYWORDS.filter(k => text.includes(k)).length;
  if (orgMatches === 0) return null;
  const orgScore = Math.min(orgMatches * 15, 60);
  const fc = follower_count || 0;
  const followerScore = fc > 0 ? Math.min(Math.log10(fc / MIN_FOLLOWERS + 1) * 20, 30) : 0;
  const emailBonus = EMAIL_RE.test(bio || '') ? 10 : 0;
  return Math.round(orgScore + followerScore + emailBonus);
}

module.exports = async (req, res) => {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const sb = getSB();
  if (!sb) return res.status(500).json({ error: 'No Supabase client' });

  let browser;
  try {
    browser = await launchBrowser();
  } catch (err) {
    console.error('[tiktok-leads] browser launch failed:', err.message);
    return res.status(500).json({ error: 'Browser launch failed', detail: err.message });
  }

  const authorMap = new Map();

  try {
    for (const tag of HASHTAGS) {
      const handles = await scrapeHashtag(browser, tag);
      for (const h of handles) {
        if (!authorMap.has(h)) authorMap.set(h, { handle: h });
      }
      // Brief pause between hashtag pages
      await new Promise(r => setTimeout(r, 2000));
    }
  } finally {
    await browser.close().catch(() => {});
  }

  const found = authorMap.size;
  let inserted = 0;
  let skipped = 0;
  let disqualified = 0;

  // Open a second browser session for profile lookups
  let profBrowser;
  try {
    profBrowser = await launchBrowser();
  } catch {
    profBrowser = null;
  }

  try {
    for (const [handle] of authorMap) {
      const { data: existing } = await sb
        .from('scraped_leads')
        .select('id')
        .eq('tiktok', handle)
        .maybeSingle();
      if (existing) { skipped++; continue; }

      let bio = null;
      let follower_count = null;

      if (profBrowser) {
        const profile = await scrapeProfile(profBrowser, handle);
        bio = profile?.bio || null;
        follower_count = profile?.follower_count || null;
      }

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
        if (error.code === '23505') { skipped++; continue; }
        console.error('[tiktok-leads] insert error', handle, error.message);
        skipped++;
        continue;
      }
      inserted++;

      if (email) {
        syncBusinessRegistration({
          name: handle,
          email,
          city: 'Durban',
          province: 'KwaZulu-Natal',
          category: 'event_organizer',
        });
      }

      // Brief pause between profile visits
      await new Promise(r => setTimeout(r, 1500));
    }
  } finally {
    if (profBrowser) await profBrowser.close().catch(() => {});
  }

  return res.status(200).json({ ok: true, found, qualified: found - disqualified, inserted, skipped, disqualified });
};
