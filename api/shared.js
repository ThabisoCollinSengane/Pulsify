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

module.exports = { sb, sbAs, tokenFrom, CORS, haverBox, verifyToken, authUser, logAdminAction };
