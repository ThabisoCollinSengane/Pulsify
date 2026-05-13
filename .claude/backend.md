# Backend Architecture & Rules – Pulsify

## Core Principles
- Supabase is the source of truth.
- All mutations (writes) go through `/api` endpoints – never client-side direct inserts.
- Row Level Security (RLS) is enforced on all tables; service_role key is used only in `api/index.js`.

---

## Known Pitfalls
- **Missing `ensure-business-profile` call** – causes login freeze.
- **Wrong column names** – `full_name` instead of `display_name` breaks admin panel.
- **Positive latitudes** – ocean markers.
- **Missing RLS policies** – leads to empty queries.

---

## Subscription Logic (To Be Implemented)
- Add `subscription_type` column to `profiles` (`free`, `premium`, `trial`).
- **Free organizer**:
  - Max 1 post per month.
  - Events require admin approval (`approved` boolean).
- **Premium organizer**:
  - Unlimited posts.
  - Auto-approve events.
- **Business**:
  - Free: basic listing, up to 10 menu items.
  - Premium: featured placement (`is_frontline`), unlimited menu, analytics, ad purchases.

---

## API Endpoints Still Missing
- [ ] `GET /api/notifications/count`
- [ ] `PATCH /api/notifications/:id/read`
- [ ] `POST /api/notifications/mark-all-read`
- [ ] All leads routes (`/api/leads`, `/api/leads/stats`, etc.)
- [ ] QR validation endpoint (`POST /api/validate-ticket`)
- [ ] Banner system (`GET /api/banner`, admin CRUD)
- [ ] Push notifications (`POST /api/subscribe`, admin send)

## Pending Data Tables
- `banner_items` (id, text, url, expires_at, created_by, sort_order)
- `ads_purchases` (business_id, start_date, end_date, amount_paid)

---

## Resolved Backend Issues
*(none yet)*

---

## Claude Update Contract
Update this file when backend bugs are fixed or new architectural decisions are made.
- Append resolved issues with root cause and fix.
- Update missing endpoints list as they are implemented.
