#!/bin/bash
# Fix 02 — Businesses full page overlay
# Run: bash /workspaces/Pulsify/fix_02_biz_page.sh

FILE="/workspaces/Pulsify/index.html"

# ── Step 1: Add CSS before </style> ──────────────────────────────────────────
python3 - << 'PYEOF'
from pathlib import Path
f = Path("/workspaces/Pulsify/index.html")
h = f.read_text()

if "biz-page-overlay" in h:
    print("SKIP CSS — already present")
else:
    css = """
/* ── Businesses Full Page ── */
#biz-page-overlay{position:fixed;inset:0;background:var(--bg);z-index:900;display:none;flex-direction:column;overflow:hidden}
#biz-page-overlay.open{display:flex}
.bp-head{display:flex;align-items:center;justify-content:space-between;padding:14px 16px 10px;border-bottom:1px solid var(--border);flex-shrink:0;padding-top:calc(14px + env(safe-area-inset-top))}
.bp-title{font-family:'Bebas Neue',sans-serif;font-size:1.6rem;letter-spacing:.03em}
.bp-close{width:34px;height:34px;border-radius:50%;background:var(--surf);border:1px solid var(--border);color:var(--tx);font-size:1rem;cursor:pointer;display:flex;align-items:center;justify-content:center}
.bp-chips{display:flex;gap:8px;overflow-x:auto;scrollbar-width:none;padding:10px 14px 8px;flex-shrink:0;border-bottom:1px solid var(--border)}
.bp-chips::-webkit-scrollbar{display:none}
.bp-chip{flex-shrink:0;padding:7px 16px;border-radius:50px;border:1px solid var(--border);background:rgba(255,255,255,.03);font-family:'Syne',sans-serif;font-size:.72rem;font-weight:700;color:var(--mu);cursor:pointer;transition:all .2s;-webkit-tap-highlight-color:transparent}
.bp-chip.active{border-color:var(--or);color:var(--or);background:rgba(255,92,0,.1)}
.bp-grid{flex:1;overflow-y:auto;padding:14px;display:grid;grid-template-columns:1fr 1fr;gap:12px;-webkit-overflow-scrolling:touch;scrollbar-width:none}
.bp-grid::-webkit-scrollbar{display:none}
.bp-card{background:var(--surf);border:1px solid var(--border);border-radius:16px;overflow:hidden;cursor:pointer;-webkit-tap-highlight-color:transparent}
.bp-card:active{transform:scale(.97);border-color:rgba(255,92,0,.4)}
.bp-img{height:90px;position:relative;overflow:hidden;display:flex;align-items:center;justify-content:center;font-size:2rem}
.bp-img img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.bp-cat-badge{position:absolute;top:6px;left:6px;background:rgba(0,0,0,.72);backdrop-filter:blur(5px);font-family:'Syne',sans-serif;font-size:.5rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;padding:2px 8px;border-radius:50px;color:var(--or)}
.bp-featured{position:absolute;bottom:6px;right:6px;background:linear-gradient(135deg,#B026FF,#FF5C00);font-family:'Syne',sans-serif;font-size:.5rem;font-weight:700;padding:2px 8px;border-radius:50px;color:#fff}
.bp-info{padding:9px 11px 12px}
.bp-name{font-family:'Syne',sans-serif;font-size:.78rem;font-weight:700;margin-bottom:2px;line-height:1.25;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.bp-loc{font-size:.65rem;color:var(--mu);margin-bottom:6px}
.bp-foot{display:flex;align-items:center;justify-content:space-between}
.bp-rating{font-size:.66rem;color:var(--li);font-family:'Syne',sans-serif;font-weight:700}
.bp-price{font-size:.62rem;color:var(--mu)}
"""
    h = h.replace("</style>", css + "\n</style>", 1)
    f.write_text(h)
    print("OK   Biz page CSS added")
PYEOF

# ── Step 2: Add HTML overlay before <nav class="bn"> ─────────────────────────
python3 - << 'PYEOF'
from pathlib import Path
f = Path("/workspaces/Pulsify/index.html")
h = f.read_text()

if 'id="biz-page-overlay"' in h:
    print("SKIP HTML — already present")
else:
    html_block = """<!-- BUSINESSES FULL PAGE OVERLAY -->
<div id="biz-page-overlay">
  <div class="bp-head">
    <span class="bp-title">🏆 All Places</span>
    <button class="bp-close" onclick="closeBizPage()">✕</button>
  </div>
  <div class="bp-chips">
    <div class="bp-chip active" onclick="setBizCat(this,'all')">✦ All Places</div>
    <div class="bp-chip" onclick="setBizCat(this,'food')">🍽️ Food</div>
    <div class="bp-chip" onclick="setBizCat(this,'drinks')">🍸 Drinks</div>
    <div class="bp-chip" onclick="setBizCat(this,'shisanyama')">🥩 Shisanyama</div>
    <div class="bp-chip" onclick="setBizCat(this,'outdoor')">🌿 Outdoor</div>
    <div class="bp-chip" onclick="setBizCat(this,'hotel')">🏨 Hotels</div>
    <div class="bp-chip" onclick="setBizCat(this,'bnb')">🏡 BnB / Self-Catering</div>
    <div class="bp-chip" onclick="setBizCat(this,'club')">💃 Clubs</div>
  </div>
  <div class="bp-grid" id="bp-grid"></div>
</div>
"""
    h = h.replace('<nav class="bn">', html_block + '<nav class="bn">', 1)
    f.write_text(h)
    print("OK   Biz page HTML added")
PYEOF

# ── Step 3: Wire "See all →" link ─────────────────────────────────────────────
python3 - << 'PYEOF'
from pathlib import Path
f = Path("/workspaces/Pulsify/index.html")
h = f.read_text()

old = """<a onclick="showTab('discover');return false">See all →</a>"""
new = """<a onclick="openBizPage();return false">See all →</a>"""
if old in h:
    h = h.replace(old, new, 1)
    f.write_text(h)
    print("OK   See all → wired to openBizPage()")
elif "openBizPage" in h:
    print("SKIP — already wired")
else:
    print("WARN — anchor not found")
PYEOF

# ── Step 4: Add JS before </script> ──────────────────────────────────────────
python3 - << 'PYEOF'
from pathlib import Path
f = Path("/workspaces/Pulsify/index.html")
h = f.read_text()

if "_bizPageData" in h:
    print("SKIP JS — already present")
else:
    js = r"""
/* ── BUSINESSES FULL PAGE ── */
let _bizPageData = [];
let _bizPageCat  = 'all';
const _BIZ_CATS  = {
  all:[], food:['restaurant','shisanyama'], drinks:['bar','club'],
  shisanyama:['shisanyama'], outdoor:['venue','bar','shisanyama'],
  hotel:['hotel'], bnb:['bnb'], club:['club']
};

async function openBizPage() {
  const ov = document.getElementById('biz-page-overlay');
  if (!ov) return;
  ov.classList.add('open');
  _bizPageCat = 'all';
  document.querySelectorAll('.bp-chip').forEach(c =>
    c.classList.toggle('active', c.textContent.trim().startsWith('✦')));
  const grid = document.getElementById('bp-grid');
  if (grid) grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:40px;color:var(--mu)">Loading…</div>';
  try {
    const res  = await fetch(API + '/businesses?show_all=true&limit=50');
    const data = await res.json();
    _bizPageData = data.businesses || [];
    _renderBizPage();
  } catch(e) {
    if (grid) grid.innerHTML = '<div style="grid-column:1/-1;padding:30px;text-align:center;color:var(--mu)">Could not load. Check connection.</div>';
  }
}

function closeBizPage() {
  document.getElementById('biz-page-overlay')?.classList.remove('open');
}

function setBizCat(btn, cat) {
  _bizPageCat = cat;
  document.querySelectorAll('.bp-chip').forEach(c => c.classList.remove('active'));
  btn.classList.add('active');
  _renderBizPage();
}

function _renderBizPage() {
  const grid = document.getElementById('bp-grid');
  if (!grid) return;
  const cats = _BIZ_CATS[_bizPageCat] || [];
  const list = cats.length ? _bizPageData.filter(b => cats.includes(b.category)) : _bizPageData;
  if (!list.length) {
    grid.innerHTML = '<div style="grid-column:1/-1;padding:40px;text-align:center"><div style="font-size:2.5rem;margin-bottom:12px">📭</div><div style="font-family:\'Syne\',sans-serif;font-weight:700;font-size:.9rem;margin-bottom:8px">No places in this category</div><div style="font-size:.8rem;color:var(--mu)">More being added soon.</div></div>';
    return;
  }
  grid.innerHTML = list.map(b => `
    <div class="bp-card" onclick="closeBizPage();openBiz('${x(b.id)}')">
      <div class="bp-img" style="background:${cg(b.category)}">
        ${b.cover_image_url ? `<img src="${x(b.cover_image_url)}" loading="lazy" onerror="this.style.display='none'"/>` : `<span>${ce(b.category)}</span>`}
        <span class="bp-cat-badge">${x(b.category)}</span>
        ${b.is_frontline ? `<span class="bp-featured">⭐ #${b.frontline_rank}</span>` : ''}
      </div>
      <div class="bp-info">
        <div class="bp-name">${x(b.name)}</div>
        <div class="bp-loc">📍 ${x(b.suburb || b.city || '')}</div>
        <div class="bp-foot">
          <span class="bp-rating">${b.rating ? '★ ' + b.rating : 'New'}</span>
          <span class="bp-price">${b.price_range || ''}</span>
        </div>
      </div>
    </div>`).join('');
}
"""
    h = h.replace("</script>\n</body>", js + "\n</script>\n</body>", 1)
    f.write_text(h)
    print("OK   Biz page JS added")
PYEOF

echo ""
echo "======================================================"
echo "  FIX 02 COMPLETE — Businesses full page added"
echo "======================================================"
echo ""
echo "Now deploy:"
echo "  git add index.html && git commit -m 'fix 02: businesses full page' && git push origin main && npx vercel --prod --yes --token=vcp_7allqWZ8Ps19qgXqwy3NSm1QFFsDTCxX3d7Ua1RA3YfEGq9k1J4fD6WO"
