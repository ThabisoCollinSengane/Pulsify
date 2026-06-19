# Leads Dashboard — Pulsify

## Files
- `index.html` — admin lead triage UI (593 lines).
- `leads.html` — legacy alternate view; largely superseded by `index.html`.

## Routing
All `/api/leads/*` and `/api/admin/*` requests are served by **`api/admin/index.js`**
(via `vercel.json` rewrites). Identical-looking lead/scrape handlers in `api/index.js`
(~lines 1299–1507, ~2017) are dead code — never reached.

## API endpoints (all in `api/admin/index.js`)
| Method | Path | Notes |
|---|---|---|
| `POST` | `/api/leads/ingest` | Bulk insert via `x-ingest-key` header |
| `GET` | `/api/leads` | List + filter; returns status `stats` |
| `PATCH` | `/api/leads/:id` | Update `status` / `notes` |
| `GET` | `/api/leads/:id/events` | Lead_event drafts for a lead |
| `POST` | `/api/leads/:id/events` | Create a lead_event draft |
| `GET` | `/api/admin/lead-events` | All drafts (joins scraped_leads) |
| `PATCH` | `/api/admin/lead-events/:id` | `action: approve\|reject`; approve upserts into `events` |
| `POST` | `/api/admin/scrape` | On-demand OSM Overpass scraper |

## Database
- `scraped_leads` — prospects. Schema: `db/scraped_leads_schema.sql`.
- `lead_events` — event drafts. Schema: `db/lead_events_schema.sql`.
- `profile_claims` — "claim this business" form submissions. Schema: `db/profile_claims_schema.sql`.

## Permissions
All three tables: `service_role` = ALL, `authenticated` = admin-policy-gated,
`anon` = blocked. Grant file: `db/grant_leads_tables_service_role.sql`.

## Known gaps / deferred
- Email claim-link flow (Resend `POST /api/leads/email/:id`) is NOT implemented.
- OSM scraper city boxes are hardcoded in `api/admin/index.js`.
- Dead duplicate handlers in `api/index.js` should be removed.
- Legacy `leads` table (1 row, no policies) is unused — safe to drop.

## Hard rules
- Only admin users can access (frontend and API both enforce role check).
- Edit lead endpoints in `api/admin/index.js`, NOT `api/index.js`.
