# Debugging Playbook – Pulsify

## Purpose
Tracks known failures, root causes, fixes, and future risk areas.  
Updated after every resolved issue.

---

## Active Issues

- [ ] Ocean markers (positive latitudes in businesses/events)
  - Symptoms: Markers appear in ocean / northern hemisphere
  - Suspected cause: Latitude positive instead of negative
  - Affected areas: Map (`apps/map`), events API, businesses list
  - Fix: Run SQL `UPDATE businesses SET lat = -lat WHERE lat > 0 AND lat < 35;` (same for events.venue_lat)

- [ ] Map not loading on live site
  - Symptoms: Blank map, error "Could not load events"
  - Suspected cause: Missing `NEXT_PUBLIC_MAPBOX_TOKEN` in Vercel env, or CORS
  - Affected areas: `/map` page, landing page map
  - Fix: Add token to Vercel, redeploy, check browser console

- [ ] Leads API returns no data
  - Symptoms: Leads dashboard shows empty table
  - Suspected cause: Routes from `leads-api-routes.js` not merged into `api/index.js`
  - Affected areas: `/leads` dashboard
  - Fix: Merge routes before 404 handler

- [ ] Business login freeze
  - Symptoms: After login, page hangs or redirects incorrectly
  - Suspected cause: Missing call to `/api/auth/ensure-business-profile`
  - Affected areas: `/business/login.html`
  - Fix: Ensure API call is made after Supabase auth success

- [ ] Admin user list error
  - Symptoms: "column profiles.full_name does not exist"
  - Suspected cause: Wrong column name
  - Affected areas: `/admin` dashboard
  - Fix: Replace `full_name` with `display_name` in `apps/admin/index.html`

- [ ] Notifications table missing triggers
  - Symptoms: No real-time alerts for likes/comments/follows
  - Suspected cause: Triggers not created
  - Affected areas: Social feed, notifications panel
  - Fix: Create triggers after `notifications` table exists

- [ ] User photo posts require event selection + 100m radius check
  - Affects: `feeds.html`, `api/index.js`
  - Must prevent standalone posts; only allow from event detail page.
  - Server-side distance check.

- [ ] Push notifications (web or email) not implemented
  - Admin needs ability to send notifications to user segments.
  - Requires `push_subscriptions` table and service worker.

- [ ] Banner advertising only for paid subscriptions
  - Premium businesses should be able to purchase banner slots.
  - Payment integration with Paystack for banner ads.

---

## To Investigate Next
- [ ] Free vs premium subscription limits (post caps, event approval)
- [ ] Webhook reliability for leads scraping (Apify/Cloudflare)
- [ ] Map heatwave performance with many events
- [ ] Organizer ticket QR scanner — `tickets` table + `checked_in` column needed before scanner can be built
- [ ] Business login freeze — confirm `/api/auth/ensure-business-profile` is called correctly after Google OAuth in `login.html`
- [ ] Notifications triggers — social engagement (likes/follows/comments) not firing real-time alerts yet

---

## Resolved Issues

### [2026-05-13] Map nav button opened embedded panel instead of GTA-style map
- **Symptom:** Clicking the "Map" icon in the landing page bottom nav, and "View Map →" links in Home/Discover sections, opened an old embedded map panel (`tab-map`) instead of navigating to `/map`.
- **Root cause:** `onclick` handlers used `showTab('map');initMap()` (client-side tab switch) rather than a navigation redirect.
- **Fix:** Changed all three targets in `apps/landing-page/index.html` to `window.location.href='/map'` and `href="/map"`.
- **Files:** `apps/landing-page/index.html` lines 419, 441, 596.

### [2026-05-13] Map popup "View Details" showed API error / did not open detail panel
- **Symptom:** Clicking "View Details →" on a map marker popup navigated to `/?eid=xxx` or `/?bid=xxx` but the landing page loaded without opening the event or business detail.
- **Root cause:** The landing page had no code to read `eid`/`bid` URL params on load and auto-open the detail panel.
- **Fix:** Added URL param handler to `DOMContentLoaded` in `apps/landing-page/index.html` — reads `?eid=` / `?bid=` and calls `openEv()` / `openBiz()` after 400ms.
- **Files:** `apps/landing-page/index.html` (DOMContentLoaded block).

### [2026-05-13] Sitewide redirect failures — relative .html paths broken across all apps
- **Symptom:** Navigation between pages (sign in, create account, profile, feeds, back-to-menu, order confirmation) either 404'd or landed on the wrong page. `/signin` (used by business/organizer apps) hit the catch-all rewrite which mapped to `/apps/landing-page/signin` (no extension) — file not found.
- **Root cause:** Landing-page sub-pages used relative `.html` paths (`signin.html`, `index.html`, etc.) everywhere. The Vercel catch-all `"/(.+)" → "/apps/landing-page/$1"` does not add `.html` extensions, so `/signin` resolved to a non-existent file.
- **Fix:**
  - `vercel.json`: added 7 explicit routes (`/signin`, `/create-account`, `/profile-settings`, `/user-profile`, `/feeds`, `/terms`, `/business-menu`) mapping directly to the correct `.html` files.
  - Standardized all cross-page navigation to absolute clean URLs across 15 files: `signin.html` → `/signin`, `index.html` → `/`, `create-account.html` → `/create-account`, `profile-settings.html` → `/profile-settings`, `user-profile.html` → `/user-profile`, `feeds.html` → `/feeds`, `terms.html` → `/terms`.
  - `order-confirmation.html`: all links point to `/` (customer-facing page, not business dashboard).
  - `business/index.html`: menu share URL uses `/business-menu?id=` (clean path).
  - `organizer/index.html`: profile nav button now links to `/user-profile`.
  - `leads/index.html`: "Back to Dashboard" now goes to `/admin`.
  - `storage.js`: `requireAuth` and `logout` use `/signin`.
- **Files:** `vercel.json`, `apps/landing-page/index.html`, `signin.html`, `create-account.html`, `profile-settings.html`, `user-profile.html`, `feeds.html`, `storage.js`, `business-menu.html`, `apps/business/order-confirmation.html`, `login.html`, `menu.html`, `index.html`, `apps/organizer/index.html`, `apps/leads/index.html`.
- **Lesson:** All cross-app and cross-page navigation must use absolute paths. Relative `.html` references only work reliably within the same directory; vercel rewrites do not inject file extensions. Add explicit vercel routes for every named landing-page sub-page.

### [2026-05-13] QR code scanning not implemented
- **Status:** Built and deployed.
- **What was done:** jsQR added to `apps/business/index.html` for camera-based order QR scanning; qrcode.js added to `apps/business/order-confirmation.html` to generate real scannable QR codes from `order_ref`. `apps/landing-page/business-menu.html` generates the order and saves `order_ref` to localStorage for the confirmation page.
- **Remaining:** Organizer ticket scanner (needs `tickets` table + `checked_in` column first).

### [2026-05-13] Admin panel missing banner management
- **Status:** Built and deployed.
- **What was done:** Full banner CRUD in `apps/admin/index.html` (create, activate/pause, delete). API endpoints `GET/POST /admin/banners`, `PATCH/DELETE /admin/banners/:id`, `GET /banners` (public) added to `api/index.js`. Supabase `banners` table created with RLS. Map page (`apps/map/index.html`) loads and displays active banners as a dismissible strip.

---

## Claude Update Contract
Only update this file when explicitly instructed.
- Append, never rewrite history.
- Move resolved issues from "Active" to "Resolved" with date and lessons learned.
- Prefer checklists and bullet points.
