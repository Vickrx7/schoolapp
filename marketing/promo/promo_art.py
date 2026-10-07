"""Papercraft stop-motion art for the Lynx École promo (PIL + numpy).

Everything is drawn procedurally: kraft-paper desk, paper cards, sticky notes, tags, a phone and a
laptop mockup holding the real app screenshots, scissors, a pointing hand, lock/eye, stamp, etc.
Elements enter in discrete steps and every frame gets a tiny deterministic jitter (handmade feel).
"""
from __future__ import annotations

import hashlib
import math
import os
from functools import lru_cache

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
SCREENS = os.path.join(HERE, "screens")
# The app icon, read from the repository (marketing/promo -> apps/web/public/icons).
ICON = os.path.join(HERE, "..", "..", "apps", "web", "public", "icons", "icon-512.png")
W, H, FPS = 1920, 1080, 12

BLUE = (37, 83, 216)
AMBER = (251, 191, 36)
SLATE = (15, 23, 42)
WHITE = (255, 255, 255)
PAPER = (253, 251, 246)
KRAFT = (200, 165, 118)
GREEN = (0, 122, 79)
RED = (214, 40, 40)
PINK = (249, 168, 212)
MINT = (167, 243, 208)
SKY = (186, 230, 253)
YELLOW = (253, 224, 71)
LILAC = (221, 214, 254)
SKIN = (243, 201, 164)
DARK = (28, 31, 40)
GREY = (215, 219, 227)
ORANGE = (251, 146, 60)

DEJAVU = "/usr/share/fonts/truetype/dejavu"
CAVEAT = os.path.join(HERE, "fonts", "Caveat[wght].ttf")

# ---------------------------------------------------------------------------
# language: on-screen strings are written in English in the scene code and
# translated through tr(); L(en, fr) picks per-language layout values.
# ---------------------------------------------------------------------------
LANG = "en"

FR = {
    "your whole day, one screen": "toute votre journée, un seul écran",
    "every period": "chaque période",
    "every routine": "chaque routine",
    "the next lesson →": "la prochaine leçon →",
    "no class today": "pas de classe",
    "period replaced ✓": "période remplacée ✓",
    "shorter afternoon": "après-midi écourté",
    "adjusts on its own": "s'ajuste toute seule",
    "undo? one tap too": "annuler? une touche aussi",
    "the plan moves on →": "la planification avance →",
    "next: Leçon 5 · Les détails importants": "prochaine : Leçon 5 · Les détails importants",
    "read on your device": "lu sur votre appareil",
    "never sent: last names,\nstudent numbers, birthdates": "jamais envoyés : noms de famille,\nnuméros d'élève, dates de naissance",
    "first names only ✓": "prénoms seulement ✓",
    "encrypted": "chiffrées",
    "hidden until you reveal it": "cachées jusqu'à ce\nque vous les révéliez",
    "every view is logged ✎": "chaque consultation\nest enregistrée ✎",
    "masqué": "masquée",
    "rotating Jour 1 … 6 ✓": "Jour 1 … 6 en rotation ✓",
    "rotary teachers ✓": "enseignement en rotation ✓",
    "combined grades ✓": "classes combinées ✓",
    "in French, on your phone": "en français, sur votre téléphone",
    "BIENTÔT  ·  COMING SOON": "BIENTÔT",
    "coming soon": "bientôt",
    "picks up right where\nyou left off": "reprend là où\nvotre classe est rendue",
    "Less paperwork, more teaching.": "Moins de paperasse, plus d'enseignement.",
    "A working name. All demo data shown is fictional.": "Nom provisoire. Toutes les données montrées sont fictives.",
    "We'd love\nyour\nfeedback!": "Dites-nous\nce que vous\nen pensez!",
    "Merci !\n♥": "Merci!\n♥",
    "Notes pour la suppléance": "Notes pour la personne suppléante",
}
STRINGS = {"en": {}, "fr": FR}


def set_lang(lang: str):
    global LANG
    if lang not in STRINGS:
        raise ValueError(f"unknown language {lang!r}; known: {sorted(STRINGS)}")
    LANG = lang


def tr(text: str) -> str:
    """Translate an on-screen English string for the current language (identity for English)."""
    if LANG == "en":
        return text
    try:
        return STRINGS[LANG][text]
    except KeyError:
        raise KeyError(f"no {LANG} translation for {text!r}") from None


def L(en, fr):
    """Per-language layout value."""
    return en if LANG == "en" else fr


# ---------------------------------------------------------------------------
# basics
# ---------------------------------------------------------------------------
@lru_cache(maxsize=None)
def font(kind: str, size: int) -> ImageFont.FreeTypeFont:
    if kind == "sans":
        return ImageFont.truetype(os.path.join(DEJAVU, "DejaVuSans.ttf"), size)
    if kind == "bold":
        return ImageFont.truetype(os.path.join(DEJAVU, "DejaVuSans-Bold.ttf"), size)
    f = ImageFont.truetype(CAVEAT, size)
    try:
        f.set_variation_by_name(b"Bold" if kind == "handb" else b"Regular")
    except Exception:
        pass
    return f


def rgba(c, a=255):
    return (c[0], c[1], c[2], a)


def darken(c, k=0.85):
    return tuple(int(v * k) for v in c)


def lighten(c, k=0.5):
    return tuple(int(v + (255 - v) * k) for v in c)


_noise = None


def paper_texture(img: Image.Image, strength: float = 6.0) -> Image.Image:
    """Multiply a faint grain into the RGB of an RGBA image (alpha untouched)."""
    global _noise
    if _noise is None:
        rng = np.random.default_rng(3)
        _noise = rng.normal(0, 1, (H, W)).astype(np.float32)
    a = np.asarray(img.convert("RGBA")).astype(np.float32)
    h, w = a.shape[:2]
    n = np.tile(_noise, (h // H + 1, w // W + 1))[:h, :w]
    a[..., :3] = np.clip(a[..., :3] + n[..., None] * strength, 0, 255)
    return Image.fromarray(a.astype(np.uint8), "RGBA")


def shadow(img: Image.Image, dx=6, dy=10, blur=8, opacity=0.33) -> Image.Image:
    pad = int(blur * 2.5) + max(abs(dx), abs(dy))
    cv = Image.new("RGBA", (img.width + 2 * pad, img.height + 2 * pad), (0, 0, 0, 0))
    sh = Image.new("RGBA", img.size, (40, 25, 5, 255))
    sh.putalpha(img.getchannel("A").point(lambda v: int(v * opacity)))
    cv.paste(sh, (pad + dx, pad + dy))
    cv = cv.filter(ImageFilter.GaussianBlur(blur))
    cv.alpha_composite(img, (pad, pad))
    return cv


def text_size(text, fnt, spacing=6):
    d = ImageDraw.Draw(Image.new("RGBA", (10, 10)))
    b = d.multiline_textbbox((0, 0), text, font=fnt, spacing=spacing, align="center")
    return b


def _is_sym(ch: str) -> bool:
    return ord(ch) >= 0x2190  # arrows, dingbats, misc symbols: Caveat has no glyphs for these


def _runs(line: str, fnt):
    """Split a line into (text, font) runs; symbol chars use DejaVu Sans Bold at ~72% size."""
    sym = font("bold", max(8, int(fnt.size * 0.72)))
    out, cur, cur_sym = [], "", None
    for ch in line:
        is_s = _is_sym(ch)
        if cur and is_s != cur_sym:
            out.append((cur, sym if cur_sym else fnt))
            cur = ""
        cur += ch
        cur_sym = is_s
    if cur:
        out.append((cur, sym if cur_sym else fnt))
    return out


def rich_measure(text, fnt, spacing=6):
    asc, desc = fnt.getmetrics()
    lh = asc + desc + spacing
    lines = text.split("\n")
    w = max(sum(f.getlength(r) for r, f in _runs(ln, fnt)) for ln in lines)
    return w, lh * len(lines) - spacing, asc, lh


def text_center(d: ImageDraw.ImageDraw, cx, cy, text, fnt, fill, align="center", spacing=6):
    """Centered multi-line text with symbol fallback font (baseline aligned)."""
    w, h, asc, lh = rich_measure(text, fnt, spacing)
    y_top = cy - h / 2
    for i, ln in enumerate(text.split("\n")):
        runs = _runs(ln, fnt)
        lw = sum(f.getlength(r) for r, f in runs)
        x = cx - lw / 2 if align == "center" else (cx if align == "left" else cx - lw)
        base = y_top + i * lh + asc
        for r, f in runs:
            d.text((x, base), r, font=f, fill=fill, anchor="ls")
            x += f.getlength(r)


def text_img(text, fnt, fill, spacing=6, align="center", pad=4) -> Image.Image:
    b = text_size(text, fnt, spacing)
    im = Image.new("RGBA", (int(b[2] - b[0] + 2 * pad), int(b[3] - b[1] + 2 * pad)), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.multiline_text((pad - b[0], pad - b[1]), text, font=fnt, fill=fill, spacing=spacing, align=align)
    return im


def tape(w=110, h=32, alpha=105, rot=-6):
    t = Image.new("RGBA", (w, h), (255, 255, 255, alpha))
    d = ImageDraw.Draw(t)
    # zig-zag ends
    for x in (0, w - 1):
        for y in range(0, h, 6):
            d.rectangle((x, y, x + 2, y + 3), fill=(0, 0, 0, 0))
    return t.rotate(rot, expand=True, resample=Image.BICUBIC)


def add_tape(im: Image.Image, cx, cy, rot=-6, w=110) -> Image.Image:
    t = tape(w=w, rot=rot)
    im.alpha_composite(t, (int(cx - t.width / 2), int(cy - t.height / 2)))
    return im


# ---------------------------------------------------------------------------
# background
# ---------------------------------------------------------------------------
@lru_cache(maxsize=1)
def background() -> Image.Image:
    rng = np.random.default_rng(11)
    base = np.array(KRAFT, dtype=np.float32)
    img = np.ones((H, W, 3), dtype=np.float32) * base
    # low-frequency mottling
    small = rng.normal(0, 1, (H // 48 + 2, W // 48 + 2)).astype(np.float32)
    small = np.asarray(Image.fromarray(small).resize((W, H), Image.BICUBIC))
    img += small[..., None] * np.array([9, 8, 6])
    # grain
    img += rng.normal(0, 3.2, (H, W, 1))
    # fibres
    fib = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(fib)
    for _ in range(900):
        x, y = rng.uniform(0, W), rng.uniform(0, H)
        ln, ang = rng.uniform(6, 40), rng.uniform(0, math.pi)
        c = (255, 245, 220, int(rng.uniform(20, 55))) if rng.uniform() < 0.6 else (90, 60, 30, int(rng.uniform(15, 40)))
        d.line((x, y, x + ln * math.cos(ang), y + ln * math.sin(ang)), fill=c, width=1)
    # vignette
    yy, xx = np.mgrid[0:H, 0:W]
    r = ((xx - W / 2) / (W / 2)) ** 2 + ((yy - H / 2) / (H / 2)) ** 2
    img *= (1 - 0.22 * r)[..., None]
    bg = Image.fromarray(np.clip(img, 0, 255).astype(np.uint8), "RGB").convert("RGBA")
    bg.alpha_composite(fib)
    # desk props: a paper pencil (bottom-left) and a paper clip (top-right)
    pencil_img = pencil()
    bg.alpha_composite(pencil_img, (30, 870))
    clip = paperclip()
    bg.alpha_composite(clip, (1815, 20))
    return bg


def pencil(length=520, thick=38) -> Image.Image:
    im = Image.new("RGBA", (length + 40, thick + 40), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    x0, y0 = 20, 20
    # eraser
    d.rounded_rectangle((x0, y0, x0 + 44, y0 + thick), 10, fill=rgba(PINK))
    d.rectangle((x0 + 44, y0, x0 + 66, y0 + thick), fill=rgba((196, 196, 200)))
    # body with two shade stripes
    d.rectangle((x0 + 66, y0, x0 + length - 70, y0 + thick), fill=rgba(YELLOW))
    d.rectangle((x0 + 66, y0, x0 + length - 70, y0 + thick // 3), fill=rgba(lighten(YELLOW, 0.35)))
    d.rectangle((x0 + 66, y0 + 2 * thick // 3, x0 + length - 70, y0 + thick), fill=rgba(darken(YELLOW, 0.85)))
    # wood tip + graphite
    d.polygon([(x0 + length - 70, y0), (x0 + length - 70, y0 + thick), (x0 + length, y0 + thick // 2)], fill=rgba((232, 196, 150)))
    d.polygon([(x0 + length - 22, y0 + thick // 2 - 7), (x0 + length - 22, y0 + thick // 2 + 7), (x0 + length, y0 + thick // 2)], fill=rgba(DARK))
    im = paper_texture(im)
    im = shadow(im, 4, 7, 6, 0.3)
    return im.rotate(-14, expand=True, resample=Image.BICUBIC)


def paperclip() -> Image.Image:
    im = Image.new("RGBA", (70, 130), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    col = rgba((120, 130, 150))
    d.rounded_rectangle((10, 10, 60, 120), 22, outline=col, width=6)
    d.rounded_rectangle((22, 24, 48, 100), 12, outline=col, width=6)
    d.rectangle((0, 60, 70, 130), fill=(0, 0, 0, 0))
    d.rounded_rectangle((10, 10, 60, 120), 22, outline=col, width=6)
    d.rectangle((0, 0, 70, 60), fill=(0, 0, 0, 0))
    d.rounded_rectangle((22, 24, 48, 100), 12, outline=col, width=6)
    d.rectangle((0, 0, 70, 40), fill=(0, 0, 0, 0))
    d.arc((10, 10, 60, 60), 180, 360, fill=col, width=6)
    return shadow(im.rotate(20, expand=True, resample=Image.BICUBIC), 3, 5, 4, 0.3)


# ---------------------------------------------------------------------------
# paper elements
# ---------------------------------------------------------------------------
def paper_card(w, h, color=PAPER, r=18, edge=True):
    w, h = int(round(w)), int(round(h))
    im = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.rounded_rectangle((0, 0, w - 1, h - 1), r, fill=rgba(color), outline=rgba(darken(color, 0.88)) if edge else None, width=2)
    return im


@lru_cache(maxsize=None)
def sticky(text: str, color=YELLOW, size=230, fsize=44, with_tape=True) -> Image.Image:
    pad = 30
    im = Image.new("RGBA", (size + 2 * pad, size + 2 * pad), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    x0 = y0 = pad
    d.rectangle((x0, y0, x0 + size - 1, y0 + size - 1), fill=rgba(color))
    fold = int(size * 0.16)
    d.polygon([(x0 + size - fold, y0 + size), (x0 + size, y0 + size - fold), (x0 + size, y0 + size)], fill=(0, 0, 0, 0))
    d.polygon([(x0 + size - fold, y0 + size - 1), (x0 + size - 1, y0 + size - fold), (x0 + size - fold, y0 + size - fold)],
              fill=rgba(darken(color, 0.8)))
    text_center(d, x0 + size / 2, y0 + size / 2 - 4, text, font("handb", fsize), SLATE, spacing=2)
    im = paper_texture(im, 5)
    im = shadow(im, 5, 8, 7, 0.32)
    if with_tape:
        add_tape(im, im.width / 2, pad + 22 + 6, rot=-5)
    return im


@lru_cache(maxsize=None)
def tag(text: str, bg=AMBER, fg=SLATE, fsize=40, kind="handb", padx=26, pady=12, r=16) -> Image.Image:
    fnt = font(kind, fsize)
    tw, th, _, _ = rich_measure(text, fnt)
    w, h = int(tw + 2 * padx), int(th + 2 * pady - (8 if kind.startswith("hand") else 0))
    im = paper_card(w, h, bg, r)
    d = ImageDraw.Draw(im)
    text_center(d, w / 2, h / 2 - (1 if kind.startswith("hand") else 0), text, fnt, fg)
    im = paper_texture(im, 4)
    return shadow(im, 4, 7, 6, 0.3)


@lru_cache(maxsize=None)
def caption_strip(text: str) -> Image.Image:
    fnt = font("bold", 42)
    b = text_size(text, fnt, spacing=10)
    for size in (40, 38, 36):  # long captions: step the size down until the strip fits with margins
        if b[2] - b[0] + 88 <= W - 2 * 40:
            break
        fnt = font("bold", size)
        b = text_size(text, fnt, spacing=10)
    w, h = b[2] - b[0] + 2 * 44, b[3] - b[1] + 2 * 22
    im = paper_card(w, h, PAPER, 14)
    d = ImageDraw.Draw(im)
    d.multiline_text((44 - b[0], 22 - b[1]), text, font=fnt, fill=SLATE, align="center", spacing=10)
    im = paper_texture(im, 3)
    return shadow(im, 4, 8, 7, 0.35)


@lru_cache(maxsize=None)
def brand_plate() -> Image.Image:
    icon = Image.open(ICON).convert("RGBA").resize((62, 62), Image.LANCZOS)
    fnt = font("bold", 40)
    b = text_size("Lynx École", fnt)
    w = 20 + 62 + 16 + (b[2] - b[0]) + 24
    im = paper_card(w, 90, PAPER, 20)
    im.alpha_composite(icon, (20, 14))
    d = ImageDraw.Draw(im)
    d.text((20 + 62 + 16 - b[0], 45 - (b[1] + b[3]) / 2), "Lynx École", font=fnt, fill=SLATE)
    im = paper_texture(im, 3)
    return shadow(im, 4, 7, 6, 0.3)


@lru_cache(maxsize=None)
def calendar_card(day: str, month: str, title: str, color=BLUE, w=250, h=250) -> Image.Image:
    im = paper_card(w, h, PAPER, 20)
    d = ImageDraw.Draw(im)
    d.rounded_rectangle((0, 0, w - 1, 64), 20, fill=rgba(color))
    d.rectangle((0, 40, w - 1, 64), fill=rgba(color))
    text_center(d, w / 2, 32, month, font("bold", 30), WHITE)
    text_center(d, w / 2, 122, day, font("bold", 76), SLATE)
    text_center(d, w / 2, 200, title, font("handb", 38), darken(color, 0.9), spacing=0)
    # two rings on top
    for x in (w * 0.3, w * 0.7):
        d.rounded_rectangle((x - 7, -14, x + 7, 18), 6, fill=rgba((90, 95, 110)))
    im = paper_texture(im, 4)
    return shadow(im, 5, 9, 7, 0.32)


# ---------------------------------------------------------------------------
# devices
# ---------------------------------------------------------------------------
@lru_cache(maxsize=None)
def screen(name: str) -> Image.Image:
    crops = {
        "today": ("phone_today.png", None),
        "checked": ("phone_today_checked.png", None),
        "pa": ("phone_pa_day.png", None),
        "friday": ("phone_friday_mass.png", (0, 0, 1170, 1992)),
        "login": ("phone_login_code.png", None),
        "csv": ("desktop_csv_import.png", (480, 300, 2400, 1500)),
        "alerts": ("desktop_students_alert.png", (440, 350, 1980, 1312)),
        "alert_row": ("desktop_students_alert.png", (440, 740, 1980, 950)),
        "timetable": ("desktop_timetable.png", (300, 600, 2580, 2025)),
        "unit": ("desktop_unit.png", (300, 560, 2580, 1985)),
        "mass_snippet": ("phone_friday_mass.png", (40, 2008, 1130, 2135)),
    }
    fn, box = crops[name]
    im = Image.open(os.path.join(SCREENS, fn)).convert("RGB")
    if box:
        im = im.crop(box)
    return im


@lru_cache(maxsize=None)
def phone(name: str, screen_w: int = 430) -> Image.Image:
    """Dark rounded phone frame holding a phone screenshot (+ a small status bar)."""
    src = screen(name)
    sw = screen_w
    sh_ = int(round(src.height * sw / src.width))
    sb = 34  # status bar height
    bez = 14
    fw, fh = sw + 2 * bez, sh_ + sb + 2 * bez
    im = Image.new("RGBA", (fw + 12, fh), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    # side buttons
    d.rounded_rectangle((0, 190, 8, 260), 3, fill=rgba((40, 44, 54)))
    d.rounded_rectangle((0, 280, 8, 350), 3, fill=rgba((40, 44, 54)))
    d.rounded_rectangle((fw - 2, 230, fw + 8, 330), 3, fill=rgba((40, 44, 54)))
    d.rounded_rectangle((4, 0, 4 + fw - 1, fh - 1), 62, fill=rgba(DARK), outline=rgba((70, 75, 88)), width=2)
    scr = Image.new("RGBA", (sw, sh_ + sb), rgba(WHITE))
    scr.paste(src.resize((sw, sh_), Image.LANCZOS), (0, sb))
    sd = ImageDraw.Draw(scr)
    sd.text((22, 7), "8:30", font=font("bold", 19), fill=SLATE)
    # battery + signal
    sd.rounded_rectangle((sw - 52, 10, sw - 20, 24), 4, outline=SLATE, width=2)
    sd.rectangle((sw - 49, 13, sw - 27, 21), fill=SLATE)
    sd.rectangle((sw - 19, 14, sw - 16, 20), fill=SLATE)
    for i in range(4):
        sd.rectangle((sw - 92 + i * 8, 22 - 4 * i - 4, sw - 87 + i * 8, 24), fill=SLATE)
    mask = Image.new("L", scr.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, sw - 1, sh_ + sb - 1), 46, fill=255)
    im.paste(scr, (4 + bez, bez), mask)
    return shadow(im, 8, 14, 12, 0.4)


@lru_cache(maxsize=None)
def laptop(name: str, screen_w: int = 900) -> Image.Image:
    src = screen(name)
    sw = screen_w
    sh_ = int(round(src.height * sw / src.width))
    bez = 16
    base_h = 30
    fw, fh = sw + 2 * bez, sh_ + 2 * bez
    ext = 70
    im = Image.new("RGBA", (fw + 2 * ext, fh + base_h + 6), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.rounded_rectangle((ext, 0, ext + fw - 1, fh - 1), 20, fill=rgba((43, 47, 58)), outline=rgba((80, 85, 100)), width=2)
    scr = src.resize((sw, sh_), Image.LANCZOS).convert("RGBA")
    mask = Image.new("L", scr.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, sw - 1, sh_ - 1), 8, fill=255)
    im.paste(scr, (ext + bez, bez), mask)
    # base
    d.rounded_rectangle((0, fh - 2, fw + 2 * ext - 1, fh + base_h), 14, fill=rgba(GREY), outline=rgba(darken(GREY, 0.8)), width=2)
    d.rounded_rectangle((fw / 2 + ext - 90, fh - 2, fw / 2 + ext + 90, fh + 10), 6, fill=rgba(darken(GREY, 0.9)))
    d.rectangle((0, fh - 2, fw + 2 * ext - 1, fh + 4), fill=rgba(lighten(GREY, 0.4)))
    return shadow(im, 8, 14, 12, 0.4)


@lru_cache(maxsize=None)
def snippet(name: str, width: int, pad=14) -> Image.Image:
    """A screenshot crop mounted on a paper card, like it was cut out with scissors."""
    src = screen(name)
    h = int(round(src.height * width / src.width))
    im = paper_card(width + 2 * pad, h + 2 * pad, PAPER, 10)
    im.paste(src.resize((width, h), Image.LANCZOS), (pad, pad))
    return shadow(im, 5, 9, 7, 0.32)


# ---------------------------------------------------------------------------
# props
# ---------------------------------------------------------------------------
@lru_cache(maxsize=None)
def clock(size=240, hour=8, minute=30, alarm=False) -> Image.Image:
    pad = 40
    im = Image.new("RGBA", (size + 2 * pad, size + 2 * pad), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    c = size / 2 + pad
    if alarm:
        for sx in (-1, 1):
            d.pieslice((c + sx * size * 0.30 - size * 0.16, pad - 10, c + sx * size * 0.30 + size * 0.16, pad + size * 0.22), 180, 360, fill=rgba(AMBER), outline=rgba(darken(AMBER, 0.8)), width=3)
            d.line((c + sx * size * 0.30, pad + size * 0.02, c + sx * size * 0.30, pad - 18), fill=rgba(darken(AMBER, 0.8)), width=6)
            d.line((c + sx * size * 0.32, c + size * 0.42, c + sx * size * 0.44, c + size * 0.55), fill=rgba(SLATE), width=8)
    d.ellipse((pad, pad, pad + size, pad + size), fill=rgba(PAPER), outline=rgba(SLATE), width=6)
    for i in range(12):
        a = i * math.pi / 6
        r1 = size * 0.42
        r2 = size * 0.36 if i % 3 == 0 else size * 0.39
        d.line((c + r1 * math.sin(a), c - r1 * math.cos(a), c + r2 * math.sin(a), c - r2 * math.cos(a)), fill=SLATE, width=5 if i % 3 == 0 else 3)
    ah = (hour % 12 + minute / 60) * math.pi / 6
    am = minute * math.pi / 30
    d.line((c, c, c + size * 0.24 * math.sin(ah), c - size * 0.24 * math.cos(ah)), fill=SLATE, width=9)
    d.line((c, c, c + size * 0.34 * math.sin(am), c - size * 0.34 * math.cos(am)), fill=BLUE, width=7)
    d.ellipse((c - 9, c - 9, c + 9, c + 9), fill=rgba(AMBER), outline=rgba(SLATE), width=3)
    im = paper_texture(im, 4)
    return shadow(im, 6, 10, 8, 0.33)


@lru_cache(maxsize=None)
def coffee(variant=0, size=200) -> Image.Image:
    im = Image.new("RGBA", (size + 80, size + 80), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    x0, y0 = 40, 40 + size * 0.28
    # saucer
    d.ellipse((x0 - 10, y0 + size * 0.58, x0 + size * 0.8, y0 + size * 0.72), fill=rgba((235, 238, 244)), outline=rgba(SLATE), width=3)
    # cup
    d.rounded_rectangle((x0, y0, x0 + size * 0.7, y0 + size * 0.64), 24, fill=rgba(PAPER), outline=rgba(SLATE), width=4)
    d.ellipse((x0 + 10, y0 + 8, x0 + size * 0.7 - 10, y0 + 36), fill=rgba((120, 72, 40)))
    # handle
    d.ellipse((x0 + size * 0.62, y0 + size * 0.12, x0 + size * 0.92, y0 + size * 0.46), outline=rgba(SLATE), width=12)
    d.ellipse((x0 + size * 0.62, y0 + size * 0.12, x0 + size * 0.92, y0 + size * 0.46), outline=rgba(PAPER), width=6)
    d.rounded_rectangle((x0, y0, x0 + size * 0.7, y0 + size * 0.64), 24, outline=rgba(SLATE), width=4)
    # steam (3 variants)
    for i, xs in enumerate((0.2, 0.36, 0.52)):
        ph = (variant + i) % 3
        pts = []
        for k in range(8):
            yy = y0 - 8 - k * 9
            xx = x0 + size * xs + 7 * math.sin((k + ph) * 0.9)
            pts.append((xx, yy))
        d.line(pts, fill=(140, 120, 100, 170), width=4, joint="curve")
    im = paper_texture(im, 4)
    return shadow(im, 6, 10, 8, 0.33)


@lru_cache(maxsize=None)
def scissors(open_deg=25, size=170) -> Image.Image:
    """Paper scissors pointing DOWN (blades at bottom), pivot roughly at the image centre."""
    im = Image.new("RGBA", (size, int(size * 1.9)), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    cx, cy = size / 2, size * 0.95
    blade_len = size * 0.9
    for sgn in (-1, 1):
        a = math.radians(90 + sgn * open_deg / 2)
        tip = (cx + blade_len * math.cos(a), cy + blade_len * math.sin(a))
        wdt = size * 0.13
        perp = (-math.sin(a) * wdt, math.cos(a) * wdt)
        d.polygon([(cx + perp[0] * 0.6, cy + perp[1] * 0.6), (cx - perp[0] * 0.6, cy - perp[1] * 0.6), tip], fill=rgba((205, 210, 220)), outline=rgba(SLATE))
        # handle on the opposite side
        hb = (cx - size * 0.42 * math.cos(a), cy - size * 0.42 * math.sin(a))
        d.ellipse((hb[0] - size * 0.19, hb[1] - size * 0.19, hb[0] + size * 0.19, hb[1] + size * 0.19), fill=rgba(RED), outline=rgba(SLATE), width=3)
        d.ellipse((hb[0] - size * 0.1, hb[1] - size * 0.1, hb[0] + size * 0.1, hb[1] + size * 0.1), fill=(0, 0, 0, 0))
    d.ellipse((cx - 8, cy - 8, cx + 8, cy + 8), fill=rgba(AMBER), outline=rgba(SLATE), width=2)
    im = paper_texture(im, 3)
    return shadow(im, 5, 9, 7, 0.33)


@lru_cache(maxsize=None)
def hand(size=1.0) -> Image.Image:
    """Pointing paper hand, fingertip at (index_x, 0) ~ (63*size, 4)."""
    w, h = int(210 * size), int(270 * size)
    im = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    s = size
    ol = darken(SKIN, 0.72)
    # palm
    d.rounded_rectangle((40 * s, 112 * s, 184 * s, 262 * s), int(34 * s), fill=rgba(SKIN), outline=rgba(ol), width=3)
    # index finger
    d.rounded_rectangle((40 * s, 4 * s, 88 * s, 150 * s), int(24 * s), fill=rgba(SKIN), outline=rgba(ol), width=3)
    # curled fingers
    for i, (x, y) in enumerate(((92, 100), (134, 108), (176, 120))):
        d.rounded_rectangle((x * s - 2, y * s, (x + 40) * s, (y + 46) * s), int(18 * s), fill=rgba(SKIN), outline=rgba(ol), width=3)
    # thumb
    th = Image.new("RGBA", (int(60 * s), int(110 * s)), (0, 0, 0, 0))
    ImageDraw.Draw(th).rounded_rectangle((2, 2, 58 * s, 108 * s), int(26 * s), fill=rgba(SKIN), outline=rgba(ol), width=3)
    th = th.rotate(-38, expand=True, resample=Image.BICUBIC)
    im.alpha_composite(th, (int(0 * s), int(135 * s)))
    # cuff
    d.rounded_rectangle((36 * s, 236 * s, 188 * s, 270 * s), int(10 * s), fill=rgba(BLUE), outline=rgba(darken(BLUE, 0.7)), width=3)
    im = paper_texture(im, 4)
    return shadow(im, 6, 10, 8, 0.35)


@lru_cache(maxsize=None)
def lock(size=150, is_open=False) -> Image.Image:
    im = Image.new("RGBA", (size + 60, int(size * 1.5) + 40), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    cx = im.width / 2
    body_top = size * 0.62 + 20
    # shackle
    sh_w = size * 0.56
    if is_open:
        d.arc((cx - sh_w / 2 + size * 0.22, 6, cx + sh_w / 2 + size * 0.22, 6 + size * 0.75), 180, 360, fill=rgba((110, 118, 135)), width=int(size * 0.13))
        d.line((cx + sh_w / 2 + size * 0.22, 6 + size * 0.37, cx + sh_w / 2 + size * 0.22, body_top + 6), fill=rgba((110, 118, 135)), width=int(size * 0.13))
        d.line((cx - sh_w / 2 + size * 0.22, 6 + size * 0.37, cx - sh_w / 2 + size * 0.22, 6 + size * 0.5), fill=rgba((110, 118, 135)), width=int(size * 0.13))
    else:
        d.arc((cx - sh_w / 2, 20, cx + sh_w / 2, 20 + size * 0.75), 180, 360, fill=rgba((110, 118, 135)), width=int(size * 0.13))
        for sx in (-1, 1):
            d.line((cx + sx * sh_w / 2, 20 + size * 0.37, cx + sx * sh_w / 2, body_top + 6), fill=rgba((110, 118, 135)), width=int(size * 0.13))
    d.rounded_rectangle((cx - size * 0.5, body_top, cx + size * 0.5, body_top + size * 0.78), int(size * 0.16), fill=rgba(BLUE), outline=rgba(darken(BLUE, 0.7)), width=3)
    ky = body_top + size * 0.34
    d.ellipse((cx - size * 0.1, ky - size * 0.1, cx + size * 0.1, ky + size * 0.1), fill=rgba(AMBER))
    d.rounded_rectangle((cx - size * 0.045, ky, cx + size * 0.045, ky + size * 0.24), 4, fill=rgba(AMBER))
    im = paper_texture(im, 4)
    return shadow(im, 6, 10, 8, 0.33)


@lru_cache(maxsize=None)
def eye(size=150, closed=False) -> Image.Image:
    im = Image.new("RGBA", (size + 40, int(size * 0.7) + 40), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    cx, cy = im.width / 2, im.height / 2
    if closed:
        d.arc((cx - size / 2, cy - size * 0.35, cx + size / 2, cy + size * 0.35), 15, 165, fill=rgba(SLATE), width=8)
        for k in range(-2, 3):
            x = cx + k * size * 0.17
            d.line((x, cy + size * 0.3 - abs(k) * 5, x + k * 4, cy + size * 0.42 - abs(k) * 6), fill=rgba(SLATE), width=6)
    else:
        pts = []
        for i in range(40):
            a = i / 40 * 2 * math.pi
            pts.append((cx + size / 2 * math.cos(a), cy + size * 0.32 * math.sin(a) * (1 - 0.15 * abs(math.cos(a)))))
        d.polygon(pts, fill=rgba(PAPER), outline=rgba(SLATE))
        d.line(pts + [pts[0]], fill=rgba(SLATE), width=6, joint="curve")
        r = size * 0.21
        d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=rgba(BLUE))
        r2 = size * 0.1
        d.ellipse((cx - r2, cy - r2, cx + r2, cy + r2), fill=rgba(SLATE))
        d.ellipse((cx + r2 * 0.3, cy - r2 * 1.1, cx + r2 * 0.9, cy - r2 * 0.5), fill=rgba(WHITE))
    im = paper_texture(im, 3)
    return shadow(im, 5, 8, 7, 0.3)


@lru_cache(maxsize=None)
def maple_leaf(size=200, color=RED) -> Image.Image:
    right = [(50, 3), (57, 19), (66, 14), (63, 34), (69, 37), (81, 24), (82, 33), (95, 30), (89, 43), (95, 48), (74, 61), (77, 67), (54, 63), (53, 92)]
    left = [(100 - x, y) for x, y in reversed(right)]
    pts = right + [(47, 92)] + left[1:] if False else right + [(47, 92)] + [(100 - x, y) for x, y in reversed(right[:-1])]
    im = Image.new("RGBA", (size + 40, size + 40), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.polygon([(20 + x * size / 100, 20 + y * size / 100) for x, y in pts], fill=rgba(color), outline=rgba(darken(color, 0.75)))
    im = paper_texture(im, 5)
    return shadow(im, 5, 9, 7, 0.32)


@lru_cache(maxsize=None)
def stamp(text="Donnée !", size=250) -> Image.Image:
    im = Image.new("RGBA", (size + 40, size + 40), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    c = size / 2 + 20
    d.ellipse((20, 20, 20 + size, 20 + size), fill=rgba(GREEN), outline=rgba(darken(GREEN, 0.7)), width=3)
    d.ellipse((34, 34, 6 + size, 6 + size), outline=rgba(WHITE), width=5)
    text_center(d, c, c - size * 0.13, "✓", font("bold", int(size * 0.42)), WHITE)
    text_center(d, c, c + size * 0.24, text, font("handb", int(size * 0.2)), WHITE)
    im = paper_texture(im, 4)
    return shadow(im, 6, 10, 8, 0.35)


@lru_cache(maxsize=None)
def ribbon(text="BIENTÔT  ·  COMING SOON", w=700, h=64, bg=RED, fg=WHITE, fsize=30) -> Image.Image:
    im = Image.new("RGBA", (w, h), rgba(bg))
    d = ImageDraw.Draw(im)
    d.rectangle((0, 0, w - 1, h - 1), outline=rgba(darken(bg, 0.7)), width=2)
    text_center(d, w / 2, h / 2, text, font("bold", fsize), fg)
    im = paper_texture(im, 4)
    return shadow(im, 5, 9, 7, 0.35)


@lru_cache(maxsize=None)
def thermometer(size=200) -> Image.Image:
    im = Image.new("RGBA", (int(size * 0.5) + 40, size + 40), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    cx = im.width / 2
    d.rounded_rectangle((cx - size * 0.11, 20, cx + size * 0.11, 20 + size * 0.78), int(size * 0.11), fill=rgba(PAPER), outline=rgba(SLATE), width=4)
    d.rounded_rectangle((cx - size * 0.05, 20 + size * 0.22, cx + size * 0.05, 20 + size * 0.78), int(size * 0.05), fill=rgba(RED))
    d.ellipse((cx - size * 0.18, 20 + size * 0.64, cx + size * 0.18, 20 + size), fill=rgba(RED), outline=rgba(SLATE), width=4)
    for i in range(5):
        y = 20 + size * 0.18 + i * size * 0.11
        d.line((cx + size * 0.12, y, cx + size * 0.2, y), fill=rgba(SLATE), width=3)
    im = paper_texture(im, 3)
    return shadow(im, 5, 9, 7, 0.33)


@lru_cache(maxsize=None)
def big_button(text="Journée de maladie", w=520, h=110, bg=AMBER, pressed=False) -> Image.Image:
    im = Image.new("RGBA", (w + 20, h + 30), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    off = 0 if pressed else 10
    d.rounded_rectangle((10, 10 + off, 10 + w, 10 + off + h), h // 2, fill=rgba(darken(bg, 0.7)))
    d.rounded_rectangle((10, 10, 10 + w, 10 + h), h // 2, fill=rgba(bg), outline=rgba(darken(bg, 0.8)), width=3)
    text_center(d, 10 + w / 2 + 14, 10 + h / 2, text, font("handb", 52), SLATE)
    # little "sick" face icon
    fx, fy = 62, 10 + h / 2
    d.ellipse((fx - 24, fy - 24, fx + 24, fy + 24), fill=rgba(PAPER), outline=rgba(SLATE), width=3)
    d.ellipse((fx - 12, fy - 9, fx - 6, fy - 3), fill=rgba(SLATE))
    d.ellipse((fx + 6, fy - 9, fx + 12, fy - 3), fill=rgba(SLATE))
    d.arc((fx - 12, fy + 4, fx + 12, fy + 22), 200, 340, fill=rgba(SLATE), width=3)
    im = paper_texture(im, 4)
    return shadow(im, 5, 9, 7, 0.33)


PLAN_LINES = [
    ("8 h 55", "Français", "Leçon 5 · Les détails importants"),
    ("9 h 45", "Mathématiques", "Leçon 5 · Les nombres jusqu'à 1 000"),
    ("11 h 15", "Ens. religieux", "Leçon 3 · Les paraboles"),
    ("13 h 35", "Français", "Bibliothèque · lecture autonome"),
    ("", "Notes pour la suppléance", "Léa : voir alerte (épipen) · rangs à 8 h 45"),
]


@lru_cache(maxsize=None)
def plan_sheet(n_lines: int, notes_label="Notes pour la suppléance", w=660, h=430) -> Image.Image:
    im = paper_card(w, h, PAPER, 12)
    d = ImageDraw.Draw(im)
    # ruled paper lines
    for y in range(120, h - 20, 58):
        d.line((24, y, w - 24, y), fill=rgba((205, 212, 225)), width=2)
    d.line((70, 20, 70, h - 20), fill=rgba((240, 160, 170)), width=2)
    d.text((84, 24), "Plan de suppléance", font=font("handb", 46), fill=BLUE)
    d.text((84, 74), "mardi 6 octobre  ·  3e année", font=font("hand", 32), fill=(90, 100, 120))
    for i, (tm, subj, lesson) in enumerate(PLAN_LINES[:n_lines]):
        y = 126 + i * 58
        if tm:
            d.text((84, y + 6), tm, font=font("bold", 22), fill=(90, 100, 120))
            d.text((186, y + 2), subj, font=font("bold", 26), fill=SLATE)
            d.text((186, y + 30), lesson, font=font("sans", 20), fill=(60, 70, 90))
        else:
            d.text((84, y + 2), notes_label, font=font("handb", 30), fill=GREEN)
            d.text((84, y + 32), lesson, font=font("sans", 20), fill=(60, 70, 90))
    im = paper_texture(im, 3)
    return shadow(im, 6, 10, 8, 0.33)


CSV_COLS = [
    ("NISO", ["3 152 007", "3 152 019", "3 152 044"], 170, True),
    ("Nom", ["Gagnon", "Roy", "Bélanger"], 190, True),
    ("Prénom", ["Rosalie", "Émile", "Maya"], 190, False),
    ("Naissance", ["2018-03-14", "2018-07-02", "2017-11-21"], 200, True),
]


@lru_cache(maxsize=None)
def csv_column(idx: int) -> Image.Image:
    name, cells, w, sensitive = CSV_COLS[idx]
    hh, rh = 60, 62
    h = hh + rh * len(cells)
    im = Image.new("RGBA", (w, h), rgba(PAPER))
    d = ImageDraw.Draw(im)
    d.rectangle((0, 0, w - 1, hh - 1), fill=rgba(lighten(AMBER, 0.55) if not sensitive else (233, 236, 241)))
    d.rectangle((0, 0, w - 1, h - 1), outline=rgba((190, 196, 208)), width=2)
    text_center(d, w / 2, hh / 2, name, font("bold", 26), SLATE)
    for i, c in enumerate(cells):
        y = hh + i * rh
        d.line((0, y, w, y), fill=rgba((215, 220, 230)), width=2)
        text_center(d, w / 2, y + rh / 2, c, font("sans", 25), SLATE if not sensitive else (95, 105, 125))
    im = paper_texture(im, 3)
    return shadow(im, 4, 7, 6, 0.28)


@lru_cache(maxsize=None)
def csv_title() -> Image.Image:
    im = paper_card(450, 62, PAPER, 10)
    d = ImageDraw.Draw(im)
    # little paper "file" icon
    d.polygon([(22, 12), (48, 12), (60, 24), (60, 50), (22, 50)], fill=rgba(WHITE), outline=rgba(SLATE))
    d.polygon([(48, 12), (48, 24), (60, 24)], fill=rgba(GREY), outline=rgba(SLATE))
    d.text((78, 12), "ma-classe.csv", font=font("bold", 30), fill=SLATE)
    d.text((322, 18), "(20 élèves)", font=font("sans", 22), fill=(90, 100, 120))
    im = paper_texture(im, 3)
    return shadow(im, 4, 7, 6, 0.28)


@lru_cache(maxsize=None)
def cover_strip(w=600, h=58, label="masqué") -> Image.Image:
    im = paper_card(w, h, (203, 213, 235), 12)
    d = ImageDraw.Draw(im)
    # tiny lock glyph
    d.rounded_rectangle((22, 24, 46, 46), 5, fill=rgba(SLATE))
    d.arc((25, 10, 43, 32), 180, 360, fill=rgba(SLATE), width=4)
    d.text((62, 12), "• • • • • • • • • • • •", font=font("bold", 26), fill=SLATE)
    d.text((w - 190, 10), label, font=font("handb", 34), fill=SLATE)
    im = paper_texture(im, 4)
    return shadow(im, 4, 7, 6, 0.3)


@lru_cache(maxsize=None)
def confetti(color, w=18, h=10) -> Image.Image:
    im = Image.new("RGBA", (w + 10, h + 10), (0, 0, 0, 0))
    ImageDraw.Draw(im).rectangle((5, 5, 5 + w, 5 + h), fill=rgba(color))
    return shadow(im, 2, 3, 2, 0.3)


@lru_cache(maxsize=None)
def app_icon(size=200) -> Image.Image:
    im = Image.open(ICON).convert("RGBA").resize((size, size), Image.LANCZOS)
    return shadow(im, 6, 12, 10, 0.4)


@lru_cache(maxsize=None)
def end_card() -> Image.Image:
    im = paper_card(1040, 560, PAPER, 30)
    im = paper_texture(im, 3)
    return shadow(im, 8, 14, 12, 0.35)


@lru_cache(maxsize=None)
def tap_ring(r=44) -> Image.Image:
    im = Image.new("RGBA", (2 * r + 10, 2 * r + 10), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.ellipse((5, 5, 5 + 2 * r, 5 + 2 * r), outline=rgba(AMBER, 230), width=8)
    d.ellipse((5 + r * 0.45, 5 + r * 0.45, 5 + 2 * r - r * 0.45, 5 + 2 * r - r * 0.45), fill=rgba(WHITE, 140))
    return im


# ---------------------------------------------------------------------------
# animation helpers
# ---------------------------------------------------------------------------
def qstep(t, t0, dur, steps):
    if t < t0:
        return 0.0
    p = (t - t0) / max(1e-6, dur)
    if p >= 1:
        return 1.0
    return math.floor(p * steps) / steps


def jitter(key: str, frame: int, amp: float, rot: float):
    h = hashlib.md5(f"{key}|{frame}".encode()).digest()
    rng = np.random.default_rng(int.from_bytes(h[:8], "little"))
    return rng.uniform(-amp, amp), rng.uniform(-amp, amp), rng.uniform(-rot, rot)


POP = [0.35, 0.82, 1.14, 0.94, 1.0]


class Ctx:
    """Per-frame drawing context: canvas, local scene time, global frame index."""

    def __init__(self, cv: Image.Image, t: float, frame: int):
        self.cv, self.t, self.frame = cv, t, frame

    def put(self, img: Image.Image, cx, cy, t0=0.0, enter="pop", dur=0.35, steps=4, rot=0.0, jit=2.0, jrot=0.6,
            key="", t1=None, exit="up", edur=0.3, esteps=3, scale=1.0, sx=1.0, alpha=1.0, from_dir="down", dist=None):
        t = self.t
        if t < t0:
            return None
        p = qstep(t, t0, dur, steps)
        s, ox, oy, a, r = scale, 0.0, 0.0, alpha, rot
        if enter == "pop":
            s *= POP[min(4, int(round(p * 4)))]
        elif enter == "slide":
            dist_ = dist if dist is not None else 760
            k = (1 - p) ** 2 * dist_
            ox, oy = {"down": (0, k), "up": (0, -k), "left": (-k, 0), "right": (k, 0),
                      "downright": (k * 0.7, k * 0.7), "downleft": (-k * 0.7, k * 0.7)}[from_dir]
        elif enter == "drop":
            oy = -(1 - p) ** 2 * (dist if dist is not None else 500)
            r += (1 - p) * 8
        elif enter == "stamp":
            s *= 1 + 1.4 * (1 - p) ** 2
            a *= min(1.0, 0.25 + 0.75 * p)
            r += (1 - p) * 18
        elif enter == "fade":
            a *= p
        if t1 is not None and t >= t1 and exit == "settle":
            pe = qstep(t, t1, edur, esteps)
            ox, oy = 30 * pe, 330 * pe ** 1.5
            r += 16 * pe * (1 if hashlib.md5(key.encode()).digest()[0] % 2 else -1)
        elif t1 is not None and t >= t1:
            pe = qstep(t, t1, edur, esteps)
            if pe >= 1:
                return None
            k = pe ** 2 * 900
            ox, oy = {"up": (0, -k), "down": (0, k), "left": (-k, 0), "right": (k, 0),
                      "downright": (k * 0.7, k * 0.7), "downleft": (-k * 0.7, k * 0.7), "shrink": (0, 0)}[exit]
            if exit == "shrink":
                s *= max(0.05, 1 - pe)
            r += 25 * pe * (1 if hashlib.md5(key.encode()).digest()[0] % 2 else -1)
        jx, jy, jr = jitter(key, self.frame, jit, jrot)
        r += jr
        im = img
        if abs(s - 1) > 1e-3 or abs(sx - 1) > 1e-3:
            im = im.resize((max(1, int(im.width * s * sx)), max(1, int(im.height * s))), Image.BILINEAR)
        if abs(r) > 0.02:
            im = im.rotate(r, expand=True, resample=Image.BICUBIC)
        if a < 0.999:
            im = im.copy()
            im.putalpha(im.getchannel("A").point(lambda v: int(v * a)))
        x = int(round(cx + ox + jx - im.width / 2))
        y = int(round(cy + oy + jy - im.height / 2))
        self.cv.alpha_composite(im, (max(-im.width + 1, min(W - 1, x)), max(-im.height + 1, min(H - 1, y)))) if (-im.width < x < W and -im.height < y < H) else None
        return (cx + ox + jx, cy + oy + jy)

    def connector(self, p1, p2, t0=0.0, key="", color=SLATE, width=4):
        if self.t < t0:
            return
        jx, jy, _ = jitter(key + "c", self.frame, 1.5, 0)
        d = ImageDraw.Draw(self.cv)
        d.line((p1[0] + jx, p1[1] + jy, p2[0] + jx, p2[1] + jy), fill=rgba(color, 200), width=width)
        r = 8
        d.ellipse((p2[0] + jx - r, p2[1] + jy - r, p2[0] + jx + r, p2[1] + jy + r), fill=rgba(AMBER), outline=rgba(color), width=3)

    def caption(self, text: str, t0: float):
        if self.t < t0 or not text:
            return
        self.put(caption_strip(text), W / 2, 985, t0=t0, enter="slide", dur=0.25, steps=3, from_dir="down", dist=220, jit=1.0, jrot=0.0, key="caption")

    def brand(self, t0=0.0):
        self.put(brand_plate(), 1690, 78, t0=t0, enter="pop", dur=0.3, jit=1.0, jrot=0.3, key="brand")


# ---------------------------------------------------------------------------
# scenes: each is draw(ctx, S) where S has .dur and .voice (caption start, local time)
# ---------------------------------------------------------------------------
STICKIES = [  # (x, y, rot, color, text)
    (560, 250, -7, YELLOW, "Prière\n8 h 45"),
    (880, 210, 5, PINK, "Maths :\nleçon 5 ?"),
    (1180, 290, -4, MINT, "Messe\nvendredi !"),
    (1480, 240, 8, SKY, "Photocopies\n!!"),
    (430, 560, 6, LILAC, "Léa :\nallergie"),
    (780, 560, -6, YELLOW, "Journée\npédago."),
    (1100, 600, 4, PINK, "Réunion\n15 h 30"),
    (1440, 580, -8, MINT, "Liste de\nclasse (CSV)"),
    (1700, 470, 6, YELLOW, "O Canada ♪"),
]

PHONE_CX, PHONE_CY = 520, 470  # shared phone position for scenes 2-4
PHONE_W = 430


def phone_pt(X, Y):
    """Screenshot pixel (1170x1992 space) -> canvas coordinates for the phone at PHONE_CX/CY."""
    s = PHONE_W / 1170
    sh_ = 1992 * s
    sb = 34
    ox = PHONE_CX - PHONE_W / 2 + 6 - 2  # frame is 12px wider (buttons) and offset by 4
    oy = PHONE_CY - (sh_ + sb + 28) / 2 + 14 + sb
    return ox + X * s, oy + Y * s


def draw_stickies(c: Ctx, t0_enter, t1_exit=None):
    for i, (x, y, rot, col, txt) in enumerate(STICKIES):
        c.put(sticky(txt, col), x, y, t0=t0_enter + i * 0.28, enter="pop", dur=0.3, rot=rot, key=f"sticky{i}",
              t1=(t1_exit + (i % 4) * 0.08) if t1_exit is not None else None, exit=["up", "left", "right", "up"][i % 4], edur=0.35)


def scene1(c: Ctx, S):
    """Monday morning: clock, coffee, a pile of sticky notes."""
    c.put(clock(240, 8, 30), 250, 250, t0=0.1, enter="pop", dur=0.3, rot=-4, key="clock", jit=1.5, jrot=0.4)
    steam = int(c.t * 4) % 3
    c.put(coffee(steam, 200), 1690, 760, t0=0.25, enter="slide", from_dir="right", dur=0.35, key="coffee", rot=3, jit=1.5, jrot=0.3)
    draw_stickies(c, 0.6)
    c.caption(S.caption, S.voice)


def scene2(c: Ctx, S):
    """The whole day on one screen."""
    draw_stickies(c, -99, t1_exit=0.0)
    c.put(clock(240, 8, 30), 250, 250, t0=-1, enter="none", rot=-4, key="clock", jit=1.5, jrot=0.4, t1=0.1, exit="left")
    c.put(coffee(0, 200), 1690, 760, t0=-1, enter="none", rot=3, key="coffee", jit=1.5, jrot=0.3, t1=0.15, exit="right")
    c.brand(0.5)
    c.put(phone("today", PHONE_W), PHONE_CX, PHONE_CY, t0=0.3, enter="slide", dur=0.5, steps=5, from_dir="down", dist=900, key="phone", jit=1.2, jrot=0.25)
    c.put(tag(tr("your whole day, one screen"), PAPER, SLATE, 44), L(1060, 1110), 130, t0=1.5, enter="pop", dur=0.3, rot=-2, key="oneScreen")
    edge_x = PHONE_CX + PHONE_W / 2 + 22
    items = [("every period", (400, 940), 3.4, 430, AMBER), ("every routine", (700, 730), 4.4, 250, MINT), ("the next lesson →", (400, 1095), 5.5, 610, SKY)]
    for i, (txt, pt, t0, ty, col) in enumerate(items):
        px, py = phone_pt(*pt)
        tg = tag(tr(txt), col, SLATE, 44)
        pos = c.put(tg, 1010, ty, t0=t0, enter="pop", dur=0.3, key=f"tag{i}", rot=(-3, 2, -2)[i])
        if pos is not None:
            c.connector((pos[0] - tg.width / 2 + 30, pos[1] + 6), (edge_x, py), t0=t0, key=f"tag{i}")
    c.caption(S.caption, S.voice)


def scene3(c: Ctx, S):
    """PA day / mass / early dismissal: the day adjusts."""
    c.brand()
    t = c.t
    # phone screen swaps with a 2-frame paper flip
    swaps = [(0.0, "today"), (0.6, "pa"), (1.9, "friday")]
    cur = "today"
    sx = 1.0
    for ts, name in swaps:
        if t >= ts:
            cur = name
            if ts > 0 and t < ts + 2 / FPS:
                sx = 0.45 if t < ts + 1 / FPS else 0.8
    c.put(phone(cur, PHONE_W), PHONE_CX, PHONE_CY, t0=-1, enter="none", key="phone", jit=1.2, jrot=0.25, sx=sx)
    c.put(calendar_card("9", "OCTOBRE", "Journée\npédagogique", BLUE), 980, 330, t0=0.6, enter="drop", dur=0.35, rot=-5, key="cal1")
    c.put(calendar_card("2", "OCTOBRE", "Messe de\nl'école", (124, 58, 237)), 1280, 330, t0=1.9, enter="drop", dur=0.35, rot=4, key="cal2")
    c.put(calendar_card("16", "OCTOBRE", "Départ\nhâtif", ORANGE), 1580, 330, t0=2.8, enter="drop", dur=0.35, rot=-3, key="cal3")
    c.put(tag(tr("no class today"), PAPER, SLATE, 36), 980, 520, t0=1.2, enter="pop", rot=-3, key="t1")
    c.put(snippet("mass_snippet", 560), 1280, 620, t0=2.4, enter="slide", from_dir="right", dur=0.35, dist=500, rot=2, key="snip")
    c.put(tag(tr("period replaced ✓"), PAPER, SLATE, 36), 1280, 740, t0=2.9, enter="pop", rot=2, key="t2")
    c.put(tag(tr("shorter afternoon"), PAPER, SLATE, 36), 1580, 520, t0=3.4, enter="pop", rot=-2, key="t3")
    c.put(tag(tr("adjusts on its own"), GREEN, WHITE, 42), 1640, 800, t0=4.0, enter="stamp", dur=0.3, steps=3, rot=-6, key="t4")
    c.caption(S.caption, S.voice)


def scene4(c: Ctx, S):
    """One tap: Leçon donnée."""
    c.brand()
    t = c.t
    tap_t = 1.35
    if t < 2 / FPS:
        cur, sx = ("friday", 0.45) if t < 1 / FPS else ("today", 0.8)
    else:
        cur, sx = ("checked" if t >= tap_t else "today"), 1.0
    c.put(phone(cur, PHONE_W), PHONE_CX, PHONE_CY, t0=-1, enter="none", key="phone", jit=1.2, jrot=0.25, sx=sx)
    bx, by = phone_pt(594, 1440)  # "Leçon donnée" button
    hs = 1.15
    hm = hand(hs)
    press = 8 if tap_t - 1 / FPS <= t < tap_t + 2 / FPS else 0
    # fingertip offset inside the hand image (shadow padding ~30)
    tip_dx, tip_dy = 63 * hs + 30 - hm.width / 2, 4 + 30 - hm.height / 2
    c.put(hm, bx - tip_dx + 4, by - tip_dy + 6 + press, t0=0.55, enter="slide", from_dir="downright", dur=0.45, steps=5, dist=700,
          rot=-8, key="hand", jit=1.5, jrot=0.4, t1=2.4, exit="downright", edur=0.4)
    if tap_t <= t < tap_t + 2 / FPS:
        c.put(tap_ring(44 if t < tap_t + 1 / FPS else 64), bx, by, t0=-1, enter="none", key="ring", jit=0, jrot=0)
    c.put(stamp("Donnée !", 250), 1040, 300, t0=tap_t + 0.2, enter="stamp", dur=0.3, steps=3, rot=-12, key="stamp", jit=1.5, jrot=0.4)
    c.put(tag(tr("undo? one tap too"), PAPER, SLATE, 34), 1330, 420, t0=2.2, enter="pop", rot=3, key="undo")
    c.put(tag(tr("the plan moves on →"), AMBER, SLATE, 44), 1180, 600, t0=2.6, enter="pop", rot=-2, key="moves")
    c.put(tag(tr("next: Leçon 5 · Les détails importants"), PAPER, SLATE, 34), 1290, 700, t0=3.1, enter="pop", rot=1, key="next")
    c.caption(S.caption, S.voice)


def scene5(c: Ctx, S):
    """Privacy: scissors cut the CSV, only Prénom goes in."""
    c.brand()
    t = c.t
    lap = laptop("csv", 880)
    LX, LY = 1420, 470
    c.put(lap, LX, LY, t0=0.1, enter="slide", from_dir="right", dur=0.4, steps=5, dist=900, key="laptop", jit=1.0, jrot=0.2)
    # CSV sheet (4 column strips, adjacent) at left
    x0, y0 = 90, 300
    widths = [CSV_COLS[i][2] for i in range(4)]
    xs = [x0 + sum(widths[:i]) for i in range(4)]
    c.put(csv_title(), x0 + 200, y0 - 70, t0=0.4, enter="pop", key="csvtitle", rot=-1, jit=1.0)
    cut1, cut2 = 0.9, 1.9  # scissors start times
    fall1, fall2 = cut1 + 0.75, cut2 + 0.75
    move_t = 2.9
    col_h = csv_column(0).height
    for i in range(4):
        col = csv_column(i)
        cx, cy = xs[i] + widths[i] / 2, y0 + col_h / 2 - 20
        if i in (0, 1):
            c.put(col, cx, cy, t0=0.45 + i * 0.08, enter="pop", key=f"col{i}", jit=0.8, jrot=0.15, rot=0,
                  t1=fall1, exit="settle", edur=0.5, esteps=4)
        elif i == 3:
            c.put(col, cx, cy, t0=0.45 + i * 0.08, enter="pop", key=f"col{i}", jit=0.8, jrot=0.15,
                  t1=fall2, exit="settle", edur=0.5, esteps=4)
        else:
            # Prénom slides into the laptop screen (the preview list) and shrinks
            p = qstep(t, move_t, 0.6, 6)
            tx, ty = LX + 45, LY + 60
            ex, ey = cx + (tx - cx) * p, cy + (ty - cy) * p
            sc = 1 - 0.55 * p
            c.put(col, ex, ey, t0=0.45 + i * 0.08, enter="pop", key=f"col{i}", jit=0.8, jrot=0.15, scale=sc, rot=-6 * p,
                  t1=move_t + 0.75, exit="shrink", edur=0.25, esteps=2)
    # scissors travel down the cut lines
    for k, (tc, xcut) in enumerate(((cut1, xs[2]), (cut2, xs[3]))):
        if tc <= t < tc + 0.75:
            p = qstep(t, tc, 0.7, 6)
            fr = int(round((t - tc) * FPS))
            sc = scissors(30 if fr % 2 == 0 else 6, 150)
            c.put(sc, xcut + 4, y0 - 120 + p * (col_h + 60), t0=-1, enter="none", key=f"sciss{k}", jit=1.5, jrot=1.0)
    c.put(tag(tr("never sent: last names,\nstudent numbers, birthdates"), RED, WHITE, 36), 560, 770, t0=fall2 + 0.5, enter="stamp", dur=0.3, steps=3, rot=-6, key="never")
    c.put(tag(tr("first names only ✓"), GREEN, WHITE, 44), 1500, 820, t0=move_t + 0.9, enter="stamp", dur=0.3, steps=3, rot=-5, key="firstnames")
    c.put(tag(tr("read on your device"), AMBER, SLATE, 38), 1120, 170, t0=0.8, enter="pop", rot=2, key="ondevice")
    c.caption(S.caption, S.voice)


def scene6(c: Ctx, S):
    """Medical alerts: encrypted, hidden until revealed, every view logged."""
    c.brand()
    t = c.t
    c.put(laptop("alerts", 900), 600, 470, t0=0.1, enter="slide", from_dir="left", dur=0.4, steps=5, dist=900, key="laptop", jit=1.0, jrot=0.2)
    reveal = 2.6
    snip = snippet("alert_row", 950)
    SX, SY = 1380, 340
    pos = c.put(snip, SX, SY, t0=0.6, enter="pop", dur=0.3, rot=1.5, key="snip", jit=1.0, jrot=0.2)
    # cover strip over the alert line (snippet coords: crop is 1540x210 -> 950 wide, scale .617)
    if pos is not None:
        s = 950 / 1540
        paper_x = pos[0] - (950 + 28) / 2 + 14
        paper_y = pos[1] - (int(210 * s) + 28) / 2 + 14
        cov_cx = paper_x + (55 + 1060) / 2 * s
        cov_cy = paper_y + (125 + 200) / 2 * s
        c.put(cover_strip(int(1010 * s), int(74 * s), tr("masqué")), cov_cx, cov_cy, t0=0.65, enter="fade", dur=0.1, steps=1, key="cover", jit=0.6, jrot=0.1,
              t1=reveal, exit="up", edur=0.4, esteps=4)
    c.put(lock(150, is_open=t >= reveal), 1080, 640, t0=0.9, enter="pop", rot=-6, key="lock", jit=1.2, jrot=0.3)
    c.put(tag(tr("encrypted"), BLUE, WHITE, 42), 1080, 820, t0=1.2, enter="pop", rot=-3, key="enc")
    c.put(eye(150, closed=t < reveal), 1330, 640, t0=1.5, enter="pop", rot=3, key="eye", jit=1.2, jrot=0.3)
    c.put(tag(tr("hidden until you reveal it"), PAPER, SLATE, 36), L(1360, 1420), L(820, 830), t0=1.8, enter="pop", rot=2, key="hid")
    c.put(tag(tr("every view is logged ✎"), AMBER, SLATE, 38), 1690, 640, t0=reveal + 0.5, enter="stamp", dur=0.3, steps=3, rot=-4, key="log")
    c.caption(S.caption, S.voice)


def scene7(c: Ctx, S):
    """Made for French Catholic schools in Ontario."""
    c.brand()
    c.put(laptop("timetable", 1080), 960, 450, t0=0.1, enter="slide", from_dir="down", dur=0.45, steps=5, dist=900, key="laptop", jit=1.0, jrot=0.2)
    c.put(maple_leaf(210), 1760, 300, t0=1.3, enter="drop", dur=0.4, rot=12, key="leaf", jit=1.5, jrot=0.5)
    c.put(tag("Ontario", PAPER, SLATE, 40), 1760, 440, t0=1.6, enter="pop", rot=-3, key="ont")
    c.put(tag(tr("rotating Jour 1 … 6 ✓"), AMBER, SLATE, 42), 1620, 600, t0=2.9, enter="pop", rot=3, key="jour")
    c.put(tag(tr("rotary teachers ✓"), MINT, SLATE, 42), L(1660, 1640), 700, t0=3.8, enter="pop", rot=-2, key="rot")
    c.put(tag(tr("combined grades ✓"), SKY, SLATE, 42), 1600, 800, t0=4.3, enter="pop", rot=2, key="comb")
    c.put(tag("prière du matin ✝", PAPER, SLATE, 42), 250, 330, t0=4.9, enter="pop", rot=-4, key="pri")
    c.put(tag("O Canada ♪", PAPER, SLATE, 42), 230, 450, t0=5.4, enter="pop", rot=3, key="oc")
    c.put(tag("messe de l'école", LILAC, SLATE, 42), 250, 570, t0=5.9, enter="pop", rot=-2, key="messe")
    c.put(tag(tr("in French, on your phone"), PINK, SLATE, 40), L(300, 340), L(760, 800), t0=6.5, enter="pop", rot=2, key="fr")
    c.caption(S.caption, S.voice)


def scene8(c: Ctx, S):
    """Coming soon: the one-tap sick day."""
    t = c.t
    c.put(ribbon(tr("BIENTÔT  ·  COMING SOON"), fsize=L(30, 42)), 1745, 235, t0=0.0, enter="none", rot=-45, key="ribbon", jit=1.0, jrot=0.2)
    ring = 0.6 <= t < 2.3
    fr = int(round(t * FPS))
    wob = (6 if fr % 2 == 0 else -6) if ring else 0
    c.put(clock(230, 6, 0, alarm=True), 330, 330, t0=0.5, enter="pop", dur=0.3, rot=wob - 3, key="alarm", jit=2.5 if ring else 1.2, jrot=0.5)
    c.put(thermometer(200), 620, 300, t0=1.3, enter="drop", dur=0.35, rot=18, key="thermo")
    c.put(sticky("Malade...\n☹", PINK, 220, 50), 560, 560, t0=1.6, enter="pop", rot=-7, key="sick")
    pressed = 3.25 <= t < 3.25 + 2 / FPS
    c.put(big_button(pressed=pressed), 1200, 300, t0=2.4, enter="pop", dur=0.35, rot=-2, key="btn", jit=1.2, jrot=0.3)
    c.put(tag(tr("coming soon"), RED, WHITE, 32, padx=18, pady=8), 1430, 225, t0=2.55, enter="pop", rot=-10, key="soon", jit=1.0)
    hm = hand(1.1)
    tip_dx, tip_dy = 63 * 1.1 + 30 - hm.width / 2, 4 + 30 - hm.height / 2
    c.put(hm, 1250 - tip_dx, 300 - tip_dy + (8 if pressed else 0), t0=2.7, enter="slide", from_dir="downright", dur=0.4, steps=5, dist=700,
          rot=-8, key="hand", jit=1.5, jrot=0.4, t1=3.6, exit="right", edur=0.4)
    n = 0
    if t >= 3.7:
        n = min(len(PLAN_LINES), int((t - 3.9) / 0.32) + 1) if t >= 3.9 else 0
    c.put(plan_sheet(max(0, n), tr("Notes pour la suppléance")), 1180, 640, t0=3.7, enter="slide", from_dir="down", dur=0.35, steps=4, dist=500, rot=1.5, key="plan", jit=1.0, jrot=0.2)
    c.put(tag(tr("picks up right where\nyou left off"), AMBER, SLATE, 40), L(1700, 1690), 600, t0=5.3, enter="stamp", dur=0.3, steps=3, rot=-5, key="pick")
    c.caption(S.caption, S.voice)


def scene9(c: Ctx, S):
    """End card."""
    t = c.t
    c.put(end_card(), 960, 430, t0=0.05, enter="pop", dur=0.3, key="card", jit=1.0, jrot=0.2)
    c.put(app_icon(190), 640, 400, t0=0.4, enter="drop", dur=0.4, dist=600, rot=-4, key="icon", jit=1.2, jrot=0.4)
    c.put(text_img("Lynx École", font("bold", 100), SLATE), 1150, 350, t0=0.7, enter="slide", from_dir="right", dur=0.35, steps=4, dist=400, key="name", jit=1.0, jrot=0.0)
    c.put(text_img(tr("Less paperwork, more teaching."), font("handb", L(66, 58)), BLUE), L(1150, 960), L(450, 556), t0=1.4, enter="pop", dur=0.3, key="tagline", jit=1.0, jrot=0.0)
    c.put(text_img(tr("A working name. All demo data shown is fictional."), font("sans", 24), (100, 110, 130)), 960, 640, t0=1.8, enter="fade", dur=0.2, steps=2, key="foot", jit=0.5, jrot=0.0)
    c.put(sticky(tr("We'd love\nyour\nfeedback!"), AMBER, 250, L(48, 42)), 1600, 720, t0=2.8, enter="pop", dur=0.35, rot=8, key="fb", jit=1.5, jrot=0.5)
    c.put(sticky(tr("Merci !\n♥"), MINT, 170, 46), 300, 720, t0=3.4, enter="pop", dur=0.3, rot=-9, key="merci", jit=1.5, jrot=0.5)
    cols = [BLUE, AMBER, PINK, MINT, SKY, RED]
    rng = np.random.default_rng(5)
    for i in range(34):
        x, y = rng.uniform(380, 1540), rng.uniform(80, 800)
        if 440 < x < 1480 and 150 < y < 700:
            continue
        c.put(confetti(cols[i % 6]), x, y, t0=0.5 + rng.uniform(0, 0.6), enter="pop", dur=0.25, steps=2, rot=rng.uniform(-60, 60), key=f"conf{i}", jit=2.5, jrot=8)
    c.caption(S.caption, S.voice)


SCENES = [scene1, scene2, scene3, scene4, scene5, scene6, scene7, scene8, scene9]
SCENE_TITLES = ["Monday morning", "Whole day, one screen", "Day adjusts itself", "One tap: Leçon donnée",
                "First names only", "Encrypted alerts", "Made for Ontario", "Coming soon: sick day", "End card"]
SCENE_TITLES_FR = ["Lundi matin", "Toute la journée, un écran", "La journée s'ajuste", "Une touche : Leçon donnée",
                   "Prénoms seulement", "Alertes chiffrées", "Conçue pour l'Ontario", "Bientôt : journée de maladie", "Carte de fin"]


def scene_titles() -> list[str]:
    return SCENE_TITLES if LANG == "en" else SCENE_TITLES_FR
