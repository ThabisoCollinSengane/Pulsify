import os, io

ROOT = os.path.dirname(os.path.abspath(__file__))

def read(p):
    with io.open(os.path.join(ROOT, p), 'r', encoding='utf-8') as f:
        return f.read()

def write(p, s):
    with io.open(os.path.join(ROOT, p), 'w', encoding='utf-8') as f:
        f.write(s)

def patch(p, old, new, label):
    s = read(p)
    if new in s:
        print('  [skip] ' + label)
        return
    if old not in s:
        print('  [WARN] ' + label + ' anchor not found')
        return
    write(p, s.replace(old, new, 1))
    print('  [ok]   ' + label)

print('feeds.html')
patch('feeds.html',
    "  const params = new URLSearchParams({ page: _page, limit: 10, filter: _filter });\n  const headers = token ? { Authorization: 'Bearer ' + token } : {};",
    "  const params = new URLSearchParams({ page: _page, limit: 10, filter: _filter });\n  if (_uid) params.set('follower_id', _uid);\n  const headers = token ? { Authorization: 'Bearer ' + token } : {};",
    'pass follower_id to API')

print('signin.html')
patch('signin.html',
    "let _accType = 'user';\nfunction selectType(t) {",
    "let _accType = 'user';\nlet _signingIn = false;\nfunction selectType(t) {",
    'add _signingIn flag')

patch('signin.html',
    "sb.auth.onAuthStateChange(async (event, session) => {\n  if ((event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') && session) {",
    "sb.auth.onAuthStateChange(async (event, session) => {\n  if (_signingIn) return;\n  if ((event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') && session) {",
    'guard onAuthStateChange')

patch('signin.html',
    "    } else { // 'user' role\n        const restrictedPages = ['organizer-dashboard.html', 'business-dashboard.html', 'business-login.html'];\n        if (restrictedPages.includes(currentPage)) {\n            window.location.href = 'index.html';\n        }\n    }",
    "    } else {\n        window.location.href = 'index.html';\n    }",
    'fix redirectByRole for users')

print('index.html')
s = read('index.html')
if 'id="comments-overlay"' not in s:
    overlay = ('<!-- COMMENTS OVERLAY -->\n<div id="comments-overlay" onclick="if(event.target===this)closeComments()" style="display:none;position:fixed;inset:0;z-index:2500;background:rgba(0,0,0,.6);backdrop-filter:blur(4px);align-items:flex-end;justify-content:center">\n  <div style="width:100%;max-width:520px;background:var(--bg2);border-radius:22px 22px 0 0;border:1px solid rgba(255,255,255,.1);display:flex;flex-direction:column;max-height:80vh">\n    <div style="padding:14px 16px 10px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid rgba(255,255,255,.08)">\n      <span id="comment-title" style="font-family:\'Syne\',sans-serif;font-weight:700;font-size:15px"></span>\n      <button onclick="closeComments()" style="background:none;border:none;color:var(--tx);font-size:18px;cursor:pointer;padding:4px 8px">&#x2715;</button>\n    </div>\n    <div id="comments-list" style="flex:1;overflow-y:auto;padding:12px 16px;display:flex;flex-direction:column;gap:10px"></div>\n    <div style="padding:10px 14px;border-top:1px solid rgba(255,255,255,.08);display:flex;gap:8px">\n      <input id="comment-input" style="flex:1;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.12);border-radius:20px;padding:8px 14px;color:var(--tx);font-size:14px;outline:none" placeholder="Add a comment..." onkeydown="if(event.key===\'Enter\')postComment()"/>\n      <button onclick="postComment()" style="background:var(--or);border:none;border-radius:50%;width:36px;height:36px;color:#fff;font-size:16px;cursor:pointer;display:flex;align-items:center;justify-content:center">&#x27A4;</button>\n    </div>\n  </div>\n</div>\n\n<!-- TICKET CONFIRMATION MODAL -->\n<div id="ticket-confirm-modal"')
    if '<!-- TICKET CONFIRMATION MODAL -->\n<div id="ticket-confirm-modal"' in s:
        write('index.html', s.replace('<!-- TICKET CONFIRMATION MODAL -->\n<div id="ticket-confirm-modal"', overlay, 1))
        print('  [ok]   add comments-overlay div')
    else:
        print('  [WARN] ticket-confirm-modal anchor not found')
else:
    print('  [skip] comments-overlay already present')

patch('index.html', "  overlay.classList.add('open');", "  overlay.style.display = 'flex';", 'open overlay')
patch('index.html', "  document.getElementById('comments-overlay').classList.remove('open');", "  document.getElementById('comments-overlay').style.display = 'none';", 'close overlay')
patch('index.html', '            <div class="ctx">${x(c.content)}</div>', '            <div class="ctx">${x(c.text || c.content || \'\')}</div>', 'comment text field')
patch('index.html', "      content: val\n    }).select('*, profiles(username, avatar_url, display_name)').single();", "      text: val\n    }).select('*, profiles(username, avatar_url, display_name)').single();", 'comment insert field')

print('\nDone! Now run:')
print('git add signin.html index.html feeds.html')
print('git commit -m "fix: signin routing, comments overlay, feeds following filter"')
print('git push origin main')
