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

module.exports = { sb, sbAs, tokenFrom, CORS, haverBox, verifyToken, authUser, logAdminAction, rateLimit, rateLimited, captureError };
