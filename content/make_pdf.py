# -*- coding: utf-8 -*-
"""Dependency-free PDF generator for the Pulsefy Week 1 production pack."""
import zlib, textwrap

PAGE_W, PAGE_H = 595.28, 841.89  # A4 points
ML, MR, MT, MB = 54, 54, 56, 54
CONTENT_W = PAGE_W - ML - MR

PURPLE = (0.42, 0.18, 0.71)
ORANGE = (1.0, 0.48, 0.10)
INK = (0.11, 0.11, 0.16)
MUTED = (0.42, 0.42, 0.48)
BG = (0.965, 0.955, 1.0)
BORDER = (0.89, 0.87, 0.94)

def esc(s):
    return s.replace("\\", r"\\").replace("(", r"\(").replace(")", r"\)")

# approx char width factor per font (fraction of font size)
HELV = 0.52
COUR = 0.60  # courier is monospace ~0.6

def wrap(text, font_factor, size, width):
    max_chars = max(8, int(width / (size * font_factor)))
    out = []
    for para in text.split("\n"):
        if para.strip() == "":
            out.append("")
            continue
        out.extend(textwrap.wrap(para, max_chars) or [""])
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

    def set_fill(self, c):
        self.ops.append(f"{c[0]:.3f} {c[1]:.3f} {c[2]:.3f} rg")

    def set_stroke(self, c):
        self.ops.append(f"{c[0]:.3f} {c[1]:.3f} {c[2]:.3f} RG")

    def rect(self, x, y, w, h, fill=None, stroke=None, lw=0.8):
        if fill:
            self.set_fill(fill)
            self.ops.append(f"{x:.2f} {y:.2f} {w:.2f} {h:.2f} re f")
        if stroke:
            self.set_stroke(stroke)
            self.ops.append(f"{lw} w")
            self.ops.append(f"{x:.2f} {y:.2f} {w:.2f} {h:.2f} re S")

    def text(self, x, y, s, font="F1", size=10.5, color=INK):
        self.set_fill(color)
        self.ops.append("BT")
        self.ops.append(f"/{font} {size} Tf")
        self.ops.append(f"1 0 0 1 {x:.2f} {y:.2f} Tm")
        self.ops.append(f"({esc(s)}) Tj")
        self.ops.append("ET")

    # ---- high level blocks ----
    def gap(self, h=8):
        self.y -= h

    def h1(self, s):
        self.need(40)
        self.gap(6)
        # purple bar
        self.set_fill(PURPLE)
        for line in wrap(s, HELV, 17, CONTENT_W):
            self.need(24)
            self.text(ML, self.y - 15, line, font="F2", size=17, color=PURPLE)
            self.y -= 22
        # orange underline
        self.rect(ML, self.y + 4, CONTENT_W, 2.2, fill=ORANGE)
        self.y -= 10

    def h2(self, s):
        self.need(28)
        self.gap(8)
        for line in wrap(s, HELV, 13, CONTENT_W):
            self.need(20)
            self.text(ML, self.y - 12, line, font="F2", size=13, color=PURPLE)
            self.y -= 18
        self.y -= 2

    def body(self, s, color=INK, size=10.5, font="F1"):
        for line in wrap(s, HELV, size, CONTENT_W):
            self.need(16)
            self.text(ML, self.y - size, line, font=font, size=size, color=color)
            self.y -= size + 4
        self.y -= 3

    def bullet(self, s):
        size = 10.5
        lines = wrap(s, HELV, size, CONTENT_W - 16)
        for i, line in enumerate(lines):
            self.need(15)
            if i == 0:
                self.text(ML + 4, self.y - size, "•", font="F2", size=size, color=ORANGE)
            self.text(ML + 16, self.y - size, line, font="F1", size=size, color=INK)
            self.y -= size + 3
        self.y -= 2

    def label(self, s):
        self.need(16)
        self.text(ML + 8, self.y - 9, s.upper(), font="F2", size=9, color=PURPLE)
        self.y -= 15

    def codeblock(self, s, title=None):
        size = 9.5
        lh = size + 3
        lines = wrap(s, COUR, size, CONTENT_W - 24)
        title_h = 16 if title else 0
        total = len(lines) * lh + 18 + title_h
        # if block won't fit and isn't huge, push to new page
        if self.y - total < MB and total < (PAGE_H - MT - MB):
            self.new_page()
        self.gap(4)
        top = self.y
        # we draw background after measuring; draw incrementally instead
        start_y = self.y
        # reserve: draw bg rectangle now using total (may slightly overshoot across page; acceptable since we pushed)
        box_h = min(total, self.y - MB)
        self.rect(ML, self.y - box_h, CONTENT_W, box_h, fill=BG, stroke=BORDER)
        # left accent
        self.rect(ML, self.y - box_h, 3.5, box_h, fill=ORANGE)
        self.y -= 12
        if title:
            self.text(ML + 14, self.y - 9, title.upper(), font="F2", size=8.5, color=PURPLE)
            self.y -= 16
        for line in lines:
            if self.y - lh < MB:
                self.new_page()
                self.rect(ML, MB, CONTENT_W, self.y - MB, fill=BG, stroke=BORDER)
                self.rect(ML, MB, 3.5, self.y - MB, fill=ORANGE)
                self.y -= 8
            self.text(ML + 14, self.y - size, line, font="F3", size=size, color=INK)
            self.y -= lh
        self.y -= 12

    def table(self, rows, widths):
        # rows: list of [c1,c2,c3]; first row header. widths fractions sum to 1
        size = 9.0
        lh = size + 2.5
        cols = [CONTENT_W * w for w in widths]
        for r, row in enumerate(rows):
            cell_lines = []
            for ci, cell in enumerate(row):
                cw = cols[ci] - 10
                cell_lines.append(wrap(cell, HELV, size, cw))
            rh = max(len(cl) for cl in cell_lines) * lh + 8
            if self.y - rh < MB:
                self.new_page()
            top = self.y
            # backgrounds
            if r == 0:
                self.rect(ML, top - rh, CONTENT_W, rh, fill=BG, stroke=BORDER)
            else:
                self.rect(ML, top - rh, CONTENT_W, rh, fill=None, stroke=BORDER)
            # vertical separators + text
            x = ML
            for ci, cl in enumerate(cell_lines):
                yy = top - 4
                hdr = (r == 0)
                col = PURPLE if hdr else INK
                fnt = "F2" if hdr else "F1"
                if ci == 0 and not hdr:
                    col = ORANGE; fnt = "F2"
                for line in cl:
                    self.text(x + 5, yy - size, line, font=fnt, size=size, color=col)
                    yy -= lh
                x += cols[ci]
                if ci < len(cols) - 1:
                    self.set_stroke(BORDER)
                    self.ops.append("0.6 w")
                    self.ops.append(f"{x:.2f} {top:.2f} m {x:.2f} {top-rh:.2f} l S")
            self.y -= rh
        self.y -= 6

    def hero(self, title, subtitle):
        h = 64
        self.rect(ML, self.y - h, CONTENT_W, h, fill=PURPLE)
        self.rect(ML + CONTENT_W*0.62, self.y - h, CONTENT_W*0.38, h, fill=ORANGE)
        self.text(ML + 16, self.y - 28, title, font="F2", size=16, color=(1,1,1))
        for i, line in enumerate(wrap(subtitle, HELV, 9.5, CONTENT_W - 32)):
            self.text(ML + 16, self.y - 44 - i*12, line, font="F1", size=9.5, color=(1,1,1))
        self.y -= h + 14

    # ---- output ----
    def build(self):
        objs = []
        font_objs = {
            "F1": b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
            "F2": b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>",
            "F3": b"<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>",
        }
        n_pages = len(self.pages)
        # object numbering: 1 catalog, 2 pages, then per page (content+page), then fonts
        page_obj_ids = []
        content_obj_ids = []
        oid = 3
        for _ in self.pages:
            content_obj_ids.append(oid); oid += 1
            page_obj_ids.append(oid); oid += 1
        font_ids = {}
        for k in ["F1", "F2", "F3"]:
            font_ids[k] = oid; oid += 1

        def obj(i, body):
            objs.append((i, body))

        obj(1, b"<< /Type /Catalog /Pages 2 0 R >>")
        kids = " ".join(f"{pid} 0 R" for pid in page_obj_ids)
        obj(2, f"<< /Type /Pages /Count {n_pages} /Kids [{kids}] >>".encode())

        for idx, ops in enumerate(self.pages):
            stream = "\n".join(ops).encode("latin-1", "replace")
            comp = zlib.compress(stream)
            cid = content_obj_ids[idx]
            body = b"<< /Length %d /Filter /FlateDecode >>\nstream\n" % len(comp) + comp + b"\nendstream"
            obj(cid, body)
            fonts = " ".join(f"/{k} {font_ids[k]} 0 R" for k in font_ids)
            page = (f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {PAGE_W:.2f} {PAGE_H:.2f}] "
                    f"/Resources << /Font << {fonts} >> >> /Contents {cid} 0 R >>").encode()
            obj(page_obj_ids[idx], page)

        for k, i in font_ids.items():
            obj(i, font_objs[k])

        objs.sort()
        out = b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n"
        offsets = {}
        for i, body in objs:
            offsets[i] = len(out)
            out += f"{i} 0 obj\n".encode() + body + b"\nendobj\n"
        xref_pos = len(out)
        max_id = max(offsets) + 1
        out += f"xref\n0 {max_id}\n".encode()
        out += b"0000000000 65535 f \n"
        for i in range(1, max_id):
            out += f"{offsets[i]:010d} 00000 n \n".encode()
        out += f"trailer\n<< /Size {max_id} /Root 1 0 R >>\nstartxref\n{xref_pos}\n%%EOF".encode()
        return out


def build_doc():
    d = PDF()
    d.hero("Pulsefy News Desk - Week 1 Production Pack",
           "Two ready-to-shoot scripts | 30-60 sec each | TikTok / Reels / Shorts | Purple & orange aesthetic")

    d.body("Note: the brief says \"Pulsefy\"; the live product is \"Pulsify\". Lock ONE spelling everywhere before posting. This pack uses Pulsefy as written.", color=MUTED, size=9.5)

    d.h2("What's in here")
    for b in [
        "Reusable intro & outro (record once, reuse every episode).",
        "Video 1 - Map Drop: Florida Road (Thursday).",
        "Video 2 - Spotlight: Eyadini Lounge, Umlazi (Sunday).",
        "For each: full anchor dialogue, timing, on-screen text, B-roll cues, captions & hashtags.",
        "HeyGen + CapCut assembly checklist.",
    ]:
        d.bullet(b)

    # Reusable
    d.h1("Reusable Intro & Outro (record once)")
    d.codeblock(
        "[Breaking-news sting + flash]\n"
        "ANCHOR: \"Good evening Durban - you're watching the Pulsefy News Desk. Let's get into it.\"",
        title="Standard Intro ~3 sec")
    d.codeblock(
        "ANCHOR: (turns to camera) \"That's tonight's pulse.\n"
        "Want YOUR event or venue on this desk? It's free - link in bio.\n"
        "Pulsefy. Find your vibe.\"\n"
        "[Logo sting]",
        title="Standard Outro / CTA ~5 sec - your supply-side engine")

    # VIDEO 1
    d.h1("VIDEO 1 - MAP DROP: Florida Road")
    d.body("Segment: Map Drop  |  Thursday drop  |  Target length ~40 sec", color=MUTED, size=9.5)
    d.table([
        ["Time", "Anchor dialogue", "On screen (desk screen)"],
        ["0:00-0:03", "INTRO (reusable above)", "Anchor at desk, logo flash"],
        ["0:03-0:10", "\"Tonight on the map - Florida Road, Morningside. The street that's basically one long invitation.\"", "Screen-record: Pulsefy map zooming into Morningside"],
        ["0:10-0:22", "\"We dropped three pins. Pin one: rooftop drinks. Pin two: live music. Pin three... we lost count after the third lounge. The map nearly caught a vibe and walked off on its own.\"", "Map: 3 pins drop one by one + 2-sec B-roll of each"],
        ["0:22-0:33", "\"This is the whole point - open Pulsefy, see what's near you, pick your spot before your friends pick the wrong one.\"", "Phone mockup: tap a pin -> venue card opens"],
        ["0:33-0:40", "OUTRO + CTA (reusable)", "Anchor to camera, logo sting"],
    ], widths=[0.14, 0.52, 0.34])

    d.codeblock(
        "Good evening Durban - you're watching the Pulsefy News Desk. Let's get into it.\n\n"
        "Tonight on the map - Florida Road, Morningside. The street that's basically one long invitation.\n\n"
        "We dropped three pins. Pin one: rooftop drinks. Pin two: live music. Pin three... we honestly lost count after the third lounge. The map nearly caught a vibe and walked off on its own.\n\n"
        "This is the whole point - open Pulsefy, see what's near you, pick your spot before your friends pick the wrong one.\n\n"
        "That's tonight's pulse. Want your event or venue on this desk? It's free - link in bio. Pulsefy. Find your vibe.",
        title="Video 1 - Full dialogue only (paste into HeyGen)")

    d.codeblock(
        "We put Florida Road on the desk. 3 pins. 1 street. Endless excuses to go out. Where are you starting your night?\n"
        "#Durban #FloridaRoad #DurbanNightlife #Morningside #Pulsefy #DurbanEvents #Kzn #ThingsToDoInDurban #DurbanLife #SouthAfrica",
        title="Video 1 - Caption + hashtags")

    d.body("B-roll for Video 1: rooftop bar / cocktail pour, small live band or dancing crowd, neon street at night. Sources: Pexels & Pixabay (\"rooftop bar\", \"live music crowd\", \"city night street\"). Best of all: film 5-10 sec of the real Florida Road yourself.", color=INK, size=9.5)

    # VIDEO 2
    d.h1("VIDEO 2 - SPOTLIGHT: Eyadini Lounge")
    d.body("Segment: Spotlight  |  Sunday drop  |  Target length ~45 sec", color=MUTED, size=9.5)
    d.table([
        ["Time", "Anchor dialogue", "On screen (desk screen)"],
        ["0:00-0:03", "INTRO (reusable)", "Anchor at desk, logo flash"],
        ["0:03-0:12", "\"Tonight's Spotlight: Eyadini Lounge, deep in Umlazi. A shisanyama that has seen more legends than a heritage museum.\"", "Eyadini flyer / exterior + map pin on Umlazi"],
        ["0:12-0:26", "\"Here's the report: the meat is also legendary. The vibe? Sunday chills, cars parked like a motor show, a crowd that dresses up just to eat well. This is not a meal - it's an event.\"", "B-roll: braai/meat sizzling, crowd, parked cars, laughter"],
        ["0:26-0:38", "\"If 'where should we link up Sunday' is a debate in your group chat - consider it settled. Open Pulsefy, find the pin, thank us later.\"", "Phone mockup: Eyadini pin -> card -> Get directions"],
        ["0:38-0:45", "OUTRO + CTA (reusable)", "Anchor to camera, logo sting"],
    ], widths=[0.14, 0.52, 0.34])

    d.codeblock(
        "Good evening Durban - you're watching the Pulsefy News Desk. Let's get into it.\n\n"
        "Tonight's Spotlight: Eyadini Lounge, deep in Umlazi. A shisanyama that has seen more legends than a heritage museum.\n\n"
        "Here's the report: the meat is also legendary. The vibe? Sunday chills, cars parked like a motor show, and a crowd that dresses up just to eat well. This is not a meal - it's an event.\n\n"
        "If \"where should we link up Sunday\" is a debate in your group chat - consider it settled. Open Pulsefy, find the pin, thank us later.\n\n"
        "That's tonight's pulse. Want your event or venue on this desk? It's free - link in bio. Pulsefy. Find your vibe.",
        title="Video 2 - Full dialogue only (paste into HeyGen)")

    d.codeblock(
        "SPOTLIGHT: Eyadini Lounge, Umlazi. More legends than a museum... and the meat is also legendary. Settle the group-chat debate - your Sunday plug is sorted. Find the pin on Pulsefy.\n"
        "#Eyadini #Umlazi #Shisanyama #Durban #DurbanFood #Braai #KZN #DurbanLife #SundayVibes #Pulsefy #SouthAfrica",
        title="Video 2 - Caption + hashtags")

    d.body("B-roll for Video 2: meat on the braai close-ups, lively outdoor crowd, nice cars, people eating & laughing. Sources: Pexels & Pixabay (\"braai\", \"barbecue meat\", \"outdoor party crowd\"). Keep it flattering - Eyadini isn't an onboarded partner yet, so report facts and good vibes, never criticism.", color=INK, size=9.5)

    # Assembly
    d.h1("HeyGen + CapCut Assembly Checklist")
    for b in [
        "1. Anchor: paste the \"dialogue only\" block into HeyGen -> generate talking-anchor clip (young, cheeky, purple blazer / orange tie).",
        "2. CapCut layout: anchor on left ~40% of frame; rounded \"screen\" rectangle on right ~55% for flyers / map / B-roll.",
        "3. Map footage: screen-record the live Pulsefy map zooming to Durban + pins. Your most valuable shot - it proves the product works.",
        "4. Captions: CapCut Auto-Captions ON (most people watch muted). Purple text, orange highlight.",
        "5. Sound: breaking-news sting at intro (Mixkit), low music bed under dialogue (CapCut free library).",
        "6. Export: 1080x1920, 30fps. Post Thu 18:00-20:00 (TikTok) / Sun 11:00-13:00 (IG).",
        "7. First hour: reply to every comment - comment velocity drives reach.",
    ]:
        d.bullet(b)

    d.body("Reminder: verify any event date within 48h of posting, keep satire WITH people not AT them (punch at situations: group-chat debates, parking, outfit panic), and DM any venue you feature with the view count - that screenshot is your sales pitch to onboard them.", color=MUTED, size=9.5)

    return d.build()


if __name__ == "__main__":
    data = build_doc()
    with open("/home/user/Pulsify/content/pulsefy_week1_scripts.pdf", "wb") as f:
        f.write(data)
    print("PDF written:", len(data), "bytes")
