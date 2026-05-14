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

### [2026-05-14] Landing page served stale code — "Could not load events. Check your connection."
- **Symptom:** Site at `/` consistently showed old error UI ("Could not load events. Check your connection.") even after successful deploys. `/diagnose` showed new code but `/` returned "No build-version found — OLD CODE".
- **Root cause:** An untracked `index.html` existed at the Codespaces repo root from an earlier session. When deploying via `npx vercel --prod`, the CLI uploads the entire working directory (including untracked files). Vercel serves static files with higher priority than `rewrites`, so the stale root `index.html` was served for `/` instead of the rewrite `/ → apps/landing-page/index.html`.
- **Fix:** Created `.vercelignore` at repo root excluding `/index.html` (and all `.bak` / junk files). Added `--force` flag to CLI deploy command to bypass edge cache. Future deploys use `npx vercel --prod --yes --force --token=<token>`.
- **Files:** `.vercelignore` (new), `vercel.json` (added `/diagnose` rewrite).
- **Lesson:** CRITICAL — Vercel static files always beat rewrites. Any `index.html` at the repo root will shadow the `/` rewrite and serve forever from the CDN until `.vercelignore` excludes it. Always check `/diagnose` vs `/` when the site appears stuck. Run deploys with `--force`.

### [2026-05-14] Supabase JS SDK hanging silently on Android Chrome mobile
- **Symptom:** Landing page loaded but never rendered events on Android Chrome; no error, just a permanent spinner. Desktop and iOS worked fine.
- **Root cause:** `autoRefreshToken: true` (default) caused the SDK to attempt a background token refresh on an unstable mobile network, blocking the ready state. Also, `detectSessionInUrl: true` (default) tried to parse the URL for auth callbacks on every page load, adding extra latency.
- **Fix:** Added `detectSessionInUrl: false` to `createClient()` options in `getSB()`. Added a 12-second `AbortController` timeout to `loadFeed()` and `loadFrontline()` queries so they fail fast instead of hanging indefinitely.
- **Files:** `apps/landing-page/index.html` — `getSB()` function and `loadFeed`/`loadFrontline` query blocks.

### [2026-05-14] Sign-out not clearing Supabase session
- **Symptom:** Tapping "Sign Out" dismissed the menu but the user remained signed in on refresh.
- **Root cause:** Sign-out handler only cleared `localStorage` items manually but did not call `supabase.auth.signOut()`, leaving the Supabase auth session cookie active.
- **Fix:** Added `await sb2.auth.signOut()` call before clearing localStorage in the sign-out handler.
- **Files:** `apps/landing-page/index.html` — sign-out handler.

### [2026-05-14] `diagnose.html` SDK crash — `const URL` shadowed browser constructor
- **Symptom:** Diagnose page Supabase SDK test failed with "Invalid supabaseUrl: Provided URL is malformed" even though the URL string was correct.
- **Root cause:** `diagnose.html` declared `const URL = 'https://...'` at the top level, shadowing the browser's global `URL` constructor. The Supabase SDK internally calls `new URL(supabaseUrl)` — this used the string instead of the constructor, throwing a TypeError.
- **Fix:** Renamed the variable to `const SUPA_URL`.
- **Files:** `apps/landing-page/diagnose.html`.

### [2026-05-14] Report functionality — businesses and posts
- **Status:** Built and deployed (PR #8 merged).
- **What was done:** Created `business_reports` and `post_reports` tables in Supabase (mirroring `event_reports` schema). Unified report handler in `api/index.js` covering `/report-event`, `/report-business`, `/report-post`. Generic `openReportModal(type, id, name)` in landing page index.html (backward-compatible). 🚩 Report button on business detail sheet and post cards in `feeds.html`. Admin panel updated with type filter and typed PATCH endpoint.

### [2026-05-14] Organizer dashboard tab row overlapping bottom nav
- **Symptom:** 6 tabs with `flex:1; flex-wrap:wrap` wrapped onto 2 rows on mobile, pushing the 📢 Post tab below the bottom navigation bar where it was untappable.
- **Root cause:** 6 equal-width `flex:1` tabs in ~360px width = ~56px each minimum, wrapping when combined padding exceeds viewport. Bottom nav is fixed at `70px` height but the page didn't account for the 2-row tab height.
- **Fix:** Changed `.tabs` to `overflow-x:auto; scrollbar-width:none` (horizontal scroll), set `.tab` to `flex-shrink:0; padding:6px 10px; white-space:nowrap`, removed `flex-wrap:wrap` inline style. All 6 tabs now sit in a single scrollable row.
- **Files:** `apps/organizer/index.html` — `.tabs` and `.tab` CSS rules.

---

## Claude Update Contract
Only update this file when explicitly instructed.
- Append, never rewrite history.
- Move resolved issues from "Active" to "Resolved" with date and lessons learned.
- Prefer checklists and bullet points.
