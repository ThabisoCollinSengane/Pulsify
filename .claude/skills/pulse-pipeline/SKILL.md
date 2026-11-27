---
name: pulse-pipeline
description: Use for ANY bug fix, feature or UI change on Pulsify. Runs the AI team in order (researcher → builder/designer → reviewer → qa-tester) and stops for the owner's approval before anything goes live.
---

# Pulse pipeline

Run the team in this order. Each agent lives in `.claude/agents/`.

## 1. Research → BRIEF
Call **researcher**. It returns a BRIEF: problem, evidence, root cause, fix, files, risks,
what it couldn't confirm.
- If the job touches more than one area (e.g. posts AND settings), show the owner the plan
  first and wait.

## 2. Build
- Code, API, SQL → **builder**.
- Layout, visuals, animation → **designer**.
- Both can work from the same BRIEF on separate files.

## 3. Review (max 3 rounds)
Call **reviewer** on the diff. Send every BLOCKER and FIX back to whoever wrote that part.
Repeat until **PASS**. After 3 rounds without PASS, stop and ask the owner with 2–3 options.

## 4. QA
Call **qa-tester** on the preview URL. Any FAIL goes back to its owner (builder or designer),
then back through review.

## 5. Approval — show the owner
- What changed, in plain words.
- Reviewer: PASS.
- QA results (PASS/FAIL per check).
- 1–2 screenshots.
- The preview URL.
- What wasn't tested.

## 6. Ship
- Commit to a `claude/**` branch, push, open a **draft** PR (`claude/**` = preview URL only).
- Merging to `main` = going live. Only the owner says when. Run the **ship-check** skill first.

## Stop and ask the owner first — don't decide alone — when
- money is involved (payments, payouts, prices, paid services),
- user data could be deleted or changed in production,
- a third-party sign-up or account is needed,
- the fix changes how the product works for users.

Talk to the owner in plain language, short and direct. When stuck, give 2–3 options,
not an open question.
</content>
</invoke>
