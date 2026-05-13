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

- [ ] QR code scanning not implemented
  - Symptoms: No way to scan tickets or pickup orders
  - Suspected cause: Feature not built yet
  - Affected areas: Business dashboard, organizer dashboard
  - Fix: Build camera scanner, validation API, mark as used

- [ ] User photo posts require event selection + 100m radius check
  - Affects: `feeds.html`, `api/index.js`
  - Must prevent standalone posts; only allow from event detail page.
  - Server-side distance check.

- [ ] Admin panel missing banner management
  - Need CRUD for `banner_items` table.
  - Banner items must expire automatically and link to map / event / business.

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

---

## Resolved Issues
*(None yet – will be moved here as fixes are applied)*

---

## Claude Update Contract
Only update this file when explicitly instructed.
- Append, never rewrite history.
- Move resolved issues from "Active" to "Resolved" with date and lessons learned.
- Prefer checklists and bullet points.
