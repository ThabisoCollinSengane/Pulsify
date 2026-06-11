# Debugging Playbook – Pulsify

## Purpose
Tracks known failures, root causes, fixes, and future risk areas.  
Updated after every resolved issue.

---

## Active Issues

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

- [ ] `multiple_permissive_policies` (169 instances in Supabase advisor)
  - Overlapping OR'd RLS policies on same table/role cause extra policy evaluation overhead per query.
  - Not an immediate exploit — low priority audit task.

- [ ] Enable leaked password protection in Supabase Auth
  - Dashboard toggle only: Supabase Dashboard → Auth → Settings → Enable Leaked Password Protection (HaveIBeenPwned).
  - Not doable via SQL/MCP — must be done manually by project owner.

---

## To Investigate Next
- [ ] Free vs premium subscription limits (post caps, event approval)
- [ ] Webhook reliability for leads scraping (Apify/Cloudflare)
- [ ] Map heatwave performance with many events
- [ ] Organizer ticket QR scanner — `tickets` table + `checked_in` column needed before scanner can be built
- [ ] Business login freeze — confirm `/api/auth/ensure-business-profile` is called correctly after Google OAuth in `login.html`
- [ ] 32 unused indexes in Supabase (advisor) — intentionally left; many are btree indexes on `ILIKE` columns where the planner can't use them. Revisit if read latency degrades.
- [ ] `storage.objects` write/upload RLS policies — app uses service-role for uploads so this hasn't mattered, but should be audited if direct-client uploads are added.

---

## Resolved Issues

### [2026-06-11] Supabase security & performance hardening (PR #12)
- **auth_rls_initplan (97 instances):** All RLS policies on hot tables (events, posts, profiles, follows, notifications, ticket_tiers, payments, comments, bookings) were re-evaluating `auth.uid()` as a correlated subplan per row. Replaced with `(SELECT auth.uid())` so the planner treats it as a constant. Biggest query-perf fix without schema changes.
- **Function search_path mutable:** 17 trigger/helper functions had a mutable `search_path`, enabling schema-hijack attacks. Added `SET search_path = 'public'` to all of them.
- **Anon EXECUTE on internal trigger functions:** 10 internal trigger functions (`_sync_like_count`, `handle_new_user`, `trg_notif_on_follow`, etc.) were callable by anon via `/rest/v1/rpc/`. Revoked EXECUTE from `anon`.
- **KYC documents world-readable:** `kyc_docs_service_all` policy used `USING(true)` for ALL operations, letting any authenticated user read every KYC document. Replaced with `kyc_docs_owner_read` (SELECT, own rows only). Server-side service-role access unaffected.
- **Storage bucket listing:** 7 broad SELECT policies across 6 public buckets allowed clients to enumerate all filenames. Dropped all listing policies; public object URLs (getPublicUrl) bypass RLS and are unaffected.
- **Duplicate indexes:** Dropped 4 duplicate indexes (each had an identical twin remaining): `idx_bookings_ref`, `idx_payments_reference`, `idx_follows_follower`, `idx_follows_following`.
- **Files:** DB migrations only (no app files).

### [2026-06-11] Event feed UX + performance (PR #12)
- **Source badges:** Ticketmaster/Eventbrite/Quicket show as branded pill overlays on card images (partner brand colours). Detail panel header chip is colour-coded to match.
- **Image resize:** `iU()` helper rewrites Unsplash/Supabase image URLs to the right width + WebP (feed cards 800px, detail hero 1200px, business cards 600px/1200px, thumbnails 200–400px). ~60–80% transfer saving on mobile.
- **Image fallbacks:** Genre gradient set as `.fb` background so failed/slow images show a coloured card instead of blank.
- **Image fade-in:** Card and detail-hero images fade 0→1 on load instead of popping in.
- **Cross-source dedup:** `_evFp()` fingerprint (normalized name + date) prevents the same real-world event from Ticketmaster DB and live Quicket API rendering twice.
- **First 3 cards eager-loaded** for faster above-the-fold perceived load.
- **Feed API caching:** `/api/events` now sends `Cache-Control: public, max-age=20, stale-while-revalidate=60`. Removed `cache:no-store` on client fetch.
- **Event-detail cache:** `openEv()` caches event + tiers + photos for 60s; re-tapping same event is instant.
- **Demo event ranking:** Lowered `hype_score` on `tm_demo_*` events (72) vs real `tm_*` (82) so real organiser events surface first.
- **Files:** `apps/landing-page/index.html`, `api/index.js`.

### [2026-05-14] Map markers drifting / appearing in ocean
- **Root cause:** `.mp-dot { position:relative }` overrode Mapbox's required `position:absolute; top:0; left:0`. Marker coordinates in DB were clean (confirmed via SQL: no positive lats, no zeros, 1 null).
- **Fix:** Explicit `position:absolute; top:0; left:0` on `.mp-dot`. Never `position:relative` on a Mapbox marker element. Removed `will-change:transform` which caused GPU/main-thread conflict on Android Chrome.
- **Files:** `apps/landing-page/index.html` — `.mp-dot` CSS.

### [2026-05-14] Map not loading on live site
- **Root cause:** Mapbox token missing from Vercel env + `#map-panel` nested inside `#tab-map` (z-index capped at 20, buried under bottom nav at 800).
- **Fix:** Added `NEXT_PUBLIC_MAPBOX_TOKEN` to Vercel. Moved `#map-panel` to direct child of `<body>`.
- **Files:** `apps/landing-page/index.html`, Vercel env vars.

### [2026-05-14] Notifications triggers missing
- **Status:** Resolved — triggers `trg_notif_on_follow`, `trg_notif_on_reaction`, `trg_notif_on_comment` are confirmed active in DB. `_pulsify_notify_post_like` and `_pulsify_notify_post_comment` trigger functions exist.

### [2026-05-13] Map nav button opened embedded panel instead of GTA-style map
- **Fix:** Changed all three targets in `apps/landing-page/index.html` to `window.location.href='/map'` and `href="/map"`.
- **Files:** `apps/landing-page/index.html` lines 419, 441, 596.

### [2026-05-13] Map popup "View Details" showed API error
- **Fix:** Added URL param handler to `DOMContentLoaded` — reads `?eid=` / `?bid=` and calls `openEv()` / `openBiz()` after 400ms.
- **Files:** `apps/landing-page/index.html` (DOMContentLoaded block).

### [2026-05-13] Sitewide redirect failures — relative .html paths broken
- **Fix:** Added 7 explicit Vercel routes; standardized all cross-page navigation to absolute clean URLs across 15 files.
- **Lesson:** All cross-app navigation must use absolute paths. Vercel rewrites do not inject file extensions.
- **Files:** `vercel.json`, `apps/landing-page/index.html`, `signin.html`, `create-account.html`, `profile-settings.html`, `user-profile.html`, `feeds.html`, `storage.js`, and others.

### [2026-05-13] QR code scanning not implemented
- **Status:** Built and deployed.
- **What was done:** jsQR added to `apps/business/index.html`. `qrcode.js` added to `apps/business/order-confirmation.html`. `business-menu.html` generates and saves `order_ref`.
- **Remaining:** Organizer ticket scanner (needs `tickets` table + `checked_in` column).

### [2026-05-13] Admin panel missing banner management
- **Status:** Built and deployed.
- **What was done:** Full banner CRUD in `apps/admin/index.html`. API endpoints `GET/POST /admin/banners`, `PATCH/DELETE /admin/banners/:id`, `GET /banners`. Supabase `banners` table with RLS.

### [2026-05-14] CRITICAL — Landing page serving stale old HTML despite successful deploys
- **Root cause:** Untracked `index.html` at repo root took precedence over the `/ → apps/landing-page/index.html` rewrite. Vercel static files always win over rewrites.
- **Fix:** Created `.vercelignore` with `/index.html`. Deploy now uses `--force` flag.
- **Lesson:** Never create `index.html` at repo root. When `/` and a non-root path serve different content, check `.vercelignore` first.
- **Files:** `.vercelignore`.

### [2026-05-14] Supabase JS SDK hanging on Android Chrome mobile
- **Fix 1:** `detectSessionInUrl: false` in `createClient()`.
- **Fix 2:** 12-second `AbortController` timeout around `loadFeed`/`loadFrontline`.
- **Files:** `apps/landing-page/index.html` — `getSB()` and feed functions.

### [2026-05-14] Sign-out not clearing Supabase session
- **Fix:** Added `await sb2.auth.signOut()` before clearing localStorage.
- **Files:** `apps/landing-page/index.html` — sign-out handler.

### [2026-05-14] `diagnose.html` crashed Supabase SDK — `const URL` shadowed browser constructor
- **Fix:** Renamed variable to `const SUPA_URL`.
- **Lesson:** Never use `URL`, `fetch`, `Request`, `Response`, `Headers` as variable names.
- **Files:** `apps/landing-page/diagnose.html`.

### [2026-05-14] Report functionality — businesses and posts
- **Status:** Built and deployed (PR #8 merged).
- **Files:** `api/index.js`, `apps/landing-page/index.html`, `apps/landing-page/feeds.html`, `apps/admin/index.html`.

### [2026-05-14] Vercel GitHub auto-deploy watching wrong repo
- **Workaround:** Always deploy via GitHub Actions (`.github/workflows/deploy.yml`) on push to `main` or `claude/**` branches. CLI fallback: `npx vercel --prod --yes --force --token=<token>`.
- **Lesson:** Confirm which GitHub account/repo Vercel is watching in Vercel Dashboard → Project Settings → Git.

### [2026-05-14] Organizer dashboard tab row overlapping bottom nav
- **Fix:** Made tab container horizontally scrollable; removed `flex-wrap:wrap`; `flex-shrink:0` on each tab; reduced padding.
- **Files:** `apps/organizer/index.html`.

---

## Claude Update Contract
Only update this file when explicitly instructed.
- Append, never rewrite history.
- Move resolved issues from "Active" to "Resolved" with date and lessons learned.
- Prefer checklists and bullet points.
