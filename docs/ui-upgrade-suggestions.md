# Pulsefy UI upgrade ideas: pick what you want

Written 27 Nov 2026 by the designer agent. These are only ideas. Nothing has been changed yet.
Everything was checked on a 390px-wide phone screen first and then on a 1280px desktop.
Screenshots are in `/tmp/claude-0/-home-user-Pulsify/5a2a850d-e34c-58c2-b7ee-189033936617/scratchpad/ui/`.
That is a scratch folder, so the files can be wiped.

How to read each idea: **Now** is what users see today. **Change** is what I'd do. **Why** is what users get.
Effort: S = under an hour, M = half a day, L = a day or more. Risk is the chance of breaking something.

---

## Quick wins

**1. Post card header: long names squash into a tall column**
- Now: a long name like "Thandeka Mkhize-Ndlovu Events & Promotions" plus the VERIFIED, Page and HOT badges wraps onto 4 lines. The name gets about 1/3 of the width (`feeds-posts-390.png`).
- Change: keep the name on one line and end it with "…" if it's too long. Show the verified mark as just the tick (no tiny "VERIFIED" word). Show HOT once, over the photo, not in the header.
- Why: every post header becomes the same height, so the feed is calmer and quicker to scan.
- Effort S · Risk low. Mock-up: `MOCKUP-feeds-postcard-after-390.png`. In the mock-up the "Page" pill still wraps; the real version will keep it on one line.

**2. Multi-photo posts: nothing shows there are more photos**
- Now: posts with 3 photos look exactly like posts with 1. Users have to guess that they can swipe.
- Change: add a small "1/3" counter in the corner and dots under the photo. Both update as you swipe.
- Why: people find the other photos. Organisers' photo sets get seen.
- Effort S · Risk low. Mock-up: `MOCKUP-feeds-postcard-after-390.png`.

**3. Buttons are too small to tap**
- Now (measured): like, comment, share and save on event cards are **17px tall**. On post cards they are **24px**, and Follow is 25px. The minimum for thumbs is 44px.
- Change: make the tap area of each button 44px. Icons stay the same size; only the invisible touch area grows. Move Report to the far right so it isn't hit by accident.
- Why: fewer missed taps and accidental likes on small Android screens.
- Effort S · Risk low. Screenshots: `index-eventcards-390.png`, `MOCKUP-feeds-postcard-after-scrolled-390.png`.

**4. Grey text is too dark to read (contrast)**
- I measured the grey text colour against the background. The WCAG guideline needs at least **4.5**.
  - Feed, profile and settings grey (`--mu` #5A5870) on cards: **2.68**, which fails. On the page background: **2.92**, which also fails.
  - Home page grey (`--mu` #8575AE) on cards: **3.93**, a borderline fail.
  - Lighter grey (`--mu2`): **6.4**, which passes. Main text: **16.0**, which passes. Orange on cards: **5.9**, which passes.
  - White text on the orange end of the gradient buttons: **3.10**. That's fine for big bold text but weak for small button labels.
- Change: lighten `--mu` to about #8A88A4 (5.9 on the background, roughly 5.0 on cards). On the home page, use `--mu2` for small text on cards.
- Why: timestamps, @handles, venue names and nav labels become readable outdoors in sunlight on cheap screens.
- Effort S · Risk low. This is a one-line colour change per page.

**5. Bottom nav: tiny labels, and different on every page**
- Now: labels are **8px**, which is very small. On Home the tabs are "Home / Discover / Map / My Bookings / Me". On the Feed page they are "Home / Feed / Map / Bookings / Profile". On the Feed page, Map, Bookings and Profile all just open the home screen, not that tab.
- Change: use one set of 5 tabs with the same names everywhere. Make labels at least 10–11px. Make each Feed-page tab go to the right place (for example `/?tab=map`).
- Why: people learn the nav once. Tapping "Map" should open the map.
- Effort S–M · Risk low–medium, because the home page needs to read the `tab` link.

**6. The ✏️ round button covers content**
- Now: on the Feed page, the floating post button sits over the end of captions and over the Report button (`feeds-posts-390.png`).
- Change: add bottom padding to the feed so the last card's buttons sit above it. Optionally hide the button while scrolling down. The top bar already has "+ Post", so this button is a duplicate.
- Effort S · Risk low.

**7. Error and empty states**
- Now: when posts fail to load, the Feed page shows "Could not load posts / Supabase not loaded". That's a technical message with no button (`feeds-390.png`). The home page does it better, with "Try Again". An empty Posts tab on a profile is just blank space (`user-profile-390.png`).
- Change: use one friendly pattern everywhere: icon, a short human sentence, and one button ("Try again", "Share your first post", "Find events near you").
- Why: users on weak mobile data hit this often. A button keeps them in the app.
- Effort S · Risk low.

**8. Respect "reduce motion" and stop endless animations**
- Now: every verified badge pulses forever, the logo dot pulses, and the top ticker scrolls forever. The Feed, profile and settings pages have **no** reduced-motion setting. Home has one, for skeletons only.
- Change: stop the badge glow and the dot pulse after a few seconds, or remove them. Turn off the ticker scroll, card slide-ins and pulses for users who turn on "reduce motion" on their phone.
- Why: smoother scrolling and less battery drain on cheap Androids. It also respects user settings.
- Effort S · Risk low. Map markers are not touched (CLAUDE.md §7: no transforms on markers).

## Bigger changes

**9. Event card: say each thing once and make it easy to scan**
- Now: one card shows the city and date **3 times**. They appear in the header ("📍 Durban · Tonight · 9:00PM"), again below the photo ("DURBAN • Tonight · 9:00PM"), and "23 going" appears twice (`index-eventcards-390.png`). The organiser name is the most prominent text above the photo, more than the date.
- Change: use a fixed order on every card:
  1. Photo with the title and price chip
  2. **Date and time** in bold, e.g. "TONIGHT 21:00" or "SAT 6 DEC 14:00"
  3. **Venue · area · distance**
  4. One "23 going" line
  5. The button row

  The organiser moves to a small line. TONIGHT, FREE and Selling-fast stay as the single badge.
- Why: people decide on **when, where and how much** in about a second. Duplicate text wastes screen space on small phones.
- Effort M · Risk medium. `buildCard` in index.html is used by several lists, so the feed breaks (businesses, map, categories, trust, community) must still slot in after the right number of cards. Only the inside of a card changes, not the `.fc` class.

**10. Settings page: shorter, grouped, and safe to save**
- Now: one 2,500px-long scroll. The only "Save All Changes" button is at the very bottom, so if you edit your name near the top you must scroll the whole page. "Sign Out" sits directly under Save, so a mis-tap logs you out (`profile-settings-390-full.png`).
- Change: show a sticky "Save" bar at the bottom only once something has changed. Group the page into 4 sections: Profile (photo, name, handle, bio), Account (email, phone, verification), Preferences (vibes, notifications), and Privacy. Move Sign out and Delete account into a separate "Account actions" area at the bottom, with space above it.
- Why: fewer lost edits and no accidental sign-outs.
- Effort M · Risk medium. **Another agent is editing profile-settings.html right now, so do this after that work is merged.**

**11. Typography and spacing: one scale across all pages**
- Now: the home page uses a purple theme (`--bg` #160C32). Feed, profile and settings use a near-black navy theme (#05080F), with a different orange, a different green and different greys. Text sizes vary a lot: 8px, 8.8px, 10.5px, 11.5px and so on. On the profile page, the followers counts and the posts/events counts use two different styles (`user-profile-390.png`).
- Change: use one shared colour set and 5 text sizes, for example 11 / 13 / 15 / 18 / 28px. Use 4 spacing steps: 4, 8, 12 and 16px. Use one style for every stat row.
- Why: going from Home to Feed should feel like the same app.
- Effort M–L · Risk medium. It touches many inline styles, so do it page by page, not with find-and-replace (hard rule 6).

**12. Desktop: keep content in a centre column**
- Now: at 1280px, feed photos stretch the full width of the screen, which gives a 1280px square photo. Event cards also stretch edge to edge (`feeds-posts-1280.png`, `index-eventcards-1280.png`).
- Change: limit the feed to a centred column of about 600px. The top bar and bottom nav stay full width.
- Why: desktop visitors (for example partners and venues checking you out) see a tidy app, not giant cropped images.
- Effort S–M · Risk low.

**Loading: skeletons vs spinners (fits with 7).** The Feed page and home rails already show grey placeholder cards ("skeletons") while loading, which is good (`feeds-skeleton-390.png`). Many other places show only the word "Loading…": profile overlay tabs, notifications, followers list, bookings, and Feed infinite scroll. Reusing the same skeleton card there is a quick follow-on (S, low risk).

---

## What I'd do first
1. **#3 tap targets plus #4 contrast**: small changes, every user feels them, and they make the app easier for everyone to use.
2. **#1 and #2 post card header and photo counter**: the Feed is where people spend time, and the mock-up is ready.
3. **#9 event card hierarchy**: this has the biggest effect on whether people buy tickets.

## What I couldn't check
- **Real data.** The network is blocked here, so Supabase and the API failed. I filled event and post cards with made-up examples by calling the page's own card builders. Your real content may have longer or shorter text.
- **Real fonts.** Google Fonts didn't load, so Syne, Bebas Neue and DM Sans show as fallback fonts. Line breaks will differ slightly from the live site.
- **Signed-in views.** That includes the Me tab, bookings, the profile overlay, the event detail panel, comments, notifications and squads.
- **The map tab.** Mapbox was offline. None of these ideas touch markers anyway.
- **Real Android hardware.** Speed, battery use and sunlight readability were not tested on an actual phone.
