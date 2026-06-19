# Squad Promos — Discovery Integration Handover

**Feature:** Squad Deals strip in Discover feed  
**Branch merged:** `claude/fix-event-organizer-feeds-ZCzRM` → `main`  
**Spec source:** `pulsefy_squads_discovery_integration.pdf`

---

## 1. Intent

Squad promos are group-exclusive deals posted by organizers or businesses (e.g. "Free entry before 9PM for groups of 3+"). Previously they were only visible inside the squads overlay. This feature surfaces admin-approved, admin-featured deals inside the public **Discover** tab as a horizontal card strip — driving more users into squads and giving promoters more reach.

The strip is **off by default** (hidden until a deal is explicitly featured by an admin). This keeps the primary discovery experience clean.

---

## 2. Data Flow

```
Organizer/business creates deal
  → POST /api/squad-promos
  → lands in squad_promos (approved=false, is_active=true)

Admin reviews in Admin → Deals tab
  → PATCH /api/squad-promos/:id/approve      sets approved=true
  → PATCH /api/squad-promos/:id/feature      sets highlight_in_discovery=true

User opens Discover tab
  → loadDiscoverSquadDeals() fires
  → GET /api/squad-promos?highlight=1[&city=X]
  → returns ≤5 deals where approved=true AND highlight_in_discovery=true
  → #disc-squad-wrap becomes visible
  → Tapping a card → openSocialSheet('squads')
```

---

## 3. Database

**Table:** `public.squad_promos`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `title` | text | Deal headline |
| `description` | text | Optional detail |
| `deal_type` | text | `food` / `nightlife` / `event` / `chill` |
| `venue_name` | text | Display name of venue |
| `location_city` | text | Lowercase city for filter matching |
| `squad_min` | int | Minimum group size |
| `squad_max` | int | Maximum group size |
| `total_price` | numeric | null = free deal |
| `valid_days` | text | e.g. "Fri, Sat" |
| `valid_from` / `valid_to` | timestamptz | Optional validity window |
| `image_url` | text | Optional cover image |
| `owner_id` | uuid | Creator's auth user ID |
| `owner_role` | text | `organizer` / `business` / `admin` |
| `approved` | bool | Admin must set to true before deal goes live |
| `rejected` | bool | |
| `reject_reason` | text | |
| `is_active` | bool | Creator can deactivate |
| `highlight_in_discovery` | bool | **Added in this feature** — admin toggles to surface in Discover |

**Migration applied to prod:**
```sql
ALTER TABLE public.squad_promos
  ADD COLUMN IF NOT EXISTS highlight_in_discovery BOOLEAN DEFAULT false;
```

---

## 4. API Endpoints

All under `api/index.js`.

### `GET /api/squad-promos`
Returns approved, active deals.

| Query param | Behaviour |
|---|---|
| `highlight=1` | Filter to `highlight_in_discovery=true` only; caps result at 5 |
| `city=durban` | Soft-match on `location_city` (contains, case-insensitive) |

**Auth:** public (no token required)  
**Response:** `{ promos: [...] }`

### `POST /api/squad-promos`
Create a deal. Requires auth token with role `organizer`, `business`, or `admin`.  
Auto-approves if creator is `admin`. Otherwise lands pending.

**Required body fields:** `title`, `venue_name`  
**Optional:** `description`, `deal_type`, `location_city`, `squad_min`, `squad_max`, `total_price`, `valid_days`, `valid_from`, `valid_to`, `image_url`

### `GET /api/squad-promos/mine`
Returns all deals owned by the authenticated user. Requires auth token.

### `PATCH /api/squad-promos/:id/approve`
Admin only. Sets `approved=true, rejected=false`.

### `PATCH /api/squad-promos/:id/reject`
Admin only. Sets `approved=false, rejected=true`. Optional body: `{ reason: "..." }`.

### `PATCH /api/squad-promos/:id/feature`
Admin only. Sets `highlight_in_discovery=true`.

### `PATCH /api/squad-promos/:id/unfeature`
Admin only. Sets `highlight_in_discovery=false`.

---

## 5. Frontend — Discover Strip

**File:** `apps/landing-page/index.html`

### HTML (line ~686)
```html
<!-- Squad Deals: hidden until admin features a deal -->
<div id="disc-squad-wrap" style="display:none">
  <div class="sl">
    <span>🎁 Squad Deals</span>
    <a onclick="openSocialSheet('squads');return false" style="cursor:pointer">Open Squads →</a>
  </div>
  <div class="hs" id="disc-squad-row"></div>
</div>
```

**Placement in Discover tab:** after "Places near you" (`#disc-biz-row`), before "Events" section. Satisfies the PDF rule: mid-feed, never at top.

### Loader function (line ~3463)
```javascript
async function loadDiscoverSquadDeals() {
  const wrap = document.getElementById('disc-squad-wrap');
  const row  = document.getElementById('disc-squad-row');
  if (!wrap || !row) return;
  try {
    const city = (!nearMeActive && feedCity && feedCity !== 'all') ? feedCity : '';
    const j = await Api.get('/squad-promos?highlight=1' + (city ? '&city=' + encodeURIComponent(city) : ''));
    const promos = j.promos || [];
    if (!promos.length) { wrap.style.display = 'none'; return; }
    row.innerHTML = promos.map(p => {
      const meta = SQ_DEAL_META[p.deal_type] || SQ_DEAL_META.food;
      const benefit = p.total_price
        ? `R${p.total_price} for ${p.squad_min}–${p.squad_max}`
        : `Free for groups of ${p.squad_min}+`;
      return `<div onclick="openSocialSheet('squads')" style="width:230px;flex-shrink:0;...">
        <!-- deal card markup -->
      </div>`;
    }).join('');
    wrap.style.display = 'block';
  } catch(e) { wrap.style.display = 'none'; }
}
```

**Called from:** end of `loadDiscover()` (first page only, not on append):
```javascript
if (!append) loadDiscoverSquadDeals();
```

### Deal type metadata (line ~6920)
```javascript
const SQ_DEAL_META = {
  food:      { icon: '🍔', label: 'Food Deal',     color: '#FF5C00', bg: 'rgba(255,92,0,.08)',   border: 'rgba(255,92,0,.25)' },
  nightlife: { icon: '🎶', label: 'Nightlife Deal', color: '#B026FF', bg: 'rgba(176,38,255,.08)', border: 'rgba(176,38,255,.25)' },
  event:     { icon: '🎟', label: 'Event Deal',     color: '#00E5FF', bg: 'rgba(0,229,255,.06)',  border: 'rgba(0,229,255,.2)' },
  chill:     { icon: '☕', label: 'Chill Deal',     color: '#C6FF4A', bg: 'rgba(198,255,74,.06)', border: 'rgba(198,255,74,.2)' },
};
```

Used in both the Discover strip and the squad overlay's Deals tab (`loadSquadDeals()`).

---

## 6. Frontend — Squad Overlay (Deals Tab)

**File:** `apps/landing-page/index.html` — `loadSquadDeals()` function (~line 6927)

This is the in-squad view (accessed via squads overlay → Deals tab). It calls `GET /squad-promos` **without** `?highlight=1`, so it shows all approved deals (not just Discover-featured ones). City is scoped to the current squad's `location_city`.

Card layout here is a vertical full-width list (not horizontal scroll), with more detail: description, group size range, price, validity days.

---

## 7. Admin Dashboard

**File:** `apps/admin/index.html` — "Deals" tab

### What the admin sees
- All squad promos (pending + approved + rejected) in a card list
- Each pending deal: **Approve** / **Reject** buttons
- Each approved deal: **⭐ Feature in Discover feed** / **Remove from Discover** toggle button

### Toggle button rendering (line ~3025)
```javascript
// Only shown for approved, non-rejected deals
`<button onclick="adminSqpFeature('${id}', ${highlight_in_discovery ? 'false' : 'true'})"
  style="background:${featured ? 'rgba(0,229,255,.12)' : 'rgba(255,255,255,.04)'};
         border:1px solid ${featured ? 'rgba(0,229,255,.35)' : 'var(--border)'};
         color:${featured ? '#00E5FF' : 'var(--mu2)'}; ...">
  ${featured ? '⭐ Featured in Discover — tap to remove' : '☆ Feature in Discover feed'}
</button>`
```

### adminSqpFeature function (line ~3058)
```javascript
async function adminSqpFeature(promoId, on) {
  const token = (await sb.auth.getSession()).data.session?.access_token || '';
  const r = await fetch('/api/squad-promos/' + promoId + '/' + (on ? 'feature' : 'unfeature'), {
    method: 'PATCH',
    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
  });
  const msgEl = document.getElementById('msg-squad-promos');
  if (r.ok) {
    msgEl.textContent = on ? 'Featured in Discover ⭐' : 'Removed from Discover';
    msgEl.className = 'msg ok';
    setTimeout(() => { msgEl.textContent = ''; }, 3000);
    loadAdminSquadPromos(); // refresh list
  } else {
    const j = await r.json();
    msgEl.textContent = 'Error: ' + (j.error || 'Failed');
    msgEl.className = 'msg err';
  }
}
```

---

## 8. Code Style Conventions

These match the existing Pulsify codebase patterns — important for Copilot to maintain:

| Convention | Pattern |
|---|---|
| HTML injection | String templates only — never DOM movement / `appendChild` into a feed element |
| XSS escaping | All user content goes through `x()` (alias for `escapeHtml`) before injection |
| API calls | Always through `Api.get()` / `Api.post()` — never raw `fetch()` in frontend |
| Auth token | `(await sb.auth.getSession()).data.session?.access_token` |
| Error handling | `catch(e) { wrap.style.display = 'none'; }` — silent fail for feed sections |
| Strip visibility | `display:none` default; JS sets `display:block` only when data exists |
| CSS variables | `var(--surf)`, `var(--border)`, `var(--mu)`, `var(--mu2)`, `var(--tx)`, `var(--or)` |
| Font | `font-family:'Syne',sans-serif` for headings/labels; system font for body text |
| Deal CTA gradient | `background:linear-gradient(135deg,#B026FF,#FF5C00)` — brand gradient |
| Idempotent renders | Check if container already exists before injecting; no double-renders |

---

## 9. Current Live State

- DB migration: **applied to prod** (`cjzewfvtdayjgjdpdmln`)
- Code: **merged to `main`**, deployed to `pulsefy.co.za`
- Discover strip: **hidden** — no deals have `highlight_in_discovery=true` yet
- Only deal in DB: "Group Entry Special" (`deal_type: nightlife`, `approved: false`)

**To activate the strip:**
1. Admin → Deals tab → Approve "Group Entry Special"
2. Tap "☆ Feature in Discover feed"
3. Strip appears immediately on next Discover tab open

---

## 10. Deviation from Spec (Intentional)

The PDF (§6) specifies adding columns to a `promotions` table and includes an `is_squad_only` column. This was not implemented because:

- `promotions` in the Pulsify schema is an unrelated ad/banner table
- The actual squad deals table is `squad_promos` — all rows are squad-exclusive by definition, so `is_squad_only` is redundant
- Only `highlight_in_discovery` was needed on `squad_promos`

---

## 11. Files Changed

| File | Change |
|---|---|
| `db/squad_promos_discovery_highlight.sql` | Migration — adds `highlight_in_discovery` column |
| `api/index.js` | `GET /squad-promos` — `?highlight=1` filter + 5-cap; new `feature`/`unfeature` PATCH actions |
| `apps/landing-page/index.html` | `#disc-squad-wrap` HTML; `loadDiscoverSquadDeals()`; `SQ_DEAL_META` shared constant; wired into `loadDiscover()` |
| `apps/admin/index.html` | Feature toggle button in deal card; `adminSqpFeature()` function |
