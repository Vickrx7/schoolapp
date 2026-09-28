#!/usr/bin/env python
"""Build the Lynx École stop-motion promo.

    ./venv/bin/python make_promo.py            # full build -> lynx-ecole-promo-en.mp4, storyboard.png, voiceover-script.txt
    ./venv/bin/python make_promo.py --lang fr  # French cut -> lynx-ecole-promo-fr.mp4, storyboard-fr.png, voiceover-script-fr.txt
    ./venv/bin/python make_promo.py preview    # render one frame per scene (build/preview_*.png), no video
    ./venv/bin/python make_promo.py frames 12.0 12.5 ...   # render specific times (build/frame_<t>.png)
    ./venv/bin/python make_promo.py remix      # re-mix audio + mux onto the already rendered video

Steps: voice (Kokoro, cached in build/voice.json) -> timeline -> frames (multiprocessing, PNG pipe into
ffmpeg, 1920x1080 @ 12 fps H.264) -> procedural music + ducked mix -> mux (AAC, +faststart) -> storyboard.
"""
from __future__ import annotations

import io
import json
import multiprocessing as mp
import os
import subprocess
import sys
from dataclasses import dataclass

from PIL import Image, ImageDraw

import promo_art as A
import promo_audio as AU

HERE = os.path.dirname(os.path.abspath(__file__))
BUILD = os.path.join(HERE, "build")


def parse_args(argv: list[str]) -> tuple[str, list[str]]:
    """Pull `--lang xx` / `--lang=xx` out of argv; everything else is the mode + its args."""
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
SUFFIX = "" if LANG == "en" else f"-{LANG}"          # English outputs keep their original names
OUT_MP4 = os.path.join(HERE, f"lynx-ecole-promo-{LANG}.mp4")
OUT_STORY = os.path.join(HERE, f"storyboard{SUFFIX}.png")
OUT_SCRIPT = os.path.join(HERE, f"voiceover-script{SUFFIX}.txt")

LEAD = 0.45      # seconds of picture before the voice line starts
TAIL = 0.75      # seconds of picture after the voice line ends
FIRST_LEAD = 0.7
END_HOLD = 2.2   # extra hold on the end card


@dataclass
class Scene:
    idx: int
    start: float      # global start (s)
    dur: float
    voice: float      # caption/voice start, local (s)
    caption: str
    wav: str
    voice_dur: float


def build_timeline(voice_meta: list[dict]) -> list[Scene]:
    scenes = []
    t = 0.0
    for i, m in enumerate(voice_meta):
        lead = FIRST_LEAD if i == 0 else LEAD
        dur = lead + m["duration"] + TAIL + (END_HOLD if i == len(voice_meta) - 1 else 0)
        # quantize scene lengths to whole frames
        dur = round(dur * A.FPS) / A.FPS
        scenes.append(Scene(i, t, dur, lead, m["caption"], m["wav"], m["duration"]))
        t += dur
    return scenes


_SCENES: list[Scene] = []


def render_frame(frame: int) -> Image.Image:
    t = frame / A.FPS
    sc = _SCENES[-1]
    for s in _SCENES:
        if s.start <= t < s.start + s.dur:
            sc = s
            break
    cv = A.background().copy()
    ctx = A.Ctx(cv, t - sc.start, frame)
    A.SCENES[sc.idx](ctx, sc)
    return cv.convert("RGB")


def _render_png(frame: int) -> bytes:
    im = render_frame(frame)
    buf = io.BytesIO()
    im.save(buf, "PNG", compress_level=1)
    return buf.getvalue()


def _init_worker(scenes):
    global _SCENES
    _SCENES = scenes
    A.background()  # warm the cache in each worker


def write_script(scenes: list[Scene], meta: list[dict]):
    cfg = AU.VOICE_CFG[LANG]
    name = {"en": "English", "fr": "French"}.get(LANG, LANG)
    lines = [f"Lynx École promo — {name} voiceover (Kokoro {cfg['voice']}, {cfg['lang']}, speed {cfg['speed']})", ""]
    titles = A.scene_titles()
    for s, m in zip(scenes, meta):
        v0 = s.start + s.voice
        lines.append(f"[{v0:5.2f}s – {v0 + s.voice_dur:5.2f}s]  scene {s.idx + 1} ({titles[s.idx]}), scene {s.start:5.2f}–{s.start + s.dur:5.2f}s")
        lines.append(f"    VO:      {m['say']}")
        lines.append(f"    caption: {m['caption'].replace(chr(10), ' / ')}")
        lines.append("")
    total = scenes[-1].start + scenes[-1].dur
    lines.append(f"Total: {total:.2f}s, {len(scenes)} scenes, {int(round(total * A.FPS))} frames at {A.FPS} fps")
    with open(OUT_SCRIPT, "w") as f:
        f.write("\n".join(lines) + "\n")


def storyboard(scenes: list[Scene]):
    thumbs = []
    for s in scenes:
        f = int(round((s.start + min(s.dur * 0.72, s.dur - 0.3)) * A.FPS))
        thumbs.append((s, render_frame(f).resize((640, 360), Image.LANCZOS)))
    cols, rows = 3, 3
    pad, label_h = 24, 44
    sheet = Image.new("RGB", (cols * 640 + (cols + 1) * pad, rows * (360 + label_h) + (rows + 1) * pad), (245, 240, 230))
    d = ImageDraw.Draw(sheet)
    titles = A.scene_titles()
    for i, (s, th) in enumerate(thumbs):
        r, c = divmod(i, cols)
        x = pad + c * (640 + pad)
        y = pad + r * (360 + label_h + pad)
        sheet.paste(th, (x, y))
        d.rectangle((x - 1, y - 1, x + 640, y + 360), outline=(120, 100, 80))
        d.text((x, y + 366), f"{i + 1}. {titles[i]}   ({s.start:.1f}s – {s.start + s.dur:.1f}s)", font=A.font("bold", 22), fill=(40, 35, 30))
    sheet.save(OUT_STORY)
    print("storyboard ->", OUT_STORY)


def encode_video(scenes: list[Scene], out_path: str, workers: int = 4):
    total = scenes[-1].start + scenes[-1].dur
    n = int(round(total * A.FPS))
    print(f"rendering {n} frames ({total:.2f}s) with {workers} workers")
    cmd = ["ffmpeg", "-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", str(A.FPS), "-i", "-",
           "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-profile:v", "high", "-level", "4.0",
           "-pix_fmt", "yuv420p", "-r", str(A.FPS), "-an", out_path]
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    with mp.get_context("fork").Pool(workers, initializer=_init_worker, initargs=(scenes,)) as pool:
        for i, png in enumerate(pool.imap(_render_png, range(n), chunksize=4)):
            proc.stdin.write(png)
            if i % 60 == 0:
                print(f"  frame {i}/{n}", flush=True)
    proc.stdin.close()
    proc.wait()
    assert proc.returncode == 0, "ffmpeg video encode failed"


def main():
    global _SCENES
    os.makedirs(BUILD, exist_ok=True)
    vj = os.path.join(BUILD, AU.VOICE_CFG[LANG]["json"])
    if not os.path.exists(vj):
        AU.make_voice(LANG)
    meta = json.load(open(vj))
    scenes = build_timeline(meta)
    _SCENES = scenes
    total = scenes[-1].start + scenes[-1].dur
    titles = A.scene_titles()
    print(f"language: {LANG}")
    for s in scenes:
        print(f"scene {s.idx + 1}: {s.start:6.2f}s +{s.dur:5.2f}s  voice@{s.voice:.2f}  {titles[s.idx]}")
    print(f"total {total:.2f}s")

    mode = ARGS[0] if ARGS else "build"
    if mode == "preview":
        for s in scenes:
            for frac in (0.35, 0.8):
                f = int(round((s.start + s.dur * frac) * A.FPS))
                p = os.path.join(BUILD, f"preview{SUFFIX}_{s.idx + 1}_{int(frac * 100)}.png")
                render_frame(f).save(p)
                print("->", p)
        return
    if mode == "frames":
        for ts in ARGS[1:]:
            f = int(round(float(ts) * A.FPS))
            p = os.path.join(BUILD, f"frame{SUFFIX}_{float(ts):05.2f}.png")
            render_frame(f).save(p)
            print("->", p)
        return

    write_script(scenes, meta)
    silent = os.path.join(BUILD, f"video_silent{SUFFIX}.mp4")
    if mode == "remix" and os.path.exists(silent):
        print("remix: reusing", silent)
    else:
        encode_video(scenes, silent)
    mixwav = os.path.join(BUILD, f"mix{SUFFIX}.wav")
    stats = AU.mix(meta, [s.start + s.voice for s in scenes], total, mixwav)
    print("audio:", stats)
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", silent, "-i", mixwav, "-map", "0:v", "-map", "1:a",
                    "-c:v", "copy", "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-movflags", "+faststart", "-shortest", OUT_MP4], check=True)
    print("video ->", OUT_MP4, os.path.getsize(OUT_MP4) // 1024, "KB")
    if mode != "remix":
        storyboard(scenes)


if __name__ == "__main__":
    main()
