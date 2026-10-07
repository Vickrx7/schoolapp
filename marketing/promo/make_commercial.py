#!/usr/bin/env python
"""Build the 90-second Lynx École commercial (French and English cuts).

    ./venv/bin/python make_commercial.py --lang fr           # -> lynx-ecole-commercial-90-fr.mp4 (+ build/commercial/commercial-90-storyboard-fr.png)
    ./venv/bin/python make_commercial.py --lang en           # English cut
    ./venv/bin/python make_commercial.py --lang fr voice     # (re)generate the voice lines only
    ./venv/bin/python make_commercial.py --lang fr preview   # two PNGs per scene in build/commercial/, no video
    ./venv/bin/python make_commercial.py --lang fr frames 3.2 41.0   # render given times to build/commercial/
    ./venv/bin/python make_commercial.py --lang fr storyboard        # contact sheet only
    ./venv/bin/python make_commercial.py --lang fr remix     # new music/mix, muxed onto the rendered picture

Steps: voice (Kokoro, cached in build/commercial/voice-<lang>.json) -> timeline (scene lengths follow
the voice) -> frames (PIL, multiprocessing, raw RGB piped into ffmpeg, 1920x1080 at 30 fps) ->
original procedural music, ducked under the voice -> mux (H.264 yuv420p + AAC 48 kHz, +faststart)
-> 4x4 contact sheet.

Every screen is a capture of the development build with demo data (`screens-commercial/` and
`../site/assets/`); the kitchen, the chalkboard, the classroom, the map and the end card are drawn
here. Written as if the pilot is live: see README.md before it airs.
"""
from __future__ import annotations

import json
import math
import multiprocessing as mp
import os
import shutil
import subprocess
import sys
from dataclasses import dataclass
from functools import lru_cache

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

import promo_audio as AU

HERE = os.path.dirname(os.path.abspath(__file__))
BUILD = os.path.join(HERE, "build", "commercial")
SITE = os.path.join(HERE, "..", "site", "assets")
SHOTS = os.path.join(HERE, "screens-commercial")
FONTS = os.path.join(HERE, "fonts")
W, H = 1920, 1080
FPS = 30
XF = 0.6          # cross-fade between scenes (s)
LEAD = 0.55       # picture before each voice line (s)
TAIL = 0.65       # picture after each voice line (s)
FIRST_LEAD = 0.9
END_HOLD = 1.6    # extra hold on the end card


def parse_args(argv: list[str]) -> tuple[str, list[str]]:
    lang, rest, it = "fr", [], iter(argv)
    for a in it:
        if a == "--lang":
            lang = next(it)
        elif a.startswith("--lang="):
            lang = a.split("=", 1)[1]
        else:
            rest.append(a)
    assert lang in ("fr", "en"), lang
    return lang, rest


LANG, ARGS = parse_args(sys.argv[1:])
OUT_MP4 = os.path.join(HERE, f"lynx-ecole-commercial-90-{LANG}.mp4")
OUT_STORY = os.path.join(BUILD, f"commercial-90-storyboard-{LANG}.png")  # git-ignored, with the build


def T(fr: str, en: str) -> str:
    return fr if LANG == "fr" else en


# ---------------------------------------------------------------------------
# ffmpeg: the system one, or the binary that ships with imageio-ffmpeg (pip)
# ---------------------------------------------------------------------------
def ffmpeg_bin() -> str:
    exe = shutil.which("ffmpeg")
    if exe:
        return exe
    import imageio_ffmpeg  # type: ignore

    exe = imageio_ffmpeg.get_ffmpeg_exe()
    # promo_audio calls plain "ffmpeg": give it one on PATH.
    bindir = os.path.join(BUILD, "bin")
    os.makedirs(bindir, exist_ok=True)
    link = os.path.join(bindir, "ffmpeg")
    if not os.path.exists(link):
        os.symlink(exe, link)
    os.environ["PATH"] = bindir + os.pathsep + os.environ.get("PATH", "")
    return exe


# ---------------------------------------------------------------------------
# Script. `say` is what the voice reads (pronunciation-friendly), `caption` is burned in.
# French captions: no-break space (U+00A0) in times and inside « », narrow no-break space
# (U+202F) before ? ! ;
# ---------------------------------------------------------------------------
NB, NNB = " ", " "

LINES_FR = [
    dict(id="01_six", say="Malade à six heures? Deux touches.",
         caption=f"Malade à 6{NB}h{NNB}? Deux touches."),
    dict(id="02_plan", say="Votre plan de suppléance se prépare tout seul, là où chaque classe est rendue : les prochaines leçons, les groupes, la messe de cet après-midi.",
         caption=f"Votre plan de suppléance se prépare tout seul, là où chaque classe est rendue{NB}: les prochaines leçons, les groupes, la messe de cet après-midi."),
    dict(id="03_code", say="Publié à sept heures trente. Le secrétariat remet un code d'une journée.",
         caption=f"Publié à 7{NB}h{NB}30. Le secrétariat remet un code d’une journée."),
    dict(id="04_sub", say="La personne suppléante voit Maintenant, Ensuite, et les alertes seulement quand elle en a besoin.",
         caption=f"La personne suppléante voit «{NB}Maintenant{NB}», «{NB}Ensuite{NB}», et les alertes seulement quand elle en a besoin."),
    dict(id="05_report", say="En fin de journée, son suivi vous attend.",
         caption="En fin de journée, son suivi vous attend."),
    dict(id="06_bank", say="Une banque de ressources en français, rangée par attente, avec une version pour chaque niveau de langue.",
         caption="Une banque de ressources en français, rangée par attente, avec une version pour chaque niveau de langue."),
    dict(id="07_class", say="Au tableau, un quiz. Sur les tablettes, toute la classe joue, sans compte d'élève.",
         caption="Au tableau, un quiz. Sur les tablettes, toute la classe joue, sans compte d’élève."),
    dict(id="08_year", say="Votre année, semaine par semaine. Et pour chaque attente, ce qui est enseigné, prévu ou encore à venir.",
         caption="Votre année, semaine par semaine. Et pour chaque attente, ce qui est enseigné, prévu ou encore à venir."),
    dict(id="09_reports", say="Les commentaires de bulletin, élève par élève, à partir des banques de votre conseil. Ils restent sur votre appareil.",
         caption="Les commentaires de bulletin, élève par élève, à partir des banques de votre conseil. Ils restent sur votre appareil."),
    dict(id="10_families", say="Et le vendredi, le message aux familles est prêt, en français et en anglais.",
         caption="Et le vendredi, le message aux familles est prêt, en français et en anglais."),
    dict(id="11_direction", say="La direction voit la journée de l'école d'un coup d'œil. Le conseil gère ses comptes, ses années scolaires et ses données.",
         caption="La direction voit la journée de l’école d’un coup d’œil. Le conseil gère ses comptes, ses années scolaires et ses données."),
    dict(id="12_canada", say="Vos données sont hébergées au Canada. Avant tout envoi à l'I A, les noms de vos élèves et de vos collègues sont remplacés.",
         caption="Vos données sont hébergées au Canada. Avant tout envoi à l’IA, les noms de vos élèves et de vos collègues sont remplacés."),
    dict(id="13_end", say="Lynx École. Pensée pour les écoles catholiques de langue française de l'Ontario.",
         caption="Lynx École. Pensée pour les écoles catholiques de langue française de l’Ontario."),
]

LINES_EN = [
    dict(id="01_six", say="Sick at six A M? Two taps.", caption="Sick at 6 a.m.? Two taps."),
    dict(id="02_plan", say="Your substitute plan builds itself from where each class left off: the next lessons, the groups, this afternoon's mass.",
         caption="Your substitute plan builds itself from where each class left off: the next lessons, the groups, this afternoon’s mass."),
    dict(id="03_code", say="Released at seven thirty. The office hands out a one-day code.",
         caption="Released at 7:30. The office hands out a one-day code."),
    dict(id="04_sub", say="The substitute sees Now, Next, and the alerts only when they're needed.",
         caption="The substitute sees Now, Next, and the alerts only when they’re needed."),
    dict(id="05_report", say="At the end of the day, the report is waiting for you.",
         caption="At the end of the day, the report is waiting for you."),
    dict(id="06_bank", say="A French resource bank, filed by curriculum expectation, with a version for every language level.",
         caption="A French resource bank, filed by curriculum expectation, with a version for every language level."),
    dict(id="07_class", say="A quiz on the projector. The whole class plays on tablets, with no student accounts.",
         caption="A quiz on the projector. The whole class plays on tablets, with no student accounts."),
    dict(id="08_year", say="Your year, week by week. And for every expectation, what's taught, planned or still to come.",
         caption="Your year, week by week. And for every expectation, what’s taught, planned or still to come."),
    dict(id="09_reports", say="Report card comments, student by student, from your board's comment banks. They stay on your device.",
         caption="Report card comments, student by student, from your board’s comment banks. They stay on your device."),
    dict(id="10_families", say="And on Friday, the message to families is ready, in French and English.",
         caption="And on Friday, the message to families is ready, in French and English."),
    dict(id="11_direction", say="Principals see the school's day at a glance. The board manages its accounts, school years and data.",
         caption="Principals see the school’s day at a glance. The board manages its accounts, school years and data."),
    dict(id="12_canada", say="Your data is hosted in Canada. Before anything goes to the AI, your students' and colleagues' names are replaced.",
         caption="Your data is hosted in Canada. Before anything goes to the AI, your students’ and colleagues’ names are replaced."),
    dict(id="13_end", say="Lynx École. Made for Ontario's French-language Catholic schools.",
         caption="Lynx École. Made for Ontario’s French-language Catholic schools."),
]

# espeak slips, fixed in the phonemes (French: glides, a quiz, liaisons that should not be made)
FIXES_FR = [
    ("ɑ̃syˈit", "ɑ̃sɥˈit"),            # Ensuite
    ("syivˈi", "sɥivˈi"),              # suivi
    ("ʁəsˈuʁsz ɑ̃", "ʁəsˈuʁs ɑ̃"),       # ressources en
    ("kˈiz", "kwˈiz"),                 # quiz
    ("ɑ̃sɛnjˈe", "ɑ̃seɲˈe"),            # enseigné
    ("famˈijz ɛ", "famˈij ɛ"),         # familles est
    ("fʁɑ̃sˈɛz e", "fʁɑ̃sˈɛ e"),         # français et
    ("skolˈɛʁz e", "skolˈɛʁ e"),       # scolaires et
    ("ebɛʁʒˈez o", "ebɛʁʒˈe o"),       # hébergées au
    ("elˈɛvz e", "elˈɛv e"),           # élèves et
]
FIXES_EN = [
    ("ɪkˈoʊl", "ekˈɔl"),               # École
    ("sˈɪks ɐ ˈɛm", "sˈɪks ˈeɪ ˈɛm"),  # six A M: "ay em", not "uh em"
]
VOICE = {
    "fr": dict(voice="ff_siwis", lang="fr-fr", speed=1.0, lines=LINES_FR, fixes=FIXES_FR),
    "en": dict(voice="af_heart", lang="en-us", speed=0.95, lines=LINES_EN, fixes=FIXES_EN),
}
# Per-line speed tweaks (kept at or under 1.1) when a line runs long for its picture.
SPEED = {"fr": {}, "en": {}}


def make_voice(lang: str) -> list[dict]:
    """One wav per line (Kokoro 24 kHz -> 48 kHz). Cached in build/commercial/voice-<lang>.json."""
    from kokoro_onnx import Kokoro  # slow import

    ffmpeg_bin()
    cfg = VOICE[lang]
    os.makedirs(BUILD, exist_ok=True)
    k = Kokoro(AU.MODEL, AU.VOICES)
    meta = []
    for line in cfg["lines"]:
        ph = k.tokenizer.phonemize(line["say"], lang=cfg["lang"])
        for a, b in cfg["fixes"]:
            ph = ph.replace(a, b)
        speed = SPEED[lang].get(line["id"], cfg["speed"])
        samples, sr = k.create(ph, voice=cfg["voice"], speed=speed, lang=cfg["lang"], is_phonemes=True)
        samples = np.asarray(samples, dtype=np.float32)
        # trim leading/trailing near-silence so the timeline is exact
        idx = np.where(np.abs(samples) > 0.01)[0]
        if len(idx):
            a0 = max(0, idx[0] - int(0.03 * sr))
            a1 = min(len(samples), idx[-1] + int(0.08 * sr))
            samples = samples[a0:a1]
        raw = os.path.join(BUILD, f"voice-{lang}-{line['id']}-24k.wav")
        wav = os.path.join(BUILD, f"voice-{lang}-{line['id']}.wav")
        AU.sf.write(raw, samples, sr)
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", raw, "-ar", str(AU.SR), "-ac", "1", wav], check=True)
        dur = len(samples) / sr
        meta.append(dict(id=line["id"], say=line["say"], caption=line["caption"], phonemes=ph, speed=speed,
                         wav=wav, duration=round(dur, 3)))
        print(f"{line['id']}: {dur:5.2f}s  speed {speed}  {ph}")
    with open(os.path.join(BUILD, f"voice-{lang}.json"), "w") as f:
        json.dump(meta, f, indent=1, ensure_ascii=False)
    print("total voice", round(sum(m["duration"] for m in meta), 2), "s")
    return meta




# ---------------------------------------------------------------------------
# Palette (marketing/site/index.html)
# ---------------------------------------------------------------------------
BOARD = (30, 58, 46)
BOARD2 = (38, 71, 58)
CHALK = (238, 242, 234)
CHALK2 = (183, 200, 187)
CHALKY = (242, 211, 107)
FRAME = (155, 118, 72)
FRAME2 = (119, 86, 48)
FELT = (59, 63, 69)
PHONE = (16, 24, 20)
PAPER = (244, 247, 241)
RULE = (195, 213, 232)
MARGIN = (197, 68, 58)
INK = (20, 35, 26)
INK2 = (74, 90, 79)
APPGREEN = (10, 122, 61)
FLAG_G = (22, 128, 60)
WHITE = (255, 255, 255)
LANCZOS = Image.LANCZOS
BICUBIC = Image.BICUBIC


# ---------------------------------------------------------------------------
# Small maths
# ---------------------------------------------------------------------------
def clamp(x, a=0.0, b=1.0):
    return a if x < a else b if x > b else x


def ease(x):
    x = clamp(x)
    return 0.5 - 0.5 * math.cos(math.pi * x)


def ramp(t, t0, t1):
    if t1 <= t0:
        return 1.0 if t >= t1 else 0.0
    return ease((t - t0) / (t1 - t0))


def lerp(a, b, u):
    return a + (b - a) * u


def lerpv(a, b, u):
    return tuple(lerp(x, y, u) for x, y in zip(a, b))


def keyed(t, keys):
    """keys: [(t, value_tuple), ...] -> eased piecewise interpolation."""
    if t <= keys[0][0]:
        return keys[0][1]
    for (t0, v0), (t1, v1) in zip(keys, keys[1:]):
        if t <= t1:
            return lerpv(v0, v1, ramp(t, t0, t1))
    return keys[-1][1]


# ---------------------------------------------------------------------------
# Fonts and text sprites
# ---------------------------------------------------------------------------
FONT_FILES = {
    "display": "ZillaSlab-Bold.ttf",
    "body": "Lexend-Regular.ttf",
    "body-medium": "Lexend-Medium.ttf",
    "hand": "Caveat[wght].ttf",
    "hand-bold": "Caveat[wght].ttf",
}


@lru_cache(maxsize=None)
def font(kind: str, size: int) -> ImageFont.FreeTypeFont:
    f = ImageFont.truetype(os.path.join(FONTS, FONT_FILES[kind]), size)
    if kind == "hand":
        f.set_variation_by_axes([600])
    elif kind == "hand-bold":
        f.set_variation_by_axes([700])
    return f


@lru_cache(maxsize=None)
def chalk_noise(w: int, h: int, seed: int = 3) -> np.ndarray:
    rng = np.random.default_rng(seed)
    fine = rng.random((h, w))
    coarse = np.asarray(Image.fromarray((rng.random((h // 6 + 2, w // 6 + 2)) * 255).astype(np.uint8))
                        .resize((w, h), BICUBIC), dtype=np.float32) / 255
    n = 0.62 + 0.38 * coarse
    n = n * (0.78 + 0.22 * fine)
    n[fine < 0.07] *= 0.35   # speckles where the chalk skipped
    return n.astype(np.float32)


@lru_cache(maxsize=None)
def text_sprite(text: str, kind: str, size: int, color: tuple, chalk: bool = False, scale: int = 2) -> Image.Image:
    """RGBA sprite of one line of text at `scale`x resolution (draw it at sprite.size / scale)."""
    f = font(kind, size * scale)
    x0, y0, x1, y1 = f.getbbox(text)
    asc, desc = f.getmetrics()
    pad = 6 * scale
    w = int(x1 - min(0, x0)) + 2 * pad
    h = asc + desc + 2 * pad
    mask = Image.new("L", (w, h), 0)
    ImageDraw.Draw(mask).text((pad - min(0, x0), pad), text, font=f, fill=255)
    if chalk:
        a = np.asarray(mask, dtype=np.float32) / 255
        a = a * chalk_noise(w, h, seed=len(text) + size)
        mask = Image.fromarray((np.clip(a, 0, 1) * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.5 * scale))
    im = Image.new("RGBA", (w, h), color + (0,))
    im.putalpha(mask)
    im.info["scale"] = scale
    im.info["pad"] = pad
    return im


def text_width(text: str, kind: str, size: int) -> float:
    return font(kind, size).getlength(text)


def wrap(text: str, kind: str, size: int, maxw: float) -> list[str]:
    """Greedy wrap on ordinary spaces only (no-break spaces stay), then balance two lines."""
    words = text.split(" ")
    lines, cur = [], ""
    for wd in words:
        cand = wd if not cur else cur + " " + wd
        if text_width(cand, kind, size) <= maxw or not cur:
            cur = cand
        else:
            lines.append(cur)
            cur = wd
    lines.append(cur)
    if len(lines) == 2:  # balance: move words down while the first line is clearly longer
        a, b = lines[0].split(" "), lines[1].split(" ")
        while len(a) > 1:
            na, nb = " ".join(a[:-1]), " ".join([a[-1]] + b)
            if text_width(nb, kind, size) > maxw or text_width(na, kind, size) < text_width(nb, kind, size):
                break
            a, b = a[:-1], [a[-1]] + b
        lines = [" ".join(a), " ".join(b)]
    return lines


# ---------------------------------------------------------------------------
# Drawing primitives. World coordinates are 1920x1080; a camera maps them to the frame.
# ---------------------------------------------------------------------------
@dataclass
class Cam:
    z: float = 1.0
    cx: float = W / 2
    cy: float = H / 2

    def pt(self, x, y):
        return ((x - self.cx) * self.z + W / 2, (y - self.cy) * self.z + H / 2)

    def rect(self, r):
        x, y, w, h = r
        X, Y = self.pt(x, y)
        return (X, Y, w * self.z, h * self.z)

    def parallax(self, k=0.25):
        return Cam(1 + (self.z - 1) * k, W / 2 + (self.cx - W / 2) * k, H / 2 + (self.cy - H / 2) * k)


IDENT = Cam()


def cam_toward(z: float, fx: float, fy: float) -> Cam:
    """Camera at zoom z that keeps the world point (fx, fy) where it sits at zoom 1, pulled
    toward the frame centre a little (a Ken Burns push toward that point)."""
    cx = fx + (W / 2 - fx) / z
    cy = fy + (H / 2 - fy) / z
    return Cam(z, cx, cy)


def paste(fr: Image.Image, piece: Image.Image, pos, alpha=1.0):
    if alpha <= 0.002:
        return
    if piece.mode == "RGBA":
        if alpha < 0.999:
            a = piece.getchannel("A").point(lambda v: int(v * alpha))
            piece = piece.copy()
            piece.putalpha(a)
        fr.alpha_composite(piece, pos)
    else:
        if alpha >= 0.999:
            fr.paste(piece, pos)
        else:
            x, y = pos
            under = fr.crop((x, y, x + piece.width, y + piece.height)).convert("RGB")
            fr.paste(Image.blend(under, piece, alpha), pos)


def draw_img(fr, img, dst, src=None, alpha=1.0, resample=LANCZOS, clip=None):
    """Draw img (or the src box of it) into the frame rect dst=(X, Y, w, h) (floats, frame px)."""
    X, Y, Wd, Hd = dst
    if Wd < 0.5 or Hd < 0.5 or alpha <= 0.002:
        return
    sx0, sy0, sx1, sy1 = src or (0, 0, img.width, img.height)
    cx0, cy0, cx1, cy1 = clip or (0, 0, W, H)
    ix0, iy0 = max(int(cx0), math.floor(X)), max(int(cy0), math.floor(Y))
    ix1, iy1 = min(int(cx1), math.ceil(X + Wd)), min(int(cy1), math.ceil(Y + Hd))
    if ix1 - ix0 < 1 or iy1 - iy0 < 1:
        return
    kx, ky = (sx1 - sx0) / Wd, (sy1 - sy0) / Hd
    box = [sx0 + (ix0 - X) * kx, sy0 + (iy0 - Y) * ky, sx0 + (ix1 - X) * kx, sy0 + (iy1 - Y) * ky]
    box = (max(0.0, box[0]), max(0.0, box[1]), min(float(img.width), box[2]), min(float(img.height), box[3]))
    if box[2] - box[0] < 0.01 or box[3] - box[1] < 0.01:
        return
    piece = img.resize((ix1 - ix0, iy1 - iy0), resample, box=box)
    paste(fr, piece, (ix0, iy0), alpha)


def draw_sprite(fr, spr, x, y, cam=IDENT, alpha=1.0, w=None, reveal=1.0, anchor="lt", resample=BICUBIC):
    """Draw a sprite at world (x, y). `w` = world width (default: sprite size / its scale).
    `reveal` < 1 shows only the left part (writing)."""
    sc = spr.info.get("scale", 1)
    ww = (spr.width / sc) if w is None else w
    hh = ww * spr.height / spr.width
    if anchor[0] == "c":
        x -= ww / 2
    elif anchor[0] == "r":
        x -= ww
    if anchor[1] == "m":
        y -= hh / 2
    elif anchor[1] == "b":
        y -= hh
    if reveal < 1:
        rw = clamp(reveal) * spr.width
        if rw < 1:
            return
        draw_img(fr, spr, cam.rect((x, y, ww * rw / spr.width, hh)), (0, 0, rw, spr.height), alpha, resample)
    else:
        draw_img(fr, spr, cam.rect((x, y, ww, hh)), None, alpha, resample)


def draw_text(fr, text, kind, size, color, x, y, cam=IDENT, alpha=1.0, chalk=False, anchor="lt", reveal=1.0):
    spr = text_sprite(text, kind, size, color, chalk)
    pad = spr.info["pad"] / spr.info["scale"]
    if anchor[0] == "l":
        x -= pad
    elif anchor[0] == "r":
        x += pad
    if anchor[1] == "t":
        y -= pad
    elif anchor[1] == "b":
        y += pad
    draw_sprite(fr, spr, x, y, cam, alpha, anchor=anchor, reveal=reveal)


def draw_glyph_center(fr, text, kind, size, color, cx, cy, cam=IDENT, alpha=1.0, chalk=False, reveal=1.0):
    """Draw text so that the centre of its inked box lands on world (cx, cy)."""
    spr = text_sprite(text, kind, size, color, chalk)
    bb = spr.getchannel("A").getbbox() or (0, 0, spr.width, spr.height)
    sc = spr.info["scale"]
    draw_sprite(fr, spr, cx - (bb[0] + bb[2]) / 2 / sc, cy - (bb[1] + bb[3]) / 2 / sc, cam, alpha, reveal=reveal)


def stroke(fr, pts, color, width, alpha=1.0, ss=3):
    """Anti-aliased polyline in frame coordinates."""
    if len(pts) < 2 or alpha <= 0.002:
        return
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    pad = width + 2
    x0, y0 = math.floor(min(xs) - pad), math.floor(min(ys) - pad)
    x1, y1 = math.ceil(max(xs) + pad), math.ceil(max(ys) + pad)
    x0c, y0c, x1c, y1c = max(0, x0), max(0, y0), min(W, x1), min(H, y1)
    if x1c <= x0c or y1c <= y0c:
        return
    pw, ph = (x1 - x0) * ss, (y1 - y0) * ss
    if pw * ph > 5e7:
        return
    m = Image.new("L", (pw, ph), 0)
    d = ImageDraw.Draw(m)
    sp = [((px - x0) * ss, (py - y0) * ss) for px, py in pts]
    d.line(sp, fill=255, width=max(1, int(width * ss)), joint="curve")
    r = width * ss / 2
    for px, py in (sp[0], sp[-1]):
        d.ellipse((px - r, py - r, px + r, py + r), fill=255)
    m = m.resize((x1 - x0, y1 - y0), LANCZOS)
    piece = Image.new("RGBA", m.size, color + (0,))
    piece.putalpha(m.point(lambda v: int(v * alpha)))
    piece = piece.crop((x0c - x0, y0c - y0, x1c - x0, y1c - y0))
    fr.alpha_composite(piece, (x0c, y0c))


def hand_ellipse(cx, cy, rx, ry, seed=1, turns=1.08):
    rng = np.random.default_rng(seed)
    n = 90
    a0 = -math.pi * 0.62 + rng.uniform(-0.2, 0.2)
    wob = rng.uniform(-1, 1, 4)
    pts = []
    for i in range(n + 1):
        u = i / n
        a = a0 + u * turns * 2 * math.pi
        k = 1 + 0.035 * math.sin(3 * a + wob[0]) + 0.05 * u * wob[1]
        pts.append((cx + rx * k * math.cos(a), cy + ry * k * math.sin(a) + 3 * u * wob[2]))
    return pts


def draw_ellipse_mark(fr, cam, cx, cy, rx, ry, prog, color=MARGIN, width=4.5, alpha=1.0, seed=1):
    if prog <= 0:
        return
    pts = hand_ellipse(cx, cy, rx, ry, seed)
    k = max(2, int(len(pts) * clamp(prog)))
    stroke(fr, [cam.pt(*p) for p in pts[:k]], color, width * cam.z ** 0.5, alpha)


def hand_line(x0, y0, x1, y1, seed=2, n=24, amp=2.0):
    rng = np.random.default_rng(seed)
    ph = rng.uniform(0, 6)
    out = []
    for i in range(n + 1):
        u = i / n
        out.append((lerp(x0, x1, u), lerp(y0, y1, u) + amp * math.sin(ph + u * 5.0)))
    return out


def draw_underline(fr, cam, x0, y, x1, prog, color=MARGIN, width=4.0, alpha=1.0, seed=2):
    if prog <= 0:
        return
    pts = hand_line(x0, y, x1, y + 2, seed)
    k = max(2, int(len(pts) * clamp(prog)))
    stroke(fr, [cam.pt(*p) for p in pts[:k]], color, width * cam.z ** 0.5, alpha)


def draw_arrow(fr, cam, pts, prog, color, width=4.0, alpha=1.0):
    """Hand-drawn curved arrow along a quadratic through pts=(start, ctrl, end)."""
    if prog <= 0:
        return
    (ax, ay), (bx, by), (cx, cy) = pts
    n = 40
    k = max(2, int(n * clamp(prog)))
    curve = []
    for i in range(k + 1):
        u = i / n
        curve.append(((1 - u) ** 2 * ax + 2 * (1 - u) * u * bx + u * u * cx, (1 - u) ** 2 * ay + 2 * (1 - u) * u * by + u * u * cy))
    stroke(fr, [cam.pt(*p) for p in curve], color, width, alpha)
    if prog >= 0.98:
        ex, ey = curve[-1]
        px, py = curve[-4]
        ang = math.atan2(ey - py, ex - px)
        for da in (2.6, -2.6):
            hx, hy = ex + 18 * math.cos(ang + da), ey + 18 * math.sin(ang + da)
            stroke(fr, [cam.pt(ex, ey), cam.pt(hx, hy)], color, width, alpha)


def ripple(fr, cam, x, y, t, t0):
    """A tap: a soft dot and an expanding ring, from t0 for 0.7 s."""
    u = (t - t0) / 0.7
    if u < 0 or u > 1:
        return
    X, Y = cam.pt(x, y)
    r0 = 15 * cam.z ** 0.5
    ss = 3
    R = int(r0 * 3.6) + 4
    m = Image.new("RGBA", (2 * R * ss, 2 * R * ss), (0, 0, 0, 0))
    d = ImageDraw.Draw(m)
    c = R * ss
    dot_a = int(110 * (1 - ease(clamp((u - 0.25) / 0.6))))
    rd = r0 * ss * (1 + 0.15 * ease(clamp(u / 0.2)))
    d.ellipse((c - rd, c - rd, c + rd, c + rd), fill=(20, 35, 26, dot_a))
    rr = r0 * ss * (1 + 2.2 * ease(u))
    ring_a = int(170 * (1 - u))
    d.ellipse((c - rr, c - rr, c + rr, c + rr), outline=(20, 35, 26, ring_a), width=int(3 * ss))
    m = m.resize((2 * R, 2 * R), LANCZOS)
    x0, y0 = int(round(X - R)), int(round(Y - R))
    if x0 < 0 or y0 < 0 or x0 + 2 * R > W or y0 + 2 * R > H:
        return
    fr.alpha_composite(m, (x0, y0))


# ---------------------------------------------------------------------------
# Screens
# ---------------------------------------------------------------------------
SCREEN_FILES = {
    # site captures (2026-09-30 to 2026-10-03)
    "today": (SITE, "today-phone.webp"),
    "absence": (SITE, "absence-phone.webp"),
    "library-search": (SITE, "library-search.webp"),
    "library-item": (SITE, "library-item.webp"),
    "year": (SITE, "year-desktop.webp"),
    "coverage": (SITE, "coverage-class-phone.webp"),
    "reports": (SITE, "report-comments-desktop.webp"),
    "newsletter": (SITE, "newsletter-desktop.webp"),
    "newsletter-pdf": (SITE, "newsletter-pdf.webp"),
    "direction": (SITE, "direction-desktop.webp"),
    "staff": (SITE, "staff-desktop.webp"),
    "board": (SITE, "board-desktop.webp"),
    "audit": (SITE, "audit-desktop.webp"),
    # captures for this cut (screens-commercial/)
    "absence-ready": (SHOTS, "absence-ready-phone.webp"),
    "absence-published": (SHOTS, "absence-published-phone.webp"),
    "office": (SHOTS, "office-board-desktop.webp"),
    "office-code": (SHOTS, "office-code-desktop.webp"),
    "welcome-sheet": (SHOTS, "welcome-sheet.webp"),
    "sub-now": (SHOTS, "substitute-now-phone.webp"),
    "sub-students": (SHOTS, "substitute-students-phone.webp"),
    "sub-report": (SHOTS, "substitute-report-phone.webp"),
    "confirm": (SHOTS, "report-confirm-phone.webp"),
    "tablet-code": (SHOTS, "tablet-code.webp"),
    "tablet-joined": (SHOTS, "tablet-joined.webp"),
    "tablet-answer": (SHOTS, "tablet-answer.webp"),
    "tablet-ranking": (SHOTS, "tablet-ranking.webp"),
    "proj-question": (SHOTS, "projector-question.webp"),
    "proj-answer": (SHOTS, "projector-answer.webp"),
    "proj-ranking": (SHOTS, "projector-ranking.webp"),
    "report-comment": (SHOTS, "report-comment-desktop.webp"),
    "ai-preview": (SHOTS, "ai-preview-desktop.webp"),
    "library-sheet": (SHOTS, "library-sheet.webp"),
    "library-sheet-top": (SHOTS, "library-sheet.webp"),
}
# Source crops that give each desktop capture the laptop's 16:10 screen
SCREEN_CROPS = {
    "report-comment": (137, 0, 1366, 768),
    "ai-preview": (0, 23, 1366, 877),
    "library-sheet-top": (0, 0, 991, 600),
}


@lru_cache(maxsize=None)
def scr(name: str) -> Image.Image:
    d, f = SCREEN_FILES[name]
    im = Image.open(os.path.join(d, f)).convert("RGB")
    if name in SCREEN_CROPS:
        im = im.crop(SCREEN_CROPS[name])
    return im


def view_box(img: Image.Image, aspect: float, z: float = 1.0, fu: float = 0.5, fv: float = 0.5, top=False):
    """Source box of aspect `aspect` (w/h) at zoom z (1 = the widest box that fits), centred on
    the normalised point (fu, fv) as far as the image allows. top=True: a phone-style view
    of the top of a tall image."""
    iw, ih = img.size
    bw = iw if iw / ih <= aspect else ih * aspect
    bw /= z
    bh = bw / aspect
    if top and z == 1.0:
        return (0, 0, bw, bh)
    x0 = clamp(fu * iw - bw / 2, 0, iw - bw)
    y0 = clamp(fv * ih - bh / 2, 0, ih - bh)
    return (x0, y0, x0 + bw, y0 + bh)


def lerp_box(a, b, u):
    return tuple(lerp(x, y, u) for x, y in zip(a, b))


# ---------------------------------------------------------------------------
# Devices (bezel sprites with a transparent screen, drawn on top of the screen content)
# ---------------------------------------------------------------------------
def rounded_mask(size, radius, ss=3):
    w, h = size
    m = Image.new("L", (w * ss, h * ss), 0)
    ImageDraw.Draw(m).rounded_rectangle((0, 0, w * ss - 1, h * ss - 1), radius * ss, fill=255)
    return m.resize((w, h), LANCZOS)


@lru_cache(maxsize=None)
def soft_shadow(w: int, h: int, radius: int, blur: int) -> Image.Image:
    pad = blur * 3
    m = Image.new("L", (w + 2 * pad, h + 2 * pad), 0)
    ImageDraw.Draw(m).rounded_rectangle((pad, pad, pad + w, pad + h), radius, fill=255)
    m = m.filter(ImageFilter.GaussianBlur(blur))
    im = Image.new("RGBA", m.size, (0, 0, 0, 0))
    im.putalpha(m)
    im.info["pad"] = pad
    return im


PHONE_SW = 390        # sprite screen width (px) for the bezel sprites (1x of the CSS viewport)
PH_ASPECT = 844 / 390
PH_BEZ = 0.045        # bezel, as a fraction of the screen width
PH_R = 0.15


@lru_cache(maxsize=None)
def phone_bezel(scale: int = 2) -> Image.Image:
    sw = PHONE_SW * scale
    sh = int(round(sw * PH_ASPECT))
    b = int(PH_BEZ * sw)
    W2, H2 = sw + 2 * b, sh + 2 * b
    ss = 2
    im = Image.new("RGBA", ((W2 + 8 * scale) * ss, H2 * ss), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    ox = 4 * scale * ss
    R = PH_R * sw * ss
    # side buttons
    d.rounded_rectangle((ox + W2 * ss - 2 * ss, int(0.22 * H2 * ss), ox + W2 * ss + 3 * scale * ss, int(0.29 * H2 * ss)), 3 * ss, fill=(40, 48, 44, 255))
    d.rounded_rectangle((ox - 3 * scale * ss, int(0.18 * H2 * ss), ox + 2 * ss, int(0.23 * H2 * ss)), 3 * ss, fill=(40, 48, 44, 255))
    d.rounded_rectangle((ox, 0, ox + W2 * ss - 1, H2 * ss - 1), R, fill=(58, 70, 63, 255))
    d.rounded_rectangle((ox + 2 * ss * scale, 2 * ss * scale, ox + W2 * ss - 1 - 2 * ss * scale, H2 * ss - 1 - 2 * ss * scale), R - 2 * ss * scale, fill=PHONE + (255,))
    # screen hole
    hole = Image.new("L", im.size, 0)
    ImageDraw.Draw(hole).rounded_rectangle((ox + b * ss, b * ss, ox + (b + sw) * ss - 1, (b + sh) * ss - 1), (PH_R - PH_BEZ) * sw * ss, fill=255)
    a = np.asarray(im.getchannel("A"), dtype=np.int16) - np.asarray(hole, dtype=np.int16)
    im.putalpha(Image.fromarray(np.clip(a, 0, 255).astype(np.uint8)))
    # punch-hole camera
    cx, cy, r = ox + (b + sw / 2) * ss, (b + 0.032 * sw) * ss, 0.019 * sw * ss
    d = ImageDraw.Draw(im)
    d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=(6, 9, 8, 255))
    d.ellipse((cx - r * 0.4, cy - r * 0.5, cx - r * 0.05, cy - r * 0.15), fill=(40, 52, 70, 255))
    im = im.resize((im.width // ss, im.height // ss), LANCZOS)
    im.info["ox"] = 4 * scale
    im.info["scale"] = scale
    return im


def draw_phone(fr, cam, x, y, w, layers, shadow=0.45, alpha=1.0):
    """Phone whose screen's top-left is at world (x, y), screen width w.
    layers: [(img, src_box, alpha)] drawn bottom-up into the screen."""
    h = w * PH_ASPECT
    b = PH_BEZ * w
    if shadow > 0:
        bw_, bh_ = w + 2 * b, h + 2 * b
        sh = soft_shadow(200, int(200 * bh_ / bw_), 30, 16)
        k = bw_ / 200
        pad = sh.info["pad"] * k
        draw_img(fr, sh, cam.rect((x - b - pad + 0.03 * w, y - b - pad + 0.06 * w, sh.width * k, sh.height * k)), None, shadow * alpha, BICUBIC)
    clip = cam.rect((x, y, w, h))
    clipi = (max(0, clip[0]), max(0, clip[1]), min(W, clip[0] + clip[2]), min(H, clip[1] + clip[3]))
    for img, src, a in layers:
        if a > 0.002:
            draw_img(fr, img, clip, src, a * alpha, LANCZOS, clipi)
    bz = phone_bezel()
    k = w / (PHONE_SW * bz.info["scale"])
    ox = bz.info["ox"]
    draw_img(fr, bz, cam.rect((x - b - ox * k, y - b, bz.width * k, bz.height * k)), None, alpha, BICUBIC)


LAP_BEZ_S, LAP_BEZ_T, LAP_BEZ_B = 0.022, 0.030, 0.050


@lru_cache(maxsize=None)
def laptop_body(sw: int = 1280) -> Image.Image:
    """Lid + deck sprite for a 16:10 screen sw px wide (screen area transparent)."""
    sh = int(sw / 1.6)
    bs, bt, bb = int(LAP_BEZ_S * sw), int(LAP_BEZ_T * sw), int(LAP_BEZ_B * sw)
    lw, lh = sw + 2 * bs, sh + bt + bb
    deck_h = int(0.026 * sw)
    over = int(0.06 * sw)
    Wt, Ht = lw + 2 * over, lh + deck_h + 6
    ss = 2
    im = Image.new("RGBA", (Wt * ss, Ht * ss), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    R = int(0.016 * sw) * ss
    d.rounded_rectangle((over * ss, 0, (over + lw) * ss - 1, lh * ss + R), R, fill=(64, 74, 68, 255))
    d.rounded_rectangle((over * ss + 2 * ss, 2 * ss, (over + lw) * ss - 1 - 2 * ss, lh * ss + R), R - 2 * ss, fill=(26, 32, 29, 255))
    # deck: a thin slab, wider than the lid, lighter on top
    y0 = lh * ss
    d.polygon([((over - over * 0.55) * ss, y0), ((over + lw + over * 0.55) * ss, y0),
               ((Wt - 2) * ss, (lh + deck_h) * ss), (2 * ss, (lh + deck_h) * ss)], fill=(176, 186, 178, 255))
    d.rectangle((2 * ss, (lh + deck_h - 5) * ss, (Wt - 2) * ss, (lh + deck_h) * ss), fill=(120, 130, 122, 255))
    d.rectangle(((over - over * 0.55) * ss, y0, (over + lw + over * 0.55) * ss, y0 + 3 * ss), fill=(214, 222, 215, 255))
    nw = 0.11 * sw
    cxm = (Wt / 2) * ss
    d.rounded_rectangle((cxm - nw / 2 * ss, y0, cxm + nw / 2 * ss, y0 + 6 * ss), 3 * ss, fill=(140, 150, 142, 255))
    # camera dot
    cr = 0.0035 * sw * ss
    d.ellipse((cxm - cr, bt * ss / 2 - cr, cxm + cr, bt * ss / 2 + cr), fill=(8, 10, 9, 255))
    # screen hole
    a = np.asarray(im.getchannel("A"), dtype=np.int16)
    a[bt * ss:(bt + sh) * ss, (over + bs) * ss:(over + bs + sw) * ss] = 0
    im.putalpha(Image.fromarray(a.astype(np.uint8)))
    im = im.resize((Wt, Ht), LANCZOS)
    im.info["screen"] = (over + bs, bt, sw, sh)
    return im


def draw_laptop(fr, cam, x, y, w, layers, shadow=0.4, alpha=1.0):
    """Laptop whose screen's top-left is at world (x, y), screen width w (16:10)."""
    body = laptop_body()
    sx, sy, sw, sh = body.info["screen"]
    k = w / sw
    bx, by = x - sx * k, y - sy * k
    if shadow > 0:
        sl = soft_shadow(300, int(300 * body.height / body.width), 12, 14)
        kk = body.width * k / 300
        pad = sl.info["pad"] * kk
        draw_img(fr, sl, cam.rect((bx - pad + 0.01 * w, by - pad + 0.03 * w, sl.width * kk, sl.height * kk)), None, shadow * alpha, BICUBIC)
    clip = cam.rect((x, y, w, w / 1.6))
    clipi = (max(0, clip[0]), max(0, clip[1]), min(W, clip[0] + clip[2]), min(H, clip[1] + clip[3]))
    for img, src, a in layers:
        if a > 0.002:
            draw_img(fr, img, clip, src, a * alpha, LANCZOS, clipi)
    draw_img(fr, body, cam.rect((bx, by, body.width * k, body.height * k)), None, alpha, BICUBIC)


TAB_BEZ = 0.045


@lru_cache(maxsize=None)
def tablet_bezel(sw: int = 1024) -> Image.Image:
    sh = int(sw / 1.6)
    b = int(TAB_BEZ * sw)
    Wt, Ht = sw + 2 * b, sh + 2 * b
    ss = 2
    im = Image.new("RGBA", (Wt * ss, Ht * ss), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    R = 0.06 * sw * ss
    d.rounded_rectangle((0, 0, Wt * ss - 1, Ht * ss - 1), R, fill=(64, 74, 68, 255))
    d.rounded_rectangle((3 * ss, 3 * ss, Wt * ss - 1 - 3 * ss, Ht * ss - 1 - 3 * ss), R - 3 * ss, fill=PHONE + (255,))
    a = np.asarray(im.getchannel("A"), dtype=np.int16)
    a[b * ss:(b + sh) * ss, b * ss:(b + sw) * ss] = 0
    im.putalpha(Image.fromarray(a.astype(np.uint8)))
    d = ImageDraw.Draw(im)
    cr = 0.006 * sw * ss
    d.ellipse((Wt * ss / 2 - cr, b * ss / 2 - cr, Wt * ss / 2 + cr, b * ss / 2 + cr), fill=(6, 9, 8, 255))
    im = im.resize((Wt, Ht), LANCZOS)
    im.info["b"] = b
    im.info["sw"] = sw
    return im


def draw_tablet(fr, cam, x, y, w, layers, shadow=0.4, alpha=1.0):
    bz = tablet_bezel()
    k = w / bz.info["sw"]
    b = bz.info["b"] * k
    if shadow > 0:
        sp = soft_shadow(300, int(300 / 1.6), 22, 14)
        pad = sp.info["pad"] * (w + 2 * b) / 300
        draw_img(fr, sp, cam.rect((x - b - pad, y - b - pad + 0.03 * w, w + 2 * b + 2 * pad, w / 1.6 + 2 * b + 2 * pad)), None, shadow * alpha, BICUBIC)
    clip = cam.rect((x, y, w, w / 1.6))
    clipi = (max(0, clip[0]), max(0, clip[1]), min(W, clip[0] + clip[2]), min(H, clip[1] + clip[3]))
    for img, src, a in layers:
        if a > 0.002:
            draw_img(fr, img, clip, src, a * alpha, LANCZOS, clipi)
    draw_img(fr, bz, cam.rect((x - b, y - b, bz.width * k, bz.height * k)), None, alpha, BICUBIC)


@lru_cache(maxsize=None)
def paper_sprite(name: str, page_w: int, angle: float, margin: float = 0.07, top: float = 0.06, aspect: float = 11 / 8.5,
                 content_w: float = 1.0) -> Image.Image:
    """A sheet of paper (letter, white) with a capture printed on it, rotated by `angle` degrees."""
    img = scr(name)
    ph = int(page_w * aspect)
    page = Image.new("RGB", (page_w, ph), (252, 252, 250))
    cw = int(page_w * (1 - 2 * margin) * content_w)
    ch = int(cw * img.height / img.width)
    if ch > ph - int(top * ph) - int(0.04 * ph):
        ch = ph - int(top * ph) - int(0.04 * ph)
        cw = int(ch * img.width / img.height)
    page.paste(img.resize((cw, ch), LANCZOS), ((page_w - cw) // 2, int(top * page_w)))
    pad = int(page_w * 0.08)
    canvas = Image.new("RGBA", (page_w + 2 * pad, ph + 2 * pad), (0, 0, 0, 0))
    sh = Image.new("L", canvas.size, 0)
    ImageDraw.Draw(sh).rectangle((pad + 6, pad + 14, pad + page_w + 6, pad + ph + 14), fill=110)
    sh = sh.filter(ImageFilter.GaussianBlur(pad / 3))
    shadow = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    shadow.putalpha(sh)
    canvas.alpha_composite(shadow)
    canvas.paste(page, (pad, pad))
    if angle:
        canvas = canvas.rotate(angle, resample=BICUBIC, expand=True)
    canvas.info["page"] = (page_w, ph)
    return canvas


# ---------------------------------------------------------------------------
# Backgrounds
# ---------------------------------------------------------------------------
BGW, BGH = int(W * 1.12), int(H * 1.12)


def smooth_noise(w, h, cells, seed):
    rng = np.random.default_rng(seed)
    g = rng.random((cells[1], cells[0]))
    return np.asarray(Image.fromarray((g * 255).astype(np.uint8)).resize((w, h), BICUBIC), dtype=np.float32) / 255 - 0.5


@lru_cache(maxsize=None)
def bg_board() -> Image.Image:
    base = np.zeros((BGH, BGW, 3), np.float32) + np.array(BOARD, np.float32)
    n = smooth_noise(BGW, BGH, (14, 8), 11) * 10 + smooth_noise(BGW, BGH, (60, 34), 12) * 4
    base += n[..., None]
    # vignette
    yy, xx = np.mgrid[0:BGH, 0:BGW]
    v = ((xx - BGW / 2) / (BGW / 2)) ** 2 + ((yy - BGH / 2) / (BGH / 2)) ** 2
    base *= (1 - 0.16 * np.clip(v, 0, 1.6))[..., None]
    im = Image.fromarray(np.clip(base, 0, 255).astype(np.uint8)).convert("RGBA")
    dust = Image.new("L", (BGW, BGH), 0)
    d = ImageDraw.Draw(dust)
    rng = np.random.default_rng(5)
    for _ in range(9):
        cx, cy = rng.uniform(0, BGW), rng.uniform(0, BGH)
        rx, ry = rng.uniform(150, 420), rng.uniform(40, 110)
        d.ellipse((cx - rx, cy - ry, cx + rx, cy + ry), fill=int(rng.uniform(10, 18)))
    for _ in range(14):  # erased strokes
        x0, y0 = rng.uniform(0, BGW), rng.uniform(0, BGH)
        pts = [(x0 + i * 22, y0 + 14 * math.sin(i * 0.5 + rng.uniform(0, 3))) for i in range(int(rng.uniform(8, 30)))]
        d.line(pts, fill=int(rng.uniform(8, 14)), width=int(rng.uniform(8, 30)))
    dust = dust.filter(ImageFilter.GaussianBlur(24))
    layer = Image.new("RGBA", (BGW, BGH), CHALK + (0,))
    layer.putalpha(dust)
    im.alpha_composite(layer)
    return im.convert("RGB")


@lru_cache(maxsize=None)
def bg_paper() -> Image.Image:
    base = np.zeros((BGH, BGW, 3), np.float32) + np.array(PAPER, np.float32)
    base += (smooth_noise(BGW, BGH, (300, 170), 21) * 5)[..., None]
    base += (np.random.default_rng(22).random((BGH, BGW)) - 0.5)[..., None] * 3
    im = Image.fromarray(np.clip(base, 0, 255).astype(np.uint8)).convert("RGBA")
    ov = Image.new("RGBA", (BGW, BGH), (0, 0, 0, 0))
    d = ImageDraw.Draw(ov)
    off = (BGH - H) // 2
    for y in range(off + 70, BGH, 46):
        d.line((0, y, BGW, y), fill=RULE + (150,), width=2)
    mx = (BGW - W) // 2 + 196
    d.line((mx, 0, mx, BGH), fill=MARGIN + (170,), width=2)
    d.line((mx + 6, 0, mx + 6, BGH), fill=MARGIN + (90,), width=1)
    im.alpha_composite(ov)
    return im.convert("RGB")


def draw_bg(fr, img, cam, k=0.25, alpha=1.0):
    c = cam.parallax(k)
    ox, oy = (BGW - W) / 2, (BGH - H) / 2
    draw_img(fr, img, c.rect((-ox, -oy, BGW, BGH)), None, alpha, BICUBIC)


@lru_cache(maxsize=None)
def kitchen() -> Image.Image:
    """6 h 05: a dark kitchen before dawn (flat illustration)."""
    S = 1.25
    Wk, Hk = int(BGW * S), int(BGH * S)
    ox, oy = (BGW - W) / 2 * S, (BGH - H) / 2 * S

    def P(x, y):
        return (ox + x * S, oy + y * S)

    yy = np.linspace(0, 1, Hk)[:, None, None]
    wall = np.array((22, 33, 28), np.float32) * (1 - 0.25 * yy) + np.array((12, 18, 15), np.float32) * 0.25 * yy
    img = np.broadcast_to(wall, (Hk, Wk, 3)).copy()
    im = Image.fromarray(img.astype(np.uint8)).convert("RGBA")
    d = ImageDraw.Draw(im)
    # window with the sky before dawn
    wx0, wy0 = P(130, 110)
    wx1, wy1 = P(690, 590)
    sky = np.zeros((int(wy1 - wy0), int(wx1 - wx0), 3), np.float32)
    t = np.linspace(0, 1, sky.shape[0])[:, None]
    sky[:] = (np.array((14, 22, 40)) * (1 - t) + np.array((44, 52, 82)) * t)[:, None, :].reshape(sky.shape[0], 1, 3)
    skyim = Image.fromarray(sky.astype(np.uint8))
    sd = ImageDraw.Draw(skyim)
    rng = np.random.default_rng(9)
    for _ in range(40):
        sx, sy = rng.uniform(0, skyim.width), rng.uniform(0, skyim.height * 0.6)
        r = rng.uniform(0.8, 2.0) * S
        sd.ellipse((sx - r, sy - r, sx + r, sy + r), fill=(200, 210, 230))
    # rooftops / trees silhouette
    pts = [(0, skyim.height)]
    x = 0
    while x < skyim.width:
        hgt = skyim.height * rng.uniform(0.12, 0.3)
        wdt = rng.uniform(50, 140) * S
        pts += [(x, skyim.height - hgt), (x + wdt, skyim.height - hgt)]
        x += wdt
    pts += [(skyim.width, skyim.height)]
    sd.polygon(pts, fill=(10, 16, 24))
    # moon
    mx, my, mr = skyim.width * 0.72, skyim.height * 0.22, 26 * S
    sd.ellipse((mx - mr, my - mr, mx + mr, my + mr), fill=(232, 228, 205))
    sd.ellipse((mx - mr + 12 * S, my - mr - 6 * S, mx + mr + 12 * S, my + mr - 6 * S), fill=tuple(int(v) for v in sky[int(my - 6 * S), 0]))
    im.paste(skyim, (int(wx0), int(wy0)))
    fw = 16 * S
    d.rectangle((wx0 - fw, wy0 - fw, wx1 + fw, wy0), fill=(70, 52, 32))
    d.rectangle((wx0 - fw, wy1, wx1 + fw, wy1 + fw * 1.4), fill=(78, 58, 36))
    d.rectangle((wx0 - fw, wy0, wx0, wy1), fill=(70, 52, 32))
    d.rectangle((wx1, wy0, wx1 + fw, wy1), fill=(70, 52, 32))
    mxw = (wx0 + wx1) / 2
    d.rectangle((mxw - fw / 2, wy0, mxw + fw / 2, wy1), fill=(70, 52, 32))
    myw = (wy0 + wy1) / 2
    d.rectangle((wx0, myw - fw / 2, wx1, myw + fw / 2), fill=(70, 52, 32))
    # backsplash tiles
    by0, by1 = P(0, 600)[1], P(0, 780)[1]
    for gx in range(0, Wk, int(46 * S)):
        d.line((gx, by0, gx, by1), fill=(30, 42, 36), width=max(1, int(1.5 * S)))
    for gy in np.arange(by0, by1, 46 * S):
        d.line((0, gy, Wk, gy), fill=(30, 42, 36), width=max(1, int(1.5 * S)))
    # counter
    cy0 = P(0, 780)[1]
    d.rectangle((0, cy0, Wk, cy0 + 26 * S), fill=(96, 72, 46))
    d.rectangle((0, cy0, Wk, cy0 + 4 * S), fill=(126, 96, 62))
    d.rectangle((0, cy0 + 26 * S, Wk, Hk), fill=(30, 26, 22))
    for dx in range(-40, 2000, 330):
        x0, _ = P(dx, 0)
        d.rectangle((x0 + 14 * S, cy0 + 44 * S, x0 + 316 * S, Hk), outline=(44, 38, 32), width=int(3 * S))
        d.rounded_rectangle((x0 + 150 * S, cy0 + 70 * S, x0 + 180 * S, cy0 + 78 * S), 3 * S, fill=(70, 62, 52))
    # kettle
    kx, ky = P(290, 780)
    d.rounded_rectangle((kx, ky - 150 * S, kx + 170 * S, ky), 40 * S, fill=(34, 44, 40))
    d.rounded_rectangle((kx + 30 * S, ky - 176 * S, kx + 140 * S, ky - 140 * S), 14 * S, fill=(28, 36, 33))
    d.polygon([(kx + 170 * S, ky - 110 * S), (kx + 230 * S, ky - 150 * S), (kx + 236 * S, ky - 138 * S), (kx + 168 * S, ky - 70 * S)], fill=(34, 44, 40))
    d.rounded_rectangle((kx + 8 * S, ky - 140 * S, kx + 26 * S, ky - 40 * S), 8 * S, fill=(52, 64, 58))
    d.arc((kx + 30 * S, ky - 250 * S, kx + 140 * S, ky - 120 * S), 180, 360, fill=(46, 58, 52), width=int(12 * S))
    d.ellipse((kx + 72 * S, ky - 196 * S, kx + 98 * S, ky - 172 * S), fill=(46, 58, 52))
    # a plant on the window sill
    px_, py_ = P(470, 590)
    for i, (dx, dy, rx, ry) in enumerate(((-20, -60, 22, 52), (16, -70, 20, 58), (0, -86, 16, 50), (-36, -40, 18, 38), (34, -44, 18, 40))):
        d.ellipse((px_ + (dx - rx) * S, py_ + (dy - ry) * S, px_ + (dx + rx) * S, py_ + (dy + ry) * S), fill=(36, 70, 52))
    d.polygon([(px_ - 44 * S, py_ - 18 * S), (px_ + 44 * S, py_ - 18 * S), (px_ + 34 * S, py_ + 28 * S), (px_ - 34 * S, py_ + 28 * S)], fill=(150, 84, 58))
    # mug
    gx, gy = P(560, 780)
    d.rounded_rectangle((gx, gy - 92 * S, gx + 80 * S, gy), 12 * S, fill=(150, 62, 52))
    d.ellipse((gx + 66 * S, gy - 70 * S, gx + 110 * S, gy - 26 * S), outline=(150, 62, 52), width=int(9 * S))
    d.rectangle((gx + 4 * S, gy - 92 * S, gx + 76 * S, gy - 84 * S), fill=(120, 48, 40))
    # wall clock: 6 h 05
    ccx, ccy = P(1640, 230)
    r = 92 * S
    d.ellipse((ccx - r - 10 * S, ccy - r - 10 * S, ccx + r + 10 * S, ccy + r + 10 * S), fill=(88, 66, 40))
    d.ellipse((ccx - r, ccy - r, ccx + r, ccy + r), fill=(196, 196, 182))
    for i in range(12):
        a = i / 12 * 2 * math.pi
        r0, r1 = r * (0.78 if i % 3 else 0.7), r * 0.9
        d.line((ccx + r0 * math.sin(a), ccy - r0 * math.cos(a), ccx + r1 * math.sin(a), ccy - r1 * math.cos(a)), fill=(40, 46, 42), width=int((5 if i % 3 == 0 else 3) * S))
    ah = (6 + 5 / 60) / 12 * 2 * math.pi
    am = 5 / 60 * 2 * math.pi
    d.line((ccx, ccy, ccx + r * 0.5 * math.sin(ah), ccy - r * 0.5 * math.cos(ah)), fill=(30, 34, 32), width=int(9 * S))
    d.line((ccx, ccy, ccx + r * 0.76 * math.sin(am), ccy - r * 0.76 * math.cos(am)), fill=(30, 34, 32), width=int(6 * S))
    d.ellipse((ccx - 8 * S, ccy - 8 * S, ccx + 8 * S, ccy + 8 * S), fill=(30, 34, 32))
    im = im.convert("RGB")
    # night: everything a little blue and dark
    a = np.asarray(im, np.float32)
    a = a * np.array((0.78, 0.84, 1.0))
    im = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))
    return im


@lru_cache(maxsize=None)
def glow_sprite() -> Image.Image:
    s = 400
    yy, xx = np.mgrid[0:s, 0:s]
    r = np.hypot(xx - s / 2, yy - s / 2) / (s / 2)
    a = np.clip(1 - r, 0, 1) ** 2.2
    im = Image.new("RGBA", (s, s), (200, 222, 255, 0))
    im.putalpha(Image.fromarray((a * 255).astype(np.uint8)))
    return im


@lru_cache(maxsize=None)
def classroom() -> Image.Image:
    """The class-mode wall: a warm, slightly dimmed wall and a wood strip."""
    yy = np.linspace(0, 1, BGH)[:, None, None]
    top = np.array((205, 210, 198), np.float32)
    bot = np.array((176, 182, 170), np.float32)
    img = top * (1 - yy) + bot * yy
    img = np.broadcast_to(img, (BGH, BGW, 3)).copy()
    yy2, xx = np.mgrid[0:BGH, 0:BGW]
    v = ((xx - BGW * 0.36) / (BGW * 0.7)) ** 2 + ((yy2 - BGH * 0.4) / (BGH * 0.8)) ** 2
    img *= (1 - 0.28 * np.clip(v, 0, 1.4))[..., None]
    img += (smooth_noise(BGW, BGH, (90, 50), 31) * 5)[..., None]
    im = Image.fromarray(np.clip(img, 0, 255).astype(np.uint8))
    d = ImageDraw.Draw(im)
    oy = (BGH - H) // 2
    d.rectangle((0, oy + 930, BGW, oy + 950), fill=FRAME2)
    d.rectangle((0, oy + 950, BGW, BGH), fill=(150, 122, 86))
    return im


@lru_cache(maxsize=None)
def canada_poly():
    with open(os.path.join(SHOTS, "canada.json")) as f:
        return json.load(f)


@lru_cache(maxsize=None)
def canada_sprite(width: int = 1300) -> Image.Image:
    data = canada_poly()
    k = width / data["width"]
    h = int(data["height"] * k) + 20
    ss = 2
    fill = Image.new("L", ((width + 20) * ss, h * ss), 0)
    line = Image.new("L", fill.size, 0)
    df, dl = ImageDraw.Draw(fill), ImageDraw.Draw(line)
    for poly in data["polygons"]:
        pts = [((x * k + 10) * ss, (y * k + 10) * ss) for x, y in poly]
        df.polygon(pts, fill=255)
        dl.line(pts + [pts[0]], fill=255, width=int(3.2 * ss), joint="curve")
    fill = fill.resize((width + 20, h), LANCZOS)
    line = line.resize((width + 20, h), LANCZOS)
    fa = np.asarray(fill, np.float32) / 255 * 0.16
    la = np.asarray(line, np.float32) / 255 * chalk_noise(width + 20, h, 77)
    a = np.clip(np.maximum(fa, la * 0.95), 0, 1)
    im = Image.new("RGBA", (width + 20, h), CHALK + (0,))
    im.putalpha(Image.fromarray((a * 255).astype(np.uint8)))
    return im


@lru_cache(maxsize=None)
def padlock_sprite(size: int = 220, color=CHALKY) -> Image.Image:
    ss = 3
    s = size * ss
    im = Image.new("L", (s, int(s * 1.2)), 0)
    d = ImageDraw.Draw(im)
    bw, bh = s * 0.78, s * 0.6
    bx, by = (s - bw) / 2, s * 0.55
    d.rounded_rectangle((bx, by, bx + bw, by + bh), s * 0.08, fill=255)
    sw = s * 0.11
    d.arc((s * 0.24, s * 0.12, s * 0.76, s * 0.98), 180, 360, fill=255, width=int(sw))
    d.rectangle((s * 0.24, s * 0.54, s * 0.24 + sw, s * 0.6), fill=255)
    d.rectangle((s * 0.76 - sw, s * 0.54, s * 0.76, s * 0.6), fill=255)
    d.ellipse((s * 0.45, by + bh * 0.3, s * 0.55, by + bh * 0.3 + s * 0.1), fill=0)
    d.rectangle((s * 0.48, by + bh * 0.3 + s * 0.05, s * 0.52, by + bh * 0.72), fill=0)
    im = im.resize((size, int(size * 1.2)), LANCZOS)
    a = np.asarray(im, np.float32) / 255 * chalk_noise(im.width, im.height, 91)
    out = Image.new("RGBA", im.size, color + (0,))
    out.putalpha(Image.fromarray((np.clip(a, 0, 1) * 255).astype(np.uint8)))
    return out


@lru_cache(maxsize=None)
def chalkboard_sprite(w: int, h: int, tray: bool = True, scale: int = 2) -> Image.Image:
    """A framed classroom chalkboard (as on the site's hero), w x h world px."""
    S = scale
    fw = int(20 * S)
    im = Image.new("RGBA", (w * S, (h + (26 if tray else 0)) * S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.rounded_rectangle((0, 0, w * S - 1, h * S - 1), 14 * S, fill=FRAME)
    d.rounded_rectangle((4 * S, 4 * S, w * S - 1 - 4 * S, h * S - 1 - 4 * S), 12 * S, outline=(176, 138, 90), width=2 * S)
    bw, bh = w * S - 2 * fw, h * S - 2 * fw
    board = np.zeros((bh, bw, 3), np.float32) + np.array(BOARD, np.float32)
    board += (smooth_noise(bw, bh, (10, 6), 41) * 9 + smooth_noise(bw, bh, (50, 30), 42) * 4)[..., None]
    bim = Image.fromarray(np.clip(board, 0, 255).astype(np.uint8)).convert("RGBA")
    dust = Image.new("L", (bw, bh), 0)
    dd = ImageDraw.Draw(dust)
    rng = np.random.default_rng(43)
    for cx, cy, rx, ry in ((0.3, 0.28, 0.27, 0.11), (0.65, 0.72, 0.3, 0.14), (0.15, 0.85, 0.13, 0.07), (0.85, 0.2, 0.15, 0.08)):
        dd.ellipse(((cx - rx) * bw, (cy - ry) * bh, (cx + rx) * bw, (cy + ry) * bh), fill=13)
    for _ in range(10):
        x0, y0 = rng.uniform(0, bw), rng.uniform(0, bh)
        pts = [(x0 + i * 24 * S, y0 + 10 * S * math.sin(i * 0.6)) for i in range(int(rng.uniform(6, 22)))]
        dd.line(pts, fill=9, width=int(rng.uniform(10, 26) * S))
    dust = dust.filter(ImageFilter.GaussianBlur(20 * S))
    lay = Image.new("RGBA", (bw, bh), CHALK + (0,))
    lay.putalpha(dust)
    bim.alpha_composite(lay)
    m = rounded_mask((bw, bh), 6 * S)
    im.paste(bim, (fw, fw), m)
    if tray:
        ty = h * S - 12 * S
        d = ImageDraw.Draw(im)
        d.rounded_rectangle((-0 + 8 * S, ty, w * S - 8 * S, ty + 22 * S), 4 * S, fill=FRAME2)
        d.rounded_rectangle((int(0.12 * w * S), ty - 9 * S, int(0.12 * w * S) + 64 * S, ty + 3 * S), 5 * S, fill=CHALK)
        d.rounded_rectangle((int(0.12 * w * S) + 80 * S, ty - 7 * S, int(0.12 * w * S) + 112 * S, ty + 3 * S), 4 * S, fill=(236, 214, 140))
        d.rounded_rectangle((int(0.3 * w * S), ty - 16 * S, int(0.3 * w * S) + 120 * S, ty - 2 * S), 3 * S, fill=FRAME)
        d.rounded_rectangle((int(0.3 * w * S), ty - 4 * S, int(0.3 * w * S) + 120 * S, ty + 6 * S), 3 * S, fill=FELT)
    im.info["scale"] = S
    return im


@lru_cache(maxsize=None)
def logo_sprite(w: int = 420) -> Image.Image:
    """The site's mark: a small chalkboard (wood edge) with a chalk « é »."""
    S = 2
    h = int(w * 24 / 32)
    im = Image.new("RGBA", (w * S, h * S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    r = int(w * 3 / 32 * S)
    d.rounded_rectangle((0, 0, w * S - 1, h * S - 1), r, fill=FRAME)
    e = int(w * 2 / 32 * S)
    d.rounded_rectangle((e, e, w * S - 1 - e, h * S - 1 - e), max(1, r - e), fill=BOARD)
    im.info["scale"] = S
    return im


# ---------------------------------------------------------------------------
# Timeline
# ---------------------------------------------------------------------------
TARGETS = [5.6, 9.0, 5.2, 7.0, 4.2, 7.8, 6.6, 8.0, 8.0, 6.6, 8.0, 8.0, 5.0]


@dataclass
class Scene:
    idx: int
    start: float
    dur: float
    v0: float          # voice start (local)
    vd: float          # voice duration
    say: str
    caption: str
    wav: str = ""

    def kw(self, word: str, frac_in_word: float = 0.0) -> float:
        """Local time when `word` is spoken (proportional to its position in the line)."""
        i = self.say.find(word)
        if i < 0:
            i = 0
        i += frac_in_word * len(word)
        return self.v0 + self.vd * (i / max(1, len(self.say)))


def build_timeline(meta: list[dict]) -> list[Scene]:
    scenes, t = [], 0.0
    n = len(meta)
    for i, m in enumerate(meta):
        vd = m["duration"]
        lead = FIRST_LEAD if i == 0 else LEAD
        need = lead + vd + TAIL
        dur = max(TARGETS[i], need)
        slack = dur - need
        v0 = lead + min(slack * 0.3, 0.8)
        if i == 0:
            v0 = FIRST_LEAD
        if i == n - 1:
            dur = max(TARGETS[i], 0.9 + vd + 0.4) + END_HOLD
            v0 = 0.9
        dur = round(dur * FPS) / FPS
        scenes.append(Scene(i, t, dur, v0, vd, m["say"], m["caption"], m["wav"]))
        t += dur
    return scenes


# ---------------------------------------------------------------------------
# Overlays: margin labels and captions
# ---------------------------------------------------------------------------
LABEL_COLORS = {"board": CHALKY, "night": CHALKY, "paper": MARGIN, "wall": (52, 70, 58)}


def label(fr, text, style, t, t_in, t_out=None, x=64.0, y=34.0, size=62, cam=IDENT):
    """A handwritten margin note (time or place), written in over 0.55 s."""
    if t < t_in:
        return
    alpha = 1.0 if t_out is None else 1 - ramp(t, t_out, t_out + 0.35)
    if alpha <= 0:
        return
    rev = clamp((t - t_in) / 0.55)
    draw_text(fr, text, "hand-bold", size, LABEL_COLORS[style], x, y, cam, alpha, chalk=style != "paper", reveal=rev)
    tw = text_width(text, "hand-bold", size)
    if rev >= 1:
        u = clamp((t - t_in - 0.55) / 0.3)
        y0 = y + size * 1.02
        pts = hand_line(x + 2, y0, x + tw * 0.92, y0 - 3, seed=len(text), amp=1.6)
        k = max(2, int(len(pts) * u))
        stroke(fr, [cam.pt(*p) for p in pts[:k]], LABEL_COLORS[style], 3.2, alpha * 0.85)


@lru_cache(maxsize=None)
def caption_sprite(text: str) -> Image.Image:
    kind, size, maxw = "body-medium", 40, 1480
    lines = wrap(text, kind, size, maxw)
    if len(lines) > 2:
        size, maxw = 36, 1640
        lines = wrap(text, kind, size, maxw)
    f = font(kind, size)
    lh = int(size * 1.36)
    tw = max(f.getlength(ln) for ln in lines)
    px, py = 34, 17
    bw, bh = int(tw + 2 * px), int(len(lines) * lh + 2 * py)
    ss = 2
    box = Image.new("RGBA", (bw * ss, bh * ss), (0, 0, 0, 0))
    ImageDraw.Draw(box).rounded_rectangle((0, 0, bw * ss - 1, bh * ss - 1), 20 * ss, fill=BOARD + (236,), outline=CHALK + (40,), width=2 * ss)
    box = box.resize((bw, bh), LANCZOS)
    d = ImageDraw.Draw(box)
    asc, desc = f.getmetrics()
    for i, ln in enumerate(lines):
        lw = f.getlength(ln)
        d.text(((bw - lw) / 2, py + i * lh + (lh - (asc + desc)) / 2 + 1), ln, font=f, fill=CHALK)
    return box


def draw_caption(fr, sc, t):
    a = ramp(t, sc.v0 - 0.18, sc.v0 + 0.12) * (1 - ramp(t, sc.v0 + sc.vd + 0.25, sc.v0 + sc.vd + 0.6))
    if a <= 0.002:
        return
    spr = caption_sprite(sc.caption)
    x = int(round((W - spr.width) / 2))
    y = int(round(1046 - spr.height + 8 * (1 - a)))
    paste(fr, spr, (x, y), a)


def screen_pt(rect, img, box, u, v):
    """World point of the image's normalised point (u, v) shown in screen rect with src box."""
    x, y, w, h = rect
    sx0, sy0, sx1, sy1 = box
    return (x + (u * img.width - sx0) / (sx1 - sx0) * w, y + (v * img.height - sy0) / (sy1 - sy0) * h)


def cam_keys(t, keys):
    """keys: [(t, z, fx, fy)] -> camera pushing toward focus points, eased between keys."""
    z, fx, fy = keyed(t, [(k[0], k[1:]) for k in keys])
    return cam_toward(z, fx, fy)


def fade_layers(t, seq, xf=0.16):
    """seq: [(t_start, img, box)] -> layers with cross-fades (each layer from its start)."""
    out = []
    for i, (ts, img, box) in enumerate(seq):
        if t < ts - xf and i > 0:
            break
        a = 1.0 if i == 0 else ramp(t, ts - xf / 2, ts + xf / 2)
        out.append((img, box, a))
    return out


def phone_box(img):
    return view_box(img, 390 / 844, top=True)


# ---------------------------------------------------------------------------
# Scenes. Each draws one frame at local time t (seconds since the scene's start).
# ---------------------------------------------------------------------------
def s01_kitchen(fr, sc, t):
    PW = 318.0
    PH = PW * PH_ASPECT
    PX, PY = 1011.0, 800 - PW * PH_BEZ - PH
    b1 = (PX + 0.254 * PW, PY + 0.207 * PH)
    b2 = (PX + 0.5 * PW, PY + 0.890 * PH)
    t1 = max(sc.v0 + sc.vd - 0.2, 2.2)
    t2 = t1 + 1.3
    cam = cam_keys(t, [(0.0, 1.0, 960, 560), (0.4, 1.0, 960, 560), (t1 - 0.1, 1.5, b1[0], b1[1] + 30),
                       (t1 + 0.45, 1.5, b1[0], b1[1] + 30), (t2 - 0.2, 1.5, b2[0], b2[1] - 40),
                       (t2 + 0.5, 1.5, b2[0], b2[1] - 40), (sc.dur, 1.28, PX + PW / 2, PY + PH * 0.42)])
    draw_bg(fr, kitchen(), cam, k=0.55)
    on = ramp(t, 0.45, 0.8)
    g = glow_sprite()
    gw = 1300
    draw_img(fr, g, cam.rect((PX + PW / 2 - gw / 2, PY + PH / 2 - gw / 2, gw, gw)), None, 0.34 * on, BICUBIC)
    for j in range(2):  # steam from the mug
        ph_ = t * 1.3 + j * 2.1
        pts = [(590 + j * 20 + 8 * math.sin(ph_ + k * 0.5), 676 - k * 8) for k in range(12)]
        pc = cam.parallax(0.55)
        stroke(fr, [pc.pt(*p) for p in pts], CHALK, 4 * pc.z, 0.07 + 0.03 * math.sin(ph_))
    today, absent, ready = scr("today"), scr("absence"), scr("absence-ready")
    layers = [(today, phone_box(today), on), (absent, phone_box(absent), on * ramp(t, t1 + 0.26, t1 + 0.42)),
              (ready, phone_box(ready), on * ramp(t, t2 + 0.34, t2 + 0.5))]
    draw_phone(fr, cam, PX, PY, PW, layers, shadow=0.55)
    ripple(fr, cam, *b1, t, t1)
    ripple(fr, cam, *b2, t, t2)
    label(fr, T("6 h 05", "6:05 a.m."), "night", t, 0.5)


BOARD_ROWS = [
    ("8 h 45", "Prière du matin et Ô Canada", None),
    ("8 h 55", "Français · Leçon 4 : l’idée principale", "G1 · G2 · G3 · G4"),
    ("9 h 45", "Mathématiques · Leçon 5", "G1 · G2 · G3 · G4"),
    ("10 h 35", "Pause santé", None),
    ("11 h 15", "Français · Leçon 5 : les détails importants", None),
    ("12 h 05", "Rassemblement : collecte d’aliments", None),
    ("13 h 30", "Messe de l’école", None),
    ("14 h 25", "Mathématiques · Leçon 6", None),
]


def board_fr(s: str) -> str:
    return s.replace(" h ", NB + "h" + NB).replace(" : ", NB + ": ")


def s02_plan(fr, sc, t):
    cam = cam_keys(t, [(0, 1.0, 960, 470), (sc.dur, 1.045, 900, 470)])
    draw_bg(fr, bg_paper(), cam)
    BX, BY, BW, BH = 64, 46, 1200, 806
    sh = soft_shadow(300, int(300 * BH / BW), 12, 12)
    k = BW / 300
    draw_img(fr, sh, cam.rect((BX - sh.info["pad"] * k + 6, BY - sh.info["pad"] * k + 14, sh.width * k, sh.height * k)), None, 0.35, BICUBIC)
    draw_sprite(fr, chalkboard_sprite(BW, BH), BX, BY, cam, w=BW)
    # header
    t_rows = 0.35
    draw_text(fr, "Mardi 6 octobre", "hand-bold", 58, CHALK, BX + 48, BY + 40, cam, chalk=True, reveal=clamp((t - t_rows) / 0.5))
    draw_text(fr, "3e année · local 101", "hand", 42, CHALK2, BX + 400, BY + 54, cam, chalk=True, reveal=clamp((t - t_rows - 0.35) / 0.4))
    if t > t_rows + 0.6:
        pts = hand_line(BX + 46, BY + 116, BX + 760, BY + 112, seed=4, amp=1.5)
        kk = max(2, int(len(pts) * clamp((t - t_rows - 0.6) / 0.35)))
        stroke(fr, [cam.pt(*p) for p in pts[:kk]], CHALK, 2.6 * cam.z, 0.8)
    y0, dy = BY + 142, 66
    k_less = sc.kw("prochaines" if LANG == "fr" else "next")
    k_grp = sc.kw("groupes" if LANG == "fr" else "groups")
    k_mass = sc.kw("messe" if LANG == "fr" else "mass")
    for i, (tm, txt, grp) in enumerate(BOARD_ROWS):
        ti = t_rows + 0.75 + i * 0.36
        yy = y0 + i * dy
        draw_text(fr, board_fr(tm), "hand-bold", 44, CHALKY, BX + 50, yy, cam, chalk=True, reveal=clamp((t - ti) / 0.25))
        draw_text(fr, board_fr(txt), "hand", 46, CHALK, BX + 200, yy - 2, cam, chalk=True, reveal=clamp((t - ti - 0.12) / 0.45))
        tw = text_width(board_fr(txt), "hand", 46)
        if grp:
            gx = BX + 200 + tw + 34
            ga = clamp((t - ti - 0.5) / 0.3)
            hi = ramp(t, k_grp - 0.1, k_grp + 0.3)
            draw_text(fr, grp, "hand", 38, CHALK2, gx, yy + 4, cam, alpha=ga * (1 - hi), chalk=True)
            draw_text(fr, grp, "hand-bold", 38, CHALKY, gx, yy + 4, cam, alpha=ga * hi, chalk=True)
        if "Leçon" in txt:
            j = [1, 2, 4, 7].index(i) if i in (1, 2, 4, 7) else 0
            draw_underline(fr, cam, BX + 200, yy + 52, BX + 200 + tw, (t - k_less - 0.12 * j) / 0.4, CHALKY, 3.2, 0.9, seed=10 + i)
        if "Messe" in txt:
            draw_ellipse_mark(fr, cam, BX + 50 + (150 + tw) / 2 + 4, yy + 28, (150 + tw) / 2 + 40, 36, (t - k_mass + 0.1) / 0.6, CHALKY, 3.6, 0.95, seed=6)
    # faith moment, last line
    tf = t_rows + 0.75 + len(BOARD_ROWS) * 0.36
    draw_text(fr, board_fr("Moment de foi : la compassion"), "hand-bold", 42, CHALKY, BX + 200, y0 + len(BOARD_ROWS) * dy + 6, cam, chalk=True,
              reveal=clamp((t - tf) / 0.5))
    # the teacher's phone: the plan is ready
    PW = 356.0
    PX, PY = 1386.0, 64.0
    ready = scr("absence-ready")
    draw_phone(fr, cam, PX, PY, PW, [(ready, phone_box(ready), 1.0)], shadow=0.3)
    ph = PW * PH_ASPECT
    draw_underline(fr, cam, PX + 0.10 * PW, PY + 0.624 * ph, PX + 0.59 * PW, (t - k_mass - 0.25) / 0.45, MARGIN, 3.6, 0.95, seed=8)


def s03_code(fr, sc, t):
    PW = 330.0
    PX, PY = 300.0, 112.0
    ph = PW * PH_ASPECT
    LX, LY, LW = 724.0, 110.0, 1110.0
    lh = LW / 1.6
    k_sec = sc.kw("secrétariat" if LANG == "fr" else "office")
    t_pub = 0.35
    t_tap = k_sec + 0.05
    t_sheet = t_tap + 0.75
    cam = cam_keys(t, [(0, 1.14, PX + PW / 2, PY + ph * 0.5), (t_pub + 0.9, 1.14, PX + PW / 2, PY + ph * 0.5),
                       (t_tap - 0.15, 1.06, 1180, 470), (t_sheet + 0.2, 1.06, 1180, 470), (sc.dur, 1.0, 1060, 470)])
    draw_bg(fr, bg_board(), cam)
    ready, pub = scr("absence-ready"), scr("absence-published")
    draw_phone(fr, cam, PX, PY, PW, [(ready, phone_box(ready), 1), (pub, phone_box(pub), ramp(t, t_pub, t_pub + 0.18))])
    draw_ellipse_mark(fr, cam, PX + 0.849 * PW, PY + 0.486 * ph, 56, 26, (t - t_pub - 0.35) / 0.5, MARGIN, 4, seed=3)
    office, code = scr("office"), scr("office-code")
    full = view_box(office, 1.6)
    draw_laptop(fr, cam, LX, LY, LW, [(office, full, 1), (code, full, ramp(t, t_tap + 0.28, t_tap + 0.44))])
    ripple(fr, cam, LX + 0.193 * LW, LY + 0.54 * lh, t, t_tap)
    # the welcome sheet comes out of the printer
    u = ramp(t, t_sheet, t_sheet + 0.9)
    if u > 0:
        spr = paper_sprite("welcome-sheet", 1000, -4.0, margin=0.05, top=0.05, aspect=0.46)
        draw_sprite(fr, spr, 1250, lerp(1160, 452, u), cam, w=600, alpha=clamp(u * 3))
    label(fr, T("7 h 30", "7:30 a.m."), "board", t, 0.25, k_sec - 0.45)
    label(fr, T("7 h 40", "7:40 a.m."), "board", t, k_sec - 0.2)


def s04_substitute(fr, sc, t):
    PW = 372.0
    PX, PY = 960 - PW / 2, 42.0
    ph = PW * PH_ASPECT
    now, stu = scr("sub-now"), scr("sub-students")
    k_al = sc.kw("alertes" if LANG == "fr" else "alerts")
    t_tab = k_al - 0.75
    card = (960, PY + 0.73 * ph)
    tab = (PX + 0.387 * PW, PY + 0.291 * ph)
    btn = (PX + 0.449 * PW, PY + 0.517 * ph)
    cam = cam_keys(t, [(0, 1.0, 960, 470), (0.3, 1.0, 960, 470), (t_tab - 0.6, 1.32, card[0], card[1] - 40),
                       (t_tab - 0.05, 1.18, 960, 420), (t_tab + 0.7, 1.32, btn[0] + 60, btn[1] - 20), (sc.dur, 1.36, btn[0] + 70, btn[1] - 20)])
    draw_bg(fr, bg_board(), cam)
    draw_phone(fr, cam, PX, PY, PW, [(now, phone_box(now), 1), (stu, phone_box(stu), ramp(t, t_tab + 0.26, t_tab + 0.42))])
    ripple(fr, cam, *tab, t, t_tab)
    draw_ellipse_mark(fr, cam, btn[0] + 6, btn[1], 0.42 * PW, 30, (t - t_tab - 0.85) / 0.6, MARGIN, 4, seed=5)
    note = T("sur demande seulement", "only on request")
    nx, ny = PX + PW + 70, btn[1] - 110
    na = ramp(t, t_tab + 1.1, t_tab + 1.4)
    draw_text(fr, note, "hand-bold", 52, CHALKY, nx, ny, cam, alpha=na, chalk=True, reveal=clamp((t - t_tab - 1.1) / 0.6))
    draw_arrow(fr, cam, ((nx + 10, ny + 68), (nx - 30, ny + 112), (btn[0] + 0.42 * PW + 26, btn[1] + 6)),
               (t - t_tab - 1.6) / 0.4, CHALKY, 4.0 * cam.z ** 0.5, 0.95)
    label(fr, T("8 h 50", "8:50 a.m."), "board", t, 0.3)


def s05_report(fr, sc, t):
    PW = 338.0
    ph = PW * PH_ASPECT
    LXp, RXp, PY = 330.0, 1252.0, 116.0
    rep, conf = scr("sub-report"), scr("confirm")
    t_send = sc.v0 + 0.55
    t_in = t_send + 0.75
    cam = cam_keys(t, [(0, 1.0, 960, 480), (sc.dur, 1.05, 960, 480)])
    draw_bg(fr, bg_board(), cam)
    draw_phone(fr, cam, LXp, PY, PW, [(rep, phone_box(rep), 1)])
    ripple(fr, cam, LXp + 0.5 * PW, PY + 0.957 * ph, t, t_send)
    draw_text(fr, T("15 h 30", "3:30 p.m."), "hand-bold", 56, CHALKY, LXp + PW / 2, PY - 22, cam, chalk=True, anchor="cb",
              reveal=clamp((t - 0.25) / 0.5))
    draw_arrow(fr, cam, ((LXp + PW + 60, 470), (960, 340), (RXp - 60, 470)), (t - t_send - 0.25) / 0.6, CHALKY, 4.5)
    u = ramp(t, t_in, t_in + 0.55)
    if u > 0:
        draw_phone(fr, cam, RXp + 40 * (1 - u), PY, PW, [(conf, phone_box(conf), 1)], alpha=u)
        draw_text(fr, T("Le lendemain", "Next morning"), "hand-bold", 56, CHALKY, RXp + PW / 2, PY - 22, cam, chalk=True, anchor="cb",
                  reveal=clamp((t - t_in - 0.1) / 0.55))
        ripple(fr, cam, RXp + 0.218 * PW, PY + 0.498 * ph, t, t_in + 0.6)
        ripple(fr, cam, RXp + 0.218 * PW, PY + 0.784 * ph, t, t_in + 1.05)


def s06_bank(fr, sc, t):
    LX, LY, LW = 300.0, 84.0, 1080.0
    lh = LW / 1.6
    srch, item = scr("library-search"), scr("library-item")
    k_ra = sc.kw("rangée" if LANG == "fr" else "filed")
    k_ver = sc.kw("version")
    t_item = k_ra - 0.1
    t_sheet = k_ver + 0.1
    cam = cam_keys(t, [(0, 1.0, 960, 470), (sc.dur, 1.04, 900, 470)])
    draw_bg(fr, bg_paper(), cam)
    b_s = lerp_box(view_box(srch, 1.6), view_box(srch, 1.6, 1.3, 0.42, 0.28), ramp(t, 0.2, t_item))
    b_i = lerp_box(view_box(item, 1.6, 1.2, 0.42, 0.33), view_box(item, 1.6, 1.42, 0.40, 0.36), ramp(t, t_item, t_sheet + 0.6))
    draw_laptop(fr, cam, LX, LY, LW, [(srch, b_s, 1), (item, b_i, ramp(t, t_item - 0.08, t_item + 0.08))])
    if t > t_item:
        x0, y0 = screen_pt((LX, LY, LW, lh), item, b_i, 0.108, 0.405)
        x1, _ = screen_pt((LX, LY, LW, lh), item, b_i, 0.556, 0.405)
        draw_underline(fr, cam, x0, y0, x1, (t - k_ver + 0.3) / 0.5, MARGIN, 4.2, seed=12)
    u = ramp(t, t_sheet, t_sheet + 0.8)
    if u > 0:
        spr = paper_sprite("library-sheet-top", 1000, 3.0, margin=0.05, top=0.05, aspect=0.66)
        draw_sprite(fr, spr, 1150, lerp(1150, 430, u), cam, w=700, alpha=clamp(u * 3))
        note = T("aucun nom de niveau", "no level name")
        draw_text(fr, note, "hand-bold", 50, MARGIN, 1420, 330, cam, reveal=clamp((t - t_sheet - 0.7) / 0.6))
        draw_arrow(fr, cam, ((1700, 400), (1760, 440), (1745, 492)), (t - t_sheet - 1.2) / 0.35, MARGIN, 3.8)
    label(fr, T("Ressources", "Resources"), "paper", t, 0.3, x=28, size=50)


def s07_class(fr, sc, t):
    cam = cam_keys(t, [(0, 1.0, 960, 470), (sc.dur, 1.04, 920, 470)])
    draw_bg(fr, classroom(), cam, k=0.4)
    SX, SY, SW = 86.0, 66.0, 1130.0
    sh_ = SW / 1.6
    # pull-down screen: case on top, weighted bar below
    d_case = cam.rect((SX - 26, SY - 30, SW + 52, 26))
    q, ans, rank = scr("proj-question"), scr("proj-answer"), scr("proj-ranking")
    k_tab = sc.kw("tablettes" if LANG == "fr" else "tablets")
    t_ans = k_tab + 0.3
    t_rank = max(sc.v0 + sc.vd - 0.5, t_ans + 1.4)
    full = view_box(q, 1.6)
    sh = soft_shadow(300, int(300 / 1.6), 4, 16)
    kk = (SW + 20) / 300
    draw_img(fr, sh, cam.rect((SX - 10 - sh.info["pad"] * kk, SY - sh.info["pad"] * kk + 10, sh.width * kk, sh.height * kk)), None, 0.3, BICUBIC)
    rect = cam.rect((SX - 8, SY - 4, SW + 16, sh_ + 12))
    ImageDraw.Draw(fr).rectangle((rect[0], rect[1], rect[0] + rect[2], rect[1] + rect[3]), fill=(236, 238, 234))
    clip = cam.rect((SX, SY, SW, sh_))
    for img, a in ((q, 1), (ans, ramp(t, t_ans - 0.08, t_ans + 0.08)), (rank, ramp(t, t_rank - 0.08, t_rank + 0.08))):
        draw_img(fr, img, clip, full, a, LANCZOS)
    draw_img(fr, projector_falloff(), clip, None, 1.0, BICUBIC)
    d = ImageDraw.Draw(fr)
    d.rounded_rectangle((d_case[0], d_case[1], d_case[0] + d_case[2], d_case[1] + d_case[3]), 8 * cam.z, fill=(70, 74, 80))
    bar = cam.rect((SX - 4, SY + sh_ + 8, SW + 8, 9))
    d.rounded_rectangle((bar[0], bar[1], bar[0] + bar[2], bar[1] + bar[3]), 4, fill=(70, 74, 80))
    # one class tablet (device 1): the code, joined, the right answer, the ranking
    TX, TW = 1300.0, 560.0
    th = TW / 1.6
    TY = 214.0
    tc, tj, ta, tr = (scr(n) for n in ("tablet-code", "tablet-joined", "tablet-answer", "tablet-ranking"))
    fb = view_box(tc, 1.6)
    t_join = 0.95
    draw_tablet(fr, cam, TX, TY, TW, fade_layers(t, [(0, tc, fb), (t_join + 0.3, tj, fb), (t_ans + 0.1, ta, fb), (t_rank + 0.1, tr, fb)]))
    ripple(fr, cam, TX + 0.5 * TW, TY + 0.535 * th, t, t_join)
    note = T("sans compte d’élève", "no student accounts")
    k_no = sc.kw("sans" if LANG == "fr" else "no student")
    draw_text(fr, note, "hand-bold", 50, (52, 70, 58), TX + TW / 2, TY + th + 70, cam, anchor="ct", reveal=clamp((t - k_no) / 0.6))
    label(fr, T("Mode classe", "Class mode"), "wall", t, 0.3, x=40, y=850, size=54)


@lru_cache(maxsize=None)
def projector_falloff() -> Image.Image:
    s = (320, 200)
    yy, xx = np.mgrid[0:s[1], 0:s[0]]
    r = ((xx - s[0] / 2) / (s[0] / 2)) ** 2 + ((yy - s[1] / 2) / (s[1] / 2)) ** 2
    a = np.clip(r - 0.25, 0, 2) * 0.09
    im = Image.new("RGBA", s, (30, 26, 20, 0))
    im.putalpha(Image.fromarray((np.clip(a, 0, 1) * 255).astype(np.uint8)))
    return im


def s08_year(fr, sc, t):
    LX, LY, LW = 290.0, 84.0, 1060.0
    year, cov = scr("year"), scr("coverage")
    k_att = sc.kw("attente" if LANG == "fr" else "expectation")
    k_en = sc.kw("enseigné" if LANG == "fr" else "taught")
    k_pr = sc.kw("prévu" if LANG == "fr" else "planned")
    k_ve = sc.kw("encore" if LANG == "fr" else "still")
    t_ph = k_att - 0.5
    cam = cam_keys(t, [(0, 1.0, 960, 470), (sc.dur, 1.03, 960, 470)])
    draw_bg(fr, bg_paper(), cam)
    b = lerp_box(view_box(year, 1.6), view_box(year, 1.6, 1.2, 0.52, 0.64), ramp(t, 0.3, t_ph + 0.6))
    draw_laptop(fr, cam, LX, LY, LW, [(year, b, 1)])
    u = ramp(t, t_ph, t_ph + 0.6)
    if u > 0:
        PW = 320.0
        PX, PY = 1470.0 + 50 * (1 - u), 96.0
        ph = PW * PH_ASPECT
        draw_phone(fr, cam, PX, PY, PW, [(cov, phone_box(cov), 1)], alpha=u)
        for (uu, vv, kt, seed) in ((0.25, 0.134, k_en, 21), (0.218, 0.372, k_pr, 22), (0.321, 0.843, k_ve, 23)):
            draw_ellipse_mark(fr, cam, PX + uu * PW, PY + vv * ph, 0.18 * PW if uu < 0.3 else 0.25 * PW, 20, (t - kt + 0.15) / 0.45, MARGIN, 3.6, u, seed)
        draw_text(fr, T("curriculum de démonstration", "demo curriculum"), "hand", 36, INK2, PX + PW / 2, PY + ph + 34, cam, alpha=u, anchor="ct")
    label(fr, T("Mon année", "My year"), "paper", t, 0.3, x=28, size=50)


def s09_reports(fr, sc, t):
    LX, LY, LW = 385.0, 66.0, 1150.0
    lh = LW / 1.6
    rep, com = scr("reports"), scr("report-comment")
    k_ban = sc.kw("banques" if LANG == "fr" else "banks")
    k_dev = sc.kw("restent" if LANG == "fr" else "stay")
    t_com = k_ban - 0.2
    t_copy = t_com + 1.0
    cam = cam_keys(t, [(0, 1.0, 960, 470), (sc.dur, 1.03, 960, 470)])
    draw_bg(fr, bg_paper(), cam)
    b1 = keyed(t, [(0.0, view_box(rep, 1.6, 1.25, 0.22, 0.3)), (t_com * 0.45, view_box(rep, 1.6, 1.25, 0.22, 0.3)),
                   (t_com, view_box(rep, 1.6, 1.3, 0.62, 0.48))])
    b2 = keyed(t, [(t_com, view_box(com, 1.6, 1.15, 0.45, 0.62)), (sc.dur, view_box(com, 1.6, 1.3, 0.42, 0.66))])
    draw_laptop(fr, cam, LX, LY, LW, [(rep, b1, 1), (com, b2, ramp(t, t_com - 0.08, t_com + 0.08))])
    if t > t_com:
        ripple(fr, cam, *screen_pt((LX, LY, LW, lh), com, b2, 0.314, 0.738), t, t_copy)
    note = T("sur votre appareil", "on your device")
    draw_text(fr, note, "hand-bold", 48, MARGIN, 1580, 560, cam, reveal=clamp((t - k_dev) / 0.6))
    draw_arrow(fr, cam, ((1590, 590), (1556, 560), (1548, 500)), (t - k_dev - 0.5) / 0.35, MARGIN, 3.8)
    label(fr, T("Bulletins", "Report cards"), "paper", t, 0.3, x=28, size=50)


def s10_families(fr, sc, t):
    LX, LY, LW = 330.0, 84.0, 1030.0
    nl = scr("newsletter")
    k_pr = sc.kw("prêt" if LANG == "fr" else "ready")
    cam = cam_keys(t, [(0, 1.0, 960, 470), (sc.dur, 1.04, 1000, 470)])
    draw_bg(fr, bg_paper(), cam)
    b = lerp_box(view_box(nl, 1.6, 1.05, 0.5, 0.3), view_box(nl, 1.6, 1.28, 0.5, 0.27), ramp(t, 0.3, sc.dur))
    draw_laptop(fr, cam, LX, LY, LW, [(nl, b, 1)])
    u = ramp(t, k_pr - 0.3, k_pr + 0.7)
    if u > 0:
        spr = paper_sprite("newsletter-pdf", 900, -3.0, margin=0.0, top=0.0, aspect=1056 / 816)
        draw_sprite(fr, spr, 1360, lerp(1140, 150, u), cam, w=520, alpha=clamp(u * 3))
    label(fr, T("Vendredi, 15 h", "Friday, 3 p.m."), "paper", t, 0.3, x=28, size=50)


def s11_direction(fr, sc, t):
    LX, LY, LW = 385.0, 70.0, 1150.0
    lh = LW / 1.6
    dirn, staff, board = scr("direction"), scr("staff"), scr("board")
    k_con = sc.kw("conseil" if LANG == "fr" else "board")
    k_cpt = sc.kw("comptes" if LANG == "fr" else "accounts")
    k_ann = sc.kw("années" if LANG == "fr" else "school years")
    k_don = sc.kw("données" if LANG == "fr" else "data")
    t_staff = k_con - 0.3
    t_board = k_don - 0.35
    cam = cam_keys(t, [(0, 1.0, 960, 470), (sc.dur, 1.03, 960, 470)])
    draw_bg(fr, bg_board(), cam)
    bd = lerp_box(view_box(dirn, 1.6), view_box(dirn, 1.6, 1.16, 0.4, 0.42), ramp(t, 0.2, t_staff))
    bs = view_box(staff, 1.6, 1.3, 0.48, 0.3)
    bb = view_box(board, 1.6, 1.3, 0.62, 0.62)
    draw_laptop(fr, cam, LX, LY, LW, fade_layers(t, [(0, dirn, bd), (t_staff, staff, bs), (t_board, board, bb)]))
    if t_staff < t < t_board + 0.2:
        a = 1 - ramp(t, t_board - 0.1, t_board + 0.2)
        r = (LX, LY, LW, lh)
        x0, y0 = screen_pt(r, staff, bs, 0.178, 0.25)
        x1, _ = screen_pt(r, staff, bs, 0.242, 0.25)
        draw_underline(fr, cam, x0, y0, x1, (t - k_cpt + 0.1) / 0.35, MARGIN, 4, a, seed=31)
        x0, y0 = screen_pt(r, staff, bs, 0.312, 0.25)
        x1, _ = screen_pt(r, staff, bs, 0.41, 0.25)
        draw_underline(fr, cam, x0, y0, x1, (t - k_ann + 0.1) / 0.35, MARGIN, 4, a, seed=32)
    if t > t_board:
        cx, cy = screen_pt((LX, LY, LW, lh), board, bb, 0.62, 0.663)
        draw_ellipse_mark(fr, cam, cx, cy, 250, 34, (t - t_board - 0.3) / 0.5, MARGIN, 4, seed=33)
    label(fr, T("7 h 45", "7:45 a.m."), "board", t, 0.3, t_staff - 0.3)
    label(fr, T("Conseil", "School board"), "board", t, t_staff)


def s12_canada(fr, sc, t):
    k_av = sc.kw("Avant" if LANG == "fr" else "Before")
    k_rep = sc.kw("remplacés" if LANG == "fr" else "replaced")
    t_ai = k_av - 0.35
    t_audit = max(k_rep + sc.vd * 0.0 + 0.9, t_ai + 2.6)
    cam = cam_keys(t, [(0, 1.0, 960, 470), (t_ai, 1.04, 960, 470), (sc.dur, 1.06, 960, 470)])
    draw_bg(fr, bg_board(), cam)
    # map of Canada and a padlock
    ma = 1 - ramp(t, t_ai - 0.4, t_ai + 0.05)
    if ma > 0:
        cs = canada_sprite()
        mw = 900
        mh = mw * cs.height / cs.width
        mx, my = 960 - mw / 2, 452 - mh / 2 - 30 * (1 - ma)
        draw_sprite(fr, cs, mx, my, cam, w=mw, alpha=ma, reveal=clamp((t - 0.1) / 1.1))
        pu = ramp(t, 0.9, 1.4)
        if pu > 0:
            pl = padlock_sprite(220)
            s = 130 * (0.75 + 0.25 * pu)
            draw_sprite(fr, pl, mx + 0.42 * mw, my + 0.6 * mh, cam, w=s, alpha=pu * ma, anchor="cm")
    u = ramp(t, t_ai - 0.1, t_ai + 0.45)
    if u > 0:
        LX, LY, LW = 385.0, 70.0 + 40 * (1 - u), 1150.0
        lh = LW / 1.6
        ai, audit = scr("ai-preview"), scr("audit")
        ba = lerp_box(view_box(ai, 1.6, 1.05, 0.38, 0.4), view_box(ai, 1.6, 1.5, 0.36, 0.66), ramp(t, t_ai + 0.3, t_audit - 0.3))
        bu = view_box(audit, 1.6, 1.25, 0.45, 0.72)
        draw_laptop(fr, cam, LX, LY, LW, [(ai, ba, 1), (audit, bu, ramp(t, t_audit - 0.08, t_audit + 0.08))], alpha=u)
        if t < t_audit + 0.2:
            cx, cy = screen_pt((LX, LY, LW, lh), ai, ba, 0.305, 0.714)
            draw_ellipse_mark(fr, cam, cx, cy, 62, 26, (t - k_rep + 0.2) / 0.5, MARGIN, 4.2, 1 - ramp(t, t_audit - 0.1, t_audit + 0.2), seed=41)
    label(fr, T("Vie privée", "Privacy"), "board", t, 0.3)


def s13_end(fr, sc, t):
    d = ImageDraw.Draw(fr)
    d.rectangle((0, 0, W // 2, H), fill=FLAG_G)
    d.rectangle((W // 2, 0, W, H), fill=WHITE)
    u = ramp(t, 0.15, 0.85)
    # the mark: a small chalkboard with a chalk « é », as in the site's header
    lw = 400.0
    lhh = lw * 24 / 32
    lx, ly = 480 - lw / 2, 500 - lhh / 2 + 18 * (1 - u)
    sh = soft_shadow(300, 225, 22, 16)
    kk = lw / 300
    draw_img(fr, sh, (lx - sh.info["pad"] * kk + 4, ly - sh.info["pad"] * kk + 16, sh.width * kk, sh.height * kk), None, 0.4 * u, BICUBIC)
    draw_sprite(fr, logo_sprite(), lx, ly, w=lw, alpha=u)
    draw_glyph_center(fr, "é", "hand", int(lhh * 0.95), CHALK, lx + lw / 2, ly + lhh * 0.5, alpha=u, chalk=True,
                      reveal=clamp((t - 0.55) / 0.6))
    # wordmark and line
    wu = ramp(t, sc.v0 - 0.25, sc.v0 + 0.35)
    draw_text(fr, "Lynx École", "display", 136, INK, 1060, 352 + 14 * (1 - wu), alpha=wu)
    tu = ramp(t, sc.v0 + sc.vd * 0.3, sc.v0 + sc.vd * 0.3 + 0.6)
    tag = sc.caption.split(". ", 1)[1] if ". " in sc.caption else sc.caption
    lines = wrap(tag, "body", 42, 760)
    for i, ln in enumerate(lines):
        draw_text(fr, ln, "body", 42, INK2, 1064, 560 + i * 60 + 10 * (1 - tu), alpha=tu)
    if wu > 0:
        pts = hand_line(1064, 522, 1064 + 560, 518, seed=51, amp=1.6)
        kk = max(2, int(len(pts) * clamp((t - sc.v0 - 0.2) / 0.6)))
        stroke(fr, pts[:kk], FLAG_G, 5, 0.9 * wu)
    foot = T("Écrans de la version pilote · données fictives", "Pilot-build screens · fictional data")
    draw_text(fr, foot, "body", 22, (110, 124, 114), 1064, 1000, alpha=tu)


SCENE_FUNCS = [s01_kitchen, s02_plan, s03_code, s04_substitute, s05_report, s06_bank, s07_class,
               s08_year, s09_reports, s10_families, s11_direction, s12_canada, s13_end]
SCENE_TITLES = {
    "fr": ["6 h 05, la cuisine", "Le plan se prépare", "Publié · le code", "La personne suppléante", "Le suivi",
           "Banque de ressources", "Mode classe", "Mon année · Couverture", "Bulletins", "Info-parents",
           "Direction · Conseil", "Canada · IA", "Carte de fin"],
    "en": ["6:05 a.m., the kitchen", "The plan builds itself", "Released · the code", "The substitute", "The report",
           "Resource bank", "Class mode", "My year · Coverage", "Report cards", "Info-parents",
           "Principal · Board", "Canada · AI", "End card"],
}


# ---------------------------------------------------------------------------
# Frames
# ---------------------------------------------------------------------------
_SCENES: list[Scene] = []


def draw_scene(sc: Scene, t: float) -> Image.Image:
    fr = Image.new("RGBA", (W, H), (0, 0, 0, 255))
    tl = clamp(t, -XF, sc.dur + XF)
    SCENE_FUNCS[sc.idx](fr, sc, tl)
    if sc.idx != len(SCENE_FUNCS) - 1:
        draw_caption(fr, sc, tl)
    return fr


def render_time(t: float) -> Image.Image:
    sc = _SCENES
    total = sc[-1].start + sc[-1].dur
    cur = max(i for i, s in enumerate(sc) if s.start <= t or i == 0)
    fr = draw_scene(sc[cur], t - sc[cur].start)
    # cross-fade with the neighbour inside XF/2 of a boundary
    if cur + 1 < len(sc) and t > sc[cur + 1].start - XF / 2:
        nxt = sc[cur + 1]
        u = ease((t - (nxt.start - XF / 2)) / XF)
        fr = Image.blend(fr, draw_scene(nxt, t - nxt.start), u)
    elif cur > 0 and t < sc[cur].start + XF / 2:
        prv = sc[cur - 1]
        u = ease((t - (sc[cur].start - XF / 2)) / XF)
        fr = Image.blend(draw_scene(prv, t - prv.start), fr, u)
    a = ramp(t, 0.0, 0.55) * (1 - ramp(t, total - 0.85, total - 0.05))
    if a < 1:
        fr = Image.blend(Image.new("RGBA", (W, H), (0, 0, 0, 255)), fr, a)
    return fr.convert("RGB")


def _render_raw(frame: int) -> bytes:
    return render_time(frame / FPS).tobytes()


def _init_worker(scenes):
    global _SCENES
    _SCENES = scenes


def warm():
    """Build the shared sprites once, before the worker processes fork."""
    for n in SCREEN_FILES:
        scr(n)
    bg_board(), bg_paper(), kitchen(), classroom(), glow_sprite(), phone_bezel(), laptop_body(), tablet_bezel()
    canada_sprite(), padlock_sprite(220), chalkboard_sprite(1200, 806), logo_sprite(), projector_falloff()
    paper_sprite("welcome-sheet", 1000, -4.0, margin=0.05, top=0.05, aspect=0.46)
    paper_sprite("library-sheet-top", 1000, 3.0, margin=0.05, top=0.05, aspect=0.66)
    paper_sprite("newsletter-pdf", 900, -3.0, margin=0.0, top=0.0, aspect=1056 / 816)


# ---------------------------------------------------------------------------
# Music: original and procedural (numpy only): felt-piano arpeggios, a warm pad, a soft bass and
# a light shaker, I-V-vi-IV in D at 76 BPM; it resolves on the end card.
# ---------------------------------------------------------------------------
M_BPM = 76
M_BEAT = 60 / M_BPM
M_BAR = 4 * M_BEAT
_piano_cache: dict = {}


def piano(freq: float, dur: float) -> np.ndarray:
    key = (round(freq, 2), round(dur, 2))
    if key in _piano_cache:
        return _piano_cache[key]
    n = int(dur * AU.SR)
    t = np.arange(n) / AU.SR
    sig = np.zeros(n)
    for k, amp in enumerate((1.0, 0.42, 0.22, 0.12, 0.06, 0.035), start=1):
        fk = freq * k * (1 + 0.0003 * k * k)
        if fk > 9000:
            break
        tau = 1.5 / (1 + 0.7 * (k - 1)) * (330 / freq) ** 0.35
        sig += amp * np.sin(2 * np.pi * fk * t) * np.exp(-t / tau)
    a = int(0.006 * AU.SR)
    sig[:a] *= np.linspace(0, 1, a)
    r = int(0.08 * AU.SR)
    sig[-r:] *= np.linspace(1, 0, r)
    sig /= max(1e-6, np.abs(sig).max())
    _piano_cache[key] = sig
    return sig


def pad_tone(freqs, dur, attack=1.2, release=1.4):
    n = int((dur + release) * AU.SR)
    t = np.arange(n) / AU.SR
    sig = np.zeros(n)
    for f in freqs:
        for det in (-0.0016, 0.0, 0.0017):
            sig += np.sin(2 * np.pi * f * (1 + det) * t + det * 900) * (1.0 if det == 0 else 0.6)
            sig += 0.18 * np.sin(2 * np.pi * 2 * f * (1 + det) * t)
    env = np.minimum(1, t / attack)
    env *= np.where(t > dur, np.exp(-(t - dur) / (release / 3)), 1.0)
    env *= 1 + 0.06 * np.sin(2 * np.pi * 0.23 * t)
    sig *= env
    return sig / max(1e-6, np.abs(sig).max())


def make_music_calm(total: float, scenes: list[Scene], seed: int = 3) -> np.ndarray:
    rng = np.random.default_rng(seed)
    SR = AU.SR
    n = int((total + 2) * SR)
    L, R = np.zeros(n), np.zeros(n)
    note = AU.note
    chords = [  # (bass, pad voicing, arpeggio notes)
        ("D2", ["D3", "F#3", "A3", "E4"], ["D4", "A4", "F#4", "A4", "E5", "A4", "F#4", "A4"]),
        ("A1", ["C#3", "E3", "A3", "E4"], ["C#4", "E4", "A4", "E4", "B4", "A4", "E4", "C#4"]),
        ("B1", ["D3", "F#3", "B3", "C#4"], ["B3", "F#4", "D4", "F#4", "C#5", "B4", "F#4", "D4"]),
        ("G1", ["D3", "G3", "B3", "F#4"], ["G3", "D4", "B3", "D4", "F#4", "D4", "B3", "D4"]),
    ]
    end_t = scenes[-1].start
    s2, s3, s12 = scenes[1].start, scenes[2].start, scenes[11].start
    nbars = int(end_t // M_BAR) + 1
    for bar in range(nbars):
        tb = bar * M_BAR
        if tb >= end_t - 0.3:
            break
        bass, padv, arp = chords[bar % 4]
        bar_len = min(M_BAR, end_t - tb)
        # pad, throughout (softer in the kitchen)
        pg = 0.075 if tb < s2 - 0.5 else 0.1
        p = pad_tone([note(x) for x in padv], bar_len, attack=0.9 if bar else 2.0)
        AU.add(L, p, tb, pg)
        AU.add(R, p, tb + 0.011, pg)
        # bass from the code scene on
        if tb >= s3 - M_BAR * 0.5:
            for off, g in ((0.0, 0.16), (2.0, 0.09)):
                if tb + off * M_BEAT < end_t - 0.2:
                    nn = int(1.5 * M_BEAT * SR)
                    tt = np.arange(nn) / SR
                    f = note(bass)
                    sig = (np.sin(2 * np.pi * f * tt) + 0.3 * np.sin(4 * np.pi * f * tt)) * AU.env_exp(nn, 0.55, 0.012)
                    AU.add(L, sig, tb + off * M_BEAT, g)
                    AU.add(R, sig, tb + off * M_BEAT, g)
        # piano: single notes in the kitchen, eighth-note arpeggios from the plan on
        if tb < s2 - 0.5:
            for i in (0, 2):
                tt = tb + i * M_BEAT * 2 + rng.normal(0, 0.006)
                f = note(arp[i * 2])
                s = piano(f, 2.6)
                AU.add(L, s, tt, 0.05)
                AU.add(R, s, tt, 0.06)
        else:
            vol = 0.06 if tb < s3 else 0.075
            if s12 - 0.5 <= tb:
                vol = 0.06
            for i, nm in enumerate(arp):
                tt = tb + i * M_BEAT / 2 + rng.normal(0, 0.005)
                if tt >= end_t - 0.15:
                    break
                acc = 1.0 if i % 4 == 0 else 0.72 if i % 2 == 0 else 0.6
                s = piano(note(nm), 1.8)
                pan = 0.12 * math.sin(i * 1.3)
                AU.add(L, s, tt, vol * acc * (1 - pan))
                AU.add(R, s, tt, vol * acc * (1 + pan))
        # shaker from the code scene to the privacy scene
        if s3 <= tb < s12 - 0.5:
            for e in range(8):
                tt = tb + e * M_BEAT / 2 + rng.normal(0, 0.003)
                nn = int(0.07 * SR)
                noise = np.diff(rng.normal(0, 1, nn), prepend=0)
                sig = noise * AU.env_exp(nn, 0.018, 0.003)
                g = (0.016 if e % 2 else 0.009) * rng.uniform(0.8, 1.1)
                AU.add(L, sig, tt, g * 0.8)
                AU.add(R, sig, tt, g)
    # the cadence on the end card: D add9, rolled, ringing out
    tail = total - end_t + 1.5
    p = pad_tone([note(x) for x in ("D3", "A3", "E4", "F#4")], tail - 1.6, attack=0.5, release=2.2)
    AU.add(L, p, end_t, 0.11)
    AU.add(R, p, end_t + 0.011, 0.11)
    AU.add(L, (np.sin(2 * np.pi * note("D2") * np.arange(int(4 * SR)) / SR)) * AU.env_exp(int(4 * SR), 1.4, 0.02), end_t, 0.16)
    AU.add(R, (np.sin(2 * np.pi * note("D2") * np.arange(int(4 * SR)) / SR)) * AU.env_exp(int(4 * SR), 1.4, 0.02), end_t, 0.16)
    for i, nm in enumerate(("D4", "A4", "D5", "F#5", "A5", "E5")):
        s = piano(note(nm), 4.5)
        AU.add(L, s, end_t + 0.15 + i * 0.11, 0.07)
        AU.add(R, s, end_t + 0.15 + i * 0.11, 0.08)
    music = np.stack([L, R], axis=1)[: int(total * SR)]
    a = np.exp(-2 * np.pi * 5200 / SR)
    for c in range(2):
        music[:, c] = AU._onepole(music[:, c], a)
    fi, fo = int(1.2 * SR), int(2.2 * SR)
    music[:fi] *= np.linspace(0, 1, fi)[:, None]
    music[-fo:] *= (np.linspace(1, 0, fo) ** 1.6)[:, None]
    return music / max(1e-6, np.abs(music).max()) * 0.9


def mix(meta, scenes, total, out_wav) -> dict:
    SR = AU.SR
    n = int(total * SR)
    voice = np.zeros(n)
    starts = [s.start + s.v0 for s in scenes]
    for m, t0 in zip(meta, starts):
        v, sr = AU.sf.read(m["wav"], dtype="float64")
        if v.ndim > 1:
            v = v.mean(axis=1)
        assert sr == SR, sr
        v = v / max(1e-6, np.abs(v).max()) * 0.8
        AU.add(voice, v, t0)
    spoken = np.zeros(n, bool)
    for m, t0 in zip(meta, starts):
        spoken[int(t0 * SR): int((t0 + m["duration"]) * SR)] = True
    rms = np.sqrt(np.mean(voice[spoken] ** 2))
    g = min(10 ** (-17 / 20) / rms, 10 ** (-1.5 / 20) / max(1e-6, np.abs(voice).max()))
    voice *= g
    music = make_music_calm(total, scenes)
    music *= 10 ** (-19.5 / 20) / np.sqrt(np.mean(music ** 2))
    env = AU.smooth_env(voice, attack=0.03, release=0.6)
    duck = 1 - 0.62 * np.clip(env / 0.05, 0, 1)
    music *= duck[:, None]
    out = music + voice[:, None]
    thr = 0.82
    over = np.abs(out) > thr
    out[over] = np.sign(out[over]) * (thr + (1 - thr) * np.tanh((np.abs(out[over]) - thr) / (1 - thr)))
    AU.sf.write(out_wav, out.astype(np.float32), SR, subtype="PCM_24")
    db = lambda x: round(20 * np.log10(x + 1e-9), 2)  # noqa: E731
    return dict(peak_dbfs=db(np.abs(out).max()), voice_rms_dbfs=db(np.sqrt(np.mean(voice[spoken] ** 2))),
                music_rms_gap_dbfs=db(np.sqrt(np.mean(music[~spoken] ** 2))),
                music_rms_under_voice_dbfs=db(np.sqrt(np.mean(music[spoken] ** 2))), limited_samples=int(over.sum()))


# ---------------------------------------------------------------------------
# Encode, storyboard, main
# ---------------------------------------------------------------------------
def encode_master(scenes, out_path, workers=4):
    ff = ffmpeg_bin()
    total = scenes[-1].start + scenes[-1].dur
    n = int(round(total * FPS))
    print(f"rendering {n} frames ({total:.2f}s) with {workers} workers")
    cmd = [ff, "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
           "-c:v", "libx264", "-preset", "veryfast", "-crf", "10", "-pix_fmt", "yuv420p", out_path]
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    warm()
    with mp.get_context("fork").Pool(workers, initializer=_init_worker, initargs=(scenes,)) as pool:
        for i, raw in enumerate(pool.imap(_render_raw, range(n), chunksize=6)):
            proc.stdin.write(raw)
            if i % 150 == 0:
                print(f"  frame {i}/{n}", flush=True)
    proc.stdin.close()
    proc.wait()
    assert proc.returncode == 0, "ffmpeg master encode failed"


def encode_final(master, wav, out_mp4, total, budget_mb=23.0):
    ff = ffmpeg_bin()
    common = ["-c:v", "libx264", "-preset", "slow", "-profile:v", "high", "-level", "4.1", "-pix_fmt", "yuv420p",
              "-r", str(FPS), "-g", str(FPS * 4)]
    audio = ["-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-ac", "2", "-movflags", "+faststart", "-shortest"]
    subprocess.run([ff, "-y", "-loglevel", "error", "-i", master, "-i", wav, "-map", "0:v", "-map", "1:a"] + common
                   + ["-crf", "19", "-tune", "stillimage"] + audio + [out_mp4], check=True)
    size = os.path.getsize(out_mp4) / 2 ** 20
    print(f"crf 19: {size:.1f} MB")
    if size > budget_mb:  # two-pass to the budget
        kbps = int((budget_mb * 8 * 1024 * 1024 / total - 160_000 - 20_000) / 1000)
        print(f"two-pass at {kbps} kb/s")
        log = os.path.join(BUILD, f"x264-{LANG}")
        subprocess.run([ff, "-y", "-loglevel", "error", "-i", master] + common + ["-b:v", f"{kbps}k", "-pass", "1", "-passlogfile", log, "-an", "-f", "mp4", os.devnull], check=True)
        subprocess.run([ff, "-y", "-loglevel", "error", "-i", master, "-i", wav, "-map", "0:v", "-map", "1:a"] + common
                       + ["-b:v", f"{kbps}k", "-pass", "2", "-passlogfile", log] + audio + [out_mp4], check=True)
        print(f"two-pass: {os.path.getsize(out_mp4) / 2 ** 20:.1f} MB")


STORY_PICKS = [(0, 0.4, ""), (1, 0.86, ""), (2, 0.2, ""), (2, 0.9, " (b)"), (3, 0.82, ""), (4, 0.86, ""), (5, 0.84, ""),
               (6, 0.45, ""), (6, 0.93, " (b)"), (7, 0.8, ""), (8, 0.78, ""), (9, 0.72, ""), (10, 0.6, ""),
               (11, 0.2, ""), (11, 0.66, " (b)"), (12, 0.78, "")]


def storyboard(scenes):
    picks = [(scenes[i], f * scenes[i].dur, suf) for i, f, suf in STORY_PICKS]
    tw, th, pad, lab = 640, 360, 22, 42
    cols, rows = 4, 4
    sheet = Image.new("RGB", (cols * tw + (cols + 1) * pad, rows * (th + lab) + (rows + 1) * pad), (244, 247, 241))
    d = ImageDraw.Draw(sheet)
    for i, (s, tl, suf) in enumerate(picks[:16]):
        r, c = divmod(i, cols)
        x, y = pad + c * (tw + pad), pad + r * (th + lab + pad)
        im = render_time(s.start + tl).resize((tw, th), LANCZOS)
        sheet.paste(im, (x, y))
        d.rectangle((x - 1, y - 1, x + tw, y + th), outline=(120, 110, 90))
        d.text((x, y + th + 8), f"{s.idx + 1}{suf}. {SCENE_TITLES[LANG][s.idx]}  ({s.start + tl:.1f} s)", font=font("body-medium", 21), fill=INK)
    sheet.save(OUT_STORY)
    print("storyboard ->", OUT_STORY)


def write_timings(scenes, meta):
    lines = [f"Lynx École, 90-second commercial ({LANG}): voice {VOICE[LANG]['voice']}, {VOICE[LANG]['lang']}", ""]
    for s, m in zip(scenes, meta):
        a = s.start + s.v0
        lines.append(f"{s.idx + 1:2d}. {SCENE_TITLES[LANG][s.idx]:26s} scene {s.start:6.2f}-{s.start + s.dur:6.2f}  voice {a:6.2f}-{a + s.vd:6.2f}  ({m['speed']})")
        lines.append(f"    {m['caption']}")
    total = scenes[-1].start + scenes[-1].dur
    lines.append(f"\nTotal {total:.2f} s")
    p = os.path.join(BUILD, f"timings-{LANG}.txt")
    with open(p, "w") as f:
        f.write("\n".join(lines) + "\n")
    print("\n".join(lines))


def main():
    global _SCENES
    os.makedirs(BUILD, exist_ok=True)
    ffmpeg_bin()
    mode = ARGS[0] if ARGS else "build"
    vj = os.path.join(BUILD, f"voice-{LANG}.json")
    if mode == "voice" or not os.path.exists(vj):
        make_voice(LANG)
        if mode == "voice":
            return
    meta = json.load(open(vj))
    scenes = build_timeline(meta)
    _SCENES = scenes
    total = scenes[-1].start + scenes[-1].dur
    write_timings(scenes, meta)
    if mode == "preview":
        for s in scenes:
            for frac in (0.3, 0.8):
                p = os.path.join(BUILD, f"preview-{LANG}-{s.idx + 1:02d}-{int(frac * 100)}.png")
                render_time(s.start + s.dur * frac).save(p)
                print("->", p)
        return
    if mode == "frames":
        for ts in ARGS[1:]:
            p = os.path.join(BUILD, f"frame-{LANG}-{float(ts):06.2f}.png")
            render_time(float(ts)).save(p)
            print("->", p)
        return
    if mode == "storyboard":
        storyboard(scenes)
        return
    master = os.path.join(BUILD, f"master-{LANG}.mp4")
    if mode != "remix" or not os.path.exists(master):
        encode_master(scenes, master)
    wav = os.path.join(BUILD, f"mix-{LANG}.wav")
    print("audio:", mix(meta, scenes, total, wav))
    encode_final(master, wav, OUT_MP4, total)
    print("video ->", OUT_MP4, f"{os.path.getsize(OUT_MP4) / 2 ** 20:.1f} MB")
    if mode != "remix":
        storyboard(scenes)


if __name__ == "__main__":
    main()
