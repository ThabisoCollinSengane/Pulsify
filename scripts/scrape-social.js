#!/usr/bin/env node
// Triggers Apify actors for TikTok, Instagram, Facebook social scraping.
// Requires: APIFY_TOKEN, SUPABASE_URL, SUPABASE_SERVICE_KEY env vars.
'use strict';
const https   = require('https');
const { createClient } = require('@supabase/supabase-js');

const APIFY_TOKEN = process.env.APIFY_TOKEN;
const sb = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const INGEST_URL = process.env.INGEST_URL || 'https://pulsify-blue.vercel.app/api/leads/ingest';
const INGEST_KEY = process.env.INGEST_SECRET;

// Apify actor IDs for each platform
const ACTORS = {
  instagram: 'apify/instagram-hashtag-scraper',
  tiktok:    'clockworks/free-tiktok-scraper',
  facebook:  'apify/facebook-pages-scraper',
};

// Hashtags / search terms per platform
const SEARCHES = {
  instagram: ['southafricaevents','durbanevents','johannesburgevents','capetownevents','safestival','saparty'],
  tiktok:    ['southafricaparty','durbanevents','johannesburgnightlife','capetownparty'],
  facebook:  ['event organizer South Africa', 'nightclub Durban', 'nightclub Johannesburg', 'event venue Cape Town'],
};

function apifyPost(path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const opts = {
      hostname: 'api.apify.com',
      path,
      method:   'POST',
      headers:  { 'Content-Type': 'application/json', 'Authorization': `Bearer ${APIFY_TOKEN}`, 'Content-Length': Buffer.byteLength(data) },
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

function apifyGet(path) {
  return new Promise((resolve, reject) => {
    https.get(`https://api.apify.com${path}`, { headers: { 'Authorization': `Bearer ${APIFY_TOKEN}` } }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { reject(e); } });
    }).on('error', reject);
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

// Normalise raw Apify items into the scraped_leads schema
function normalise(item, source) {
  const name = item.fullName || item.name || item.pageName || item.username || item.ownerUsername;
  if (!name) return null;

  const followersRaw = item.followersCount || item.followingCount || item.fans || 0;
  const bio  = item.biography || item.description || item.pageDescription || null;
  const link = item.url || item.externalUrl || item.website || null;

  // Guess province/city from bio or location fields
  const loc   = (item.location || item.city || item.addressCity || '').toLowerCase();
  const SA_CITIES = { durban:'KZN', johannesburg:'GP', sandton:'GP', pretoria:'GP', 'cape town':'WC', bloemfontein:'FS', 'port elizabeth':'EC', gqeberha:'EC', pietermaritzburg:'KZN', nelspruit:'MP' };
  let province = null, city = null;
  for (const [c, p] of Object.entries(SA_CITIES)) {
    if (loc.includes(c) || bio?.toLowerCase().includes(c)) { province = p; city = c.replace(/\b\w/g, l => l.toUpperCase()); break; }
  }

  return {
    name,
    category:       'organizer',
    province,
    city,
    website:        link,
    instagram:      source === 'instagram' ? item.username || null : null,
    tiktok:         source === 'tiktok'    ? item.username || null : null,
    facebook:       source === 'facebook'  ? item.url      || null : null,
    description:    bio,
    follower_count: typeof followersRaw === 'number' ? followersRaw : null,
    source,
    status:         'new',
  };
}

async function runActor(platform, actorId, input) {
  console.log(`\n🚀 Starting ${platform} actor…`);
  const { data: run } = await apifyPost(`/v2/acts/${actorId}/runs?token=${APIFY_TOKEN}`, input);
  if (!run?.id) { console.warn(`  Failed to start ${platform} actor`); return []; }

  console.log(`  Run ID: ${run.id} — waiting…`);
  const finished = await waitForRun(run.id);
  if (!finished || finished.status !== 'SUCCEEDED') { console.warn(`  ${platform} run did not succeed (${finished?.status})`); return []; }

  const { items } = await apifyGet(`/v2/datasets/${finished.defaultDatasetId}/items?format=json&clean=true`);
  return items || [];
}

async function ingestLeads(leads) {
  if (!leads.length) return;
  // Post directly to Supabase (bypass HTTP overhead for same-process runs)
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
  if (!APIFY_TOKEN) { console.error('APIFY_TOKEN not set — skipping social scraping'); process.exit(0); }

  // ── Instagram ──────────────────────────────────────────────────────────────
  const igRaw = await runActor('instagram', ACTORS.instagram, {
    hashtags: SEARCHES.instagram, resultsLimit: 50,
  });
  await ingestLeads(igRaw.map(i => normalise(i, 'instagram')).filter(Boolean));

  // ── TikTok ─────────────────────────────────────────────────────────────────
  const ttRaw = await runActor('tiktok', ACTORS.tiktok, {
    hashtags: SEARCHES.tiktok, resultsPerPage: 30,
  });
  await ingestLeads(ttRaw.map(i => normalise(i, 'tiktok')).filter(Boolean));

  // ── Facebook ───────────────────────────────────────────────────────────────
  const fbRaw = await runActor('facebook', ACTORS.facebook, {
    startUrls: [],
    searchStrings: SEARCHES.facebook,
    maxPagesPerSearchString: 2,
  });
  await ingestLeads(fbRaw.map(i => normalise(i, 'facebook')).filter(Boolean));

  console.log('\n✅ Social scraping complete');
}

run().catch(e => { console.error(e); process.exit(1); });
