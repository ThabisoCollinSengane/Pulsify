#!/usr/bin/env node
// Scrapes SA event organisers & venues from Google Places, inserts into scraped_leads.
// Requires: GOOGLE_PLACES_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY env vars.
'use strict';
const https   = require('https');
const { createClient } = require('@supabase/supabase-js');

const GOOGLE_KEY = process.env.GOOGLE_PLACES_API_KEY;
const sb = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

// Each entry: [search query, province code, city, category]
const SEARCHES = [
  ['event organizer Durban South Africa',           'KZN', 'Durban',           'organizer'],
  ['nightclub Durban South Africa',                  'KZN', 'Durban',           'business'],
  ['event venue Durban South Africa',                'KZN', 'Durban',           'business'],
  ['concert venue Durban South Africa',              'KZN', 'Durban',           'business'],
  ['event organizer Johannesburg South Africa',      'GP',  'Johannesburg',     'organizer'],
  ['nightclub Johannesburg South Africa',            'GP',  'Johannesburg',     'business'],
  ['event venue Johannesburg South Africa',          'GP',  'Johannesburg',     'business'],
  ['event organizer Cape Town South Africa',         'WC',  'Cape Town',        'organizer'],
  ['nightclub Cape Town South Africa',               'WC',  'Cape Town',        'business'],
  ['event venue Cape Town South Africa',             'WC',  'Cape Town',        'business'],
  ['event organizer Pretoria South Africa',          'GP',  'Pretoria',         'organizer'],
  ['event venue Pretoria South Africa',              'GP',  'Pretoria',         'business'],
  ['event organizer Pietermaritzburg South Africa',  'KZN', 'Pietermaritzburg', 'organizer'],
  ['event organizer Port Elizabeth South Africa',    'EC',  'Gqeberha',         'organizer'],
  ['nightclub Sandton South Africa',                 'GP',  'Sandton',          'business'],
  ['event organizer Bloemfontein South Africa',      'FS',  'Bloemfontein',     'organizer'],
  ['DJ South Africa events',                         null,  null,               'organizer'],
  ['music promoter South Africa',                    null,  null,               'organizer'],
];

function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { reject(e); } });
    }).on('error', reject);
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function textSearch(query) {
  const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(query)}&key=${GOOGLE_KEY}`;
  const d = await get(url);
  if (d.status !== 'OK' && d.status !== 'ZERO_RESULTS') {
    console.warn(`Places API: ${d.status} — ${d.error_message || ''}`);
  }
  return d.results || [];
}

async function placeDetails(placeId) {
  const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=name,formatted_phone_number,website,types&key=${GOOGLE_KEY}`;
  const d = await get(url);
  return d.result || {};
}

async function run() {
  if (!GOOGLE_KEY)  { console.error('GOOGLE_PLACES_API_KEY not set'); process.exit(1); }

  let inserted = 0, skipped = 0, errors = 0;

  for (const [query, province, city, category] of SEARCHES) {
    console.log(`\n🔍 ${query}`);
    let places;
    try { places = await textSearch(query); }
    catch(e) { console.error(`  Search failed: ${e.message}`); errors++; continue; }

    for (const place of places) {
      let details = {};
      try { details = await placeDetails(place.place_id); await sleep(150); }
      catch(e) { /* skip details on error */ }

      const name = place.name;

      // deduplicate by name + city
      const { count } = await sb.from('scraped_leads')
        .select('id', { count: 'exact', head: true })
        .eq('name', name)
        .eq('city', city || '');

      if (count > 0) { process.stdout.write('·'); skipped++; continue; }

      const { error } = await sb.from('scraped_leads').insert({
        name,
        category,
        province:  province  || null,
        city:      city      || null,
        phone:     details.formatted_phone_number || null,
        website:   details.website || null,
        source:    'google',
        status:    'new',
      });

      if (error) { console.error(`  Insert error (${name}): ${error.message}`); errors++; }
      else       { process.stdout.write('+'); inserted++; }
    }

    await sleep(400); // stay within rate limits
  }

  console.log(`\n\n✅ Done — inserted: ${inserted}  skipped: ${skipped}  errors: ${errors}`);
}

run().catch(e => { console.error(e); process.exit(1); });
