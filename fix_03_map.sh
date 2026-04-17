#!/bin/bash
# Fix 03 — Complete map rebuild
# Run: bash /workspaces/Pulsify/fix_03_map.sh

# ── Step 1: Add CSS ───────────────────────────────────────────────────────────
python3 - << 'PYEOF'
from pathlib import Path
f = Path("/workspaces/Pulsify/index.html")
h = f.read_text()

if "glow-ring" in h:
    print("SKIP CSS — already present")
else:
    css = """
/* ── Map v3 ── */
@keyframes glow-ring{0%,100%{transform:scale(1);opacity:.7}50%{transform:scale(1.4);opacity:0}}
.mp{width:40px;height:40px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:1.1rem;border:3px solid rgba(255,255,255,.85);cursor:pointer;position:relative;transition:transform .18s}
.mp:active{transform:scale(1.2)}
.mp-ring{position:absolute;inset:-7px;border-radius:50%;border:2.5px solid currentColor;animation:glow-ring 2s ease-in-out infinite;pointer-events:none;opacity:.65}
#map-panel{position:fixed;bottom:70px;left:0;right:0;z-index:600;background:rgba(9,13,26,.97);backdrop-filter:blur(24px);border-radius:22px 22px 0 0;border:1px solid rgba(255,255,255,.12);border-bottom:none;padding:18px 16px 24px;transform:translateY(110%);transition:transform .3s cubic-bezier(.4,0,.2,1);pointer-events:none;max-width:520px;margin:0 auto}
#map-panel.open{transform:translateY(0);pointer-events:auto}
.mapboxgl-popup-content{display:none!important}
"""
    h = h.replace("</style>", css + "\n</style>", 1)
    f.write_text(h)
    print("OK   Map CSS added")
PYEOF

# ── Step 2: Add panel HTML before <nav class="bn"> ───────────────────────────
python3 - << 'PYEOF'
from pathlib import Path
f = Path("/workspaces/Pulsify/index.html")
h = f.read_text()

if 'id="map-panel"' in h:
    print("SKIP HTML — already present")
else:
    panel = '\n<!-- MAP SLIDE PANEL -->\n<div id="map-panel"></div>\n'
    h = h.replace('<nav class="bn">', panel + '<nav class="bn">', 1)
    f.write_text(h)
    print("OK   Map panel HTML added")
PYEOF

# ── Step 3: Replace the 5 old map functions with new ones ────────────────────
python3 - << 'PYEOF'
import re
from pathlib import Path
f = Path("/workspaces/Pulsify/index.html")
h = f.read_text()

NEW = r"""function initMap() {
  if (mapInited) return; mapInited = true;
  if (!window.mapboxgl) {
    document.getElementById('mc').innerHTML = '<div style="padding:40px;text-align:center;color:var(--mu)">Map unavailable</div>';
    return;
  }
  mapboxgl.accessToken = MAPBOX_TOKEN;
  mapObj = new mapboxgl.Map({
    container: 'mc',
    style: 'mapbox://styles/mapbox/dark-v11',
    center: [30.75, -29.85], zoom: 7.5, minZoom: 4, maxZoom: 17
  });
  mapObj.addControl(new mapboxgl.NavigationControl(), 'top-right');
  mapObj.on('load', () => { placeMapMarkers(); addHeatmap(); });
  mapObj.on('click', () => closeMapPanel());
}

/* Marker style lookup */
function _ms(item, type) {
  if (type === 'event') {
    const g = (item.genre || '').toLowerCase();
    if (g.includes('gqom'))                                    return {bg:'#FF2D78',sh:'255,45,120',  ico:'🔊'};
    if (g.includes('amapiano'))                                return {bg:'#B026FF',sh:'176,38,255',  ico:'🎶'};
    if (g.includes('sport')||g.includes('soccer')||g.includes('cricket')||g.includes('rugby'))
                                                               return {bg:'#00D4AA',sh:'0,212,170',   ico:'⚽'};
    if (g.includes('march'))                                   return {bg:'#C6FF4A',sh:'198,255,74',  ico:'✊',dark:true};
    if (g.includes('jazz'))                                    return {bg:'#FF9500',sh:'255,149,0',   ico:'🎷'};
    if (g.includes('hip')||g.includes('rap'))                  return {bg:'#FF0080',sh:'255,0,128',   ico:'🎤'};
    if (g.includes('comedy'))                                  return {bg:'#FFB800',sh:'255,184,0',   ico:'😂',dark:true};
    if (g.includes('festival'))                                return {bg:'#00B4D8',sh:'0,180,216',   ico:'🎉'};
    if (g.includes('shisa')||g.includes('braai')||g.includes('food')) return {bg:'#FF5C00',sh:'255,92,0',ico:'🥩'};
    if (g.includes('night')||g.includes('club'))               return {bg:'#7B2FFF',sh:'123,47,255',  ico:'🌙'};
    if (g.includes('student'))                                 return {bg:'#0077B6',sh:'0,119,182',   ico:'🎓'};
    if (g.includes('market'))                                  return {bg:'#00A86B',sh:'0,168,107',   ico:'🛍️'};
    return {bg:'#FF5C00',sh:'255,92,0',ico:'🎶'};
  }
  const c = item.category||'';
  if (c==='shisanyama') return {bg:'#DC3200',sh:'220,50,0',  ico:'🥩'};
  if (c==='restaurant') return {bg:'#FF8C00',sh:'255,140,0', ico:'🍽️'};
  if (c==='bar')        return {bg:'#8C00DC',sh:'140,0,220', ico:'🍸'};
  if (c==='club')       return {bg:'#C800FF',sh:'200,0,255', ico:'💃'};
  if (c==='hotel')      return {bg:'#0064DC',sh:'0,100,220', ico:'🏨'};
  if (c==='bnb')        return {bg:'#00A064',sh:'0,160,100', ico:'🏡'};
  return {bg:'#555',sh:'100,100,100',ico:'📍'};
}

function showMapPanel(item, type) {
  const panel = document.getElementById('map-panel');
  if (!panel) return;
  const s    = _ms(item, type);
  const img  = item.image_url || item.cover_image_url || '';
  const isEv = type === 'event';
  const price = isEv
    ? (item.is_free ? '<span style="color:var(--li);font-weight:800">FREE</span>'
      : item.price_min ? '<span style="color:var(--or);font-weight:800">R' + item.price_min + '</span>' : '')
    : (item.price_range ? '<span style="color:var(--mu)">' + item.price_range + '</span>' : '');
  const dateStr = isEv && item.date_local ? (typeof fdate==='function'?fdate(item.date_local):item.date_local) : '';
  const timeStr = isEv && item.time_local ? ' · ' + (typeof ft==='function'?ft(item.time_local):item.time_local) : '';
  const meta = isEv
    ? dateStr + timeStr + (item.venue_name ? '<br><span style="color:var(--mu)">' + x(item.venue_name) + '</span>' : '')
    : (item.rating ? '⭐ ' + item.rating + ' (' + (item.review_count||0).toLocaleString() + ' reviews)' : '')
      + (item.suburb||item.city ? '<br><span style="color:var(--mu)">' + x(item.suburb||item.city) + '</span>' : '')
      + (item.phone ? '<br><a href="tel:' + x(item.phone) + '" onclick="event.stopPropagation()" style="color:var(--cy);text-decoration:none">' + x(item.phone) + '</a>' : '');

  panel.innerHTML = `
    <button onclick="closeMapPanel()" style="position:absolute;top:12px;right:14px;width:30px;height:30px;border-radius:50%;background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.2);color:#fff;font-size:.9rem;cursor:pointer;display:flex;align-items:center;justify-content:center">✕</button>
    <div style="display:flex;gap:13px;align-items:flex-start">
      <div style="width:64px;height:64px;border-radius:12px;overflow:hidden;flex-shrink:0;background:${s.bg};display:flex;align-items:center;justify-content:center;font-size:1.8rem;border:1.5px solid rgba(255,255,255,.15)">
        ${img ? '<img src="' + x(img) + '" style="width:100%;height:100%;object-fit:cover" loading="lazy" onerror="this.parentElement.textContent=\'' + s.ico + '\'">' : s.ico}
      </div>
      <div style="flex:1;min-width:0">
        <div style="font-family:'Syne',sans-serif;font-size:.58rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--or);margin-bottom:3px">${isEv ? (item.genre||'Event') : item.category}</div>
        <div style="font-family:'Syne',sans-serif;font-size:.92rem;font-weight:800;line-height:1.25;margin-bottom:4px">${x(item.name||'')}</div>
        <div style="font-size:.72rem;color:var(--mu2);line-height:1.45">${meta}</div>
      </div>
    </div>
    ${price ? '<div style="display:flex;justify-content:space-between;align-items:center;margin-top:12px;padding-top:12px;border-top:1px solid var(--border)"><span style="font-size:.74rem;color:var(--mu)">Price</span><span style="font-family:\'Syne\',sans-serif;font-size:.9rem">' + price + '</span></div>' : ''}
    <button onclick="${isEv ? "openEv('" + x(item.id) + "')" : "openBiz('" + x(item.id) + "')"};closeMapPanel()" style="margin-top:12px;width:100%;background:linear-gradient(135deg,#B026FF,#FF5C00);color:#fff;border:none;padding:13px;border-radius:12px;font-family:'Syne',sans-serif;font-size:.83rem;font-weight:700;cursor:pointer">
      ${isEv ? '🎟 View Event & Buy Tickets →' : '📍 Visit Full Profile →'}
    </button>`;
  panel.classList.add('open');
}

function closeMapPanel() {
  document.getElementById('map-panel')?.classList.remove('open');
}

function placeMapMarkers() {
  if (!mapObj) return;
  mapMarkers.forEach(m => { try { m.remove(); } catch(e) {} });
  mapMarkers = [];

  const catF   = (document.getElementById('map-cat')?.value   || 'all').toLowerCase();
  const genreF = (document.getElementById('map-genre')?.value  || 'all').toLowerCase();

  let evs = eventsForMap.filter(e => e.venue_lat && e.venue_lon);
  let bzs = bizForMap.filter(b => b.lat && b.lon);

  if (catF === 'event')        bzs = [];
  else if (catF !== 'all') { evs = []; bzs = bzs.filter(b => b.category === catF); }
  if (genreF !== 'all')        evs = evs.filter(e => (e.genre||'').toLowerCase().includes(genreF));

  [...evs.map(e=>({item:e,type:'event'})), ...bzs.map(b=>({item:b,type:'biz'}))].forEach(({item,type}) => {
    const lat = parseFloat(type==='event' ? item.venue_lat : item.lat);
    const lon = parseFloat(type==='event' ? item.venue_lon : item.lon);
    if (!lat||!lon||isNaN(lat)||isNaN(lon)) return;

    const s  = _ms(item, type);
    const isEv = type === 'event';

    const el = document.createElement('div');
    el.className = 'mp';
    el.style.cssText = `background:${s.bg};color:${s.dark?'#000':'#fff'};box-shadow:0 0 ${isEv?24:14}px rgba(${s.sh},.${isEv?8:5}),0 3px 8px rgba(0,0,0,.7)`;
    el.textContent = s.ico;

    if (isEv) {
      const ring = document.createElement('div');
      ring.className = 'mp-ring';
      ring.style.color = s.bg;
      el.appendChild(ring);
    }

    el.addEventListener('click', e => { e.stopPropagation(); closeMapPanel(); setTimeout(()=>showMapPanel(item,type),50); });

    mapMarkers.push(new mapboxgl.Marker({element:el,anchor:'center'}).setLngLat([lon,lat]).addTo(mapObj));
  });
}

function addHeatmap() {
  if (!mapObj) return;
  const features = eventsForMap.filter(e=>e.venue_lat&&e.venue_lon).map(e=>({
    type:'Feature',
    geometry:{type:'Point',coordinates:[parseFloat(e.venue_lon),parseFloat(e.venue_lat)]},
    properties:{weight:(e.hype_score||50)/100}
  }));
  if (!features.length) return;
  try{mapObj.removeLayer('heat');mapObj.removeSource('heat');}catch(e){}
  mapObj.addSource('heat',{type:'geojson',data:{type:'FeatureCollection',features}});
  mapObj.addLayer({id:'heat',type:'heatmap',source:'heat',paint:{
    'heatmap-weight':   ['get','weight'],
    'heatmap-intensity': 1.2,
    'heatmap-color':    ['interpolate',['linear'],['heatmap-density'],
      0,   'rgba(0,0,0,0)',
      .1,  'rgba(255,45,120,.2)',
      .35, 'rgba(176,38,255,.4)',
      .6,  'rgba(255,92,0,.65)',
      .85, 'rgba(255,200,0,.8)',
      1,   'rgba(198,255,74,.95)'],
    'heatmap-radius':  55,
    'heatmap-opacity': .6
  }});
}

function applyMapFilters() { if(mapInited&&mapObj) placeMapMarkers(); }"""

# Find exact block from "function initMap" to "function applyMapFilters() { placeMapMarkers(); }"
start = h.find("function initMap() {")
end   = h.find("function applyMapFilters() { placeMapMarkers(); }")
if start == -1 or end == -1:
    print(f"ERR start={start} end={end} — patterns not found"); exit(1)
end += len("function applyMapFilters() { placeMapMarkers(); }")
h = h[:start] + NEW + h[end:]
f.write_text(h)
print("OK   Map functions replaced")
PYEOF

echo ""
echo "======================================================"
echo "  FIX 03 COMPLETE — Map rebuilt"
echo "======================================================"
echo ""
echo "Deploy:"
echo "  export VERCEL_TOKEN=\$(grep VERCEL_TOKEN /workspaces/Pulsify/.env | cut -d= -f2)"
echo "  git add index.html && git commit -m 'fix 03: map glowing markers, panel, heatmap, filters' && git push origin main && npx vercel --prod --yes --token=\$VERCEL_TOKEN"
