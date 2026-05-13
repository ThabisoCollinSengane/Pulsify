# Pulsify Release Checklist

**Version:** ________  
**Date:** ________  
**Environment:** Production / Staging  

---

## Pre-Release
- [ ] All critical bugs reviewed (see `debugging.md` Active Issues)
- [ ] Map renders with fallback
- [ ] Auth flows tested (email + Google)
- [ ] QR scanning tested (online + offline) – **once implemented**
- [ ] Supabase migrations applied (if any)

---

## Post-Release Verification
- [ ] No console errors on load
- [ ] Events appear on map
- [ ] Organizer dashboards load
- [ ] Business login redirects correctly
- [ ] Leads dashboard shows data (if scrapers have run)

---

## Documentation Updates (MANDATORY)
For each fixed issue:
- [ ] `debugging.md` – move from Active → Resolved, add date and lessons
- [ ] `frontend.md` or `backend.md` – update if new anti-pattern or rule discovered
- [ ] `CLAUDE.md` in relevant dashboard – update if config changes

---

## Claude Action
Run the **Post-Fix Documentation Update Prompt** for:
- Each resolved issue
- Each significant architectural change

---

## Sign-Off
**Released by:** ________  
**Notes:** ________
