#!/usr/bin/env node
// Scrapes clubs, shisanyamas, BnBs and hotels in Durban & JHB via Google Places API.
// Requires: GOOGLE_PLACES_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY env vars.
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

const API_KEY = process.env.GOOGLE_PLACES_API_KEY;
if (!API_KEY) { console.error('GOOGLE_PLACES_API_KEY not set'); process.exit(0); }
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY'); process.exit(1);
}
const sb = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const sleep = ms => new Promise(r => setTimeout(r, ms));

function placesSearch(query, location, radius = 10000) {
  return new Promise((resolve) => {
    const params = new URLSearchParams({
      query, location, radius, key: API_KEY, language: 'en',
    });
    const url = `/maps/api/place/textsearch/json?${params}`;
    https.get({ hostname: 'maps.googleapis.com', path: url }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve({ results: [] }); } });
    }).on('error', () => resolve({ results: [] }));
  });
}

function placeDetails(placeId) {
  return new Promise((resolve) => {
    const params = new URLSearchParams({
      place_id: placeId, key: API_KEY,
      fields: 'name,formatted_address,formatted_phone_number,website,url,rating,user_ratings_total,opening_hours,types',
    });
    https.get({ hostname: 'maps.googleapis.com', path: `/maps/api/place/details/json?${params}` }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d).result || {}); } catch { resolve({}); } });
    }).on('error', () => resolve({}));
  });
}

const QUERIES = [
  // Durban
  { q: 'nightclub Durban',                   city: 'Durban', province: 'KZN', category: 'club',       loc: '-29.8587,31.0218' },
  { q: 'shisanyama Durban',                  city: 'Durban', province: 'KZN', category: 'shisanyama', loc: '-29.8587,31.0218' },
  { q: 'braai place Durban',                 city: 'Durban', province: 'KZN', category: 'shisanyama', loc: '-29.8587,31.0218' },
  { q: 'event venue Durban',                 city: 'Durban', province: 'KZN', category: 'venue',       loc: '-29.8587,31.0218' },
  { q: 'guest house Durban',                 city: 'Durban', province: 'KZN', category: 'bnb',         loc: '-29.8587,31.0218' },
  { q: 'BnB accommodation Durban',           city: 'Durban', province: 'KZN', category: 'bnb',         loc: '-29.8587,31.0218' },
  { q: 'hotel Durban beachfront',            city: 'Durban', province: 'KZN', category: 'hotel',       loc: '-29.8587,31.0218' },
  { q: 'lounge bar Durban',                  city: 'Durban', province: 'KZN', category: 'bar',         loc: '-29.8587,31.0218' },
  { q: 'nightclub KwaMashu Durban',          city: 'KwaMashu', province: 'KZN', category: 'club',      loc: '-29.7456,30.9721' },
  { q: 'shisanyama Umlazi',                  city: 'Umlazi',   province: 'KZN', category: 'shisanyama',loc: '-29.9701,30.9021' },
  // Johannesburg
  { q: 'nightclub Johannesburg',             city: 'Johannesburg', province: 'GP', category: 'club',       loc: '-26.2041,28.0473' },
  { q: 'nightclub Sandton',                  city: 'Sandton',      province: 'GP', category: 'club',       loc: '-26.1076,28.0567' },
  { q: 'shisanyama Soweto',                  city: 'Soweto',       province: 'GP', category: 'shisanyama', loc: '-26.2667,27.8667' },
  { q: 'shisanyama Johannesburg',            city: 'Johannesburg', province: 'GP', category: 'shisanyama', loc: '-26.2041,28.0473' },
  { q: 'braai restaurant Johannesburg',      city: 'Johannesburg', province: 'GP', category: 'shisanyama', loc: '-26.2041,28.0473' },
  { q: 'event venue Johannesburg',           city: 'Johannesburg', province: 'GP', category: 'venue',       loc: '-26.2041,28.0473' },
  { q: 'guest house Johannesburg',           city: 'Johannesburg', province: 'GP', category: 'bnb',         loc: '-26.2041,28.0473' },
  { q: 'BnB accommodation Johannesburg',     city: 'Johannesburg', province: 'GP', category: 'bnb',         loc: '-26.2041,28.0473' },
  { q: 'boutique hotel Sandton',             city: 'Sandton',      province: 'GP', category: 'hotel',       loc: '-26.1076,28.0567' },
  { q: 'lounge bar Johannesburg nightlife',  city: 'Johannesburg', province: 'GP', category: 'bar',         loc: '-26.2041,28.0473' },
  { q: 'entertainment venue Midrand',        city: 'Midrand',      province: 'GP', category: 'venue',       loc: '-25.9989,28.1289' },
  { q: 'shisanyama Alexandra Johannesburg',  city: 'Alexandra',    province: 'GP', category: 'shisanyama',  loc: '-26.1046,28.0920' },
];

function categoryFromTypes(types = []) {
  if (types.includes('night_club') || types.includes('casino')) return 'club';
  if (types.includes('lodging') && !types.includes('hotel')) return 'bnb';
  if (types.includes('lodging')) return 'hotel';
  if (types.includes('food') || types.includes('restaurant')) return 'shisanyama';
  if (types.includes('event_venue')) return 'venue';
  return null;
}

async function run() {
  let inserted = 0, skipped = 0, errors = 0;

  for (const q of QUERIES) {
    console.log(`\n🔍 "${q.q}"`);
    const res = await placesSearch(q.q, q.loc);
    const places = res.results || [];
    console.log(`  Found ${places.length} results`);

    for (const place of places.slice(0, 10)) {
      const name = place.name;
      if (!name) continue;

      const { count } = await sb.from('scraped_leads')
        .select('id', { count: 'exact', head: true })
        .eq('name', name).eq('city', q.city);
      if (count > 0) { skipped++; continue; }

      await sleep(100);
      const det = await placeDetails(place.place_id);

      const category = q.category || categoryFromTypes(place.types) || 'venue';
      const { error } = await sb.from('scraped_leads').insert({
        name,
        category,
        city:          q.city,
        province:      q.province,
        phone:         det.formatted_phone_number || null,
        website:       det.website || null,
        description:   `${category.charAt(0).toUpperCase() + category.slice(1)} in ${q.city}. Rating: ${place.rating || 'N/A'} (${place.user_ratings_total || 0} reviews).`,
        source:        'google',
        status:        'new',
      });

      if (error) { console.warn(`  Error inserting ${name}:`, error.message); errors++; }
      else { console.log(`  + ${name}`); inserted++; }

      await sleep(200);
    }
  }

  console.log(`\n✅ Done — Inserted: ${inserted}  Skipped: ${skipped}  Errors: ${errors}`);
}

run().catch(e => { console.error(e); process.exit(1); });
