Here is the message you can copy and send to **Gemini AI** (or paste into Firebase Console's AI assistance / Gemini chat) to explain what needs to be done to finish the entire Pulsify setup.

---

**To Gemini AI (Firebase Console Agent Assistant):**

I need your help completing the entire Pulsify platform setup. Below is the full scope of what has been built, what remains, and the integrations required. Please provide step‑by‑step guidance, code snippets, and configuration instructions for each section.

---

## Project Overview

**Pulsify** is a nightlife discovery and ticketing platform for South Africa (Durban, Johannesburg, Cape Town). It targets:
- **Users** – find Gqom, Amapiano, shisanyama events.
- **Businesses (venues)** – list events, manage pickup orders.
- **Event Organizers** – sell tickets, get paid via Paystack splits.

**Stack:**
- Frontend hosted on Vercel (Next.js or static HTML/CSS/JS)
- Backend: Supabase (Auth, Database, Edge Functions, Storage)
- Payments: Paystack (automated splits to organizers)
- Scraping: Apify (Google Maps venues) + Phantombuster (Instagram organizers)
- Map: Leaflet or Mapbox GL JS (rotation disabled, full screen, heatwaves)
- Notifications: Supabase Realtime + bell icon panel

---

## 1. What Has Been Built So Far ✅

| Component | Status |
|-----------|--------|
| User auth (email + Google) | ✅ Live |
| Event listing & detail pages | ✅ Live (data from Supabase) |
| Map with category icons | ✅ Live (positioning fixes needed) |
| Feed with All/Following tabs | ✅ Live (mock data currently) |
| Profile page with stats | ✅ Live |
| Bookings page with static QR placeholders | ✅ Live |
| Business dashboard UI | ✅ Built (signup/login broken) |
| Search & filters (province, genre) | ✅ Live |
| Supabase database schema | ✅ Configured |
| Vercel deployment | ✅ Live (pulsify.vercel.app) |

---

## 2. What Still Needs to Be Done ❌

### 2.1 Critical Fixes (Immediate)

| Task | Description |
|------|-------------|
| **Business dashboard signup/login** | Currently freezes on submit. Separate business signup flow from user signup. Create new API endpoints, fix Supabase RLS policies. |
| **Map positioning** | Icons are scattered (some in ocean, Joburg venues in Durban). Implement coordinate validation (lat: -35 to -22, lng: 16 to 33). Geocode addresses on business signup. |
| **Map rotation lock** | Disable map rotation – allow only zoom. Set map container to full screen (100vw, 100vh). |
| **Heatwaves on map** | Add pulsing red/orange circles where events cluster within 500m radius. Dynamic based on ticket sales + check-ins. |
| **Notification center (bell icon)** | Create unified panel for: likes/comments, event reminders, booking updates, settings changes, events near you. Use Supabase Realtime. |

### 2.2 Web Scraping System (Lead Generation)

**Goal:** Automatically collect venue and event organizer leads from Durban & Joburg.

| Tool | Purpose | Configuration |
|------|---------|---------------|
| **Apify** (Google Maps scraper) | Extract venues (shisanyama, clubs, lounges) | Search queries: "shisanyama Durban", "nightclub Johannesburg", "Gqom events". Fields: name, phone, website, address, lat/lng. Run weekly. |
| **Phantombuster** (Instagram scraper) | Extract event organizers/promoters | Hashtags: #DurbanEvents #AmapianoSA #GqomNight. Extract: username, bio, contact email, post engagement. Run weekly. |

**Data flow:**
1. Scrapers output JSON.
2. Supabase Edge Function receives webhook, validates data, upserts into `leads` table.
3. Team views leads in internal dashboard → calls/WhatsApp follow-up.

**Supabase `leads` table schema:**
- `id` (uuid)
- `source` ('google_maps' or 'instagram')
- `business_name` / `organizer_name`
- `phone`, `email`, `website`, `social_handle`
- `extracted_data` (jsonb)
- `status` ('new', 'contacted', 'converted', 'ignored')
- `assigned_to` (uuid, references users)
- `created_at`, `updated_at`

### 2.3 User Experience (UX) – Complete

| Feature | Status | Action Needed |
|---------|--------|---------------|
| Signup/login (email/Google) | ✅ Live | None |
| Browse events by genre/location | ✅ Live | None |
| Event detail with Hype Meter | ✅ Live | None |
| Save events to profile | ✅ Live | None |
| Follow other users | ✅ Live | None |
| See "People You May Know" | ✅ Live | None |
| View profile with stats | ✅ Live | None |
| Book tickets | ❌ | Integrate Paystack checkout. Create booking flow → store ticket in Supabase → generate unique QR code. |
| QR code tickets | ❌ | After payment, generate QR code (e.g., using `qrcode` library). Display in Bookings screen. |
| Heatwaves on map | ❌ | See 2.1 above. |
| Push notifications | ❌ | Set up Supabase Realtime + browser push (or WhatsApp API). |
| Share events to WhatsApp | ❌ | Add Web Share API or WhatsApp deep link. |
| In-app chat | ❌ | Phase 3 feature. |
| "I'm vibing" status | ❌ | Phase 3 feature. |
| AI recommendations | ❌ | Phase 4 feature. |
| Offline tickets | ❌ | Save QR code to local storage or generate PDF. |

### 2.4 Event Organizer Experience

| Feature | Status | Action Needed |
|---------|--------|---------------|
| Organizer signup (separate from user) | ❌ | Build new `/organizer/signup` form. Fields: business name, tax ID, bank details (for Paystack subaccount). |
| Organizer dashboard | ❌ | Create dashboard to: create events, set ticket tiers, see sales, view attendee list. |
| Paystack split setup | ❌ | On organizer signup, call Paystack API to create Subaccount. Store `subaccount_code`. At checkout, use dynamic split (e.g., 70% organizer, 30% Pulsify). |
| Automated payouts | ❌ | Paystack sends to organizer's bank 2–3 days after sale (South Africa). No minimum payout. |
| QR check-in app | ❌ | Build scanner view (camera) for organizers to scan tickets at door. Update ticket status to `used`. |
| Event analytics | ❌ | Show check-in rate, no-shows, demographics (from user profiles). |

### 2.5 Business Account Experience (Venues)

| Feature | Status | Action Needed |
|---------|--------|---------------|
| Business signup (fix) | ❌ | Separate from user signup. Add fields: venue name, address, phone, business type (shisanyama, club, bar, etc.). |
| Business dashboard (fix login) | ❌ | Repair authentication. After login, dashboard shows: events, pickup orders, analytics. |
| Pickup order feature | ❌ | Build ordering UI for users (select items, prepay or pay at venue). Venue receives order notification. |
| Venue profile page | ❌ | Allow businesses to upload photos, edit hours, set pickup menu. |
| Sales dashboard | ❌ | Show ticket sales by event, revenue, attendee list. |
| QR check-in for venues | ❌ | Same as organizer tool – venues scan tickets. |

### 2.6 Gamification & Founder Status

| Task | Action Needed |
|------|---------------|
| Founder badge (first 500 users, 20 businesses, 50 organizers) | Add `is_founder` boolean to `users`, `businesses`, `organizers` tables. Set true for first N records. Display badge on profile. |
| Earned founder status (after caps fill) | Create `user_progress` table. Track points from: account creation (10), follow 5 venues (10), attend event (20), upload photo (15), write review (10), share event (10), invite 3 friends (15), complete feedback form (10). 100 points = founder badge. |
| Feedback form | Build simple form (rating, suggestions). After submission, award final 10 points and grant founder badge. |

---

## 3. Integration Instructions Needed

Please provide detailed setup guides for:

### 3.1 Paystack Integration
- Creating subaccounts for organizers via API.
- Dynamic split at checkout (70% organizer, 30% Pulsify – or variable).
- Webhook handling for `charge.success` to update ticket status.
- Testing in Paystack test mode before going live.

### 3.2 Apify + Phantombuster → Supabase
- Webhook receiver Edge Function (validate API key, upsert leads).
- Scheduling scrapers (weekly, using Apify/Phantombuster built-in schedules).
- Handling duplicates (upsert on website or social handle).

### 3.3 Map Fixes (Leaflet/Mapbox)
- Disable rotation: `rotate: false` or `touchRotate: false`.
- Full screen CSS: `position: fixed; top: 0; left: 0; width: 100vw; height: 100vh`.
- Coordinate validation before adding marker (bounds check).
- Heatwaves: Use Leaflet.heat or Mapbox heatmap layer. Cluster events within radius.

### 3.4 Notification Center
- Supabase Realtime subscription for new notifications.
- Bell icon badge (unread count).
- Panel UI (last 20 notifications, mark as read, mark all read).
- Triggers for: likes, comments, follows, event reminders, booking updates.

### 3.5 QR Code Tickets
- Generate QR code (e.g., `qrcode` NPM package) using unique ticket ID.
- Store QR as text or image in Supabase Storage.
- Scanner view: use browser camera API (`MediaDevices.getUserMedia`).

---

## 4. Deployment & Hosting

| Service | Purpose | Current Status |
|---------|---------|----------------|
| Vercel | Frontend hosting | ✅ Live (`pulsefy.vercel.app` – note spelling: Pulsefy) |
| Supabase | Database, auth, Edge Functions | ✅ Configured |
| HostKing | Domain (`pulsefy.co.za`) and email | ⏳ To be set up |
| Apify | Google Maps scraping | ⏳ To configure |
| Phantombuster | Instagram scraping | ⏳ To configure |
| Paystack | Payments | ⏳ To integrate |

**Domain note:** The domain `pulsify.co.za` is taken. We are using **pulsefy.co.za** instead. Update all references (Supabase allowed origins, Vercel domains, API callbacks) to `pulsefy.co.za`.

---

## 5. What I Need From You (Gemini AI)

Please provide:

1. **Step‑by‑step code and configuration** for the missing features above, prioritized by:
   - Critical: Business dashboard fix, map positioning, heatwaves.
   - High: Paystack integration, notification center.
   - Medium: Scraping system, founder gamification.
   - Low/Phase 2: Offline tickets, in-app chat.

2. **Specific Supabase SQL migrations** for:
   - `leads` table
   - `user_progress` table
   - `notifications` table
   - Organizer subaccount fields

3. **Edge Function code** for:
   - Paystack webhook handler.
   - Apify/Phantombuster lead ingestion.
   - Ticket QR generation.

4. **Frontend component examples** for:
   - Notification panel.
   - QR scanner view.
   - Founder progress bar.

5. **Debugging steps** for the current map misalignment and business login freeze.

---

## 6. Success Criteria

Once complete, a user should be able to:
- Sign up (Google/email).
- See events on a full‑screen map with heatwaves and correctly positioned icons.
- Book a ticket using Paystack.
- Receive a QR code in their Bookings page.
- Share an event to WhatsApp.
- Earn founder points naturally through engagement.

An organizer should be able to:
- Sign up separately from users.
- Create an event.
- See ticket sales and attendee list.
- Scan QR codes at the door.
- Receive payouts automatically to their bank account (2–3 day settlement).

A business (venue) should be able to:
- Log into a working dashboard.
- List events and manage pickup orders.
- Track revenue and check‑ins.

---

Please respond with complete, copy‑paste‑ready instructions and code. Assume I have admin access to Supabase, Vercel, Paystack, Apify, and Phantombuster. I will follow each step exactly.

Thank you.