const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const SUPA_URL  = process.env.SUPABASE_URL  || 'https://cjzewfvtdayjgjdpdmln.supabase.co';
const SUPA_ANON = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNqemV3ZnZ0ZGF5amdqZHBkbWxuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU4NTg0MjYsImV4cCI6MjA5MTQzNDQyNn0.KQ80RmaB6cfA0dkcT-pdTe53fwyUrrIBeVJtToWF_Mk';
const SUPA_SVC  = process.env.SUPABASE_SERVICE_KEY || SUPA_ANON;

const sb = () => createClient(SUPA_URL, SUPA_SVC,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const sbAs = (token) => {
  if (!token) return sb();
  return createClient(SUPA_URL, SUPA_ANON, {
    global: { headers: { Authorization: 'Bearer ' + token } },
    auth: { autoRefreshToken: false, persistSession: false }
  });
};

const tokenFrom = (req) => (req.headers.authorization || '').replace('Bearer ', '').trim();

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
};

// Production CORS: reflect the request origin only when it's an allowed origin
// (production domain, any *.vercel.app deploy/preview, or localhost for dev),
// otherwise fall back to the canonical production origin. Same-origin app
// traffic is unaffected — browsers don't enforce CORS on same-origin requests.
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'https://pulsefy.co.za,https://www.pulsefy.co.za')
  .split(',').map(s => s.trim()).filter(Boolean);

function corsHeaders(req) {
  const origin = (req.headers.origin || '').trim();
  const allowed = ALLOWED_ORIGINS.includes(origin)
    || /^https:\/\/[a-z0-9-]+\.vercel\.app$/i.test(origin)
    || /^http:\/\/localhost(:\d+)?$/i.test(origin);
  return {
    'Access-Control-Allow-Origin': allowed ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Vary': 'Origin',
  };
}

/* ─── QR ticket signing (HMAC-SHA256) ─────────────────────────
   Single source of truth so the issuing endpoints (api/index.js,
   api/payments) and the validating endpoint sign/verify with the
   same secret. Never emit an unsigned/literal sentinel — a forged
   QR must fail verification. */
const QR_SECRET = process.env.QR_SECRET || 'pulsefy-qr-fallback-secret';

function signQr(bookingRef, eventId) {
  return crypto.createHmac('sha256', QR_SECRET).update(`${bookingRef}:${eventId}`).digest('hex').slice(0, 16);
}

function verifyQr(bookingRef, eventId, sig) {
  return signQr(bookingRef, eventId) === sig;
}

/* ─── Geocoding (Mapbox primary, Nominatim fallback) ──────────
   Restricted to South Africa and validated against SA bounds
   (lat -35..-22, lon 16..33) so a bad lookup can never persist an
   off-map coordinate. Returns { lat, lon } or null. Mapbox gives
   better POI/address coverage; Nominatim is the keyless fallback.
   One lookup per call — respect Nominatim's ~1 req/sec if batching. */
const MAPBOX_TOKEN = process.env.MAPBOX_TOKEN || 'pk.eyJ1IjoidGhhY29sbGluMiIsImEiOiJjbW51Mm95cHEwYm8xMnJyMXEzaXgxMDBmIn0.nF80wBOn-jxhjpAIus9anw';

function inSABounds(lat, lon) {
  return !isNaN(lat) && !isNaN(lon) && lat >= -35 && lat <= -22 && lon >= 16 && lon <= 33;
}

async function geocodeMapbox(query) {
  if (!MAPBOX_TOKEN) return null;
  try {
    const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json`
      + `?access_token=${MAPBOX_TOKEN}&country=za&types=poi,address,place&limit=1`;
    const r = await fetch(url);
    if (!r.ok) return null;
    const d = await r.json().catch(() => null);
    const center = d?.features?.[0]?.center;
    if (!Array.isArray(center)) return null;
    const lon = Number(center[0]), lat = Number(center[1]);
    return inSABounds(lat, lon) ? { lat, lon } : null;
  } catch (_) { return null; }
}

async function geocodeNominatim(query) {
  try {
    const r = await fetch('https://nominatim.openstreetmap.org/search?' + new URLSearchParams({
      q: query, format: 'json', limit: '1', countrycodes: 'za',
    }), { headers: { 'User-Agent': 'Pulsefy/2.0 (https://pulsefy.co.za)' } });
    if (!r.ok) return null;
    const results = await r.json().catch(() => []);
    if (!Array.isArray(results) || !results.length) return null;
    const lat = parseFloat(results[0].lat), lon = parseFloat(results[0].lon);
    return inSABounds(lat, lon) ? { lat, lon } : null;
  } catch (_) { return null; }
}

async function geocodeSA(query) {
  const q = (query || '').trim();
  if (!q) return null;
  return (await geocodeMapbox(q)) || (await geocodeNominatim(q));
}

function haverBox(lat, lon, km) {
  const R = 111, d = km / R, dl = km / (R * Math.cos(lat * Math.PI / 180));
  return { minLat: lat - d, maxLat: lat + d, minLon: lon - dl, maxLon: lon + dl };
}

async function verifyToken(token) {
  if (!token) return null;
  try {
    const userSb = createClient(SUPA_URL, SUPA_ANON,
      { auth: { autoRefreshToken: false, persistSession: false } });
    const { data: { user } } = await userSb.auth.getUser(token);
    return user || null;
  } catch { return null; }
}

async function authUser(req) {
  const token = (req.headers.authorization || '').replace('Bearer ', '').trim();
  if (!token) return null;
  try {
    const userSb = createClient(SUPA_URL, SUPA_ANON,
      { auth: { autoRefreshToken: false, persistSession: false } });
    const { data: { user }, error } = await userSb.auth.getUser(token);
    if (error || !user) return null;
    const { data: profile } = await sb().from('profiles').select('*').eq('id', user.id).single();
    if (profile?.suspended) return null;
    return { user, profile: profile || { id: user.id, role: 'user' } };
  } catch(e) {
    return null;
  }
}

async function logAdminAction(adminId, adminName, actionType, targetId, targetName, details) {
  try {
    await sb().from('admin_activity_log').insert({
      admin_id: adminId, admin_name: adminName || 'Admin',
      action_type: actionType, target_id: String(targetId || ''),
      target_name: targetName || null, details: details || null,
    });
  } catch(e) { /* non-fatal */ }
}

/* ─── Rate limiting ───────────────────────────────────────────
   In-memory sliding window. NOTE: state lives in a single warm
   serverless instance, so limits are per-instance, not globally
   exact. Good enough to blunt bursts/abuse; for hard global limits
   move to Vercel KV / Upstash Redis. */
const _rlHits = new Map();
function rateLimit(req, { limit = 100, windowMs = 60000 } = {}) {
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
           || req.socket?.remoteAddress || 'unknown';
  const now = Date.now();
  const rec = _rlHits.get(ip);
  if (!rec || now > rec.reset) {
    _rlHits.set(ip, { count: 1, reset: now + windowMs });
    if (_rlHits.size > 5000) for (const [k, v] of _rlHits) if (now > v.reset) _rlHits.delete(k);
    return { ok: true };
  }
  rec.count++;
  if (rec.count > limit) return { ok: false, retryAfter: Math.ceil((rec.reset - now) / 1000) };
  return { ok: true };
}
// Applies the limit and writes a 429 if exceeded. Returns true if the request was blocked.
function rateLimited(req, res, opts) {
  const r = rateLimit(req, opts);
  if (r.ok) return false;
  res.setHeader('Retry-After', r.retryAfter);
  res.status(429).json({ error: 'Too many requests — slow down.' });
  return true;
}

/* ─── Request body validation ─────────────────────────────────
   Tiny declarative validator so endpoints stop hand-rolling inline
   `if (!x) return 400` checks. Spec is { field: rule } where rule =
   { type, required, default, min, max, minLen, maxLen, enum }.
   type ∈ 'string' | 'int' | 'number' | 'email' | 'bool' (default 'string').
   Returns { ok, errors, value } — value holds trimmed/coerced/defaulted
   fields. Empty string / null / undefined count as "missing". */
function validateBody(body, spec) {
  const src = body || {};
  const value = {}, errors = [];
  for (const [key, rule] of Object.entries(spec)) {
    const raw = src[key];
    if (raw === undefined || raw === null || raw === '') {
      if (rule.default !== undefined) value[key] = rule.default;
      else if (rule.required)         errors.push(`${key} is required`);
      continue;
    }
    switch (rule.type) {
      case 'int':
      case 'number': {
        const n = rule.type === 'int' ? parseInt(raw, 10) : Number(raw);
        if (Number.isNaN(n))                              { errors.push(`${key} must be a ${rule.type === 'int' ? 'whole number' : 'number'}`); break; }
        if (rule.min !== undefined && n < rule.min)       { errors.push(`${key} must be at least ${rule.min}`); break; }
        if (rule.max !== undefined && n > rule.max)       { errors.push(`${key} must be at most ${rule.max}`); break; }
        value[key] = n; break;
      }
      case 'email': {
        const s = String(raw).trim();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) { errors.push(`${key} must be a valid email`); break; }
        value[key] = s.slice(0, rule.maxLen || 254); break;
      }
      case 'bool':
        value[key] = raw === true || raw === 'true' || raw === 1 || raw === '1';
        break;
      default: { // 'string'
        let s = String(raw).trim();
        if (rule.enum && !rule.enum.includes(s)) { errors.push(`${key} must be one of: ${rule.enum.join(', ')}`); break; }
        if (rule.minLen && s.length < rule.minLen) { errors.push(`${key} must be at least ${rule.minLen} characters`); break; }
        if (rule.maxLen) s = s.slice(0, rule.maxLen);
        value[key] = s; break;
      }
    }
  }
  return { ok: errors.length === 0, errors, value };
}

// Validate req.body against spec; on failure writes a 400 and returns null.
// On success returns the coerced value object. Usage:
//   const v = validate(req, res, { event_id: { required: true } });
//   if (!v) return;            // 400 already sent
function validate(req, res, spec) {
  const r = validateBody(req.body, spec);
  if (!r.ok) { res.status(400).json({ error: r.errors[0], errors: r.errors }); return null; }
  return r.value;
}

/* ─── Feature flags ───────────────────────────────────────────
   DB-backed toggle table. Short in-process cache (30s) so a flag
   check doesn't add a DB round-trip to every request. Cache is
   per warm serverless instance — not globally consistent, but good
   enough for gradual rollouts. Defaults to false on any error so
   flags fail closed (feature off) rather than open. */
const _flagCache = new Map(); // key → { enabled, exp }
async function flagEnabled(key) {
  const now = Date.now();
  const hit = _flagCache.get(key);
  if (hit && now < hit.exp) return hit.enabled;
  try {
    const { data } = await sb().from('feature_flags').select('enabled').eq('key', key).maybeSingle();
    const enabled = data?.enabled ?? false;
    _flagCache.set(key, { enabled, exp: now + 30000 });
    return enabled;
  } catch (_) { return false; }
}

/* ─── Error monitoring (Sentry, optional) ─────────────────────
   Inert unless SENTRY_DSN is set in the environment. */
let _sentry = null, _sentryInit = false;
function captureError(err, context) {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) { console.error('[error]', err?.message || err); return; }
  try {
    if (!_sentryInit) { _sentry = require('@sentry/node'); _sentry.init({ dsn, tracesSampleRate: 0.1 }); _sentryInit = true; }
    _sentry.captureException(err, context ? { extra: context } : undefined);
  } catch (e) { console.error('[error]', err?.message || err); }
}

module.exports = { sb, sbAs, tokenFrom, CORS, corsHeaders, haverBox, geocodeSA, signQr, verifyQr, verifyToken, authUser, logAdminAction, rateLimit, rateLimited, captureError, validateBody, validate, flagEnabled };
