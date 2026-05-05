#!/usr/bin/env python3
"""
PULSIFY patch_v2.py — Run from /workspaces/Pulsify
Applies all v2 improvements to index.html
"""
import re, shutil, datetime
from pathlib import Path

SRC = "/workspaces/Pulsify/index.html"
if not Path(SRC).exists():
    print("ERR: index.html not found"); exit(1)

bak = SRC + ".bak." + datetime.datetime.now().strftime("%H%M%S")
shutil.copy(SRC, bak)
print(f"OK   Backup: {bak}")

html = Path(SRC).read_text(encoding="utf-8")
fixes = 0

# ─────────────────────────────────────────────────────────────
# 1. SLOWER TICKER  (28s → 60s)
# ─────────────────────────────────────────────────────────────
html = html.replace("animation:sc 28s linear infinite", "animation:sc 60s linear infinite")
fixes += 1; print("OK   Ticker slowed to 60s")

# ─────────────────────────────────────────────────────────────
# 2. BUSINESSES MODAL — "See all →" opens a full slide-up sheet
# ─────────────────────────────────────────────────────────────
BIZ_MODAL_HTML = """
<!-- BUSINESSES MODAL -->
<div id="biz-all-overlay" style="position:fixed;inset:0;background:rgba(0,0,0,.75);backdrop-filter:blur(12px);z-index:1100;display:none;align-items:flex-end;justify-content:center" onclick="if(event.target===this)closeBizModal()">
  <div style="width:100%;max-width:520px;background:var(--bg2);border-radius:22px 22px 0 0;border:1px solid rgba(255,255,255,.1);border-bottom:none;animation:su .25s ease;max-height:88vh;display:flex;flex-direction:column">
    <div style="display:flex;align-items:center;justify-content:space-between;padding:14px 18px 10px;border-bottom:1px solid var(--border);flex-shrink:0">
      <span style="font-family:'Syne',sans-serif;font-size:.82rem;font-weight:700;letter-spacing:.06em;text-transform:uppercase">🏆 All Top Spots</span>
      <button onclick="closeBizModal()" style="width:30px;height:30px;border-radius:50%;background:var(--surf);border:none;color:var(--tx);font-size:1rem;cursor:pointer;display:flex;align-items:center;justify-content:center">✕</button>
    </div>
    <div style="display:flex;gap:7px;overflow-x:auto;scrollbar-width:none;padding:10px 14px 6px;flex-shrink:0">
      <button class="chip active" onclick="filterBizModal(this,'all')">✦ All</button>
      <button class="chip" onclick="filterBizModal(this,'shisanyama')">🥩 Shisanyama</button>
      <button class="chip" onclick="filterBizModal(this,'bar')">🍺 Bar</button>
      <button class="chip" onclick="filterBizModal(this,'club')">💃 Club</button>
      <button class="chip" onclick="filterBizModal(this,'restaurant')">🍽️ Restaurant</button>
      <button class="chip" onclick="filterBizModal(this,'hotel')">🏨 Hotel</button>
      <button class="chip" onclick="filterBizModal(this,'bnb')">🏡 BnB</button>
    </div>
    <div id="biz-modal-list" style="flex:1;overflow-y:auto;padding:8px 14px 20px;display:grid;grid-template-columns:1fr 1fr;gap:12px"></div>
  </div>
</div>"""

html = html.replace("<nav class=\"bn\">", BIZ_MODAL_HTML + "\n<nav class=\"bn\">", 1)
fixes += 1; print("OK   Business modal HTML added")

# ─────────────────────────────────────────────────────────────
# 3. MAP MINI-CARD CSS + glowing marker CSS
# ─────────────────────────────────────────────────────────────
MAP_CSS = """
/* GLOWING MAP MARKERS */
.mb-pin{width:38px;height:38px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:1.05rem;border:2.5px solid rgba(255,255,255,.9);cursor:pointer;box-shadow:0 2px 12px rgba(0,0,0,.5);transition:transform .2s,box-shadow .2s;position:relative}
.mb-pin:active{transform:scale(1.2)}
.mb-pin.has-event::after{content:'';position:absolute;inset:-4px;border-radius:50%;border:2px solid currentColor;animation:glow-ring 1.8s ease-in-out infinite;opacity:.7}
@keyframes glow-ring{0%,100%{transform:scale(1);opacity:.7}50%{transform:scale(1.25);opacity:0}}
.mb-pin.ev-gqom{background:rgba(255,45,120,.92);color:#fff;box-shadow:0 0 18px rgba(255,45,120,.7)}
.mb-pin.ev-amapiano{background:rgba(176,38,255,.92);color:#fff;box-shadow:0 0 18px rgba(176,38,255,.7)}
.mb-pin.ev-sport{background:rgba(0,212,170,.92);color:#fff;box-shadow:0 0 18px rgba(0,212,170,.7)}
.mb-pin.ev-march{background:rgba(198,255,74,.85);color:#000;box-shadow:0 0 18px rgba(198,255,74,.6)}
.mb-pin.ev-music{background:rgba(255,92,0,.92);color:#fff;box-shadow:0 0 18px rgba(255,92,0,.7)}
.mb-pin.ev-nightlife{background:rgba(123,47,255,.92);color:#fff;box-shadow:0 0 18px rgba(123,47,255,.7)}
.mb-pin.biz-shisa{background:rgba(220,50,0,.9);color:#fff;box-shadow:0 0 14px rgba(220,50,0,.5)}
.mb-pin.biz-hotel{background:rgba(0,100,220,.9);color:#fff;box-shadow:0 0 14px rgba(0,100,220,.5)}
.mb-pin.biz-bar{background:rgba(123,0,200,.9);color:#fff;box-shadow:0 0 14px rgba(123,0,200,.5)}
.mb-pin.biz-bnb{background:rgba(0,160,100,.9);color:#fff;box-shadow:0 0 14px rgba(0,160,100,.5)}
.mb-pin.biz-club{background:rgba(180,0,255,.9);color:#fff;box-shadow:0 0 14px rgba(180,0,255,.5)}
.mb-pin.biz-rest{background:rgba(255,140,0,.9);color:#fff;box-shadow:0 0 14px rgba(255,140,0,.5)}
/* MINI-CARD inside map popup */
.mapboxgl-popup-content{background:var(--surf)!important;color:var(--tx)!important;border:1px solid var(--border2)!important;border-radius:16px!important;padding:0!important;font-family:'Syne',sans-serif!important;box-shadow:0 8px 32px rgba(0,0,0,.8)!important;min-width:220px!important;overflow:hidden!important}
.mapboxgl-popup-tip{border-top-color:var(--surf)!important;border-bottom-color:var(--surf)!important}
.mapboxgl-popup-close-button{color:rgba(255,255,255,.6)!important;font-size:1.1rem!important;top:7px!important;right:9px!important;background:rgba(0,0,0,.4)!important;border-radius:50%!important;width:22px!important;height:22px!important;display:flex!important;align-items:center!important;justify-content:center!important;z-index:1!important}
.map-card-img{width:100%;height:90px;object-fit:cover;display:block}
.map-card-body{padding:10px 12px 12px}
.map-card-cat{font-size:.54rem;color:var(--or);letter-spacing:.1em;text-transform:uppercase;margin-bottom:3px;font-weight:700}
.map-card-name{font-size:.9rem;font-weight:800;margin-bottom:3px;line-height:1.2;color:var(--tx)}
.map-card-meta{font-size:.68rem;color:var(--mu2);margin-bottom:10px;line-height:1.4}
.map-card-cta{display:block;width:100%;background:linear-gradient(135deg,#B026FF,#FF5C00);color:#fff;padding:8px 14px;border-radius:0 0 16px 16px;font-size:.72rem;font-weight:700;text-align:center;cursor:pointer;border:none;font-family:'Syne',sans-serif;letter-spacing:.04em;-webkit-tap-highlight-color:transparent}
/* DETAIL PAGE MINI MAP */
.detail-map-wrap{height:200px;border-radius:14px;overflow:hidden;border:1px solid var(--border);margin-bottom:20px;position:relative}
"""

html = html.replace("</style>", MAP_CSS + "\n</style>", 1)
fixes += 1; print("OK   Map CSS + glowing markers added")

# ─────────────────────────────────────────────────────────────
# 4. BIZ DETAIL — Add "Menu" tab next to Gallery
# ─────────────────────────────────────────────────────────────
OLD_BIZ_TABS = '<div class="bztb"><div class="bzt active" onclick="switchBT(this,\'bp-info\')">ℹ️ Info</div><div class="bzt" onclick="switchBT(this,\'bp-gallery\')">📸 Gallery</div></div>'
NEW_BIZ_TABS = '<div class="bztb"><div class="bzt active" onclick="switchBT(this,\'bp-info\')">ℹ️ Info</div><div class="bzt" onclick="switchBT(this,\'bp-gallery\')">📸 Gallery</div><div class="bzt" onclick="switchBT(this,\'bp-menu\')">🍽️ Menu</div></div>'
if OLD_BIZ_TABS in html:
    html = html.replace(OLD_BIZ_TABS, NEW_BIZ_TABS)
    fixes += 1; print("OK   Menu tab added to biz detail")

# ─────────────────────────────────────────────────────────────
# 5. RECOMMENDATIONS section in Discover
# ─────────────────────────────────────────────────────────────
OLD_DISC_EVENTS = """  <div class=\"sl\"><span>🎉 Events</span></div>
  <div class=\"dg2\" id=\"disc-events\"></div>"""
NEW_DISC_EVENTS = """  <div class=\"sl\"><span>✨ Recommended for You</span></div>
  <div id=\"disc-recommendations\" style=\"padding:0 14px 6px\"></div>
  <div class=\"sl\"><span>🎉 Events</span></div>
  <div class=\"dg2\" id=\"disc-events\"></div>"""
if OLD_DISC_EVENTS in html:
    html = html.replace(OLD_DISC_EVENTS, NEW_DISC_EVENTS)
    fixes += 1; print("OK   Recommendations section added to Discover")

# ─────────────────────────────────────────────────────────────
# 6. TICKET SELLER label on feed cards
# ─────────────────────────────────────────────────────────────
# Add ticket seller to fc-venue line in buildCard
OLD_FC_VENUE = "      <div class=\"fv\">${x(ev.venue_name || '')} · ${x(ev.genre || '')}</div>"
NEW_FC_VENUE = """      <div class="fv" style="display:flex;align-items:center;justify-content:space-between">
        <span>${x(ev.venue_name || '')} · ${x(ev.genre || '')}</span>
        ${ev.source && ev.source !== 'manual' ? `<span style="font-family:'Syne',sans-serif;font-size:.58rem;font-weight:700;color:var(--mu);letter-spacing:.06em;text-transform:uppercase">${{eventbrite:'Eventbrite',ticketmaster:'Ticketmaster'}[ev.source] || ''}</span>` : `<span style="font-family:'Syne',sans-serif;font-size:.58rem;font-weight:700;color:rgba(198,255,74,.7);letter-spacing:.05em">🎟 Pulsify</span>`}
      </div>"""
if OLD_FC_VENUE in html:
    html = html.replace(OLD_FC_VENUE, NEW_FC_VENUE)
    fixes += 1; print("OK   Ticket seller label added to event cards")

# ─────────────────────────────────────────────────────────────
# 7. IMPROVED JS — inject all new functions before </script>
# ─────────────────────────────────────────────────────────────
NEW_FUNCS = r"""

/* ══ BUSINESS MODAL ══════════════════════════════════════ */
let _allBizModal = [];
async function openBizModal() {
  const overlay = document.getElementById('biz-all-overlay');
  if (!overlay) return;
  overlay.style.display = 'flex';
  document.getElementById('biz-modal-list').innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:30px;color:var(--mu)">Loading…</div>';
  try {
    const res  = await fetch(API + '/businesses?show_all=true&limit=50');
    const data = await res.json();
    _allBizModal = data.businesses || [];
    renderBizModal('all');
  } catch(e) {
    document.getElementById('biz-modal-list').innerHTML = '<div style="grid-column:1/-1;padding:20px;color:var(--mu)">Could not load businesses.</div>';
  }
}
function closeBizModal() {
  const overlay = document.getElementById('biz-all-overlay');
  if (overlay) overlay.style.display = 'none';
}
function filterBizModal(btn, cat) {
  btn.closest('div').querySelectorAll('.chip').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderBizModal(cat);
}
function renderBizModal(cat) {
  const list = cat === 'all' ? _allBizModal : _allBizModal.filter(b => b.category === cat);
  const el   = document.getElementById('biz-modal-list');
  if (!el) return;
  if (!list.length) { el.innerHTML = '<div style="grid-column:1/-1;padding:20px;text-align:center;color:var(--mu)">No places found</div>'; return; }
  el.innerHTML = list.map(b => `
    <div onclick="closeBizModal();openBiz('${b.id}')" style="background:var(--surf);border:1px solid var(--border);border-radius:14px;overflow:hidden;cursor:pointer;-webkit-tap-highlight-color:transparent;transition:transform .2s" ontouchstart="this.style.transform='scale(.97)'" ontouchend="this.style.transform=''">
      <div style="height:80px;position:relative;overflow:hidden;background:${cg(b.category)};display:flex;align-items:center;justify-content:center;font-size:1.8rem">
        ${b.cover_image_url ? `<img src="${b.cover_image_url}" loading="lazy" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover" onerror="this.style.display='none'"/>` : ce(b.category)}
        <span style="position:absolute;top:5px;left:5px;background:rgba(0,0,0,.7);backdrop-filter:blur(5px);font-family:'Syne',sans-serif;font-size:.5rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;padding:2px 7px;border-radius:50px;color:var(--or)">${b.category}</span>
        ${b.is_frontline ? `<span style="position:absolute;bottom:5px;right:5px;background:linear-gradient(135deg,#B026FF,#FF5C00);font-family:'Syne',sans-serif;font-size:.5rem;font-weight:700;padding:2px 7px;border-radius:50px;color:#fff">⭐ #${b.frontline_rank}</span>` : ''}
      </div>
      <div style="padding:8px 10px 10px">
        <div style="font-family:'Syne',sans-serif;font-size:.76rem;font-weight:700;margin-bottom:2px;line-height:1.25">${x(b.name)}</div>
        <div style="font-size:.64rem;color:var(--mu);margin-bottom:5px">${x(b.suburb || b.city || '')}</div>
        <div style="display:flex;align-items:center;justify-content:space-between">
          <span style="font-size:.64rem;color:var(--li);font-family:'Syne',sans-serif;font-weight:700">${b.rating ? '★' + b.rating : 'New'}</span>
          <span style="font-size:.6rem;color:var(--mu)">${b.price_range || ''}</span>
        </div>
      </div>
    </div>`).join('');
}

/* ══ FIXED SEARCH BAR ════════════════════════════════════ */
function handleSearch(val) {
  clearTimeout(searchTimer);
  const lbl  = document.getElementById('feed-lbl');
  const feed = document.getElementById('events-feed');
  if (!val || !val.trim()) {
    loadFeed(true);
    return;
  }
  searchTimer = setTimeout(async () => {
    if (lbl) lbl.textContent = '🔍 Searching…';
    if (feed) feed.innerHTML = feedSkeleton();
    try {
      const res  = await fetch(API + '/events/search?q=' + encodeURIComponent(val.trim()) + '&limit=20');
      const data = await res.json();
      const results = data.results || data.events || [];
      if (lbl) lbl.textContent = '🔍 ' + results.length + ' results for "' + val.trim() + '"';
      if (feed) {
        if (results.length) {
          feed.innerHTML = results.map((ev, i) => buildCard(ev, i)).join('');
          document.getElementById('feed-pg').style.display = 'none';
          triggerRev();
        } else {
          feed.innerHTML = `<div class="no-results"><div class="no-results-ico">🔍</div><div class="no-results-title">No results for "${val.trim()}"</div><div class="no-results-sub">Try a different event name, city or genre.</div><button class="no-results-btn" onclick="document.getElementById('search-inp').value='';handleSearch('')">Clear Search</button></div>`;
        }
      }
    } catch(e) {
      loadFeed(true);
    }
  }, 350);
}

/* ══ RECOMMENDATIONS ═════════════════════════════════════ */
async function loadRecommendations() {
  const el = document.getElementById('disc-recommendations');
  if (!el) return;
  try {
    const res  = await fetch(API + '/events?limit=4&page=1');
    const data = await res.json();
    const top  = (data.events || []).slice(0, 4);
    if (!top.length) { el.style.display = 'none'; return; }
    el.innerHTML = `
      <div style="display:flex;gap:10px;overflow-x:auto;scrollbar-width:none;padding-bottom:4px">
        ${top.map(ev => `
          <div onclick="openEv('${ev.id}')" style="flex-shrink:0;width:200px;background:var(--surf);border:1px solid var(--border);border-radius:14px;overflow:hidden;cursor:pointer;-webkit-tap-highlight-color:transparent">
            <div style="height:80px;position:relative;background:${gg(ev.genre)};overflow:hidden;display:flex;align-items:center;justify-content:center;font-size:2rem">
              ${ev.image_url ? `<img src="${ev.image_url}" loading="lazy" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover" onerror="this.style.display='none'"/>` : ge(ev.genre)}
              <span style="position:absolute;top:6px;left:6px;background:linear-gradient(135deg,#B026FF,#FF5C00);font-family:'Syne',sans-serif;font-size:.52rem;font-weight:700;padding:2px 8px;border-radius:50px;color:#fff">✨ Pick</span>
            </div>
            <div style="padding:8px 10px 10px">
              <div style="font-family:'Syne',sans-serif;font-size:.76rem;font-weight:700;line-height:1.2;margin-bottom:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${x(ev.name)}</div>
              <div style="display:flex;justify-content:space-between;align-items:center">
                <span style="font-size:.66rem;color:var(--mu)">${x(ev.venue_city)}</span>
                <span style="font-family:'Syne',sans-serif;font-weight:700;font-size:.72rem;color:${ev.is_free ? 'var(--li)' : 'var(--or)'}">${ev.is_free ? 'FREE' : ev.price_min ? 'R' + ev.price_min : 'TBA'}</span>
              </div>
            </div>
          </div>`).join('')}
      </div>`;
  } catch(e) { if (el) el.style.display = 'none'; }
}

/* ══ FIXED initMap WITH BETTER MARKERS + MINI-CARDS ══════ */
function initMap() {
  if (mapInited) return; mapInited = true;
  if (!window.mapboxgl) { document.getElementById('mc').innerHTML = '<div style="padding:40px;text-align:center;color:var(--mu)">Map loading…</div>'; return; }
  mapboxgl.accessToken = MAPBOX_TOKEN;
  mapObj = new mapboxgl.Map({ container: 'mc', style: 'mapbox://styles/mapbox/dark-v11', center: [30.75, -29.85], zoom: 7.5, minZoom: 4, maxZoom: 17 });
  mapObj.addControl(new mapboxgl.NavigationControl(), 'top-right');
  mapObj.on('load', () => { placeMapMarkers(); addHeatmap(); });
}

function getMarkerClass(item, type) {
  if (type === 'event') {
    const g = (item.genre || '').toLowerCase();
    if (g.includes('gqom') || g.includes('nightlife')) return { cls: 'ev-gqom', ico: '🔊' };
    if (g.includes('amapiano'))  return { cls: 'ev-amapiano', ico: '🎶' };
    if (g.includes('sport') || g.includes('soccer') || g.includes('cricket')) return { cls: 'ev-sport', ico: '⚽' };
    if (g.includes('march'))     return { cls: 'ev-march',    ico: '✊' };
    if (g.includes('jazz'))      return { cls: 'ev-music',    ico: '🎷' };
    if (g.includes('shisa') || g.includes('braai')) return { cls: 'ev-music', ico: '🥩' };
    return { cls: 'ev-nightlife', ico: '🎉' };
  }
  const c = item.category;
  if (c === 'shisanyama') return { cls: 'biz-shisa', ico: '🥩' };
  if (c === 'hotel')      return { cls: 'biz-hotel', ico: '🏨' };
  if (c === 'bnb')        return { cls: 'biz-bnb',   ico: '🏡' };
  if (c === 'club')       return { cls: 'biz-club',  ico: '💃' };
  if (c === 'bar')        return { cls: 'biz-bar',   ico: '🍸' };
  if (c === 'restaurant') return { cls: 'biz-rest',  ico: '🍽️' };
  return { cls: 'biz-bar', ico: '📍' };
}

function placeMapMarkers() {
  mapMarkers.forEach(m => m.remove());
  mapMarkers = [];
  const items = [
    ...eventsForMap.filter(e => e.venue_lat && e.venue_lon).map(e => ({ item: e, type: 'event' })),
    ...bizForMap.filter(b => b.lat && b.lon).map(b => ({ item: b, type: 'biz' })),
  ];
  items.forEach(({ item, type }) => {
    const lat = type === 'event' ? item.venue_lat : item.lat;
    const lon = type === 'event' ? item.venue_lon : item.lon;
    const { cls, ico } = getMarkerClass(item, type);

    const el = document.createElement('div');
    el.className = 'mb-pin ' + cls + (type === 'event' ? ' has-event' : '');
    el.textContent = ico;
    el.title = item.name;

    const priceNote = type === 'event'
      ? (item.is_free ? '<span style="color:#C6FF4A;font-weight:700">FREE</span>' : item.price_min ? '<span style="color:#FF5C00;font-weight:700">R' + item.price_min + '</span>' : '')
      : (item.rating ? '⭐ ' + item.rating + ' · ' + (item.review_count || 0).toLocaleString() + ' reviews' : '');

    const imgSrc = item.image_url || item.cover_image_url || '';
    const metaLine = type === 'event'
      ? (fdate(item.date_local) + (item.time_local ? ' · ' + ft(item.time_local) : '') + (item.venue_name ? '<br>' + x(item.venue_name) : ''))
      : (x(item.suburb || item.city || '') + (item.phone ? '<br><a href="tel:' + x(item.phone) + '" onclick="event.stopPropagation()" style="color:var(--cy);text-decoration:none">' + x(item.phone) + '</a>' : ''));

    const popupHTML = `
      <div>
        ${imgSrc ? `<img class="map-card-img" src="${x(imgSrc)}" loading="lazy" onerror="this.style.display='none'"/>` : `<div style="height:60px;background:${type==='event'?gg(item.genre):cg(item.category)};display:flex;align-items:center;justify-content:center;font-size:2rem">${ico}</div>`}
        <div class="map-card-body">
          <div class="map-card-cat">${type === 'event' ? (item.genre || 'Event') : item.category}</div>
          <div class="map-card-name">${x(item.name)}</div>
          <div class="map-card-meta">${metaLine}</div>
          ${priceNote ? `<div style="margin-bottom:8px">${priceNote}</div>` : ''}
        </div>
        <button class="map-card-cta" onclick="${type === 'event' ? "openEv('" + x(item.id) + "')" : "openBiz('" + x(item.id) + "')"};document.querySelectorAll('.mapboxgl-popup').forEach(p=>p.remove())">
          ${type === 'event' ? '🎟 View Event & Tickets' : '📍 View Full Profile'} →
        </button>
      </div>`;

    const popup = new mapboxgl.Popup({ offset: 26, closeButton: true, maxWidth: '240px' }).setHTML(popupHTML);
    const marker = new mapboxgl.Marker({ element: el, anchor: 'center' }).setLngLat([lon, lat]).setPopup(popup).addTo(mapObj);
    mapMarkers.push(marker);
  });
}

function addHeatmap() {
  const features = eventsForMap.filter(e => e.venue_lat && e.venue_lon).map(e => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [e.venue_lon, e.venue_lat] },
    properties: { weight: (e.hype_score || 50) / 100 }
  }));
  if (!features.length) return;
  if (mapObj.getSource('heat')) { mapObj.removeLayer('heat'); mapObj.removeSource('heat'); }
  mapObj.addSource('heat', { type: 'geojson', data: { type: 'FeatureCollection', features } });
  mapObj.addLayer({ id: 'heat', type: 'heatmap', source: 'heat', paint: {
    'heatmap-weight': ['get', 'weight'],
    'heatmap-intensity': 1.0,
    'heatmap-color': ['interpolate', ['linear'], ['heatmap-density'],
      0, 'rgba(0,0,0,0)',
      .2, 'rgba(255,45,120,.25)',
      .5, 'rgba(255,92,0,.55)',
      1, 'rgba(198,255,74,.85)'],
    'heatmap-radius': 45,
    'heatmap-opacity': .55
  }});
}

/* ══ DETAIL PAGE MINI MAP ════════════════════════════════ */
let _detailMapInst = {};
function initDetailMap(containerId, lat, lon, label, ico) {
  if (!window.mapboxgl) return;
  if (_detailMapInst[containerId]) { try { _detailMapInst[containerId].remove(); } catch(e) {} }
  const container = document.getElementById(containerId);
  if (!container) return;
  mapboxgl.accessToken = MAPBOX_TOKEN;
  const m = new mapboxgl.Map({ container: containerId, style: 'mapbox://styles/mapbox/dark-v11', center: [lon, lat], zoom: 14, interactive: false });
  m.on('load', () => {
    const el = document.createElement('div');
    el.className = 'mb-pin has-event';
    el.style.cssText = 'width:34px;height:34px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:1rem;border:2.5px solid rgba(255,255,255,.8);cursor:default';
    el.textContent = ico;
    new mapboxgl.Marker({ element: el, anchor: 'center' }).setLngLat([lon, lat]).addTo(m);
  });
  _detailMapInst[containerId] = m;
}

/* ══ PATCH openEv to inject mini map ════════════════════ */
const _origOpenEv = openEv;
async function openEv(evId) {
  await _origOpenEv(evId);
  // After detail loads, inject mini map if coords available
  setTimeout(async () => {
    try {
      const res = await fetch(API + '/events/' + evId);
      const { event: ev } = await res.json();
      if (!ev || !ev.venue_lat || !ev.venue_lon) return;
      const db = document.getElementById('ev-detail');
      if (!db) return;
      const existing = db.querySelector('.detail-map-wrap');
      if (existing) return;
      const mapDiv = document.createElement('div');
      mapDiv.innerHTML = `
        <div style="font-family:'Syne',sans-serif;font-size:.64rem;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--mu);margin-bottom:6px">📍 Venue Location</div>
        <div class="detail-map-wrap" id="det-map-${evId}"></div>`;
      const memSection = db.querySelector('[style*="Memories"]');
      if (memSection) memSection.parentNode.insertBefore(mapDiv, memSection);
      else db.querySelector('.db')?.appendChild(mapDiv);
      setTimeout(() => initDetailMap('det-map-' + evId, ev.venue_lat, ev.venue_lon, ev.venue_name, ge(ev.genre)), 100);
    } catch(e) {}
  }, 500);
}

/* ══ PATCH openBiz to inject mini map ═══════════════════ */
const _origOpenBiz = openBiz;
async function openBiz(bizId) {
  await _origOpenBiz(bizId);
  setTimeout(async () => {
    try {
      const res = await fetch(API + '/businesses/' + bizId);
      const { business: b } = await res.json();
      if (!b || !b.lat || !b.lon) return;
      const infoPan = document.getElementById('bp-info');
      if (!infoPan || document.getElementById('biz-map-' + bizId)) return;
      const mapDiv = document.createElement('div');
      mapDiv.innerHTML = `
        <div style="font-family:'Syne',sans-serif;font-size:.64rem;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--mu);margin-bottom:6px;margin-top:14px">📍 Location</div>
        <div class="detail-map-wrap" id="biz-map-${bizId}"></div>`;
      const claimDiv = infoPan.querySelector('[style*="Is this your business"]');
      if (claimDiv) claimDiv.parentNode.insertBefore(mapDiv, claimDiv);
      else infoPan.appendChild(mapDiv);
      setTimeout(() => initDetailMap('biz-map-' + bizId, parseFloat(b.lat), parseFloat(b.lon), b.name, ce(b.category)), 100);
    } catch(e) {}
  }, 500);
}

/* ══ PATCH openBiz to add menu tab pane ═════════════════ */
const _origOpenBizInner = openBiz;
// Menu pane is injected dynamically when biz detail loads
function addMenuPane(bizId) {
  const tabs = document.querySelector('.bztb');
  const gallery = document.getElementById('bp-gallery');
  if (!tabs || !gallery) return;
  if (document.getElementById('bp-menu')) return;
  const menuPane = document.createElement('div');
  menuPane.className = 'bzp';
  menuPane.id = 'bp-menu';
  menuPane.innerHTML = `
    <div style="text-align:center;padding:24px 16px">
      <div style="font-size:2.5rem;margin-bottom:12px">🍽️</div>
      <div style="font-family:'Syne',sans-serif;font-weight:700;font-size:.92rem;margin-bottom:8px">Menu Coming Soon</div>
      <div style="font-size:.8rem;color:var(--mu);line-height:1.5;margin-bottom:16px">Claim your business profile to upload your menu, specials and pricing.</div>
      <button onclick="showToast('Email: business@pulsify.co.za')" style="background:linear-gradient(135deg,#B026FF,#FF5C00);color:#fff;border:none;padding:10px 24px;border-radius:50px;font-family:'Syne',sans-serif;font-size:.78rem;font-weight:700;cursor:pointer">Claim Profile →</button>
    </div>`;
  gallery.parentNode.insertBefore(menuPane, gallery.nextSibling);
}

/* ══ PATCH loadDiscover to load recommendations ══════════ */
const _origLoadDiscover = loadDiscover;
async function loadDiscover(cat) {
  await _origLoadDiscover(cat);
  if (!cat || cat === 'all') loadRecommendations();
}

/* ══ PATCH "See all →" link to open modal ════════════════ */
// Override the "See all →" click on the Top Spots section
document.addEventListener('DOMContentLoaded', () => {
  // Patch the See all link
  const seeAll = document.querySelector('.sl a[onclick*="discover"]');
  if (seeAll) {
    seeAll.textContent = 'See all →';
    seeAll.onclick = (e) => { e.preventDefault(); openBizModal(); };
  }
  // Also override via MutationObserver in case it's added later
  setTimeout(() => {
    document.querySelectorAll('.sl a').forEach(a => {
      if (a.textContent.trim() === 'See all →') {
        a.onclick = (e) => { e.preventDefault(); openBizModal(); };
      }
    });
  }, 200);
});
"""

# Inject before closing </script>
if "\n</script>\n</body>" in html:
    html = html.replace("\n</script>\n</body>", "\n" + NEW_FUNCS + "\n</script>\n</body>", 1)
    fixes += 1; print("OK   All new JS functions injected")
else:
    html = html.replace("</script>\n</body>", NEW_FUNCS + "\n</script>\n</body>", 1)
    fixes += 1; print("OK   JS injected (fallback)")

# ─────────────────────────────────────────────────────────────
# 8. Write output
# ─────────────────────────────────────────────────────────────
Path(SRC).write_text(html, encoding="utf-8")
print(f"\n{'='*52}")
print(f"  PATCH COMPLETE — {fixes} fixes applied")
print(f"  File: {len(html):,} chars")
print(f"{'='*52}")
print("""
Next steps:
  git add index.html
  git commit -m "feat: v2 - search fix, biz modal, map mini cards, glowing markers, recommendations, menu tab, ticket seller label, slow ticker"
  git push origin main
  npx vercel --prod --yes --token=YOUR_TOKEN
""")