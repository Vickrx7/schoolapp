#!/usr/bin/env python
"""Build the commercial.

    ../promo/venv/bin/python make_commercial.py                 # English -> out/lynx-ecole-commercial-en.mp4
    ../promo/venv/bin/python make_commercial.py --lang fr       # French  -> out/lynx-ecole-commercial-fr.mp4
    ../promo/venv/bin/python make_commercial.py preview [ids]   # 2 frames per scene in build/preview/, no video
    ../promo/venv/bin/python make_commercial.py frames 12.5 40  # frames at these times (s)
    ../promo/venv/bin/python make_commercial.py remix           # re-mix the audio onto the rendered video

Steps: voice (cached per line) -> timeline (scene length follows its voice line) -> a probe pass
that collects the paper sound effects -> frames (4 processes, PNG pipe into ffmpeg, 1920x1080,
12 fps, H.264) -> music + effects + voice mix -> mux (AAC, +faststart) -> storyboard and script.
"""
from __future__ import annotations

import io
import multiprocessing as mp
import os
import subprocess
import sys
from dataclasses import dataclass

from PIL import Image, ImageDraw

import art as A
import audio as AU
import scenes as SC

HERE = os.path.dirname(os.path.abspath(__file__))
BUILD = os.path.join(HERE, "build")
OUT = os.path.join(HERE, "out")


def parse_args(argv):
    lang, rest, it = "en", [], iter(argv)
    for a in it:
        if a == "--lang":
            lang = next(it)
        elif a.startswith("--lang="):
            lang = a.split("=", 1)[1]
        else:
            rest.append(a)
    return lang, rest


LANG, ARGS = parse_args(sys.argv[1:])
A.set_lang(LANG)
FPS = A.FPS
LEAD = 0.4
TAIL = 0.55
FIRST_LEAD = 0.6


@dataclass
class Scene:
    idx: int
    id: str
    ch: int
    first: bool
    start: float
    dur: float
    voice: float
    vdur: float
    cap: str
    wav: str


def build_timeline(meta):
    out, t, prev_ch = [], 0.0, None
    for i, m in enumerate(meta):
        first = bool(m["ch"]) and m["ch"] != prev_ch
        prev_ch = m["ch"]
        lead = (SC.CH_CARD + 0.55) if first else (FIRST_LEAD if i == 0 else LEAD)
        lead += SC.EXTRA_LEAD.get(m["id"], 0.0)
        dur = lead + m["duration"] + TAIL + SC.EXTRA_TAIL.get(m["id"], 0.0)
        dur = round(dur * FPS) / FPS
        out.append(Scene(i, m["id"], m["ch"], first, t, dur, lead, m["duration"], m["cap"], m["wav"]))
        t += dur
    return out


# ---------------------------------------------------------------------------
# frame contexts
# ---------------------------------------------------------------------------
def _clamp(img, cx):
    """Keeps labels and props inside the frame (French labels run longer)."""
    if img is not None and img.width < A.W - 40:
        return min(max(cx, 8 + img.width / 2), A.W - 8 - img.width / 2)
    return cx


class FrameCtx(A.Ctx):
    def put(self, img, cx, cy, *a, **k):
        return super().put(img, _clamp(img, cx), cy, *a, **k)

    def sfx(self, kind, t):
        pass


class ProbeCtx(A.Ctx):
    """Runs a scene without drawing: records when each element first enters, and sound cues."""

    def __init__(self, t, frame, rec, cues):
        super().__init__(None, t, frame)
        self.rec, self.cues = rec, cues

    def put(self, img, cx, cy, t0=0.0, enter="pop", key="", t1=None, exit="up", **kw):
        if self.t < t0:
            return None
        if key not in self.rec:
            self.rec[key] = (t0, enter, t1, exit)
        return (_clamp(img, cx), cy)

    def connector(self, *a, **k):
        pass

    def caption(self, *a, **k):
        pass

    def sfx(self, kind, t):
        self.cues.add((round(t, 3), kind))


# draw helpers that paint on the canvas directly must tolerate the probe (cv is None)
_hl = A.highlight


def _highlight(c, rect, t0, key, **kw):
    if c.cv is None:
        return
    _hl(c, rect, t0, key, **kw)


A.highlight = _highlight

ENTER_SFX = {"pop": "pop", "slide": "slide", "drop": "drop", "stamp": "stamp"}
QUIET_KEYS = {"caption", "brand", "foot", "note"}


def probe_sfx(scenes):
    events = []
    for s in scenes:
        rec, cues = {}, set()
        n = int(round(s.dur * FPS))
        for f in range(n):
            t = f / FPS
            if s.id == "sick" and t == 0:
                pass
            c = ProbeCtx(t, int(round((s.start + t) * FPS)), rec, cues)
            c.cv = None
            SC.SCENES[s.id](c, s)
        for key, (t0, enter, t1, ex) in rec.items():
            if key in QUIET_KEYS or key.startswith("conf"):
                continue
            kind = ENTER_SFX.get(enter)
            if kind and t0 >= 0:
                events.append((s.start + t0, kind))
            if t1 is not None and ex not in ("settle",) and t1 >= 0 and not key.startswith("st"):
                events.append((s.start + t1, "slide"))
        for t, kind in cues:
            if 0 <= t < s.dur:
                events.append((s.start + t, kind))
        if any(k.startswith("conf") for k in rec):
            t0 = min(v[0] for k, v in rec.items() if k.startswith("conf"))
            events += [(s.start + t0 + 0.05 * i, "pop") for i in range(6)]
    return events


# ---------------------------------------------------------------------------
# music plan: energy per scene, a second chord progression for some chapters, a lift at the end
# ---------------------------------------------------------------------------
ENERGY = {"papers": 1, "title": 3, "sick": 0, "plan": 1, "released": 1, "alerts": 1, "privacy": 1, "yours": 1,
          "taught": 3, "projector": 3, "tablets": 3, "start": 3, "bilingual": 3, "feedback": 3, "end": 3, "differentiate": 2}
PROG_B_CH = {3, 6, 8}
LIFT = {"feedback", "end"}


def bar_plan(scenes, total):
    plan = []
    nbars = int(total / AU.BAR) + 2
    for b in range(nbars):
        t = b * AU.BAR + 0.01
        s = next((x for x in scenes if x.start <= t < x.start + x.dur), scenes[-1])
        plan.append(dict(energy=ENERGY.get(s.id, 2), prog="B" if s.ch in PROG_B_CH else "A", semis=2 if s.id in LIFT else 0))
    return plan


# ---------------------------------------------------------------------------
# rendering
# ---------------------------------------------------------------------------
_SCENES: list[Scene] = []


def render_frame(frame: int) -> Image.Image:
    t = frame / FPS
    sc = _SCENES[-1]
    for s in _SCENES:
        if s.start <= t < s.start + s.dur:
            sc = s
            break
    cv = A.background().copy()
    c = FrameCtx(cv, t - sc.start, frame)
    SC.SCENES[sc.id](c, sc)
    return cv.convert("RGB")


def _render_png(frame: int) -> bytes:
    buf = io.BytesIO()
    render_frame(frame).save(buf, "PNG", compress_level=1)
    return buf.getvalue()


def _init_worker(scenes):
    global _SCENES
    _SCENES = scenes


def encode_video(scenes, out_path, workers=4, crf=20):
    total = scenes[-1].start + scenes[-1].dur
    n = int(round(total * FPS))
    print(f"rendering {n} frames ({total:.1f}s) with {workers} workers", flush=True)
    cmd = ["ffmpeg", "-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", str(FPS), "-i", "-",
           "-c:v", "libx264", "-preset", "slow", "-crf", str(crf), "-tune", "animation", "-profile:v", "high", "-level", "4.0",
           "-pix_fmt", "yuv420p", "-r", str(FPS), "-an", out_path]
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    with mp.get_context("fork").Pool(workers, initializer=_init_worker, initargs=(scenes,)) as pool:
        for i, png in enumerate(pool.imap(_render_png, range(n), chunksize=4)):
            proc.stdin.write(png)
            if i % 120 == 0:
                print(f"  frame {i}/{n}", flush=True)
    proc.stdin.close()
    proc.wait()
    assert proc.returncode == 0, "ffmpeg failed"


def storyboard(scenes, path):
    tw, th = 384, 216
    cols = 6
    rows = (len(scenes) + cols - 1) // cols
    pad, lh = 14, 30
    sheet = Image.new("RGB", (cols * (tw + pad) + pad, rows * (th + lh + pad) + pad), (245, 240, 230))
    d = ImageDraw.Draw(sheet)
    for i, s in enumerate(scenes):
        f = int(round((s.start + min(s.dur * 0.8, s.dur - 0.2)) * FPS))
        im = render_frame(f).resize((tw, th), Image.LANCZOS)
        r, c = divmod(i, cols)
        x, y = pad + c * (tw + pad), pad + r * (th + lh + pad)
        sheet.paste(im, (x, y))
        d.text((x, y + th + 4), f"{i + 1}. {s.id}  {s.start:.0f}s", font=A.font("bold", 18), fill=(40, 35, 30))
    sheet.save(path)
    print("storyboard ->", path)


def write_script(scenes, meta, path):
    lines = [f"{A.APP} commercial, {LANG} voice-over ({AU.VOICE_CFG[LANG]})", ""]
    for s, m in zip(scenes, meta):
        v0 = s.start + s.voice
        lines.append(f"[{v0:6.2f}s – {v0 + s.vdur:6.2f}s] {s.idx + 1}. {s.id} (chapter {s.ch}), scene {s.start:.2f}–{s.start + s.dur:.2f}s")
        lines.append(f"    VO:      {m['say']}")
        lines.append(f"    caption: {m['cap'].replace(chr(10), ' / ').replace('|', ' || ')}")
        lines.append("")
    total = scenes[-1].start + scenes[-1].dur
    lines.append(f"Total {total:.2f}s, {len(scenes)} scenes, {int(round(total * FPS))} frames at {FPS} fps")
    open(path, "w").write("\n".join(lines) + "\n")


def main():
    global _SCENES
    os.makedirs(BUILD, exist_ok=True)
    os.makedirs(OUT, exist_ok=True)
    meta = AU.make_voice(LANG)
    scenes = build_timeline(meta)
    _SCENES = scenes
    total = scenes[-1].start + scenes[-1].dur
    for s in scenes:
        print(f"{s.idx + 1:2d} {s.id:13s} {s.start:7.2f}s +{s.dur:5.2f}  voice@{s.voice:.2f} ({s.vdur:.2f}s)")
    print(f"total {total:.1f}s ({total / 60:.1f} min)")
    mode = ARGS[0] if ARGS else "build"
    if mode == "preview":
        pdir = os.path.join(BUILD, f"preview-{LANG}")
        os.makedirs(pdir, exist_ok=True)
        want = set(ARGS[1:])
        for s in scenes:
            if want and s.id not in want:
                continue
            for frac in (0.45, 0.92):
                f = int(round((s.start + s.dur * frac) * FPS))
                p = os.path.join(pdir, f"{s.idx + 1:02d}_{s.id}_{int(frac * 100)}.png")
                render_frame(f).save(p)
            print("->", s.id, flush=True)
        return
    if mode == "frames":
        for ts in ARGS[1:]:
            f = int(round(float(ts) * FPS))
            p = os.path.join(BUILD, f"frame-{LANG}-{float(ts):06.2f}.png")
            render_frame(f).save(p)
            print("->", p)
        return
    if mode == "storyboard":
        storyboard(scenes, os.path.join(OUT, f"storyboard-{LANG}.png"))
        return

    write_script(scenes, meta, os.path.join(OUT, f"voiceover-{LANG}.txt"))
    print("probing sound effects…", flush=True)
    events = probe_sfx(scenes)
    silent = os.path.join(BUILD, f"video-silent-{LANG}.mp4")
    if mode == "remix" and os.path.exists(silent):
        print("remix: reusing", silent)
    else:
        encode_video(scenes, silent)
    mixwav = os.path.join(BUILD, f"mix-{LANG}.wav")
    stats = AU.mix(meta, [s.start + s.voice for s in scenes], total, bar_plan(scenes, total), events, mixwav)
    print("audio:", stats)
    out = os.path.join(OUT, f"lynx-ecole-commercial-{LANG}.mp4")
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", silent, "-i", mixwav, "-map", "0:v", "-map", "1:a",
                    "-c:v", "copy", "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-movflags", "+faststart", "-shortest", out], check=True)
    print("video ->", out, os.path.getsize(out) // 1024, "KB")
    if mode != "remix":
        storyboard(scenes, os.path.join(OUT, f"storyboard-{LANG}.png"))


if __name__ == "__main__":
    main()
