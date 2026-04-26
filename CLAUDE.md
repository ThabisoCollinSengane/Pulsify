# CLAUDE.md — Pulsify Project Guidelines

Behavioral guidelines + project context for Claude Code.
Derived from Andrej Karpathy's observations on LLM coding pitfalls.

---

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them — don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it — don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

For multi-step tasks, state a brief plan:
1. [Step] → verify: [check]
2. [Step] → verify: [check]

---

## 5. Pulsify Project Rules

### Hard rules
1. vercel.json must only contain the API route — never add /(.*) → index.html
2. Never commit .env
3. All Python scripts must use encoding utf-8
4. Friend-search functions must use getSB() — never a locally-scoped supabase variable
5. Map markers must validate SA bounds: lat -35 to -22, lon 16 to 33
6. Never run broad regex replacements on the whole HTML file
7. Supabase service key is server-only — never in any HTML file
8. Mock data stays as fallback — real API first, mock if empty

### index.html fragile areas
- Only ONE let searchTimeout declaration
- initSupabaseSession must exist and be called via DOMContentLoaded
- searchUsers, toggleFollow, escapeHtml must use getSB()
- File must end with </script></body></html>
- Backtick count must be even
- Always backup before editing: cp index.html index.html.bak

### Database facts
- events.id is TEXT not UUID
- businesses lat/lon must be validated SA bounds before saving
- profiles.id = Supabase Auth user ID

### Deploy command
export VT=$(grep VERCEL_TOKEN /workspaces/Pulsify/.env | cut -d= -f2)
npx vercel --prod --yes --token=$VT
