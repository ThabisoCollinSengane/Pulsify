---
name: ship-check
description: Quality gate before the owner approves merging a Pulsify PR to main (going live). Reports every release-checklist item and CLAUDE.md hard rule as PASS / FAIL / NOT TESTED, then summarises in plain words. Never merges, deploys or deletes data.
---

# Ship check

Run against the branch's preview deployment and its diff against `main`.
Mark every item **PASS**, **FAIL** or **NOT TESTED** (with the reason).

## Code and hard rules (CLAUDE.md section 5)
- [ ] `node --check` passes on every changed `.js` file
- [ ] `vercel.json` only contains API routes — no `/(.*) → index.html`
- [ ] No `index.html` at the repo root; no `.bak` files committed
- [ ] No `.env` and no secrets in the diff (`git diff main...HEAD | grep -iE "key|secret|token|password"`, every hit read)
- [ ] Supabase service key not in any HTML file
- [ ] Changed HTML: even backtick count, ends with `</html>`, one `let searchTimeout`, inline scripts parse
- [ ] Friend-search functions use `getSB()`
- [ ] Map coordinates validated to SA bounds (lat -35 to -22, lon 16 to 33)
- [ ] Mock data only as fallback (real API first)
- [ ] No new files under `api/` (Vercel 12-function limit)
- [ ] Schema changes have a `db/*.sql` file and were applied; RLS reviewed on touched tables

## Pre-release (`.claude/RELEASE_CHECKLIST.md`)
- [ ] Critical bugs in `.claude/debugging.md` Active Issues reviewed
- [ ] Map renders, with fallback
- [ ] Auth flows: email sign-in (Google: usually NOT TESTED — say so)
- [ ] QR scanning, if touched
- [ ] Supabase migrations applied, if any

## On the preview
- [ ] No console errors on load
- [ ] Events appear on the map
- [ ] Organizer dashboard loads
- [ ] Business login redirects correctly
- [ ] Leads dashboard shows data
- [ ] Changed flows work at 390px and desktop, signed in and out (qa-tester report)

## Documentation (mandatory)
- [ ] `.claude/debugging.md` updated (Active → Resolved with date and lesson)
- [ ] `frontend.md` / `backend.md` updated if a new rule or anti-pattern was found
- [ ] `CLAUDE.md` updated if config or architecture changed

## Summary for the owner (plain words)
1. What users will see differently.
2. What was checked.
3. What wasn't, and why.
4. Any risk of merging.

Never merge, deploy or delete data without the owner's explicit OK in the conversation.
</content>
</invoke>
