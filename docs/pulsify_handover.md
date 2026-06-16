# Pulsify — Developer Handover Document
**Date:** April 2026  
**Project:** South African live event discovery platform  
**Repo:** https://github.com/thabisosengane5-collab/Pulsify  
**Live URL:** Check with `npx vercel ls --token=$VT`  
**Working directory:** `C:\Users\nonja\Desktop\Pulsify` (Windows 10, Git Bash)

---

## Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Single-file HTML/CSS/JS (no framework) |
| Backend API | Vercel serverless — `api/index.js` (Node.js) |
| Database | Supabase (PostgreSQL + Auth + RLS) |
| Maps | Mapbox GL JS v3.3.0 — `navigation-night-v1` style |
| Payments | Paystack (ZAR) |
| Hosting | Vercel (personal token auth) |

---

## Credentials (store safely — rotate if exposed)

```
Supabase URL:       https://cjzewfvtdayjgjdpdmln.supabase.co
Supabase anon key:  eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNqemV3ZnZ0ZGF5amdqZHBkbWxuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU4NTg0MjYsImV4cCI6MjA5MTQzNDQyNn0.KQ80RmaB6cfA0dkcT-pdTe53fwyUrrIBeVJtToWF_Mk
Supabase service key: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNqemV3ZnZ0ZGF5amdqZHBkbWxuIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NTg1ODQyNiwiZXhwIjoyMDkxNDM0NDI2fQ.BosLm4saNaxMRDaWDENDwKZGqZf2vdai05c92foHUjY
Mapbox token:       pk.eyJ1IjoidGhhY29sbGluMiIsImEiOiJjbW51Mm95cHEwYm8xMnJyMXEzaXgxMDBmIn0.nF80wBOn-jxhjpAIus9anw
Paystack public:    pk_test_ef8796acebf766e5dde7cc185b5135551779d78a
Paystack secret:    sk_test_961aab3abb864d8a35333c972645472c98fdb561
Vercel token:       stored in C:\Users\nonja\Desktop\Pulsify\.env as VERCEL_TOKEN
```

---

## File Structure

```
Pulsify/
├── index.html              ← Main app (all tabs: home, discover, map, bookings, friends, profile)
├── feeds.html              ← Social feed (posts, likes, comments, reposts)
├── signin.html             ← Supabase Auth sign-in + Google OAuth
├── create-account.html     ← 2-step registration
├── profile-settings.html   ← Edit profile (bio, genres, avatar, etc.)
├── user-profile.html       ← View own profile (posts, attended events)
├── terms.html              ← Terms of Service
├── business-login.html     ← Business portal login/register
├── business-dashboard.html ← Business management (orders, stats, posts)
├── business-menu.html      ← Menu CRUD
├── order-confirmation.html ← Order receipt
├── pulsify-admin.html      ← Admin page: fix business coordinates
├── storage.js              ← Shared data layer (API first, localStorage fallback)
├── api/
│   └── index.js            ← All backend routes (events, businesses, posts, auth, etc.)
├── vercel.json             ← {"routes":[{"src":"/api/(.*)","dest":"/api/index.js"}]}
├── package.json            ← { "@supabase/supabase-js": "^2.43.0" }
└── .env                    ← VERCEL_TOKEN=... (never commit this)
```

---

## Deploy Command

```bash
# Windows Git Bash
export VT=$(grep VERCEL_TOKEN /c/Users/nonja/Desktop/Pulsify/.env | cut -d= -f2)
npx vercel --prod --yes --token=$VT
```

**Critical:** `vercel.json` must only contain the API route. Never add `"/(.*)" → index.html` — that breaks all sub-pages.

---

## Database Schema (Supabase)

### Core tables
| Table | Purpose |
|-------|---------|
| `profiles` | User profiles. Extends `auth.users`. Has `role`, `bio`, `genres`, `city`, `province`, `avatar_url` |
| `events` | All events. `id` is TEXT (from Ticketmaster/Eventbrite). Has `venue_lat`, `venue_lon`, `genre`, `hype_score` |
| `businesses` | Venues, shisanyamas, bars, hotels, BnBs. Has `lat`, `lon`, `category`, `rating` |
| `bookings` | Ticket purchases. Has `booking_ref`, `qr_data`, `status` |
| `ticket_tiers` | Ticket types per event |
| `posts` | Social feed posts. `user_id` → profiles, `event_id` → events (TEXT FK) |
| `follows` | Follow relationships. `follower_id` + `following_id` → profiles |
| `reactions` | Likes on posts/events. `entity_id` is TEXT, `entity_type` is 'post'/'event' |
| `comments` | Comments on posts/events |
| `reposts` | Reposts of posts |
| `event_attendances` | Records when a user attends an event |
| `saved_items` | Bookmarked events/businesses |
| `menu_items` | Business menu items |
| `pickup_orders` | Customer pickup orders |
| `business_hours` | Opening hours per business |
| `notifications` | User notifications |
| `payments` | Paystack payment records |

### RLS Policies (already applied via fix_rls.sql)
- `profiles`: public SELECT (anyone can read), own-row UPDATE/INSERT only
- `follows`: authenticated SELECT all, own INSERT/DELETE only
- `posts`: public SELECT where visibility='public', own INSERT/DELETE
- `reactions`, `comments`: public SELECT, own INSERT/DELETE
- All tables: service_role has full bypass

---

## API Routes (`api/index.js`)

```
GET  /api/events              Paginated events with city/genre/radius filters
GET  /api/events/:id          Single event + ticket tiers + photos
GET  /api/events/search       Search events by text
GET  /api/businesses          Paginated businesses
GET  /api/businesses/:id      Single business
GET  /api/posts               Social feed (filter: all/following/organizers)
POST /api/posts               Create post (users need image, organizers free)
DEL  /api/posts/:id           Delete own post
POST /api/reactions           Toggle like
POST /api/posts/:id/repost    Toggle repost
GET  /api/comments/:type/:id  Get comments
POST /api/comments            Add comment
POST /api/follow/:id          Follow/unfollow
GET  /api/following           Who current user follows
GET  /api/user/attended       Events user attended
GET  /api/user/bookings       User's ticket bookings
GET  /api/saved               Saved items
POST /api/saved               Toggle save
POST /api/ticket/purchase     Buy ticket → Paystack
GET  /api/booking/:ref        Get booking by reference
POST /api/paystack/webhook    Paystack payment confirmation
POST /api/auth/profile        Create/update profile after sign-up
GET  /api/auth/profile        Get current user profile
GET  /api/menu/:business_id   Business menu
POST /api/menu                Add menu item (business only)
PUT  /api/menu/item/:id       Update menu item
DEL  /api/menu/item/:id       Delete menu item
GET  /api/orders/:biz_id      Get orders (business only)
POST /api/orders              Place pickup order
PUT  /api/orders/:id/status   Update order status
GET  /api/hours/:biz_id       Business hours
PUT  /api/hours               Update business hours
GET  /api/notifications       User notifications
GET  /api/health              Server status
```

---

## Authentication Flow

1. User opens site → `initSupabaseSession()` runs on `DOMContentLoaded`
2. It calls `getSB().auth.getSession()` — reads Supabase JWT from browser storage
3. If session exists: fetches profile from `profiles` table, writes to `localStorage` as `p_user` + `p_profile`
4. `index.html` reads `p_user` from localStorage → shows "Feed" button top-right
5. Sign up: `create-account.html` → Supabase `auth.signUp` → profile created via `/api/auth/profile`
6. Sign in: `signin.html` → Supabase `auth.signInWithPassword` OR Google OAuth
7. Google OAuth redirect URI (permanent, never changes): `https://cjzewfvtdayjgjdpdmln.supabase.co/auth/v1/callback`

---

## Map Setup

- Style: `mapbox://styles/mapbox/navigation-night-v1` (blue ocean, amber roads)
- Rotation disabled: `dragRotate: false`, `touchZoomRotate.disableRotation()`
- SA bounds filter: lat -35 to -22, lon 16 to 33
- Markers: 26px glowing pins with emoji icons per category
- Heatmap: orange/purple overlay on event clusters
- Tap pin → slide-up panel with name, date/price, "View Event/Place →" button

---

## Current Issue (what broke)

### Root cause
`cleanup_index.py` was run. Its regex used `re.DOTALL` with a pattern that matched too broadly and removed:
1. `initSupabaseSession` function (entire function body)
2. `document.addEventListener('DOMContentLoaded', initSupabaseSession)` call
3. `searchUsers`, `renderSearchResults`, `toggleFollow`, `escapeHtml` functions
4. `</script></body></html>` closing tags (consumed by the greedy regex)

### Effect
Without `initSupabaseSession`, no Supabase session is loaded on page open. `currentUser` stays null. `getSB()` returns null for auth-dependent calls. The page renders but shows no data from any protected endpoint. Without closing tags, the browser's HTML parser treats the entire JS block as malformed in strict mode.

### Fix applied
`fix_final_clean.py` (provided — run once, then deploy):
- Removes mock `renderSquad` + `toggleVibe`
- Adds real `renderSquad` using Supabase `follows` table
- Adds `searchUsers` using `getSB()` (not scoped `supabase` variable)
- Adds `toggleFollow` with proper error handling
- Adds `initSupabaseSession` back
- Adds `</script></body></html>`
- Single `let searchTimeout` — no duplicates

---

## What Still Needs Doing

### High priority
- [ ] **Deploy fixed index.html** — run `fix_final_clean.py` then `npx vercel --prod`
- [ ] **Test sign-in flow end to end** — email + Google OAuth
- [ ] **Verify bio shows on user-profile.html** — profile settings save bio to Supabase, user-profile reads it
- [ ] **Test friend search** — type in Friends tab search box, results should appear
- [ ] **Test follow/unfollow** — button should toggle and persist in `follows` table
- [ ] **Run geocode_migration.py** — fixes businesses with invalid/missing map coordinates

### Medium priority
- [ ] **Google OAuth setup** — add `https://cjzewfvtdayjgjdpdmln.supabase.co/auth/v1/callback` to Google Cloud Console → your existing OAuth client → Authorized Redirect URIs. Enable Google provider in Supabase Dashboard → Authentication → Providers.
- [ ] **Supabase email confirmation** — disable in Supabase Dashboard → Authentication → Settings → Email for testing. Re-enable before going live.
- [ ] **Seed real event data** — run `seed.py` and `seed_more_events.py` to populate events table. Currently relies on mock fallback data.
- [ ] **Admin page coordinate fix** — open `/pulsify-admin.html`, sign in as admin, bulk-geocode businesses with missing coordinates.

### Low priority / Future
- [ ] **Cloudflare Worker for Ticketmaster sync** — auto-fetch SA events every 6 hours
- [ ] **Push notifications** — event reminders, new followers
- [ ] **Geofenced photo posting** — enforce 100m radius check for user photo posts
- [ ] **Revenue model** — 8% ticket commission (already coded), R499/mo premium listings
- [ ] **Native app wrapper** — React Native shell around existing PWA

---

## Key Rules (do not break these)

1. **Never add `"/(.*)" → index.html` to vercel.json** — it redirects all pages back to homepage
2. **Never commit `.env`** — Vercel token gets auto-revoked by GitHub secret scanning
3. **Never share Vercel tokens in chat** — same reason
4. **All Python scripts must use `encoding='utf-8'`** — Windows default cp1252 breaks emojis
5. **Friend search functions must use `getSB()`** — not a locally-scoped `supabase` variable
6. **Map markers must validate SA bounds** — lat -35 to -22, lon 16 to 33 — before rendering
7. **Business coords must be geocoded on registration** — never save null/fallback coords to DB

---

## Quick Reference: Common Commands

```bash
# Deploy
export VT=$(grep VERCEL_TOKEN /c/Users/nonja/Desktop/Pulsify/.env | cut -d= -f2)
npx vercel --prod --yes --token=$VT

# Get live URL
npx vercel ls --token=$VT

# Run geocoding migration (fix business coordinates)
pip install requests --break-system-packages
python geocode_migration.py

# Check API health
curl https://YOUR-VERCEL-URL.vercel.app/api/health
```
