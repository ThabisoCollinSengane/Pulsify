#!/usr/bin/env python3
"""
STEP 1 — SA bounds validation in map component
Patches index.html:
- Validates lat/lon before rendering any marker
- Logs skipped items to console
- Fixes map container to true full screen
"""
import re, shutil, datetime
from pathlib import Path

f = Path('/workspaces/Pulsify/index.html')
shutil.copy(f, str(f) + '.bak.' + datetime.datetime.now().strftime('%H%M%S'))
h = f.read_text()

# ── STEP 1: Replace placeMapMarkers with validated version ────────────────
OLD = "    ...eventsForMap.filter(e => e.venue_lat && e.venue_lon).map(e => ({ item: e, type: 'event' })),\n    ...bizForMap.filter(b => b.lat && b.lon).map(b => ({ item: b, type: 'biz' })),"

NEW = """    ...eventsForMap
      .filter(e => {
        const la = parseFloat(e.venue_lat), lo = parseFloat(e.venue_lon);
        if (!la || !lo || isNaN(la) || isNaN(lo)) { console.warn('[Map] Event missing coords:', e.name); return false; }
        if (la < -35 || la > -22 || lo < 16 || lo > 33) { console.warn('[Map] Event outside SA bounds:', e.name, la, lo); return false; }
        return true;
      })
      .map(e => ({ item: e, type: 'event' })),
    ...bizForMap
      .filter(b => {
        const la = parseFloat(b.lat), lo = parseFloat(b.lon);
        if (!la || !lo || isNaN(la) || isNaN(lo)) { console.warn('[Map] Business missing coords:', b.name); return false; }
        if (la < -35 || la > -22 || lo < 16 || lo > 33) { console.warn('[Map] Business outside SA bounds:', b.name, la, lo); return false; }
        return true;
      })
      .map(b => ({ item: b, type: 'biz' })),"""

if OLD in h:
    h = h.replace(OLD, NEW, 1)
    print('OK  Step 1: SA bounds validation added to placeMapMarkers')
else:
    print('WARN Step 1: anchor not found — checking alternative pattern')
    # Also patch the redundant check inside the loop
    old2 = '    if (!lat||!lon||isNaN(lat)||isNaN(lon)) return;\n    if (lat<-35||lat>-22||lon<16||lon>33) return;'
    new2 = '    if (!lat||!lon||isNaN(lat)||isNaN(lon)) { console.warn("[Map] Invalid coords for", item.name); return; }\n    if (lat<-35||lat>-22||lon<16||lon>33) { console.warn("[Map] Outside SA:", item.name, lat, lon); return; }'
    if old2 in h:
        h = h.replace(old2, new2, 1)
        print('OK  Step 1: bounds check upgraded with console.warn')

# ── STEP 4: Fix map container to true full screen ─────────────────────────
# The mc div needs bottom: var(--bh) not bottom: 0
old_mc_a = 'top:calc(var(--th) + var(--tk) + 48px);left:0;right:0;bottom:var(--bh);overflow:hidden'
new_mc_a = 'top:calc(var(--th) + var(--tk) + 48px);left:0;right:0;bottom:var(--bh);overflow:hidden;will-change:transform'
if old_mc_a in h:
    h = h.replace(old_mc_a, new_mc_a, 1)
    print('OK  Step 4: map container will-change added for GPU acceleration')

old_mc_b = 'top:calc(var(--th) + var(--tk) + 50px);left:0;right:0;bottom:0;overflow:hidden'
new_mc_b = 'top:calc(var(--th) + var(--tk) + 48px);left:0;right:0;bottom:var(--bh);overflow:hidden;will-change:transform'
if old_mc_b in h:
    h = h.replace(old_mc_b, new_mc_b, 1)
    print('OK  Step 4: map container bottom fixed to clear nav bar')

# Also fix the tab-map panel itself — needs overflow:hidden and position:relative
old_panel = '<div class="panel" id="tab-map">'
new_panel = '<div class="panel" id="tab-map" style="overflow:hidden">'
if old_panel in h and 'id="tab-map" style' not in h:
    h = h.replace(old_panel, new_panel, 1)
    print('OK  Step 4: tab-map overflow:hidden set')

# Also filter heatmap to use only validated coords
old_heat = "const features = eventsForMap.filter(e=>e.venue_lat&&e.venue_lon).map(e=>({"
new_heat = """const features = eventsForMap.filter(e=>{
    const la=parseFloat(e.venue_lat),lo=parseFloat(e.venue_lon);
    return la&&lo&&!isNaN(la)&&!isNaN(lo)&&la>=-35&&la<=-22&&lo>=16&&lo<=33;
  }).map(e=>({\n"""
if old_heat in h:
    # Fix the multi-line version
    old_heat2 = "  const features = eventsForMap.filter(e=>e.venue_lat&&e.venue_lon).map(e=>({ type:'Feature', geometry:{type:'Point',coordinates:[parseFloat(e.venue_lon),parseFloat(e.venue_lat)]}, properties:{weight:(e.hype_score||50)/100} }));"
    new_heat2 = "  const features = eventsForMap.filter(e=>{ const la=parseFloat(e.venue_lat),lo=parseFloat(e.venue_lon); return la&&lo&&!isNaN(la)&&!isNaN(lo)&&la>=-35&&la<=-22&&lo>=16&&lo<=33; }).map(e=>({ type:'Feature', geometry:{type:'Point',coordinates:[lo=parseFloat(e.venue_lon),parseFloat(e.venue_lat)]}, properties:{weight:(e.hype_score||50)/100} }));"
    if old_heat2 in h:
        h = h.replace(old_heat2, new_heat2, 1)
        print('OK  Heatmap also filtered with SA bounds')

f.write_text(h)
print('\nStep 1 & 4 complete. Now run the other scripts.')