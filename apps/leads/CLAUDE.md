# Leads Dashboard – Pulsify

## Files
- `index.html` – displays scraped leads (organisers, businesses).

## API requirements (missing)
- `GET /api/leads` – list leads (admin only)
- `GET /api/leads/stats` – counts by status
- `PATCH /api/leads/:id` – update status/notes
- `POST /api/leads/email/:id` – send claim email

## Current state
- Frontend `index.html` expects these endpoints, but they are **not yet merged** into `api/index.js`.
- The file `leads-api-routes.js` contains all the code. It must be inserted before the 404 handler in `api/index.js`.

## Database
- Table: `scraped_leads` (already created via `schema_additions.sql`).
- RLS policies: must allow authenticated users (admin) to read/write.

## Next step for Claude
Merge `leads-api-routes.js` into `api/index.js` (copy the routes exactly, before the `return res.status(404)` line).

## Lead sources
- Apify (Instagram/TikTok/Facebook)
- Twitter scraper (GitHub Actions)
- Manual upload (via admin)

## Email claim flow
- When a lead has an email, a claim link is sent via Resend.
- Organiser clicks link, verifies ownership (email code or social post), then converts lead to real event.
- Converted leads appear in both leads dashboard (as converted) and admin panel (as pending events if free).

## Hard rules
- Only admin users can access (frontend and API both enforce role check).
