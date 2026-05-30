# Organizer Dashboard – Pulsify

## Files
- `index.html` – create events, manage posts, view stats.

## Event creation flow
1. Organizer fills form.
2. Data sent to Supabase `events` table directly (via anon client) and to `/api/posts` for feed.
3. **Subscription check** (to be implemented):
   - If `subscription_type = 'free'` → event inserted with `approved = false`. Admin must approve before it appears on map/feed.
   - If `premium` or `trial` → `approved = true` immediately.
4. Also create a post in `posts` table announcing the event (if within post limit for free accounts).

## Column mappings (critical)
- `venue_city` not `city` — the events table uses `venue_city`
- `time_local` is a separate column from `date_local`
- `date_local` = just the date string (e.g. `2026-06-15`)
- `time_local` = just the time string (e.g. `20:00`)

## Post limits (free accounts — to be implemented)
- Maximum **5 posts per month** (calendar month, beta limit).
- Check in `api/index.js` before inserting post. Return 403 if limit exceeded.

## Admin approval (to be implemented)
- Admin panel (`/admin`) must show pending events (where `approved = false`).
- Admin can approve/reject. When approved, event becomes visible.

## QR code scanning (to be implemented)
- Organizer will scan tickets at door.
- Camera access, QR parsing, API call to mark ticket as `checked_in = true`.
- Endpoint: `POST /api/validate-ticket` with QR data.

## To be built
- [ ] Subscription field in profiles (`subscription_type`)
- [ ] `approved` column in `events` table
- [ ] Admin approval UI
- [ ] Post limit enforcement
- [ ] QR scanner view

## Hard rules
- Role must be `organizer` in `profiles`.
- Coordinates must be valid SA (use geocoding if missing).
- Free accounts cannot spam.
- Never use `city` column — always `venue_city`.
