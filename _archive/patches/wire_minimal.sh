#!/bin/bash
# wire_minimal.sh
# Changes to index.html:
# 1. "Sign In" button (top-right) → goes to signin.html when logged out
# 2. On page load, if user is logged in → button says "Feed" → goes to feeds.html
# NOTHING ELSE CHANGES IN index.html

cp /workspaces/Pulsify/index.html /workspaces/Pulsify/index.html.bak.$(date +%H%M%S)
echo "OK   Backup created"

python3 - << 'PYEOF'
import re
from pathlib import Path

f = Path("/workspaces/Pulsify/index.html")
h = f.read_text()

# ── 1. Sign In button → signin.html when logged out ──────────
old_btn = """<button class="sb" id="auth-btn" onclick="openModal('auth-modal')">Sign In</button>"""
new_btn = """<button class="sb" id="auth-btn" onclick="window.location.href='signin.html'">Sign In</button>"""
if old_btn in h:
    h = h.replace(old_btn, new_btn, 1)
    print("OK   Sign In button → signin.html")
else:
    print("WARN Sign In button not found (may already be patched)")

# ── 2. Inject session check — runs on every page load ────────
# If user is logged in: top-right button = "Feed" → feeds.html
# If logged out: button stays "Sign In" → signin.html
SESSION_JS = """
/* ── Pulsify session restore ── */
(function() {
  try {
    const s = JSON.parse(localStorage.getItem('p_user'));
    if (s && s.id) {
      // User is logged in — change top-right button to "Feed"
      document.addEventListener('DOMContentLoaded', function() {
        const btn = document.getElementById('auth-btn');
        if (btn) {
          btn.textContent = 'Feed';
          btn.onclick = function() { window.location.href = 'feeds.html'; };
        }
      });
    }
  } catch(e) {}
})();
"""

# Inject right before </script></body>
anchor = "</script>\n</body>"
if SESSION_JS.strip()[:30] not in h:
    if anchor in h:
        h = h.replace(anchor, SESSION_JS + "\n" + anchor, 1)
        print("OK   Session restore script injected")
    else:
        print("WARN </script></body> anchor not found")
else:
    print("SKIP Session script already present")

f.write_text(h)
print("\nDONE — index.html patched. Deploy to see changes.")
PYEOF
