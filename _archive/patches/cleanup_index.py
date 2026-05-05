#!/usr/bin/env python3
"""
Remove duplicate session restore blocks from index.html.
Keeps only the Supabase version (initSupabaseSession).
"""

import re
from pathlib import Path

def cleanup_index():
    html_path = Path("index.html")
    if not html_path.exists():
        print("❌ index.html not found in current directory")
        return

    # Backup original
    backup_path = html_path.with_suffix(".html.bak")
    html_path.rename(backup_path)
    print(f"✅ Backup saved as {backup_path}")

    content = backup_path.read_text(encoding="utf-8")

    # Pattern to match old session restore blocks (non-async, with no Supabase)
    # First block: /* ── Session restore ── */ (function() { ... })();
    pattern1 = r'/\* ── Session restore ── \*/.*?\(function\(\)\s*\{.*?\}\(\)\);?\s*'
    # Second block: /* ── Pulsify session restore ── */ (function() { ... })();
    pattern2 = r'/\* ── Pulsify session restore ── \*/.*?\(function\(\)\s*\{.*?\}\(\)\);?\s*'

    # Remove both patterns (non-greedy match across lines)
    content = re.sub(pattern1, '', content, flags=re.DOTALL)
    content = re.sub(pattern2, '', content, flags=re.DOTALL)

    # Also remove any leftover empty lines from the removal
    content = re.sub(r'\n\s*\n', '\n\n', content)

    # Write cleaned content
    html_path.write_text(content, encoding="utf-8")
    print("✅ index.html cleaned. Old session restore blocks removed.")
    print("⚠️ The Supabase version (initSupabaseSession) remains untouched.")
    print("   Make sure it is still present at the end of the file.")

if __name__ == "__main__":
    cleanup_index()