import sys

file_path = 'index.html'

# Block for openComments and related functions
original_comments_block = """const SEED_COMMENTS = [
  { av:'🔥', name:'Sipho M.', text:'This event is always fire 🔥 been going 3 years straight', time:'2h ago' },
  { av:'💃', name:'Nandi K.', text:'Anyone going from Hillcrest? Looking for a squad 👀', time:'4h ago' },
  { av:'🎶', name:'DJ Thabang', text:'The lineup this year is next level! See you on the floor 🎤', time:'5h ago' },
];
function openComments(id, name) { document.getElementById('comment-title').textContent = name; activeComments = [...SEED_COMMENTS]; renderComments(); document.getElementById('comments-overlay').classList.add('open'); setTimeout(() => document.getElementById('comment-input').focus(), 300); }
function closeComments() { document.getElementById('comments-overlay').classList.remove('open'); }
function renderComments() { document.getElementById('comments-list').innerHTML = activeComments.map(c => `<div class="cm"><div class="cav">${c.av}</div><div style="flex:1"><div class="cna">${x(c.name)}</div><div class="ctx">${x(c.text)}</div><div class="ctm">${c.time}</div></div></div>`).join(''); }
function postComment() { const inp = document.getElementById('comment-input'); const val = inp.value.trim(); if (!val) return; activeComments.push({ av:'😊', name:'You', text: val, time:'just now' }); renderComments(); inp.value = ''; document.getElementById('comments-list').scrollTop = 9999; }"""

# Replacement block with database-driven comments
replacement_comments_block = """let activeEntityId = null;
let activeEntityType = 'event';

async function openComments(entityId, name, type = 'event') {
  const sb = getSB();
  if (!sb) return showToast('You must be signed in to view comments.', 'err');
  
  activeEntityId = entityId;
  activeEntityType = type;
  
  const overlay = document.getElementById('comments-overlay');
  const titleEl = document.getElementById('comment-title');
  const listEl = document.getElementById('comments-list');
  
  if (titleEl) titleEl.textContent = 'Comments on ' + name;
  if (listEl) listEl.innerHTML = '<div style="padding:20px;text-align:center;color:var(--mu)">Loading comments...</div>';
  
  overlay.classList.add('open');
  
  try {
    const { data, error } = await sb.from('comments')
      .select('*, profiles(username, avatar_url, display_name)')
      .eq('entity_id', entityId)
      .order('created_at', { ascending: true });

    if (error) throw error;
    activeComments = data || [];
    renderComments();
  } catch (e) {
    if (listEl) listEl.innerHTML = '<div style="padding:20px;text-align:center;color:var(--pk)">Error loading comments.</div>';
    console.error('Comment load error:', e);
  }
}

function closeComments() {
  document.getElementById('comments-overlay').classList.remove('open');
  activeEntityId = null;
}

function renderComments() {
  const listEl = document.getElementById('comments-list');
  if (!listEl) return;

  if (activeComments.length === 0) {
    listEl.innerHTML = '<div style="padding:30px 20px;text-align:center;color:var(--mu);font-size:.8rem">Be the first to comment!</div>';
    return;
  }

  listEl.innerHTML = activeComments.map(c => {
    const p = c.profiles;
    const av = p?.avatar_url ? `<img src="${x(p.avatar_url)}" style="width:100%;height:100%;object-fit:cover">` : (p?.display_name || '?')[0];
    const name = p?.display_name || 'A user';
    return `<div class="cm">
        <div class="cav" style="background:linear-gradient(135deg,#1a0533,#4a0080); overflow:hidden;">${av}</div>
        <div style="flex:1">
            <div class="cna">${x(name)}</div>
            <div class="ctx">${x(c.content)}</div>
            <div class="ctm">${timeAgoShort(c.created_at)}</div>
        </div>
    </div>`;
  }).join('');
  listEl.scrollTop = listEl.scrollHeight;
}

async function postComment() {
  const inp = document.getElementById('comment-input');
  const val = inp.value.trim();
  if (!val || !activeEntityId) return;

  const sb = getSB();
  if (!currentUser || !sb) {
    return showToast('Please sign in to comment.', 'err');
  }

  inp.disabled = true;
  try {
    const { data: comment, error } = await sb.from('comments').insert({
      user_id: currentUser.id,
      entity_id: activeEntityId,
      entity_type: activeEntityType,
      content: val
    }).select('*, profiles(username, avatar_url, display_name)').single();

    if (error) throw error;
    
    activeComments.push(comment);
    renderComments();
    inp.value = '';
    
    // Find the author of the post/event to notify them
    const { data: entity } = await sb.from(activeEntityType === 'event' ? 'events' : 'posts')
        .select('user_id')
        .eq('id', activeEntityId)
        .single();
        
    if (entity && entity.user_id !== currentUser.id) {
        createNotification(
            entity.user_id,
            'comment',
            `${currentUser.display_name || 'Someone'} commented on your post.`
        );
    }

  } catch(e) {
    showToast('Failed to post comment: ' + e.message, 'err');
    console.error('Comment post error:', e);
  } finally {
    inp.disabled = false;
    inp.focus();
  }
}"""

try:
    with open(file_path, 'r', encoding='utf-8') as f:
        content = f.read()

    if original_comments_block in content:
        new_content = content.replace(original_comments_block, replacement_comments_block)
        with open(file_path, 'w', encoding='utf-8') as f:
            f.write(new_content)
        print(f"✅ Successfully patched {file_path} to implement real comments and notifications.")
    else:
        print(f"❌ Error: Could not find the comments function block to replace in {file_path}. File not modified.", file=sys.stderr)
        sys.exit(1)

except FileNotFoundError:
    print(f"❌ Error: {file_path} not found.", file=sys.stderr)
    sys.exit(1)
