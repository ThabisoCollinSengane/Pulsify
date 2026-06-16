# Pulsefy — Ranked Dashboard Fixes (Final)

Priority order: **Critical → High → Medium → UI/Logic.**
This is the consolidated, prioritized roadmap derived from the dashboards
code review (see `docs/dashboards-handover.md` §6 for the line-referenced
findings behind the Critical/High items). Tackle in phase order at the bottom.

---

## Global (all dashboards)

**Critical**
1. Remove direct Supabase writes → use API layer
2. Enable payment verification (Paystack server-side)
3. Fix XSS vulnerabilities (`innerHTML` → escaped / `textContent`)
4. Secure QR system (JWT / HMAC signing)

**High**
5. Standardize auth tokens (single source)
6. Restrict CORS in production

**Medium**
7. Add rate limiting (move to Redis later)

---

## Business dashboard

**Critical**
1. Move localStorage → database
   - `business_menu_items`
   - `orders`
   - `order_items`
   - `business_hours`
2. Fix `ensure-business-profile` onboarding failure

**High**
3. Prevent duplicate business accounts
4. Enforce backend limits (menu / items)

**Medium**
5. Improve geolocation error handling

---

## Organizer dashboard

**Critical**
1. Move event creation to API layer
2. Validate all event inputs server-side

**High**
3. Enforce limits server-side (posts / menu)
4. Validate coordinates (manual + geocoding)

**Medium**
5. Improve error handling feedback (user UI)

---

## Admin dashboard

**Critical**
1. Fix ALL XSS vulnerabilities (escaping required everywhere)

**High**
2. Add rollback for bulk geocode operations
3. Add notification audience preview before sending

**Medium**
4. Add pagination limits (max ~100 per request)
5. Fix token inconsistency (localStorage vs memory)

---

## Map & data layer

**Critical**
1. Create venues table
   - `events → venue_id` (foreign key)

**High**
2. Normalize lat/lon across system
3. Add coordinate validation pipeline

**Medium**
4. Add `location_confidence` field

> Note: the venues table, `venue_id` FK + back-fill, coordinate validation
> trigger, and `location_confidence` shipped in PR #23 (see CLAUDE.md §8.A).
> Remaining map work is normalization + the auto-geocoding pipeline.

---

## UI improvements

**High**
1. Add "Explore map nearby" CTA in hero
2. Add distance to event cards (e.g. "📍 2km away")

**Medium**
3. Add mini-map preview under hero
4. Improve empty states (no dead screens)

---

## Logic improvements

**High**
1. Implement ranking system:
   `score = proximity + hype_score + engagement + time relevance`
2. Make all discovery map-based (even if map hidden)

**Medium**
3. Add recommendations:
   - "Tonight near you"
   - "Trending nearby"
4. Connect events → nearby businesses
   - after-party suggestions
   - deals

---

## Execution plan

**Phase 1 (Critical)**
- API layer (remove direct DB writes)
- Payment verification
- localStorage → database migration
- XSS fixes
- QR system security

**Phase 2 (High)**
- Validation fixes
- Auth cleanup
- Venues system
- Data normalization

**Phase 3 (UX & Logic)**
- Map-first improvements
- Ranking system
- Recommendations
- Event → business linking

---

## Final note

The product is feature-complete but needs:
- backend enforcement
- data consistency
- intelligent UX

Goal:
- Production-ready system
- Scalable platform
- Strong user trust
