import sys
import os
import re

def patch_file(file_path, replacements):
    if not os.path.exists(file_path):
        print(f"❌ Error: {file_path} not found.", file=sys.stderr)
        return False
    
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            content = f.read()
    except Exception as e:
        print(f"❌ Error reading {file_path}: {e}", file=sys.stderr)
        return False

    original_content = content
    
    for key, (original, new) in replacements.items():
        if original in content:
            content = content.replace(original, new)
            print(f"✅ Patched '{key}' in {file_path}")
        else:
            if file_path == 'feeds.html' and key == 'script':
                 script_pattern = re.compile(r'<script>(.*?)</script>', re.DOTALL)
                 if script_pattern.search(content):
                     content = script_pattern.sub(f'<script>{new}</script>', content)
                     print(f"✅ Replaced entire script block in {file_path}")
                 else:
                     print(f"⚠️  Could not find <script> block in {file_path}. Cannot patch.")
            else:
                print(f"⚠️  Could not find original block for '{key}' in {file_path}. It may be already patched.")

    if content != original_content:
        try:
            with open(file_path, 'w', encoding='utf-8') as f:
                f.write(content)
            print(f"🚀 Successfully saved changes to {file_path}")
            return True
        except Exception as e:
            print(f"❌ Error writing to {file_path}: {e}", file=sys.stderr)
            return False
    else:
        print(f"No changes made to {file_path}.")
        return True

# --- Replacements for index.html ---
index_replacements = {
    "toggleLike": (
"""function toggleLike(btn) { const ico = btn.querySelector('.ai'), cnt = btn.querySelector('span:last-child'); const liked = btn.classList.toggle('lk'); ico.textContent = liked ? '❤️' : '🤍'; let n = parseInt(cnt.textContent.replace('k','')) * (cnt.textContent.includes('k') ? 1000 : 1); cnt.textContent = fn(liked ? n + 1 : Math.max(0, n - 1)); }""",
"""async function toggleLike(btn, entityId, entityType = 'event') {
  if (!currentUser) return showToast('Sign in to like posts', 'err');
  const sb = getSB();
  const liked = btn.classList.toggle('lk');
  const ico = btn.querySelector('.ai');
  const cntEl = btn.querySelector('span:last-child');
  const currentNum = parseInt(cntEl.textContent.replace('k','')) * (cntEl.textContent.includes('k') ? 1000 : 1);
  
  ico.textContent = liked ? '❤️' : '🤍';
  cntEl.textContent = fn(liked ? currentNum + 1 : Math.max(0, currentNum - 1));

  try {
    if (liked) {
      await sb.from('reactions').insert({ entity_id: entityId, user_id: currentUser.id, entity_type: entityType });
      const { data: entity } = await sb.from(entityType).select('user_id, name').eq('id', entityId).single();
      if (entity && entity.user_id !== currentUser.id) {
        createNotification(entity.user_id, 'like', `${currentUser.display_name || 'Someone'} liked your post.`, entityId, entityType);
      }
    } else {
      await sb.from('reactions').delete().eq('entity_id', entityId).eq('user_id', currentUser.id);
    }
  } catch(e) {
    console.error('Like error:', e);
    btn.classList.toggle('lk');
    ico.textContent = liked ? '🤍' : '❤️';
    cntEl.textContent = fn(currentNum);
    showToast('Error saving like', 'err');
  }
}"""
    ),
    "comments": (
"""const SEED_COMMENTS = [
  { av:'🔥', name:'Sipho M.', text:'This event is always fire 🔥 been going 3 years straight', time:'2h ago' },
  { av:'💃', name:'Nandi K.', text:'Anyone going from Hillcrest? Looking for a squad 👀', time:'4h ago' },
  { av:'🎶', name:'DJ Thabang', text:'The lineup this year is next level! See you on the floor 🎤', time:'5h ago' },
];
function openComments(id, name) { document.getElementById('comment-title').textContent = name; activeComments = [...SEED_COMMENTS]; renderComments(); document.getElementById('comments-overlay').classList.add('open'); setTimeout(() => document.getElementById('comment-input').focus(), 300); }
function closeComments() { document.getElementById('comments-overlay').classList.remove('open'); }
function renderComments() { document.getElementById('comments-list').innerHTML = activeComments.map(c => `<div class="cm"><div class="cav">${c.av}</div><div style="flex:1"><div class="cna">${x(c.name)}</div><div class="ctx">${x(c.text)}</div><div class="ctm">${c.time}</div></div></div>`).join(''); }
function postComment() { const inp = document.getElementById('comment-input'); const val = inp.value.trim(); if (!val) return; activeComments.push({ av:'😊', name:'You', text: val, time:'just now' }); renderComments(); inp.value = ''; document.getElementById('comments-list').scrollTop = 9999; }""",
"""let activeEntityId = null;
let activeEntityType = 'events';

async function openComments(entityId, name, type = 'events') {
  const sb = getSB();
  if (!sb || !currentUser) return showToast('Sign in to view comments', 'err');
  
  activeEntityId = entityId;
  activeEntityType = type;
  
  const overlay = document.getElementById('comments-overlay');
  if (!overlay) {
      const el = document.createElement('div');
      el.innerHTML = `
        <div class="co" id="comments-overlay" onclick="if(event.target===this)closeComments()">
          <div class="cs">
            <div class="ch"><span class="ct" id="comment-title">Comments</span><button class="cc" onclick="closeComments()">✕</button></div>
            <div class="cl" id="comments-list"></div>
            <div class="cir"><input class="ci" id="comment-input" placeholder="Add a comment..." onkeydown="if(event.key==='Enter')postComment()"><button class="csnd" onclick="postComment()">➤</button></div>
          </div>
        </div>`;
      document.body.appendChild(el.firstElementChild);
  }
  
  document.getElementById('comment-title').textContent = 'Comments on ' + name;
  document.getElementById('comments-list').innerHTML = '<div style="padding:20px;text-align:center;color:var(--mu)">Loading...</div>';
  document.getElementById('comments-overlay').classList.add('open');
  
  try {
    const { data, error } = await sb.from('comments').select('*, profiles(username, avatar_url, display_name)').eq('entity_id', entityId).order('created_at', { ascending: true });
    if (error) throw error;
    activeComments = data || [];
    renderComments();
  } catch (e) {
    document.getElementById('comments-list').innerHTML = '<div style="padding:20px;text-align:center;color:var(--pk)">Error loading comments.</div>';
  }
}

function closeComments() {
  const overlay = document.getElementById('comments-overlay');
  if (overlay) overlay.classList.remove('open');
  activeEntityId = null;
}

function renderComments() {
  const listEl = document.getElementById('comments-list');
  if (!listEl) return;
  if (activeComments.length === 0) {
    listEl.innerHTML = '<div style="padding:30px;text-align:center;color:var(--mu)">Be the first to comment.</div>';
    return;
  }
  listEl.innerHTML = activeComments.map(c => {
    const p = c.profiles;
    const av = p?.avatar_url ? `<img src="${x(p.avatar_url)}" style="width:100%;height:100%;object-fit:cover">` : (p?.display_name || '?')[0];
    return `<div class="cm"><div class="cav" style="background:var(--surf2);overflow:hidden;">${av}</div><div><div class="cna">${x(p.display_name)}</div><div class="ctx">${x(c.content)}</div><div class="ctm">${timeAgoShort(c.created_at)}</div></div></div>`;
  }).join('');
  listEl.scrollTop = listEl.scrollHeight;
}

async function postComment() {
  const inp = document.getElementById('comment-input');
  const val = inp.value.trim();
  if (!val || !activeEntityId) return;
  const sb = getSB();
  if (!currentUser) return showToast('Please sign in to comment.', 'err');

  inp.disabled = true;
  try {
    const { data: comment, error } = await sb.from('comments').insert({ user_id: currentUser.id, entity_id: activeEntityId, entity_type: activeEntityType, content: val }).select('*, profiles(username, avatar_url, display_name)').single();
    if (error) throw error;
    activeComments.push(comment);
    renderComments();
    inp.value = '';
    
    const { data: entityOwner } = await sb.from(activeEntityType).select('user_id, name').eq('id', activeEntityId).single();
    if (entityOwner && entityOwner.user_id && entityOwner.user_id !== currentUser.id) {
        createNotification(entityOwner.user_id, 'comment', `${currentUser.display_name || 'Someone'} commented on "${(entityOwner.name || 'your post').slice(0, 25)}..."`, activeEntityId, activeEntityType);
    }
  } catch(e) {
    showToast('Failed to post comment: ' + e.message, 'err');
  } finally {
    inp.disabled = false;
    inp.focus();
  }
}"""
    ),
    "buildCard_onclick": (
        """<button class="ab" onclick="toggleLike(this)"><span class="ai">🤍</span><span>${fn(ev.like_count)}</span></button>
      <button class="ab" onclick="openComments('${x(ev.id)}','${x(ev.name)}')"><span class="ai">💬</span><span>${fn(ev.comment_count)}</span></button>""",
        """<button class="ab" onclick="toggleLike(this, '${x(ev.id)}', 'events')"><span class="ai">🤍</span><span>${fn(ev.like_count)}</span></button>
      <button class="ab" onclick="openComments('${x(ev.id)}', '${x(ev.name)}', 'events')"><span class="ai">💬</span><span>${fn(ev.comment_count)}</span></button>"""
    )
}

# --- Replacement for feeds.html ---
feeds_replacements = {
    "script": (
        """const SUPABASE_URL  = 'https://cjzewfvtdayjgjdpdmln.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNqemV3ZnZ0ZGF5amdqZHBkbWxuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU4NTg0MjYsImV4cCI6MjA5MTQzNDQyNn0.KQ80RmaB6cfA0dkcT-pdTe53fwyUrrIBeVJtToWF_Mk';
let _sbClient = null;
function getSB() {
  if (!_sbClient && window.supabase) _sbClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON);
  return _sbClient;
}

let _session = null;
let _profile  = null;
try { _session = JSON.parse(localStorage.getItem('p_user'));   } catch(e) {}
try { _profile = JSON.parse(localStorage.getItem('p_profile')); } catch(e) {}
let _uid = _session?.id || null;

let _posts      = [];
let _filter     = 'all';
let _page       = 1;
let _totalPages = 1;
let _loading    = false;

async function fetchPosts() {
  const sb = getSB();
  const token = sb ? (await sb.auth.getSession())?.data?.session?.access_token : null;
  const params = new URLSearchParams({ page: _page, limit: 10, filter: _filter });
  const headers = token ? { Authorization: 'Bearer ' + token } : {};
  const res = await fetch('/api/posts?' + params, { headers });
  if (!res.ok) throw new Error('Failed to load posts');
  return res.json();
}

function mapPost(p) {
  const prof = p.profile || p.profiles || {};
  return {
    id: p.id, user_id: p.user_id,
    username:     prof.username     || 'user',
    display_name: prof.display_name || 'User',
    avatar_url:   prof.avatar_url   || null,
    role:         prof.role         || 'user',
    post_type:    p.post_type || 'attended_photo',
    image_url:    p.image_url || null,
    caption:      p.caption   || '',
    event_name:   p.event_name || null,
    likes: [], reposts: [], comments: [],
    ts: p.created_at,
  };
}

function _getLikes(postId) { try { return JSON.parse(localStorage.getItem('p_likes_'+postId) || 'null'); } catch { return null; } }
function _setLikes(postId, arr) { localStorage.setItem('p_likes_'+postId, JSON.stringify(arr)); }
function _getReposts(postId) { try { return JSON.parse(localStorage.getItem('p_rp_'+postId) || 'null'); } catch { return null; } }
function _setReposts(postId, arr) { localStorage.setItem('p_rp_'+postId, JSON.stringify(arr)); }
function _getComments(postId) { try { return JSON.parse(localStorage.getItem('p_cmts_'+postId) || 'null'); } catch { return null; } }
function _setComments(postId, arr) { localStorage.setItem('p_cmts_'+postId, JSON.stringify(arr)); }

function getLikes(post)    { return _getLikes(post.id)    || []; }
function getReposts(post)  { return _getReposts(post.id)  || []; }
function getComments(post) { return _getComments(post.id) || []; }

function x(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\"/g,'&quot;'); }
function timeAgo(iso) {
  if (!iso) return '';
  const d = Math.floor((Date.now() - new Date(iso)) / 1000);
  if (d < 60)    return 'just now';
  if (d < 3600)  return Math.floor(d/60)+'m ago';
  if (d < 86400) return Math.floor(d/3600)+'h ago';
  return Math.floor(d/86400)+'d ago';
}
function fn(n) { return n >= 1000 ? (n/1000).toFixed(1)+'k' : String(n||0); }
function showToast(msg, type='') {
  const t = document.getElementById('toast');
  t.textContent = msg; t.className = 'toast '+type+' show';
  setTimeout(() => t.classList.remove('show'), 3000);
}

function setFilter(btn, filter) {
  document.querySelectorAll('.chip').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  _filter = filter; _page = 1;
  render();
}

async function render() {
  if (_loading) return;
  _loading = true;
  const feedEl = document.getElementById('feed');
  feedEl.innerHTML = '<div style="padding:60px 24px;text-align:center;color:var(--mu)">Loading posts…</div>';
  feedEl.scrollTop = 0;

  try {
    const data = await fetchPosts();
    _posts = (data.posts || []).map(mapPost);
    _totalPages = Math.max(1, Math.ceil((data.total || _posts.length) / 10));

    feedEl.innerHTML = '';
    if (!_posts.length) {
      const msg = _filter === 'following'
        ? 'Follow organizers and friends to see their posts here.'
        : 'No posts yet. Be the first to share something!';
      feedEl.innerHTML = '<div class="es"><div class="ei">📰</div><div class="et">Nothing here yet</div><div class="em">'+msg+'</div></div>';
    } else {
      _posts.forEach(post => feedEl.appendChild(buildCard(post)));
      if (_totalPages > 1) {
        const pg = document.createElement('div');
        pg.className = 'pg';
        pg.innerHTML = '<button class="pb" onclick="changePage(-1)" '+(_page===1?'disabled':'')+'>← Prev</button><span class="pi">'+_page+' / '+_totalPages+'</span><button class="pb" onclick="changePage(1)" '+(_page>=_totalPages?'disabled':'')+'>Next →</button>';
        feedEl.appendChild(pg);
      }
    }
  } catch(e) {
    feedEl.innerHTML = '<div class="es"><div class="ei">📡</div><div class="et">Could not load posts</div><div class="em">Check your connection and try again.</div></div>';
    console.error('Feed load error:', e);
  }
  _loading = false;
}

function changePage(delta) { _page += delta; render(); }

function buildCard(post) {
  const likes    = getLikes(post);
  const reposts  = getReposts(post);
  const comments = getComments(post);
  const liked    = _uid && likes.includes(_uid);
  const reposted = _uid && reposts.includes(_uid);
  const isOrg    = post.role === 'organizer';
  let following  = [];
  try { following = JSON.parse(localStorage.getItem('p_following') || '[]'); } catch(e) {}
  const isFollowing = following.includes(post.user_id);
  const isOwn    = post.user_id === _uid;

  const cap = post.caption || '';
  const shortCap = cap.length > 220 ? cap.slice(0,220) : cap;

  const el = document.createElement('div');
  el.className = 'fc';
  el.id = 'post-' + post.id;
  el.innerHTML =
    '<div class="fh">' +
      '<div class="fa '+(isOrg?'org':'')+'">' +
        (post.avatar_url ? '<img src="'+x(post.avatar_url)+'" loading="lazy" onerror="this.style.display=\\'none\\'"/>' : (post.display_name?.[0]?.toUpperCase()||'😊')) +
      '</div>' +
      '<div style="flex:1;min-width:0;cursor:pointer" onclick="openProfile(\\''+x(post.user_id)+'\\')">' +
        '<div class="fo">' + x(post.display_name || post.username) + (isOrg ? '<span class="org-pill">📢 Page</span>' : '') + '</div>' +
        (post.event_name ? '<div style="font-size:.64rem;color:var(--or);font-family:\\'Syne\\',sans-serif;font-weight:700;letter-spacing:.04em">🎟 '+x(post.event_name)+'</div>' : '') +
        '<div class="fl">@'+x(post.username)+' · '+timeAgo(post.ts || post.created_at)+'</div>' +
      '</div>' +
      (!isOwn ? '<button class="follow-btn '+(isFollowing?'on':'')+'" id="fbtn-'+x(post.id)+'" onclick="doFollow(\\''+x(post.user_id)+'\\',\\''+x(post.id)+'\\')">'+(isFollowing?'✓ Following':'+ Follow')+'</button>' : '') +
    '</div>' +
    (post.image_url ? '<img class="fb" src="'+x(post.image_url)+'" loading="lazy" onerror="this.remove()"/>' : '') +
    (cap ? '<div class="fd"><div class="cap" id="cap-'+x(post.id)+'">'+x(shortCap)+(cap.length>220?' <span class="cap-more" onclick="expandCap(\\''+x(post.id)+'\\')">more</span>':'')+'</div></div>' : '') +
    '<div class="fac">' +
      '<button class="ab '+(liked?'lk':'')+'" id="lb-'+x(post.id)+'" onclick="doLike(\\''+x(post.id)+'\\')"><span class="ai">'+(liked?'❤️':'🤍')+'</span> <span id="lc-'+x(post.id)+'">'+fn(likes.length)+'</span></button>' +
      '<button class="ab" onclick="toggleCmt(\\''+x(post.id)+'\\')"><span class="ai">💬</span> <span id="cc-'+x(post.id)+'">'+fn(comments.length)+'</span></button>' +
      '<button class="ab '+(reposted?'rp':'')+'" id="rb-'+x(post.id)+'" onclick="doRepost(\\''+x(post.id)+'\\')"><span class="ai">🔁</span> <span id="rc-'+x(post.id)+'">'+fn(reposts.length)+'</span></button>' +
      '<button class="ab" onclick="doShare(\\''+x(post.caption||'')+''\\')"><span class="ai">🔗</span></button>' +
    '</div>' +
    '<div class="cmt-wrap" id="cmt-'+x(post.id)+'">' +
      '<div id="cmtl-'+x(post.id)+'">'+buildCmts(comments)+'</div>' +
      '<div class="cir"><input class="ci" id="cmti-'+x(post.id)+'" placeholder="Add a comment…" maxlength="300" onkeydown="if(event.key===\\'Enter\\')doComment(\\''+x(post.id)+'\\')"/><button class="csnd" onclick="doComment(\\''+x(post.id)+'\\')">➤</button></div>' +
    '</div>';
  return el;
}

function buildCmts(comments) {
  if (!comments.length) return '<div style="padding:10px 14px;font-size:.76rem;color:var(--mu)">No comments yet. Be first 💬</div>';
  return comments.slice(-10).map(c => '<div class="cmt-item"><div class="cmt-av">'+(c.display_name||c.username||'?')[0].toUpperCase()+'</div><div style="flex:1;min-width:0"><div class="cmt-name">'+x(c.display_name||c.username)+'</div><div class="cmt-text">'+x(c.text)+'</div><div class="cmt-time">'+timeAgo(c.ts||c.timestamp)+'</div></div></div>').join('');
}

function expandCap(postId) {
  const post = _posts.find(p => p.id === postId);
  if (!post) return;
  const el = document.getElementById('cap-'+postId);
  if (el) el.innerHTML = x(post.caption);
}

async function doLike(postId) {
  if (!_uid) return showToast('Sign in to like posts');
  const likes   = _getLikes(postId) || [];
  const liked   = likes.includes(_uid);
  const newLikes = liked ? likes.filter(l=>l!==_uid) : [...likes, _uid];
  _setLikes(postId, newLikes);
  const btn = document.getElementById('lb-'+postId);
  const cnt = document.getElementById('lc-'+postId);
  if (btn) { btn.classList.toggle('lk', !liked); btn.querySelector('.ai').textContent = liked?'🤍':'❤️'; }
  if (cnt) cnt.textContent = fn(newLikes.length);
  const sb = getSB();
  if (sb && _uid) {
    if (liked) {
      await sb.from('reactions').delete().eq('entity_id', postId).eq('user_id', _uid).eq('entity_type','post').catch(()=>{});
    } else {
      await sb.from('reactions').insert({entity_id: postId, user_id: _uid, entity_type:'post'}).catch(()=>{});
      const post = _posts.find(p=>p.id===postId);
      if (post && post.user_id !== _uid) {
        const name = _profile?.display_name || _session?.display_name || 'Someone';
        sb.from('notifications').insert({user_id: post.user_id, type:'like', from_user_id:_uid, from_display_name:name, entity_id:postId, entity_type:'post', message:name+' liked your post'}).catch(()=>{});
      }
    }
  }
}

async function doRepost(postId) {
  if (!_uid) return showToast('Sign in to repost');
  const reposts = _getReposts(postId) || [];
  const rp      = reposts.includes(_uid);
  const newRp   = rp ? reposts.filter(r=>r!==_uid) : [...reposts, _uid];
  _setReposts(postId, newRp);
  const btn = document.getElementById('rb-'+postId);
  const cnt = document.getElementById('rc-'+postId);
  if (btn) btn.classList.toggle('rp', !rp);
  if (cnt) cnt.textContent = fn(newRp.length);
  if (!rp) showToast('🔁 Reposted!', 'ok');
  const sb = getSB();
  if (sb && _uid) {
    if (rp) {
      await sb.from('reposts').delete().eq('post_id', postId).eq('user_id', _uid).catch(()=>{});
    } else {
      await sb.from('reposts').insert({post_id: postId, user_id: _uid}).catch(()=>{});
    }
  }
}

function toggleCmt(postId) {
  const el = document.getElementById('cmt-'+postId);
  if (el) el.style.display = el.style.display === 'block' ? 'none' : 'block';
}

async function doComment(postId) {
  if (!_uid) return showToast('Sign in to comment');
  const inp  = document.getElementById('cmti-'+postId);
  const txt  = inp?.value.trim(); if (!txt) return;
  const name  = _profile?.display_name || _session?.display_name || 'You';
  const uname = _profile?.username     || _session?.email?.split('@')[0] || 'you';
  const cmt   = {id:'c_'+Date.now(), user_id:_uid, username:uname, display_name:name, text:txt, ts:new Date().toISOString()};

  const post    = _posts.find(p => p.id === postId);
  const cmts    = getComments(post || {id:postId});
  cmts.push(cmt);
  _setComments(postId, cmts);
  inp.value = '';
  const lEl = document.getElementById('cmtl-'+postId);
  if (lEl) lEl.innerHTML = buildCmts(cmts);
  const cEl = document.getElementById('cc-'+postId);
  if (cEl) cEl.textContent = fn(cmts.length);

  const sb = getSB();
  if (sb && _uid) {
    await sb.from('comments').insert({entity_id: postId, entity_type:'post', user_id: _uid, text: txt}).catch(()=>{});
    if (post && post.user_id !== _uid) {
      sb.from('notifications').insert({user_id: post.user_id, type:'comment', from_user_id:_uid, from_display_name:name, entity_id:postId, entity_type:'post', message:name+' commented: "'+txt.slice(0,60)+'"'}).catch(()=>{});
    }
  }
}

async function doFollow(targetUserId, postId) {
  if (!_uid) return showToast('Sign in to follow');
  const sb  = getSB();
  let fol;

  if (sb && _uid) {
    const { data: existing } = await sb.from('follows').select('follower_id').eq('follower_id', _uid).eq('following_id', targetUserId).maybeSingle();
    if (existing) {
      await sb.from('follows').delete().eq('follower_id', _uid).eq('following_id', targetUserId);
      fol = false;
    } else {
      await sb.from('follows').insert({follower_id: _uid, following_id: targetUserId});
      fol = true;
      const name = _profile?.display_name || _session?.display_name || 'Someone';
      sb.from('notifications').insert({user_id: targetUserId, type:'follow', from_user_id:_uid, from_display_name:name, message:name+' started following you'}).catch(()=>{});
    }
  } else {
    let following = [];
    try { following = JSON.parse(localStorage.getItem('p_following') || '[]'); } catch(e) {}
    const idx = following.indexOf(targetUserId);
    if (idx > -1) { following.splice(idx, 1); fol = false; } else { following.push(targetUserId); fol = true; }
    localStorage.setItem('p_following', JSON.stringify(following));
  }

  document.querySelectorAll('[id^="fbtn-"]').forEach(btn => {
    const pid = btn.id.replace('fbtn-','');
    const p   = _posts.find(mp => mp.id === pid);
    if (p && p.user_id === targetUserId) { btn.classList.toggle('on', fol); btn.textContent = fol ? '✓ Following' : '+ Follow'; }
  });
  let _fw=[]; try{_fw=JSON.parse(localStorage.getItem('p_following')||'[]');}catch(e){} if(fol){if(!_fw.includes(targetUserId))_fw.push(targetUserId);}else{_fw=_fw.filter(i=>i!==targetUserId);} localStorage.setItem('p_following',JSON.stringify(_fw));
  showToast(fol ? '✓ Following' : 'Unfollowed', fol ? 'ok' : '');
  if (_filter === 'following') { _page = 1; render(); }
}

function doShare(caption) {
  if (navigator.share) navigator.share({title:'Pulsify Post', text:caption||'Check this out on Pulsify!', url:location.href});
  else { navigator.clipboard?.writeText(location.href); showToast('🔗 Link copied!'); }
}

function closeProfOverlay() { document.getElementById('prof-overlay').style.display = 'none'; }

async function openProfile(userId) {
  const ov   = document.getElementById('prof-overlay');
  const body = document.getElementById('prof-overlay-body');
  if (!ov || !body) return;
  ov.style.display = 'flex';
  body.innerHTML = '<div style="padding:40px;text-align:center;color:var(--mu)">Loading…</div>';
  try {
    const res = await fetch('/api/profiles/' + userId);
    if (!res.ok) throw new Error('Profile not found');
    const { profile, posts_count, followers_count, following_count, recent_posts } = await res.json();
    const init  = (profile.display_name || profile.username || '?')[0].toUpperCase();
    const isOrg = ['organizer','business','admin'].includes(profile.role);
    const postsHtml = recent_posts.length ? recent_posts.map(p => '<div style="aspect-ratio:1;border-radius:10px;overflow:hidden;background:var(--surf)">'+(p.image_url ? '<img src="'+x(p.image_url)+'" style="width:100%;height:100%;object-fit:cover" loading="lazy"/>' : '<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:.7rem;color:var(--mu);padding:8px;text-align:center">'+x((p.caption||'').slice(0,60))+'</div>')+'</div>').join('') : '';

    body.innerHTML =
      '<div style="height:60px;background:linear-gradient(135deg,rgba(176,38,255,.3),rgba(255,92,0,.2));border-radius:12px;margin-bottom:-28px"></div>' +
      '<div style="display:flex;align-items:flex-end;justify-content:space-between;margin-bottom:12px">' +
        '<div style="width:68px;height:68px;border-radius:50%;background:linear-gradient(135deg,#B026FF,#FF5C00);display:flex;align-items:center;justify-content:center;font-size:1.7rem;border:3px solid var(--bg2);overflow:hidden">' +
          (profile.avatar_url ? '<img src="'+x(profile.avatar_url)+'" style="width:100%;height:100%;object-fit:cover"/>' : init) +
        '</div>' +
      '</div>' +
      '<div style="font-family:\\'Bebas Neue\\',sans-serif;font-size:1.5rem;line-height:1;margin-bottom:2px">'+x(profile.display_name||profile.username)+'</div>' +
      '<div style="font-size:.74rem;color:var(--mu);margin-bottom:'+(profile.bio?'8px':'12px')+'">@'+x(profile.username||'user')+(profile.city?' · '+x(profile.city):'')+(isOrg?' · <span style="color:var(--or)">'+profile.role+'</span>':'')+'</div>' +
      (profile.bio ? '<div style="font-size:.82rem;color:var(--mu2);line-height:1.55;margin-bottom:12px">'+x(profile.bio)+'</div>' : '') +
      '<div style="display:flex;gap:24px;margin-bottom:'+(recent_posts.length?'16px':'0')+''">' +
        '<div style="text-align:center"><div style="font-family:\\'Bebas Neue\\',sans-serif;font-size:1.3rem;color:var(--or)">'+posts_count+'</div><div style="font-size:.58rem;color:var(--mu);font-family:\\'Syne\\',sans-serif;font-weight:700;text-transform:uppercase;letter-spacing:.1em">Posts</div></div>' +
        '<div style="text-align:center"><div style="font-family:\\'Bebas Neue\\',sans-serif;font-size:1.3rem;color:var(--or)">'+followers_count+'</div><div style="font-size:.58rem;color:var(--mu);font-family:\\'Syne\\',sans-serif;font-weight:700;text-transform:uppercase;letter-spacing:.1em">Followers</div></div>' +
        '<div style="text-align:center"><div style="font-family:\\'Bebas Neue\\',sans-serif;font-size:1.3rem;color:var(--or)">'+following_count+'</div><div style="font-size:.58rem;color:var(--mu);font-family:\\'Syne\\',sans-serif;font-weight:700;text-transform:uppercase;letter-spacing:.1em">Following</div></div>' +
      '</div>' +
      (postsHtml ? '<div style="font-family:\\'Syne\\',sans-serif;font-size:.6rem;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--mu);margin:14px 0 8px">Posts</div><div style="display:grid;grid-template-columns:repeat(3,1fr);gap:4px">'+postsHtml+'</div>' : '');
  } catch(e) {
    body.innerHTML = '<div style="padding:40px;text-align:center;color:var(--mu)">'+x(e.message)+'</div>';
  }
}

let _cImg = null;
let _cImgFile = null;
function openCompose() {
  if (!_uid) { window.location.href='signin.html'; return; }
  const isOrg = ['organizer','business','admin'].includes(_session?.role);
  const orgSection = document.getElementById('organizer-text-section');
  const userNote   = document.getElementById('user-posting-note');
  const imgHint    = document.getElementById('img-drop-hint');
  if (orgSection) orgSection.style.display = isOrg ? 'block' : 'none';
  if (userNote)   userNote.style.display   = isOrg ? 'none'  : 'block';
  if (imgHint)    imgHint.textContent      = isOrg ? 'Tap to add a photo (optional)' : 'Tap to add a photo from the event *';
  document.getElementById('compose-modal').classList.add('open');
}
function closeCompose() {
  document.getElementById('compose-modal').classList.remove('open');
  document.getElementById('post-caption').value    = '';
  document.getElementById('post-event-name').value = '';
  const to = document.getElementById('post-text-only');
  if (to) to.value = '';
  document.getElementById('img-drop').innerHTML = '<span style="font-size:2rem">📷</span><span style="font-size:.8rem;color:var(--mu)" id="img-drop-hint">Tap to add a photo</span>';
  _cImg = null; _cImgFile = null;
}
function handleImg(input) {
  const file = input.files[0]; if (!file) return;
  _cImgFile = file;
  const reader = new FileReader();
  reader.onload = e => {
    _cImg = e.target.result;
    document.getElementById('img-drop').innerHTML = '<img src="'+e.target.result+'" style="width:100%;height:100%;object-fit:cover;border-radius:12px"/>';
  };
  reader.readAsDataURL(file);
}
async function submitPost() {
  const isOrg    = ['organizer','business','admin'].includes(_session?.role);
  const caption  = document.getElementById('post-caption').value.trim();
  const textOnly = (document.getElementById('post-text-only')?.value || '').trim();
  const evName   = document.getElementById('post-event-name').value.trim();
  const finalCap = caption || textOnly;

  if (!isOrg && !_cImg) return showToast('Upload a photo from the event 📸', 'err');
  if (isOrg && !_cImg && !finalCap) return showToast('Add a photo or write something');
  if (!isOrg && !finalCap) return showToast('Add a caption to your photo');

  const btn = document.getElementById('post-submit');
  btn.disabled = true; btn.textContent = 'Sharing…';

  const name  = _profile?.display_name || _session?.display_name || 'You';
  const uname = _profile?.username     || _session?.email?.split('@')[0] || 'you';
  const sb    = getSB();
  let imageUrl = null;

  try {
    if (_cImg && _cImgFile && sb && _uid) {
      const ext  = _cImgFile.name.split('.').pop() || 'jpg';
      const path = _uid + '/' + Date.now() + '.' + ext;
      const { data: up, error: upErr } = await sb.storage.from('post-images').upload(path, _cImgFile, { upsert: false });
      if (!upErr) {
        const { data: { publicUrl } } = sb.storage.from('post-images').getPublicUrl(path);
        imageUrl = publicUrl;
      }
    } else if (_cImg && _cImg.startsWith('http')) {
      imageUrl = _cImg;
    }

    const post_type = isOrg ? 'business_update' : 'attended_photo';

    if (sb && _uid) {
      const token = (await sb.auth.getSession())?.data?.session?.access_token;
      const res = await fetch('/api/posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + (token || '') },
        body: JSON.stringify({ caption: finalCap, image_url: imageUrl, event_name: evName || null, post_type }),
      });
      const data = await res.json();
      if (res.ok && data.post) {
        _posts.unshift({ id: data.post.id, user_id: _uid, username: uname, display_name: name,
          role: _session?.role||'user', avatar_url: _profile?.avatar_url||null,
          event_name: evName||null, image_url: imageUrl, caption: finalCap,
          likes:[], comments:[], reposts:[], ts: data.post.created_at });
      }
    } else {
      _posts.unshift({ id: 'p_'+Date.now(), user_id: _uid||'anon', username: uname, display_name: name,
        role: _session?.role||'user', avatar_url: _profile?.avatar_url||null,
        event_name: evName||null, image_url: imageUrl || _cImg, caption: finalCap,
        likes:[], comments:[], reposts:[], ts: new Date().toISOString() });
    }

    closeCompose();
    _page = 1; render();
    showToast('🔥 Post shared!', 'ok');
  } catch(e) {
    showToast('Failed to post: ' + e.message, 'err');
  }
  btn.disabled = false; btn.textContent = 'Share 🔥';
}

async function initFeed() {
  const sb = getSB();
  if (sb) {
    const { data: { session } } = await sb.auth.getSession();
    if (session && !_uid) {
      _uid = session.user.id;
      const{data:_fws}=await sb.from('follows').select('following_id').eq('follower_id',_uid);if(_fws&&_fws.length)localStorage.setItem('p_following',JSON.stringify(_fws.map(f=>f.following_id)));
    }
  }
  await render();
}
initFeed();"""
    )
}

# Run the patch for both files
print("--- Starting to patch files ---")
patch_file('index.html', index_replacements)
patch_file('feeds.html', feeds_replacements)
print("-----------------------------")
print("✅ Final patching process complete. Please check the logs above for details.")
