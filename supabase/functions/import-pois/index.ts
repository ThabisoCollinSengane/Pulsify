import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';

// ── import-pois ──────────────────────────────────────────────────────────────
// Ingest endpoint for the Apify Google Maps Scraper. Receives scraped places,
// maps them to Pulsify POI categories, validates SA bounds, and upserts into the
// `pois` table (deduped on a deterministic id so re-runs don't create duplicates).
//
// Auth: pass ?secret=<POI_IMPORT_SECRET>. verify_jwt is disabled because Apify
// can't mint a Supabase JWT — the shared secret guards the endpoint instead.
//
// Accepts (POST body), in priority order:
//   1. A raw JSON array of place items
//   2. { items: [...] } or { data: [...] }
//   3. An Apify webhook envelope { resource: { defaultDatasetId } } — the dataset
//      is fetched from the Apify API (requires APIFY_TOKEN env to be set)
// ─────────────────────────────────────────────────────────────────────────────

const IMPORT_SECRET = Deno.env.get('POI_IMPORT_SECRET') || 'pulsify_poi_2026';
const SUPABASE_URL  = Deno.env.get('SUPABASE_URL') || 'https://cjzewfvtdayjgjdpdmln.supabase.co';
const SERVICE_KEY   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const APIFY_TOKEN   = Deno.env.get('APIFY_TOKEN') || '';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// South Africa bounding box (Hard rule #5)
const SA = { latMin: -35, latMax: -22, lonMin: 16, lonMax: 33 };

// Map a Google Maps category string → Pulsify POI category. Returns null to skip
// places that aren't one of our useful civic categories.
function mapCategory(raw: string): string | null {
  const c = (raw || '').toLowerCase();
  if (/taxi|minibus|rank/.test(c))                               return 'taxi_rank';
  if (/\batm\b|cash machine|cashpoint/.test(c))                  return 'atm';
  if (/gas station|petrol|filling station|fuel|service station/.test(c)) return 'fuel';
  if (/pharmac|chemist|drugstore|dispensary/.test(c))            return 'pharmacy';
  if (/supermarket|grocer|hypermarket/.test(c))                  return 'supermarket';
  if (/bus (stop|station)|brt|transit station|bus rapid/.test(c)) return 'bus_stop';
  if (/clinic|hospital|medical cent|day hospital|chc/.test(c))   return 'clinic';
  return null;
}

// Stable short hash (djb2) → deterministic id so re-imports upsert, not duplicate.
function hashId(name: string, lat: number, lon: number): string {
  const s = `${name.toLowerCase().trim()}|${lat.toFixed(4)}|${lon.toFixed(4)}`;
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return `apify_${h.toString(36)}`;
}

// Normalise one Apify Google Maps item into a `pois` row, or null to skip it.
function normalize(item: any): any | null {
  const name = item.title || item.name || item.placeName;
  if (!name) return null;

  const lat = Number(item.location?.lat ?? item.lat ?? item.latitude);
  const lon = Number(item.location?.lng ?? item.lng ?? item.lon ?? item.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat < SA.latMin || lat > SA.latMax || lon < SA.lonMin || lon > SA.lonMax) return null;

  // categoryName is the primary signal; fall back to the categories array.
  const catRaw = item.categoryName || (Array.isArray(item.categories) ? item.categories.join(' ') : '') || '';
  const category = mapCategory(catRaw);
  if (!category) return null;

  return {
    id: hashId(name, lat, lon),
    name: String(name).slice(0, 120),
    category,
    lat, lon,
    address: item.address || item.street || null,
    city: item.city || item.locatedIn || null,
    province: item.state || null,
    is_verified: true,   // sourced from Google Maps via Apify — authoritative
    is_active: true,
    votes: 0,
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });

  const url = new URL(req.url);
  const secret = url.searchParams.get('secret') || req.headers.get('x-import-secret') || '';
  if (secret !== IMPORT_SECRET) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'POST only' }), {
      status: 405, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  // ── Resolve the list of scraped items from whatever shape Apify sent ──
  let items: any[] = [];
  let body: any = null;
  try { body = await req.json(); } catch { /* empty/invalid body handled below */ }

  if (Array.isArray(body)) {
    items = body;
  } else if (body && Array.isArray(body.items)) {
    items = body.items;
  } else if (body && Array.isArray(body.data)) {
    items = body.data;
  } else if (body?.resource?.defaultDatasetId && APIFY_TOKEN) {
    // Apify webhook envelope — pull the dataset items from the Apify API.
    const dsId = body.resource.defaultDatasetId;
    try {
      const r = await fetch(
        `https://api.apify.com/v2/datasets/${dsId}/items?clean=true&format=json&token=${APIFY_TOKEN}`,
        { signal: AbortSignal.timeout(30000) },
      );
      if (r.ok) items = await r.json();
    } catch (e) {
      return new Response(JSON.stringify({ error: 'Failed to fetch Apify dataset', detail: String(e) }), {
        status: 502, headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }
  }

  if (!items.length) {
    return new Response(JSON.stringify({
      success: false,
      message: 'No items found. Send a JSON array of places, { items: [...] }, or an Apify webhook envelope (with APIFY_TOKEN set).',
    }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }

  // ── Normalise + dedupe ──
  const seen = new Set<string>();
  const rows: any[] = [];
  let skipped = 0;
  for (const item of items) {
    const row = normalize(item);
    if (!row) { skipped++; continue; }
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    rows.push(row);
  }

  if (!rows.length) {
    return new Response(JSON.stringify({
      success: true, imported: 0, skipped, received: items.length,
      message: 'No items matched a POI category within SA bounds.',
    }), { headers: { ...CORS, 'Content-Type': 'application/json' } });
  }

  // ── Upsert (don't overwrite community vote counts on existing rows) ──
  const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  let imported = 0;
  const BATCH = 200;
  const errors: string[] = [];
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH).map(({ votes, ...keep }) => keep); // preserve existing votes
    const { error } = await sb.from('pois').upsert(chunk, { onConflict: 'id', ignoreDuplicates: false });
    if (error) errors.push(error.message);
    else imported += chunk.length;
  }

  return new Response(JSON.stringify({
    success: errors.length === 0,
    received: items.length,
    imported,
    skipped,
    errors: errors.length ? errors : undefined,
  }), { headers: { ...CORS, 'Content-Type': 'application/json' } });
});
