import re
from pathlib import Path

path = Path('index.html')
content = path.read_text(encoding='utf-8')

# Remove the problematic friend search block (from "/* ── Friend search & follow ── */" to just before "/* ══════════════════════════════════════════════════ BOOT")
pattern = r'/\* ── Friend search & follow ── \*/.*?(?=/\* ══════════════════════════════════════════════════\n   BOOT)'
content = re.sub(pattern, '', content, flags=re.DOTALL)

# Also remove the duplicate old session restore block if present (optional)
old_session = r'/\* ── Session restore ── \*/.*?\(function\(\)\{.*?\}\(\)\)\;?\s*'
content = re.sub(old_session, '', content, flags=re.DOTALL)

path.write_text(content, encoding='utf-8')
print('✅ Fixed index.html – friend search removed, syntax error gone.')