#!/usr/bin/env python3
"""fix_map_full.py — complete map rebuild in index.html"""
import re, shutil, datetime
from pathlib import Path

f = Path('/workspaces/Pulsify/index.html')
shutil.copy(f, str(f) + '.bak.' + datetime.datetime.now().strftime('%H%M%S'))
h = f.read_text()

# ── 1. Add map-panel CSS before </style> ─────────────────────────────────────
MAP_CSS = """
/* ── Map slide panel ── */
#map-panel{position:absolute;bottom:0;left:0;right:0;z-index:200;background:rgba(5,8,15,.97);backdrop-filter:blur(28px);border-radius:22px 22px 0 0;border:1px solid rgba(255,255,255,.12);border-bottom:none;padding:18px 16px 20px;transform:translateY(110%);transition:transform .32s cubic-bezier(.4,0,.2,1);pointer-events:none;max-width:520px;margin:0 auto}
#map-panel.open{transform:translateY(0);pointer-events:auto}
.mp-handle{width:40px;height:4px;border-radius:2px;background:rgba(255,255,255,.15);margin:0 auto 16px}
.mp-type{font-family:'Syne',sans-serif;font-size:.58rem;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--or);margin-bottom:6px}
.mp-row{display:flex;gap:14px;align-items:flex-start;margin-bottom:12px}
.mp-thumb{width:68px;height:68px;border-radius:14px;overflow:hidden;flex-shrink:0;background:var(--surf2);display:flex;align-items:center;justify-content:center;font-size:1.8rem;border:1.5px solid rgba(255,255,255,.1)}
.mp-thumb img{width:100%;height:100%;object-fit:cover}
.mp-info{flex:1;min-width:0}
.mp-name{font-family:'Syne',sans-serif;font-size:.92rem;font-weight:800;line-height:1.25;margin-bottom:4px}
.mp-sub{font-size:.72rem;color:var(--mu2);line-height:1.5}
.mp-price{font-family:'Syne',sans-serif;font-size:.86rem;font-weight:700;color:var(--or);margin-top:5px}
.mp-close{position:absolute;top:14px;right:16px;width:28px;height:28px;border-radius:50%;background:rgba(255,255,255,.08);border:none;color:var(--mu2);font-size:.9rem;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0}
.mp-cta{width:100%;background:linear-gradient(135deg,#B026FF,#FF5C00);color:#fff;border:none;padding:13px;border-radius:13px;font-family:'Syne',sans-serif;font-size:.84rem;font-weight:700;cursor:pointer;transition:opacity .2s;margin-top:4px}
.mp-cta:active{opacity:.85}
.mp-divider{height:1px;background:var(--border);margin:10px 0}
/* Legend toggle */
#map-legend-toggle{cursor:pointer;-webkit-tap-highlight-color:transparent}
#map-legend-body{transition:all .25s}
/* Glowing marker */
.mp-dot{width:26px;height:26px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:.75rem;border:2px solid rgba(255,255,255,.7);cursor:pointer;position:relative;transition:transform .15s}
.mp-dot:active{transform:scale(1.2)}
.mp-ring{position:absolute;inset:-6px;border-radius:50%;border:2px solid currentColor;animation:gring 2s ease-in-out infinite;pointer-events:none;opacity:.55}
@keyframes gring{0%,100%{transform:scale(1);opacity:.6}50%{transform:scale(1.45);opacity:0}}
"""
if 'map-panel' not in h:
    h = h.replace('</style>', MAP_CSS + '\n</style>', 1)
    print('OK  map panel CSS added')

# ── 2. Replace map tab HTML ───────────────────────────────────────────────────
OLD_MAP_TAB = h[h.find('<!-- ══ MAP ══ -->'):h.find('<!-- ══ BOOKINGS ══ -->')]

NEW_MAP_TAB = '''<!-- ══ MAP ══ -->
<div class="panel" id="tab-map">
  <!-- Filter bar -->
  <div style="position:absolute;top:calc(var(--th) + var(--tk));left:0;right:0;z-index:50;background:rgba(5,8,15,.94);backdrop-filter:blur(18px);padding:8px 12px 7px;border-bottom:1px solid var(--border2)">
    <div style="display:flex;gap:6px">
      <select id="map-cat" onchange="applyMapFilters()" style="flex:1;background:rgba(13,20,36,.9);border:1px solid var(--border2);border-radius:50px;color:var(--tx);font-family:'Syne',sans-serif;font-size:.67rem;font-weight:700;padding:7px 10px;outline:none;cursor:pointer;-webkit-appearance:none"><option value="all">✦ All Types</option><option value="event">🎟 Events</option><option value="shisanyama">🔥 Shisanyama</option><option value="bar">🍻 Bar</option><option value="club">💿 Club</option><option value="hotel">🏨 Hotel</option><option value="bnb">🛏 BnB</option></select>
      <select id="map-genre" onchange="applyMapFilters()" style="flex:1;background:rgba(13,20,36,.9);border:1px solid var(--border2);border-radius:50px;color:var(--tx);font-family:'Syne',sans-serif;font-size:.67rem;font-weight:700;padding:7px 10px;outline:none;cursor:pointer;-webkit-appearance:none"><option value="all">🎵 All Genres</option><option value="gqom">🔊 Gqom</option><option value="amapiano">🎶 Amapiano</option><option value="sport">⚽ Sport</option><option value="march">✊ March</option><option value="jazz">🎷 Jazz</option></select>
      <select id="map-radius" onchange="applyMapFilters()" style="flex:1;background:rgba(13,20,36,.9);border:1px solid var(--border2);border-radius:50px;color:var(--tx);font-family:'Syne',sans-serif;font-size:.67rem;font-weight:700;padding:7px 10px;outline:none;cursor:pointer;-webkit-appearance:none"><option value="0">📍 All Areas</option><option value="30">30 km</option><option value="50">50 km</option><option value="100">100 km</option></select>
    </div>
  </div>

  <!-- Map canvas — fills from filter bar to bottom nav -->
  <div id="mc" style="position:absolute;top:calc(var(--th) + var(--tk) + 48px);left:0;right:0;bottom:var(--bh);overflow:hidden"></div>

  <!-- Legend — collapsible, bottom-left -->
  <div id="map-legend" style="position:absolute;bottom:calc(var(--bh) + 14px);left:12px;z-index:100;background:rgba(5,8,15,.93);backdrop-filter:blur(18px);border:1px solid rgba(255,255,255,.1);border-radius:14px;overflow:hidden;pointer-events:auto">
    <div id="map-legend-toggle" onclick="toggleLegend()" style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;cursor:pointer">
      <span style="font-family:'Syne',sans-serif;font-size:.58rem;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--or)">Map Key</span>
      <span id="legend-arrow" style="font-size:.6rem;color:var(--mu);margin-left:10px;transition:transform .25s">▾</span>
    </div>
    <div id="map-legend-body" style="padding:4px 12px 10px;display:none">
      <div style="display:flex;align-items:center;gap:7px;margin-bottom:5px;font-size:.62rem;font-weight:700;color:var(--mu2);font-family:'Syne',sans-serif"><span style="width:18px;text-align:center">🔊</span>Gqom / Nightlife</div>
      <div style="display:flex;align-items:center;gap:7px;margin-bottom:5px;font-size:.62rem;font-weight:700;color:var(--mu2);font-family:'Syne',sans-serif"><span style="width:18px;text-align:center">🎵</span>Amapiano</div>
      <div style="display:flex;align-items:center;gap:7px;margin-bottom:5px;font-size:.62rem;font-weight:700;color:var(--mu2);font-family:'Syne',sans-serif"><span style="width:18px;text-align:center">⚽</span>Sport</div>
      <div style="display:flex;align-items:center;gap:7px;margin-bottom:5px;font-size:.62rem;font-weight:700;color:var(--mu2);font-family:'Syne',sans-serif"><span style="width:18px;text-align:center">✊</span>March</div>
      <div style="display:flex;align-items:center;gap:7px;margin-bottom:5px;font-size:.62rem;font-weight:700;color:var(--mu2);font-family:'Syne',sans-serif"><span style="width:18px;text-align:center">🔥</span>Shisanyama</div>
      <div style="display:flex;align-items:center;gap:7px;margin-bottom:5px;font-size:.62rem;font-weight:700;color:var(--mu2);font-family:'Syne',sans-serif"><span style="width:18px;text-align:center">🍻</span>Bar / Club</div>
      <div style="display:flex;align-items:center;gap:7px;margin-bottom:5px;font-size:.62rem;font-weight:700;color:var(--mu2);font-family:'Syne',sans-serif"><span style="width:18px;text-align:center">🏨</span>Hotel</div>
      <div style="display:flex;align-items:center;gap:7px;font-size:.62rem;font-weight:700;color:var(--mu2);font-family:'Syne',sans-serif"><span style="width:18px;text-align:center">🛏</span>BnB / Stay</div>
    </div>
  </div>

  <!-- Slide-up info panel — appears on marker tap -->
  <div id="map-panel">
    <div class="mp-handle"></div>
    <button class="mp-close" onclick="closeMapPanel()">✕</button>
    <div id="mp-content"></div>
  </div>
</div>

'''

if OLD_MAP_TAB:
    h = h.replace(OLD_MAP_TAB, NEW_MAP_TAB, 1)
    print('OK  map tab HTML replaced')

# ── 3. Replace all map JS functions ──────────────────────────────────────────
# Find start and end of map JS block
start = h.find('function initMap()')
end   = h.find('function applyMapFilters() { placeMapMarkers(); }')
if start == -1 or end == -1:
    print(f'ERR cannot find map functions (start={start} end={end})')
else:
    end += len('function applyMapFilters() { placeMapMarkers(); }')
    NEW_MAP_JS = r"""function initMap() {
  if (mapInited) return; mapInited = true;
  if (!window.mapboxgl) {
    document.getElementById('mc').innerHTML = '<div style="padding:40px;text-align:center;color:var(--mu)">Map unavailable</div>';
    return;
  }
  mapboxgl.accessToken = MAPBOX_TOKEN;
  mapObj = new mapboxgl.Map({
    container: 'mc',
    style: 'mapbox://styles/mapbox/navigation-night-v1',
    center: [30.75, -29.85],
    zoom: 7.5, minZoom: 4, maxZoom: 18,
    dragRotate: false,
    pitchWithRotate: false,
    touchPitch: false,
  });
  mapObj.touchZoomRotate.disableRotation();
  mapObj.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right');
  mapObj.on('load', () => { placeMapMarkers(); addHeatmap(); });
  mapObj.on('click', () => closeMapPanel());
}

/* Icon and colour lookup */
function _ms(item, type) {
  if (type === 'event') {
    const g = (item.genre || '').toLowerCase();
    if (g.includes('gqom')   || g.includes('nightlife')) return {bg:'#FF2D78',sh:'255,45,120', ico:'🔊'};
    if (g.includes('amapiano'))                           return {bg:'#B026FF',sh:'176,38,255', ico:'🎵'};
    if (g.includes('sport')  || g.includes('soccer'))    return {bg:'#00D4AA',sh:'0,212,170',  ico:'⚽'};
    if (g.includes('march')  || g.includes('solidar'))   return {bg:'#C6FF4A',sh:'198,255,74', ico:'✊',dark:true};
    if (g.includes('jazz'))                               return {bg:'#FF9500',sh:'255,149,0',  ico:'🎷'};
    if (g.includes('hip')    || g.includes('rap'))        return {bg:'#FF0080',sh:'255,0,128',  ico:'🎤'};
    if (g.includes('gospel'))                             return {bg:'#FFB347',sh:'255,179,71', ico:'🙏',dark:true};
    if (g.includes('shisa')  || g.includes('braai'))     return {bg:'#FF5C00',sh:'255,92,0',   ico:'🔥'};
    if (g.includes('maskandi'))                           return {bg:'#8B4513',sh:'139,69,19',  ico:'🪗'};
    if (g.includes('festival'))                           return {bg:'#00B4D8',sh:'0,180,216',  ico:'🎪'};
    if (g.includes('night')  || g.includes('club'))      return {bg:'#7B2FFF',sh:'123,47,255', ico:'🌙'};
    if (g.includes('student'))                            return {bg:'#0077B6',sh:'0,119,182',  ico:'🎓'};
    return {bg:'#FF5C00',sh:'255,92,0',ico:'🎟'};
  }
  const c = (item.category||'').toLowerCase();
  if (c==='shisanyama') return {bg:'#C0392B',sh:'192,57,43',   ico:'🔥'};
  if (c==='restaurant') return {bg:'#E67E22',sh:'230,126,34',  ico:'🍴'};
  if (c==='bar')        return {bg:'#6C3483',sh:'108,52,131',  ico:'🍻'};
  if (c==='club')       return {bg:'#8E44AD',sh:'142,68,173',  ico:'💿'};
  if (c==='hotel')      return {bg:'#2471A3',sh:'36,113,163',  ico:'🏨'};
  if (c==='bnb')        return {bg:'#1A8A5A',sh:'26,138,90',   ico:'🛏'};
  if (c==='venue')      return {bg:'#D35400',sh:'211,84,0',    ico:'🎪'};
  return {bg:'#555',sh:'100,100,100',ico:'📍'};
}

function placeMapMarkers() {
  if (!mapObj) return;
  mapMarkers.forEach(m => { try { m.remove(); } catch(e){} });
  mapMarkers = [];

  const catF   = (document.getElementById('map-cat')?.value   || 'all').toLowerCase();
  const genreF = (document.getElementById('map-genre')?.value  || 'all').toLowerCase();

  let evs = eventsForMap.filter(e => e.venue_lat && e.venue_lon);
  let bzs = bizForMap.filter(b => b.lat && b.lon);

  if (catF === 'event')       bzs = [];
  else if (catF !== 'all') { evs = []; bzs = bzs.filter(b => (b.category||'').toLowerCase() === catF); }
  if (genreF !== 'all')       evs = evs.filter(e => (e.genre||'').toLowerCase().includes(genreF));

  [...evs.map(e=>({item:e,type:'event'})), ...bzs.map(b=>({item:b,type:'biz'}))].forEach(({item,type}) => {
    const lat = parseFloat(type==='event' ? item.venue_lat : item.lat);
    const lon = parseFloat(type==='event' ? item.venue_lon : item.lon);
    if (!lat||!lon||isNaN(lat)||isNaN(lon)) return;
    if (lat<-35||lat>-22||lon<16||lon>33) return;

    const s    = _ms(item, type);
    const isEv = type === 'event';

    const el = document.createElement('div');
    el.className = 'mp-dot';
    el.style.cssText = `background:${s.bg};color:${s.dark?'#000':'#fff'};box-shadow:0 0 ${isEv?20:12}px rgba(${s.sh},.${isEv?7:4}),0 2px 8px rgba(0,0,0,.7);width:26px;height:26px`;
    el.textContent = s.ico;
    el.style.fontSize = '.7rem';

    if (isEv) {
      const ring = document.createElement('div');
      ring.className = 'mp-ring';
      ring.style.color = s.bg;
      el.appendChild(ring);
    }

    el.addEventListener('click', e => {
      e.stopPropagation();
      showMapPanel(item, type, s);
    });

    mapMarkers.push(new mapboxgl.Marker({element:el,anchor:'center'}).setLngLat([lon,lat]).addTo(mapObj));
  });
}

function showMapPanel(item, type, s) {
  const panel = document.getElementById('map-panel');
  const mp    = document.getElementById('mp-content');
  if (!panel || !mp) return;

  const isEv     = type === 'event';
  const img      = item.image_url || item.cover_image_url || '';
  const name     = x(item.name || '');
  const cat      = isEv ? (item.genre || 'Event') : (item.category || 'Place');
  const sub      = isEv
    ? (typeof fdate==='function' ? fdate(item.date_local) : (item.date_local||''))
      + (item.time_local ? ' · ' + item.time_local : '')
      + (item.venue_name ? '<br>' + x(item.venue_name) : '')
    : ((item.rating ? '⭐ ' + item.rating : '') + (item.suburb||item.city ? ' · ' + x(item.suburb||item.city) : ''))
      + (item.phone ? '<br><a href="tel:' + x(item.phone) + '" onclick="event.stopPropagation()" style="color:var(--cy);text-decoration:none">' + x(item.phone) + '</a>' : '');

  const price = isEv
    ? (item.is_free ? '<span style="color:var(--li)">FREE</span>'
       : item.price_min ? '<span style="color:var(--or)">From R' + item.price_min + '</span>' : '')
    : (item.price_range ? '<span style="color:var(--mu)">' + x(item.price_range) + '</span>' : '');

  mp.innerHTML = `
    <div class="mp-type">${x(cat)}</div>
    <div class="mp-row">
      <div class="mp-thumb" style="background:${s.bg}">
        ${img ? `<img src="${x(img)}" loading="lazy" onerror="this.parentElement.textContent='${s.ico}'"/>` : s.ico}
      </div>
      <div class="mp-info">
        <div class="mp-name">${name}</div>
        <div class="mp-sub">${sub}</div>
        ${price ? `<div class="mp-price">${price}</div>` : ''}
      </div>
    </div>
    ${price && isEv ? '' : ''}
    <div class="mp-divider"></div>
    <button class="mp-cta" onclick="${isEv ? `openEv('${x(item.id)}');closeMapPanel()` : `openBiz('${x(item.id)}');closeMapPanel()`}">
      ${isEv ? '🎟 View Event & Buy Tickets →' : '📍 View Full Profile →'}
    </button>`;

  panel.classList.add('open');
}

function closeMapPanel() {
  document.getElementById('map-panel')?.classList.remove('open');
}

function toggleLegend() {
  const body  = document.getElementById('map-legend-body');
  const arrow = document.getElementById('legend-arrow');
  const open  = body.style.display !== 'none';
  body.style.display  = open ? 'none' : 'block';
  arrow.style.transform = open ? 'rotate(0deg)' : 'rotate(180deg)';
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
      .1,  'rgba(255,45,120,.25)',
      .35, 'rgba(176,38,255,.45)',
      .6,  'rgba(255,92,0,.7)',
      .85, 'rgba(255,200,0,.85)',
      1,   'rgba(198,255,74,1)'],
    'heatmap-radius':  55,
    'heatmap-opacity': .55
  }});
}

function applyMapFilters() { if(mapInited&&mapObj) placeMapMarkers(); }"""

    h = h[:start] + NEW_MAP_JS + h[end:]
    print('OK  map JS functions replaced')

f.write_text(h)
print('\n✅ fix_map_full.py done — deploy to see changes')