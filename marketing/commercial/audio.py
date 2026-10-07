"""Audio for the commercial: Kokoro voice-over (cached per line), an original procedural score that
follows the chapters, paper sound effects, and the final mix.

The plucked strings, notes and helpers come from ../promo/promo_audio.py. Nothing is sampled or
downloaded except the Kokoro model files (see README.md).
"""
from __future__ import annotations

import hashlib
import json
import os
import subprocess

import numpy as np
import soundfile as sf

import art  # noqa: F401  (puts ../promo on sys.path)
import promo_audio as PA
import script

HERE = os.path.dirname(os.path.abspath(__file__))
BUILD = os.path.join(HERE, "build")
MODELS = os.path.join(HERE, "..", "promo", "models")
MODEL = os.environ.get("KOKORO_MODEL", os.path.join(MODELS, "kokoro-v1.0.onnx"))
VOICES = os.environ.get("KOKORO_VOICES", os.path.join(MODELS, "voices-v1.0.bin"))
SR = PA.SR

# phonemizer output -> what we want (Kokoro IPA vocabulary)
FIXES_EN = [
    ("ɪkˈoʊl", "ekˈɔl"),            # École
    ("lˈɪŋks", "lˈɪŋks"),
    ("ɪnfoʊpˈɛɹənts", "ɪnfoʊ pˈɛɹənts"),
]
FIXES_FR = [
    ("oʒuʁdyˈi", "oʒuʁdɥˈi"),       # Aujourd'hui
    ("papʁˈas", "papəʁˈas"),        # paperasse
    ("bjɛ̃tˈoː", "bjɛ̃tˈo"),
]
VOICE_CFG = {
    "en": dict(voice="af_heart", lang="en-us", speed=0.97, fixes=FIXES_EN),
    "fr": dict(voice="ff_siwis", lang="fr-fr", speed=1.02, fixes=FIXES_FR),
}


def voice_dir(lang):
    return os.path.join(BUILD, f"voice-{lang}")


def make_voice(lang: str, force: bool = False) -> list[dict]:
    """One wav per scene (48 kHz mono). A line is regenerated only when its text changes."""
    cfg = VOICE_CFG[lang]
    out = voice_dir(lang)
    os.makedirs(out, exist_ok=True)
    kok = None
    meta = []
    for line in script.lines(lang):
        h = hashlib.sha1(f"{cfg}|{line['say']}".encode()).hexdigest()[:12]
        wav = os.path.join(out, f"{line['id']}-{h}.wav")
        info = wav + ".json"
        if force or not os.path.exists(info):
            if kok is None:
                from kokoro_onnx import Kokoro
                kok = Kokoro(MODEL, VOICES)
            ph = kok.tokenizer.phonemize(line["say"], lang=cfg["lang"])
            for a, b in cfg["fixes"]:
                ph = ph.replace(a, b)
            samples, sr = kok.create(ph, voice=cfg["voice"], speed=cfg["speed"], lang=cfg["lang"], is_phonemes=True)
            samples = np.asarray(samples, dtype=np.float32)
            # trim leading/trailing near-silence so timing is tight
            nz = np.where(np.abs(samples) > 0.01)[0]
            if len(nz):
                samples = samples[max(0, nz[0] - int(0.03 * sr)): nz[-1] + int(0.08 * sr)]
            raw = wav.replace(".wav", "_24k.wav")
            sf.write(raw, samples, sr)
            subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", raw, "-ar", str(SR), "-ac", "1", wav], check=True)
            os.remove(raw)
            json.dump(dict(phonemes=ph, duration=round(len(samples) / sr, 3)), open(info, "w"), ensure_ascii=False)
            print(f"  voice {lang} {line['id']}: {len(samples) / sr:5.2f}s  {ph}")
        d = json.load(open(info))
        meta.append(dict(id=line["id"], ch=line["ch"], say=line["say"], cap=line["cap"], wav=wav,
                         duration=d["duration"], phonemes=d["phonemes"]))
    return meta


# ---------------------------------------------------------------------------
# music: the promo's ukulele band, arranged by energy per bar and with a lift at the end
# ---------------------------------------------------------------------------
BPM = PA.BPM
BEAT = PA.BEAT
BAR = PA.BAR
note = PA.note
pluck = PA.pluck
env_exp = PA.env_exp
add = PA.add

PROG_A = (["G4", "C4", "E4", "C5"], ["G4", "D4", "G4", "B4"], ["A4", "C4", "E4", "A4"], ["A4", "C4", "F4", "A4"])  # I V vi IV
ROOTS_A = ("C2", "G2", "A2", "F2")
PROG_B = (["A4", "C4", "E4", "A4"], ["A4", "C4", "F4", "A4"], ["G4", "C4", "E4", "C5"], ["G4", "D4", "G4", "B4"])  # vi IV I V
ROOTS_B = ("A2", "F2", "C2", "G2")


def pad_chord(names, dur, semis=0):
    n = int(dur * SR)
    t = np.arange(n) / SR
    sig = np.zeros(n)
    for nm in names:
        f = note(nm) * 2 ** (semis / 12) / 2
        sig += np.sin(2 * np.pi * f * t) + 0.25 * np.sin(2 * np.pi * 2 * f * t + 0.3)
    a, r = int(0.6 * SR), int(0.9 * SR)
    e = np.ones(n)
    e[:a] = np.linspace(0, 1, a)
    e[-r:] *= np.linspace(1, 0, r)
    return sig * e / len(names)


def make_music(duration: float, bar_plan: list[dict], seed: int = 11) -> np.ndarray:
    """bar_plan[i] = {energy 0..3, prog 'A'|'B', semis}. Returns stereo float32, peak 0.9."""
    rng = np.random.default_rng(seed)
    n = int(duration * SR) + 2 * SR
    L = np.zeros(n)
    R = np.zeros(n)
    strum_full = [(0.0, 1, 1.0), (1.0, 1, 0.8), (1.5, -1, 0.6), (2.5, -1, 0.7), (3.0, 1, 0.9), (3.5, -1, 0.6)]
    strum_soft = [(0.0, 1, 0.8), (2.0, 1, 0.6)]
    nbars = int(np.ceil(duration / BAR)) + 1
    for bar in range(nbars):
        bp = bar_plan[min(bar, len(bar_plan) - 1)]
        en, semis = bp["energy"], bp["semis"]
        k = 2 ** (semis / 12)
        prog, roots = (PROG_A, ROOTS_A) if bp["prog"] == "A" else (PROG_B, ROOTS_B)
        ch = prog[bar % 4]
        t_bar = bar * BAR
        # pad (always, louder when quiet)
        pg = 0.10 if en <= 1 else 0.05
        p = pad_chord(ch, BAR + 0.9, semis)
        add(L, p, t_bar, pg)
        add(R, p, t_bar, pg)
        if en >= 1:
            for off, direction, acc in (strum_full if en >= 2 else strum_soft):
                t = t_bar + off * BEAT + rng.normal(0, 0.004)
                order = ch if direction > 0 else ch[::-1]
                for si, nm in enumerate(order):
                    f = note(nm) * k * (1 + rng.normal(0, 0.0015))
                    s = pluck(round(f, 1), 1.6, rng, bright=0.45 if direction > 0 else 0.6)
                    g = 0.15 * acc * rng.uniform(0.85, 1.0) * (0.8 if en == 1 else 1.0)
                    pan = (si - 1.5) / 1.5 * 0.35
                    add(L, s, t + si * 0.014, g * (1 - pan))
                    add(R, s, t + si * 0.014, g * (1 + pan))
            root = note(roots[bar % 4]) * k
            for off in ([0.0, 2.0] + ([3.5] if bar % 2 == 1 and en >= 2 else [])):
                dur = 0.9 if off != 3.5 else 0.4
                nn = int(dur * SR)
                tt = np.arange(nn) / SR
                f = root if off != 3.5 else root * 1.5
                sig = (np.sin(2 * np.pi * f * tt) + 0.35 * np.sin(2 * np.pi * 2 * f * tt)) * env_exp(nn, 0.35, 0.01)
                add(L, sig, t_bar + off * BEAT, 0.15)
                add(R, sig, t_bar + off * BEAT, 0.15)
        if en >= 2:
            for e in range(8):
                t = t_bar + e * BEAT / 2 + rng.normal(0, 0.003)
                nn = int(0.09 * SR)
                noise = np.convolve(np.diff(rng.normal(0, 1, nn), prepend=0), np.ones(2) / 2, mode="same")
                sig = noise * env_exp(nn, 0.02, 0.004)
                g = (0.035 if e % 2 else 0.02) * rng.uniform(0.8, 1.1)
                add(L, sig, t, g * 0.8)
                add(R, sig, t, g)
        if en >= 3:
            for off in (1.0, 3.0):
                for flam in range(3):
                    t = t_bar + off * BEAT + flam * 0.011 + rng.normal(0, 0.002)
                    nn = int(0.12 * SR)
                    noise = np.diff(np.convolve(rng.normal(0, 1, nn), np.ones(6) / 6, mode="same"), prepend=0)
                    sig = noise * env_exp(nn, 0.035, 0.002)
                    add(L, sig, t, 0.07)
                    add(R, sig, t, 0.07)
        if (en >= 3 and bar % 2 == 0) or (en == 0 and bar % 2 == 1):
            motif = [(0.0, ch[3]), (0.5, ch[2]), (1.0, ch[0]), (2.0, ch[3]), (2.5, "C5" if bar % 4 else "D5")]
            for off, nm in motif:
                f = note(nm) * 2 * k
                nn = int(0.8 * SR)
                tt = np.arange(nn) / SR
                sig = (np.sin(2 * np.pi * f * tt) + 0.3 * np.sin(2 * np.pi * 2.76 * f * tt) * np.exp(-tt * 12)) * env_exp(nn, 0.22, 0.001)
                add(L, sig, t_bar + off * BEAT, 0.05 if en >= 3 else 0.04)
                add(R, sig, t_bar + off * BEAT, 0.065 if en >= 3 else 0.05)
    music = np.stack([L, R], axis=1)[: int(duration * SR)]
    a = np.exp(-2 * np.pi * 6000 / SR)
    for c in range(2):
        music[:, c] = PA._onepole(music[:, c].copy(), a)
    fi, fo = int(1.0 * SR), int(3.0 * SR)
    music[:fi] *= np.linspace(0, 1, fi)[:, None]
    music[-fo:] *= (np.linspace(1, 0, fo) ** 1.5)[:, None]
    music /= max(1e-6, np.abs(music).max())
    return (0.9 * music).astype(np.float32)


# ---------------------------------------------------------------------------
# paper sound effects
# ---------------------------------------------------------------------------
def _noise(n, rng):
    return rng.normal(0, 1, n)


def _lp(x, k):
    return np.convolve(x, np.ones(k) / k, mode="same")


def sfx(kind: str, rng) -> np.ndarray:
    if kind == "pop":  # a card landing: soft paper tick + tiny thump
        n = int(0.09 * SR)
        x = np.diff(_lp(_noise(n, rng), 3), prepend=0) * env_exp(n, 0.012, 0.001)
        t = np.arange(n) / SR
        x += 0.5 * np.sin(2 * np.pi * 140 * t) * env_exp(n, 0.03, 0.002)
        return x * 0.55
    if kind == "slide":  # paper sliding on paper
        n = int(0.32 * SR)
        x = _lp(_noise(n, rng), 6)
        e = np.sin(np.linspace(0, np.pi, n)) ** 1.5
        return np.diff(x, prepend=0) * e * 0.9
    if kind == "drop":
        n = int(0.22 * SR)
        x = _lp(_noise(n, rng), 10) * env_exp(n, 0.05, 0.004)
        t = np.arange(n) / SR
        x += 0.8 * np.sin(2 * np.pi * 90 * t) * env_exp(n, 0.06, 0.003)
        return x * 0.6
    if kind == "stamp":
        n = int(0.3 * SR)
        t = np.arange(n) / SR
        x = np.sin(2 * np.pi * 70 * t) * env_exp(n, 0.08, 0.002) + 0.4 * _lp(_noise(n, rng), 4) * env_exp(n, 0.02, 0.001)
        return x * 0.9
    if kind == "tap":
        n = int(0.05 * SR)
        t = np.arange(n) / SR
        return (np.sin(2 * np.pi * 1800 * t) * env_exp(n, 0.006, 0.0005) + 0.3 * _noise(n, rng) * env_exp(n, 0.004, 0.0005)) * 0.5
    if kind == "ding":
        n = int(1.2 * SR)
        t = np.arange(n) / SR
        return (np.sin(2 * np.pi * 1318.5 * t) + 0.4 * np.sin(2 * np.pi * 2637 * t)) * env_exp(n, 0.35, 0.002) * 0.35
    if kind == "alarm":  # a little bell clock ringing
        n = int(1.6 * SR)
        t = np.arange(n) / SR
        x = (np.sin(2 * np.pi * 2100 * t) + 0.5 * np.sin(2 * np.pi * 3150 * t)) * (0.5 + 0.5 * np.sign(np.sin(2 * np.pi * 14 * t)))
        return x * env_exp(n, 0.9, 0.01) * 0.18
    return np.zeros(1)


def make_sfx(events: list[tuple[float, str]], total: float, seed=5) -> np.ndarray:
    rng = np.random.default_rng(seed)
    buf = np.zeros(int(total * SR) + SR)
    last = {}
    for t, kind in sorted(events):
        if kind in last and t - last[kind] < 0.07:
            continue
        last[kind] = t
        add(buf, sfx(kind, rng) * rng.uniform(0.8, 1.0), t)
    return buf[: int(total * SR)]


# ---------------------------------------------------------------------------
# mix
# ---------------------------------------------------------------------------
def mix(meta: list[dict], starts: list[float], total: float, bar_plan, sfx_events, out_wav: str) -> dict:
    n = int(total * SR)
    voice = np.zeros(n)
    for m, t0 in zip(meta, starts):
        v, sr = sf.read(m["wav"], dtype="float64")
        if v.ndim > 1:
            v = v.mean(axis=1)
        v = v / max(1e-6, np.abs(v).max()) * 0.8
        add(voice, v, t0)
    spoken = np.zeros(n, bool)
    for m, t0 in zip(meta, starts):
        spoken[int(t0 * SR): int((t0 + m["duration"]) * SR)] = True
    rms = np.sqrt(np.mean(voice[spoken] ** 2))
    g = min(10 ** (-18 / 20) / rms, 10 ** (-1.5 / 20) / max(1e-6, np.abs(voice).max()))
    voice *= g

    music = make_music(total, bar_plan).astype(np.float64)
    music *= 10 ** (-18 / 20) / np.sqrt(np.mean(music ** 2))
    env = PA.smooth_env(voice, attack=0.02, release=0.5)
    music *= (1 - 0.65 * np.clip(env / 0.05, 0, 1))[:, None]

    fx = make_sfx(sfx_events, total)
    if np.abs(fx).max() > 0:
        fx *= 10 ** (-17 / 20) / np.abs(fx).max()  # sound effects peak around -17 dBFS
    out = music + voice[:, None] + fx[:, None]
    thr = 0.85
    over = np.abs(out) > thr
    out[over] = np.sign(out[over]) * (thr + (1 - thr) * np.tanh((np.abs(out[over]) - thr) / (1 - thr)))
    peak = float(np.abs(out).max())
    ceiling = 10 ** (-1.0 / 20)  # leave headroom for the AAC encoder
    if peak > ceiling:
        out *= ceiling / peak
        peak = ceiling
    sf.write(out_wav, out.astype(np.float32), SR, subtype="PCM_24")
    return dict(
        peak_dbfs=round(20 * np.log10(peak), 2),
        voice_rms_dbfs=round(20 * np.log10(np.sqrt(np.mean(voice[spoken] ** 2))), 2),
        music_rms_gap=round(20 * np.log10(np.sqrt(np.mean(music[~spoken] ** 2)) + 1e-9), 2),
        limited=int(over.sum()),
        sfx_events=len(sfx_events),
    )
