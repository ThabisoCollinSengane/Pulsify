# CLAUDE.md — Pulsify Project Guidelines

Behavioral guidelines + project context for Claude Code.
Derived from Andrej Karpathy's observations on LLM coding pitfalls.

---

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them — don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it — don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

For multi-step tasks, state a brief plan:
1. [Step] → verify: [check]
2. [Step] → verify: [check]

---

## 5. Pulsify Project Rules

### Hard rules
1. vercel.json must only contain the API route — never add /(.*) → index.html
2. Never commit .env
3. All Python scripts must use encoding utf-8
4. Friend-search functions must use getSB() — never a locally-scoped supabase variable
5. Map markers must validate SA bounds: lat -35 to -22, lon 16 to 33
6. Never run broad regex replacements on the whole HTML file
7. Supabase service key is server-only — never in any HTML file
8. Mock data stays as fallback — real API first, mock if empty

### index.html fragile areas
- Only ONE let searchTimeout declaration
- initSupabaseSession must exist and be called via DOMContentLoaded
- searchUsers, toggleFollow, escapeHtml must use getSB()
- File must end with </script></body></html>
- Backtick count must be even
- Always backup before editing: cp index.html index.html.bak

### Database facts
- events.id is TEXT not UUID
- businesses lat/lon must be validated SA bounds before saving
- profiles.id = Supabase Auth user ID

### Deploy command
npx vercel --prod --yes --force --token=<VT>

**CRITICAL — always use `--force`.** Without it, Vercel's edge cache can serve the old CDN response for `/` even after a successful deploy. `--force` bypasses the cache and guarantees the new bundle is served immediately.

### Deployment gotcha — root index.html shadows the `/` rewrite
Vercel serves static files with higher priority than `rewrites`. If any `index.html` exists at the repo root, it will be uploaded by the CLI and served for `/`, completely bypassing the `/ → apps/landing-page/index.html` rewrite in `vercel.json`. This is why `.vercelignore` excludes `/index.html`. **Never create or leave an `index.html` at the repo root.**

Diagnosis: if `/diagnose` shows the new build version but `/` still shows old code, a stale static file is being served. Check `.vercelignore` and run with `--force`.

---

## 6. Workflow with Claude (MCP ↔ GitHub Actions)

Claude works in an **MCP environment** with the repo mounted. All deploys happen automatically via GitHub Actions — no Codespaces or terminal required.

### How edits flow
1. Claude edits files directly in the MCP repo using Read/Edit/Write.
2. Claude commits + pushes to the assigned branch (e.g. `claude/fix-...`).
3. **Merge the PR to `main`** — this is the step that deploys to production.
4. Claude merges using `mcp__github__merge_pull_request` once conflicts are resolved.

### GitHub Actions deploy workflow
- Triggers on push to `main` or any `claude/**` branch.
- **CRITICAL — only `main` deploys to production (`pulsefy.co.za`).**
  `claude/**` branches deploy to a **preview URL only** — the live site is NOT updated.
  Always merge to `main` before telling the user to check the site.
- Requires 3 repository secrets (already configured):
  - `VERCEL_TOKEN` — authentication token
  - `VERCEL_ORG_ID` — Vercel team/org ID
  - `VERCEL_PROJECT_ID` — Vercel project ID
- Production deploy: `npx vercel --prod --yes --force --token=$VERCEL_TOKEN` (main only).
- Preview deploy: `npx vercel --yes --token=$VERCEL_TOKEN` (claude/** branches).
- Workflow file: `.github/workflows/deploy.yml`

### Manual deploy (fallback if Actions unavailable)
```
npx vercel --prod --yes --force --token=<VT>
```

### Rules for this workflow
- **Prefer file edits over scripts.** Edit the file, push — Actions handles the rest.
- **No broad regex replacements** on `index.html` (Hard rule #6 above).
- **Always read before editing.** Check the actual file state — past sessions may have left partial changes.
- **Claude can merge PRs** using the GitHub MCP tools (`mcp__github__merge_pull_request`). Do this when CI is green and work is complete.
- Subscribe to PR activity with `mcp__github__subscribe_pr_activity` to watch CI and auto-fix failures.

---

## 7. Fixes Log (branch `claude/fix-event-organizer-feeds-ZCzRM`)

Major fixes applied. Read this before touching the related areas — these are non-obvious and easy to regress.

### Overlay z-index hierarchy + back button
Overlays must stack and close in descending z-index order.
- `fl-overlay` (followers/following) **4000** → `prof-overlay` **3500** → `friends-list-overlay` **3000** → `squad-invite-overlay` **2700** → `social-sheet-ov` **2600** → `notif-overlay` **2000** → `#map-panel` **400**.
- The `popstate` handler's `styleOverlays` array must list overlays in this same descending order so the back button closes the topmost one first.
- **PWA exit guard:** `DOMContentLoaded` seeds two history entries (`replaceState` base sentinel + `pushState` current). When `popstate` reaches the sentinel, `showExitConfirm()` shows an "Exit Pulsify?" dialog instead of letting the app close. `_exitConfirmed` flag lets the real exit through on the second back.

### Map marker positioning (CSS specificity — the big one)
**Root cause:** the page `<style>` loads *after* `mapbox-gl.css` with equal specificity, so `.mp-dot { position:relative }` overrode Mapbox's required `.mapboxgl-marker { position:absolute; top:0; left:0 }`. This caused markers to drift (correct at max zoom, drifting to the ocean at low zoom — flow-offset that's tiny in pixels but huge in km when zoomed out).
- **Fix:** `.mp-dot` must explicitly set `position:absolute; top:0; left:0`. **Never** set `position:relative` on a marker element.
- Removed `will-change:transform` from `.mp-dot` and `#mc` (GPU compositor fought Mapbox's main-thread positioning on Android Chrome).
- Hover/active effects use `filter`/`box-shadow` only — **never `transform`** (Mapbox owns the element's `transform`).
- Marker rings & the "YOU" pin use explicit `width/height` + negative margins for centering — **never `inset:-Npx`** (on Android Chrome `inset` on an absolutely-positioned child resolved against the map canvas, blowing the ring up to full-screen size).

### Map "snap back to Durban"
Every `placeMapMarkers()` call used to filter to KZN and `fitBounds`. Replaced with a `_mapFitDone` flag — fit to **all** markers exactly once per explicit map-tab open, never on filter changes or background refreshes.

### Map popup card not opening
**Root cause:** `#map-panel` lived inside `#tab-map` (`position:fixed; z-index:20`), which creates a stacking context — capping the panel's effective z-index at 20 globally, so the bottom nav (`z-index:800`) painted over it.
- **Fix:** `#map-panel` must be a **direct child of `<body>`**, not nested in any positioned/z-indexed panel.
- Markers listen to both `click` and `touchend` (Android Chrome sometimes drops `click` on Mapbox elements).

### Marker icons render as text
`el.textContent = svgString` printed raw `<svg>` markup. Icons are SVG strings now — use `el.innerHTML` / `insertAdjacentHTML` with a `pointer-events:none` wrapper span.

### Live-location help sheet showed raw JS
`showLocationHelp` built its retry button with `retryFn.toString()` inlined into an `onclick` attribute — the function body contained `<div>` tags that broke HTML parsing and dumped source as visible text. **Fix:** store the retry fn in `window._locRetry` and call `window._locRetry()` from the handler. Never inline `.toString()` of a function into HTML.
- The 📍 location button is a **toggle**: if the "YOU" marker is already shown, tapping hides it; otherwise it requests geolocation. Active state = bright cyan border.

### Map: globe projection + free navigation
Map uses `projection:'globe'` with `minZoom:1.5`, `dragRotate/pitch/touchPitch` enabled, touch rotation on, and `setFog()` atmosphere — gives the spinnable "circle/sphere" look. `maxBounds` was **removed** for free navigation.
- **This does NOT affect marker positioning** — that's a pure-CSS concern (see above). Globe/rotation/pitch are orthogonal; Mapbox recomputes marker transforms every frame.
- `snapMapBack()` (⌂ button) resets `bearing:0, pitch:0` too, so users can undo free rotation.
- **Trade-off:** removing `maxBounds` lets users pan off South Africa. The ⌂ reset and the once-per-open auto-fit keep the default view anchored on SA.

### Database coordinates
Inspected `cjzewfvtdayjgjdpdmln` — coordinates were clean (no positive lats, no zeros, 1 null). A one-time geocoding migration (`_archive/patches/geocode_migration.py`, Nominatim) and SA-bounds validation triggers exist for future bad data. SA bounds: **lat -35 to -22, lon 16 to 33** (Hard rule #5).

### `ticket_tiers.is_free` / `sold_out` are GENERATED columns — never insert them
`is_free` is `(price = 0)` and `sold_out` is `(capacity IS NOT NULL AND sold >= capacity)`, both `GENERATED ALWAYS`. Inserting an explicit value raises Postgres `428C9: cannot insert a non-DEFAULT value into column`. Both the organizer and business dashboards used to insert `is_free` into `ticket_tiers` inside a `.catch(()=>{})`, so paid events were saved with **zero tiers** and the event detail panel fell through to "Contact the organiser" instead of showing the Paystack buy flow. **Fix:** insert only `event_id, name, price, sort_order`; surface (don't swallow) the error. The buy flow in `index.html` `openEv()` keys entirely off `ticket_tiers` rows existing.

### Home feed breaks (businesses / community / trust) — MUST use string injection
**Do NOT use DOM-movement** and **never add a static skeleton placeholder** for these sections in the page HTML. DOM-movement (`appendChild`) broke 3× because `feedEl.innerHTML = injectPromos(...)` destroys any live node moved into `feedEl`. A static `#frontline-row` skeleton left in the HTML also caused a permanent **empty "ghost"** section near the top because the string-based `loadFrontline()` no longer fills it. There must be **no** `#frontline-row`, `#feed-break-src`, or static "Where to go" / Trust / Community blocks in the page flow — only the JS-injected ones.

**Correct pattern (enforced in production — Phase-1 business-first order):** the breaks are woven INTO `#events-feed`:
- **businesses** (`_frontlineHtml`, id `feed-break-biz`) → **TOP**, prepended above the first event card (`_placeBizBreak`). Header is "📍 Spots near you" when location is shared, else "🔥 Trending spots". Cards are proximity-ranked client-side (`_rankBusinesses`: proximity 0.5 / rating-as-hype 0.3 / frontline+reviews-as-popularity 0.2) and show an `_bizDist` "Xkm" badge — both no-ops without `userLat/userLon`.
- **map preview** (`_mapPreviewHtml()`, id `feed-break-map`) → after **4** events (`_placeMapBreak`). A 200px tappable **Mapbox Static Images** strip (no second GL instance) that opens the map tab; centred on the user (with a pin) when location is shared, else a South-Africa overview.
- **category chips** (`_CATEGORY_HTML`, id `feed-break-categories`) → after **6** events (`_placeCategoryBreak`, fixed count — no longer anchored to the businesses break)
- **trust + why Pulsefy** (`_TRUST_HTML` const, id `feed-break-trust`) → compact strip anchored directly under the category break (`_placeTrustBreak`)
- **community** (`_communityHtml`, id `feed-break-community`) → after **12** events

Mechanics:
- Each section is a **plain string**, built when its data is ready (`loadFrontline`, `loadCommunityPosts`) or a constant/function (`_TRUST_HTML`, `_mapPreviewHtml`).
- `_placeBreak(id, html, afterCount, fallbackLast)`: queries `feedEl.querySelectorAll('.fc')`, inserts `html` via `insertAdjacentHTML('afterend')` after the Nth `.fc` card. **Idempotent** — if `#id` already exists it leaves it. `fallbackLast` (only true when `_feedFinal`, i.e. last page loaded) lets a break drop to the last card when there aren't enough events. `_placeBizBreak` prepends above the first `.fc` instead (idempotent on `feed-break-biz`).
- `_injectFeedBreaks(final)` calls `_placeBizBreak`/`_placeMapBreak`/`_placeCategoryBreak`/`_placeTrustBreak`/`_placeBreak` for all five; `_ejectFeedBreaks()` removes all five by id (called before clearing the feed).
- Break content uses `.bc` / `.rd-why-card` / inline divs — **never `.fc`** — so the `.fc` index stays = event cards only.
- `loadFeed` calls `_injectFeedBreaks(_feedFinal)` after page-1 render, after promos replace innerHTML, and after each infinite-scroll append. `loadFrontline` / `loadCommunityPosts` also call it (race-safe).
- `featured-weekend` is the only remaining standalone hidden div (admin promo renderer finds it by id).

### Vibes row (Phase 2 — UX layer over genres, not a new feature)
A static `#vibe-chip-row` (5 pills: Party/Chill/Luxury/Social/Cultural) sits in the home header directly under the Quick Actions row — **static markup, NOT a woven feed-break**. It's a fast "decide what to do" layer on top of the existing genre system. `browseVibe(vibe, btn)` maps the vibe to a set of real genre tokens via `VIBE_MAP` and sets `feedGenre` to the comma-joined list, which `loadFeed` passes straight through (CAT_MAP miss → `[feedGenre]` fallback) to the events API as `genre=a,b,c`. **No new backend, no DB column.** Re-tapping the active vibe toggles back to all. Selecting a vibe clears the genre-chip highlight (and vice versa) so the two rows never show conflicting active states. The genre chips (`feed-break-categories`) remain the deeper dive-in layer woven after 6 events. **`luxury` has no DB flag** — it's a best-effort proxy (`nightlife,festival,food`) until a real `is_premium` tag exists on events/businesses.

### Map quick-jump, style toggle, stacked-marker fan-out
- **City jump** (`<select id="map-city-jump">` → `jumpToCity()`): flies to Durban/Joburg/Cape Town/Pretoria/Gqeberha; "All SA" resets `_mapFitDone=false` and re-fits to all markers. A manual jump sets `_mapFitDone=true` so the auto-fit doesn't fight it.
- **Auto-jump on feed filter:** `showTab('map')` maps `feedCity`/`feedProvince` via `_cityKeyFromName()` and focuses the map there on open. First-open uses `_pendingCityJump` (applied in the `load` handler since init is async).
- **Style toggle** (🌗 `toggleMapStyle()`): satellite-streets ⇄ dark-v11. `setStyle()` wipes custom sources/layers/images, so the cluster source + heatmap + animated cluster layers are extracted into `_addMapSourcesAndLayers()` and re-added on `once('style.load')`. Layer/map event handlers (click/hover/zoomend) are attached **once** in the `load` handler — they persist across `setStyle`, so don't re-attach them.
- **Venue grouping (replaces fan-out):** events are grouped by rounded lat/lon (4 d.p. ≈ 11m). One marker per venue; if multiple events, shows a count badge and tapping opens a venue panel listing all events. `showVenueEventsPanel(events, s)` renders the list.

---

## 8. Roadmap / Deferred Checklist

Tracked work from the security, architecture and map briefs. Tackle in order:
**architecture first, then map.** Tick items as they ship.

> See `docs/roadmap-fixes.md` for the ranked, phased fix plan (Critical → High →
> Medium) derived from the dashboards code review, and `docs/dashboards-handover.md`
> for the line-referenced review findings behind those items.

### A. Done (shipped)
- [x] #2 API rate limiting (per-IP, all entrypoints) — PR #21
- [x] #1 RLS lockdown: revoked EXECUTE on trigger fns; anon blocked on login-RPCs; auth required for notifications/report inserts — PR #21
- [x] #5 Upload limits: client guard + 6 storage buckets (5MB, jpg/png/webp) — PR #21
- [x] QR validate prefix bug (PULSEFY→PULSIFY) — PR #21
- [x] #11 Sentry wiring (inert until DSN set) — PR #21
- [x] Category mapping, Tonight rail, social-proof pill, hero, card polish — PR #20
- [x] Infinite scroll on home feed — PR #22
- [x] Venues table (DB): `public.venues`, SA-bounds trigger, location_confidence, venue_id FK + back-fill — PR #23
- [x] Group map markers by venue; count badge; multi-event venue panel — PR #23
- [x] Load events by map bounds (`?bounds=w,s,e,n`, debounced moveend) — PR #23

### B. Needs YOU (decisions / accounts — not code)
- [ ] **Enable Leaked Password Protection** — Supabase → Auth → Passwords (1 click)
- [ ] **Sentry DSN** — create project; set `PULSIFY_SENTRY_DSN` (frontend) + `SENTRY_DSN` (Vercel env)
- [ ] **Daily backups (#12)** — confirm Supabase plan includes PITR/daily backups
- [ ] **Paystack go-live** — provide live keys before payment-verify can be enabled

### C. Architecture (do FIRST — `pulsefy_architecture_1.txt`)
- [x] **Server-side payment verification (#3 / arch §3,§7,§10)** — paid flow is
      Client→`/ticket/init` (pending booking, server-computed amount)→Paystack→
      `/ticket/confirm` + `/paystack/webhook`. **Both now re-verify with Paystack
      AND assert `currency==='ZAR'` and `amount >= total_paid*100`** before flipping
      status to `confirmed` (guards client amount-tampering). Idempotent on
      `status='pending'`. Only remaining step is **YOU**: set live Paystack keys
      (`PAYSTACK_SECRET_KEY` / `PAYSTACK_PUBLIC_KEY`) + point the webhook at
      `/api/paystack/webhook`. Free tickets still auto-confirm via `/ticket/purchase`.
- [ ] **Frontend API service layer (arch §2)** — wrap `/api/*` + Supabase calls in one
      `Api` module; stop scattering direct DB calls through the 7,200-line index.html.
      (Incremental: migrate core event/booking calls first.)
- [x] **Infinite scroll (arch §6D)** — keep 10/page, load next page on scroll — PR #22
- [ ] **Consistent request validation (arch §3)** — shared validator for API bodies.
- [ ] **Frontend modularization (#14)** — split index.html into modules (big, later).
- [ ] **Queue/background jobs (arch §8)** — emails/ticket confirmations off the request path.

### D. Map (do AFTER architecture — `pulsefy_map_fixes.txt`)
- [x] **Venues table (#1)** — `public.venues`, SA-bounds trigger, location_confidence, venue_id FK + back-fill — PR #23
- [x] **Auto-geocoding (#2)** — `geocodeSA()` (api/shared.js) is now **Mapbox primary,
      Nominatim fallback**, both SA-bounds validated. Events auto-geocode on
      create/edit (api/events) → `location_confidence` 80. Self-registered
      businesses still don't geocode (their `businesses` upsert in
      `/auth/register-business` is broken — writes `contact_email`/`contact_phone`
      which aren't columns; fix that before adding a biz geocode hook).
- [x] **Coordinate validation (#3)** — SA-bounds DB trigger; client also validates before rendering — PR #23
- [x] **`location_confidence` field (#4)** — 100 verified / 80 geocoded / 50 manual / 0 unknown — PR #23
- [x] **Group events by venue (#5)** — one marker per venue; count badge; multi-event venue panel — PR #23
- [x] **Load events by map bounds (#6)** — `GET /events?bounds=w,s,e,n`; debounced moveend — PR #23
- [x] **Render only visible markers / limit at low zoom (#7)** — clustering already in place (unchanged)
- [x] **Heatmap view toggle (#8)** — 🔥 `toggleHeatmapView()` forces the `spots-heat`
      density layer at all zooms, hides clusters/markers. Fixed a leak where
      `placeMapMarkers()` (on every pan/moveend) rebuilt markers visible over the
      forced view — PR #74.
- [x] **Nearby-events panel (#9)** — ☰ `showNearbyEventsPanel()` lists `eventsForMap`
      filtered to the current viewport bounds, sorted by distance from the user
      (map-center fallback). `#map-panel` is a full-screen modal, so the snapshot
      taken on open IS the synced view (you can't pan behind it).
- [~] **User-location intelligence (#10)** — `toggleNearMe()` geolocation auto-centre +
      proximity ranking + distance badges exist. Remaining: auto-prompt/centre on
      first map open without a tap.
- [x] **Data cleaning (#11)** — daily 4am cron (`api/cron/event-cleanup.js`):
      deactivates past events, then calls `cleanup_map_data()`
      (`db/cleanup_map_data_fn.sql`) to null out-of-SA-bounds event coords and
      dedupe venues by normalized (name, city) — repointing `events.venue_id` to
      the best survivor (verified / confidence / oldest) before deleting losers.

### E. Other deferred (from security audit)
- [ ] RLS: scope `leads` + `profile_claims` permissive policies (need usage review)
- [ ] Move `pg_trgm` extension out of `public` schema (low risk)
- [x] **#15 Engagement-based `hype_score`** — `event_likes` table + `trg_like_count` trigger
      (keeps `events.like_count` live); RLS policies on `event_attendances` so RSVP writes
      land; `POST /events/:id/like` + `POST /events/:id/rsvp` toggle endpoints in
      `api/events/index.js`; `toggleEvLike`/`rsvpEv`/`_loadEvInteractionState` wired into
      event detail panel (`index.html`). `recompute_hype_scores()` cron (6am) now has real
      inputs: likes × 2 + comments × 3 + attendances, floor 20 / cap 100.
- [ ] #13 Feature-flag system (DB-backed) to toggle features safely
