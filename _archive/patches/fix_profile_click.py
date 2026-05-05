
# fix_profile_click.py
import os

old_function_string = r'''async function searchUsers(query) {
  const el = document.getElementById(\'search-results\');
  if (!el) return;
  clearTimeout(searchTimeout);
  if (!query || query.trim().length < 2) { el.innerHTML = \'\'; return; }
  const sb = getSB();
  if (!sb) {
    el.innerHTML = \'<div style=\\\"padding:12px 16px;font-size:.78rem;color:var(--mu)\\\">Sign in to search. <a href=\\\"signin.html\\\" style=\\\"color:var(--or)\\\">Sign in →</a></div>\';
    return;
  }
  el.innerHTML = \'<div style=\\\"padding:10px 16px;font-size:.75rem;color:var(--mu)\\\">Searching…</div>\';
  searchTimeout = setTimeout(async () => {
    const term = query.replace(\'@\' ,\'\').trim();
    try {
      const { data, error } = await sb
        .from(\'profiles\')
        .select(\'id,display_name,username,avatar_url,city,role\')
        .or(\'display_name.ilike.%\' + term + \'%,username.ilike.%\' + term + \'%\')
        .neq(\'id\', currentUser?.id || \'00000000-0000-0000-0000-000000000000\')
        .limit(10);
      if (error) throw error;
      if (!data || !data.length) {
        el.innerHTML = \'<div style=\\\"padding:10px 16px;font-size:.75rem;color:var(--mu)\\\">No users found for \"\' + x(query) + \'\"</div>\';
        return;
      }
      const { data: fData } = await sb.from(\'follows\').select(\'following_id\').eq(\'follower_id\', currentUser?.id || \'\');
      const fIds = new Set((fData||[]).map(f => f.following_id));
      el.innerHTML = data.map(u => {
        const isOrg = [\'organizer\',\'business\'].includes(u.role);
        const isF   = fIds.has(u.id);
        const init  = (u.display_name||u.username||\'?\')[0].toUpperCase();
        return \'<div class="pc" style="padding:10px 14px">\' +
          \'<div class="pav" style="background:\' + (isOrg? \'linear-gradient(135deg,#FF5C00,#FF2D78)\':\'linear-gradient(135deg,#0064DC,#B026FF)\') + \';font-size:.9rem;font-weight:700">\' + (u.avatar_url? \'<img src="\'+x(u.avatar_url)+\'" style="width:100%;height:100%;object-fit:cover">\':init) + \'</div>\' +
          \'<div style="flex:1;min-width:0"><div class="pn">\' + x(u.display_name||u.username) + \'</div>\' +
          \'<div class="ph">@\' + x(u.username||\'user\') + (u.city? \' · \'+x(u.city):\'\') + \'</div></div>\' +
          \'<button class="vb \' + (isF?\'cd\':\'cn\') + \'\" onclick="toggleFollow(\\\'\' + u.id + \'\\\',this)">\' + (isF?\'✓ Following\':\'+ Follow\') + \'</button>\' +
        \'</div>\';
      }).join(\'\');
    } catch(e) {
      el.innerHTML = \'<div style=\\\"padding:10px 16px;font-size:.75rem;color:var(--pk)\\\">Error: \' + x(e.message) + \'</div>\';
    }
  }, 350);
}'''

new_function_string = r'''async function searchUsers(query) {
  const el = document.getElementById(\'search-results\');
  if (!el) return;
  clearTimeout(searchTimeout);
  if (!query || query.trim().length < 2) { el.innerHTML = \'\'; return; }
  const sb = getSB();
  if (!sb) {
    el.innerHTML = \'<div style=\\\"padding:12px 16px;font-size:.78rem;color:var(--mu)\\\">Sign in to search. <a href=\\\"signin.html\\\" style=\\\"color:var(--or)\\\">Sign in →</a></div>\';
    return;
  }
  el.innerHTML = \'<div style=\\\"padding:10px 16px;font-size:.75rem;color:var(--mu)\\\">Searching…</div>\';
  searchTimeout = setTimeout(async () => {
    const term = query.replace(\'@\' ,\'\').trim();
    try {
      const { data, error } = await sb
        .from(\'profiles\')
        .select(\'id,display_name,username,avatar_url,city,role\')
        .or(\'display_name.ilike.%\' + term + \'%,username.ilike.%\' + term + \'%\')
        .neq(\'id\', currentUser?.id || \'00000000-0000-0000-0000-000000000000\')
        .limit(10);
      if (error) throw error;
      if (!data || !data.length) {
        el.innerHTML = \'<div style=\\\"padding:10px 16px;font-size:.75rem;color:var(--mu)\\\">No users found for \"\' + x(query) + \'\"</div>\';
        return;
      }
      const { data: fData } = await sb.from(\'follows\').select(\'following_id\').eq(\'follower_id\', currentUser?.id || \'\');
      const fIds = new Set((fData||[]).map(f => f.following_id));
      el.innerHTML = data.map(u => {
        const isOrg = [\'organizer\',\'business\'].includes(u.role);
        const isF   = fIds.has(u.id);
        const init  = (u.display_name||u.username||\'?\')[0].toUpperCase();
        return `<div class="pc" style="padding:10px 14px; cursor:pointer;" onclick="openProfile(\'${u.id}\')">
          <div class="pav" style="background:${isOrg ? \'linear-gradient(135deg,#FF5C00,#FF2D78)\' : \'linear-gradient(135deg,#0064DC,#B026FF)\'};font-size:.9rem;font-weight:700">
            ${u.avatar_url ? `<img src="${x(u.avatar_url)}" style="width:100%;height:100%;object-fit:cover">` : init}
          </div>
          <div style="flex:1;min-width:0">
            <div class="pn">${x(u.display_name || u.username)}</div>
            <div class="ph">@${x(u.username || \'user\')}${u.city ? ` · ${x(u.city)}` : \'\'}</div>
          </div>
          <button class="vb ${isF ? \'cd\' : \'cn\'}" onclick="event.stopPropagation(); toggleFollow(\'${u.id}\', this)">
            ${isF ? \'✓ Following\' : \'+ Follow\'}
          </button>
        </div>`;
      }).join(\'\');
    } catch(e) {
      el.innerHTML = \'<div style=\\\"padding:10px 16px;font-size:.75rem;color:var(--pk)\\\">Error: \' + x(e.message) + \'</div>\';
    }
  }, 350);
}'''

file_path = 'index.html'
try:
    with open(file_path, 'r', encoding='utf-8') as f:
        content = f.read()

    if old_function_string in content:
        content = content.replace(old_function_string, new_function_string)
        with open(file_path, 'w', encoding='utf-8') as f:
            f.write(content)
        print("Successfully fixed the searchUsers function in index.html.")
    else:
        print("Error: Could not find the old searchUsers function block to replace. The file might have been changed or the target string is incorrect.")
except FileNotFoundError:
    print(f"Error: {file_path} not found.")
except Exception as e:
    print(f"An unexpected error occurred: {e}")
