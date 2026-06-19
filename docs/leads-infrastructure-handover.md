# Leads Infrastructure — Handover

_Last updated: 2026-06-19. Project: Pulsify (`cjzewfvtdayjgjdpdmln`)._

This document describes the **lead-generation system** end to end: how prospect
organisers/venues are scraped, stored, reviewed by an admin, and converted into
real events on the platform. Read this before touching anything under
`scripts/scrape-*`, `api/admin/index.js`, `apps/leads/`, or the `scraped_leads`
/ `lead_events` / `profile_claims` tables.

---

## 1. TL;DR / Mental model

```
  SCRAPERS                  STORAGE              ADMIN REVIEW            PUBLIC
  ────────                  ───────              ────────────           ──────
  Google Places ─┐
  Apify (IG/TT/FB)├─► scraped_leads ──► /leads dashboard ──► lead_events ──► events
  OSM Overpass ──┘     (prospects)       (triage: status)     (drafts)     (published)
  /leads/ingest ─┘

  Separately: a public "claim this business" form ─► profile_claims ─► admin reviews
```

- A **lead** = a prospect organiser/venue we found online (name, city, contact, socials).
- An admin triages leads in the `/leads` dashboard (status: `new → contacted → converted / ignored`).
- For a converted lead, the admin drafts one or more **lead_events** (event drafts).
- Approving a lead_event **publishes it into the `events` table** (`source='lead'`) so it shows on the app.
- **profile_claims** is a parallel, separate flow: a business owner claims an auto-listed business.

---

## 2. Data model (live state as of 2026-06-19)

All tables are in `public`, RLS enabled.

### `scraped_leads` — the active prospect table
Schema file: `db/scraped_leads_schema.sql` (also `db/schema_additions.sql`).

| column | type | notes |
|---|---|---|
| id | uuid PK | `gen_random_uuid()` |
| name | text NOT NULL | dedupe key (with `source` or `city`) |
| category | text | `organizer` \| `business` \| OSM types (`club`,`bar`,`shisanyama`,`bnb`,`hotel`,`venue`,`dance_venue`) |
| province, city | text | |
| email, phone, website | text | |
| instagram, facebook, tiktok | text | |
| source | text | `manual` \| `osm` \| `google` \| `facebook` \| `instagram` \| `tiktok` |
| status | text | `new` \| `contacted` \| `converted` \| `ignored` |
| notes | jsonb `[]` | free-form admin notes |
| description, follower_count | text/int | |
| created_at, updated_at | timestamptz | |

**Live data:** 101 rows, **all `source='osm'`** (98 `new`, 2 `contacted`, 1 `ignored`).
→ i.e. only the OSM admin scraper has actually populated data; the Google/Apify
weekly jobs have not landed rows (see §9).

### `lead_events` — event drafts attached to a lead
**No schema file in the repo** — table was created directly in Supabase. Reconstructed schema:

| column | type | notes |
|---|---|---|
| id | uuid PK | `uuid_generate_v4()` |
| lead_id | uuid NOT NULL | → `scraped_leads.id` |
| title | text NOT NULL | |
| description, genre (`'nightlife'`) | text | |
| event_date (date), event_time (time) | | |
| venue_name, venue_city, venue_address | text | |
| image_url, source_url, organiser_name | text | |
| is_free (bool, false), price_min (numeric) | | |
| status | text | `pending` \| `approved` \| `rejected` |
| admin_notes | text | |
| published_event_id | text | set when approved → the `events.id` it created |
| created_at, updated_at | timestamptz | |

**Live data:** 0 rows.

### `profile_claims` — "claim your business" submissions (separate flow)
No schema file in repo. Columns: `id, business_id (text), business_name NOT NULL,
claimant_name, claimant_email, claimant_phone, reason, status ('pending'),
admin_notes, created_at`. **Live data:** 0 rows. RLS on, **0 policies**.

### `leads` — LEGACY, effectively dead
Older/smaller table (category default `business`, no socials beyond ig/fb, no
tiktok/follower_count). RLS on, **0 policies, no role grants** → unreadable by
anon/auth/service_role. **1 row.** Nothing in the codebase reads or writes it
(all lead-gen uses `scraped_leads`). Permissive policies were dropped in the
security pass — see `db/scope_leads_profile_claims_rls.sql`. Treat as removable.

---

## 3. Ingestion layer (how leads get in)

There are **four** ingestion paths, all writing to `scraped_leads`:

### 3a. Scraper scripts (`scripts/`) — run weekly via GitHub Actions
- `scrape-google-places.js` — SA organisers/venues from Google Places API.
- `scrape-durban-jhb-venues.js` — clubs/shisanyamas/BnBs/hotels in DBN & JHB (Google Places).
- `scrape-social.js` — TikTok/Instagram/Facebook via **Apify** actors (general SA).
- `scrape-social-venues.js` — same, focused on DBN & JHB venues.

Each script `createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)` and inserts
directly (service role, **bypasses the API**). They load `.env` locally or take
env from the Actions runner. They dedupe before insert.

**Orchestration:** `.github/workflows/scrape-leads.yml`
- Schedule: `0 5 * * 1` (Mondays 05:00 UTC / 07:00 SAST) + manual `workflow_dispatch`.
- Sequential jobs: `google → google-venues → social → social-venues`.
- Secrets required: `GOOGLE_PLACES_API_KEY`, `APIFY_TOKEN`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`.

### 3b. OSM Overpass scraper — `POST /api/admin/scrape` (admin, on-demand)
`api/admin/index.js` (~line 412). No API key needed; queries the public Overpass
API for venue types within hardcoded city bounding boxes (Durban, JHB, Cape Town,
Pretoria, Sandton, KwaMashu, Umlazi). Inserts with `source='osm'`. **This is the
only path that has actually produced data so far.** Triggered from the `/leads`
dashboard ("Scrape" action).

### 3c. `POST /api/leads/ingest` — external push endpoint
`api/admin/index.js` (~line 15). Auth via `x-ingest-key` header === `INGEST_SECRET`
env (NOT a user JWT — meant for external/CI pushers). Accepts `{ leads: [...] }`,
dedupes on `(name, source)`, inserts `status='new'`. Currently unused by the
in-repo scrapers (they write directly), but available for third-party feeds.

### 3d. Manual — admin can add/edit leads from the dashboard.

---

## 4. API layer

### ⚠️ Routing & the duplication trap (read this)
`vercel.json` rewrites:
```
/api/leads        → /api/admin
/api/leads/(.*)   → /api/admin
/api/admin        → /api/admin
/api/admin/(.*)   → /api/admin
/api/(.*)         → /api            (catch-all, lower priority)
```
**So every `/api/leads*` and `/api/admin*` request is served by
`api/admin/index.js`.** The *identical* lead/scrape/lead-event handlers that also
exist in `api/index.js` (lines ~1299–1507 and ~2017) are **dead code** —
shadowed by the rewrite, never reached. The first 60 lines of each block are
byte-identical. **When editing a lead endpoint, edit `api/admin/index.js`.**
(Cleanup candidate: delete the duplicates from `api/index.js`.)

### Endpoints (all in `api/admin/index.js`, all admin-JWT-gated unless noted)
| Method & path | Purpose |
|---|---|
| `POST /api/leads/ingest` | External bulk insert (header `x-ingest-key`, not JWT) |
| `GET /api/leads` | List + filter (status/category/source/province/search), paginated, returns status `stats` |
| `PATCH /api/leads/:id` | Update `status` / `notes` |
| `GET /api/leads/:id/events` | List lead_events for a lead |
| `POST /api/leads/:id/events` | Create a lead_event draft (`status='pending'`) |
| `GET /api/admin/lead-events?status=` | All lead_events (joins `scraped_leads`) |
| `PATCH /api/admin/lead-events/:id` | `action: approve\|reject`. **approve = upsert into `events`** (`id='lead_'+…`, `source='lead'`, `approved=true`, `hype_score=65`), then mark draft `approved` + store `published_event_id` |
| `POST /api/admin/scrape?cities=` | OSM Overpass scraper (§3b) |

**Client/role usage:** read/triage endpoints use `sbAs(token)` = the caller's JWT
(must be `role='admin'`). Ingest and OSM-scrape use `sb()` = the **service key**.

### profile_claims endpoints (separate flow — in `api/index.js`)
| `POST /api/claim-profile` | Public form submit → insert into `profile_claims`, notify admins |
| `GET /api/admin/claims` | Admin list |
| `PATCH /api/admin/claims/:id` | Admin set `status` / `admin_notes` |

All three use `sb()` (service key). **See §8 latent-bug note.**

---

## 5. Frontend

- **`/leads` → `apps/leads/index.html`** (593 lines). Admin-only lead dashboard.
  Calls `/api/leads?…`, `/api/leads/:id`, `/api/leads/:id/events`,
  `/api/admin/lead-events`, `/api/admin/scrape`. Has a stale companion
  `apps/leads/leads.html` and a partly-outdated `apps/leads/CLAUDE.md` (§9).
- **`/admin` → `apps/admin/index.html`** also surfaces lead-events and claims for review.
- Both enforce a client-side `role==='admin'` check (defence in depth; the API re-checks).

---

## 6. Lifecycle / state machine

```
scraped_leads.status:  new ──► contacted ──► converted
                          └──► ignored

lead_events.status:    pending ──► approved  (→ inserts events row, source='lead')
                          └──────► rejected
```
Approving a lead_event is **idempotent-ish**: it upserts `events` on
`id='lead_'+leId[:16]`. Published events get `hype_score=65`, `approved=true`,
`is_frontline=false`, `status='onsale'`. The lead_event keeps `published_event_id`
as the back-reference. There is no automatic un-publish if a draft is later rejected.

---

## 7. Auth, RLS & permissions (current state)

| table | RLS | policies | service_role SELECT | authenticated SELECT | anon SELECT |
|---|---|---|---|---|---|
| scraped_leads | on | 3 | ✅ | ✅ | ❌ |
| lead_events | on | 1 | **❌** | ✅ | ❌ |
| profile_claims | on | 0 | **❌** | ❌ | ❌ |
| leads (legacy) | on | 0 | ❌ | ❌ | ❌ |

- `scraped_leads` is correctly granted: service role (scrapers/ingest) + admin JWT both work.
- **`lead_events` has no `service_role` grant.** It works today only because every
  lead_event endpoint uses `sbAs(token)` (the admin's `authenticated` JWT, which
  *is* granted). Any future code path that touches `lead_events` via `sb()`
  (service key) will 403 with `permission denied for table`. (`bypassrls` does
  **not** bypass table grants — this is the exact bug class fixed for the promo
  tables in PR #92.)
- **`profile_claims` has no grants at all** yet its endpoints use `sb()` (service
  role) → `POST /claim-profile`, `GET/PATCH /admin/claims` are almost certainly
  **broken** (consistent with 0 rows). Same root cause. See §9.

---

## 8. Environment variables / secrets

| name | used by | purpose |
|---|---|---|
| `SUPABASE_URL` | scrapers, API | project URL |
| `SUPABASE_SERVICE_KEY` | scrapers, API `sb()` | service-role writes |
| `SUPABASE_ANON_KEY` | API `sbAs()` | per-user JWT client |
| `GOOGLE_PLACES_API_KEY` | google scrapers | Places API |
| `APIFY_TOKEN` | social scrapers | Apify actors (IG/TT/FB) |
| `INGEST_SECRET` | `/leads/ingest` | shared secret for external push |

Scraper secrets live in **GitHub Actions repo secrets**; API secrets live in
**Vercel env**. Never commit `.env` (project hard rule #2).

---

## 9. Known issues / gaps / tech debt

1. **Only OSM data exists.** All 101 leads are `source='osm'` (from the on-demand
   admin scraper). The weekly Google/Apify Action either hasn't run successfully
   or its secrets (`GOOGLE_PLACES_API_KEY`, `APIFY_TOKEN`) aren't set. **Verify
   the `Scrape Leads` workflow's last run + that secrets are configured.**
2. **`profile_claims` is missing service_role grants** → the public claim form and
   admin claims endpoints likely 403. Fix:
   `GRANT ALL ON public.profile_claims TO service_role;` (+ confirm
   `INSERT/SELECT`). Same fix pattern as PR #92.
3. **`lead_events` is missing the service_role grant** (latent — masked by JWT
   access today). Recommend `GRANT ALL ON public.lead_events TO service_role;`
   for safety + parity.
4. **No schema files for `lead_events` / `profile_claims`.** They exist only in
   the live DB. Add `db/lead_events_schema.sql` + `db/profile_claims_schema.sql`
   so the schema is reproducible.
5. **Duplicate dead handlers** in `api/index.js` (lead + scrape blocks) shadowed
   by the `/api/leads→/api/admin` rewrite. Delete to avoid drift/confusion.
6. **`apps/leads/CLAUDE.md` is stale:** claims the routes are "not yet merged"
   and references a non-existent `leads-api-routes.js`. They ARE merged.
7. **Email-claim flow is documented but NOT implemented.** `apps/leads/CLAUDE.md`
   describes a Resend-based claim-link email (`POST /api/leads/email/:id`); there
   is **no Resend integration and no such route** in the codebase.
8. **Legacy `leads` table** (1 row, no grants/policies) is unused — safe to drop
   after a final check.
9. **OSM scraper city boxes are hardcoded** in `api/admin/index.js`; adding a
   city = a code change.

---

## 10. Quick reference — where things live

| concern | location |
|---|---|
| Active lead endpoints | `api/admin/index.js` (lead + lead-event + scrape blocks) |
| profile_claims endpoints | `api/index.js` (`/claim-profile`, `/admin/claims`) |
| Dead duplicate endpoints | `api/index.js` (~1299–1507, ~2017) |
| Scraper scripts | `scripts/scrape-*.js` |
| Scraper orchestration | `.github/workflows/scrape-leads.yml` |
| Lead dashboard UI | `apps/leads/index.html` |
| Schema (only scraped_leads) | `db/scraped_leads_schema.sql`, `db/schema_additions.sql` |
| RLS scoping notes | `db/scope_leads_profile_claims_rls.sql` |
| Routing | `vercel.json` (`rewrites`) |
