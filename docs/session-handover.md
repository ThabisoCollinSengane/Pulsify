# Pulsify — Claude Session Handover
_Last updated: 2026-06-21. Read this before touching anything._

---

## 1. Project Overview

**Pulsify / Pulsefy** — South Africa's event discovery and entertainment platform.
- **Live site:** https://pulsefy.co.za
- **Stack:** Vercel (frontend + serverless API) + Supabase (Postgres + Auth + Storage)
- **Repo:** ThabisoCollinSengane/Pulsify
- **Owner email:** thacollin2@gmail.com
- **Active branch:** `claude/fix-event-organizer-feeds-ZCzRM` (merge to `main` to deploy to production)

---

## 2. Deployment Flow

1. Push to `claude/fix-event-organizer-feeds-ZCzRM` → GitHub Actions → Vercel **preview URL** only
2. Merge PR to `main` → GitHub Actions → Vercel `--prod` → **pulsefy.co.za live**
3. **Never push directly to main.** Always use a PR.
4. Deploy command (manual fallback): `npx vercel --prod --yes --force --token=<VT>`
5. Workflow file: `.github/workflows/deploy.yml`
6. DB backup cron: `.github/workflows/db-backup.yml` — runs 2am UTC (4am SAST) daily, dumps to Supabase Storage `backups/` bucket + GitHub artifact

---

## 3. Supabase

- **Project ID:** `cjzewfvtdayjgjdpdmln`
- **Project URL:** `https://cjzewfvtdayjgjdpdmln.supabase.co`
- **DB host:** `db.cjzewfvtdayjgjdpdmln.supabase.co`
- **DB backup URL format:** `postgresql://postgres:[PASSWORD]@db.cjzewfvtdayjgjdpdmln.supabase.co:5432/postgres`
- RLS is enabled. Service role key is server-only — never in HTML files.

---

## 4. Email Setup (Working ✅)

### Provider
**Resend** is the primary email provider. SMTP is the fallback. Resend domain is verified for `pulsefy.co.za` (DKIM + SPF confirmed).

### Configuration (Vercel env vars)
| Var | Value |
|-----|-------|
| `RESEND_API_KEY` | Set (working) |
| `RESEND_FROM` | `Pulsify <hello@pulsefy.co.za>` |
| `SMTP_HOST` | cPanel SMTP (fallback only — unreliable, use Resend) |

### Email module: `api/email.js`
All email logic lives here. Single `deliver()` function — tries Resend first, falls back to SMTP.

### Templates (all use `layout()` + `card()` + `btn()` helpers):
| Function | Trigger | Notes |
|----------|---------|-------|
| `sendWelcomeEmail` | User signs up | |
| `sendVerifApprovedEmail` | Admin approves profile verification | |
| `sendVerifRejectedEmail` | Admin rejects profile verification | Includes reason |
| `sendPaymentConfirmEmail` | Ticket payment confirmed | |
| `sendTicketEmail` | Ticket issued | Includes QR code |
| `sendOrderEmail` | Business order placed | |
| `sendLeadEmail` | Lead outreach via CRM | Branded template with 3 benefit cards |
| `sendMarketingEmail` | Admin broadcast | Carries POPIA unsubscribe headers |
| `sendEventApprovedEmail` | Admin approves organiser event | Notifies organiser |
| `sendEventRejectedEmail` | Admin rejects organiser event | Notifies organiser |

### Unsubscribe
One-click unsubscribe on all marketing emails. Token = HMAC of email using `UNSUB_SECRET` env var (falls back to `RESEND_API_KEY` if not set). Endpoint: `GET /api/unsubscribe?e=...&t=...`

### Leads & CRM (`apps/leads/index.html` + `api/admin/index.js`)
- OSM Overpass scraper pulls venue/organiser leads for KZN cities (Durban, Umhlanga, Ballito, Pinetown, Amanzimtoti, Pietermaritzburg + more)
- Leads stored in `scraped_leads` table
- Email compose modal has quick-fill pitch buttons (Intro, Follow-up, KZN-specific)
- Branded email with gradient header (purple→orange), 3 benefit cards, CTA button
- `POST /api/leads/send` sends via `sendLeadEmail()`
- POPIA: only sends to leads that opted in (check `marketing_consent` flag before bulk sends)

---

## 5. Admin Dashboard (`apps/admin/index.html` + `api/admin/index.js`)

### What's built
- **Users tab** — lists all users with role, subscription, trial date, suspended status, and **Paystack column** (✅ Linked / ⚠️ Not set up) based on `paystack_subaccount_code` in `profiles`
- **Events tab** — pending event approval queue. Approve sets `approved=true`; reject deletes the event. Both now send the organiser an in-app notification + email.
- **Verifications tab** — approve/reject identity verifications. Sends notification + email.
- **Lead Events tab** — approve scraped lead events to publish them live
- **Banners tab** — CRUD for promo banner slider
- **Notify tab** — broadcast push notification + in-app notification to all users or filtered segment
- **Squad Promos tab** — approve/feature/reject squad deals
- **Location Requests tab** — approve coordinate correction requests

### API routes (all require `role = 'admin'` in `profiles`)
- `GET /admin/users` — includes `paystack_subaccount_code`
- `GET/PATCH /admin/events` — list + approve/reject with organiser notification
- `GET/PATCH /admin/verifications/:id`
- `GET/PATCH /admin/lead-events/:id`
- `POST /admin/notify` — broadcast push + in-app
- etc.

---

## 6. Notifications

### In-app
`notifications` table. Columns: `user_id`, `type`, `message`, `from_user_id`, `from_display_name`, `entity_type`, `entity_id`, `data`, `read`.

Notification bell in organiser/business dashboards now shows actor name (bold) + avatar + coloured unread indicator. Same pattern as landing page.

### Web Push
Service worker: `sw.js` (handles `push` event + `notificationclick`).
Frontend: `_registerPush()` in `apps/landing-page/index.html` registers SW + subscribes via PushManager.
Backend: `/push/vapid-public-key` + `/push/subscribe` endpoints in `api/index.js`.
Subscriptions stored in `push_subscriptions` table.
**Status: NOT YET ACTIVE** — requires `VAPID_PUBLIC_KEY` + `VAPID_PRIVATE_KEY` in Vercel env vars (keys already generated — see Section 9).

---

## 7. Payments (Paystack)

- **Current status:** Gated behind `paystack_live` feature flag (`feature_flags` table, `key='paystack_live'`). Flag is `false` — payments blocked until live keys are set.
- Free tickets: auto-confirm via `/ticket/purchase`
- Paid tickets: client → `/ticket/init` (creates pending booking) → Paystack → `/ticket/confirm` + `/api/paystack/webhook`
- Both `/ticket/confirm` and webhook re-verify with Paystack API and assert `currency==='ZAR'` and `amount >= total_paid*100`
- Organiser Paystack subaccount code stored in `profiles.paystack_subaccount_code`

---

## 8. Open PRs

| PR | Title | Status |
|----|-------|--------|
| #100 | feat: notify organiser on event approve/reject | Draft — CI running, merge to main when green |
| #16 | Experimental homepage redesign | Preview only — merge when user wants |
| #13 | News desk | Preview only — merge when user wants |

---

## 9. What the User Still Needs to Do (NOT code — account actions)

### Vercel Environment Variables (vercel.com → Project → Settings → Env Vars)
| Key | Value |
|-----|-------|
| `VAPID_PUBLIC_KEY` | `BHBoop2acb0dbGJVWIIcZVGfHxmCPiNr-CVHAx7teFEf9wDHlLFMEmnsFYXEqW8siwDK7psVgORmVMXHgKWK-Bg` |
| `VAPID_PRIVATE_KEY` | `uuBneOoDBH-l8SkOwKg--ESxewdUcYS-dWaP-hhHqiw` |
| `PAYSTACK_SECRET_KEY` | Live key from Paystack dashboard → Settings → API Keys |
| `PAYSTACK_PUBLIC_KEY` | Live key from Paystack dashboard |
| `SUPABASE_SERVICE_KEY` | Confirm set — Supabase → Project Settings → API → service_role |
| `MAPBOX_TOKEN` | Confirm set — Mapbox → Account → Access Tokens |

### GitHub Secrets (GitHub → Repo → Settings → Secrets → Actions)
| Secret | Value |
|--------|-------|
| `SUPABASE_DB_URL` | `postgresql://postgres:[DB-PASSWORD]@db.cjzewfvtdayjgjdpdmln.supabase.co:5432/postgres` |
| `SUPABASE_URL` | `https://cjzewfvtdayjgjdpdmln.supabase.co` |
| `SUPABASE_SERVICE_KEY` | Same service_role key |

### Supabase
- **Storage:** Create private bucket named `backups` (for DB backup uploads)
- **Auth → URL Configuration → Redirect URLs:** Add `https://pulsefy.co.za/reset-password`
- **Auth → Passwords:** Enable "Leaked Password Protection"
- **feature_flags table:** Set `paystack_live = true` once Paystack live keys are in Vercel

### Paystack
- Point webhook URL at: `https://pulsefy.co.za/api/paystack/webhook`

---

## 10. Deferred (Post-Launch)

- **Frontend modularization** — `apps/landing-page/index.html` is ~7,200 lines. Works fine, defer until post-launch.
- **Frontend API service layer** — wrap all `/api/*` calls in a single `Api` module instead of scattered direct calls.
- **Consistent request validation** — shared validator for API request bodies.
- **Queue/background jobs** — emails and ticket confirmations should move off the request path.
- **Sentry DSN** — create Sentry project, set `PULSIFY_SENTRY_DSN` (frontend) + `SENTRY_DSN` (Vercel).
- **Daily backups** — workflow is created, just needs GitHub secrets + Supabase `backups` bucket (see Section 9).

---

## 11. Vercel MCP (New)

`.mcp.json` added to repo root — connects Claude Code to Vercel via MCP.
On session start, run `/mcp` → select `vercel` → authenticate via browser OAuth (no token needed in config).
Gives Claude direct access to deployments, env vars, logs, domains without leaving the session.

---

## 12. Hard Rules (from CLAUDE.md — never break these)

1. `vercel.json` must only contain the API route — never add `/(.*) → index.html`
2. Never commit `.env`
3. Supabase service key is server-only — never in any HTML file
4. Map markers must validate SA bounds: lat -35 to -22, lon 16 to 33
5. `node_modules/` is in `.gitignore` — never commit it
6. `events.id` is TEXT not UUID
7. `ticket_tiers.is_free` and `sold_out` are GENERATED columns — never insert them
8. No broad regex replacements on `index.html`
9. Always `--force` on Vercel prod deploys (bypasses CDN cache)
10. Only `main` branch deploys to production — `claude/**` branches are preview only
