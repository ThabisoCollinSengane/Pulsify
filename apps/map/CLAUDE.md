# Map Dashboard – Pulsify

## Technology
- Mapbox GL JS (v3.11.0)
- Supabase Realtime for live event updates (planned)
- Events loaded from `/api/events`

## Common failure points (from live debugging)
1. **Missing Mapbox token in Vercel env** – must be named `NEXT_PUBLIC_MAPBOX_TOKEN`
2. **API key restrictions** – domain must allow `pulsify-blue.vercel.app`
3. **CORS** – ensure `Access-Control-Allow-Origin` includes the domain
4. **Invalid coordinates** – positive latitudes cause ocean markers (see global SQL fix)
5. **Events API returns empty** – check Supabase RLS and date filter (`gte('date_local', today)`)

## Hard rules
- SA bounds validation (`validCoord`) must be applied to every marker.
- Map must never rotate – only zoom and pan (already enforced).

## Current state
- Basic map works, but markers are missing because of coordinate issues.
- GTA-style redesign (glowing pins, info panel, compass) is ready but not yet merged as default.

## To fix map loading (priority)
1. Add `NEXT_PUBLIC_MAPBOX_TOKEN` to Vercel environment variables.
2. Redeploy.
3. If still broken, test the events API: `curl https://pulsify-blue.vercel.app/api/events`
4. If events API returns 500, check `api/index.js` for syntax errors.

## Planned enhancements
- Real-time event addition via Supabase Realtime subscription.
- Heatmap layer for crowded areas.
- User location centering (partially done).
