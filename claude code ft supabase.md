# Claude Code × Supabase — Session Handover

**Project:** Pulsify (South African nightlife/events discovery app)  
**Branch:** `claude/notifications-and-leads-api-97zbp`  
**Date:** 2026-05-13  
**Supabase project:** `cjzewfvtdayjgjdpdmln` (https://cjzewfvtdayjgjdpdmln.supabase.co)

---

## First Thing To Do In This Session

The Supabase MCP is now connected. Start by running the RLS fix that was already written:

```
Apply the SQL in supabase/fix_rls.sql to the Supabase project cjzewfvtdayjgjdpdmln
```

Then verify it worked by checking row counts on key tables (events, posts, profiles, businesses).

---

## What Supabase MCP Gives You

You can now directly:
- Execute SQL queries against the live database
- Check and create RLS policies
- Inspect table schemas and columns
- Apply migrations
- List tables, functions, triggers

Use this instead of writing SQL files for the user to paste manually.

---

## The Core Problem (Root Cause)

**Every table has RLS enabled but ZERO read policies → every query returns 403.**

This is why data doesn't load on the site. The fix is in `supabase/fix_rls.sql`.  
Apply it via MCP → Execute SQL.

---

## Project Structure

```
Pulsify/
├── api/
│   └── index.js          ← Single Vercel serverless function, handles all /api/* routes
├── apps/
│   ├── landing-page/     ← Main user app (/, community feed, map, search)
│   ├── business/         ← Business dashboard (/business)
│   ├── organizer/        ← Organizer dashboard (/organizer)
│   ├── admin/            ← Admin dashboard (/admin)
│   ├── leads/            ← Leads scraper dashboard (/leads)
│   └── map/              ← Standalone map page (/map)
├── supabase/
│   └── fix_rls.sql       ← RLS policies fix — APPLY THIS FIRST
├── .claude/
│   ├── debugging.md      ← Active bug tracker
│   ├── frontend.md       ← Frontend rules
│   ├── backend.md        ← API architecture
│   └── RELEASE_CHECKLIST.md
└── vercel.json           ← Routes config (NEVER add /(.*) → index.html)
```

---

## Supabase Schema (key tables)

| Table | Purpose | Key columns |
|-------|---------|-------------|
| `profiles` | All users | id (= auth uid), display_name, username, role, city, verif_status, is_verified |
| `events` | Events from all sources | id (TEXT), name, date_local, time_local, venue_name, **venue_city** (NOT city), genre, organiser_id, source |
| `posts` | Community feed posts | id, user_id, caption, image_url, post_type, event_id, created_at |
| `businesses` | Business listings on map | id, name, lat, lon, city, type, owner_id, is_frontline |
| `follows` | Social follows | follower_id, following_id |
| `notifications` | In-app alerts | id, user_id, type, message, is_read, created_at |
| `comments` | Post comments | id, post_id, user_id, content, created_at |
| `likes` | Post likes | post_id, user_id |
| `scraped_leads` | Sales leads | id, name, email, phone, source, status |

**Critical column fact:** `events.venue_city` — NOT `events.city`. This was a bug that caused organizer events to not appear on the landing page.

---

## What Was Fixed This Session

### 1. Organizer Dashboard (`apps/organizer/index.html`)
- FEED button was going to `/feeds` (404) → fixed to `/`
- `submitEvent()` was using wrong column `city` → fixed to `venue_city`
- `submitEvent()` was combining date+time into one field → fixed: separate `date_local` and `time_local`
- Date/Time inputs had no labels on mobile → added "Date *" and "Time" labels
- `submitPost()` was crashing on `res.json()` if response empty → safe text parse
- Broken emoji `'Publish to Feed ��'` → fixed to `'Publish 🚀'`

### 2. Business Dashboard (`apps/business/index.html`)
- `submitEvent()` was localStorage-only, never touched Supabase → made async, now inserts to `events` table with correct columns and calls `/api/posts` to appear on landing page feed
- `submitPost()` crashing on `res.json()` → safe text parse

### 3. Database (`supabase/fix_rls.sql`) — PENDING APPLICATION
- All tables had RLS enabled with no policies → wrote comprehensive fix
- Events/businesses: public SELECT (anon readable)
- Posts/profiles/follows/comments: authenticated SELECT, write own
- Notifications: own only
- Added `verif_status`, `verif_request`, `is_verified` columns to profiles

### 4. Documentation
- `.claude/debugging.md` — active bug tracker
- `.claude/frontend.md` — frontend rules and anti-patterns
- `.claude/backend.md` — API architecture and missing endpoints
- `.claude/RELEASE_CHECKLIST.md` — release steps
- `apps/*/CLAUDE.md` — per-dashboard context files

---

## What Still Needs Doing (Priority Order)

### CRITICAL — Do First
1. **Apply `supabase/fix_rls.sql`** via MCP Execute SQL
2. **Storage policy**: Go to Supabase → Storage → `post-images` bucket → Policies → add public SELECT (`true`) so uploaded images load
3. **Check `businesses` table has `owner_id` column** — the RLS update policy uses `owner_id`. If column is named differently, fix the policy.

### HIGH
4. **Verify events column exists**: Run `SELECT column_name FROM information_schema.columns WHERE table_name='events' AND column_name='venue_city';` — confirm it exists
5. **Check `posts` table schema** — confirm `user_id` is UUID matching `auth.uid()`
6. **Leads dashboard** — merge `leads-api-routes.js` into `api/index.js` (routes exist in separate file but not wired in)
7. **Admin: fix `full_name` → `display_name`** in `apps/admin/index.html`

### MEDIUM
8. Add `subscription_type` column to `profiles` for free/premium tiers
9. Add `approved` boolean to `events` for organizer event approval workflow
10. QR code scanning for ticket validation and pickup orders
11. Banner management system in admin

### NICE TO HAVE
12. Push notifications (web push + service worker)
13. Real-time map updates via Supabase Realtime
14. Analytics dashboard for premium businesses

---

## API Key Facts

- **Supabase URL:** `https://cjzewfvtdayjgjdpdmln.supabase.co`
- **Anon key:** in `api/index.js` as `SUPA_ANON` constant
- **Service key:** set as `SUPABASE_SERVICE_KEY` Vercel env var (server-only, never in HTML)
- **Vercel project:** `pulsify-blue.vercel.app`

### Deploy command (run in Codespaces)
```bash
export VT=$(grep VERCEL_TOKEN /workspaces/Pulsify/.env | cut -d= -f2)
npx vercel --prod --yes --token=$VT
```

---

## Hard Rules (from CLAUDE.md)

1. `vercel.json` must only contain the API route — **never add `/(.*) → index.html`**
2. Never commit `.env`
3. All Python scripts must use `encoding=utf-8`
4. Friend-search functions must use `getSB()` — never a locally-scoped supabase variable
5. Map markers must validate SA bounds: lat -35 to -22, lon 16 to 33
6. **Never run broad regex replacements on whole HTML files**
7. Supabase service key is server-only — never in any HTML file
8. Mock data stays as fallback — real API first, mock if empty
9. `events.id` is TEXT not UUID
10. Always backup before editing HTML: `cp index.html index.html.bak`

---

## Workflow

User is on **mobile/browser Codespaces**. Claude edits files and pushes.  
User runs: `git pull origin claude/notifications-and-leads-api-97zbp`  
User deploys with the deploy command above.

**One command at a time on mobile. Number them.**

---

## Quick Verification Queries (run via MCP)

```sql
-- Check RLS policies are applied
SELECT tablename, policyname, cmd FROM pg_policies WHERE schemaname = 'public' ORDER BY tablename;

-- Check events table columns
SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'events' ORDER BY ordinal_position;

-- Check profiles columns
SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'profiles' ORDER BY ordinal_position;

-- Count rows in key tables
SELECT 'events' as tbl, count(*) FROM events
UNION ALL SELECT 'posts', count(*) FROM posts
UNION ALL SELECT 'profiles', count(*) FROM profiles
UNION ALL SELECT 'businesses', count(*) FROM businesses;
```
