#!/usr/bin/env python3
"""
fix_squad_bio.py — patches index.html and user-profile.html:

1. Replaces mock renderSquad with real Supabase friend search + follow/unfollow
2. Adds robust bio display with console debugging in user-profile.html  
3. Removes any remaining purple/colour overlay on .fa elements in event cards
"""
import re, shutil, datetime
from pathlib import Path

BASE = Path('/workspaces/Pulsify')

# ═══════════════════════════════════════════════════════
# FIX 1 — index.html: real friend search + follow
# ═══════════════════════════════════════════════════════
ip = BASE / 'index.html'
if ip.exists():
    shutil.copy(ip, str(ip) + '.bak.' + datetime.datetime.now().strftime('%H%M%S'))
    h = ip.read_text()

    # Replace entire renderSquad + toggleVibe functions
    OLD_SQUAD = """function renderSquad() {
  document.getElementById('squad-content').innerHTML = `
    <div class=\"vsr\"><div class=\"vs\"><div class=\"vn\">${vibes.length}</div><div class=\"vl\">Vibing</div></div><div class=\"vs\"><div class=\"vn\">48</div><div class=\"vl\">Vibes</div></div><div class=\"vs\"><div class=\"vn\">12</div><div class=\"vl\">Events</div></div></div>
    <div style=\"padding:0 16px 12px;font-family:'Syne',sans-serif;font-size:.64rem;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:var(--mu)\">✨ People You May Know</div>
    ${MOCK_SQUAD.map(u => `<div class=\"pc\"><div class=\"pav\" style=\"background:linear-gradient(135deg,hsl(${(u.id.charCodeAt(1)*47)%360},60%,30%),hsl(${(u.id.charCodeAt(1)*47+120)%360},60%,20%))\">${u.emo}</div><div style=\"flex:1;min-width:0\"><div class=\"pn\">${x(u.name)}</div><div class=\"ph\">${x(u.handle)} · ${x(u.city)}</div></div><button class=\"vb ${vibes.includes(u.id)?'cd':'cn'}\" onclick=\"toggleVibe('${u.id}',this)\">${vibes.includes(u.id)?'✓ Vibing':'+ Vibe'}</button></div>`).join('')}`;\n}
function toggleVibe(id, btn) { const i = vibes.indexOf(id); if (i > -1) { vibes.splice(i, 1); btn.className = 'vb cn'; btn.textContent = '+ Vibe'; } else { vibes.push(id); btn.className = 'vb cd'; btn.textContent = '✓ Vibing'; showToast('🔥 Vibe sent!'); } localStorage.setItem('p_vibes', JSON.stringify(vibes)); }"""

    NEW_SQUAD = """/* ── Friends / Squad — real Supabase ── */
let _squadFollowing = new Set();
let _squadSearchTimer = null;

async function renderSquad() {
  const el = document.getElementById('squad-content');
  if (!el) return;

  const sb = getSB();
  const user = currentUser;

  el.innerHTML = `
    <div style="padding:10px 14px 8px">
      <div style="position:relative">
        <input id="friend-search" type="text" placeholder="🔍 Search people by name or @username…"
          style="width:100%;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.14);border-radius:50px;padding:10px 16px;color:var(--tx);font-family:'DM Sans',sans-serif;font-size:.84rem;outline:none"
          oninput="squadSearch(this.value)"/>
      </div>
    </div>
    <div id="friend-results"></div>
    <div style="padding:6px 16px 4px;font-family:'Syne',sans-serif;font-size:.58rem;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:var(--mu)">People you follow</div>
    <div id="following-list"><div style="padding:20px;text-align:center;color:var(--mu);font-size:.78rem">Loading…</div></div>
    <div style="padding:12px 14px">
      <a href="feeds.html" style="display:block;width:100%;background:linear-gradient(135deg,#B026FF,#FF5C00);color:#fff;border:none;padding:13px;border-radius:50px;font-family:'Syne',sans-serif;font-size:.82rem;font-weight:700;cursor:pointer;text-align:center;text-decoration:none">📰 Open Social Feed →</a>
    </div>`;

  // Load following list
  if (sb && user) {
    try {
      const { data: follows } = await sb
        .from('follows')
        .select('following_id, profiles!follows_following_id_fkey(id,username,display_name,avatar_url,city,province,genres)')
        .eq('follower_id', user.id);

      _squadFollowing = new Set((follows || []).map(f => f.following_id));

      const listEl = document.getElementById('following-list');
      if (!listEl) return;

      if (!follows || !follows.length) {
        listEl.innerHTML = '<div style="padding:16px 16px;font-size:.78rem;color:var(--mu)">You\'re not following anyone yet. Search above to find people.</div>';
        return;
      }

      listEl.innerHTML = follows.map(f => {
        const p = f.profiles || {};
        const initials = (p.display_name || p.username || '?')[0].toUpperCase();
        const genres = (p.genres || []).slice(0,2).join(', ');
        return `<div class="pc" style="padding:10px 14px">
          <div class="pav" style="background:linear-gradient(135deg,#B026FF,#FF5C00);font-size:.9rem;font-weight:700">${initials}</div>
          <div style="flex:1;min-width:0">
            <div class="pn">${x(p.display_name || p.username || 'User')}</div>
            <div class="ph">@${x(p.username || 'user')}${p.city ? ' · ' + x(p.city) : ''}${genres ? ' · ' + x(genres) : ''}</div>
          </div>
          <button class="vb cd" onclick="toggleFollow('${p.id}',this)">✓ Following</button>
        </div>`;
      }).join('');
    } catch(e) {
      console.error('Error loading following list:', e);
      const listEl = document.getElementById('following-list');
      if (listEl) listEl.innerHTML = '<div style="padding:16px;color:var(--mu);font-size:.78rem">Could not load. Check connection.</div>';
    }
  } else {
    const listEl = document.getElementById('following-list');
    if (listEl) listEl.innerHTML = '<div style="padding:16px;font-size:.78rem;color:var(--mu)">Sign in to see your friends. <a href=\\"signin.html\\" style=\\"color:var(--or)\\">Sign in →</a></div>';
  }
}

async function squadSearch(query) {
  clearTimeout(_squadSearchTimer);
  const el = document.getElementById('friend-results');
  if (!el) return;

  if (!query || query.length < 2) {
    el.innerHTML = '';
    return;
  }

  _squadSearchTimer = setTimeout(async () => {
    el.innerHTML = '<div style="padding:10px 16px;font-size:.75rem;color:var(--mu)">Searching…</div>';

    const sb = getSB();
    if (!sb) {
      el.innerHTML = '<div style="padding:10px 16px;font-size:.75rem;color:var(--mu)">Sign in to search.</div>';
      return;
    }

    const term = query.replace('@','').toLowerCase();
    try {
      const { data: results, error } = await sb
        .from('profiles')
        .select('id,username,display_name,avatar_url,city,province,genres,role')
        .or(`username.ilike.%${term}%,display_name.ilike.%${term}%`)
        .neq('id', currentUser?.id || '00000000-0000-0000-0000-000000000000')
        .limit(10);

      if (error) throw error;

      if (!results || !results.length) {
        el.innerHTML = '<div style="padding:10px 16px;font-size:.75rem;color:var(--mu)">No users found for "' + x(query) + '"</div>';
        return;
      }

      el.innerHTML = '<div style="padding:4px 16px 4px;font-family:\'Syne\',sans-serif;font-size:.56rem;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:var(--or)">SEARCH RESULTS</div>' +
        results.map(p => {
          const isFollowing = _squadFollowing.has(p.id);
          const initials = (p.display_name || p.username || '?')[0].toUpperCase();
          const isOrg = ['organizer','business'].includes(p.role);
          return `<div class="pc" style="padding:10px 14px">
            <div class="pav" style="background:${isOrg?'linear-gradient(135deg,#FF5C00,#FF2D78)':'linear-gradient(135deg,#0064DC,#B026FF)'};font-size:.9rem;font-weight:700">${initials}</div>
            <div style="flex:1;min-width:0">
              <div class="pn">${x(p.display_name || p.username || 'User')}${isOrg?'<span style="font-size:.5rem;background:rgba(255,92,0,.15);border:1px solid rgba(255,92,0,.3);color:var(--or);padding:1px 5px;border-radius:50px;margin-left:5px">📢</span>':''}</div>
              <div class="ph">@${x(p.username || 'user')}${p.city ? ' · ' + x(p.city) : ''}</div>
            </div>
            <button class="vb ${isFollowing?'cd':'cn'}" onclick="toggleFollow('${p.id}',this)">
              ${isFollowing ? '✓ Following' : '+ Follow'}
            </button>
          </div>`;
        }).join('');
    } catch(e) {
      console.error('Search error:', e);
      el.innerHTML = '<div style="padding:10px 16px;font-size:.75rem;color:var(--pk)">Search failed: ' + x(e.message) + '</div>';
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
  const isFollowing = _squadFollowing.has(targetId);
  btn.disabled = true;

  try {
    if (isFollowing) {
      const { error } = await sb.from('follows')
        .delete()
        .eq('follower_id', currentUser.id)
        .eq('following_id', targetId);
      if (error) throw error;
      _squadFollowing.delete(targetId);
      btn.className = 'vb cn';
      btn.textContent = '+ Follow';
      showToast('Unfollowed');
    } else {
      const { error } = await sb.from('follows')
        .insert({ follower_id: currentUser.id, following_id: targetId });
      if (error) throw error;
      _squadFollowing.add(targetId);
      btn.className = 'vb cd';
      btn.textContent = '✓ Following';
      showToast('🔥 Following!');
    }
  } catch(e) {
    console.error('Follow error:', e);
    showToast('Error: ' + e.message);
  }
  btn.disabled = false;
}"""

    if 'function renderSquad()' in h and 'toggleVibe' in h:
        # Find and replace the full block
        start = h.find('function renderSquad()')
        end   = h.find('\n\n', h.find('function toggleVibe')) + 2
        if start > 0 and end > start:
            h = h[:start] + NEW_SQUAD + '\n\n' + h[end:]
            print('OK  renderSquad replaced with real Supabase version')
        else:
            print('WARN could not find end of toggleVibe')
    else:
        print('WARN renderSquad/toggleVibe not found')

    # Fix overlay: .fa background on event cards — make transparent when image exists
    # The fa element should only show colour when there's no image
    old_fa = '<div class="fa" style="background:${bg}">${emo}</div>'
    new_fa = '<div class="fa" style="background:${ev.image_url?\'transparent\':bg}">${emo}</div>'
    if old_fa in h:
        h = h.replace(old_fa, new_fa, 1)
        print('OK  .fa overlay only shows when no image')

    ip.write_text(h)
    print('OK  index.html saved')
else:
    print('WARN index.html not found')

# ═══════════════════════════════════════════════════════
# FIX 2 — user-profile.html: robust bio + genres display
# ═══════════════════════════════════════════════════════
up = BASE / 'user-profile.html'
if up.exists():
    shutil.copy(up, str(up) + '.bak.' + datetime.datetime.now().strftime('%H%M%S'))
    h = up.read_text()

    OLD_BIO = "  document.getElementById('pbio').textContent = currentProfile.bio || 'Welcome to Pulsify. Add your bio in settings.';\n  console.log('Bio set to:', document.getElementById('pbio').textContent);"

    NEW_BIO = """  // Bio — with explicit null/undefined handling
  const bioEl = document.getElementById('pbio');
  const bioVal = currentProfile.bio;
  console.log('[Profile] bio value from DB:', JSON.stringify(bioVal));
  if (bioEl) {
    if (bioVal && bioVal.trim()) {
      bioEl.textContent = bioVal.trim();
      bioEl.style.display = '';
    } else {
      bioEl.textContent = 'Add your bio in Profile Settings ✏️';
      bioEl.style.color  = 'var(--mu)';
    }
  }"""

    if OLD_BIO in h:
        h = h.replace(OLD_BIO, NEW_BIO, 1)
        print('OK  bio display hardened')
    else:
        print('WARN bio anchor not found — bio code may differ')

    # Also ensure the Supabase select includes bio explicitly
    OLD_SELECT = ".select('*')"
    NEW_SELECT = ".select('id,username,display_name,bio,avatar_url,genres,city,province,phone,dob,role,is_verified')"
    if OLD_SELECT in h:
        h = h.replace(OLD_SELECT, NEW_SELECT, 1)
        print('OK  profile select now explicit (includes bio)')
    else:
        print('SKIP select already explicit or not found')

    up.write_text(h)
    print('OK  user-profile.html saved')
else:
    print('WARN user-profile.html not found in Codespace')

print('\n✅ All fixes applied. Run: fix_rls.sql in Supabase, then deploy.')
