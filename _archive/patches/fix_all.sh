#!/bin/bash
# fix_all.sh — fixes all 6 issues in one run
# Run: bash /workspaces/Pulsify/fix_all.sh

FILE="/workspaces/Pulsify/index.html"
cp "$FILE" "${FILE}.bak.$(date +%H%M%S)"
echo "OK backup created"

# ═══════════════════════════════════════════════════
# FIX 1 — Profile tab: connect to user-profile.html
#          Squad tab:  become "Friends Feed"
# ═══════════════════════════════════════════════════
python3 - << 'PYEOF'
from pathlib import Path
f = Path("/workspaces/Pulsify/index.html")
h = f.read_text()

# Replace profile tab HTML
OLD_PROF = '''<div class="panel" id="tab-profile" style="padding:24px 16px;text-align:center">
  <div style="width:80px;height:80px;border-radius:50%;background:linear-gradient(135deg,#B026FF,#FF5C00);display:flex;align-items:center;justify-content:center;font-size:2rem;margin:16px auto 14px;border:3px solid rgba(255,255,255,.1)" id="profile-av">😊</div>
  <div style="font-family:'Bebas Neue',sans-serif;font-size:1.8rem;margin-bottom:4px" id="profile-name">Sign In to Pulsify</div>
  <div style="font-size:.82rem;color:var(--mu);margin-bottom:24px" id="profile-sub">Access your tickets, saves &amp; squad</div>
  <button class="fmb" id="profile-btn" onclick="openModal(\'auth-modal\')" style="border-radius:50px;padding:13px;letter-spacing:.05em">Sign In / Sign Up</button>
</div>'''

NEW_PROF = '''<div class="panel" id="tab-profile" style="padding:0 0 20px">

  <!-- LOGGED OUT -->
  <div id="prof-out" style="padding:40px 20px;text-align:center">
    <div style="width:80px;height:80px;border-radius:50%;background:linear-gradient(135deg,#B026FF,#FF5C00);display:flex;align-items:center;justify-content:center;font-size:2rem;margin:0 auto 16px;border:3px solid rgba(255,255,255,.1)">😊</div>
    <div style="font-family:'Bebas Neue',sans-serif;font-size:1.8rem;margin-bottom:6px">Sign In to Pulsify</div>
    <div style="font-size:.82rem;color:var(--mu);margin-bottom:24px">Access your tickets, saves &amp; squad</div>
    <button class="fmb" onclick="window.location.href='signin.html'" style="border-radius:50px;padding:13px;letter-spacing:.05em;margin-bottom:10px">Sign In</button>
    <div style="font-size:.78rem;color:var(--mu)">No account? <a href="create-account.html" style="color:var(--or);font-weight:700;text-decoration:none">Sign up free →</a></div>
  </div>

  <!-- LOGGED IN -->
  <div id="prof-in" style="display:none">
    <!-- Banner -->
    <div style="height:90px;background:linear-gradient(135deg,rgba(176,38,255,.3),rgba(255,92,0,.2));position:relative"></div>
    <!-- Avatar + actions row -->
    <div style="padding:0 16px;margin-top:-40px;margin-bottom:12px;display:flex;align-items:flex-end;justify-content:space-between">
      <div id="profile-av" style="width:80px;height:80px;border-radius:50%;background:linear-gradient(135deg,#B026FF,#FF5C00);display:flex;align-items:center;justify-content:center;font-size:2rem;border:3px solid var(--bg);overflow:hidden;flex-shrink:0">😊</div>
      <div style="display:flex;gap:8px;padding-bottom:6px">
        <button onclick="window.location.href='profile-settings.html'" style="background:var(--surf);border:1px solid var(--border2);border-radius:50px;padding:7px 14px;font-family:'Syne',sans-serif;font-size:.7rem;font-weight:700;color:var(--mu2);cursor:pointer">⚙️ Settings</button>
      </div>
    </div>
    <!-- Name -->
    <div style="padding:0 16px 6px">
      <div style="font-family:'Bebas Neue',sans-serif;font-size:1.7rem;line-height:1;margin-bottom:2px" id="profile-name">Your Name</div>
      <div style="font-size:.76rem;color:var(--mu);margin-bottom:12px" id="profile-sub">@handle</div>
    </div>
    <!-- Stats -->
    <div class="vsr" style="margin:0 0 4px">
      <div class="vs"><div class="vn" id="ps-saved">0</div><div class="vl">Saved</div></div>
      <div class="vs"><div class="vn" id="ps-tickets">0</div><div class="vl">Tickets</div></div>
      <div class="vs"><div class="vn" id="ps-posts">0</div><div class="vl">Posts</div></div>
    </div>
    <!-- Quick links -->
    <div style="padding:8px 14px">
      <button onclick="window.location.href='feeds.html'" style="width:100%;background:var(--surf);border:1px solid var(--border2);border-radius:14px;padding:13px 16px;text-align:left;cursor:pointer;display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;-webkit-tap-highlight-color:transparent">
        <div style="display:flex;align-items:center;gap:12px"><span style="font-size:1.2rem">📰</span><div><div style="font-family:'Syne',sans-serif;font-size:.82rem;font-weight:700;color:var(--tx)">Social Feed</div><div style="font-size:.68rem;color:var(--mu)">Posts from people you follow</div></div></div>
        <span style="color:var(--or);font-size:.8rem">→</span>
      </button>
      <button onclick="window.location.href='user-profile.html'" style="width:100%;background:var(--surf);border:1px solid var(--border2);border-radius:14px;padding:13px 16px;text-align:left;cursor:pointer;display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;-webkit-tap-highlight-color:transparent">
        <div style="display:flex;align-items:center;gap:12px"><span style="font-size:1.2rem">👤</span><div><div style="font-family:'Syne',sans-serif;font-size:.82rem;font-weight:700;color:var(--tx)">My Profile & Posts</div><div style="font-size:.68rem;color:var(--mu)">Your memories and events attended</div></div></div>
        <span style="color:var(--or);font-size:.8rem">→</span>
      </button>
      <button onclick="showTab('tickets')" style="width:100%;background:var(--surf);border:1px solid var(--border2);border-radius:14px;padding:13px 16px;text-align:left;cursor:pointer;display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;-webkit-tap-highlight-color:transparent">
        <div style="display:flex;align-items:center;gap:12px"><span style="font-size:1.2rem">🎟</span><div><div style="font-family:'Syne',sans-serif;font-size:.82rem;font-weight:700;color:var(--tx)">My Bookings</div><div style="font-size:.68rem;color:var(--mu)">Tickets and QR codes</div></div></div>
        <span style="color:var(--or);font-size:.8rem">→</span>
      </button>
      <button onclick="window.location.href='business-login.html'" style="width:100%;background:var(--surf);border:1px solid var(--border2);border-radius:14px;padding:13px 16px;text-align:left;cursor:pointer;display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;-webkit-tap-highlight-color:transparent">
        <div style="display:flex;align-items:center;gap:12px"><span style="font-size:1.2rem">🏪</span><div><div style="font-family:'Syne',sans-serif;font-size:.82rem;font-weight:700;color:var(--tx)">Business Dashboard</div><div style="font-size:.68rem;color:var(--mu)">Manage your venue or event page</div></div></div>
        <span style="color:var(--or);font-size:.8rem">→</span>
      </button>
    </div>
    <!-- Sign out -->
    <div style="padding:0 14px 20px">
      <button id="signout-btn" style="width:100%;background:rgba(255,45,120,.07);border:1px solid rgba(255,45,120,.2);color:var(--pk);border-radius:14px;padding:13px;font-family:'Syne',sans-serif;font-size:.86rem;font-weight:700;cursor:pointer">Sign Out</button>
    </div>
  </div>

</div>'''

if OLD_PROF.strip() in h:
    h = h.replace(OLD_PROF.strip(), NEW_PROF.strip(), 1)
    print("OK  Profile tab replaced")
else:
    print("WARN Profile tab not found exactly — trying fallback")
    h = h.replace(
        '<button class="fmb" id="profile-btn" onclick="openModal(\'auth-modal\')" style="border-radius:50px;padding:13px;letter-spacing:.05em">Sign In / Sign Up</button>',
        '<button class="fmb" onclick="window.location.href=\'signin.html\'" style="border-radius:50px;padding:13px;letter-spacing:.05em">Sign In</button>',
        1
    )
    print("OK  Profile btn fallback applied")

f.write_text(h)
PYEOF

# ═══════════════════════════════════════════════════
# FIX 2 — Squad tab becomes "Friends Feed"
# ═══════════════════════════════════════════════════
python3 - << 'PYEOF'
from pathlib import Path
f = Path("/workspaces/Pulsify/index.html")
h = f.read_text()

# Rename Squad label in nav to Friends
h = h.replace('<span class="bl">Squad</span>', '<span class="bl">Friends</span>', 1)

# Replace squad tab content
OLD_SQ = '<div class="panel" id="tab-squad"><div id="squad-content"></div></div>'
NEW_SQ = '''<div class="panel" id="tab-squad">
  <div style="padding:14px 16px 8px;display:flex;align-items:center;justify-content:space-between">
    <div style="font-family:'Syne',sans-serif;font-size:.64rem;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:var(--mu)">👥 Friends Feed</div>
    <a href="feeds.html" style="font-family:'Syne',sans-serif;font-size:.7rem;font-weight:700;color:var(--or);text-decoration:none">See all →</a>
  </div>
  <div id="squad-content"></div>
  <div style="padding:12px 14px">
    <button onclick="window.location.href='feeds.html'" style="width:100%;background:linear-gradient(135deg,#B026FF,#FF5C00);color:#fff;border:none;padding:13px;border-radius:50px;font-family:'Syne',sans-serif;font-size:.84rem;font-weight:700;cursor:pointer">📰 Open Full Social Feed →</button>
  </div>
</div>'''

if OLD_SQ in h:
    h = h.replace(OLD_SQ, NEW_SQ, 1)
    print("OK  Squad → Friends Feed tab updated")
else:
    print("SKIP Squad tab already updated or not found")

f.write_text(h)
PYEOF

# ═══════════════════════════════════════════════════
# FIX 3 — Replace renderProfile() with full version
# ═══════════════════════════════════════════════════
python3 - << 'PYEOF'
import re
from pathlib import Path
f = Path("/workspaces/Pulsify/index.html")
h = f.read_text()

NEW_RENDER = '''function renderProfile() {
  let sess = null, prof = null;
  try { sess = JSON.parse(localStorage.getItem('p_user'));   } catch(e) {}
  try { prof = JSON.parse(localStorage.getItem('p_profile')); } catch(e) {}
  const loggedIn = !!(sess && sess.id);

  const outEl = document.getElementById('prof-out');
  const inEl  = document.getElementById('prof-in');
  if (outEl) outEl.style.display = loggedIn ? 'none'  : 'block';
  if (inEl)  inEl.style.display  = loggedIn ? 'block' : 'none';

  if (!loggedIn) {
    const ab = document.getElementById('auth-btn');
    if (ab) { ab.textContent = 'Sign In'; ab.onclick = () => window.location.href = 'signin.html'; }
    return;
  }

  const name   = prof?.display_name || sess?.display_name || sess?.email?.split('@')[0] || 'Pulsify User';
  const handle = '@' + (prof?.username || sess?.email?.split('@')[0] || 'user');

  const avEl  = document.getElementById('profile-av');
  const nmEl  = document.getElementById('profile-name');
  const subEl = document.getElementById('profile-sub');
  if (avEl)  { if (prof?.avatar_url) { avEl.innerHTML = '<img src="'+prof.avatar_url+'" style="width:100%;height:100%;object-fit:cover"/>'; } else { avEl.textContent = name[0]?.toUpperCase() || '😊'; } }
  if (nmEl)  nmEl.textContent  = name;
  if (subEl) subEl.textContent = handle;

  // Stats
  try {
    const saved    = JSON.parse(localStorage.getItem('p_sev') || '[]');
    const allPosts = JSON.parse(localStorage.getItem('p_all_posts') || '[]');
    const myPosts  = allPosts.filter(p => p.user_id === sess.id);
    const s1 = document.getElementById('ps-saved');
    const s2 = document.getElementById('ps-posts');
    if (s1) s1.textContent = saved.length;
    if (s2) s2.textContent = myPosts.length;
  } catch(e) {}

  // Sign out
  const soBtn = document.getElementById('signout-btn');
  if (soBtn) soBtn.onclick = () => {
    localStorage.removeItem('p_user');
    localStorage.removeItem('p_profile');
    localStorage.removeItem('p_token');
    currentUser = null;
    renderProfile();
    showToast('Signed out');
  };

  // Top-right button → Feed
  const ab = document.getElementById('auth-btn');
  if (ab) { ab.textContent = 'Feed'; ab.onclick = () => window.location.href = 'feeds.html'; }

  currentUser = sess;
}'''

h = re.sub(
    r'function renderProfile\(\) \{.*?\n\}',
    NEW_RENDER,
    h, count=1, flags=re.DOTALL
)
f.write_text(h)
print("OK  renderProfile() replaced")
PYEOF

# ═══════════════════════════════════════════════════
# FIX 4 — Session restore on page load
# ═══════════════════════════════════════════════════
python3 - << 'PYEOF'
from pathlib import Path
f = Path("/workspaces/Pulsify/index.html")
h = f.read_text()

SESSION_JS = """
/* ── Session restore ── */
(function() {
  try {
    var s = JSON.parse(localStorage.getItem('p_user'));
    if (s && s.id) {
      var btn = document.getElementById('auth-btn');
      if (btn) { btn.textContent = 'Feed'; btn.onclick = function(){ window.location.href='feeds.html'; }; }
    }
  } catch(e) {}
})();"""

anchor = "window.addEventListener('DOMContentLoaded', () => {"
if "Session restore" not in h and anchor in h:
    h = h.replace(anchor, SESSION_JS + "\n" + anchor, 1)
    print("OK  Session restore injected")
else:
    print("SKIP Session restore already present")

f.write_text(h)
PYEOF

# ═══════════════════════════════════════════════════
# FIX 5 — Wire Sign In button to signin.html
# ═══════════════════════════════════════════════════
python3 - << 'PYEOF'
import re
from pathlib import Path
f = Path("/workspaces/Pulsify/index.html")
h = f.read_text()

h = re.sub(
    r'<button[^>]*id="auth-btn"[^>]*>.*?</button>',
    '<button class="sb" id="auth-btn" onclick="window.location.href=\'signin.html\'">Sign In</button>',
    h, count=1
)
f.write_text(h)
print("OK  Sign In button wired to signin.html")
PYEOF

echo ""
echo "======================================================"
echo "  ALL FIXES APPLIED"
echo "======================================================"
echo ""
echo "Now deploy:"
echo "  export VT=\$(grep VERCEL_TOKEN /workspaces/Pulsify/.env | cut -d= -f2)"
echo "  npx vercel --prod --yes --token=\$VT"