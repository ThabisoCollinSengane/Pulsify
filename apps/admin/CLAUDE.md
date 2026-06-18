# Admin Dashboard – Pulsify

## Files
- `index.html` – user management, coordinate fixes, event approval, subscription management.

## Known bug
- User list error: column `full_name` should be `display_name`. Fix in `apps/admin/index.html`.

## Subscription management
- View all users with their `subscription_type` (`free`, `premium`, `trial`).
- Ability to upgrade/downgrade manually (for trials, support).
- Set trial end date (`trial_expires_at` column in `profiles`).

## Event approval (free organizers)
- List pending events (where `approved = false`). Show event details.
- Approve/Reject buttons. On approve, set `approved = true` and event appears on map/feed.
- Reject with reason (optional).

## Banner Manager
- List all banner items (active + expired).
- Add new banner: text, target URL (map, event, business), expiration date.
- Edit/delete existing banners.
- Preview banner slider.

## Push Notifications (future)
- Compose notification (title, message, optional link).
- Send to: all users, users who follow a venue, users who attended an event.
- Schedule future send.
- View notification history.

## Business featured placement
- Admins can manually set `is_frontline = true` and adjust `frontline_rank` for premium businesses (or as part of subscription).

## Built (shipped)
- [x] Subscription column in `profiles`.
- [x] Pending events approval (Events tab → pending filter + Approve/Reject).
- [x] Manual override for free/premium status (`setSubscription`).
- [x] Log of admin actions (`logAdminAction`).
- [x] Banner CRUD UI (Banners tab).
- [x] Push notification composer (Notify tab → `sendAdminNotification`).

## Hard rules
- Only users with `role = 'admin'` can access.
- All admin actions should be logged (future).
