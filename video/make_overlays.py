#!/usr/bin/env python3
"""Overlay cards for the demo video, in the NASA Space Apps website theme.

Writes video/ov/*.png (1920x1080 RGBA) + video/ov/timeline.json for
make_video2.py. Times are on the tour clock (s after the magenta sync flash)
and follow voice_script.md: WHO 0-45, WHY 45-105, WHAT 105-165, IMPACT 165+.
Rule: something is always on screen; no stretch of bare footage over 10 s.
"""
import json, os
from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
OV = os.path.join(HERE, "ov"); os.makedirs(OV, exist_ok=True)
FD = os.path.join(HERE, "fonts")
W, H = 1920, 1080

# Space Apps palette
DEEP, NAVY, ELEC, HERO = (7, 23, 63), (28, 36, 112), (0, 66, 166), (11, 79, 214)
YEL, RED, WHITE, SKY = (234, 254, 7), (228, 55, 0), (255, 255, 255), (186, 214, 255)
def F(w, s): return ImageFont.truetype(os.path.join(FD, f"FiraSans-{w}.ttf"), s)
def FC(s): return ImageFont.truetype(os.path.join(FD, "FiraSansCondensed-ExtraBold.ttf"), s)

def blank(): return Image.new("RGBA", (W, H), (0, 0, 0, 0))
def a(c, al=255): return (*c, al)

def shadow(im, box, r=20, off=10, alpha=150):
    sh = blank(); ImageDraw.Draw(sh).rounded_rectangle((box[0], box[1] + off, box[2], box[3] + off), r, fill=(0, 0, 0, alpha))
    im.alpha_composite(sh.filter(ImageFilter.GaussianBlur(16)))

def pill(d, x, y, text, f, bg=YEL, fg=DEEP, pad=14):
    w = d.textlength(text, font=f)
    d.rounded_rectangle((x, y, x + w + 2 * pad, y + f.size + 14), (f.size + 14) // 2, fill=a(bg))
    d.text((x + pad, y + 5), text, font=f, fill=a(fg))
    return w + 2 * pad

def lower(name, tag, title, sub=None, src=None):
    """Lower-third card: yellow tag pill, white title, sky-blue line, source line."""
    im = blank(); d = ImageDraw.Draw(im)
    tf, sf, gf, pf = F("ExtraBold", 50), F("Medium", 29), F("SemiBold", 23), F("Bold", 21)
    w = max(d.textlength(title, font=tf), d.textlength(sub or "", font=sf), d.textlength(("SOURCE  " + src) if src else "", font=gf)) + 84
    h = 92 + (50 if sub else 0) + (42 if src else 0) + 22
    x0, y0 = 70, H - h - 64
    shadow(im, (x0, y0, x0 + w, y0 + h))
    d = ImageDraw.Draw(im)
    d.rounded_rectangle((x0, y0, x0 + w, y0 + h), 18, fill=a(NAVY, 238))
    d.rounded_rectangle((x0, y0, x0 + 10, y0 + h), 5, fill=a(YEL))
    pill(d, x0 + 38, y0 - 20, tag, pf)
    y = y0 + 32
    d.text((x0 + 40, y), title, font=tf, fill=a(WHITE)); y += 64
    if sub: d.text((x0 + 40, y), sub, font=sf, fill=a(SKY)); y += 48
    if src:
        d.text((x0 + 40, y), "SOURCE", font=F("Bold", 20), fill=a(YEL))
        d.text((x0 + 40 + 88, y - 2), src, font=gf, fill=a(WHITE))
    im.save(os.path.join(OV, name + ".png")); return name

def section(name, label, title, sub):
    """Big section card (left band) for WHY / WHAT / IMPACT."""
    im = blank(); d = ImageDraw.Draw(im)
    tf, sf = F("ExtraBold", 74), F("Medium", 36)
    x0, y0, y1 = 0, 300, 780
    x1 = int(max(1000, d.textlength(title, font=tf) + 200, *(d.textlength(l, font=sf) + 200 for l in sub)))
    shadow(im, (x0 - 40, y0, x1, y1), r=0)
    band = Image.new("RGBA", (x1 - x0, y1 - y0), a(ELEC, 240))
    bd = ImageDraw.Draw(band)
    for r in (300, 460, 620):                              # site-style orbit arcs, clipped to the band
        bd.ellipse((band.width - 120 - r, band.height + 60 - r, band.width - 120 + r, band.height + 60 + r),
                   outline=(255, 255, 255, 46), width=2)
    im.alpha_composite(band, (x0, y0))
    d = ImageDraw.Draw(im)
    pill(d, 90, y0 + 60, label, F("Bold", 30))
    d.text((90, y0 + 140), title, font=F("ExtraBold", 74), fill=a(WHITE))
    yy = y0 + 250
    for line in sub:
        d.text((90, yy), line, font=F("Medium", 36), fill=a(SKY)); yy += 54
    im.save(os.path.join(OV, name + ".png")); return name

def hook(name):
    im = blank(); d = ImageDraw.Draw(im)
    f = F("ExtraBold", 96)
    l1, l2 = "What if you crashed on Mars", "with two hours of oxygen?"
    w1 = d.textlength(l1, font=f)
    shadow(im, ((W - w1) / 2 - 30, 372, (W + w1) / 2 + 30, 500))
    d = ImageDraw.Draw(im)
    d.rounded_rectangle(((W - w1) / 2 - 30, 372, (W + w1) / 2 + 30, 500), 14, fill=a(NAVY, 235))
    d.text(((W - w1) / 2, 380), l1, font=f, fill=a(WHITE))
    w2 = d.textlength(l2, font=f)
    d.rounded_rectangle(((W - w2) / 2 - 24, 510, (W + w2) / 2 + 24, 640), 14, fill=a(YEL))
    d.text(((W - w2) / 2, 515), l2, font=f, fill=a(DEEP))
    im.save(os.path.join(OV, name + ".png")); return name

def badge(name):
    """Persistent corner badge so the frame is never 'just the view'."""
    im = blank(); d = ImageDraw.Draw(im)
    f1, f2 = F("Bold", 22), F("ExtraBold", 30)
    x, y = W - 470, 44
    d.rounded_rectangle((x, y, W - 44, y + 86), 16, fill=a(NAVY, 225))
    d.rounded_rectangle((x, y, x + 10, y + 86), 5, fill=a(YEL))
    d.text((x + 30, y + 12), "TEAM BUTTERFLY · SPACE APPS 2026", font=f1, fill=a(YEL))
    d.text((x + 30, y + 40), "Martian Story · Jezero Crater", font=f2, fill=a(WHITE))
    im.save(os.path.join(OV, name + ".png")); return name

def team_card():
    im = Image.new("RGBA", (W, H), a(HERO)); d = ImageDraw.Draw(im)
    for i in range(H):                                       # deep -> electric gradient
        t = i / H
        d.line((0, i, W, i), fill=a(tuple(int(DEEP[k] * (1 - t) + HERO[k] * t) for k in range(3))))
    for r in (500, 760, 1020, 1280):
        d.ellipse((1500 - r, 1180 - r, 1500 + r, 1180 + r), outline=(255, 255, 255, 34), width=2)
    pill(d, 90, 70, "NASA SPACE APPS CHALLENGE 2026  ·  CUMILLA, BANGLADESH", F("Bold", 28))
    d.text((90, 140), "Team Butterfly", font=F("ExtraBold", 140), fill=a(WHITE))
    d.text((96, 318), "presents  ", font=F("Medium", 40), fill=a(SKY))
    d.text((96 + d.textlength("presents  ", font=F("Medium", 40)), 304), "Martian Story", font=F("ExtraBold", 56), fill=a(YEL))
    d.text((96, 382), "Challenge: Interplanetary Survival Guide — Martian Map", font=F("Medium", 32), fill=a(WHITE))
    T = os.path.join(HERE, "team")
    team = Image.open(os.path.join(T, "team.png")).convert("RGB")
    team = team.resize((560, int(team.height * 560 / team.width)), Image.LANCZOS)
    m = Image.new("L", team.size, 0); ImageDraw.Draw(m).rounded_rectangle((0, 0, *team.size), 20, fill=255)
    shadow(im, (1260, 120, 1260 + team.width, 120 + team.height))
    im.paste(team, (1260, 120), m)
    d = ImageDraw.Draw(im)
    d.rounded_rectangle((1256, 116, 1264 + team.width, 124 + team.height), 22, outline=a(YEL), width=4)
    members = [("Shagato Chowdhury", "shagato.jpg"), ("Tamima Rahman Choity", "tamima.jpg"),
               ("Moitry Bhowmik Puja", "moitry.png"), ("Md. Raihanul Hasan", "raihan.png"),
               ("Saifullah Ibne Reza", "saif.jpg"), ("Umma Iman Monea", "umma.jpg")]
    for i, (nm, fn) in enumerate(members):
        cx, cy = 90 + (i % 3) * 560, 520 + (i // 3) * 250
        d.rounded_rectangle((cx, cy, cx + 520, cy + 200), 22, fill=(7, 23, 63, 170))
        av = Image.open(os.path.join(T, fn)).convert("RGB").resize((140, 140), Image.LANCZOS)
        mk = Image.new("L", (140, 140), 0); ImageDraw.Draw(mk).ellipse((0, 0, 139, 139), fill=255)
        d.ellipse((cx + 26, cy + 26, cx + 174, cy + 174), fill=a(YEL))
        im.paste(av, (cx + 30, cy + 30), mk)
        first, *rest = nm.split(" ", 1) if not nm.startswith("Md.") else ["Md. Raihanul", "Hasan"]
        d.text((cx + 200, cy + 50), first, font=F("ExtraBold", 40), fill=a(WHITE))
        d.text((cx + 200, cy + 102), rest[0] if rest else "", font=F("Medium", 32), fill=a(SKY))
    im.convert("RGB").save(os.path.join(OV, "team_card.png"))

def credits():
    im = Image.new("RGBA", (W, H), a(DEEP)); d = ImageDraw.Draw(im)
    for r in (220, 340, 460):                              # arcs kept in the empty lower-right corner
        d.ellipse((1980 - r, 1180 - r, 1980 + r, 1180 + r), outline=(255, 255, 255, 30), width=2)
    pill(d, 90, 56, "CREDITS", F("Bold", 30))
    d.text((90, 110), "Built on NASA open data", font=F("ExtraBold", 66), fill=a(WHITE))
    cols = [
        ("NASA · USGS · JPL DATASETS", [
            "USGS Mars 2020 TRN HiRISE DTM (1 m/px)", "HiRISE orthomosaic, Mars 2020 TRN (25 cm)",
            "JPL/USGS CTX DEM + orthomosaic of Jezero", "MGS MOLA global DEM (463 m)",
            "Mars 2020 traverse & waypoints (NASA MMGIS)", "Mars 2020 MEDA weather (PDS Atmospheres)",
            "MRO CRISM MTRDR minerals (PDS Geosciences)", "Mars 2020 RIMFAX radargrams (PDS Geosciences)",
            "Mars 2020 raw images (Mastcam-Z, Navcam)", "Mars24 Sunclock algorithm (NASA GISS)",
            "NASA 3D models: Perseverance, Ingenuity"]),
        ("TEAM BUTTERFLY", ["Shagato Chowdhury", "Tamima Rahman Choity", "Moitry Bhowmik Puja",
                            "Md. Raihanul Hasan", "Saifullah Ibne Reza", "Umma Iman Monea"]),
        ("THIRD-PARTY & AI", ["three.js r160 (MIT) + example models", "Fira Sans font (OFL)",
                              "Code written with AI assistance:", "  Claude Code (Anthropic)",
                              "Narration: ElevenLabs (AI voice)", "All data shown is real NASA data",
                              "github.com/clickTwice26/martian-story"]),
    ]
    for (head, items), x, fs in zip(cols, (90, 900, 1360), (27, 30, 26)):
        d.text((x, 230), head, font=F("Bold", 24), fill=a(YEL))
        y = 280
        for it in items:
            d.text((x, y), it, font=F("Medium", fs), fill=a(WHITE)); y += fs + 22
    d.text((90, 990), "Thank you", font=F("ExtraBold", 44), fill=a(YEL))
    im.convert("RGB").save(os.path.join(OV, "credits.png"))

def chip(name, tag, title):
    """Small top-centre chip, used while the rover-data panel fills the middle."""
    im = blank(); d = ImageDraw.Draw(im)
    f1, f2 = F("Bold", 21), F("ExtraBold", 34)
    w = max(d.textlength(tag, font=f1) + 28, d.textlength(title, font=f2)) + 70
    x0 = (W - w) / 2
    shadow(im, (x0, 22, x0 + w, 116), off=6)
    d = ImageDraw.Draw(im)
    d.rounded_rectangle((x0, 22, x0 + w, 116), 16, fill=a(NAVY, 240))
    tw = d.textlength(tag, font=f1) + 28
    pill(d, (W - tw) / 2, 30, tag, f1)
    d.text(((W - d.textlength(title, font=f2)) / 2, 66), title, font=f2, fill=a(WHITE))
    im.save(os.path.join(OV, name + ".png")); return name

def badge_top(name):
    """Persistent badge, top centre (the tour hides the game's clock panel there)."""
    im = blank(); d = ImageDraw.Draw(im)
    f1, f2 = F("Bold", 19), F("ExtraBold", 27)
    w = 470; x0 = (W - w) / 2
    d.rounded_rectangle((x0, 22, x0 + w, 100), 16, fill=a(NAVY, 225))
    d.rounded_rectangle((x0, 22, x0 + 10, 100), 5, fill=a(YEL))
    d.text((x0 + 30, 32), "TEAM BUTTERFLY · SPACE APPS 2026", font=f1, fill=a(YEL))
    d.text((x0 + 30, 58), "Martian Story · Jezero Crater", font=f2, fill=a(WHITE))
    im.save(os.path.join(OV, name + ".png")); return name

# ---------------------------------------------------------------- timeline
# Cards sit on narration paragraphs (cues.json: start of each of the 16
# paragraphs), and inside a paragraph at the word where its subject is said.
import re as _re
CUES = json.load(open(os.path.join(OV, "cues.json")))
C, END = CUES["cues"] + [CUES["end"]], CUES["end"]
_txt = open(os.path.join(HERE, "voice_script.md")).read()
PARAS = [p.strip() for sec in _re.split(r"\n## ", _txt)[1:] for p in sec.split("\n", 1)[1].split("\n\n") if p.strip()]
def P(i): return C[i]
def at_word(i, phrase):
    """Time where `phrase` is spoken in paragraph i: exact from the transcript
    alignment when available, else by word position."""
    k = len(PARAS[i][:PARAS[i].index(phrase)].split())
    WT = CUES.get("words")
    if WT and k < len(WT[i]):
        return round(WT[i][k] - 0.1, 2)
    return round(C[i] + k / len(PARAS[i].split()) * (C[i + 1] - C[i]), 2)
SHOTS = {}                                                # handed to the tour with the cards
T = []
def at(name, t0, t1): T.append({"png": name + ".png", "t0": round(t0, 2), "t1": round(t1, 2)})
team_card(); credits()
badge_top("badge")

# WHO
at(hook("hook"), P(0) + 0.4, P(1) - 0.2)
at("team_card", P(1), P(3) - 0.1)                          # names + "six people, one goal"
at(lower("c_story", "OUR PROJECT", "Martian Story",
         "A walkable, survivable map of Jezero Crater", "Made from NASA open data · where Perseverance landed"), P(3) + 0.3, P(4) - 0.3)
# WHY
w_need = P(4) + 7.5
at(section("s_why", "WHY", "The challenge", ["Interplanetary Survival Guide:", "Martian Map"]), P(4), w_need)
at(lower("c_need", "THE PROBLEM", "Crews must know the ground before they land",
         "Safe slopes · what the rocks are made of · cold nights · air and water"), w_need + 0.2, P(5) - 0.3)
at(lower("c_have", "THE DATA EXISTS", "Jezero mapped in detail · 45 km driven",
         "But scattered across archives only specialists can open"), P(5) + 0.3, P(6) - 0.3)
at(lower("c_precise", "ONE CENTIMETRE APART", "−2569.92 m   vs   NASA −2569.91 m",
         "Our terrain at the Perseverance landing site", "USGS Mars 2020 TRN HiRISE DTM"), P(6) + 0.3, P(7) - 0.3)
at(lower("c_goal", "OUR GOAL", "Anyone can stand on that ground — and understand it",
         "Students · teachers · future astronauts"), P(7) + 0.3, P(8) - 0.3)
# WHAT
w_hir, w_ctx = at_word(8, "The terrain"), at_word(8, "The crater rim")
at(section("s_what", "WHAT", "Live demo", ["Real NASA data, in any web browser"]), P(8), w_hir)
at(lower("d_hirise", "DATASETS 1 · 2", "HiRISE terrain model + orthomosaic",
         "1 m elevation and 25 cm imagery — the ground you walk on", "USGS Mars 2020 TRN HiRISE DTM & orthomosaic"), w_hir + 0.2, w_ctx - 0.2)
at(lower("d_ctx", "DATASETS 3 · 4", "CTX elevation model + MOLA altimeter",
         "The whole crater and its rim on the horizon", "JPL/USGS CTX DEM of Jezero · MGS MOLA global DEM"), w_ctx, P(9) - 0.3)
at(lower("d_crism", "DATASET 5 · KEY K", "CRISM mineral map",
         "Green olivine · yellow carbonate · blue hydrated minerals", "MRO CRISM MTRDR, PDS Geosciences Node"), P(9) + 0.3, P(10) - 0.3)
w_p, w_rim, w_meda = at_word(10, "Press P"), at_word(10, "its RIMFAX"), at_word(10, "and the weather")
SHOTS["panel"] = [w_p, w_rim, w_meda, P(11)]              # tour opens the panel at "Press P"
at(lower("d_trav", "DATASET 6", "Perseverance's real traverse",
         "703 waypoints, 45 km — the blue line", "NASA MMGIS Mars 2020 traverse"), P(10) + 0.3, w_p - 0.1)
at(chip("k_photos", "DATASET 7 · KEY P", "Mars 2020 raw images · Mastcam-Z + Navcam"), w_p + 0.4, w_rim - 0.1)
at(chip("k_rimfax", "DATASET 8", "RIMFAX ground-penetrating radar · PDS"), w_rim, w_meda - 0.1)
at(chip("k_meda", "DATASET 9", "MEDA weather station · PDS Atmospheres"), w_meda, P(11) - 0.2)
at(lower("d_model", "DATASET 10", "Perseverance on its real waypoint",
         "NASA's own 3D model · eleven datasets in one place", "NASA 3D Resources (science.nasa.gov)"), P(11) + 0.3, P(12) - 0.3)
# IMPACT
w_imp, w_14 = P(12) + 5.5, at_word(12, "Fourteen missions")
SHOTS["impactHud"] = w_imp                                # life-support HUD appears after the card
at(section("s_impact", "IMPACT", "Survival that follows the science", ["Who it helps · what changes · what's next"]), P(12), w_imp)
at(lower("d_mars24", "DATASET 11 · LIFE SUPPORT", "MOXIE oxygen · sulfate water · real sunlight",
         "Sun from NASA's Mars24 clock · radiation from Curiosity's RAD", "NASA GISS Mars24 · Curiosity RAD (Hassler et al. 2014)"), w_imp + 0.2, w_14 - 0.2)
at(lower("c_missions", "14 MISSIONS", "From your first breath to the launch home",
         "Oxygen · shelter · power · water · food · dust storm · fission"), w_14, P(13) - 0.3)
at(lower("c_who", "WHO IT HELPS", "Students learn Mars by walking on it",
         "Teachers: a free classroom tool — no install, any browser"), P(13) + 0.3, P(14) - 0.3)
at(lower("c_next", "NEXT STEPS", "More landing sites · classroom mode · multiplayer crews",
         "Plan a base together, on real NASA ground"), P(14) + 0.3, P(15) - 0.3)
at("credits", P(15), END + 30)
# badge whenever no full-frame card or top chip owns the frame
at("badge", P(3), w_p); at("badge", P(11), P(15))

# rule check: never more than 10 s with nothing over the footage
spans = sorted((o["t0"], o["t1"]) for o in T if o["png"] != "badge.png")
cur = 0.0
for t0, t1 in spans:
    assert t0 - cur <= 10, f"gap {cur:.1f}-{t0:.1f}s"
    cur = max(cur, t1)
json.dump({"cards": T, "cues": CUES["cues"], "end": END, "shots": SHOTS},
          open(os.path.join(OV, "timeline.json"), "w"), indent=1)
print(len(T), "cards ->", OV)
for o in T: print(f"  {o['t0']:6.1f} - {o['t1']:6.1f}  {o['png']}")
