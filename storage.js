/* ═══════════════════════════════════════════════════════════
   PULSIFY — storage.js  v4
   Unified data layer: real API first, localStorage fallback.
   Supabase Auth handles identity. API handles all data.
   
   HOW IT WORKS:
   1. Every function calls the real /api endpoint first
   2. If the API fails, falls back to localStorage mock
   3. Auth token stored in localStorage as 'p_token'
   4. User profile stored as 'p_user' (same key as before)
   
   SUPABASE SWAP: Already done. Functions call /api/*.
   To go fully live just set SUPABASE_URL + keys on Vercel.
   ═══════════════════════════════════════════════════════════ */

const API = '/api';

/* ── Auth token ──────────────────────────────────────────── */
function getToken()     { return localStorage.getItem('p_token') || ''; }
function setToken(t)    { if(t) localStorage.setItem('p_token', t); }
function clearToken()   { localStorage.removeItem('p_token'); }

function authHeaders() {
  const t = getToken();
  return t ? { 'Content-Type':'application/json', 'Authorization':'Bearer '+t }
           : { 'Content-Type':'application/json' };
}

/* ── Session ─────────────────────────────────────────────── */
function getUser()    { try { return JSON.parse(localStorage.getItem('p_user')); } catch { return null; } }
function saveUser(u)  { localStorage.setItem('p_user', JSON.stringify(u)); }
function getProfile() { try { return JSON.parse(localStorage.getItem('p_profile')); } catch { return null; } }
function saveProfile(p){ localStorage.setItem('p_profile', JSON.stringify(p)); }
function clearUser()  { localStorage.removeItem('p_user'); localStorage.removeItem('p_profile'); clearToken(); }
function isLoggedIn() { const u=getUser(); return !!(u&&u.id); }
function isOrganizer(){ return ['organizer','business','admin'].includes(getUser()?.role); }
function isAdmin()    { return getUser()?.role === 'admin'; }
function requireAuth(r='signin.html'){ if(!isLoggedIn()){window.location.href=r;return false;} return true; }

function logout() {
  clearUser();
  window.location.href = 'signin.html';
}

/* ── Generic fetch with fallback ─────────────────────────── */
async function apiFetch(path, opts={}, fallback=null) {
  try {
    const res = await fetch(API + path, {
      headers: authHeaders(),
      ...opts,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'API error '+res.status);
    }
    return await res.json();
  } catch(e) {
    console.warn('[storage] API failed, using fallback:', e.message);
    return fallback;
  }
}

/* ═══════════════════════════════════════════════════════════
   AUTH — Supabase via API
   ═══════════════════════════════════════════════════════════ */

/* Sign up — calls Supabase Auth then upserts profile via API */
async function signUp({ fullName, username, email, password, dob, phone, province, city, genres, isOrg, avatarUrl }) {
  // Use Supabase JS directly for auth
  const SUPA_URL = 'https://cjzewfvtdayjgjdpdmln.supabase.co';
  const SUPA_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNqemV3ZnZ0ZGF5amdqZHBkbWxuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU4NTg0MjYsImV4cCI6MjA5MTQzNDQyNn0.KQ80RmaB6cfA0dkcT-pdTe53fwyUrrIBeVJtToWF_Mk';

  const authRes = await fetch(`${SUPA_URL}/auth/v1/signup`, {
    method: 'POST',
    headers: { 'Content-Type':'application/json', 'apikey': SUPA_KEY },
    body: JSON.stringify({ email, password, data: { full_name: fullName } }),
  });
  const authData = await authRes.json();
  if (authData.error) throw new Error(authData.error.message || authData.msg || 'Sign up failed');

  const token = authData.access_token || authData.session?.access_token;
  const user  = authData.user || authData.data?.user;
  if (!token || !user) throw new Error('Sign up failed — no session returned');

  setToken(token);

  // Upsert profile via API
  const profileData = await apiFetch('/auth/profile', {
    method: 'POST',
    headers: { 'Content-Type':'application/json', 'Authorization':'Bearer '+token },
    body: {
      profile: {
        username, display_name: fullName, dob, phone, province, city, genres,
        role: isOrg ? 'organizer' : 'user', avatar_url: avatarUrl || null,
      }
    }
  });

  const profile = profileData?.profile || {
    id: user.id, username, display_name: fullName,
    email, role: isOrg ? 'organizer' : 'user', genres, province, city,
  };

  saveUser({ id: user.id, email, display_name: fullName, role: profile.role, created_at: user.created_at });
  saveProfile(profile);
  return { user, profile };
}

/* Sign in */
async function signIn(email, password) {
  const SUPA_URL = 'https://cjzewfvtdayjgjdpdmln.supabase.co';
  const SUPA_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNqemV3ZnZ0ZGF5amdqZHBkbWxuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU4NTg0MjYsImV4cCI6MjA5MTQzNDQyNn0.KQ80RmaB6cfA0dkcT-pdTe53fwyUrrIBeVJtToWF_Mk';

  const authRes = await fetch(`${SUPA_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'Content-Type':'application/json', 'apikey': SUPA_KEY },
    body: JSON.stringify({ email, password }),
  });
  const authData = await authRes.json();
  if (authData.error) throw new Error(authData.error_description || authData.error || 'Sign in failed');

  const token = authData.access_token;
  const user  = authData.user;
  if (!token || !user) throw new Error('Sign in failed');

  setToken(token);

  // Fetch profile from API
  const profileData = await apiFetch('/auth/profile', {
    method: 'POST',
    headers: { 'Content-Type':'application/json', 'Authorization':'Bearer '+token },
    body: {}
  });

  const profile = profileData?.profile || { id: user.id, email, display_name: user.email?.split('@')[0], role: 'user' };

  saveUser({ id: user.id, email, display_name: profile.display_name || user.email?.split('@')[0], role: profile.role, last_login: new Date().toISOString() });
  saveProfile(profile);
  return { user, profile };
}

/* ═══════════════════════════════════════════════════════════
   POSTS — real API with mock fallback
   ═══════════════════════════════════════════════════════════ */

/* Fallback mock posts — shown when API is offline */
const MOCK_POSTS_FALLBACK = [
  { id:'demo1', user_id:'org_eyadini', username:'eyadini_lounge', display_name:'Eyadini Lounge', role:'organizer', post_type:'organizer', image_url:'https://images.unsplash.com/photo-1429962714451-bb934ecdc4ec?w=800&q=80', caption:"🔊 TONIGHT we go HARD. Gqom Takeover at 9PM. Doors open 8PM. Early birds save R40. Umlazi — this is your night!", event_name:'Gqom Takeover', like_count:186, comment_count:24, repost_count:12, created_at:new Date(Date.now()-7200000).toISOString(), is_liked:false, is_reposted:false, profiles:{username:'eyadini_lounge',display_name:'Eyadini Lounge',role:'organizer',is_verified:true} },
  { id:'demo2', user_id:'org_eves', username:'eves_lounge_mthwalume', display_name:"Eve's Lounge", role:'organizer', post_type:'organizer', image_url:'https://images.unsplash.com/photo-1471341971476-ae15ff5dd4ea?w=800&q=80', caption:"South Coast is ALIVE this weekend 🌊 Gqom Takeover Pt.2. DJ Lag + Bello No Gallo + South Coast residents. Doors 8PM", event_name:"Gqom Night — Eve's Lounge Mthwalume", like_count:243, comment_count:31, repost_count:18, created_at:new Date(Date.now()-14400000).toISOString(), is_liked:false, is_reposted:false, profiles:{username:'eves_lounge_mthwalume',display_name:"Eve's Lounge",role:'organizer',is_verified:false} },
  { id:'demo3', user_id:'u_sipho', username:'sipho_kzn', display_name:'Sipho M', role:'user', post_type:'attended_photo', image_url:'https://images.unsplash.com/photo-1470229722913-7c0e2dbbafd3?w=800&q=80', caption:'Amapiano Sundowner Vol.14 at Moses Mabhida was INSANE 😮‍💨 Kabza played until 3AM. Already on the Vol.15 waitlist 🎶', event_name:'Amapiano Sundowner Vol.14', like_count:94, comment_count:12, repost_count:7, created_at:new Date(Date.now()-86400000).toISOString(), is_liked:false, is_reposted:false, profiles:{username:'sipho_kzn',display_name:'Sipho M',role:'user',is_verified:false} },
  { id:'demo4', user_id:'org_galaxy', username:'galaxy_margate', display_name:'Galaxy Nightclub Margate', role:'organizer', post_type:'organizer', image_url:'https://images.unsplash.com/photo-1518998053901-5348d3961a04?w=800&q=80', caption:"🏖 MARGATE GQOM FESTIVAL — Babes Wodumo · Mampintsha · DJ Lag · Distruction Boyz. One stage. One night. R150 early bird ends Sunday.", event_name:'Margate Gqom Festival', like_count:312, comment_count:47, repost_count:29, created_at:new Date(Date.now()-172800000).toISOString(), is_liked:false, is_reposted:false, profiles:{username:'galaxy_margate',display_name:'Galaxy Nightclub Margate',role:'organizer',is_verified:true} },
  { id:'demo5', user_id:'org_joecools', username:'joecools_northbeach', display_name:'Joe Cools Beach Bar', role:'organizer', post_type:'organizer', image_url:'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=800&q=80', caption:"Golden hour on the deck every Friday 🌅 Durban's original beachfront bar. Ice cold beers, fresh air, no cover charge. See you at 5PM.", event_name:null, like_count:128, comment_count:19, repost_count:8, created_at:new Date(Date.now()-259200000).toISOString(), is_liked:false, is_reposted:false, profiles:{username:'joecools_northbeach',display_name:'Joe Cools Beach Bar',role:'organizer',is_verified:true} },
];

async function getFeed({ page=1, limit=10, filter='all' }={}) {
  const data = await apiFetch(`/posts?page=${page}&limit=${limit}&filter=${filter}`);
  if (data?.posts) return data;
  // Fallback
  let posts = [...MOCK_POSTS_FALLBACK];
  if (filter === 'organizers') posts = posts.filter(p => p.role !== 'user');
  if (filter === 'community')  posts = posts.filter(p => p.role === 'user');
  const start = (page-1)*limit;
  return {
    posts: posts.slice(start, start+limit),
    total: posts.length,
    page, limit,
    total_pages: Math.ceil(posts.length/limit),
    has_next: start+limit < posts.length,
  };
}

async function createPost({ caption, image_url, event_id, event_name, post_type, lat, lon, visibility='public' }) {
  const data = await apiFetch('/posts', {
    method:'POST', body:{ caption, image_url, event_id, event_name, post_type, lat, lon, visibility }
  });
  if (data?.post) return data.post;
  // Fallback — save locally
  const user    = getUser() || {};
  const profile = getProfile() || {};
  const post = {
    id: 'local_'+Date.now(), user_id: user.id,
    username: profile.username || 'you', display_name: profile.display_name || user.display_name,
    role: user.role || 'user', post_type: post_type || 'attended_photo',
    image_url, caption, event_id, event_name,
    like_count:0, comment_count:0, repost_count:0,
    created_at: new Date().toISOString(), is_liked:false, is_reposted:false,
    profiles:{ username: profile.username, display_name: profile.display_name, role: user.role, is_verified:false }
  };
  MOCK_POSTS_FALLBACK.unshift(post);
  return post;
}

/* ═══════════════════════════════════════════════════════════
   REACTIONS & REPOSTS
   ═══════════════════════════════════════════════════════════ */
async function toggleLike(entityId, entityType='post') {
  if (!isLoggedIn()) return null;
  const data = await apiFetch('/reactions', {
    method:'POST', body:{ entity_id: entityId, entity_type: entityType, type:'like' }
  });
  return data;
}

async function toggleRepost(postId) {
  if (!isLoggedIn()) return null;
  const data = await apiFetch(`/posts/${postId}/repost`, { method:'POST' });
  return data;
}

/* ═══════════════════════════════════════════════════════════
   COMMENTS
   ═══════════════════════════════════════════════════════════ */
async function getComments(entityType, entityId) {
  const data = await apiFetch(`/comments/${entityType}/${entityId}`);
  return data?.comments || [];
}

async function addComment(entityType, entityId, content) {
  if (!isLoggedIn()) return null;
  const data = await apiFetch('/comments', {
    method:'POST', body:{ entity_type: entityType, entity_id: entityId, content }
  });
  return data?.comment || null;
}

/* ═══════════════════════════════════════════════════════════
   FOLLOWS
   ═══════════════════════════════════════════════════════════ */
async function toggleFollow(targetUserId) {
  if (!isLoggedIn()) return null;
  const data = await apiFetch(`/follow/${targetUserId}`, { method:'POST' });
  return data;
}

async function getFollowing() {
  if (!isLoggedIn()) return [];
  const data = await apiFetch('/following');
  return data?.following || [];
}

/* ═══════════════════════════════════════════════════════════
   ATTENDED EVENTS
   ═══════════════════════════════════════════════════════════ */
async function getAttended() {
  if (!isLoggedIn()) return [];
  const data = await apiFetch('/user/attended');
  if (data?.attended) return data.attended;
  // Fallback localStorage
  try { return JSON.parse(localStorage.getItem('p_attended') || '[]'); } catch { return []; }
}

/* ═══════════════════════════════════════════════════════════
   SAVED ITEMS
   ═══════════════════════════════════════════════════════════ */
async function getSaved(type='event') {
  if (!isLoggedIn()) return [];
  const data = await apiFetch(`/saved?type=${type}`);
  return data?.saved || [];
}

async function toggleSaved(itemId, itemType='event') {
  if (!isLoggedIn()) return null;
  const data = await apiFetch('/saved', { method:'POST', body:{ item_id: itemId, item_type: itemType } });
  return data;
}

/* ═══════════════════════════════════════════════════════════
   BOOKINGS
   ═══════════════════════════════════════════════════════════ */
async function getUserBookings() {
  if (!isLoggedIn()) return [];
  const data = await apiFetch('/user/bookings');
  return data?.bookings || [];
}

/* ═══════════════════════════════════════════════════════════
   NOTIFICATIONS
   ═══════════════════════════════════════════════════════════ */
async function getNotifications() {
  if (!isLoggedIn()) return [];
  const data = await apiFetch('/notifications');
  return data?.notifications || [];
}

/* ═══════════════════════════════════════════════════════════
   UTILITIES
   ═══════════════════════════════════════════════════════════ */
function timeAgo(iso) {
  if (!iso) return '';
  const d = Math.floor((Date.now() - new Date(iso)) / 1000);
  if (d < 60)    return 'just now';
  if (d < 3600)  return Math.floor(d/60)+'m ago';
  if (d < 86400) return Math.floor(d/3600)+'h ago';
  return Math.floor(d/86400)+'d ago';
}
function formatDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-ZA',{day:'numeric',month:'short',year:'numeric'});
}
function escHtml(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
