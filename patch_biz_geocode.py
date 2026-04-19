#!/usr/bin/env python3
"""
STEP 2 — Patch business-login.html to geocode address on registration.
Adds address field to register form and geocodes it via Nominatim on submit.
"""
import re, shutil, datetime
from pathlib import Path

f = Path('/workspaces/Pulsify/business-login.html')
if not f.exists():
    print('ERR: business-login.html not found in Codespace')
    exit(1)

shutil.copy(f, str(f) + '.bak.' + datetime.datetime.now().strftime('%H%M%S'))
h = f.read_text()

# Add address field after the city field in register form
OLD_CITY_FIELD = '''<div class="field-wrap">
        <label class="field-label">City</label>
        <input class="ff" type="text" id="r-city" placeholder="Durban"/>
      </div>'''

NEW_CITY_FIELD = '''<div class="field-wrap">
        <label class="field-label">Physical Address *</label>
        <input class="ff" type="text" id="r-address" placeholder="e.g. 14 Stanger Street, Umlazi" autocomplete="street-address"/>
      </div>
      <div class="field-wrap">
        <label class="field-label">City *</label>
        <input class="ff" type="text" id="r-city" placeholder="Durban"/>
      </div>'''

if OLD_CITY_FIELD in h:
    h = h.replace(OLD_CITY_FIELD, NEW_CITY_FIELD, 1)
    print('OK  Address field added to register form')
else:
    print('WARN City field not found exactly — address field may need manual placement')

# Replace doRegister with geocoding version
OLD_DOREG_START = 'async function doRegister() {'
NEW_DOREG = '''/* ── Geocoding helper (Nominatim) ── */
async function geocodeAddress(address, city, province) {
  const query = [address, city, province, 'South Africa'].filter(Boolean).join(', ');
  try {
    const r = await fetch(
      'https://nominatim.openstreetmap.org/search?' + new URLSearchParams({q:query,format:'json',limit:1,countrycodes:'za'}),
      { headers: { 'User-Agent': 'Pulsify/2.0' } }
    );
    const results = await r.json();
    if (!results.length) return null;
    const lat = parseFloat(results[0].lat);
    const lon = parseFloat(results[0].lon);
    // Validate SA bounds
    if (lat < -35 || lat > -22 || lon < 16 || lon > 33) {
      console.warn('[Geocode] Outside SA bounds:', lat, lon);
      return null;
    }
    return { lat, lon };
  } catch(e) { console.warn('[Geocode] Failed:', e.message); return null; }
}

async function doRegister() {
  const name     = document.getElementById('r-name').value.trim();
  const type     = document.getElementById('r-type').value;
  const email    = document.getElementById('r-email').value.trim();
  const phone    = document.getElementById('r-phone').value.trim();
  const address  = document.getElementById('r-address')?.value.trim() || '';
  const city     = document.getElementById('r-city').value.trim();
  const province = document.getElementById('r-province')?.value || '';
  const pw       = document.getElementById('r-pw').value;
  const pw2      = document.getElementById('r-pw2').value;

  if (!name||!type||!email||!city||!pw) { showMsg('reg-msg','Please fill in all required fields','err'); return; }
  if (!address) { showMsg('reg-msg','Please enter your physical address so we can place you on the map','err'); return; }
  if (pw.length < 8) { showMsg('reg-msg','Password must be at least 8 characters','err'); return; }
  if (pw !== pw2)    { showMsg('reg-msg','Passwords do not match','err'); return; }

  const btn = document.getElementById('reg-btn');
  btn.textContent = 'Creating account…'; btn.disabled = true;

  // Geocode address before saving
  showMsg('reg-msg', 'Finding your location on the map…', 'ok');
  const coords = await geocodeAddress(address, city, province);
  if (!coords) {
    showMsg('reg-msg', 'Could not find location on map. Check your address and try again.', 'err');
    btn.textContent = 'Create Business Account'; btn.disabled = false;
    return;
  }

  showMsg('reg-msg', `✅ Location found (${coords.lat.toFixed(3)}, ${coords.lon.toFixed(3)}). Creating account…`, 'ok');

  // Try Supabase Auth
  try {
    const SUPA = 'https://cjzewfvtdayjgjdpdmln.supabase.co';
    const KEY  = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNqemV3ZnZ0ZGF5amdqZHBkbWxuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU4NTg0MjYsImV4cCI6MjA5MTQzNDQyNn0.KQ80RmaB6cfA0dkcT-pdTe53fwyUrrIBeVJtToWF_Mk';
    const r = await fetch(`${SUPA}/auth/v1/signup`, {
      method:'POST', headers:{'Content-Type':'application/json','apikey':KEY},
      body: JSON.stringify({email, password:pw, data:{full_name:name}})
    });
    const d = await r.json();
    const token = d.access_token || d.session?.access_token;
    if (token) {
      localStorage.setItem('p_token', token);
      await fetch('/api/auth/profile', {
        method:'POST', headers:{'Content-Type':'application/json','Authorization':'Bearer '+token},
        body: JSON.stringify({profile:{
          display_name:name,
          username: name.toLowerCase().replace(/\\s+/g,'_').slice(0,20),
          role:'business', city, province, phone, address,
          category: type, lat: coords.lat, lon: coords.lon
        }})
      }).catch(()=>{});
    }
  } catch(e) { console.warn('Supabase register failed, using local:', e.message); }

  // Save locally with geocoded coords
  const accounts = JSON.parse(localStorage.getItem('biz_accounts') || '[]');
  if (accounts.find(a => a.email===email)) {
    btn.textContent='Create Business Account'; btn.disabled=false;
    showMsg('reg-msg','An account with this email already exists. Please sign in.','err');
    return;
  }
  const newAcc = {
    id:'biz_'+Date.now(), name, type, email, phone, city, province,
    address, password:pw, logo:'',
    lat: coords.lat, lon: coords.lon,
    created: Date.now()
  };
  accounts.push(newAcc);
  localStorage.setItem('biz_accounts', JSON.stringify(accounts));

  const session = {id:newAcc.id, email, name, type, city, province, phone, logo:'', role:'business', lat:coords.lat, lon:coords.lon};
  localStorage.setItem('biz_session', JSON.stringify(session));
  localStorage.setItem('p_user', JSON.stringify({id:newAcc.id, email, display_name:name, role:'business'}));

  showMsg('reg-msg','✅ Account created with map location! Redirecting…','ok');
  setTimeout(()=>window.location.href='business-dashboard.html', 800);
}'''

if OLD_DOREG_START in h:
    # Find the entire old doRegister function
    start = h.find(OLD_DOREG_START)
    # Find end by matching closing brace
    depth = 0
    i = start
    while i < len(h):
        if h[i] == '{': depth += 1
        elif h[i] == '}':
            depth -= 1
            if depth == 0:
                end = i + 1
                break
        i += 1
    h = h[:start] + NEW_DOREG + h[end:]
    print('OK  doRegister replaced with geocoding version')
else:
    print('WARN doRegister not found')

f.write_text(h)
print('OK  business-login.html saved')