/* ═══════════════════════════════════════════════════════════
   PULSIFY — storage.js  v3
   Complete localStorage data layer.
   Every function is a drop-in replacement point for Supabase.
   ═══════════════════════════════════════════════════════════ */

/* ── Keys ─────────────────────────────────────────────────── */
const K = {
  USER:      'p_user',
  PROFILE:   'p_profile',
  ALL_USERS: 'p_all_users',    // mock "database" of all users
  ALL_POSTS: 'p_all_posts',    // global post feed
  ATTENDED:  'p_attended',
  MY_EVENTS: 'p_my_events',
  FOLLOWING: 'p_following',    // array of user IDs this user follows
  FOLLOWERS: 'p_followers',    // map: userId → array of follower IDs
  SAVED_EV:  'p_sev',
  SAVED_BZ:  'p_sbiz',
  NOTIF:     'p_notif',
  PRIVACY:   'p_privacy',
};

/* ── Generic ──────────────────────────────────────────────── */
function _get(k)      { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } }
function _set(k, v)   { localStorage.setItem(k, JSON.stringify(v)); }
function _uid()       { return 'id_' + Date.now() + '_' + Math.random().toString(36).slice(2,7); }

/* ═══════════════════════════════════════════════════════════
   SESSION
   ═══════════════════════════════════════════════════════════ */
function saveUser(u)  { _set(K.USER, u); }
function getUser()    { return _get(K.USER); }
function clearUser()  { localStorage.removeItem(K.USER); }
function isLoggedIn() { const u=getUser(); return !!(u&&u.id&&u.email); }
function isOrganizer(){ return ['organizer','admin'].includes(getUser()?.role); }
function isAdmin()    { return getUser()?.role==='admin'; }
function requireAuth(r='signin.html'){ if(!isLoggedIn()){window.location.href=r;return false;} return true; }
function logout()     { clearUser(); window.location.href='signin.html'; }

/* ═══════════════════════════════════════════════════════════
   PROFILE
   ═══════════════════════════════════════════════════════════ */
function saveProfile(p){ _set(K.PROFILE, p); _updateAllUsers(p); }
function getProfile()  { return _get(K.PROFILE); }

function _updateAllUsers(profile) {
  const all = _get(K.ALL_USERS) || {};
  if (profile.user_id) all[profile.user_id] = profile;
  _set(K.ALL_USERS, all);
}
function getPublicProfile(userId) {
  const all = _get(K.ALL_USERS) || {};
  return all[userId] || null;
}
function getAllOrganizers() {
  const all = _get(K.ALL_USERS) || {};
  return Object.values(all).filter(p => p.role === 'organizer' || p.is_page);
}

/* ═══════════════════════════════════════════════════════════
   POSTS  — full data model
   post: { id, user_id, username, display_name, avatar_url,
           event_id?, event_name?, image_url?, caption,
           likes[], comments[], reposts[], timestamp,
           is_organizer_post, visibility }
   ═══════════════════════════════════════════════════════════ */
function getAllPosts()   { return _get(K.ALL_POSTS) || []; }
function _saveAllPosts(p){ _set(K.ALL_POSTS, p); }

function savePost(post) {
  const posts = getAllPosts();
  posts.unshift(post);
  _saveAllPosts(posts);
  return post;
}

function createPost({ caption, image_url, event_id, event_name, visibility='public' }) {
  const user    = getUser() || {};
  const profile = getProfile() || {};
  const post = {
    id:               _uid(),
    user_id:          user.id,
    username:         profile.username || user.email?.split('@')[0] || 'user',
    display_name:     profile.display_name || user.display_name || 'Pulsify User',
    avatar_url:       profile.avatar_url || null,
    is_organizer_post:isOrganizer(),
    role:             user.role || 'user',
    event_id:         event_id  || null,
    event_name:       event_name|| null,
    image_url:        image_url || null,
    caption:          caption   || '',
    likes:            [],   // array of user IDs
    comments:         [],   // [{ id, user_id, username, text, timestamp }]
    reposts:          [],   // array of user IDs
    timestamp:        new Date().toISOString(),
    visibility,             // 'public' | 'followers' | 'private'
  };
  savePost(post);
  return post;
}

function getPostById(id) {
  return getAllPosts().find(p => p.id === id) || null;
}

function deletePost(id) {
  _saveAllPosts(getAllPosts().filter(p => p.id !== id));
}

/* User's own posts */
function getMyPosts() {
  const uid = getUser()?.id;
  return getAllPosts().filter(p => p.user_id === uid);
}

/* Posts by a specific user (for their profile page) */
function getPostsByUser(userId) {
  return getAllPosts().filter(p => p.user_id === userId && p.visibility === 'public');
}

/* Posts linked to an event */
function getPostsByEvent(eventId) {
  return getAllPosts().filter(p => p.event_id === eventId && p.visibility === 'public');
}

/* ═══════════════════════════════════════════════════════════
   FEED  — what the current user sees
   1. Posts from followed pages/users
   2. Public posts from organizers
   3. All public posts (discovery)
   ═══════════════════════════════════════════════════════════ */
function getFeed({ page=1, limit=20, filter='all' }={}) {
  const uid      = getUser()?.id;
  const following= getFollowing();
  let   posts    = getAllPosts().filter(p => p.visibility === 'public');

  if (filter === 'following') {
    posts = posts.filter(p => following.includes(p.user_id) || p.user_id === uid);
  } else if (filter === 'organizers') {
    posts = posts.filter(p => p.is_organizer_post);
  }

  // Sort: followed pages first, then by timestamp
  posts.sort((a, b) => {
    const aF = following.includes(a.user_id) ? 1 : 0;
    const bF = following.includes(b.user_id) ? 1 : 0;
    if (bF !== aF) return bF - aF;
    return new Date(b.timestamp) - new Date(a.timestamp);
  });

  const total = posts.length;
  const start = (page - 1) * limit;
  return {
    posts:       posts.slice(start, start + limit),
    total,
    page,
    total_pages: Math.ceil(total / limit),
    has_next:    start + limit < total,
  };
}

/* ═══════════════════════════════════════════════════════════
   REACTIONS
   ═══════════════════════════════════════════════════════════ */
function likePost(postId) {
  const posts = getAllPosts();
  const post  = posts.find(p => p.id === postId);
  if (!post) return false;
  const uid = getUser()?.id;
  if (!uid) return false;
  const idx = (post.likes||[]).indexOf(uid);
  if (idx > -1) post.likes.splice(idx, 1);   // unlike
  else          (post.likes = post.likes||[]).push(uid);  // like
  _saveAllPosts(posts);
  return post.likes.includes(uid);            // returns new liked state
}

function isLiked(post) {
  const uid = getUser()?.id;
  return uid && (post.likes||[]).includes(uid);
}

function commentOnPost(postId, text) {
  if (!text?.trim()) return null;
  const posts = getAllPosts();
  const post  = posts.find(p => p.id === postId);
  if (!post) return null;
  const user    = getUser()    || {};
  const profile = getProfile() || {};
  const comment = {
    id:          _uid(),
    user_id:     user.id,
    username:    profile.username || user.email?.split('@')[0] || 'user',
    display_name:profile.display_name || 'User',
    avatar_url:  profile.avatar_url || null,
    text:        text.trim(),
    timestamp:   new Date().toISOString(),
  };
  (post.comments = post.comments||[]).push(comment);
  _saveAllPosts(posts);
  return comment;
}

function repostPost(postId) {
  const posts = getAllPosts();
  const post  = posts.find(p => p.id === postId);
  if (!post) return false;
  const uid = getUser()?.id;
  if (!uid) return false;
  const idx = (post.reposts||[]).indexOf(uid);
  if (idx > -1) post.reposts.splice(idx, 1);
  else          (post.reposts = post.reposts||[]).push(uid);
  _saveAllPosts(posts);
  return post.reposts.includes(uid);
}

/* ═══════════════════════════════════════════════════════════
   FOLLOW SYSTEM
   ═══════════════════════════════════════════════════════════ */
function getFollowing()   { return _get(K.FOLLOWING) || []; }
function getFollowerMap() { return _get(K.FOLLOWERS) || {}; }

function followPage(targetUserId) {
  if (!isLoggedIn()) return false;
  const uid      = getUser().id;
  const following= getFollowing();
  const idx      = following.indexOf(targetUserId);
  if (idx > -1) following.splice(idx, 1);  // unfollow
  else          following.push(targetUserId); // follow
  _set(K.FOLLOWING, following);

  // Update follower map
  const map = getFollowerMap();
  map[targetUserId] = map[targetUserId] || [];
  const fidx = map[targetUserId].indexOf(uid);
  if (fidx > -1) map[targetUserId].splice(fidx, 1);
  else           map[targetUserId].push(uid);
  _set(K.FOLLOWERS, map);

  return following.includes(targetUserId);  // new follow state
}

function isFollowing(targetUserId) {
  return getFollowing().includes(targetUserId);
}

function getFollowerCount(userId) {
  const map = getFollowerMap();
  return (map[userId]||[]).length;
}

/* ═══════════════════════════════════════════════════════════
   EVENTS ATTENDED
   ═══════════════════════════════════════════════════════════ */
function getAttended()    { return _get(K.ATTENDED) || []; }
function addAttended(ev)  {
  const list = getAttended();
  if (!list.find(e => e.event_id === ev.id)) {
    list.unshift({ event_id:ev.id, name:ev.name, venue_city:ev.venue_city,
      date_local:ev.date_local, image_url:ev.image_url, genre:ev.genre,
      attended_at:new Date().toISOString() });
    _set(K.ATTENDED, list);
  }
}

/* ═══════════════════════════════════════════════════════════
   ORGANIZER EVENTS  (create-event model)
   ═══════════════════════════════════════════════════════════ */
function getMyEvents()    { return _get(K.MY_EVENTS) || []; }
function addMyEvent(ev)   {
  const list = getMyEvents();
  ev.id          = _uid();
  ev.organiser_id= getUser()?.id;
  ev.created_at  = new Date().toISOString();
  ev.status      = 'draft';
  list.unshift(ev);
  _set(K.MY_EVENTS, list);
  return ev;
}

/* ═══════════════════════════════════════════════════════════
   NOTIFICATION & PRIVACY PREFS
   ═══════════════════════════════════════════════════════════ */
const NOTIF_DEF = { email_event_reminder:true, email_booking_conf:true, email_new_follower:true, sms_event_reminder:false, sms_booking_conf:false, push_squad_message:true, push_new_follower:true };
const PRIV_DEF  = { profile_public:true, show_email:false, who_can_comment:'everyone', show_attended:true };

function getNotifPrefs()    { return {...NOTIF_DEF, ...(_get(K.NOTIF)||{})}; }
function saveNotifPrefs(p)  { _set(K.NOTIF, p); }
function getPrivacy()       { return {...PRIV_DEF,  ...(_get(K.PRIVACY)||{})}; }
function savePrivacy(p)     { _set(K.PRIVACY, p); }

/* ═══════════════════════════════════════════════════════════
   SAVED ITEMS
   ═══════════════════════════════════════════════════════════ */
function getSavedEvents()     { return _get(K.SAVED_EV)  || []; }
function getSavedBusinesses() { return _get(K.SAVED_BZ)  || []; }

/* ═══════════════════════════════════════════════════════════
   AUTH MOCK
   ═══════════════════════════════════════════════════════════ */
async function mockSignIn(email, password) {
  // Replace: const {data,error} = await supabase.auth.signInWithPassword({email,password})
  if (!email||!password) throw new Error('Email and password required');
  const u = getUser();
  if (u && u.email===email) {
    u.last_login = new Date().toISOString();
    saveUser(u); return u;
  }
  throw new Error('No account found. Please sign up first.');
}

async function mockSignUp(fields) {
  // Replace: const {data,error} = await supabase.auth.signUp(...)
  const { fullName,username,email,password,dob,phone,province,city,
          genres,agreeTerms,isOrg,avatarUrl } = fields;
  if (!agreeTerms)               throw new Error('Please accept the Terms & Privacy Policy.');
  if (!email||!password||!fullName) throw new Error('Name, email and password are required.');
  if (dob) {
    const age = Math.floor((Date.now()-new Date(dob))/31557600000);
    if (age<13) throw new Error('You must be at least 13 years old to join.');
    if (age<18 && isOrg) throw new Error('You must be 18+ to register as an organizer.');
  }
  const userId = _uid();
  const role   = isOrg ? 'organizer' : 'user';
  const user = {
    id:             userId, email, role,
    display_name:   fullName,
    account_status: 'active',
    email_verified: false,
    is_page:        isOrg,
    always_public:  isOrg,
    created_at:     new Date().toISOString(),
    last_login:     new Date().toISOString(),
  };
  const profile = {
    user_id:      userId, username: username||'user_'+userId.slice(-6),
    display_name: fullName, email, role, is_page: isOrg,
    dob: dob||null, phone: phone||null, province: province||'',
    city: city||'', genres: genres||[], avatar_url: avatarUrl||null, bio:'',
    agree_terms:true, terms_date: new Date().toISOString(),
  };
  saveUser(user); saveProfile(profile);
  saveNotifPrefs(NOTIF_DEF); savePrivacy(PRIV_DEF);
  return { user, profile };
}

/* ═══════════════════════════════════════════════════════════
   UTILITIES
   ═══════════════════════════════════════════════════════════ */
function timeAgo(iso) {
  if (!iso) return '';
  const d = Math.floor((Date.now()-new Date(iso))/1000);
  if (d<60)   return 'just now';
  if (d<3600) return Math.floor(d/60)+'m ago';
  if (d<86400)return Math.floor(d/3600)+'h ago';
  if (d<604800)return Math.floor(d/86400)+'d ago';
  return new Date(iso).toLocaleDateString('en-ZA',{day:'numeric',month:'short'});
}
function formatDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-ZA',{day:'numeric',month:'short',year:'numeric'});
}
function escHtml(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

/* ── Seed demo data if feed is empty ─────────────────────── */
function seedDemoData() {
  if (getAllPosts().length > 0) return;
  const demos = [
    { id:'demo1', user_id:'org_eyadini', username:'eyadini_lounge', display_name:'Eyadini Lounge', avatar_url:null, is_organizer_post:true, role:'organizer', event_id:'ev_gqom_eves', event_name:"Gqom Takeover — Eve's Lounge", image_url:'https://images.unsplash.com/photo-1429962714451-bb934ecdc4ec?w=800&q=80', caption:'🔊 TONIGHT we go hard. Gqom Takeover starts at 9PM. Doors open at 8. Early birds save R40 on the door. See you on the floor 🙌', likes:['u1','u2','u3','u4','u5'], comments:[{id:'c1',user_id:'u1',username:'sipho_kzn',display_name:'Sipho M',text:"Can't wait, been looking forward to this all week 🔥",timestamp:new Date(Date.now()-7200000).toISOString()},{id:'c2',user_id:'u2',username:'nandik',display_name:'Nandi K',text:'Already got my ticket! Who else is coming from Hillcrest?',timestamp:new Date(Date.now()-3600000).toISOString()}], reposts:['u2','u3'], timestamp:new Date(Date.now()-14400000).toISOString(), visibility:'public' },
    { id:'demo2', user_id:'u3', username:'djthabang', display_name:'DJ Thabang', avatar_url:null, is_organizer_post:false, role:'user', event_id:'ev_amapiano_mabhida', event_name:'Amapiano Sundowner Vol.14', image_url:'https://images.unsplash.com/photo-1470229722913-7c0e2dbbafd3?w=800&q=80', caption:'Last night at Moses Mabhida was INSANE 😮‍💨 Kabza brought something different, the crowd energy was unmatched. Already counting down to Vol.15 🎶', likes:['u1','u4'], comments:[{id:'c3',user_id:'u4',username:'zinhle_d',display_name:'Zinhle D',text:'The views from up top were incredible too 🌃',timestamp:new Date(Date.now()-1800000).toISOString()}], reposts:['u1'], timestamp:new Date(Date.now()-86400000).toISOString(), visibility:'public' },
    { id:'demo3', user_id:'org_galaxy', username:'galaxy_margate', display_name:'Galaxy Nightclub Margate', avatar_url:null, is_organizer_post:true, role:'organizer', event_id:'ev_gqom_margate', event_name:'Margate Gqom Festival', image_url:'https://images.unsplash.com/photo-1518998053901-5348d3961a04?w=800&q=80', caption:"🏖 MARGATE GQOM FESTIVAL — Tickets selling fast! Babes Wodumo, Mampintsha, DJ Lag and Distruction Boyz all on the same night. R150 early bird ends Sunday midnight. Book at the link in bio.", likes:['u1','u2','u5'], comments:[], reposts:['u5'], timestamp:new Date(Date.now()-172800000).toISOString(), visibility:'public' },
    { id:'demo4', user_id:'u1', username:'sipho_kzn', display_name:'Sipho M', avatar_url:null, is_organizer_post:false, role:'user', event_id:null, event_name:null, image_url:'https://images.unsplash.com/photo-1555939594-58d7cb561ad1?w=800&q=80', caption:"Sundays at Eyadini hit different. The pap, the chisa nyama, the music... this is what KZN summers are made of ☀️🥩", likes:['u2','u3'], comments:[{id:'c4',user_id:'u2',username:'nandik',display_name:'Nandi K',text:'The GOAT spot, no competition 👑',timestamp:new Date(Date.now()-900000).toISOString()}], reposts:[], timestamp:new Date(Date.now()-259200000).toISOString(), visibility:'public' },
  ];
  _saveAllPosts(demos);
}
