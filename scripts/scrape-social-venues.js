#!/usr/bin/env node
// Scrapes clubs, shisanyamas, BnBs and event venues from TikTok, Instagram
// and Facebook using Apify — focused on Durban and Johannesburg.
// Requires: APIFY_TOKEN, SUPABASE_URL, SUPABASE_SERVICE_KEY env vars.
'use strict';
const https   = require('https');
const fs      = require('fs');
const path    = require('path');
const { createClient } = require('@supabase/supabase-js');

(function loadEnv() {
  const envPath = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
})();

const APIFY_TOKEN = process.env.APIFY_TOKEN;
if (!APIFY_TOKEN) { console.error('APIFY_TOKEN not set — skipping'); process.exit(0); }
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY'); process.exit(1);
}
const sb = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const ACTORS = {
  instagram: 'apify/instagram-scraper',
  tiktok:    'clockworks/tiktok-scraper',
  facebook:  'apify/facebook-pages-scraper',
};

// Hashtags focused on Durban & JHB venues/nightlife/accommodation
const SEARCHES = {
  instagram: [
    'durbanclubs','durbanshisanyama','durbanbnb','durbanaccommodation','durbanvenue',
    'jhbclubs','johannesburgshisanyama','sowetoshisanyama','joburgnightlife',
    'sandtonlounge','kznvenues','durbannight','joburgevents',
  ],
  tiktok: [
    'durbanshisanyama','durbanclubs','joburgnightclub','johannesburglounge',
    'kznbnb','durbanaccommodation','sowetoshisanyama','sandtonnight',
  ],
  facebook: [
    'nightclub Durban',
    'shisanyama Durban',
    'guest house Durban',
    'BnB Durban KZN',
    'nightclub Johannesburg',
    'shisanyama Soweto',
    'event venue Johannesburg',
    'BnB Johannesburg',
  ],
};

function apifyPost(reqPath, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const opts = {
      hostname: 'api.apify.com',
      path: reqPath,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${APIFY_TOKEN}`,
        'Content-Length': Buffer.byteLength(data),
      },
    };
    const req = https.request(opts, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { reject(e); } });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function apifyGet(reqPath) {
  return new Promise((resolve, reject) => {
    https.get(
      `https://api.apify.com${reqPath}`,
      { headers: { 'Authorization': `Bearer ${APIFY_TOKEN}` } },
      res => {
        let d = '';
        res.on('data', c => d += c);
        res.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { reject(e); } });
      }
    ).on('error', reject);
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function waitForRun(runId, maxMinutes = 10) {
  const deadline = Date.now() + maxMinutes * 60000;
  while (Date.now() < deadline) {
    await sleep(15000);
    const { data } = await apifyGet(`/v2/actor-runs/${runId}`);
    if (['SUCCEEDED','FAILED','ABORTED','TIMED-OUT'].includes(data?.status)) return data;
  }
  return null;
}

async function runActor(platform, actorId, input) {
  console.log(`\n🚀 Starting ${platform} actor…`);
  const resp = await apifyPost(`/v2/acts/${actorId}/runs?token=${APIFY_TOKEN}`, input);
  const run = resp?.data;
  if (!run?.id) { console.warn(`  Failed to start ${platform}`); return []; }

  console.log(`  Run ID: ${run.id} — waiting…`);
  const finished = await waitForRun(run.id);
  if (!finished || finished.status !== 'SUCCEEDED') {
    console.warn(`  ${platform} run did not succeed (${finished?.status})`);
    return [];
  }

  const result = await apifyGet(`/v2/datasets/${finished.defaultDatasetId}/items?format=json&clean=true`);
  return result?.items || [];
}

const SA_CITY_PATTERNS = [
  { pat: /durban|kzn|umlazi|kwamash|pinetown|amanzimtoti/i, city: 'Durban', province: 'KZN' },
  { pat: /johannesburg|joburg|jhb|soweto|sandton|midrand|randburg|roodepoort|alexandra/i, city: 'Johannesburg', province: 'GP' },
  { pat: /cape town|capetown|cpt|bellville|parow/i, city: 'Cape Town', province: 'WC' },
  { pat: /pretoria|tshwane|centurion/i, city: 'Pretoria', province: 'GP' },
];

function inferCity(text = '') {
  for (const { pat, city, province } of SA_CITY_PATTERNS) {
    if (pat.test(text)) return { city, province };
  }
  return { city: null, province: null };
}

function inferCategory(text = '') {
  const t = text.toLowerCase();
  if (/nightclub|club|lounge|tavern/.test(t)) return 'club';
  if (/shisanyama|braai|grill|bbq/.test(t)) return 'shisanyama';
  if (/guest.?house|bnb|airbnb|bed.?and.?breakfast/.test(t)) return 'bnb';
  if (/hostel|backpacker/.test(t)) return 'bnb';
  if (/hotel/.test(t)) return 'hotel';
  if (/venue|events|function.?hall/.test(t)) return 'venue';
  return 'organizer';
}

function normalise(item, source) {
  const name = item.fullName || item.name || item.pageName || item.username || item.ownerUsername;
  if (!name) return null;

  const bio  = item.biography || item.description || item.pageDescription || '';
  const link = item.url || item.externalUrl || item.website || null;
  const loc  = (item.location || item.city || item.addressCity || '').toLowerCase();

  const combined = `${name} ${bio} ${loc}`;
  const { city, province } = inferCity(combined);
  const category = inferCategory(combined);

  return {
    name,
    category,
    province,
    city,
    website:        link,
    instagram:      source === 'instagram' ? item.username || null : null,
    tiktok:         source === 'tiktok'    ? item.username || null : null,
    facebook:       source === 'facebook'  ? item.url      || null : null,
    description:    bio || null,
    follower_count: typeof item.followersCount === 'number' ? item.followersCount : null,
    source,
    status:         'new',
  };
}

async function ingest(leads) {
  let ins = 0, skip = 0;
  for (const lead of leads) {
    const { count } = await sb.from('scraped_leads')
      .select('id', { count: 'exact', head: true })
      .eq('name', lead.name).eq('source', lead.source);
    if (count > 0) { skip++; continue; }
    await sb.from('scraped_leads').insert(lead);
    ins++;
  }
  console.log(`  Inserted: ${ins}  Skipped: ${skip}`);
}

async function run() {
  // Instagram
  const igRaw = await runActor('instagram', ACTORS.instagram, {
    hashtags: SEARCHES.instagram, resultsType: 'users', resultsLimit: 30,
  });
  await ingest(igRaw.map(i => normalise(i, 'instagram')).filter(Boolean));

  // TikTok
  const ttRaw = await runActor('tiktok', ACTORS.tiktok, {
    hashtags: SEARCHES.tiktok, maxVideos: 20,
  });
  await ingest(ttRaw.map(i => normalise(i, 'tiktok')).filter(Boolean));

  // Facebook
  const fbRaw = await runActor('facebook', ACTORS.facebook, {
    startUrls: [],
    searchStrings: SEARCHES.facebook,
    maxPagesPerSearchString: 3,
  });
  await ingest(fbRaw.map(i => normalise(i, 'facebook')).filter(Boolean));

  console.log('\n✅ Social venue scraping complete');
}

run().catch(e => { console.error(e); process.exit(1); });
