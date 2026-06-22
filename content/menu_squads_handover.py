# -*- coding: utf-8 -*-
"""Dependency-free PDF handover for Pulsify Menu & Squads UI."""
import zlib, textwrap

PAGE_W, PAGE_H = 595.28, 841.89
ML, MR, MT, MB = 54, 54, 56, 54
CW = PAGE_W - ML - MR

PURPLE = (0.42, 0.18, 0.71)
ORANGE = (1.0,  0.36, 0.00)
CYAN   = (0.00, 0.71, 1.00)
INK    = (0.11, 0.11, 0.16)
MUTED  = (0.38, 0.38, 0.45)
LIGHT  = (0.60, 0.60, 0.68)
BG     = (0.96, 0.95, 1.00)
SURF   = (0.98, 0.97, 1.00)
WARN   = (1.00, 0.90, 0.85)
GREEN  = (0.10, 0.60, 0.42)
BORDER = (0.88, 0.86, 0.93)

def esc(s):
    return s.replace("\\","\\\\").replace("(","\\(").replace(")","\\)")

def wrap(text, pts, width, mono=False):
    factor = 0.60 if mono else 0.52
    mc = max(8, int(width / (pts * factor)))
    out = []
    for para in text.split("\n"):
        if para.strip() == "":
            out.append("")
        else:
            out.extend(textwrap.wrap(para, mc) or [""])
    return out

class PDF:
    def __init__(self):
        self.pages = []
        self.new_page()

    def new_page(self):
        self.ops = []
        self.y = PAGE_H - MT
        self.pages.append(self.ops)

    def need(self, h):
        if self.y - h < MB:
            self.new_page()

    def sf(self, c): self.ops.append(f"{c[0]:.3f} {c[1]:.3f} {c[2]:.3f} rg")
    def ss(self, c): self.ops.append(f"{c[0]:.3f} {c[1]:.3f} {c[2]:.3f} RG")

    def rect(self, x, y, w, h, fill=None, stroke=None, lw=0.6):
        if fill:   self.sf(fill);   self.ops.append(f"{x:.2f} {y:.2f} {w:.2f} {h:.2f} re f")
        if stroke: self.ss(stroke); self.ops.append(f"{lw} w {x:.2f} {y:.2f} {w:.2f} {h:.2f} re S")

    def line(self, x1, y1, x2, y2, c=BORDER, lw=0.5):
        self.ss(c); self.ops.append(f"{lw} w {x1:.2f} {y1:.2f} m {x2:.2f} {y2:.2f} l S")

    def text(self, x, y, s, size=10, bold=False, color=INK, font="Helv"):
        fname = ("Helvetica-Bold" if bold else "Helvetica") if font == "Helv" else ("Courier-Bold" if bold else "Courier")
        self.sf(color)
        self.ops.append(f"BT /{fname} {size} Tf {x:.2f} {y:.2f} Td ({esc(s)}) Tj ET")

    def para(self, text, size=9.5, bold=False, color=INK, indent=0, line_h=None, mono=False):
        lh = line_h or size * 1.55
        lines = wrap(text, size, CW - indent, mono=mono)
        for ln in lines:
            self.need(lh)
            self.text(ML + indent, self.y, ln, size, bold, color, font="Cour" if mono else "Helv")
            self.y -= lh
        return len(lines) * lh

    def h1(self, t):
        self.need(36)
        self.rect(ML - 4, self.y - 3, CW + 8, 26, fill=PURPLE)
        self.text(ML, self.y + 7, t, 14, bold=True, color=(1,1,1))
        self.y -= 30

    def h2(self, t):
        self.need(28)
        self.rect(ML - 4, self.y - 2, CW + 8, 20, fill=BG, stroke=BORDER)
        self.line(ML - 4, self.y + 18, ML + 3, self.y + 18, c=ORANGE, lw=3)
        self.text(ML + 4, self.y + 4, t, 11, bold=True, color=PURPLE)
        self.y -= 24

    def h3(self, t):
        self.need(20)
        self.text(ML, self.y, t, 10, bold=True, color=ORANGE)
        self.y -= 14

    def gap(self, h=8): self.y -= h

    def bullet(self, text, color=INK, size=9):
        lh = size * 1.5
        self.need(lh * 2)
        lines = wrap(text, size, CW - 14)
        self.text(ML + 2, self.y, "-", size, color=ORANGE)
        for i, ln in enumerate(lines):
            self.need(lh)
            self.text(ML + 14, self.y, ln, size, color=color)
            self.y -= lh

    def code(self, t):
        lh = 9 * 1.4
        lines = wrap(t, 8.5, CW - 16, mono=True)
        h = lh * len(lines) + 10
        self.need(h)
        self.rect(ML - 4, self.y - h + lh + 4, CW + 8, h, fill=(0.08, 0.10, 0.16), stroke=(0.20,0.22,0.30))
        for ln in lines:
            self.text(ML + 4, self.y, ln, 8.5, color=(0.78, 0.95, 0.60), font="Cour")
            self.y -= lh
        self.y -= 6

    def info_box(self, title, lines_list, bg=WARN, border=ORANGE):
        h = 16 + len(lines_list) * 13 + 6
        self.need(h)
        self.rect(ML - 4, self.y - h + 16, CW + 8, h, fill=bg, stroke=border, lw=0.8)
        self.text(ML + 2, self.y, title, 9, bold=True, color=ORANGE)
        self.y -= 14
        for ln in lines_list:
            self.text(ML + 8, self.y, ln, 8.5, color=INK)
            self.y -= 12
        self.y -= 4

    def table_row(self, cols, widths, header=False, shade=False):
        lh = 12
        self.need(lh + 6)
        x = ML
        bg = PURPLE if header else (BG if shade else None)
        if bg: self.rect(ML - 4, self.y - 3, CW + 8, lh + 4, fill=bg)
        for col, w in zip(cols, widths):
            clr = (1,1,1) if header else INK
            self.text(x + 3, self.y + 1, col[:int(w/5.5)], 8.5, bold=header, color=clr)
            x += w
        self.y -= lh + 4

    def build(self, path):
        fonts = {
            "Helvetica": 1, "Helvetica-Bold": 2,
            "Courier":   3, "Courier-Bold":   4,
        }
        objs = [None]  # 1-indexed; obj 0 unused

        def add(o): objs.append(o); return len(objs) - 1

        # font objects
        for name, _ in sorted(fonts.items(), key=lambda x: x[1]):
            add(f"<< /Type /Font /Subtype /Type1 /BaseFont /{name} /Encoding /WinAnsiEncoding >>")

        font_dict = " ".join(f"/F{v} {fonts[k]} 0 R" for k, v in fonts.items())
        res_id = add(f"<< /Font << {font_dict} >> >>")

        page_ids = []
        for ops in self.pages:
            stream = "\n".join(ops).encode("latin-1", errors="replace")
            comp   = zlib.compress(stream)
            sid = add(None)   # placeholder
            pid = add(None)
            objs[sid] = (f"<< /Length {len(comp)} /Filter /FlateDecode >>", comp)
            objs[pid] = (f"<< /Type /Page /MediaBox [0 0 {PAGE_W:.2f} {PAGE_H:.2f}]"
                         f" /Contents {sid} 0 R /Resources {res_id} 0 R >>", None)
            page_ids.append(pid)

        kids = " ".join(f"{p} 0 R" for p in page_ids)
        pages_id = add(f"<< /Type /Pages /Kids [{kids}] /Count {len(page_ids)} >>")
        cat_id   = add(f"<< /Type /Catalog /Pages {pages_id} 0 R >>")

        buf = [b"%PDF-1.4\n"]
        offsets = [0] * (len(objs) + 1)
        for i, obj in enumerate(objs[1:], 1):
            offsets[i] = sum(len(b) for b in buf)
            if isinstance(obj, tuple):
                hdr, stream = obj
                if stream is not None:
                    buf += [f"{i} 0 obj\n".encode(), hdr.encode(), b"\nstream\n", stream, b"\nendstream\nendobj\n"]
                else:
                    buf += [f"{i} 0 obj\n{hdr}\nendobj\n".encode()]
            else:
                buf += [f"{i} 0 obj\n{obj}\nendobj\n".encode()]

        xref_pos = sum(len(b) for b in buf)
        xref = f"xref\n0 {len(objs)}\n0000000000 65535 f \n"
        xref += "".join(f"{offsets[i]:010d} 00000 n \n" for i in range(1, len(objs)))
        buf += [xref.encode(),
                f"trailer\n<< /Size {len(objs)} /Root {cat_id} 0 R >>\nstartxref\n{xref_pos}\n%%EOF\n".encode()]

        with open(path, "wb") as f:
            for b in buf: f.write(b if isinstance(b, bytes) else b.encode())
        print(f"Written: {path}")


# ─────────────────────────────────────────────────────────────────
#  DOCUMENT CONTENT
# ─────────────────────────────────────────────────────────────────
p = PDF()

# ── COVER PAGE ──────────────────────────────────────────────────
p.rect(0, 0, PAGE_W, PAGE_H, fill=(0.05, 0.06, 0.10))
p.rect(0, PAGE_H - 6, PAGE_W, 6, fill=PURPLE)
p.rect(0, 0, PAGE_W, 6, fill=ORANGE)

p.y = 620
p.text(ML, p.y, "PULSIFY", 36, bold=True, color=PURPLE)
p.y -= 44
p.text(ML, p.y, "Menu & Squads UI", 22, bold=True, color=(1,1,1))
p.y -= 30
p.text(ML, p.y, "Redesign Handover Document", 14, color=ORANGE)
p.y -= 50

p.rect(ML - 4, p.y - 2, CW + 8, 1, fill=ORANGE)
p.y -= 18

desc_lines = [
    "This document describes the current state of the Menu UI (customer ordering",
    "and business management) and the Squads UI (squad deals, deal detail, and",
    "squad workspace). It is intended as a handover brief so you can redesign",
    "these areas using any tool or assistant of your choice.",
]
for ln in desc_lines:
    p.text(ML, p.y, ln, 10, color=(0.78, 0.78, 0.88))
    p.y -= 15

p.y -= 30
fields = [
    ("Date",     "22 June 2026"),
    ("Codebase", "ThabisoCollinSengane/Pulsify"),
    ("Stack",    "Vanilla JS  /  Supabase  /  Vercel"),
    ("Focus",    "Menu UI  +  Squads UI"),
]
for label, val in fields:
    p.text(ML, p.y, f"{label}:", 9, bold=True, color=ORANGE)
    p.text(ML + 80, p.y, val, 9, color=(0.82, 0.82, 0.92))
    p.y -= 14


# ── PAGE 2 — TABLE OF CONTENTS ───────────────────────────────────
p.new_page()
p.rect(ML - 4, p.y - 3, CW + 8, 28, fill=PURPLE)
p.text(ML, p.y + 8, "TABLE OF CONTENTS", 14, bold=True, color=(1,1,1))
p.y -= 36

toc = [
    ("1", "Menu UI — Customer Side",            "3"),
    ("",  "  1.1  How to reach the menu",       "3"),
    ("",  "  1.2  Menu item card layout",        "3"),
    ("",  "  1.3  Cart bar",                     "4"),
    ("",  "  1.4  Order form overlay",           "4"),
    ("",  "  1.5  Order confirmation + QR",      "4"),
    ("",  "  1.6  My Orders tab",                "5"),
    ("2", "Menu UI — Business Side",             "5"),
    ("",  "  2.1  Menu management tab",          "5"),
    ("",  "  2.2  Add / Edit item sheet",        "6"),
    ("",  "  2.3  Order management",             "6"),
    ("",  "  2.4  Real-time order feed",         "7"),
    ("3", "Squads UI",                           "7"),
    ("",  "  3.1  Squad deals strip (Discover)", "7"),
    ("",  "  3.2  Deal card layout",             "8"),
    ("",  "  3.3  Deal detail page",             "8"),
    ("",  "  3.4  Action button logic",          "9"),
    ("",  "  3.5  Squad workspace tabs",         "9"),
    ("4", "Key Constraints for Redesign",        "10"),
    ("5", "File & Function Reference",           "10"),
]
for num, title, pg in toc:
    p.need(14)
    bold = bool(num)
    c = PURPLE if bold else INK
    dots = "." * max(2, int((CW - 20) / 4.5) - len(title) - len(pg))
    p.text(ML, p.y, f"{'  ' if not num else ''}{title}", 9.5, bold=bold, color=c)
    p.text(ML + CW - 18, p.y, pg, 9.5, color=MUTED)
    p.y -= 13


# ── PAGE 3 — SECTION 1: MENU UI CUSTOMER ─────────────────────────
p.new_page()
p.h1("1. Menu UI — Customer Side")
p.gap(4)

p.para(
    "The customer-facing menu lets users browse a venue's food/drink items, "
    "add them to a cart, place a pickup order, and receive a QR code as proof "
    "of purchase. The order is then scanned by the venue to mark it collected.",
    size=9.5, color=MUTED
)
p.gap(10)

p.h2("1.1  How to Reach the Menu")
p.bullet("Home feed or Discover tab  →  tap a Business card  →  tap 'Menu' tab (2nd tab in business profile panel)")
p.bullet("Squad deal with a business_id  →  tap 'Order with Squad'  →  business profile opens, menu auto-loads")
p.gap(6)
p.info_box("Current pain point", [
    "The Menu tab is not visible by default — users must know to tap it.",
    "There is no menu preview on the business card in the feed.",
    "First-time users often miss the tab strip entirely.",
])
p.gap(8)

p.h2("1.2  Menu Item Card Layout")
p.para("Each menu item renders as a horizontal row inside a category group:", color=MUTED, size=9)
p.gap(4)
p.code(
    "[ 60x60 image OR emoji ]  [ Name (bold)      ]  [ + ]\n"
    "                           [ Description      ]\n"
    "                           [ R price (orange) ]"
)
p.gap(4)
p.bullet("Items are grouped by category (Starters / Mains / Sides / Desserts / Drinks / Specials)")
p.bullet("Category header is a small uppercase label, no visual separation between groups")
p.bullet("If no image, a placeholder emoji is shown — same for all items with no image")
p.bullet("The + button is 28x28px, orange border, calls _cartAdd(itemId)")
p.bullet("There is NO quantity picker per item — each tap adds 1 unit")
p.bullet("No 'Remove from cart' button on the item — only the cart bar shows total")
p.gap(6)
p.info_box("Current pain point", [
    "No visual hierarchy between categories — looks like a flat list.",
    "No item quantity control at the item level (must re-tap + multiple times).",
    "No 'Remove' or '-' button visible on the card.",
    "Images are often missing, making all items look the same.",
])
p.gap(8)

p.h2("1.3  Cart Bar")
p.para("A sticky bar appears at the bottom of the menu panel when >= 1 item is in the cart:", color=MUTED, size=9)
p.gap(4)
p.code("[ Syringe cart icon ]  'Place Order -- R0.00'  (full-width gradient button)")
p.gap(4)
p.bullet("Shows running total but NOT the item count or item names")
p.bullet("Tapping opens the order form overlay")
p.bullet("No way to see or edit cart contents without placing the order")
p.gap(6)
p.info_box("Current pain point", [
    "No cart preview — users can't review what they added.",
    "Accidentally added wrong item: no way to remove it.",
    "The bar covers the last menu item if the list is long.",
])


# ── PAGE 4 ────────────────────────────────────────────────────────
p.new_page()
p.h2("1.4  Order Form Overlay")
p.para("Full-screen modal with plain input fields (dark background, no steps):", color=MUTED, size=9)
p.gap(4)
p.code(
    "Full Name *\n"
    "Phone number *\n"
    "Email (optional)\n"
    "Preferred pickup time (free-text, e.g. 1:30pm)\n"
    "Special instructions (textarea)\n"
    "[ Cancel ]   [ Place Order ]"
)
p.gap(4)
p.bullet("Email is optional — if provided, a confirmation email is sent via Resend")
p.bullet("There is no order summary inside the form — users forgot what they ordered")
p.bullet("Pickup time is a free-text field, not a time picker — inconsistent input")
p.bullet("No address field — it is always pickup (no delivery)")
p.gap(6)
p.info_box("Current pain point", [
    "No order summary inside the form.",
    "Free-text pickup time leads to messy data (1:30, 13:30, half 1, etc.).",
    "No step indicator — it looks like a form dump.",
    "Cancel button closes the overlay but does NOT clear the cart.",
])
p.gap(8)

p.h2("1.5  Order Confirmation + QR")
p.para("After a successful order, a full-screen overlay appears:", color=MUTED, size=9)
p.gap(4)
p.code(
    "  checkmark emoji (large)\n"
    "  'Order Confirmed'  (Bebas Neue, 1.6rem)\n"
    "  Business name  +  items summary\n"
    "\n"
    "  [ 200x200 QR CODE ]\n"
    "  (dark background, orange QR modules)\n"
    "\n"
    "  'Show this QR at [Venue] to collect.'\n"
    "  Ref: ORD-XXXXXXXX  |  R total\n"
    "\n"
    "  [ View in My Orders ]   [ Done ]"
)
p.gap(4)
p.bullet("QR payload = plain order_ref string (e.g. ORD-1750123456789-ABC)")
p.bullet("No Pulsify branding on the QR overlay — looks generic")
p.bullet("Tapping 'Done' closes; 'View in My Orders' switches to Orders sub-tab")
p.gap(6)
p.info_box("Current pain point", [
    "QR overlay looks functional but plain -- no venue branding.",
    "No 'Save to photos' or 'Share' option for the QR.",
    "If network drops after order, QR is still shown (good) but ref may not match.",
])


# ── PAGE 5 ────────────────────────────────────────────────────────
p.new_page()
p.h2("1.6  My Orders Tab  (Bookings -> Orders)")
p.para("The Orders sub-tab (inside the Bookings/Tickets tab) lists all pickup orders:", color=MUTED, size=9)
p.gap(4)
p.code(
    "Business name               [ STATUS BADGE ]\n"
    "Ref: ORD-XXXXXXXX\n"
    "2x Beef Ribs, 1x Amasi                 R150.00\n"
    "22 Jun 2026, 12:30\n"
    "---------------------------------------------\n"
    "[ 72x72 QR ]  'Show this QR at Zaba's to collect.'"
)
p.gap(4)
p.bullet("Status colours: pending=orange, confirmed=cyan, ready=lime (pulsing), completed=teal, cancelled=pink")
p.bullet("QR is shown for all statuses EXCEPT completed and cancelled")
p.bullet("Tapping the QR does nothing — it is just an image")
p.bullet("No way to cancel an order from the customer side")
p.gap(6)
p.info_box("Current pain point", [
    "72px QR is too small to scan comfortably on a phone screen.",
    "No 'enlarge QR' tap to fullscreen it.",
    "No order status update — user must manually pull-to-refresh.",
    "'Ready for pickup!' badge pulses but there is no audio/vibration.",
])
p.gap(10)

p.h1("2. Menu UI — Business Side")
p.gap(4)

p.h2("2.1  Menu Management Tab")
p.para("The Menu tab in the business dashboard shows a grid of item cards:", color=MUTED, size=9)
p.gap(4)
p.code(
    "[ + Add Item ]  button at top\n"
    "\n"
    "[ img ] Name          R price\n"
    "        Description\n"
    "        Category pill\n"
    "        [ Edit ]  [ Delete ]\n"
    "        (repeated for each item)"
)
p.gap(4)
p.bullet("Free plan: max 10 items (enforced by DB trigger check_menu_item_limit)")
p.bullet("Premium plan: unlimited items (subscription_type = 'premium' in profiles)")
p.bullet("Items are not sorted — they appear in insertion order")
p.bullet("No drag-to-reorder")
p.gap(6)
p.info_box("Current pain point", [
    "No category filtering -- all items shown in one flat list.",
    "No sort/reorder control.",
    "Free plan limit (10 items) is enforced silently -- no clear upsell UI.",
    "Edit button opens the same add-item sheet with fields pre-filled.",
])


# ── PAGE 6 ────────────────────────────────────────────────────────
p.new_page()
p.h2("2.2  Add / Edit Item Sheet")
p.para("A bottom sheet slides up with the following fields:", color=MUTED, size=9)
p.gap(4)
p.code(
    "Item Name       *  (text)\n"
    "Description        (textarea)\n"
    "Price (R)       *  (number)\n"
    "Category           (select: Starters/Mains/Sides/Desserts/Drinks/Specials)\n"
    "Photo              (file input, max 5MB, jpg/png/webp)\n"
    "                   [existing image preserved via hidden mi-existing-img]\n"
    "\n"
    "[ Cancel ]   [ Save Item ]"
)
p.gap(4)
p.bullet("Image uploaded to Supabase Storage bucket 'menu-images'")
p.bullet("Existing image URL preserved on edit via hidden input (mi-existing-img)")
p.bullet("No image cropping or preview before upload")
p.bullet("No multi-image support — one image per item")
p.bullet("No allergen / dietary tags (vegetarian, halal, gluten-free, etc.)")
p.gap(6)
p.info_box("Current pain point", [
    "Sheet looks like a plain form -- no visual hierarchy.",
    "No live price preview or formatting (e.g. R 25.00).",
    "Category is a plain HTML <select> -- looks out of place in the dark UI.",
    "No allergen or dietary tags to help customers.",
])
p.gap(8)

p.h2("2.3  Order Management  (Business Orders Tab)")
p.para("A list of all pickup orders with filter chips (All / Pending / Ready / Completed):", color=MUTED, size=9)
p.gap(4)
p.code(
    "[ All ]  [ Pending ]  [ Ready ]  [ Completed ]  [ Cancelled ]\n"
    "\n"
    "ORD-XXXXXXXX        [ Pending ]\n"
    "John Doe  |  072-555-5555\n"
    "2x Beef Ribs, 1x Amasi          R150.00\n"
    "Pickup: 1:30pm\n"
    "[ Mark Confirmed ]  [ Mark Ready ]  [ Mark Completed ]\n"
    "[ Cancel Order ]\n"
    "\n"
    "(repeated)"
)
p.gap(4)
p.bullet("Status flow: pending -> confirmed -> ready -> completed (or cancelled at any step)")
p.bullet("'Mark Ready' sends an in-app notification to the customer (if logged in)")
p.bullet("'Mark Completed' is also triggered by scanning the customer QR in the scanner tab")
p.bullet("No print / export of orders")
p.gap(6)
p.info_box("Current pain point", [
    "Buttons (Confirm / Ready / Complete / Cancel) all look the same.",
    "No time-since-order indicator -- hard to prioritise urgent orders.",
    "No notes / special instructions visible without scrolling.",
    "Completed orders stay in the list forever -- no archive/pagination.",
])


# ── PAGE 7 ────────────────────────────────────────────────────────
p.new_page()
p.h2("2.4  Real-Time Order Feed")
p.para("New orders now appear live via Supabase Realtime (added in this session):", color=MUTED, size=9)
p.gap(4)
p.code(
    "Supabase channel: 'biz_orders_{bizId}'\n"
    "Event: INSERT on pickup_orders where business_id = bizId\n"
    "-> Prepends new order to ORDERS array\n"
    "-> Re-renders order list + stats + home preview\n"
    "-> Shows toast: 'New order -- John Doe . R150.00'"
)
p.gap(4)
p.bullet("No sound/vibration alert -- only a toast and badge update")
p.bullet("Existing orders do NOT update in real-time (status changes require manual refresh)")
p.gap(6)
p.info_box("Current pain point", [
    "No audio alert for new orders -- easy to miss on a busy night.",
    "Status changes (confirmed/ready) not pushed back to the UI.",
])
p.gap(10)

p.h1("3. Squads UI")
p.gap(4)

p.h2("3.1  Squad Deals Strip  (Discover Tab)")
p.para(
    "The Discover tab has a horizontal scroll strip labelled 'Squad Deals' "
    "placed between the businesses row and the events grid. "
    "It is populated from the /squad-promos endpoint (admin-featured deals only).",
    color=MUTED, size=9
)
p.gap(6)
p.code(
    "Discover tab layout:\n"
    "  [ Category chips: All / Shisanyama / Restaurants / Bars / ... ]\n"
    "  [ Near Me / 5km / 10km / 25km chips ]\n"
    "  [ Businesses horizontal scroll ]\n"
    "  ----\n"
    "  Squad Deals                         Open Squads ->\n"
    "  [ Deal card 230px ] [ Deal card 230px ] ...\n"
    "  ----\n"
    "  Events   (grid)"
)
p.gap(6)
p.info_box("Current pain point", [
    "The strip is easily missed -- it is below the businesses row and above events.",
    "The 'Open Squads ->' link takes users to the squad social sheet, not the deals.",
    "No indicator of how many deals are available.",
    "If no deals are featured by admin, the strip is completely hidden.",
])


# ── PAGE 8 ────────────────────────────────────────────────────────
p.new_page()
p.h2("3.2  Deal Card Layout  (Horizontal Scroll)")
p.para("Each deal card is 230px wide, inside the horizontal scroll strip:", color=MUTED, size=9)
p.gap(4)
p.code(
    "+--------------------------------+\n"
    "| [icon]  DEAL TYPE LABEL        |  <- coloured header band\n"
    "+--------------------------------+\n"
    "| Deal Title                     |\n"
    "| R price  or  FREE              |\n"
    "| for X-Y people                 |\n"
    "| Venue name  |  City            |\n"
    "| Valid days                     |\n"
    "+--------------------------------+"
)
p.gap(4)
p.bullet("Deal types: food (orange), drinks (purple), event (cyan), vip (gold), activity (lime)")
p.bullet("Card has a coloured top band matching the deal type")
p.bullet("No image on the card -- text only")
p.bullet("Tapping the card calls openDealDetail(promoId)")
p.gap(6)
p.info_box("Current pain point", [
    "No image -- all deal cards look identical except for the header colour.",
    "Deal title truncates at 2 lines with no ellipsis.",
    "No 'popular' or 'new' badge.",
    "Card does not show how many squads have claimed it.",
])
p.gap(8)

p.h2("3.3  Deal Detail Page")
p.para(
    "Tapping a deal card opens the deal detail inside the squad social sheet overlay "
    "(z-index 2600). The sheet slides up from the bottom.",
    color=MUTED, size=9
)
p.gap(4)
p.code(
    "< Back to Deals\n"
    "\n"
    "[icon]  DEAL TYPE LABEL\n"
    "Deal Title  (bold, 0.88rem)\n"
    "\n"
    "R250                  <- big price in deal colour\n"
    "total for 4-8 people  <- subdued\n"
    "\n"
    "Location . City . Valid Days . Group size\n"
    "\n"
    "Description (if set)\n"
    "\n"
    "[Squad member avatars + name]  (if in a squad)\n"
    "\n"
    "------- sticky bottom -------\n"
    "[ CTA Button: Order with Squad / Buy Tickets / Join Squad ]"
)
p.gap(4)
p.bullet("The CTA label changes based on whether the deal has a business_id or event_id")
p.bullet("No deal image, no photos, no map preview of the venue")
p.bullet("Description renders as plain text -- no formatting")
p.gap(6)
p.info_box("Current pain point", [
    "The detail page feels like raw data -- no visual hero section.",
    "No venue image or map.",
    "Squad member section only shows if user is already in a squad.",
    "Non-squad users see a generic 'Join Squad to Claim' button with no explanation.",
])


# ── PAGE 9 ────────────────────────────────────────────────────────
p.new_page()
p.h2("3.4  Action Button Logic")
p.para("The sticky CTA button in the deal detail has three states:", color=MUTED, size=9)
p.gap(6)

p.table_row(["Condition", "Button Label", "Behaviour"], [200, 150, 137], header=True)
p.table_row(["deal.business_id is set", "Order with Squad", "Opens biz profile + Menu tab"], [200, 150, 137], shade=True)
p.table_row(["deal.event_id is set", "Buy Tickets with Squad", "Opens event detail panel"], [200, 150, 137])
p.table_row(["Neither is set", "Join Squad to Claim", "Calls sqJoinDeal() (web share)"], [200, 150, 137], shade=True)

p.gap(8)
p.info_box("Current pain point", [
    "The 'Join Squad to Claim' fallback calls the web share API -- unexpected.",
    "Users without a squad get no feedback on what 'joining' means.",
    "The business/event link is invisible -- users do not know where they will go.",
    "No confirmation or summary before navigating away from the deal.",
])
p.gap(10)

p.h2("3.5  Squad Workspace Tabs")
p.para(
    "The squad social sheet (z-index 2600) slides up from bottom and contains "
    "a squad selector at the top, then four tabs for the selected squad:",
    color=MUTED, size=9
)
p.gap(4)
p.code(
    "[ Squad name selector / switcher ]\n"
    "\n"
    "  [ Members ]  [ Deals ]  [ Chat ]  [ Plans ]\n"
    "\n"
    "Members tab:\n"
    "  Avatar + name list of all squad members\n"
    "  Invite button (searches following list)\n"
    "\n"
    "Deals tab:\n"
    "  List of squad_promos for the squad's city\n"
    "  Each deal shows title, price, action button\n"
    "  Tapping opens the deal detail inside the sheet\n"
    "\n"
    "Chat tab:\n"
    "  Simple message list (last 40 messages)\n"
    "  Text input + send -- no media, no reactions\n"
    "\n"
    "Plans tab:\n"
    "  Outing plans (type, title, date, venue, notes)\n"
    "  Create plan form with outing type pills"
)
p.gap(4)
p.bullet("All four tabs load data on demand; switching tabs re-fetches each time")
p.bullet("Chat messages are NOT real-time -- user must switch away and back to refresh")
p.bullet("Squad selector at top shows all squads the user belongs to")
p.gap(6)
p.info_box("Current pain point", [
    "Chat is not real-time -- no Supabase Realtime channel wired up for messages.",
    "The sheet takes up full height but the tabs are small and easy to mis-tap.",
    "No unread message badge on the Chat tab.",
    "Members list has no role indicators (admin vs member).",
    "Plans tab is feature-complete but almost invisible to users.",
])


# ── PAGE 10 ────────────────────────────────────────────────────────
p.new_page()
p.h1("4. Key Constraints for the Redesign")
p.gap(6)

p.para(
    "These constraints MUST be preserved in any redesign -- they are hard rules "
    "or backend contracts that cannot be changed without backend work.",
    color=MUTED, size=9
)
p.gap(8)

constraints = [
    ("Cart data",       "Stored in window._bizCart (JS object). Only one business's items in cart at a time."),
    ("Item registry",   "window._menuItemReg[itemId] = item. The + button must only pass the item id, not name/price inline."),
    ("Order QR payload","Plain order_ref string (e.g. ORD-1750123456789-ABC). Do not change the format."),
    ("Menu item limit", "10 items for free plan -- enforced at DB level by trigger. Any add-item button must handle the 409-style error."),
    ("Squad deals API", "/squad-promos returns {promos:[...]}. promos have id, title, deal_type, business_id, event_id, etc."),
    ("Deal detail fetch","openDealDetail fetches /squad-promos (all) then .find() by id. If redesigning, add /squad-promos/:id endpoint instead."),
    ("Social sheet z",  "The squad overlay is z-index 2600. The business detail (biz-detail) is behind it at z-index lower. Do not change."),
    ("Apostrophe safety","Any name/string injected into onclick='...' JS args MUST use .replace(/'/g, \"\\\\'\"). Bugs here are silent."),
    ("Ticket tiers",    "is_free and sold_out are GENERATED columns in ticket_tiers. Never INSERT them."),
    ("Free plan limit", "DB trigger check_menu_item_limit references businesses.owner_id (NOT user_id). Fixed."),
]
for k, v in constraints:
    p.need(22)
    p.rect(ML - 4, p.y - 3, 110, 16, fill=BG, stroke=BORDER)
    p.text(ML, p.y + 1, k, 8, bold=True, color=PURPLE)
    lines = wrap(v, 8.5, CW - 120)
    for i, ln in enumerate(lines):
        p.text(ML + 116, p.y + 1 - i * 11, ln, 8.5, color=INK)
    p.y -= max(16, len(lines) * 11) + 5

p.gap(10)

p.h1("5. File & Function Reference")
p.gap(6)

p.table_row(["Area", "File", "Key function / element"], [100, 200, 187], header=True)
rows = [
    ("Menu (cust.)",  "apps/landing-page/index.html",  "loadBizMenu(), _cartAdd(), showPickupOrderForm()"),
    ("Menu (cust.)",  "apps/landing-page/index.html",  "submitPickupOrder(), showOrderConfirmation()"),
    ("Menu (cust.)",  "apps/landing-page/index.html",  "renderPickupOrders() -- Orders sub-tab"),
    ("Menu (biz)",    "apps/business/index.html",       "renderMenu(), submitMenuItem(), loadOrders()"),
    ("Menu (biz)",    "apps/business/index.html",       "updateOrderStatus(), markOrderCompleted()"),
    ("Menu (biz)",    "apps/business/index.html",       "handleQrResult() -- scanner result"),
    ("Squad deals",   "apps/landing-page/index.html",  "loadDiscoverSquadDeals() -- Discover strip"),
    ("Squad deals",   "apps/landing-page/index.html",  "openDealDetail() -- deal detail page"),
    ("Squad deals",   "apps/landing-page/index.html",  "_sqJoinFromDetail() -- CTA button handler"),
    ("Squad WS",      "apps/landing-page/index.html",  "renderSquadWorkspace() -- all 4 tabs"),
    ("Squad WS",      "apps/landing-page/index.html",  "showSqTab() -- Members/Deals/Chat/Plans"),
    ("API: orders",   "api/index.js",                  "POST /pickup-orders, GET /user/pickup-orders"),
    ("API: deals",    "api/index.js",                  "GET /squad-promos?highlight=1&city=..."),
    ("DB trigger",    "db/fix_check_menu_item_limit_trigger.sql", "check_menu_item_limit()"),
]
for i, (area, file_, func) in enumerate(rows):
    p.table_row([area, file_, func], [100, 200, 187], shade=(i % 2 == 0))

p.gap(10)
p.rect(ML - 4, p.y - 3, CW + 8, 1, fill=ORANGE)
p.y -= 10
p.para(
    "End of document. Generated by Pulsify Claude Code session — 22 June 2026.",
    size=8, color=LIGHT
)


# ── GENERATE ─────────────────────────────────────────────────────
p.build("content/menu_squads_handover.pdf")
