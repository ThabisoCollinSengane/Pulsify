import sys

file_path = 'index.html'

# The original function block to be replaced
original_code_block = """async function toggleFollow(targetId, btn) {
  const sb = getSB();
  if (!sb || !currentUser) { showToast('Sign in to follow'); window.location.href='signin.html'; return; }
  const isF = btn.classList.contains('cd');
  btn.disabled = true;
  try {
    if (isF) {
      const { error } = await sb.from('follows').delete().eq('follower_id',currentUser.id).eq('following_id',targetId);
      if (error) throw error;
      _squadFollowing.delete(targetId);
      btn.className='vb cn'; btn.textContent='+ Follow'; showToast('Unfollowed');
    } else {
      const { error } = await sb.from('follows').insert({follower_id:currentUser.id,following_id:targetId});
      if (error) throw error;
      _squadFollowing.add(targetId);
      btn.className='vb cd'; btn.textContent='✓ Following'; showToast('🔥 Following!');
    }
  } catch(e) { showToast('Error: '+e.message); console.error(e); }
  btn.disabled = false;
}"""

# The new function block with the added notification logic
replacement_code_block = """async function toggleFollow(targetId, btn) {
  const sb = getSB();
  if (!sb || !currentUser) { showToast('Sign in to follow'); window.location.href='signin.html'; return; }
  const isF = btn.classList.contains('cd');
  btn.disabled = true;
  try {
    if (isF) {
      const { error } = await sb.from('follows').delete().eq('follower_id',currentUser.id).eq('following_id',targetId);
      if (error) throw error;
      _squadFollowing.delete(targetId);
      btn.className='vb cn'; btn.textContent='+ Follow'; showToast('Unfollowed');
    } else {
      const { error } = await sb.from('follows').insert({follower_id:currentUser.id,following_id:targetId});
      if (error) throw error;
      _squadFollowing.add(targetId);
      btn.className='vb cd'; btn.textContent='✓ Following'; showToast('🔥 Following!');
      const { data: tp } = await sb.from('profiles').select('display_name').eq('id', currentUser.id).single();
      createNotification(targetId, 'follow', `${tp?.display_name || 'Someone'} started following you`);
    }
  } catch(e) { showToast('Error: '+e.message); console.error(e); }
  btn.disabled = false;
}"""

try:
    with open(file_path, 'r', encoding='utf-8') as f:
        content = f.read()

    if original_code_block in content:
        new_content = content.replace(original_code_block, replacement_code_block)
        with open(file_path, 'w', encoding='utf-8') as f:
            f.write(new_content)
        print(f"✅ Successfully patched {file_path} to add follow notifications.")
    else:
        print(f"❌ Error: Could not find the 'toggleFollow' function block to replace in {file_path}. File not modified.", file=sys.stderr)
        sys.exit(1)

except FileNotFoundError:
    print(f"❌ Error: {file_path} not found.", file=sys.stderr)
    sys.exit(1)
