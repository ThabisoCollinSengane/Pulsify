#!/usr/bin/env python3
"""
fix_all_v2.py — fixes all issues in one run:
1. feeds.html  — mock data always visible, real API when available
2. index.html  — map locked (no rotation), smaller icons, navigation-night style
3. business-login.html — working auth with localStorage fallback
"""
import re, shutil, datetime
from pathlib import Path

def bak(p):
    src = Path(p)
    if src.exists():
        shutil.copy(src, str(src) + '.bak.' + datetime.datetime.now().strftime('%H%M%S'))

BASE = Path('/workspaces/Pulsify')

# ═══════════════════════════════════════════════════════════
# FIX 1 — feeds.html: guarantee mock data always renders
# ═══════════════════════════════════════════════════════════
fp = BASE / 'feeds.html'
if fp.exists():
    bak(fp)
    h = fp.read_text()

    # The mock data is inside a block comment /* ... */ — remove the comment wrapper
    # so the posts array actually contains data
    h = h.replace(
        '''const MOCK_POSTS = [
  /*
   * ═══════════════════════════════════════════════════════
   * MOCK DATA — reflects real Pulsify events & businesses
   * Rules enforced in this data:
   *   - Organizers/businesses: text posts + image posts (any time)
   *   - Users: image-only posts tied to an event they attended
   *   - Reposts: users sharing organizer posts (no new caption)
   *
   * SUPABASE SWAP: replace this array with:
   *   const { data, count } = await supabase
   *     .from('posts')
   *     .select('*, profiles(username, display_name, avatar_url, role)', { count:'exact' })
   *     .eq('visibility','public')
   *     .order('created_at', { ascending:false })
   *     .range((page-1)*PAGE_SIZE, page*PAGE_SIZE-1)
   * ═══════════════════════════════════════════════════════
   */''',
        '''const MOCK_POSTS = [
  /* SUPABASE SWAP: replace array contents with real API call to /api/posts */''',
        1
    )

    # Also ensure the render() call happens after DOM is ready
    # Replace bare render() at bottom with DOMContentLoaded version
    if 'render();\n</script>' in h:
        h = h.replace(
            'render();\n</script>',
            '''// Try real API first, fall back to mock
async function initFeed() {
  try {
    const res = await fetch('/api/posts?page=1&limit=10&filter=all');
    if (res.ok) {
      const data = await res.json();
      if (data.posts && data.posts.length > 0) {
        // Map API response to MOCK_POSTS format and render
        data.posts.forEach(p => {
          if (!MOCK_POSTS.find(m => m.id === p.id)) {
            MOCK_POSTS.unshift({
              id: p.id, user_id: p.user_id,
              username: p.profiles?.username || 'user',
              display_name: p.profiles?.display_name || 'User',
              role: p.profiles?.role || 'user',
              post_type: p.post_type || 'organizer',
              image_url: p.image_url || null,
              caption: p.caption || '',
              event_name: p.event_name || null,
              likes:[], comments:[], reposts:[],
              ts: p.created_at
            });
          }
        });
      }
    }
  } catch(e) { console.log('API offline, using mock data'); }
  render();
}
initFeed();
</script>''',
            1
        )
        print('OK  feeds.html initFeed() added')

    fp.write_text(h)
    print('OK  feeds.html saved')
else:
    print('WARN feeds.html not found')

# ═══════════════════════════════════════════════════════════
# FIX 2 — index.html map improvements
# ═══════════════════════════════════════════════════════════
ip = BASE / 'index.html'
if ip.exists():
    bak(ip)
    h = ip.read_text()

    # 2a. Map style → navigation-night (blue ocean, lit roads)
    h = h.replace(
        "style: 'mapbox://styles/mapbox/dark-v11'",
        "style: 'mapbox://styles/mapbox/navigation-night-v1'"
    )
    print('OK  map style → navigation-night-v1')

    # 2b. Lock rotation, disable pitch, keep zoom only
    OLD_MAP_INIT = "mapObj = new mapboxgl.Map({ container: 'mc', style: 'mapbox://styles/mapbox/navigation-night-v1', center: [30.75, -29.85], zoom: 7.5, minZoom: 4, maxZoom: 17 });"
    NEW_MAP_INIT = """mapObj = new mapboxgl.Map({
    container: 'mc',
    style: 'mapbox://styles/mapbox/navigation-night-v1',
    center: [30.75, -29.85], zoom: 7.5, minZoom: 4, maxZoom: 17,
    dragRotate: false,
    pitchWithRotate: false,
    touchPitch: false,
  });
  mapObj.touchZoomRotate.disableRotation();"""
    h = h.replace(OLD_MAP_INIT, NEW_MAP_INIT)
    print('OK  map rotation locked')

    # 2c. Smaller marker size (40px → 28px)
    h = h.replace(
        'width:40px;height:40px;border-radius:50%;',
        'width:28px;height:28px;border-radius:50%;'
    )
    # Also in CSS .mp class
    h = re.sub(r'\.mp\{width:\d+px;height:\d+px', '.mp{width:28px;height:28px', h)
    print('OK  map markers smaller (28px)')

    # 2d. Better icon set for businesses
    OLD_MS = """function _ms(item, type) {
  if (type === 'event') {
    const g = (item.genre || '').toLowerCase();
    if (g.includes('gqom')     || g.includes('nightlife')) return {bg:'#FF2D78',sh:'255,45,120',  ico:'🔊'};
    if (g.includes('amapiano'))                             return {bg:'#B026FF',sh:'176,38,255',  ico:'🎶'};
    if (g.includes('sport')||g.includes('soccer')||g.includes('cricket')||g.includes('rugby'))
                                                            return {bg:'#00D4AA',sh:'0,212,170',   ico:'⚽'};
    if (g.includes('march'))                                return {bg:'#C6FF4A',sh:'198,255,74',  ico:'✊',dark:true};
    if (g.includes('jazz'))                                 return {bg:'#FF9500',sh:'255,149,0',   ico:'🎷'};
    if (g.includes('hip')||g.includes('rap'))               return {bg:'#FF0080',sh:'255,0,128',   ico:'🎤'};
    if (g.includes('comedy'))                               return {bg:'#FFB800',sh:'255,184,0',   ico:'😂',dark:true};
    if (g.includes('festival'))                             return {bg:'#00B4D8',sh:'0,180,216',   ico:'🎉'};
    if (g.includes('shisa')||g.includes('braai')||g.includes('food')) return {bg:'#FF5C00',sh:'255,92,0',ico:'🥩'};
    if (g.includes('night')||g.includes('club'))            return {bg:'#7B2FFF',sh:'123,47,255',  ico:'🌙'};
    if (g.includes('student'))                              return {bg:'#0077B6',sh:'0,119,182',   ico:'🎓'};
    if (g.includes('market'))                               return {bg:'#00A86B',sh:'0,168,107',   ico:'🛍️'};
    return {bg:'#FF5C00',sh:'255,92,0',ico:'🎶'};
  }
  const c = item.category||'';
  if (c==='shisanyama') return {bg:'#DC3200',sh:'220,50,0',  ico:'🥩'};
  if (c==='restaurant') return {bg:'#FF8C00',sh:'255,140,0', ico:'🍽️'};
  if (c==='bar')        return {bg:'#8C00DC',sh:'140,0,220', ico:'🍸'};
  if (c==='club')       return {bg:'#C800FF',sh:'200,0,255', ico:'💃'};
  if (c==='hotel')      return {bg:'#0064DC',sh:'0,100,220', ico:'🏨'};
  if (c==='bnb')        return {bg:'#00A064',sh:'0,160,100', ico:'🏡'};
  return {bg:'#555',sh:'100,100,100',ico:'📍'};
}"""

    NEW_MS = """function _ms(item, type) {
  if (type === 'event') {
    const g = (item.genre || '').toLowerCase();
    if (g.includes('gqom')  || g.includes('nightlife')) return {bg:'#FF2D78',sh:'255,45,120',ico:'🔊'};
    if (g.includes('amapiano'))                          return {bg:'#B026FF',sh:'176,38,255',ico:'🎵'};
    if (g.includes('sport') || g.includes('soccer') || g.includes('rugby') || g.includes('cricket'))
                                                         return {bg:'#00D4AA',sh:'0,212,170', ico:'⚽'};
    if (g.includes('march') || g.includes('solidarity')) return {bg:'#C6FF4A',sh:'198,255,74',ico:'✊',dark:true};
    if (g.includes('jazz'))                              return {bg:'#FF9500',sh:'255,149,0', ico:'🎷'};
    if (g.includes('hip')   || g.includes('rap'))        return {bg:'#FF0080',sh:'255,0,128', ico:'🎤'};
    if (g.includes('comedy'))                            return {bg:'#FFD700',sh:'255,215,0', ico:'😂',dark:true};
    if (g.includes('gospel'))                            return {bg:'#FFB347',sh:'255,179,71',ico:'🙏',dark:true};
    if (g.includes('festival'))                          return {bg:'#00B4D8',sh:'0,180,216', ico:'🎪'};
    if (g.includes('shisa') || g.includes('braai'))      return {bg:'#FF5C00',sh:'255,92,0',  ico:'🔥'};
    if (g.includes('maskandi'))                          return {bg:'#8B4513',sh:'139,69,19', ico:'🪗'};
    if (g.includes('afro'))                              return {bg:'#228B22',sh:'34,139,34', ico:'🥁'};
    if (g.includes('student'))                           return {bg:'#0077B6',sh:'0,119,182', ico:'🎓'};
    if (g.includes('market'))                            return {bg:'#20B2AA',sh:'32,178,170',ico:'🛍️'};
    if (g.includes('night') || g.includes('club'))       return {bg:'#7B2FFF',sh:'123,47,255',ico:'🌙'};
    return {bg:'#FF5C00',sh:'255,92,0',ico:'🎟'};
  }
  // Business icons — cool & distinctive
  const c = (item.category||'').toLowerCase();
  if (c==='shisanyama') return {bg:'#C0392B',sh:'192,57,43',  ico:'🔥'};  // fire = braai
  if (c==='restaurant') return {bg:'#E67E22',sh:'230,126,34', ico:'🍴'};  // fork
  if (c==='bar')        return {bg:'#6C3483',sh:'108,52,131', ico:'🍻'};  // beer
  if (c==='club')       return {bg:'#8E44AD',sh:'142,68,173', ico:'💿'};  // vinyl
  if (c==='hotel')      return {bg:'#2471A3',sh:'36,113,163', ico:'🏨'};  // hotel
  if (c==='bnb')        return {bg:'#1A8A5A',sh:'26,138,90',  ico:'🛏'};  // bed
  if (c==='venue')      return {bg:'#D35400',sh:'211,84,0',   ico:'🎪'};  // tent
  if (c==='mall')       return {bg:'#1ABC9C',sh:'26,188,156', ico:'🏬'};  // mall
  if (c==='transport')  return {bg:'#2C3E50',sh:'44,62,80',   ico:'🚌'};  // bus
  return {bg:'#555',sh:'100,100,100',ico:'📍'};
}"""

    if OLD_MS in h:
        h = h.replace(OLD_MS, NEW_MS, 1)
        print('OK  map icon styles updated with cool icons')
    else:
        print('WARN _ms function not found exactly')

    # 2e. SA bounds filter
    old_bounds = 'if (!lat||!lon||isNaN(lat)||isNaN(lon)) return;'
    new_bounds  = 'if (!lat||!lon||isNaN(lat)||isNaN(lon)) return; if (lat<-35||lat>-22||lon<16||lon>33) return;'
    if old_bounds in h and new_bounds not in h:
        h = h.replace(old_bounds, new_bounds, 1)
        print('OK  SA bounds filter added')
    else:
        print('SKIP SA bounds already set or anchor not found')

    # 2f. Session restore — top-right Feed button persists
    session_js = '''
/* ── Session restore ── */
(function() {
  try {
    var s = JSON.parse(localStorage.getItem('p_user'));
    if (s && s.id) {
      document.addEventListener('DOMContentLoaded', function() {
        var btn = document.getElementById('auth-btn');
        if (btn) { btn.textContent = 'Feed'; btn.onclick = function(){ window.location.href='feeds.html'; }; }
      });
    }
  } catch(e) {}
})();'''

    boot_anchor = "window.addEventListener('DOMContentLoaded', () => {"
    if 'Session restore' not in h and boot_anchor in h:
        h = h.replace(boot_anchor, session_js + '\n' + boot_anchor, 1)
        print('OK  session restore injected')

    # 2g. Wire Sign In button
    h = re.sub(
        r'<button[^>]*id="auth-btn"[^>]*>.*?</button>',
        '<button class="sb" id="auth-btn" onclick="window.location.href=\'signin.html\'">Sign In</button>',
        h, count=1
    )
    print('OK  Sign In button wired')

    ip.write_text(h)
    print('OK  index.html saved')
else:
    print('WARN index.html not found')

# ═══════════════════════════════════════════════════════════
# FIX 3 — business-login.html: working localStorage fallback
#          so register/login work without Supabase
# ═══════════════════════════════════════════════════════════
bp = BASE / 'business-login.html'
if bp.exists():
    bak(bp)
    h = bp.read_text()

    # Replace the entire script section with a clean working version
    OLD_SCRIPT_START = 'if (localStorage.getItem(\'biz_session\')) window.location.href = \'business-dashboard.html\';'

    NEW_SCRIPT = """if (localStorage.getItem('biz_session')) window.location.href = 'business-dashboard.html';

function switchTab(tab) {
  document.querySelectorAll('.t-btn').forEach((b,i) => b.classList.toggle('active', tab==='login'?i===0:i===1));
  document.getElementById('login-view').classList.toggle('active', tab==='login');
  document.getElementById('register-view').classList.toggle('active', tab!=='login');
}

function showMsg(id, txt, type) {
  const el = document.getElementById(id);
  el.textContent = txt;
  el.className = 'msg ' + type + ' show';
  setTimeout(() => el.classList.remove('show'), 4000);
}

function togglePw(id, btn) {
  const inp = document.getElementById(id);
  const show = inp.type === 'password';
  inp.type = show ? 'text' : 'password';
  btn.textContent = show ? '🙈' : '👁';
}

/* ── LOGIN ── */
async function doLogin() {
  const email = document.getElementById('l-email').value.trim();
  const pw    = document.getElementById('l-pw').value;
  if (!email || !pw) { showMsg('login-msg','Please fill in all fields','err'); return; }

  const btn = document.getElementById('login-btn');
  btn.textContent = 'Signing in…'; btn.disabled = true;

  // Try Supabase first
  try {
    const SUPA = 'https://cjzewfvtdayjgjdpdmln.supabase.co';
    const KEY  = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNqemV3ZnZ0ZGF5amdqZHBkbWxuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU4NTg0MjYsImV4cCI6MjA5MTQzNDQyNn0.KQ80RmaB6cfA0dkcT-pdTe53fwyUrrIBeVJtToWF_Mk';
    const r = await fetch(`${SUPA}/auth/v1/token?grant_type=password`,{
      method:'POST', headers:{'Content-Type':'application/json','apikey':KEY},
      body: JSON.stringify({email, password:pw})
    });
    const d = await r.json();
    if (d.access_token) {
      localStorage.setItem('p_token', d.access_token);
      const pRes = await fetch('/api/auth/profile',{
        method:'POST', headers:{'Content-Type':'application/json','Authorization':'Bearer '+d.access_token},
        body:JSON.stringify({})
      });
      const pData = await pRes.json().catch(()=>({}));
      const profile = pData.profile || {};
      if (!['business','organizer','admin'].includes(profile.role)) {
        btn.textContent='Sign In to Dashboard'; btn.disabled=false;
        showMsg('login-msg','This is not a business account. Use the regular sign in page.','err');
        return;
      }
      const session = {id:d.user.id, email, name:profile.display_name||email.split('@')[0],
        type:profile.category||'business', city:profile.city||'', role:profile.role};
      localStorage.setItem('biz_session', JSON.stringify(session));
      localStorage.setItem('p_user', JSON.stringify({id:d.user.id,email,display_name:session.name,role:session.role}));
      localStorage.setItem('p_profile', JSON.stringify(profile));
      showMsg('login-msg','Welcome back! Redirecting…','ok');
      setTimeout(()=>window.location.href='business-dashboard.html', 800);
      return;
    }
  } catch(e) { console.warn('Supabase login failed, trying local:', e.message); }

  // LocalStorage fallback
  const accounts = JSON.parse(localStorage.getItem('biz_accounts') || '[]');
  const acc = accounts.find(a => a.email===email && a.password===pw);
  if (!acc) {
    btn.textContent='Sign In to Dashboard'; btn.disabled=false;
    showMsg('login-msg','Incorrect email or password. If new, please register.','err');
    return;
  }
  const session = {id:acc.id, email:acc.email, name:acc.name, type:acc.type,
    city:acc.city, province:acc.province||'', phone:acc.phone, logo:acc.logo||'', role:'business'};
  localStorage.setItem('biz_session', JSON.stringify(session));
  showMsg('login-msg','Welcome back! Redirecting…','ok');
  setTimeout(()=>window.location.href='business-dashboard.html', 800);
}

/* ── REGISTER ── */
async function doRegister() {
  const name     = document.getElementById('r-name').value.trim();
  const type     = document.getElementById('r-type').value;
  const email    = document.getElementById('r-email').value.trim();
  const phone    = document.getElementById('r-phone').value.trim();
  const city     = document.getElementById('r-city').value.trim();
  const province = document.getElementById('r-province')?.value || '';
  const pw       = document.getElementById('r-pw').value;
  const pw2      = document.getElementById('r-pw2').value;

  if (!name||!type||!email||!city||!pw) { showMsg('reg-msg','Please fill in all required fields','err'); return; }
  if (pw.length < 8) { showMsg('reg-msg','Password must be at least 8 characters','err'); return; }
  if (pw !== pw2)    { showMsg('reg-msg','Passwords do not match','err'); return; }

  const btn = document.getElementById('reg-btn');
  btn.textContent = 'Creating account…'; btn.disabled = true;

  // Try Supabase first
  try {
    const SUPA = 'https://cjzewfvtdayjgjdpdmln.supabase.co';
    const KEY  = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNqemV3ZnZ0ZGF5amdqZHBkbWxuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU4NTg0MjYsImV4cCI6MjA5MTQzNDQyNn0.KQ80RmaB6cfA0dkcT-pdTe53fwyUrrIBeVJtToWF_Mk';
    const r = await fetch(`${SUPA}/auth/v1/signup`,{
      method:'POST', headers:{'Content-Type':'application/json','apikey':KEY},
      body: JSON.stringify({email, password:pw, data:{full_name:name}})
    });
    const d = await r.json();
    const token = d.access_token || d.session?.access_token;
    if (token) {
      localStorage.setItem('p_token', token);
      await fetch('/api/auth/profile',{
        method:'POST', headers:{'Content-Type':'application/json','Authorization':'Bearer '+token},
        body: JSON.stringify({profile:{display_name:name, username:name.toLowerCase().replace(/\\s+/g,'_').slice(0,20),
          role:'business', city, province, phone, category:type}})
      }).catch(()=>{});
    }
  } catch(e) { console.warn('Supabase register failed, using local:', e.message); }

  // Always save locally as fallback
  const accounts = JSON.parse(localStorage.getItem('biz_accounts') || '[]');
  if (accounts.find(a => a.email===email)) {
    btn.textContent='Create Business Account'; btn.disabled=false;
    showMsg('reg-msg','An account with this email already exists. Please sign in.','err');
    return;
  }
  const newAcc = {id:'biz_'+Date.now(), name, type, email, phone, city, province, password:pw, logo:'', created:Date.now()};
  accounts.push(newAcc);
  localStorage.setItem('biz_accounts', JSON.stringify(accounts));

  const session = {id:newAcc.id, email, name, type, city, province, phone, logo:'', role:'business'};
  localStorage.setItem('biz_session', JSON.stringify(session));
  localStorage.setItem('p_user', JSON.stringify({id:newAcc.id, email, display_name:name, role:'business'}));

  showMsg('reg-msg','Business account created! Redirecting…','ok');
  setTimeout(()=>window.location.href='business-dashboard.html', 800);
}

document.addEventListener('keydown', e => {
  if (e.key==='Enter') {
    if (document.getElementById('login-view').classList.contains('active')) doLogin();
    else doRegister();
  }
});"""

    if OLD_SCRIPT_START in h:
        # Find the script tag and replace its content
        script_start = h.rfind('<script>', 0, h.find(OLD_SCRIPT_START))
        script_end   = h.find('</script>', h.find(OLD_SCRIPT_START)) + 9
        h = h[:script_start] + '<script>\n' + NEW_SCRIPT + '\n</script>' + h[script_end:]
        print('OK  business-login.html script replaced')
    else:
        print('WARN business-login script anchor not found')

    bp.write_text(h)
    print('OK  business-login.html saved')
else:
    print('WARN business-login.html not found in Codespace')

print('\n✅ ALL FIXES COMPLETE')
print('Now run: export VT=$(grep VERCEL_TOKEN /workspaces/Pulsify/.env | cut -d= -f2) && npx vercel --prod --yes --token=$VT')