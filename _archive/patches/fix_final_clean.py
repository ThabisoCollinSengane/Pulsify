#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
fix_final_clean.py
Windows-safe (UTF-8). Run from Git Bash:
  cd /c/Users/nonja/Desktop/Pulsify
  python fix_final_clean.py

What this does:
1. Adds missing </script></body></html> closing tags
2. Adds initSupabaseSession (removed by cleanup_index.py)
3. Adds searchUsers / escapeHtml as simple wrappers that use getSB()
4. Fixes renderSquad to NOT recreate the friend-search input (already in HTML)
5. Removes toggleVibe (replaced by real toggleFollow)
6. Verifies no duplicate let declarations
"""

import re
from pathlib import Path

BASE     = Path(r'C:\Users\nonja\Desktop\Pulsify')
f        = BASE / 'index.html'
content  = f.read_text(encoding='utf-8')
original = len(content)

print('=== fix_final_clean.py ===\n')

# ── CHECK CURRENT STATE ───────────────────────────────────────────────────────
has_close    = '</script>' in content and '</body>' in content
has_initSupa = 'initSupabaseSession' in content
has_searchU  = 'async function searchUsers' in content
has_toggleF  = 'async function toggleFollow' in content
has_escHtml  = 'function escapeHtml' in content
bt_count     = content.count('`')

print(f"Has closing tags:        {has_close}")
print(f"Has initSupabaseSession: {has_initSupa}")
print(f"Has searchUsers:         {has_searchU}")
print(f"Has toggleFollow:        {has_toggleF}")
print(f"Has escapeHtml:          {has_escHtml}")
print(f"Backticks (even=OK):     {bt_count} {'✅' if bt_count % 2 == 0 else '❌ UNBALANCED'}")
print()

# ── FIX 1: renderSquad — don't recreate the search input ─────────────────────
# The HTML at line ~462 already has <input id="friend-search">
# renderSquad currently uses mock data + toggleVibe. Replace with version that
# only populates squad-content with following list, no duplicate input.

OLD_SQUAD_MOCK = '''function renderSquad() {
  document.getElementById('squad-content').innerHTML = `
    <div class="vsr"><div class="vs"><div class="vn">${vibes.length}</div><div class="vl">Vibing</div></div><div class="vs"><div class="vn">48</div><div class="vl">Vibes</div></div><div class="vs"><div class="vn">12</div><div class="vl">Events</div></div></div>
    <div style="padding:0 16px 12px;font-family:'Syne',sans-serif;font-size:.64rem;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:var(--mu)">✨ People You May Know</div>
    ${MOCK_SQUAD.map(u => `<div class="pc"><div class="pav" style="background:linear-gradient(135deg,hsl(${(u.id.charCodeAt(1)*47)%360},60%,30%),hsl(${(u.id.charCodeAt(1)*47+120)%360},60%,20%))">${u.emo}</div><div style="flex:1;min-width:0"><div class="pn">${x(u.name)}</div><div class="ph">${x(u.handle)} · ${x(u.city)}</div></div><button class="vb ${vibes.includes(u.id)?'cd':'cn'}" onclick="toggleVibe('${u.id}',this)">${vibes.includes(u.id)?'✓ Vibing':'+ Vibe'}</button></div>`).join('')}`;
}
function toggleVibe(id, btn) { const i = vibes.indexOf(id); if (i > -1) { vibes.splice(i, 1); btn.className = 'vb cn'; btn.textContent = '+ Vibe'; } else { vibes.push(id); btn.className = 'vb cd'; btn.textContent = '✓ Vibing'; showToast('🔥 Vibe sent!'); } localStorage.setItem('p_vibes', JSON.stringify(vibes)); }'''

NEW_SQUAD = '''let _squadFollowing = new Set();

async function renderSquad() {
  // The search input already exists statically in the HTML (id="friend-search")
  // We only populate squad-content with the following list
  const el  = document.getElementById('squad-content');
  const sb  = getSB();
  if (!el) return;

  if (!currentUser || !sb) {
    el.innerHTML = '<div style="padding:16px;font-size:.78rem;color:var(--mu)">Sign in to see your friends. <a href="signin.html" style="color:var(--or)">Sign in →</a></div>';
    return;
  }

  el.innerHTML = '<div style="padding:16px;font-size:.78rem;color:var(--mu)">Loading…</div>';

  try {
    const { data: follows, error } = await sb
      .from('follows')
      .select('following_id, profiles!follows_following_id_fkey(id,username,display_name,city,genres,role)')
      .eq('follower_id', currentUser.id);

    if (error) throw error;
    _squadFollowing = new Set((follows || []).map(f => f.following_id));

    if (!follows || !follows.length) {
      el.innerHTML = '<div style="padding:16px;font-size:.78rem;color:var(--mu)">You\'re not following anyone yet. Search above ↑</div>';
      return;
    }

    el.innerHTML = '<div style="padding:4px 16px 6px;font-family:\'Syne\',sans-serif;font-size:.58rem;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:var(--mu)">Following</div>' +
      follows.map(f => {
        const p = f.profiles || {};
        const init = (p.display_name || p.username || '?')[0].toUpperCase();
        return '<div class="pc" style="padding:10px 14px">' +
          '<div class="pav" style="background:linear-gradient(135deg,#B026FF,#FF5C00);font-size:.9rem;font-weight:700">' + init + '</div>' +
          '<div style="flex:1;min-width:0">' +
            '<div class="pn">' + x(p.display_name || p.username || 'User') + '</div>' +
            '<div class="ph">@' + x(p.username || 'user') + (p.city ? ' · ' + x(p.city) : '') + '</div>' +
          '</div>' +
          '<button class="vb cd" onclick="toggleFollow(\'' + p.id + '\',this)">✓ Following</button>' +
        '</div>';
      }).join('');
  } catch(e) {
    el.innerHTML = '<div style="padding:16px;font-size:.78rem;color:var(--mu)">Could not load. Check connection.</div>';
    console.error('renderSquad error:', e);
  }
}'''

if OLD_SQUAD_MOCK in content:
    content = content.replace(OLD_SQUAD_MOCK, NEW_SQUAD, 1)
    print('OK  renderSquad → real Supabase (no duplicate input)')
else:
    # Try to find and replace renderSquad + toggleVibe separately
    rs_start = content.find('function renderSquad()')
    tv_end_marker = "localStorage.setItem('p_vibes', JSON.stringify(vibes)); }"
    tv_end = content.find(tv_end_marker)
    if rs_start > 0 and tv_end > 0:
        tv_end += len(tv_end_marker)
        content = content[:rs_start] + NEW_SQUAD + content[tv_end:]
        print('OK  renderSquad + toggleVibe replaced (fallback method)')
    else:
        print('SKIP renderSquad not replaced — pattern differs, check manually')

# ── FIX 2: Add searchUsers + escapeHtml + toggleFollow ───────────────────────
# These were removed by cleanup_index.py. Add them after renderSquad.

FRIEND_FUNCS = '''
/* ── Friend search functions (use getSB() not local supabase var) ── */
async function searchUsers(query) {
  const el = document.getElementById('search-results');
  if (!el) return;
  if (!query || query.trim().length < 2) { el.innerHTML = ''; return; }

  const sb = getSB();
  if (!sb) {
    el.innerHTML = '<div style="padding:12px 16px;font-size:.78rem;color:var(--mu)">Sign in to search people. <a href="signin.html" style="color:var(--or)">Sign in →</a></div>';
    return;
  }

  clearTimeout(window._searchT);
  window._searchT = setTimeout(async () => {
    el.innerHTML = '<div style="padding:10px 16px;font-size:.75rem;color:var(--mu)">Searching…</div>';
    const term = query.replace('@', '').trim();
    try {
      const { data, error } = await sb
        .from('profiles')
        .select('id,display_name,username,avatar_url,city,role')
        .or('display_name.ilike.%' + term + '%,username.ilike.%' + term + '%')
        .neq('id', currentUser?.id || '00000000-0000-0000-0000-000000000000')
        .limit(10);

      if (error) throw error;
      if (!data || !data.length) {
        el.innerHTML = '<div style="padding:10px 16px;font-size:.75rem;color:var(--mu)">No users found for "' + escapeHtml(query) + '"</div>';
        return;
      }

      // Get current following state
      const { data: followingData } = await sb.from('follows').select('following_id').eq('follower_id', currentUser?.id || '');
      const followingIds = new Set((followingData || []).map(f => f.following_id));

      el.innerHTML = '<div style="padding:4px 16px 6px;font-family:\'Syne\',sans-serif;font-size:.56rem;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:var(--or)">RESULTS</div>' +
        data.map(u => {
          const isOrg = ['organizer','business'].includes(u.role);
          const isF   = followingIds.has(u.id);
          const init  = (u.display_name || u.username || '?')[0].toUpperCase();
          const av    = u.avatar_url
            ? '<img src="' + escapeHtml(u.avatar_url) + '" style="width:100%;height:100%;object-fit:cover">'
            : '<span style="font-size:.9rem;font-weight:700">' + init + '</span>';
          return '<div class="pc" style="padding:10px 14px">' +
            '<div class="pav" style="background:' + (isOrg ? 'linear-gradient(135deg,#FF5C00,#FF2D78)' : 'linear-gradient(135deg,#0064DC,#B026FF)') + ';overflow:hidden">' + av + '</div>' +
            '<div style="flex:1;min-width:0">' +
              '<div class="pn">' + escapeHtml(u.display_name || u.username) + (isOrg ? ' <span style="font-size:.5rem;background:rgba(255,92,0,.15);border:1px solid rgba(255,92,0,.3);color:var(--or);padding:1px 5px;border-radius:50px">📢</span>' : '') + '</div>' +
              '<div class="ph">@' + escapeHtml(u.username || 'user') + (u.city ? ' · ' + escapeHtml(u.city) : '') + '</div>' +
            '</div>' +
            '<button class="vb ' + (isF ? 'cd' : 'cn') + '" onclick="toggleFollow(\'' + u.id + '\',this)">' + (isF ? '✓ Following' : '+ Follow') + '</button>' +
          '</div>';
        }).join('');
    } catch(e) {
      el.innerHTML = '<div style="padding:10px 16px;font-size:.75rem;color:var(--pk)">Search failed: ' + escapeHtml(e.message) + '</div>';
    }
  }, 350);
}

async function toggleFollow(targetId, btn) {
  const sb = getSB();
  if (!sb || !currentUser) {
    showToast('Sign in to follow people');
    window.location.href = 'signin.html';
    return;
  }
  const isFollowing = btn.classList.contains('cd');
  btn.disabled = true;
  try {
    if (isFollowing) {
      const { error } = await sb.from('follows').delete().eq('follower_id', currentUser.id).eq('following_id', targetId);
      if (error) throw error;
      _squadFollowing.delete(targetId);
      btn.className = 'vb cn';
      btn.textContent = '+ Follow';
      showToast('Unfollowed');
    } else {
      const { error } = await sb.from('follows').insert({ follower_id: currentUser.id, following_id: targetId });
      if (error) throw error;
      _squadFollowing.add(targetId);
      btn.className = 'vb cd';
      btn.textContent = '✓ Following';
      showToast('🔥 Following!');
    }
  } catch(e) {
    showToast('Error: ' + e.message);
    console.error('toggleFollow error:', e);
  }
  btn.disabled = false;
}

function escapeHtml(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}'''

# Insert before the BOOT section
boot_marker = '/* ══════════════════════════════════════════════════\n   BOOT'
if boot_marker in content and 'async function searchUsers' not in content:
    content = content.replace(boot_marker, FRIEND_FUNCS + '\n\n' + boot_marker, 1)
    print('OK  searchUsers + toggleFollow + escapeHtml added')
elif 'async function searchUsers' in content:
    print('SKIP friend functions already present')
else:
    # Append before closing tags
    content = content.rstrip() + '\n' + FRIEND_FUNCS + '\n'
    print('OK  friend functions appended (fallback)')

# ── FIX 3: Add initSupabaseSession (removed by cleanup_index.py) ─────────────
INIT_SUPA = '''
/* ── Pulsify Supabase session sync ── */
async function initSupabaseSession() {
  const sb = getSB();
  if (!sb) return;
  try {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) return;

    const { data: profile } = await sb
      .from('profiles')
      .select('id,username,display_name,bio,avatar_url,genres,city,province,role,is_verified')
      .eq('id', session.user.id)
      .single();

    if (profile) {
      localStorage.setItem('p_user', JSON.stringify({
        id: session.user.id,
        email: session.user.email,
        display_name: profile.display_name || session.user.email?.split('@')[0],
        role: profile.role || 'user',
      }));
      localStorage.setItem('p_profile', JSON.stringify(profile));
      localStorage.setItem('p_token', session.access_token);
    }

    // Update top-right button
    const btn = document.getElementById('auth-btn');
    if (btn) { btn.textContent = 'Feed'; btn.onclick = () => window.location.href = 'feeds.html'; }
    currentUser = session.user;
    renderProfile();
  } catch(e) {
    console.warn('initSupabaseSession error:', e.message);
  }
}

document.addEventListener('DOMContentLoaded', initSupabaseSession);'''

if 'initSupabaseSession' not in content:
    # Add it right before the DOMContentLoaded boot listener
    dom_marker = "window.addEventListener('DOMContentLoaded', () => {"
    if dom_marker in content:
        content = content.replace(dom_marker, INIT_SUPA + '\n\n' + dom_marker, 1)
        print('OK  initSupabaseSession added')
    else:
        print('WARN DOMContentLoaded marker not found — appending initSupabaseSession')
        content = content.rstrip() + '\n' + INIT_SUPA + '\n'
else:
    print('SKIP initSupabaseSession already present')

# ── FIX 4: Add closing tags if missing ───────────────────────────────────────
if '</body>' not in content or '</html>' not in content:
    content = content.rstrip() + '\n\n</script>\n</body>\n</html>\n'
    print('OK  Added missing </script></body></html>')
else:
    # Make sure script is properly closed before body
    if not content.rstrip().endswith('</html>'):
        content = content.rstrip() + '\n</html>\n'
        print('OK  Added missing </html>')

# ── FIX 5: Verify no duplicate let declarations ───────────────────────────────
import re
dupes = []
for var in ['searchTimeout', '_squadFollowing', '_squadSearchTimer', 'discLoaded']:
    matches = re.findall(r'\blet ' + var + r'\b', content)
    if len(matches) > 1:
        dupes.append(f'{var} x{len(matches)}')

if dupes:
    print(f'WARN duplicate let declarations: {dupes}')
    # Remove duplicates keeping first
    for var in ['searchTimeout', '_squadFollowing', '_squadSearchTimer']:
        parts = content.split(f'let {var}')
        if len(parts) > 2:
            # Keep first occurrence, remove subsequent
            content = parts[0] + f'let {var}' + parts[1] + ''.join(
                re.sub(r'^[^;]*;', '', p, count=1) for p in parts[2:]
            )
            print(f'OK  removed duplicate let {var}')
else:
    print('OK  No duplicate let declarations')

# ── WRITE ─────────────────────────────────────────────────────────────────────
f.write_text(content, encoding='utf-8')
print(f'\nOK  index.html saved ({len(content):,} chars, was {original:,})')
print('\nDeploy:')
print('  npx vercel --prod --yes --token=YOUR_TOKEN')
