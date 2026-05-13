# Frontend Engineering Guide – Pulsify

## Purpose
Rules and lessons for building reliable, fast, mobile-first UI.

---

## Hard Rules
- Vanilla JS only (no frameworks).
- Always render fallback UI for map, API calls, and async operations.
- Never block UI on map or API calls.
- Use `getSB()` for Supabase client, never a local `supabase` variable.
- All HTML must be responsive (viewport, no horizontal overflow).

---

## Anti-Patterns (Discovered)
- **Direct `supabase` variable** – leads to auth failures. Always use `getSB()`.
- **Missing error handling** – results in blank screens. Always `.catch()` and show toast.
- **Hardcoding coordinates** – causes ocean markers. Always validate with `validCoord()`.

---

## Resolved Frontend Issues
*(none yet)*

## Planned Improvements
- GTA-style map redesign (glowing markers, info panel, compass).
- Real-time updates for feed and map (Supabase Realtime).
- QR scanner view for tickets/orders.

---

## Claude Update Contract
Update this file only when a frontend bug is fixed or a new rule is discovered.
- Append new anti-patterns.
- Move resolved issues to the list with date and lesson.
