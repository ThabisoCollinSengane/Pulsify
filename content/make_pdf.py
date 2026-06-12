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
    d.hero("Pulsefy News Desk - Full Playbook",
           "Part 1: Week 1 scripts | Part 2: production, image prompts, lip-sync, voice, animation maps")

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

    # =====================================================================
    # PART 2 - PRODUCTION & EDITING PLAYBOOK
    # =====================================================================
    d.h1("PART 2 - PRODUCTION & EDITING PLAYBOOK")

    d.h2("Your master scene")
    d.body("You have ONE finished studio scene (anchor bottom-left, clear of the screen; Durban coastline window; rich DURBAN / KZN screen with events + map pins; Zulu shield on the desk). Save it as pulsefy_master_scene.png and REUSE it every episode. You never re-position the anchor again - that job is done.", size=10)

    d.h2("The layer model (CapCut)")
    d.body("Think of every episode as a stack of layers. Only the screen-content layer changes week to week:", size=10)
    for b in [
        "Layer 1 - Background: the master scene (reused every episode).",
        "Layer 2 - Screen content: this week's flyer / map screen-recording / B-roll, sized to sit inside the screen area (right side, over the map). THIS is the only layer you swap.",
        "Layer 3 - Talking head: short lip-sync clips of the anchor for intro + outro only.",
        "Layer 4 - Segment label: small SPOTLIGHT / MAP DROP tag (made in Canva).",
        "Layer 5 - Captions: CapCut auto-captions.",
        "Layer 6 - Audio: your voiceover (voice-changed) + music + news sting.",
    ]:
        d.bullet(b)

    d.h2("Per-episode edits (about 6, most take seconds)")
    d.table([
        ["#", "Edit", "Effort"],
        ["1", "Drop in the master scene as background", "5 sec (reused)"],
        ["2", "Overlay your video / flyer onto the screen zone", "~2 min"],
        ["3", "Record your voiceover", "real-time"],
        ["4", "Apply AI voice change (CapCut Voice Changer)", "~30 sec"],
        ["5", "Lip-sync the intro + outro clips (Hedra) + drop in", "~5 min"],
        ["6", "Auto-captions + music + news sting, then export", "~3 min"],
    ], widths=[0.08, 0.62, 0.30])
    d.body("Realistically ~10-15 min per video once you've done one or two.", color=MUTED, size=9.5)

    # IMAGE PROMPTS
    d.h1("IMAGE PROMPTS (paste into ChatGPT)")
    d.body("Note: AI image tools often misspell text on shirts/screens. If PULSEFY comes out wrong, generate the shirt plain and add the real logo in Canva/CapCut. Spell it exactly: P-U-L-S-E-F-Y.", color=MUTED, size=9.5)

    d.codeblock(
        "Create a vertical 9:16 news studio scene, rich and detailed, premium 3D-cartoon "
        "style, deep purple (#6B2FB5) and vibrant orange (#FF7A1A) lighting.\n\n"
        "- TOP 60%: a large glowing studio screen with a purple-orange neon bezel and a "
        "header reading \"PULSEFY NEWS DESK\". Inside the screen: the aerial Durban coastline "
        "with Moses Mabhida Stadium as the backdrop, a \"DURBAN - KWAZULU-NATAL\" title, an "
        "\"UPCOMING EVENTS\" panel on the left with icons, and a glowing map of the KZN coast "
        "on the right with location pins labelled Umlazi, Durban North, Morningside, Durban "
        "CBD, Amanzimtoti. Include small South African flags. Rich and full.\n"
        "- BOTTOM 40%: a young South African male anchor, mid-20s, short fade, light beard, "
        "warm cheeky smile, seated behind a sleek reflective desk on the LEFT side, his body "
        "BELOW the screen and NOT overlapping it. White t-shirt with a pink circular logo and "
        "the word \"PULSEFY\". Small clip-on mic. A Zulu shield-and-spears ornament on the "
        "desk. Purple desk under-glow.\n\n"
        "Keep it rich and detailed. Anchor must not cover the screen. Vertical 9:16.",
        title="A. Rich vertical scene (TikTok / Reels twin of your horizontal master)")

    d.codeblock(
        "Using the news anchor character from this image as reference, create a clean "
        "front-facing close-up portrait of the SAME man - same face, same short fade haircut, "
        "same light beard, same warm slightly cheeky smile, same skin tone.\n\n"
        "Framing: head and shoulders, facing the camera directly, looking into the lens, "
        "mouth relaxed and slightly open (ready to speak), eyes open.\n"
        "Wardrobe: the same white t-shirt with the pink circular logo and the word "
        "\"PULSEFY\".\n"
        "Background: a simple, smooth dark-purple studio blur (no text, no screen, no "
        "objects) so he can be cut out easily.\n"
        "Lighting: soft, even, professional studio lighting on the face.\n"
        "Style: same polished 3D-cartoon look as the reference.\n\n"
        "Vertical portrait orientation, sharp focus on the face.",
        title="B. Solo close-up portrait (your reusable talking-head for lip-sync)")

    d.codeblock(
        "Remove the \"Stan Sanetra\" text watermark in the top-left corner of this photo. "
        "Fill that area cleanly with matching sky and ocean so it looks natural and "
        "untouched. Do not change anything else in the image - keep the beachfront, stadium, "
        "city and colours exactly the same. Output the full image at the same dimensions.",
        title="C. Remove the photographer's signature (rights cleared by Stan Sanetra)")

    d.codeblock(
        "Recreate this exact news studio scene, keeping everything the same: the left window "
        "showing the aerial Durban coastline with Moses Mabhida Stadium, the right screen with "
        "the \"DURBAN - KWAZULU-NATAL\" title, the \"UPCOMING EVENTS\" panel, the glowing map "
        "with location pins, the South African flags, the purple-and-orange lighting, the desk "
        "and the Zulu shield ornament.\n\n"
        "Change ONLY this: move the male anchor to the LOWER-LEFT of the frame, seated behind "
        "the desk, so his head and body are clearly BELOW the screen and do NOT cover the "
        "events panel or the map. Keep his face, hairstyle, beard, smile and white \"PULSEFY\" "
        "t-shirt exactly the same. Everything else stays identical. 16:9 horizontal.",
        title="D. Move the anchor aside on your rich HORIZONTAL scene")

    d.body("Putting the Durban photo on the screen: use CapCut (non-destructive), NOT a full-image AI regen - that can change the anchor's face between episodes. In CapCut: Overlay -> Add overlay -> import the watermark-removed photo -> resize it to sit inside the screen area -> lower opacity to ~90 percent so it reads like a display.", size=10)

    # TALKING ANCHOR
    d.h1("TALKING ANCHOR - LIPS & MOTION")
    d.body("Honest truth: lips are easy, hands are hard. Free tools lip-sync a still image well, but none reliably animate gesturing hands. Do not let hands hold up your launch.", size=10)
    d.body("The trick: you only animate the 3-5 seconds he is actually on camera (intro line + outro CTA). The middle of the video is screen content + B-roll + voiceover, with the anchor NOT in frame. That cuts the work by ~80 percent.", size=10)
    d.h2("Lip-sync apps (pick one - start with Hedra)")
    d.table([
        ["App", "What it does", "Free?"],
        ["Hedra (start here)", "Photo + your audio -> lip-sync + natural head/upper-body motion", "Free tier"],
        ["D-ID", "Photo + audio -> clean lip-sync (face only)", "Free trial credits"],
        ["HeyGen (Talking Photo)", "Photo + audio -> talking avatar", "Free tier (watermark)"],
        ["Vidnoz", "Free AI talking photo", "Free tier"],
    ], widths=[0.26, 0.56, 0.18])
    for b in [
        "1. Use the solo close-up portrait (Prompt B) - lip-sync tools work best on a clear single face, not a busy wide scene.",
        "2. Feed portrait + your voiceover audio into Hedra -> it lip-syncs and adds slight head motion.",
        "3. In CapCut, drop the talking clip over the studio scene for the intro/outro moments only.",
    ]:
        d.bullet(b)
    d.body("Hands gesturing (optional, later): use an image-to-video tool - Kling AI or Hailuo (MiniMax), both free tiers. Feed the scene + a prompt like \"the anchor talks and gestures naturally.\" Trade-off: more credits, slower, AI hands can glitch. Skip for now.", color=MUTED, size=9.5)

    # VOICE
    d.h1("VOICEOVER + AI VOICE CHANGE")
    d.body("You speak the lines yourself, then change your voice so the anchor sounds like a different presenter. No extra app needed - CapCut has a built-in Voice Changer.", size=10)
    for b in [
        "Record your voice in CapCut (Audio -> Record) or import it.",
        "Select the audio clip -> tap Voice changer -> pick an effect until it sounds like a different presenter.",
        "Split out the intro audio and outro audio - those two pieces feed Hedra for lip-sync.",
        "Upgrade option (later): ElevenLabs free tier has a realistic speech-to-speech voice changer.",
    ]:
        d.bullet(b)

    # ANIMATION MAPS
    d.h1("ANIMATION MAPS")
    d.body("Rule: his face is only on screen when HE is talking (lip-sync). The moment it is pure voiceover, cut to the screen/B-roll fullscreen - so there is never a static face with a moving voice.", size=10)
    d.h2("Video 1 - Map Drop (~40s) - only ~10 sec animated")
    d.table([
        ["Time", "On screen", "Animate?"],
        ["0:00-0:03", "Anchor close-up - intro line", "YES - lip-sync (~3 sec)"],
        ["0:03-0:33", "Pulsefy map zoom + pins + B-roll", "No - voiceover only, anchor NOT in frame"],
        ["0:33-0:40", "Anchor close-up - outro + CTA", "YES - lip-sync (~7 sec)"],
    ], widths=[0.16, 0.52, 0.32])
    d.h2("Video 2 - Eyadini Spotlight (~45s) - only ~10 sec animated")
    d.table([
        ["Time", "On screen", "Animate?"],
        ["0:00-0:03", "Anchor close-up - intro line", "YES - lip-sync (~3 sec)"],
        ["0:03-0:38", "Eyadini flyer + braai B-roll + map pin", "No - voiceover only, anchor NOT in frame"],
        ["0:38-0:45", "Anchor close-up - outro + CTA", "YES - lip-sync (~7 sec)"],
    ], widths=[0.16, 0.52, 0.32])

    # FREE APPS
    d.h1("FREE APP STACK (R0 / month)")
    d.table([
        ["App", "Use"],
        ["CapCut", "Main editor: overlay, captions, voice changer, zoom motion, export"],
        ["Canva", "Logo PNG, segment labels, screen graphics, flyers"],
        ["ChatGPT", "Studio scene + solo portrait + photo edits"],
        ["Hedra / D-ID", "Lip-sync the intro + outro talking-head clips"],
        ["Pexels + Pixabay", "Free B-roll: braai, crowds, nightlife, Durban aerials"],
        ["Mixkit", "Free news sting + music bed"],
        ["Kling / Hailuo (optional)", "Image-to-video for gesturing shots (later)"],
    ], widths=[0.30, 0.70])

    d.h2("Photo rights")
    d.body("The Durban aerial belongs to photographer Stan Sanetra, who cleared it for free use and allowed removing his signature. Keep a record of that permission. For any future photo you do not own, either get written permission, use free-commercial stock (Pexels/Pixabay), or generate your own - never strip a watermark you have not been given rights to remove.", size=10)

    # WEEKLY CHECKLIST
    d.h1("WEEKLY CHECKLIST (per video)")
    for b in [
        "Pick the segment + write/confirm the script (use the Week 1 pack).",
        "Record voiceover -> apply CapCut Voice Changer -> export audio.",
        "Lip-sync intro + outro audio in Hedra using the solo portrait.",
        "Screen-record the live Pulsefy map / gather the flyer + B-roll.",
        "CapCut: master scene -> lip-sync intro -> screen content (voiceover) -> lip-sync outro.",
        "Auto-captions (purple/orange) + music + news sting.",
        "Export 1080x1920, 30fps. Post Thu 18:00-20:00 (TikTok) / Sun 11:00-13:00 (IG).",
        "First hour: reply to every comment. DM any venue you featured the view count.",
    ]:
        d.bullet(b)

    return d.build()


if __name__ == "__main__":
    data = build_doc()
    with open("/home/user/Pulsify/content/pulsefy_week1_scripts.pdf", "wb") as f:
        f.write(data)
    print("PDF written:", len(data), "bytes")
