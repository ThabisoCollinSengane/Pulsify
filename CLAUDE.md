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
npx vercel --prod --yes --force --token=<VT>

**CRITICAL — always use `--force`.** Without it, Vercel's edge cache can serve the old CDN response for `/` even after a successful deploy. `--force` bypasses the cache and guarantees the new bundle is served immediately.

### Deployment gotcha — root index.html shadows the `/` rewrite
Vercel serves static files with higher priority than `rewrites`. If any `index.html` exists at the repo root, it will be uploaded by the CLI and served for `/`, completely bypassing the `/ → apps/landing-page/index.html` rewrite in `vercel.json`. This is why `.vercelignore` excludes `/index.html`. **Never create or leave an `index.html` at the repo root.**

Diagnosis: if `/diagnose` shows the new build version but `/` still shows old code, a stale static file is being served. Check `.vercelignore` and run with `--force`.

---

## 6. Workflow with Claude (MCP ↔ GitHub Actions)

Claude works in an **MCP environment** with the repo mounted. All deploys happen automatically via GitHub Actions — no Codespaces or terminal required.

### How edits flow
1. Claude edits files directly in the MCP repo using Read/Edit/Write.
2. Claude commits + pushes to the assigned branch (e.g. `claude/fix-...`).
3. GitHub Actions runs `.github/workflows/deploy.yml` automatically and deploys to Vercel production.
4. Claude can merge the PR via GitHub MCP tools when the work is complete.

### GitHub Actions deploy workflow
- Triggers on push to `main` or any `claude/**` branch.
- Requires 3 repository secrets (already configured):
  - `VERCEL_TOKEN` — authentication token
  - `VERCEL_ORG_ID` — Vercel team/org ID
  - `VERCEL_PROJECT_ID` — Vercel project ID
- Uses `npx vercel --prod --yes --force` (same `--force` flag as manual deploys).
- Workflow file: `.github/workflows/deploy.yml`

### Manual deploy (fallback if Actions unavailable)
```
npx vercel --prod --yes --force --token=<VT>
```

### Rules for this workflow
- **Prefer file edits over scripts.** Edit the file, push — Actions handles the rest.
- **No broad regex replacements** on `index.html` (Hard rule #6 above).
- **Always read before editing.** Check the actual file state — past sessions may have left partial changes.
- **Claude can merge PRs** using the GitHub MCP tools (`mcp__github__merge_pull_request`). Do this when CI is green and work is complete.
- Subscribe to PR activity with `mcp__github__subscribe_pr_activity` to watch CI and auto-fix failures.
