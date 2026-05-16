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

### [2026-05-14] CRITICAL — Landing page serving stale old HTML despite successful deploys
- **Symptom:** `/` returned "Could not load events. Check your connection." no matter how many times the project was redeployed. `/diagnose` (which has no root equivalent) correctly served new code. Site appeared to "snap back" instantly on load.
- **Root cause:** An untracked `index.html` existed at the Codespaces repo root from an earlier manual edit. Vercel's CLI (`npx vercel --prod`) uploads the entire working directory including untracked files. Vercel serves static files before evaluating `vercel.json` rewrites, so the root `index.html` silently took precedence over the rewrite `/ → apps/landing-page/index.html`. Since it was untracked, `git pull` never replaced it, and it persisted across sessions.
- **Fix:** Created `.vercelignore` at repo root with `/index.html` listed. On next CLI deploy, Vercel excluded it and the rewrite resolved correctly.
- **Lesson:** Vercel static files always win over rewrites. Any `index.html` at the root will intercept `/` regardless of `vercel.json`. Keep `.vercelignore` updated. When `/` and a non-root path serve different content, a stale root file is the first thing to check.
- **Files:** `.vercelignore` (new file).

### [2026-05-14] Supabase JS SDK hanging on Android Chrome mobile — events not loading
- **Symptom:** On Android Chrome (mobile network), the landing page spinner ran indefinitely; events never loaded. Desktop worked fine.
- **Root cause:** `autoRefreshToken: true` (the default) caused the SDK to attempt a token refresh using `AbortController` internally. On mobile networks the fetch stalled indefinitely with no timeout, blocking the session check that gates all data fetches.
- **Fix 1:** Added `detectSessionInUrl: false` to `createClient()` options in `getSB()` — prevents the SDK from scanning URL hash for OAuth tokens on every page load, which was a secondary hang source.
- **Fix 2:** Added a 12-second `AbortController` timeout around `loadFeed` and `loadFrontline` Supabase queries via `.abortSignal(_abort.signal)`. If the query stalls, it aborts and falls through to mock data.
- **Files:** `apps/landing-page/index.html` — `getSB()` and `loadFeed`/`loadFrontline` functions.

### [2026-05-14] Sign-out not clearing Supabase session
- **Symptom:** Tapping sign out returned user to landing page but they remained logged in (profile icon still showed name, protected routes still accessible).
- **Root cause:** The sign-out handler called `localStorage.clear()` but never called `sb.auth.signOut()`. The Supabase session token remained valid in `localStorage`/`IndexedDB` and the SDK auto-restored it on next page load.
- **Fix:** Added `await sb2.auth.signOut()` before clearing localStorage in the sign-out handler.
- **Files:** `apps/landing-page/index.html` — sign-out handler.

### [2026-05-14] `diagnose.html` crashed Supabase SDK — `const URL` shadowed browser constructor
- **Symptom:** The diagnose page test for "Supabase SDK connectivity" consistently failed with "Invalid supabaseUrl: Provided URL is malformed" even with a correct URL string.
- **Root cause:** `diagnose.html` had `const URL = 'https://...'` at the top scope. This shadowed the global `URL` constructor. The Supabase SDK calls `new URL(supabaseUrl)` internally — with `URL` now a string, `new URL(...)` threw `TypeError: URL is not a constructor`.
- **Fix:** Renamed the variable to `const SUPA_URL`.
- **Lesson:** Never use `URL`, `fetch`, `Request`, `Response`, or `Headers` as variable names — all are global browser constructors.
- **Files:** `apps/landing-page/diagnose.html`.

### [2026-05-14] Report functionality — businesses and posts
- **Status:** Built and deployed (PR #8 merged).
- **What was done:** Created `business_reports` and `post_reports` tables in Supabase (mirroring `event_reports` schema). Unified report handler in `api/index.js` covering `/report-event`, `/report-business`, `/report-post`. Generic `openReportModal(type, id, name)` in landing page index.html (backward-compatible). 🚩 Report button on business detail sheet and post cards in `feeds.html`. Admin panel updated with type filter and typed PATCH endpoint.
- **Files:** `api/index.js`, `apps/landing-page/index.html`, `apps/landing-page/feeds.html`, `apps/admin/index.html`.

### [2026-05-14] Vercel GitHub auto-deploy watching wrong repo
- **Symptom:** Merging PRs to `ThabisoCollinSengane/Pulsify` main showed no Vercel deployment. Deployments only appeared when using the CLI directly.
- **Root cause:** Vercel's Git integration was connected to the `thabisosengane5-collab` GitHub account's fork, not the `ThabisoCollinSengane` account. Two separate GitHub accounts own two separate repo copies; only one is wired to Vercel.
- **Fix / Workaround:** Always deploy via `npx vercel --prod --yes --token=<token>` from the Codespaces terminal after pulling the latest code. Do not rely on auto-deploy from PR merges.
- **Lesson:** Confirm which GitHub account/repo Vercel is watching in Vercel Dashboard → Project Settings → Git. CLI deploys bypass this entirely and upload local files directly.

### [2026-05-14] Organizer dashboard tab row overlapping bottom nav — Post tab unreachable
- **Symptom:** The 6-tab row in the organizer dashboard wrapped to two lines on mobile, pushing the last row down behind the bottom navigation bar. The "📢 Post" tab (first tab, left on second row) was visually present but could not be tapped.
- **Root cause:** `.tab { flex:1 }` with 6 tabs caused each tab to be too narrow, so `flex-wrap:wrap` (set as inline style on the container) triggered a second row. The second row sat behind the fixed bottom nav (`z-index:800`).
- **Fix:** Made the tab container horizontally scrollable (`overflow-x:auto; scrollbar-width:none`), removed `flex-wrap:wrap`, set `flex-shrink:0` on each tab, and reduced tab padding from `9px` to `6px 10px` so all 6 tabs fit in one scrollable row.
- **Files:** `apps/organizer/index.html` — `.tabs` and `.tab` CSS, tabs container div.

---

## Claude Update Contract
Only update this file when explicitly instructed.
- Append, never rewrite history.
- Move resolved issues from "Active" to "Resolved" with date and lessons learned.
- Prefer checklists and bullet points.
