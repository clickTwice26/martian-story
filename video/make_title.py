#!/usr/bin/env python3
"""Render the 1920x1080 team intro card for the demo video (video/title.png)."""
import os, random
from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
T = os.path.join(HERE, "team")
W, H = 1920, 1080
AV = "/System/Library/Fonts/Avenir Next.ttc"
DIN = "/System/Library/Fonts/Supplemental/DIN Condensed Bold.ttf"

def font(path, size, index=0):
    return ImageFont.truetype(path, size, index=index)

# Avenir Next.ttc faces: 0 Bold, 2 Demi Bold, 5 Medium, 7 Regular (macOS order)
F_BOLD = lambda s: font(AV, s, 0)
F_DEMI = lambda s: font(AV, s, 2)
F_MED = lambda s: font(AV, s, 5)
F_REG = lambda s: font(AV, s, 7)

MEMBERS = [
    ("Shagato Chowdhury", "shagato.jpg"),
    ("Tamima Rahman Choity", "tamima.jpg"),
    ("Moitry Bhowmik Puja", "moitry.png"),
    ("Md. Raihanul Hasan", "raihan.png"),
    ("Saifullah Ibne Reza", "saif.jpg"),
    ("Umma Iman Monea", "umma.jpg"),
]

# ---- background: deep space, a Mars limb glow, stars
bg = Image.new("RGB", (W, H), (6, 7, 14))
glow = Image.new("RGB", (W, H), (0, 0, 0))
g = ImageDraw.Draw(glow)
g.ellipse((-500, 620, 2420, 2600), fill=(150, 62, 26))
glow = glow.filter(ImageFilter.GaussianBlur(120))
bg = Image.blend(bg, glow, 0.55)
d = ImageDraw.Draw(bg)
rnd = random.Random(7)
for _ in range(650):
    x, y = rnd.randrange(W), rnd.randrange(int(H * 0.8))
    b = rnd.randrange(90, 255)
    r = 1 if rnd.random() < 0.9 else 2
    d.ellipse((x, y, x + r, y + r), fill=(b, b, min(255, b + 15)))
# planet limb
limb = Image.new("L", (W, H), 0)
ImageDraw.Draw(limb).ellipse((-700, 860, 2620, 3400), fill=255)
mars = Image.new("RGB", (W, H), (178, 86, 44))
bg.paste(mars, (0, 0), limb.filter(ImageFilter.GaussianBlur(3)))
d = ImageDraw.Draw(bg)

def centred(text, y, f, fill, x0=0, x1=W, spacing=0):
    if spacing:
        widths = [d.textlength(c, font=f) for c in text]
        total = sum(widths) + spacing * (len(text) - 1)
        x = x0 + (x1 - x0 - total) / 2
        for c, w in zip(text, widths):
            d.text((x, y), c, font=f, fill=fill)
            x += w + spacing
    else:
        w = d.textlength(text, font=f)
        d.text((x0 + (x1 - x0 - w) / 2, y), text, font=f, fill=fill)

# ---- header
centred("NASA SPACE APPS CHALLENGE 2026  ·  CUMILLA, BANGLADESH", 70, F_DEMI(30), (251, 146, 60), spacing=3)
centred("TEAM BUTTERFLY", 118, font(DIN, 150), (248, 250, 252), spacing=6)
centred("presents", 268, F_REG(34), (203, 213, 225))

# ---- left: the team image, framed
team = Image.open(os.path.join(T, "team.png")).convert("RGB")
tw = 640
team = team.resize((tw, int(team.height * tw / team.width)), Image.LANCZOS)
tx, ty = 150, 350
shadow = Image.new("RGBA", (tw + 60, team.height + 60), (0, 0, 0, 0))
ImageDraw.Draw(shadow).rounded_rectangle((30, 30, tw + 30, team.height + 30), 24, fill=(0, 0, 0, 170))
bg.paste(shadow.filter(ImageFilter.GaussianBlur(18)), (tx - 30, ty - 20), shadow.filter(ImageFilter.GaussianBlur(18)))
mask = Image.new("L", team.size, 0)
ImageDraw.Draw(mask).rounded_rectangle((0, 0, tw, team.height), 22, fill=255)
bg.paste(team, (tx, ty), mask)
d.rounded_rectangle((tx - 3, ty - 3, tx + tw + 3, ty + team.height + 3), 24, outline=(251, 146, 60), width=3)

# ---- right: project title and members
rx = 900
d.text((rx, 352), "MARTIAN STORY", font=font(DIN, 96), fill=(253, 186, 116))
d.text((rx, 456), "A walkable map of Jezero Crater, built on real NASA data", font=F_MED(31), fill=(226, 232, 240))
d.text((rx, 500), "Challenge: Interplanetary Survival Guide — Martian Map", font=F_REG(26), fill=(148, 163, 184))

cols, cw, rh = 2, 470, 132
for i, (name, fn) in enumerate(MEMBERS):
    cx = rx + (i % cols) * cw
    cy = 575 + (i // cols) * rh
    av = Image.open(os.path.join(T, fn)).convert("RGB").resize((104, 104), Image.LANCZOS)
    m = Image.new("L", (104, 104), 0)
    ImageDraw.Draw(m).ellipse((0, 0, 103, 103), fill=255)
    d.ellipse((cx - 4, cy - 4, cx + 108, cy + 108), outline=(56, 189, 248), width=3)
    bg.paste(av, (cx, cy), m)
    d.text((cx + 126, cy + 34), name, font=F_DEMI(29), fill=(248, 250, 252))

out = os.path.join(HERE, "title.png")
bg.save(out)
print(out)
