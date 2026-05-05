#!/usr/bin/env python3
"""
STEP 3 — One-time migration script
Reads all businesses from Supabase without valid SA coordinates,
geocodes their address using OpenStreetMap Nominatim (free, no key needed),
and updates each record with correct lat/lon.

Run: python3 geocode_migration.py
Requires: pip install requests python-dotenv --break-system-packages
"""
import os, time, requests
from pathlib import Path

# Load .env
env_path = Path('/workspaces/Pulsify/.env')
if env_path.exists():
    for line in env_path.read_text().splitlines():
        if '=' in line and not line.startswith('#'):
            k, v = line.split('=', 1)
            os.environ.setdefault(k.strip(), v.strip())

SUPA_URL = os.environ.get('SUPABASE_URL', 'https://cjzewfvtdayjgjdpdmln.supabase.co')
SUPA_KEY = os.environ.get('SUPABASE_SERVICE_KEY', '')

if not SUPA_KEY:
    print('ERR: SUPABASE_SERVICE_KEY not set in .env')
    exit(1)

HEADERS = {
    'apikey': SUPA_KEY,
    'Authorization': f'Bearer {SUPA_KEY}',
    'Content-Type': 'application/json',
}

SA_LAT = (-35, -22)
SA_LON = (16, 33)

def valid_sa(lat, lon):
    """Return True if coordinates are within South Africa bounds."""
    try:
        la, lo = float(lat), float(lon)
        return SA_LAT[0] <= la <= SA_LAT[1] and SA_LON[0] <= lo <= SA_LON[1]
    except (TypeError, ValueError):
        return False

def geocode(address: str, city: str = '', province: str = '') -> tuple:
    """
    Geocode an address using OpenStreetMap Nominatim (free, no API key).
    Returns (lat, lon) or (None, None) if not found.
    Rate limit: 1 request/second per Nominatim policy.
    """
    query = ', '.join(filter(None, [address, city, province, 'South Africa']))
    try:
        r = requests.get(
            'https://nominatim.openstreetmap.org/search',
            params={'q': query, 'format': 'json', 'limit': 1, 'countrycodes': 'za'},
            headers={'User-Agent': 'Pulsify/2.0 (pulsify.co.za)'},
            timeout=10
        )
        results = r.json()
        if results:
            lat = float(results[0]['lat'])
            lon = float(results[0]['lon'])
            if valid_sa(lat, lon):
                return lat, lon
            else:
                print(f'  SKIP outside SA: {lat}, {lon}')
    except Exception as e:
        print(f'  ERR geocoding: {e}')
    return None, None

def fetch_all_businesses():
    """Fetch all businesses from Supabase."""
    r = requests.get(
        f'{SUPA_URL}/rest/v1/businesses?select=id,name,address,suburb,city,province,lat,lon&limit=500',
        headers=HEADERS
    )
    if not r.ok:
        print(f'ERR fetching businesses: {r.text}')
        return []
    return r.json()

def update_business(biz_id: str, lat: float, lon: float):
    """Update lat/lon for a business."""
    r = requests.patch(
        f'{SUPA_URL}/rest/v1/businesses?id=eq.{biz_id}',
        headers=HEADERS,
        json={'lat': lat, 'lon': lon}
    )
    return r.ok

def main():
    print('=== Pulsify Business Geocoding Migration ===\n')
    businesses = fetch_all_businesses()
    print(f'Found {len(businesses)} businesses total\n')

    needs_geocoding = [
        b for b in businesses
        if not valid_sa(b.get('lat'), b.get('lon'))
    ]
    print(f'{len(needs_geocoding)} businesses need geocoding\n')

    if not needs_geocoding:
        print('Nothing to do — all businesses have valid SA coordinates!')
        return

    fixed = 0
    failed = []

    for biz in needs_geocoding:
        name     = biz.get('name', 'Unknown')
        address  = biz.get('address') or biz.get('suburb') or ''
        city     = biz.get('city', '')
        province = biz.get('province', '')

        print(f'Geocoding: {name}')
        print(f'  Address: {address}, {city}, {province}')

        lat, lon = geocode(address, city, province)

        if lat and lon:
            ok = update_business(biz['id'], lat, lon)
            if ok:
                print(f'  ✅ Updated: {lat:.4f}, {lon:.4f}')
                fixed += 1
            else:
                print(f'  ERR: Failed to update Supabase')
                failed.append(name)
        else:
            print(f'  ❌ Could not geocode — needs manual fix')
            failed.append(name)

        # Nominatim rate limit: 1 request per second
        time.sleep(1.1)

    print(f'\n=== Migration complete ===')
    print(f'Fixed:  {fixed}/{len(needs_geocoding)}')
    if failed:
        print(f'Failed: {len(failed)} — fix manually via admin page')
        for name in failed:
            print(f'  - {name}')

if __name__ == '__main__':
    main()