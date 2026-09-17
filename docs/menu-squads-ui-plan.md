# Menu & Squads Premium UI — Implementation Plan

**Scope:** Menu (customer + business) and Squads ONLY.
**Out of scope (separate phase):** Leads CRM, any admin-dashboard work, payment changes.
**Source brief:** `Pulsify_Premium_UI_System_Full_Animated_Spec.pdf` (Copilot), filtered to what fits Pulsify's real code and constraints.

---

## 0. Guiding principle — reuse, don't reinvent

Pulsify already ships most of the spec's primitives. We standardise on what exists instead of introducing a parallel system (CLAUDE.md rule #9 in the brief: "no one-off styles"). Inventory of what's already there:

| Spec asks for | Already exists | Where |
|---|---|---|
| Slide-up overlay open | `@keyframes su` (translateY 100%→0, .25s ease) | landing `index.html:325`, business `:74` |
| 150–250ms ease-out card transitions | `.bc/.fc/.de/.pc/.chip` all `transition: …15–.22s` | landing `:177,193,288,312` |
| Skeleton loaders | `.skel` + `@keyframes shim` (1.6s) | landing `:369–370` |
| Card image support | menu items + squad deal/biz cover images | see §1, §3 |
| Qty control / sticky cart | `_cartAdd`, `#biz-cart-bar` | landing `:3215`, `:3208` |
| 8px-ish spacing, 12–16px radius | `border-radius:12–18px` throughout | global |

**Gaps to actually build** (the real work): qty *stepper* `[− n +]` (currently add-only `+`), editable floating cart preview, add-to-cart bounce, success-tick CTA state, consistent skeletons on menu/deal lists, and a shared card class so customer-menu stops using fully-inline styles.

**Design tokens (use these, no new hex):** `--surf --surf2 --bg2 --border --border2 --or(#FF6B00) --li(#6EFF47) --tx --mu --mu2 --pk --cy`. Fonts: Syne (titles), Bebas Neue (big values), DM Sans (body).

---

## 1. Menu — Customer side (`apps/landing-page/index.html`)

**Functions:** `loadBizMenu` (`:3173`), `_cartAdd` (`:3215`), `showPickupOrderForm` (`:3232`), `submitPickupOrder` (`:3290`), `showOrderConfirmation` (`:3320`), `goToMyOrders` (`:3360`).

Current state: item card renders inline (image 54×54 + name + desc + price + a single `+` button with a `0` counter). Cart bar is `#biz-cart-bar` sticky at bottom → opens `showPickupOrderForm` slide-up.

### 1a. Shared card class (consistency)
- Add `.menu-card` (+ `.menu-card-img/.menu-card-info/.menu-card-name/.menu-card-price/.menu-card-qty`) to the page `<style>` mirroring the business dashboard's `.mi-*` classes (`apps/business:130–137`) so both apps look identical.
- Refactor the `loadBizMenu` template literal to emit `.menu-card` markup instead of the current inline-style block. **Surgical:** only swap the card wrapper's styles to classes; keep the registry/onclick logic (`_cartAdd('${x(item.id)}')`) byte-for-byte.
- **Verify:** menu still renders by category; `+` still increments; no console errors; backtick count stays even (CLAUDE.md fragile-areas rule).

### 1b. Qty stepper `[− n +]`
- Replace the single `+` button + `#cq-` span with a 3-part stepper: `−  n  +`. Show `−` only when qty>0.
- Add `_cartSub(itemId)` next to `_cartAdd` (decrement, floor 0, recompute total, hide bar at 0). Mirror `_cartAdd` exactly.
- **Verify:** add 3 → shows 3; subtract to 0 → bar hides, count gone.

### 1c. Editable floating cart preview
- New `_renderCartPreview()`: a slide-up sheet (reuse `@keyframes su`) listing each line `qty × name … R subtotal` with inline `−/+` and a remove (✕). Recomputes total live, calls existing `_cartAdd/_cartSub`.
- The sticky `#biz-cart-bar` button opens this preview; preview's primary CTA is the existing "Place Order" → `showPickupOrderForm`.
- **z-index:** preview must sit BELOW `pickup-form-overlay` (which is `z-index:3000`). Use `2900`. Respect the overlay back-button stack (CLAUDE.md §7) — register so Android back closes the topmost first.
- **Verify:** edit qty in preview → menu counters and total stay in sync; remove line → disappears; back button closes preview before the menu.

### 1d. Animations / feedback
- **Add-to-cart bounce:** add `@keyframes mc-bounce{0%{transform:scale(1)}40%{transform:scale(1.18)}100%{transform:scale(1)}}`; apply to the `#cq-` count for 250ms on change. (Cart counters are plain DOM — transform is safe here; the no-transform rule is **map markers only**.)
- **Confirm CTA success tick:** in `submitPickupOrder`, on success swap the button label to a ✓ + "Confirmed" for ~600ms before opening `showOrderConfirmation` (already exists). Error path keeps `showToast(…, 'err')`.
- **Skeletons:** while `loadBizMenu` awaits, render 3× `.skel` rows instead of the "Loading…" text.

---

## 2. Menu — Business side (`apps/business/index.html`)

**Functions:** `renderMenu` (`:2463`), `submitMenuItem` (`:2504`), `editMenuItem` (`:2571`), `deleteMenuItem` (`:2606`), `handleMenuImgs` (`:1957`). Card classes `.menu-item-card/.mi-*` already exist (`:130–137`).

This side is already card-based and closest to the spec. Light polish only:
- **2a.** Skeletons: show `.skel`-style placeholder rows while `renderMenu` loads (business dashboard has `@keyframes su` but check it has a shimmer; if not, port `.skel`/`@keyframes shim` from landing).
- **2b.** Save feedback: `submitMenuItem` already toasts — add the success-tick on the save button (same pattern as §1d) before `closeSheet`.
- **2c.** List item load-in: add `fade + translateY(10→0)` on `.menu-item-card` (spec "on load"). One `@keyframes` + class, applied on render.
- **Hard rule:** `ticket_tiers` is unrelated here, but the menu insert must keep inserting only real columns — do NOT touch the insert payload (CLAUDE.md GENERATED-columns lesson). Visual-only changes.

---

## 3. Squads (`apps/landing-page/index.html`)

**Functions:** discover deal strip `loadDiscoverSquadDeals` (`:3537`), `openDealDetail`, squad list `renderSquad` (`:5115`) / `loadSquads` (`:6600`) / `renderSquadTabs` (`:6637`), workspace `renderSquadWorkspace` (`:6663`) + tabs `showSqTab` (`:6728`) (plans/chat/members/deals/calendar), `loadSquadDeals` (`:7014`), invite `openSquadInvite`/`sqShareInvite` (`:7325`).

Deal cards already have hero treatment via `SQ_DEAL_META` (icon/colour/label header) and show the deal value large (`font-size:1.3rem;font-weight:900` in orange/lime). Close to spec already.

### 3a. Deal card → universal card (consistency)
- Standardise the discover deal strip (`:3537`) and the in-workspace deal list (`loadSquadDeals :7014`) on ONE shared `.deal-card` class (header badge → title → big value → meta → CTA). Currently the strip is inline-styled.
- **Badges (New/Popular/Limited):** derive from existing data — `Limited` when `squad_max` small or near capacity, `Popular` when claimed-count high. No new DB column; if data isn't available, show only what we can (don't fabricate).

### 3b. Deal detail expand
- `openDealDetail` already opens a detail view — ensure it uses the slide-up (`su`) transition and a success-tick on the claim CTA (`claimDeal`-style). **Verify the claim navigation still works** (this was fixed before — squad deal claim navigation, commit `dc31224`). Don't regress it.

### 3c. Workspace tabs fade
- `showSqTab` switches plans/chat/members/deals/calendar. Add the spec's `fade (opacity 0→1)` on the active pane. Keep the existing load-on-demand calls (`loadSquadPlans/loadSqChat/loadSqMembers/loadSquadDeals/loadSqCalendar`) untouched — only wrap the pane reveal in a fade.

### 3d. Skeletons + feedback
- Skeletons for `loadSquadDeals`, `loadSquadPlans`, `loadSqMembers` lists.
- Success-tick / toast already partly present on RSVP (`rsvpPlan`) and send (`sendSqMsg`) — standardise on the §1d tick pattern.

---

## 4. Shared animation layer (build once, reuse)

Add to BOTH `apps/landing-page/index.html` and `apps/business/index.html` `<style>` (keep names identical across apps):
```css
@keyframes mc-bounce{0%{transform:scale(1)}40%{transform:scale(1.18)}100%{transform:scale(1)}}
@keyframes card-in{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
@keyframes err-shake{0%,100%{transform:translateX(0)}25%{transform:translateX(-5px)}75%{transform:translateX(5px)}}
.card-in{animation:card-in .2s ease-out both}
.tap-press:active{transform:scale(.98)}
```
Reuse existing `@keyframes su` (slide-up) and `.skel`/`@keyframes shim` (skeleton) — do NOT duplicate them.

**Hard constraints (do not violate):**
- **No `transform` on map markers / anything inside `#mc`** — Mapbox owns it (CLAUDE.md §7). All animations above are for menu/squad/cart DOM only.
- **No broad regex replacements** on `index.html` (Hard rule #6). Edit targeted blocks.
- `index.html` must keep exactly one `let searchTimeout`, end with `</script></body></html>`, even backtick count. Always `cp index.html index.html.bak` before editing.
- Customer menu cart logic uses the **window registry** (`window._menuItemReg`) — never inject item names/quotes into onclick attributes. `x()` escapes HTML but not single quotes.

---

## 5. Build order & verification

1. **Shared animation layer (§4)** → verify: page loads, no layout shift, backticks even.
2. **Menu shared card class (§1a, §2)** → verify: both menus render identically, `+` works.
3. **Qty stepper + editable cart preview (§1b, §1c)** → verify: add/subtract/remove all sync; back button order correct.
4. **Squad deal card unification + badges (§3a, §3b)** → verify: claim flow still navigates correctly (no regress of `dc31224`).
5. **Tab fades + skeletons + success ticks (§1d, §2a-c, §3c-d)** → verify: feedback ≤300ms; error shake on failed submit.
6. **Polish pass** → side-by-side customer/business menu, deal strip vs workspace deal list look consistent.

Each step: one commit, push to `claude/fix-event-organizer-feeds-p2srg2`, preview-deploy check, then proceed.

---

## 6. Explicitly deferred
- **Leads CRM** (Kanban, bulk WhatsApp/email, follow-up scheduling, activity timeline) — admin-app feature, separate brief.
- New DB columns (e.g. a real `is_premium`/deal-badge flag) — current badges are best-effort from existing data.
- Any payment / Paystack changes.
