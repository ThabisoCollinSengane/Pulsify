# Business Dashboard – Pulsify

## Files
- `index.html` – orders, menu, stats, ads.
- `login.html` – login/register page.

## Authentication flow
1. User submits email/password (or Google) in `login.html`.
2. Supabase auth returns session.
3. **Critical**: Must call `/api/auth/ensure-business-profile` to sync role into `profiles` table.
4. On success, redirect to `/business` (which serves `index.html`).

## Known bug (freeze)
- **Symptom:** After login, page hangs or redirects incorrectly.
- **Root cause:** Missing or failed call to `/api/auth/ensure-business-profile`.
- **Fix:** Ensure `login.html` JS contains the API call after Supabase auth success.

## Subscription tiers
- **Free**:
  - Basic map listing (not featured).
  - Menu: up to 10 items.
  - No analytics beyond basic stats.
- **Premium (R499/month)**:
  - Featured placement on map (`is_frontline = true`, high `frontline_rank`).
  - Unlimited menu items.
  - Analytics dashboard (views, saves, orders by day).
  - Ability to purchase top banner ads (`ads` table).
  - Priority support.

## Implementation
- Add `subscription_type` column to `profiles` (for business owners).
- `businesses` table already has `is_frontline` and `frontline_rank` – use these for premium.
- Ads: separate table with `business_id`, `image_url`, `start_date`, `end_date`, `price_paid`.

## QR code scanning (pickup orders)
- Businesses scan customer's order QR code to mark order as `completed`.
- Endpoint: `POST /api/validate-order` with QR data.
- Scanner UI: camera + `jsQR`.

## To be built
- [ ] Subscription field for businesses.
- [ ] Menu item limit for free accounts.
- [ ] Analytics dashboard (premium only).
- [ ] Ad purchase UI.
- [ ] QR scanner for orders.

## Hard rules
- Role must be `business` in `profiles`.
- Premium features gated by subscription.
