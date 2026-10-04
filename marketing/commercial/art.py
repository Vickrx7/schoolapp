"""Art for the commercial: the papercraft primitives of ../promo/promo_art.py, plus devices that
hold real app screenshots (phone with scrolling, laptop with panning, projector, tablet), paper
props, chapter cards and captions with pages.

Screenshots live in screens/ with a JSON per image giving the boxes of the elements the video
points at, in screenshot pixels (written by the capture walkthrough, see README.md).
"""
from __future__ import annotations

import json
import math
import os
import sys
from functools import lru_cache

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "promo"))
import promo_art as P  # noqa: E402
from promo_art import (  # noqa: E402,F401
    AMBER, BLUE, DARK, FPS, GREEN, GREY, H, KRAFT, LILAC, MINT, ORANGE, PAPER, PINK, RED, SKIN, SKY, SLATE, W,
    WHITE, YELLOW, Ctx, add_tape, app_icon, calendar_card, clock, coffee, confetti, darken, eye, font, hand, jitter,
    lighten, lock, maple_leaf, paper_card, paper_texture, qstep, rgba, rich_measure, shadow, stamp, sticky, tag,
    tap_ring, text_center, text_img, text_size, thermometer,
)

SCREENS = os.path.join(HERE, "screens")
PURPLE = (124, 58, 237)
NAVY = (22, 30, 60)
APP = "Lynx École"

LANG = "en"


def set_lang(lang: str):
    global LANG
    if lang not in ("en", "fr"):
        raise ValueError(lang)
    LANG = lang
    P.set_lang(lang)


def T(en: str, fr: str) -> str:
    if LANG == "en":
        return en
    from script import fr_typo
    return fr_typo(fr)


def background():
    return P.background()


# ---------------------------------------------------------------------------
# screenshots
# ---------------------------------------------------------------------------
@lru_cache(maxsize=None)
def shot(name: str) -> Image.Image:
    for ext in (".webp", ".png", ".jpg"):
        p = os.path.join(SCREENS, name + ext)
        if os.path.exists(p):
            return Image.open(p).convert("RGB")
    raise FileNotFoundError(name)


@lru_cache(maxsize=None)
def boxes(name: str) -> dict:
    p = os.path.join(SCREENS, name + ".json")
    if not os.path.exists(p):
        return {}
    return {k: tuple(v) for k, v in json.load(open(p))["boxes"].items()}


def box(name: str, key: str, default=None):
    b = boxes(name).get(key)
    if b is None:
        if default is None:
            raise KeyError(f"{name}.{key}")
        return default
    return b


class Placed:
    """Where a device's screen landed on the canvas: maps screenshot pixels to canvas pixels."""

    def __init__(self, x0, y0, scale, src_x0=0, src_y0=0, size=None):
        self.x0, self.y0, self.scale, self.src_x0, self.src_y0 = x0, y0, scale, src_x0, src_y0
        self.size = size  # (w, h) of the visible screen on the canvas

    def visible(self, p, margin=4):
        if self.size is None:
            return True
        return (self.x0 - margin <= p[0] <= self.x0 + self.size[0] + margin
                and self.y0 - margin <= p[1] <= self.y0 + self.size[1] + margin)

    def pt(self, X, Y):
        return self.x0 + (X - self.src_x0) * self.scale, self.y0 + (Y - self.src_y0) * self.scale

    def rect(self, b):
        x, y, w, h = b
        x0, y0 = self.pt(x, y)
        return x0, y0, x0 + w * self.scale, y0 + h * self.scale

    def mid(self, b, fx=0.5, fy=0.5):
        x0, y0, x1, y1 = self.rect(b)
        return x0 + (x1 - x0) * fx, y0 + (y1 - y0) * fy


# ---------------------------------------------------------------------------
# devices. Each builder returns (image, (sx, sy) screen origin inside the image, scale).
# ---------------------------------------------------------------------------
SHADOW_PAD = {"dev": 12 * 2 + 14 + 6}  # shadow(im, 8, 14, 12): pad = int(12*2.5)+14 = 44


def _pad(blur, dx, dy):
    return int(blur * 2.5) + max(abs(dx), abs(dy))


def status_bar(d: ImageDraw.ImageDraw, sw: int, time_txt: str, dark=False):
    col = WHITE if dark else SLATE
    d.text((22, 7), time_txt, font=font("bold", 19), fill=col)
    d.rounded_rectangle((sw - 52, 10, sw - 20, 24), 4, outline=col, width=2)
    d.rectangle((sw - 49, 13, sw - 27, 21), fill=col)
    d.rectangle((sw - 19, 14, sw - 16, 20), fill=col)
    for i in range(4):
        d.rectangle((sw - 92 + i * 8, 22 - 4 * i - 4, sw - 87 + i * 8, 24), fill=col)


PHONE_NAV = {"today-phone-full": "today-phone", "mass-phone": "today-phone", "early-phone": "today-phone",
             "coverage-phone-full": "today-phone"}


@lru_cache(maxsize=256)
def phone(name: str, screen_w: int = 370, scroll: int = 0, view_h: int = 2532, time_txt: str = "8:30", dim: float = 0.0):
    """A phone holding `name`, showing `view_h` screenshot pixels starting at `scroll`."""
    src = shot(name)
    scroll = max(0, min(scroll, src.height - view_h)) if src.height > view_h else 0
    crop = src.crop((0, scroll, src.width, scroll + min(view_h, src.height)))
    nav = PHONE_NAV.get(name)
    if nav:  # full-page captures lose their fixed bottom bar: paste it back from the viewport capture
        vsrc = shot(nav)
        bar = vsrc.crop((0, vsrc.height - 165, vsrc.width, vsrc.height))
        crop = crop.copy()
        crop.paste(bar, (0, crop.height - bar.height))
    scale = screen_w / src.width
    sh_ = int(round(crop.height * scale))
    sb, bez = 34, 14
    fw, fh = screen_w + 2 * bez, sh_ + sb + 2 * bez
    im = Image.new("RGBA", (fw + 12, fh), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    for y0, y1, x0, x1 in ((190, 260, 0, 8), (280, 350, 0, 8), (230, 330, fw - 2, fw + 8)):
        d.rounded_rectangle((x0, y0, x1, y1), 3, fill=rgba((40, 44, 54)))
    d.rounded_rectangle((4, 0, 4 + fw - 1, fh - 1), 62, fill=rgba(DARK), outline=rgba((70, 75, 88)), width=2)
    scr = Image.new("RGBA", (screen_w, sh_ + sb), rgba(WHITE))
    scr.paste(crop.resize((screen_w, sh_), Image.LANCZOS), (0, sb))
    status_bar(ImageDraw.Draw(scr), screen_w, time_txt)
    if dim > 0:
        ov = Image.new("RGBA", scr.size, (10, 14, 40, int(255 * dim)))
        scr.alpha_composite(ov)
    mask = Image.new("L", scr.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, screen_w - 1, sh_ + sb - 1), 46, fill=255)
    im.paste(scr, (4 + bez, bez), mask)
    pad = _pad(12, 8, 14)
    return shadow(im, 8, 14, 12, 0.4), (pad + 4 + bez, pad + bez + sb), scale, scroll, (screen_w, sh_)


@lru_cache(maxsize=256)
def laptop(name: str, screen_w: int = 1000, view: tuple | None = None):
    """A laptop showing the `view` (x, y, w, h) part of a desktop screenshot (whole image if None)."""
    src = shot(name)
    if view is None:
        view = (0, 0, src.width, min(src.height, int(src.width * 0.625)))
    vx, vy, vw, vh = view
    vy = max(0, min(vy, src.height - vh))
    crop = src.crop((vx, vy, vx + vw, vy + vh))
    scale = screen_w / vw
    sh_ = int(round(vh * scale))
    bez, base_h, ext = 16, 30, 70
    fw, fh = screen_w + 2 * bez, sh_ + 2 * bez
    im = Image.new("RGBA", (fw + 2 * ext, fh + base_h + 6), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.rounded_rectangle((ext, 0, ext + fw - 1, fh - 1), 20, fill=rgba((43, 47, 58)), outline=rgba((80, 85, 100)), width=2)
    scr = crop.resize((screen_w, sh_), Image.LANCZOS).convert("RGBA")
    mask = Image.new("L", scr.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, screen_w - 1, sh_ - 1), 8, fill=255)
    im.paste(scr, (ext + bez, bez), mask)
    d.rounded_rectangle((0, fh - 2, fw + 2 * ext - 1, fh + base_h), 14, fill=rgba(GREY), outline=rgba(darken(GREY, 0.8)), width=2)
    d.rounded_rectangle((fw / 2 + ext - 90, fh - 2, fw / 2 + ext + 90, fh + 10), 6, fill=rgba(darken(GREY, 0.9)))
    d.rectangle((0, fh - 2, fw + 2 * ext - 1, fh + 4), fill=rgba(lighten(GREY, 0.4)))
    pad = _pad(12, 8, 14)
    return shadow(im, 8, 14, 12, 0.4), (pad + ext + bez, pad + bez), scale, (vx, vy), (screen_w, sh_)


@lru_cache(maxsize=64)
def projector_screen(name: str, screen_w: int = 1100, view: tuple | None = None):
    """A pull-down projection screen showing a desktop screenshot."""
    src = shot(name)
    if view is None:
        view = (0, 0, src.width, src.height)
    vx, vy, vw, vh = view
    crop = src.crop((vx, vy, vx + vw, vy + vh))
    scale = screen_w / vw
    sh_ = int(round(vh * scale))
    border = 26
    roller = 34
    w, h = screen_w + 2 * border, sh_ + 2 * border + roller + 40
    im = Image.new("RGBA", (w + 40, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    # roller
    d.rounded_rectangle((0, 0, w + 39, roller), 16, fill=rgba((70, 76, 92)), outline=rgba((40, 44, 54)), width=2)
    # fabric
    d.rectangle((20, roller - 4, 20 + w - 1, roller + sh_ + 2 * border), fill=rgba((248, 248, 245)), outline=rgba((205, 208, 214)), width=2)
    scr = crop.resize((screen_w, sh_), Image.LANCZOS).convert("RGBA")
    # a projector is a little soft and warm
    scr = Image.blend(scr, Image.new("RGBA", scr.size, (255, 250, 235, 255)), 0.06)
    im.paste(scr, (20 + border, roller + border))
    # bottom bar + pull string
    yb = roller + sh_ + 2 * border
    d.rounded_rectangle((14, yb - 6, 26 + w, yb + 10), 6, fill=rgba((90, 96, 112)))
    cx = 20 + w / 2
    d.line((cx, yb + 10, cx, yb + 34), fill=rgba((90, 96, 112)), width=3)
    d.ellipse((cx - 9, yb + 30, cx + 9, yb + 46), fill=rgba(AMBER), outline=rgba(SLATE), width=2)
    im = paper_texture(im, 2.5)
    pad = _pad(10, 6, 10)
    return shadow(im, 6, 10, 10, 0.35), (pad + 20 + border, pad + roller + border), scale, (vx, vy), (screen_w, sh_)


@lru_cache(maxsize=32)
def tablet(name: str | None = None, screen_w: int = 560, screen_h: int = 380, label: str = "", fill_img: Image.Image | None = None):
    """A landscape tablet. `name` is drawn at the top of a white screen, or `label` is centred."""
    bez = 22
    w, h = screen_w + 2 * bez, screen_h + 2 * bez
    im = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.rounded_rectangle((0, 0, w - 1, h - 1), 36, fill=rgba((38, 42, 52)), outline=rgba((80, 85, 100)), width=2)
    scr = Image.new("RGBA", (screen_w, screen_h), rgba(WHITE))
    scale = 1.0
    if name:
        src = shot(name)
        scale = screen_w / src.width
        sh_ = int(round(src.height * scale))
        scr.paste(src.resize((screen_w, sh_), Image.LANCZOS), (0, max(0, (screen_h - sh_) // 2)))
    if label:
        sd = ImageDraw.Draw(scr)
        text_center(sd, screen_w / 2, screen_h / 2, label, font("bold", 44), SLATE)
    mask = Image.new("L", scr.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, screen_w - 1, screen_h - 1), 16, fill=255)
    im.paste(scr, (bez, bez), mask)
    d.ellipse((w - bez / 2 - 5, h / 2 - 5, w - bez / 2 + 5, h / 2 + 5), fill=rgba((70, 75, 88)))
    pad = _pad(10, 6, 10)
    return shadow(im, 6, 10, 10, 0.38), (pad + bez, pad + bez), scale


def place_device(c: Ctx, built, cx, cy, **kw) -> Placed | None:
    """Puts a device built by phone()/laptop()/projector_screen() and returns its screen mapping."""
    img, (sx, sy), scale = built[0], built[1], built[2]
    src0 = built[3] if len(built) > 3 else (0, 0)
    size = built[4] if len(built) > 4 else None
    if isinstance(src0, int):  # phone: scroll offset
        src0 = (0, src0)
    pos = c.put(img, cx, cy, **kw)
    if pos is None:
        return None
    x0 = pos[0] - img.width / 2 + sx
    y0 = pos[1] - img.height / 2 + sy
    return Placed(x0, y0, scale, src0[0], src0[1], size)


# ---------------------------------------------------------------------------
# paper props
# ---------------------------------------------------------------------------
@lru_cache(maxsize=None)
def brand_plate() -> Image.Image:
    icon = Image.open(P.ICON).convert("RGBA").resize((56, 56), Image.LANCZOS)
    fnt = font("bold", 36)
    b = text_size(APP, fnt)
    w = 18 + 56 + 14 + (b[2] - b[0]) + 22
    im = paper_card(w, 80, PAPER, 18)
    im.alpha_composite(icon, (18, 12))
    d = ImageDraw.Draw(im)
    d.text((18 + 56 + 14 - b[0], 40 - (b[1] + b[3]) / 2), APP, font=fnt, fill=SLATE)
    return shadow(paper_texture(im, 3), 4, 7, 6, 0.3)


@lru_cache(maxsize=None)
def chapter_card(num: int, title: str, big: bool = True) -> Image.Image:
    if big:
        fnt_n, fnt_t, w, h = font("bold", 120), font("handb", 92), 0, 300
        tw, th, _, _ = rich_measure(title, fnt_t)
        w = int(max(560, tw + 180))
        im = paper_card(w, h, PAPER, 26)
        d = ImageDraw.Draw(im)
        d.rounded_rectangle((0, 0, w - 1, 22), 12, fill=rgba(BLUE))
        d.rectangle((0, 12, w - 1, 22), fill=rgba(BLUE))
        text_center(d, w / 2, 112, str(num), fnt_n, AMBER if False else BLUE)
        text_center(d, w / 2, 222, title, fnt_t, SLATE)
        im = paper_texture(im, 3)
        im = shadow(im, 8, 14, 12, 0.35)
        add_tape(im, im.width / 2, 44, rot=-4, w=150)
        return im
    fnt = font("handb", 36)
    txt = f"{num} · {title}"
    tw, th, _, _ = rich_measure(txt, fnt)
    w, h = int(tw + 60), 70
    im = paper_card(w, h, PAPER, 14)
    d = ImageDraw.Draw(im)
    d.rectangle((0, 0, 12, h - 1), fill=rgba(BLUE))
    text_center(d, w / 2 + 6, h / 2 - 2, txt, fnt, SLATE)
    im = paper_texture(im, 3)
    im = shadow(im, 4, 7, 6, 0.3)
    add_tape(im, 40, 30, rot=-30, w=80)
    return im


@lru_cache(maxsize=None)
def caption_strip(text: str) -> Image.Image:
    return P.caption_strip(text)


@lru_cache(maxsize=None)
def label(text: str, size=40, color=SLATE, kind="handb") -> Image.Image:
    return text_img(text, font(kind, size), color)


@lru_cache(maxsize=None)
def sheet(title: str, lines: tuple = (), w=520, h=660, title_color=BLUE, ruled=True, stamp_txt: str = "") -> Image.Image:
    """A sheet of paper with a handwritten title and a few typed lines."""
    im = paper_card(w, h, WHITE, 8)
    d = ImageDraw.Draw(im)
    if ruled:
        for y in range(150, h - 30, 46):
            d.line((30, y, w - 30, y), fill=rgba((215, 222, 232)), width=2)
    d.text((36, 30), title, font=font("handb", 50), fill=title_color)
    for i, ln in enumerate(lines):
        d.text((40, 108 + i * 46), ln, font=font("sans", 24), fill=(60, 70, 90))
    im = paper_texture(im, 3)
    return shadow(im, 6, 10, 8, 0.33)


@lru_cache(maxsize=None)
def doc_image(name: str, w: int = 520) -> Image.Image:
    """A screenshot printed on paper (a PDF page)."""
    src = shot(name)
    h = int(round(src.height * w / src.width))
    im = paper_card(w + 16, h + 16, WHITE, 6)
    im.paste(src.resize((w, h), Image.LANCZOS), (8, 8))
    return shadow(im, 6, 10, 8, 0.33)


@lru_cache(maxsize=None)
def zoom_card(name: str, b: tuple, width: int = 520, pad: int = 14, ring=AMBER) -> Image.Image:
    """A crop of a screenshot (box b, with a margin) mounted on paper, like a magnified detail."""
    src = shot(name)
    x, y, w, h = b
    m = int(max(w, h) * 0.12) + 10
    crop = src.crop((max(0, x - m), max(0, y - m), min(src.width, x + w + m), min(src.height, y + h + m)))
    hh = int(round(crop.height * width / crop.width))
    im = paper_card(width + 2 * pad, hh + 2 * pad, PAPER, 12)
    im.paste(crop.resize((width, hh), Image.LANCZOS), (pad, pad))
    d = ImageDraw.Draw(im)
    d.rounded_rectangle((pad - 3, pad - 3, pad + width + 2, pad + hh + 2), 10, outline=rgba(ring), width=6)
    im = paper_texture(im, 2)
    return shadow(im, 6, 10, 8, 0.35)


@lru_cache(maxsize=None)
def magnifier(size=120) -> Image.Image:
    im = Image.new("RGBA", (size * 2, size * 2), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    r = size * 0.55
    c = size * 0.8
    d.line((c + r * 0.7, c + r * 0.7, c + r * 1.75, c + r * 1.75), fill=rgba((120, 72, 40)), width=int(size * 0.2))
    d.ellipse((c - r, c - r, c + r, c + r), fill=(200, 230, 255, 120), outline=rgba(SLATE), width=int(size * 0.1))
    d.arc((c - r * 0.65, c - r * 0.65, c + r * 0.3, c + r * 0.3), 190, 260, fill=rgba(WHITE, 220), width=6)
    im = paper_texture(im, 3)
    return shadow(im, 4, 7, 6, 0.3)


def highlight(c: Ctx, rect, t0: float, key: str, color=AMBER, width=7, pad=8):
    """A hand-drawn ring around a canvas rect (x0, y0, x1, y1), appearing at t0."""
    if c.t < t0:
        return
    jx, jy, _ = jitter(key + "hl", c.frame, 1.5, 0)
    x0, y0, x1, y1 = rect
    d = ImageDraw.Draw(c.cv)
    p = qstep(c.t, t0, 0.25, 3)
    if p <= 0:
        return
    # draw the ring progressively (stop-motion: 3 steps)
    extent = 360 * p
    d.rounded_rectangle((x0 - pad + jx, y0 - pad + jy, x1 + pad + jx, y1 + pad + jy), 16, outline=rgba(color, 235), width=width) if p >= 1 else \
        d.arc((x0 - pad + jx, y0 - pad + jy, x1 + pad + jx, y1 + pad + jy), -90, -90 + extent, fill=rgba(color, 235), width=width)


def connector(c: Ctx, p1, p2, t0: float, key: str, color=SLATE, width=4):
    c.connector(p1, p2, t0=t0, key=key, color=color, width=width)


@lru_cache(maxsize=None)
def school_building(w=420) -> Image.Image:
    h = int(w * 0.95)
    im = Image.new("RGBA", (w + 40, h + 40), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    ox, oy = 20, 20
    body_top = oy + h * 0.42
    d.rectangle((ox + w * 0.05, body_top, ox + w * 0.95, oy + h), fill=rgba((214, 120, 90)), outline=rgba(darken((214, 120, 90), 0.7)), width=3)
    # bricks
    for yy in range(int(body_top) + 14, int(oy + h), 18):
        d.line((ox + w * 0.05, yy, ox + w * 0.95, yy), fill=rgba(darken((214, 120, 90), 0.88)), width=1)
    # central tower with a cross
    tx0, tx1 = ox + w * 0.36, ox + w * 0.64
    d.rectangle((tx0, oy + h * 0.2, tx1, body_top + 4), fill=rgba((232, 140, 108)), outline=rgba(darken((214, 120, 90), 0.7)), width=3)
    d.polygon([(tx0 - 14, oy + h * 0.2), ((tx0 + tx1) / 2, oy + h * 0.06), (tx1 + 14, oy + h * 0.2)], fill=rgba((90, 96, 112)))
    cxm = (tx0 + tx1) / 2
    d.rectangle((cxm - 4, oy - 6, cxm + 4, oy + h * 0.08), fill=rgba(AMBER))
    d.rectangle((cxm - 16, oy + 6, cxm + 16, oy + 14), fill=rgba(AMBER))
    # bell window
    d.rounded_rectangle((cxm - 26, oy + h * 0.25, cxm + 26, oy + h * 0.36), 20, fill=rgba(SLATE))
    d.ellipse((cxm - 12, oy + h * 0.27, cxm + 12, oy + h * 0.34), fill=rgba(AMBER))
    # roof
    d.polygon([(ox, body_top + 4), (ox + w * 0.05, body_top - 18), (ox + w * 0.95, body_top - 18), (ox + w, body_top + 4)], fill=rgba((90, 96, 112)))
    # windows and door
    for i in range(4):
        x = ox + w * (0.1 + i * 0.22) + (w * 0.1 if i >= 2 else 0) - (w * 0.03 if i >= 2 else 0)
        if tx0 - 10 < x + 40 and x < tx1 + 10:
            continue
        for row in range(2):
            y = body_top + 30 + row * h * 0.2
            d.rectangle((x, y, x + w * 0.12, y + h * 0.13), fill=rgba(SKY), outline=rgba(WHITE), width=4)
    d.rounded_rectangle((cxm - w * 0.08, oy + h * 0.75, cxm + w * 0.08, oy + h), 18, fill=rgba(BLUE), outline=rgba(darken(BLUE, 0.7)), width=3)
    im = paper_texture(im, 4)
    return shadow(im, 6, 10, 8, 0.33)


@lru_cache(maxsize=None)
def server_rack(w=230, h=330, lights=(GREEN, AMBER, GREEN)) -> Image.Image:
    im = Image.new("RGBA", (w + 20, h + 20), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.rounded_rectangle((10, 10, 10 + w, 10 + h), 16, fill=rgba((52, 58, 72)), outline=rgba((30, 34, 44)), width=3)
    for i in range(5):
        y = 30 + i * (h - 40) / 5
        d.rounded_rectangle((26, y, w - 6, y + (h - 40) / 5 - 12), 6, fill=rgba((70, 78, 96)))
        for k in range(6):
            d.line((40 + k * 12, y + 10, 40 + k * 12, y + (h - 40) / 5 - 22), fill=rgba((45, 50, 62)), width=4)
        col = lights[i % len(lights)]
        d.ellipse((w - 40, y + 14, w - 26, y + 28), fill=rgba(col))
    im = paper_texture(im, 3)
    return shadow(im, 6, 10, 8, 0.33)


@lru_cache(maxsize=None)
def cloud(w=260, crossed=False, text="") -> Image.Image:
    h = int(w * 0.62)
    im = Image.new("RGBA", (w + 40, h + 40), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    ox, oy = 20, 20
    col = (226, 236, 250)
    for (cx, cy, r) in ((0.3, 0.6, 0.24), (0.5, 0.42, 0.3), (0.72, 0.58, 0.24), (0.5, 0.7, 0.25)):
        d.ellipse((ox + (cx - r) * w, oy + (cy - r * 1.3) * h, ox + (cx + r) * w, oy + (cy + r * 1.3) * h), fill=rgba(col), outline=rgba((150, 165, 190)), width=3)
    for (cx, cy, r) in ((0.3, 0.6, 0.22), (0.5, 0.42, 0.28), (0.72, 0.58, 0.22), (0.5, 0.7, 0.23)):
        d.ellipse((ox + (cx - r) * w, oy + (cy - r * 1.3) * h, ox + (cx + r) * w, oy + (cy + r * 1.3) * h), fill=rgba(col))
    if text:
        text_center(d, ox + w / 2, oy + h * 0.6, text, font("handb", int(w * 0.13)), SLATE)
    if crossed:
        d.line((ox + w * 0.2, oy + h * 0.2, ox + w * 0.8, oy + h * 0.95), fill=rgba(RED, 230), width=9)
        d.line((ox + w * 0.8, oy + h * 0.2, ox + w * 0.2, oy + h * 0.95), fill=rgba(RED, 230), width=9)
    im = paper_texture(im, 3)
    return shadow(im, 5, 9, 7, 0.3)


@lru_cache(maxsize=None)
def browser_card(lines: tuple, w=640, h=360, url="") -> Image.Image:
    im = paper_card(w, h, WHITE, 16)
    d = ImageDraw.Draw(im)
    d.rounded_rectangle((0, 0, w - 1, 58), 16, fill=rgba((226, 230, 238)))
    d.rectangle((0, 40, w - 1, 58), fill=rgba((226, 230, 238)))
    for i, col in enumerate(((240, 90, 90), (245, 190, 60), (90, 190, 110))):
        d.ellipse((20 + i * 26, 20, 36 + i * 26, 36), fill=rgba(col))
    d.rounded_rectangle((110, 14, w - 24, 44), 14, fill=rgba(WHITE))
    if url:
        d.text((128, 18), url, font=font("sans", 18), fill=(110, 118, 135))
    for i, ln in enumerate(lines):
        d.text((32, 84 + i * 42), ln, font=font("sans", 25), fill=SLATE)
    im = paper_texture(im, 2)
    return shadow(im, 6, 10, 8, 0.33)


@lru_cache(maxsize=None)
def backpack(w=300) -> Image.Image:
    h = int(w * 1.15)
    im = Image.new("RGBA", (w + 40, h + 40), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    ox, oy = 20, 20
    col = (59, 130, 246)
    d.arc((ox + w * 0.3, oy - 10, ox + w * 0.7, oy + h * 0.25), 180, 360, fill=rgba(darken(col, 0.7)), width=14)
    d.rounded_rectangle((ox, oy + h * 0.1, ox + w, oy + h), int(w * 0.25), fill=rgba(col), outline=rgba(darken(col, 0.7)), width=4)
    d.rounded_rectangle((ox + w * 0.15, oy + h * 0.55, ox + w * 0.85, oy + h * 0.92), int(w * 0.12), fill=rgba(darken(col, 0.85)), outline=rgba(darken(col, 0.65)), width=3)
    d.line((ox + w * 0.2, oy + h * 0.62, ox + w * 0.8, oy + h * 0.62), fill=rgba(AMBER), width=6)
    im = paper_texture(im, 4)
    return shadow(im, 6, 10, 8, 0.33)


@lru_cache(maxsize=None)
def printer(w=420) -> Image.Image:
    h = int(w * 0.55)
    im = Image.new("RGBA", (w + 40, h + 40), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    ox, oy = 20, 20
    d.rounded_rectangle((ox, oy + h * 0.25, ox + w, oy + h), 22, fill=rgba((228, 231, 238)), outline=rgba((150, 156, 170)), width=3)
    d.rounded_rectangle((ox + w * 0.12, oy, ox + w * 0.88, oy + h * 0.32), 12, fill=rgba((205, 210, 220)), outline=rgba((150, 156, 170)), width=3)
    d.rectangle((ox + w * 0.15, oy + h * 0.55, ox + w * 0.85, oy + h * 0.62), fill=rgba((60, 66, 80)))
    d.ellipse((ox + w * 0.82, oy + h * 0.35, ox + w * 0.88, oy + h * 0.45), fill=rgba(GREEN))
    im = paper_texture(im, 3)
    return shadow(im, 6, 10, 8, 0.33)


@lru_cache(maxsize=None)
def envelope(w=220, crossed=False) -> Image.Image:
    h = int(w * 0.66)
    im = Image.new("RGBA", (w + 40, h + 40), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    ox, oy = 20, 20
    d.rectangle((ox, oy, ox + w, oy + h), fill=rgba(PAPER), outline=rgba(SLATE), width=4)
    d.line((ox, oy, ox + w / 2, oy + h * 0.55, ox + w, oy), fill=rgba(SLATE), width=4)
    if crossed:
        d.line((ox - 6, oy - 6, ox + w + 6, oy + h + 6), fill=rgba(RED), width=12)
        d.line((ox + w + 6, oy - 6, ox - 6, oy + h + 6), fill=rgba(RED), width=12)
    im = paper_texture(im, 3)
    return shadow(im, 5, 9, 7, 0.3)


@lru_cache(maxsize=None)
def badge(icon: str, text: str, color=BLUE, w=380, h=300) -> Image.Image:
    im = paper_card(w, h, PAPER, 22)
    d = ImageDraw.Draw(im)
    d.ellipse((w / 2 - 62, 26, w / 2 + 62, 150), fill=rgba(color))
    text_center(d, w / 2, 90, icon, font("bold", 64), WHITE)
    text_center(d, w / 2, 214, text, font("handb", 42), SLATE, spacing=0)
    im = paper_texture(im, 3)
    return shadow(im, 6, 10, 8, 0.33)


@lru_cache(maxsize=None)
def moon(size=150) -> Image.Image:
    im = Image.new("RGBA", (size + 40, size + 40), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.ellipse((20, 20, 20 + size, 20 + size), fill=rgba((250, 236, 170)), outline=rgba((200, 180, 110)), width=3)
    d.ellipse((20 + size * 0.32, 20 - size * 0.08, 20 + size * 1.25, 20 + size * 0.86), fill=(0, 0, 0, 0))
    m = Image.new("L", im.size, 0)
    ImageDraw.Draw(m).ellipse((20, 20, 20 + size, 20 + size), fill=255)
    ImageDraw.Draw(m).ellipse((20 + size * 0.32, 20 - size * 0.08, 20 + size * 1.25, 20 + size * 0.86), fill=0)
    im.putalpha(m)
    im = paper_texture(im, 3)
    return shadow(im, 5, 9, 7, 0.3)


@lru_cache(maxsize=1)
def night_overlay() -> Image.Image:
    yy = np.linspace(0, 1, H)[:, None] * np.ones((1, W))
    a = (120 + 40 * (1 - yy)).astype(np.uint8)
    ov = np.zeros((H, W, 4), np.uint8)
    ov[..., 0], ov[..., 1], ov[..., 2], ov[..., 3] = 14, 20, 52, a
    return Image.fromarray(ov, "RGBA")


@lru_cache(maxsize=None)
def arrow(w=180, h=60, color=SLATE, curve=0.25) -> Image.Image:
    im = Image.new("RGBA", (w + 20, h + 40), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    pts = []
    for i in range(21):
        t = i / 20
        pts.append((10 + t * (w - 24), 20 + h / 2 - math.sin(t * math.pi) * h * curve))
    d.line(pts, fill=rgba(color), width=7, joint="curve")
    ex, ey = pts[-1]
    d.polygon([(ex + 18, ey), (ex - 6, ey - 14), (ex - 6, ey + 14)], fill=rgba(color))
    return im


@lru_cache(maxsize=None)
def end_card(w=1180, h=620) -> Image.Image:
    return shadow(paper_texture(paper_card(w, h, PAPER, 30), 3), 8, 14, 12, 0.35)


@lru_cache(maxsize=None)
def flag_card(text: str, color=GREEN) -> Image.Image:
    return tag(text, color, WHITE, 40)
