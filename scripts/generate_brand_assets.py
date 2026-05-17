#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Generate Pulsefy brand assets: favicon, logo, OG image, apple-touch-icon."""

import os
from PIL import Image, ImageDraw, ImageFilter, ImageFont

OUT = os.path.join(os.path.dirname(__file__), "..", "apps", "landing-page")

# Brand palette
BG       = (5, 8, 15)        # --bg
BG2      = (12, 4, 30)       # darker purple haze
OR       = (255, 92, 0)      # --or
PK       = (255, 45, 120)    # --pk
PU       = (176, 38, 255)    # --pu
TX       = (240, 238, 248)   # --tx
MU       = (153, 151, 176)   # --mu2

FONT_BOLD = "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf"
FONT_REG  = "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf"


def vertical_gradient(size, top, bottom):
    """Smooth vertical gradient image."""
    w, h = size
    img = Image.new("RGB", size, top)
    px = img.load()
    for y in range(h):
        t = y / max(h - 1, 1)
        r = int(top[0] + (bottom[0] - top[0]) * t)
        g = int(top[1] + (bottom[1] - top[1]) * t)
        b = int(top[2] + (bottom[2] - top[2]) * t)
        for x in range(w):
            px[x, y] = (r, g, b)
    return img


def radial_glow(size, center, radius, color, intensity=180):
    """Soft circular glow centered at point."""
    layer = Image.new("RGBA", size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    cx, cy = center
    # draw concentric solid circles from largest (faintest) to smallest (densest)
    steps = 40
    for i in range(steps, 0, -1):
        t = i / steps                     # 1.0 -> 0.02
        r = max(1, int(radius * t))       # outer-to-inner radius
        a = int(intensity * (1 - t) ** 1.6)
        d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=color + (a,))
    return layer.filter(ImageFilter.GaussianBlur(radius=max(2, radius // 6)))


def pulse_dot(size, dot_radius, glow_radius):
    """Render the orange pulse dot with glow on a transparent layer."""
    w, h = size
    layer = Image.new("RGBA", size, (0, 0, 0, 0))
    cx, cy = w // 2, h // 2
    # Outer pink halo
    halo = radial_glow(size, (cx, cy), glow_radius, PK, intensity=120)
    layer = Image.alpha_composite(layer, halo)
    # Inner orange glow
    glow = radial_glow(size, (cx, cy), int(glow_radius * 0.7), OR, intensity=210)
    layer = Image.alpha_composite(layer, glow)
    # Solid dot
    d = ImageDraw.Draw(layer)
    d.ellipse(
        (cx - dot_radius, cy - dot_radius, cx + dot_radius, cy + dot_radius),
        fill=OR + (255,),
    )
    # Highlight
    hl = int(dot_radius * 0.45)
    d.ellipse(
        (cx - hl, cy - hl - hl // 2, cx + hl // 3, cy - hl // 2 + hl // 3),
        fill=(255, 200, 160, 200),
    )
    return layer


def gen_favicon(path, px):
    """Square icon: dark bg + pulse dot."""
    bg = vertical_gradient((px, px), BG, BG2)
    dot_layer = pulse_dot((px, px), dot_radius=int(px * 0.22), glow_radius=int(px * 0.45))
    out = Image.alpha_composite(bg.convert("RGBA"), dot_layer)
    out.convert("RGB").save(path, "PNG", optimize=True)
    print(f"  wrote {path} ({px}x{px})")


def gen_apple_touch(path):
    """180x180 with rounded look (iOS auto-masks)."""
    gen_favicon(path, 180)


def gen_logo(path):
    """512x512 logo with text."""
    px = 512
    bg = vertical_gradient((px, px), BG, BG2)
    out = bg.convert("RGBA")
    # Pulse dot at top
    dot_layer = pulse_dot((px, px), dot_radius=int(px * 0.08), glow_radius=int(px * 0.22))
    # shift dot up by composite into larger frame
    shifted = Image.new("RGBA", (px, px), (0, 0, 0, 0))
    shifted.paste(dot_layer, (0, -int(px * 0.18)), dot_layer)
    out = Image.alpha_composite(out, shifted)
    # Wordmark
    d = ImageDraw.Draw(out)
    font = ImageFont.truetype(FONT_BOLD, int(px * 0.18))
    txt = "PULSEFY"
    bbox = d.textbbox((0, 0), txt, font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    d.text(((px - tw) / 2, int(px * 0.58)), txt, font=font, fill=TX + (255,))
    # subtle tagline
    font_s = ImageFont.truetype(FONT_REG, int(px * 0.05))
    sub = "Feel the Vibe"
    bbox = d.textbbox((0, 0), sub, font=font_s)
    sw = bbox[2] - bbox[0]
    d.text(((px - sw) / 2, int(px * 0.78)), sub, font=font_s, fill=MU + (255,))
    out.convert("RGB").save(path, "PNG", optimize=True)
    print(f"  wrote {path} (512x512)")


def gen_og_image(path):
    """1200x630 share card."""
    w, h = 1200, 630
    bg = vertical_gradient((w, h), BG, BG2)
    out = bg.convert("RGBA")

    # Big diagonal accent — purple-to-pink glow blob (top-right)
    blob1 = radial_glow((w, h), (w - 120, 100), 380, PU, intensity=110)
    out = Image.alpha_composite(out, blob1)
    blob2 = radial_glow((w, h), (160, h - 100), 320, OR, intensity=100)
    out = Image.alpha_composite(out, blob2)

    # Pulse dot — left side
    dot_size = 220
    dot_layer = pulse_dot((dot_size, dot_size), dot_radius=58, glow_radius=110)
    out.paste(dot_layer, (96, h // 2 - dot_size // 2 - 30), dot_layer)

    # Text block — right of dot
    d = ImageDraw.Draw(out)
    x0 = 96 + dot_size + 28
    # Wordmark
    font_big = ImageFont.truetype(FONT_BOLD, 120)
    d.text((x0, 178), "PULSEFY", font=font_big, fill=TX + (255,))
    # Tagline
    font_mid = ImageFont.truetype(FONT_BOLD, 42)
    d.text((x0 + 4, 318), "Feel the Vibe \U0001F1FF\U0001F1E6", font=font_mid, fill=OR + (255,))
    # Subtitle
    font_sub = ImageFont.truetype(FONT_REG, 28)
    d.text(
        (x0 + 4, 378),
        "South Africa's live event\ndiscovery platform",
        font=font_sub,
        fill=MU + (255,),
        spacing=8,
    )

    # Bottom bar
    bar_y = h - 64
    d.rectangle((0, bar_y, w, h), fill=(0, 0, 0, 120))
    font_url = ImageFont.truetype(FONT_BOLD, 24)
    d.text((40, bar_y + 18), "pulsefy.co.za", font=font_url, fill=TX + (220,))
    font_tag = ImageFont.truetype(FONT_REG, 22)
    bbox = d.textbbox((0, 0), "Events · Tickets · Nightlife", font=font_tag)
    tw = bbox[2] - bbox[0]
    d.text(
        (w - tw - 40, bar_y + 20),
        "Events  ·  Tickets  ·  Nightlife",
        font=font_tag,
        fill=MU + (255,),
    )

    out.convert("RGB").save(path, "PNG", optimize=True)
    print(f"  wrote {path} (1200x630)")


def main():
    print(f"Output dir: {os.path.abspath(OUT)}")
    gen_favicon(os.path.join(OUT, "favicon.png"), 32)
    gen_favicon(os.path.join(OUT, "favicon-192.png"), 192)
    gen_apple_touch(os.path.join(OUT, "apple-touch-icon.png"))
    gen_logo(os.path.join(OUT, "logo.png"))
    gen_og_image(os.path.join(OUT, "og-image.png"))
    print("done.")


if __name__ == "__main__":
    main()
