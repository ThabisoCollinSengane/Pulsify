# save as patch_index.py
import re
from pathlib import Path

html = Path("index.html").read_text(encoding="utf-8")

# 1. Replace the entire #tab-squad panel with new version
start = html.find('<div class="panel" id="tab-squad">')
end = html.find('<!-- ══ BOTTOM NAV ══ -->', start)
if start != -1 and end != -1:
    new_panel = '''<div class="panel" id="tab-squad">
  <div style="padding:14px 16px 8px">
    <div class="sw" style="padding:0; margin-bottom:12px">
      <span class="sic">🔍</span>
      <input class="si" type="search" id="friend-search" placeholder="Search by name or username..." autocomplete="off" oninput="searchUsers(this.value)"/>
    </div>
    <div id="search-results" style="margin-top:12px"></div>
    <div style="margin-top:16px">
      <div style="font-family:'Syne',sans-serif;font-size:.64rem;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:var(--mu);margin-bottom:10px">✨ People You May Know</div>
      <div id="squad-content"></div>
    </div>
  </div>
</div>'''
    html = html[:start] + new_panel + html[end:]

# 2. Add the search/follow JavaScript functions before the final </script>
script_end = html.rfind('</script>')
if script_end != -1:
    js = '''
    // ── FRIEND SEARCH & FOLLOW ──
    let searchTimeout = null;
    async function searchUsers(query) {
      clearTimeout(searchTimeout);
      if (!query.trim() || query.length < 2) {
        document.getElementById('search-results').innerHTML = '';
        return;
      }
      searchTimeout = setTimeout(async () => {
        const { data, error } = await supabase
          .from('profiles')
          .select('id, display_name, username, avatar_url')
          .ilike('display_name', `%${query}%`)
          .limit(10);
        if (error) { console.error(error); return; }
        const { data: { session } } = await supabase.auth.getSession();
        const filtered = data.filter(p => p.id !== session?.user?.id);
        renderSearchResults(filtered);
      }, 300);
    }
    async function renderSearchResults(users) {
      const container = document.getElementById('search-results');
      if (!users.length) { container.innerHTML = '<div style="text-align:center;padding:20px;color:var(--mu)">No users found</div>'; return; }
      const { data: { session } } = await supabase.auth.getSession();
      const { data: followingData } = await supabase.from('follows').select('following_id').eq('follower_id', session.user.id);
      const followingIds = followingData ? followingData.map(f => f.following_id) : [];
      container.innerHTML = users.map(user => `
        <div class="pc" style="margin:0 0 8px 0">
          <div class="pav" style="background:linear-gradient(135deg,#B026FF,#FF5C00); overflow:hidden">${user.avatar_url ? `<img src="${user.avatar_url}" style="width:100%;height:100%;object-fit:cover">` : (user.display_name?.[0]?.toUpperCase() || '😊')}</div>
          <div style="flex:1;min-width:0"><div class="pn">${escapeHtml(user.display_name || user.username)}</div><div class="ph">@${escapeHtml(user.username || 'user')}</div></div>
          <button class="vb ${followingIds.includes(user.id) ? 'cd' : 'cn'}" onclick="toggleFollow('${user.id}', this)">${followingIds.includes(user.id) ? '✓ Following' : '+ Follow'}</button>
        </div>
      `).join('');
    }
    async function toggleFollow(targetId, btn) {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { showToast('Please sign in first', 'err'); return; }
      const isFollowing = btn.classList.contains('cd');
      if (isFollowing) {
        const { error } = await supabase.from('follows').delete().eq('follower_id', session.user.id).eq('following_id', targetId);
        if (!error) { btn.classList.remove('cd'); btn.classList.add('cn'); btn.textContent = '+ Follow'; showToast('Unfollowed', 'ok'); const searchInput = document.getElementById('friend-search'); if (searchInput.value.trim()) searchUsers(searchInput.value); }
        else showToast(error.message, 'err');
      } else {
        const { error } = await supabase.from('follows').insert({ follower_id: session.user.id, following_id: targetId });
        if (!error) { btn.classList.remove('cn'); btn.classList.add('cd'); btn.textContent = '✓ Following'; showToast('Followed!', 'ok'); if (searchInput.value.trim()) searchUsers(searchInput.value); }
        else showToast(error.message, 'err');
      }
    }
    function escapeHtml(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
    '''
    html = html[:script_end] + js + html[script_end:]

# 3. Remove purple overlays (remove background gradients from .fb and .bt)
# Remove background from .fb divs (event images)
html = re.sub(r'<div class="fb" style="background:[^"]+">', '<div class="fb" style="background:transparent">', html)
# Remove background from .bt divs (business images)
html = re.sub(r'<div class="bt" style="background:[^"]+">', '<div class="bt" style="background:transparent">', html)

Path("index.html").write_text(html, encoding="utf-8")
print("✅ index.html patched")